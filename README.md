# SoulcityTech Website

Marketing website for **SoulcityTech**: cybersecurity, cloud, hardware & software, and digital marketing for businesses and individuals.

**Stack:** React 19 · Vite · TypeScript · Tailwind CSS 4 · React Router 7 · Lucide icons · Vercel serverless function (`/api/leads`) with Resend email and optional Supabase storage.

## Quick start

```bash
npm install
cp .env.example .env     # then fill in the values (see below)
npm run dev              # http://localhost:5173
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Local dev server |
| `npm run build` | Generates sitemap/robots, type-checks, builds to `dist/` |
| `npm run typecheck` | TypeScript check only |
| `npm test` | Unit tests (lead validation, `/api/leads` handler, WhatsApp URLs) |
| `npm run preview` | Serve the production build locally |

## Environment variables

Copy `.env.example` to `.env` for local work and add the same values in **Vercel → Project → Settings → Environment Variables**. Never commit `.env`.

**Public (browser, `VITE_` prefix)**

| Variable | Purpose |
| --- | --- |
| `VITE_SITE_URL` | Real public URL, no trailing slash. Drives canonical/OG URLs, sitemap and robots |
| `VITE_WHATSAPP_NUMBER` | Business number, digits only, international format (e.g. `234XXXXXXXXXX`). If empty, WhatsApp buttons fall back to the contact form |
| `VITE_CONTACT_EMAIL`, `VITE_PHONE_NUMBER` | Optional. Hidden on the site when empty |
| `VITE_LINKEDIN_URL`, `VITE_FACEBOOK_URL`, `VITE_INSTAGRAM_URL`, `VITE_X_URL` | Optional verified social links. Hidden when empty |
| `VITE_GA_MEASUREMENT_ID` | Google Analytics 4 ID. Empty disables analytics and the consent banner |
| `VITE_GSC_VERIFICATION` | Google Search Console meta-tag token (optional) |

**Server-only (never `VITE_`)**

| Variable | Purpose |
| --- | --- |
| `RESEND_API_KEY` | Resend API key |
| `LEADS_TO_EMAIL` | Where lead notifications go (comma-separate for several) |
| `LEADS_FROM_EMAIL` | Verified sender, e.g. `SoulcityTech Website <leads@yourdomain.com>` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_LEADS_TABLE` | Optional lead storage. Service-role key is server-side only |
| `ALLOWED_ORIGINS` | Optional extra origins allowed to POST to `/api/leads` |

## Content that needs real information

Nothing below is invented. Supply it before launch:

- WhatsApp number, business email, phone (optional), verified social links.
- Real testimonials, case studies, client logos, certifications: add them to `src/config/proof.ts`. Until then the Trust section shows the process and approach instead.
- Company history, team and founding details for the About page, if wanted.
- Confirmed service area, before adding any location targeting to SEO.
- Legal review of `/privacy-policy` (it is a template).
- Confirm which services listed are actually offered; copy is in `src/config/content.ts`.

## Lead capture

`LeadForm` validates on the client, then posts to `/api/leads`. The function re-validates on the server (shared rules in `shared/lead.ts`), applies a honeypot, a minimum-fill-time check, origin checks and per-IP rate limiting, emails the business via Resend, and optionally stores the lead in Supabase. The form only shows success when the API confirms it. WhatsApp clicks are never reported as "delivered".

Optional Supabase table:

```sql
create table leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  full_name text not null,
  email text not null,
  phone text,
  customer_type text not null,
  company text,
  service text not null,
  intent text not null,
  contact_method text not null,
  message text not null,
  source text,
  submission_id text
);
alter table leads enable row level security;  -- no policies: only the service-role key can write
```

The columns match what `saveToSupabase` in `api/_lib/processLead.ts` inserts.

## Deploy: GitHub + Vercel

1. Create a GitHub repository, then `git add . && git commit -m "Initial commit" && git remote add origin <url> && git push -u origin main`.
2. In Vercel choose **Add New → Project** and import the repository. Framework preset: Vite. Build command `npm run build`, output `dist` (already set in `vercel.json`).
3. Add the environment variables above (Production, and Preview if wanted).
4. Deploy, then add your domain under **Settings → Domains** and set `VITE_SITE_URL` to it. Redeploy so the sitemap and canonical URLs use it.
5. On the live site: open every route directly and refresh it, click each WhatsApp link, and submit one controlled test lead to confirm the email arrives.
6. Submit `https://yourdomain/sitemap.xml` in Google Search Console.

`vercel.json` rewrites all non-`/api` paths to `index.html` (so refreshes on any route work) and sets security headers. This site needs Vercel (or another host with serverless functions); GitHub Pages cannot run `/api/leads`.

## Production launch checklist

- [ ] `npm install && npm run build` succeeds locally
- [ ] `npm test` passes
- [ ] Real WhatsApp number set and tested on mobile
- [ ] `VITE_SITE_URL` set to the live domain; sitemap lists real URLs
- [ ] Resend domain verified; test lead email received
- [ ] Privacy policy reviewed by counsel; consent banner behaves as required for your audience
- [ ] No placeholder text, fake proof or invented claims remain
- [ ] Lighthouse run on home, a service page, and contact (mobile); record results
- [ ] Keyboard-only pass and reduced-motion pass
- [ ] No secrets in the repository (`git log -p | grep -i key`)

## Project structure

```
api/leads.ts, api/_lib/   Vercel serverless lead endpoint
shared/lead.ts            Validation shared by browser and server
src/components/           layout, home, forms, services, ui
src/pages/                routes (services/ holds the four service pages)
src/config/               site.ts (env-driven details), content.ts, proof.ts
src/lib/                  whatsapp, analytics, links
scripts/generate-seo.mjs  sitemap.xml + robots.txt at build time
tests/                    node:test unit tests (run with tsx)
```
