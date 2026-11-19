# StrangeTheory — Vercel Production Deployment & Operations Guide

StrangeTheory runs as a serverless-ready React + Vite SPA (`dist/`) paired with Express API handlers (`api/index.ts` and `api/cron/daily.ts`), durable **Neon PostgreSQL** persistence (`DATABASE_URL`), **Vercel Blob** image storage (`BLOB_READ_WRITE_TOKEN`), and **Resend** transactional email.

---

## 1. Free-Tier Hosted Stack Overview

1. **Compute & Static CDN**: **Vercel (Hobby Free Tier)** — builds `dist/` via `npm run build` (`vite build`), routes `/api/*`, `/sitemap.xml`, and `/robots.txt` to `api/index.ts`, and schedules `api/cron/daily.ts` via `vercel.json`.
2. **Database**: **Neon PostgreSQL (Free Tier)** — serverless-pooled Postgres over SSL (`DATABASE_URL`). Survives cold starts, scaling, and read-only serverless filesystems cleanly.
3. **File Storage**: **Vercel Blob** — stores uploaded post covers and editor diagrams (`POST /api/uploads/image`) with public immutable URLs and size/type validation (`<= 5 MB` PNG/JPEG/WEBP).
4. **Transactional Email**: **Resend (Free Tier: 3,000 emails/month)** — delivers verification and password-reset emails (`RESEND_API_KEY` + `EMAIL_FROM`).
5. **Error Monitoring**: **Sentry (`@sentry/node` + `@sentry/react`)** — optional `SENTRY_DSN` + `VITE_SENTRY_DSN` alongside built-in Postgres `error_logs` visible in `/admin`.

---

## 2. Step-by-Step Free-Tier Deployment on Vercel

### Step 1: Provision Neon PostgreSQL
1. Sign in to [neon.tech](https://neon.tech) and create a free project (`strangetheory-prod`) in the region closest to your Vercel Functions region (e.g., `us-east-1` / `iad1`).
2. Copy the **pooled** connection string ending in `?sslmode=require` (for example: `postgresql://neondb_owner:...@ep-...pooler.us-east-1.aws.neon.tech/neondb?sslmode=require`).
3. Keep this ready for `DATABASE_URL`. (StrangeTheory automatically creates tables and seeds the 20 curated editorial entries on first request unless `STRANGETHEORY_SKIP_SEED=1`.)

### Step 2: Create Vercel Project & Connect Vercel Blob
1. Push this repository to GitHub/GitLab/Bitbucket and import it in [vercel.com/new](https://vercel.com/new).
2. Vercel reads `vercel.json` automatically:
   - **Framework Preset**: Vite
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
3. Open your Vercel project -> **Storage -> Create Database / Store -> Blob**, name it `strangetheory-uploads`, and link it to **Production** (this automatically injects `BLOB_READ_WRITE_TOKEN`).

### Step 3: Set Environment Variables in Vercel
In **Project Settings -> Environment Variables** (scope: **Production**), configure:

| Variable | Required | Example | Purpose |
| --- | --- | --- | --- |
| `NODE_ENV` | Yes | `production` | Enforces strict Postgres + Vercel Blob config, hides dev outbox previews, disables demo auth |
| `DATABASE_URL` | Yes | `postgresql://...sslmode=require` | Hosted Neon PostgreSQL connection string for all app state |
| `BLOB_READ_WRITE_TOKEN` | Yes | `vercel_blob_rw_...` | Vercel Blob token for uploaded post covers and inline images |
| `APP_URL` | Yes | `https://strangetheory.org` | Canonical origin for email verification, password reset links, OG URLs, and `/sitemap.xml` |
| `SESSION_SECRET` | Yes | `openssl rand -hex 32` | 32+ byte HMAC-SHA256 secret signing `HttpOnly` session cookies (`st_session`) |
| `FORCE_HTTPS` | Yes | `true` | Forces `Secure` flag on `st_session` and `st_csrf` cookies behind HTTPS |
| `CRON_SECRET` | Yes | `openssl rand -hex 32` | Bearer secret checked by `GET/POST /api/cron/daily` |
| `RESEND_API_KEY` | Yes | `re_xxxxxxxxx` | Resend API key for real verification and password-reset emails |
| `EMAIL_FROM` | Yes | `StrangeTheory <noreply@yourdomain.com>` | Verified Resend sender identity |
| `CONTACT_EMAIL` | Recommended | `support@yourdomain.com` | Public contact/privacy email rendered on Legal, Privacy, Terms, and Guidelines pages |
| `VITE_CONTACT_EMAIL` | Recommended | `support@yourdomain.com` | Client build-time contact email fallback matching `CONTACT_EMAIL` |
| `ADMIN_EMAIL` | First deploy | `founder@yourdomain.com` | Creates or promotes the first admin on startup when zero admins exist |
| `ADMIN_USERNAME` | First deploy | `founder` | Username for the bootstrapped admin account |
| `ADMIN_DISPLAY_NAME` | Optional | `Founder` | Display name for the bootstrapped admin account |
| `ADMIN_PASSWORD` | First deploy | Strong 12+ char passphrase | Initial password (`>=10` chars, not common/similar to email); remove after first sign-in |
| `SENTRY_DSN` | Optional | `https://...@o0.ingest.sentry.io/...` | Server-side Sentry error tracking DSN |
| `VITE_SENTRY_DSN` | Optional | `https://...@o0.ingest.sentry.io/...` | Browser React ErrorBoundary Sentry DSN |
| `GOOGLE_CLIENT_ID` | Optional | `...apps.googleusercontent.com` | Enables Google Sign-In |
| `STRANGETHEORY_SKIP_SEED` | Optional | `1` | Set to `1` only if launching empty without the 20 curated editorial entries |

> **Critical**: Deploy with `NODE_ENV=production` **and** `DATABASE_URL` + `BLOB_READ_WRITE_TOKEN` set. Production startup intentionally fails fast if either is missing so uploads or accounts are never lost to ephemeral storage.

### Step 4: Verify Scheduled Crons & Health Endpoint
- `vercel.json` triggers `/api/cron/daily` daily at `06:00 UTC` (daily picks, expired riddle auto-reveal, digest notifications, and rate-limit pruning) and `/api/cron/weekly` Mondays at `08:00 UTC` (weekly riddle challenge rotation and *The Weekly Synapse* opt-in email digest, capped at 1 email/week) using `Authorization: Bearer <CRON_SECRET>`, which Vercel sends automatically when `CRON_SECRET` is configured.
- Verify health after deployment:
  ```bash
  curl -fsS https://your-domain.vercel.app/api/health
  # Expected: {"ok":true,"db":"connected","storage":"vercel_blob",...}
  ```

---

## 3. Connect a Custom Domain + Email Sending (Resend)

### Custom Domain (Vercel)
1. In Vercel -> **Project Settings -> Domains**, add `strangetheory.org` and `www.strangetheory.org`.
2. Update DNS records at your registrar (`A` record -> `76.76.21.21` for apex, `CNAME` -> `cname.vercel-dns.com` for `www`).
3. Wait for automatic TLS certificate issuance, then update `APP_URL="https://strangetheory.org"` in Vercel env vars and trigger a redeploy so canonical URLs and `/sitemap.xml` match.

### Transactional Email (Resend)
1. In [resend.com](https://resend.com) -> **Domains -> Add Domain** (`yourdomain.com` or subdomain `mail.yourdomain.com`).
2. Add the exact **SPF (`TXT`)**, **DKIM (`TXT`)**, and **DMARC (`TXT`)** DNS records at your registrar and verify DNS status turns **Verified**.
3. Create a **Sending access** API key (`re_...`), set `RESEND_API_KEY` and `EMAIL_FROM="StrangeTheory <noreply@yourdomain.com>"` in Vercel, and redeploy.
4. Register a test account in production, confirm the verification email arrives in inbox, and click the link to unlock publishing.

---

## 4. Create the First Admin Account Safely

Never embed admin credentials in source code or client bundles. Use one of these two methods:

1. **One-Time Environment Bootstrap (Recommended for Vercel)**:
   - Set `ADMIN_EMAIL`, `ADMIN_USERNAME`, and a unique 12+ char `ADMIN_PASSWORD` in Vercel Production env vars before your first deploy.
   - On startup, `bootstrapEnvAdmin()` checks `SELECT COUNT(*) FROM profiles WHERE role = 'admin'`. Only when **zero** admins exist does it create or promote that account as `email_verified = true`.
   - After signing in successfully at `/auth` and confirming `/admin` loads, **delete `ADMIN_PASSWORD` from Vercel env vars** and redeploy.
2. **CLI Script Against Production `DATABASE_URL` (From Your Secure Local Machine)**:
   ```bash
   DATABASE_URL="postgresql://..." npm run admin:create -- \
     --email=founder@yourdomain.com \
     --username=founder \
     --name="Founder" \
     --password="Use-A-Strong-Unique-Passphrase!"
   ```
   (Optional: run `DATABASE_URL="..." npm run seed:clear` beforehand if you want to strip all seeded editorial entries.)

---

## 5. Production Launch Checklist

- [ ] **Database Backups**: Enable **Neon Point-in-Time Recovery (PITR)** / restore history (24h–7d retention depending on plan) and schedule a weekly logical `pg_dump` export to encrypted private storage (`pg_dump "$DATABASE_URL" -Fc -f strangetheory-$(date +%F).dump`). Test restoring into a Neon branch before launch.
- [ ] **Error Monitoring & Uptime**: Confirm `SENTRY_DSN` and `VITE_SENTRY_DSN` (if used) ingest test exceptions cleanly, review `/admin` Error Logs, and point an external uptime monitor (Better Stack or UptimeRobot) at `https://yourdomain.com/api/health` every 5 minutes.
- [ ] **Privacy-First Analytics**: Built-in Postgres `analytics_events` tracks aggregate feature counts (`page_view`, searches, riddle reveals) with zero third-party ad pixels or behavioral tracking. Verify `/admin` metrics increment cleanly.
- [ ] **Legal & Privacy Review**: Open `/privacy`, `/terms`, and `/guidelines` in production to confirm `CONTACT_EMAIL` renders your real support address, `st_session`/`st_csrf` cookies and Resend/Neon/Vercel subprocessors are accurately disclosed, and both `/api/users/me/export` (JSON export) and `/api/users/me` (account deletion) succeed end-to-end.
- [ ] **Security Verification**: Confirm `/api/auth/me` returns `"demo_accounts": []`, `POST /api/auth/demo-switch` returns `403`, unauthenticated requests to `/api/riddles/:id` do **not** contain `answer` or `explanation`, and unverified members receive `403 EMAIL_NOT_VERIFIED` when attempting to publish.

---

## 6. Rollback Plan

1. **Instant Code Rollback (Vercel)**:
   - Open **Vercel Dashboard -> Deployments**, locate the previous verified green deployment, click the menu (`...`) -> **Instant Rollback** (reverts edge assets + serverless routes in seconds without rebuilding).
2. **Database Recovery (Neon Branching / PITR)**:
   - Never run destructive `DROP` migrations blindly on production. Before schema updates, create an instant Neon branch snapshot (`neonctl branches create --name pre-release`).
   - If data corruption occurs, restore via Neon **Time Travel / Point-in-Time Restore** to the timestamp immediately prior to the bad deploy, or swap `DATABASE_URL` to the clean snapshot branch and redeploy.
3. **Incident Containment Without Redeploying**:
   - Sign in as Admin -> `/admin` -> hide offending entries/comments, ban abusive accounts, or inspect recent `error_logs` directly in the UI.
