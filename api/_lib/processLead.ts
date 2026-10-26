/**
 * Core lead-handling logic, kept separate from the Vercel request/response
 * wrapper (api/leads.ts) so it can be unit-tested without a server.
 *
 * Delivery channels (at least one must be configured, otherwise the endpoint
 * answers 503 instead of pretending to succeed):
 *   1. Email notification through the Resend REST API.
 *   2. Optional row insert into Supabase (server-side service role key).
 */
import { validateLead, type FieldErrors, type LeadInput } from '../../shared/lead.js';

export interface LeadEnv {
  RESEND_API_KEY?: string;
  LEADS_TO_EMAIL?: string;
  LEADS_FROM_EMAIL?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_LEADS_TABLE?: string;
  ALLOWED_ORIGINS?: string;
}

export interface LeadRequest {
  method: string;
  body: unknown;
  ip: string;
  origin?: string;
  host?: string;
}

export interface LeadResponse {
  status: number;
  body: { ok: boolean; error?: string; fieldErrors?: FieldErrors; duplicate?: boolean };
}

/** In-memory state. On serverless this is per warm instance — a best-effort first line of defence. */
export interface LeadState {
  hits: Map<string, number[]>;
  processed: Map<string, number>;
}

export function createLeadState(): LeadState {
  return { hits: new Map(), processed: new Map() };
}

export interface LeadDeps {
  env: LeadEnv;
  fetchImpl: typeof fetch;
  now: () => number;
  state: LeadState;
}

const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 5;
const DEDUPE_WINDOW_MS = 10 * 60 * 1000;
const MIN_FILL_MS = 3000;
const MAX_FUTURE_SKEW_MS = 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;

const defaultState = createLeadState();

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function splitList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

export function isEmailConfigured(env: LeadEnv): boolean {
  return Boolean(env.RESEND_API_KEY && splitList(env.LEADS_TO_EMAIL).length > 0 && env.LEADS_FROM_EMAIL);
}

export function isDatabaseConfigured(env: LeadEnv): boolean {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}

function originAllowed(origin: string | undefined, host: string | undefined, env: LeadEnv): boolean {
  if (!origin) return true; // non-browser or same-origin requests without an Origin header
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }
  if (host && originUrl.host === host) return true;
  return splitList(env.ALLOWED_ORIGINS).some((allowed) => allowed.replace(/\/+$/, '') === originUrl.origin);
}

function pruneState(state: LeadState, now: number): void {
  for (const [ip, times] of state.hits) {
    const recent = times.filter((t) => now - t < RATE_WINDOW_MS);
    if (recent.length === 0) state.hits.delete(ip);
    else state.hits.set(ip, recent);
  }
  for (const [id, at] of state.processed) {
    if (now - at >= DEDUPE_WINDOW_MS) state.processed.delete(id);
  }
}

export function buildEmail(lead: LeadInput): { subject: string; html: string; text: string } {
  const subject = `New ${lead.intent} from ${lead.fullName} (${lead.customerType} — ${lead.service})`.slice(0, 200);
  const rows: Array<[string, string]> = [
    ['Name', lead.fullName],
    ['Email', lead.email],
    ['Phone', lead.phone || '—'],
    ['Customer type', lead.customerType],
    ['Company', lead.company || '—'],
    ['Service of interest', lead.service],
    ['Request type', lead.intent],
    ['Preferred contact', lead.contactMethod],
    ['Submitted from', lead.source || '—'],
  ];
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;max-width:640px">
<h2 style="margin:0 0 12px">New website lead</h2>
<table style="border-collapse:collapse;width:100%">
${rows
  .map(
    ([label, value]) =>
      `<tr><td style="padding:6px 12px 6px 0;color:#475569;vertical-align:top;white-space:nowrap">${escapeHtml(label)}</td><td style="padding:6px 0">${escapeHtml(value)}</td></tr>`,
  )
  .join('\n')}
</table>
<h3 style="margin:20px 0 6px">Message</h3>
<p style="white-space:pre-wrap;margin:0">${escapeHtml(lead.message)}</p>
</div>`;
  const text = `${rows.map(([label, value]) => `${label}: ${value}`).join('\n')}\n\nMessage:\n${lead.message}`;
  return { subject, html, text };
}

async function sendEmail(lead: LeadInput, deps: LeadDeps): Promise<void> {
  const { env, fetchImpl } = deps;
  const { subject, html, text } = buildEmail(lead);
  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.LEADS_FROM_EMAIL,
      to: splitList(env.LEADS_TO_EMAIL),
      reply_to: lead.email,
      subject,
      html,
      text,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Resend responded with HTTP ${response.status}`);
}

async function saveToSupabase(lead: LeadInput, deps: LeadDeps): Promise<void> {
  const { env, fetchImpl } = deps;
  const table = encodeURIComponent(env.SUPABASE_LEADS_TABLE || 'leads');
  const base = (env.SUPABASE_URL ?? '').replace(/\/+$/, '');
  const response = await fetchImpl(`${base}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY ?? '',
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY ?? ''}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      full_name: lead.fullName,
      email: lead.email,
      phone: lead.phone || null,
      customer_type: lead.customerType,
      company: lead.company || null,
      service: lead.service,
      intent: lead.intent,
      contact_method: lead.contactMethod,
      message: lead.message,
      source: lead.source || null,
      submission_id: lead.submissionId,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Supabase responded with HTTP ${response.status}`);
}

export async function processLead(
  request: LeadRequest,
  overrides: Partial<LeadDeps> = {},
): Promise<LeadResponse> {
  const deps: LeadDeps = {
    env: overrides.env ?? (process.env as LeadEnv),
    fetchImpl: overrides.fetchImpl ?? fetch,
    now: overrides.now ?? Date.now,
    state: overrides.state ?? defaultState,
  };
  const now = deps.now();

  if (request.method !== 'POST') {
    return { status: 405, body: { ok: false, error: 'Method not allowed.' } };
  }
  if (!originAllowed(request.origin, request.host, deps.env)) {
    return { status: 403, body: { ok: false, error: 'Request origin not allowed.' } };
  }

  // Best-effort per-IP rate limit.
  pruneState(deps.state, now);
  const times = deps.state.hits.get(request.ip) ?? [];
  if (times.length >= RATE_MAX) {
    return { status: 429, body: { ok: false, error: 'Too many requests. Please wait a few minutes and try again.' } };
  }
  deps.state.hits.set(request.ip, [...times, now]);

  const result = validateLead(request.body);
  if (!result.ok) {
    return { status: 400, body: { ok: false, error: 'Please check the highlighted fields.', fieldErrors: result.errors } };
  }
  const lead = result.data;

  // Honeypot: bots fill hidden fields. Acknowledge quietly, deliver nothing.
  if (lead.website !== '') {
    return { status: 200, body: { ok: true } };
  }

  // Minimum fill time. Real people who trip this can simply resubmit, so tell them rather than faking success.
  if (lead.startedAt !== null) {
    const elapsed = now - lead.startedAt;
    if (elapsed < MIN_FILL_MS && elapsed > -MAX_FUTURE_SKEW_MS) {
      return { status: 429, body: { ok: false, error: 'That was very quick. Please check your details and submit again.' } };
    }
  }

  if (deps.state.processed.has(lead.submissionId)) {
    return { status: 200, body: { ok: true, duplicate: true } };
  }

  const emailOn = isEmailConfigured(deps.env);
  const dbOn = isDatabaseConfigured(deps.env);
  if (!emailOn && !dbOn) {
    console.error('[leads] No delivery channel configured (set RESEND_API_KEY/LEADS_TO_EMAIL/LEADS_FROM_EMAIL and/or Supabase variables).');
    return {
      status: 503,
      body: { ok: false, error: 'Our enquiry form is temporarily unavailable. Please contact us on WhatsApp instead.' },
    };
  }

  const jobs: Array<{ name: string; run: Promise<void> }> = [];
  if (emailOn) jobs.push({ name: 'email', run: sendEmail(lead, deps) });
  if (dbOn) jobs.push({ name: 'database', run: saveToSupabase(lead, deps) });

  const settled = await Promise.allSettled(jobs.map((job) => job.run));
  let delivered = false;
  settled.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled') delivered = true;
    else console.error(`[leads] ${jobs[index]?.name} delivery failed:`, (outcome.reason as Error)?.message ?? 'unknown error');
  });

  if (!delivered) {
    return {
      status: 502,
      body: { ok: false, error: 'We could not send your enquiry just now. Please try again, or contact us on WhatsApp.' },
    };
  }

  deps.state.processed.set(lead.submissionId, now);
  return { status: 200, body: { ok: true } };
}
