# StrangeTheory

**StrangeTheory** is a dark-mode, 3D-animated intellectual observatory for structured thought experiments (*"What if..."*) and spoiler-protected lateral riddles.

## Production Stack
- **Compute & Edge CDN**: Vercel (`dist/` SPA + `/api/*` Express serverless functions + `/api/cron/daily` & `/api/cron/weekly`)
- **Database**: Hosted **Neon PostgreSQL** via pooled SSL connection (`DATABASE_URL`, `pg` pool `max: 3`) with versioned SQL migrations (`server/migrations/*.sql` tracked in `schema_migrations`)
- **Local Dev Database**: Ephemeral/local `@electric-sql/pglite` (loaded dynamically in non-production only; never bundled into Vercel serverless functions)
- **Media Storage**: **Vercel Blob** (`BLOB_READ_WRITE_TOKEN`, <= 5 MB magic-byte-verified JPEG/PNG/WebP uploads)
- **Transactional Email**: **Resend** (`RESEND_API_KEY`, `EMAIL_FROM`) for email verification, password resets, and weekly opt-in digests
- **Monitoring**: Structured JSON request logs with `X-Request-Id` + optional **Sentry** (`SENTRY_DSN`, `VITE_SENTRY_DSN`) + `/api/health`

## Key Features
- **Single-Constant Branding**: App name (`StrangeTheory`) is centralized in `src/lib/config.ts`.
- **10 Brain-Region Categories**: Each domain maps to a distinct brain region, accent hue, and 3D cluster in the code-split Three.js hero (`Prefrontal Cortex`, `Parietal Cortex`, `Temporal Lobe`, `Hippocampus`, `Cerebellum`, `Limbic System`, `Occipital Lobe`, `Wernicke's Area`, `Basal Ganglia`, `Corpus Callosum`).
- **My Brain & Idea Graph**: Interactive 3D brain activity map, badges, and concept constellation (lazy-loaded on demand via `React.lazy`).
- **Structured Thought Experiments**: `Premise`, `Ripple Effects`, `Where This Breaks Down`, and `Free Content` blocks, Mind-Change plausibility meter, three-lens comments (`Ripples`, `Stress Test`, `Branches`), and 1-click branching.
- **Spoiler-Protected Riddles**: Server-sealed `riddle_secrets` table never leaks answers, explanations, unrevealed hints, or `likely_correct` flags in list, detail, search, weekly challenge, or OG SVG endpoints prior to unlock/reveal.
- **Security & RBAC**: `scrypt` password hashing, HMAC-signed `HttpOnly` + `SameSite=Lax` + HTTPS `Secure` session cookies, Origin + CSRF double-submit verification, Zod input/query/param validation with standardized error responses, XSS HTML allow-list sanitization, and Postgres-backed rate limiting (`rate_events`).

## Scripts
- `npm run db:migrate` — Apply pending SQL migrations (`server/migrations/*.sql`) and record versions in `schema_migrations`
- `npm run db:seed` — Idempotently upsert brain-region categories and the 20 curated launch entries (safe to run multiple times)
- `npm run dev` — Run migrations, seed locally (PGlite by default), and start Express + Vite dev server on port `3000`
- `npm run build` — Build production frontend bundle (`dist/`)
- `npm start` — Start Express server (`tsx server.ts`)
- `npm run lint` — TypeScript check (`tsc --noEmit`)
- `npm test` — Run unit, migration/seed, and end-to-end API security tests (`node:test`)
- `npm run smoke -- https://your-url` — Run live deployment smoke checks against `/api/health`, public SSR/routes, riddle zero-leak, search, validation errors, and protected endpoints
- `npm run seed:clear` — Purge seeded sample entries (`is_seed = 1`) while keeping real user data
- `npm run admin:create` — Create or promote an admin account via CLI

## Deploy Order (Vercel + Neon + Vercel Blob + Resend)
1. Provision a **Neon PostgreSQL** project and copy the **pooled** connection string (`?sslmode=require`).
2. Create a **Vercel Blob** store linked to the Vercel project (`BLOB_READ_WRITE_TOKEN`).
3. Configure verified sending domain + API key in **Resend** (`RESEND_API_KEY`, `EMAIL_FROM`).
4. Set all required environment variables from `.env.example` (`NODE_ENV=production`, `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`, `APP_URL`, `SESSION_SECRET`, `FORCE_HTTPS=true`, `CRON_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, etc.) in Vercel.
5. Deploy (`vercel.json` runs `npm run db:migrate && npm run build`).
6. Run `DATABASE_URL="..." npm run db:seed` once (safe to re-run) if launching with the 20 curated editorial entries, and verify `npm run smoke -- https://your-production-domain`.
