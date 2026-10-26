/**
 * Vercel serverless function: POST /api/leads
 * Thin adapter around processLead(); all logic lives in ./_lib/processLead.ts.
 * Types are declared locally so no @vercel/node dependency is required.
 */
import { processLead } from './_lib/processLead.js';

type HeaderValue = string | string[] | undefined;

interface VercelLikeRequest {
  method?: string;
  body?: unknown;
  headers: Record<string, HeaderValue>;
  socket?: { remoteAddress?: string };
}

interface VercelLikeResponse {
  status(code: number): VercelLikeResponse;
  setHeader(name: string, value: string): void;
  json(body: unknown): void;
}

function header(req: VercelLikeRequest, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function clientIp(req: VercelLikeRequest): string {
  const forwarded = header(req, 'x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() || 'unknown';
  return header(req, 'x-real-ip') ?? req.socket?.remoteAddress ?? 'unknown';
}

export default async function handler(req: VercelLikeRequest, res: VercelLikeResponse): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      res.status(400).json({ ok: false, error: 'Invalid request body.' });
      return;
    }
  }

  try {
    const result = await processLead({
      method: req.method ?? 'GET',
      body,
      ip: clientIp(req),
      origin: header(req, 'origin'),
      host: header(req, 'host'),
    });
    if (result.status === 405) res.setHeader('Allow', 'POST');
    res.status(result.status).json(result.body);
  } catch (error) {
    console.error('[leads] Unexpected error:', (error as Error)?.message ?? 'unknown');
    res.status(500).json({ ok: false, error: 'Something went wrong. Please try again.' });
  }
}
