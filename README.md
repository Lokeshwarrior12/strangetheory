# StrangeTheory

**StrangeTheory** is a dark-mode 3D-animated intellectual observatory for structured thought experiments (*"What if..."*) and spoiler-protected lateral riddles.

## Key Features
- **Single-Constant Branding**: App name (`StrangeTheory`) is centralized in `src/lib/config.ts`.
- **10 Brain-Region Categories**: Every domain maps to a distinct brain region, color accent, and 3D node cluster (`Prefrontal Cortex`, `Parietal Cortex`, `Temporal Lobe`, `Hippocampus`, `Cerebellum`, `Limbic System`, `Occipital Lobe`, `Wernicke's Area`, `Basal Ganglia`, `Corpus Callosum`).
- **3D Interactive Experiences**:
  - **Particle Brain Hero** (`src/components/three/NeuralBrainCanvas.tsx`): Scroll-driven camera movement, hardware/motion scaling, and static fallback when WebGL is unavailable.
  - **3D Idea Graph**: Interactive brain-region & post constellation (`<= 150` nodes) with click-to-preview drawer before opening entries.
  - **Firing Synapse & Neuron Reading Bar**: Synapse burst animation on the Random Discovery button and live neuron reading progress bar on essay pages.
- **Structured Thought Experiments**:
  - Editor with `Premise`, `Ripple Effects (1st/2nd/3rd order)`, `Where This Breaks Down`, and `Free Content` blocks, rich formatting toolbar, inline image upload, 280-char intro limit, AI disclosure, and 10-second autosave + unsaved-changes guard.
  - **Mind-Change Meter**: Before/after `0–100` plausibility slider with community delta tracking.
  - **Three-Lens Discussion**: Separate `Ripples`, `Stress Test`, and `Branches` threads with 1-level replies, comment reactions, `Top / Newest / Most insightful` sorting, and 1-click **Branch into Linked Post**.
- **Spoiler-Protected Riddles**:
  - Server-sealed `riddle_secrets` table never leaks answers, explanations, unrevealed hints, or `likely_correct` keyword flags to non-authors before official reveal.
  - Progressive hints (`-1` Synapse per hint, floor `1`), First-Solver `+5` bonus, and answer curtain until submitted or explicitly unlocked.
- **Persistence, Security & RBAC**:
  - Real `node:sqlite` (`DatabaseSync`) persistence with 21 relational tables (`data/strangetheory.sqlite`).
  - `scrypt` password hashing, HMAC-signed `HttpOnly` session cookies, CSRF header validation (`st_csrf` / `x-csrf-token`), strict XSS HTML allow-list sanitization, and server-side rate limits.
  - Full account lifecycle: email verification tokens, password reset tokens, email/password settings, JSON data export (`/api/users/me/export`), and account deletion.

## Scripts
- `npm run dev` — Run Express + Vite dev server on port `3000`
- `npm run build` — Build production frontend bundle (`dist/`)
- `npm start` — Start Express server (`tsx server.ts`)
- `npm run lint` — TypeScript check (`tsc --noEmit`)
- `npm test` — Run unit + SQLite + API integration test suites
- `npm run seed:clear` — Purge seeded sample entries (`is_seed = 1`) while keeping real user data

## Local vs Production Adapters
- **Email (`server/email.ts`)**: Uses [Resend](https://resend.com) when `RESEND_API_KEY` is configured; otherwise logs outbound verification/reset emails into SQLite `email_outbox` and returns a dev preview URL.
- **Google Sign-In (`/api/auth/google`)**: Verifies Google ID tokens against Google `tokeninfo` when `GOOGLE_CLIENT_ID` is set; returns `501` otherwise.
- **Image Uploads (`server/storage.ts`)**: Validates magic bytes (JPEG/PNG/WebP up to 5 MB) and saves files under `data/uploads/`, served at `/uploads/*`.
- **Demo Accounts (Dev Only)**: Two member demo buttons (`aria_chen`, `julian_mercer`) appear only when `NODE_ENV !== 'production'`. Moderator (`marcus_thorne`) and Admin (`elena_vance`) accounts must sign in with real credentials.
