# Account Manager

An AI-powered SaaS that auto-writes and publishes news-driven posts to your LinkedIn profile and Telegram channels on a schedule you control. Pick topics, pick a voice, pick a cadence — Claude does the writing and the platform posts.

---

## Table of contents

1. [What it does](#what-it-does)
2. [Architecture](#architecture)
3. [Tech stack](#tech-stack)
4. [Prerequisites](#prerequisites)
5. [Quick start (local)](#quick-start-local)
6. [Environment variables](#environment-variables)
7. [Feature walkthrough](#feature-walkthrough)
8. [How the pipeline works](#how-the-pipeline-works)
9. [Deployment — Supabase + Netlify](#deployment--supabase--netlify)
10. [Working with the database](#working-with-the-database)
11. [Project structure](#project-structure)
12. [Scripts reference](#scripts-reference)
13. [Troubleshooting](#troubleshooting)
14. [Roadmap](#roadmap)

---

## What it does

- **AI-written posts.** Pick topics (pre-built templates like *Tech / AI / Web3* or custom keywords) and a writing voice (Professional / Casual / Technical / Provocative / custom) — Claude drafts posts in your style.
- **Multi-platform publishing.** Posts go to your personal LinkedIn feed (official API) and/or Telegram channel (Bot API).
- **Multi-language.** Generates parallel posts in English, Russian, or both.
- **Flexible schedule.** Daily, every 2/3/7/14 days, at an hour you pick, in your timezone.
- **Two publishing modes.**
  - *Autopilot* — posts go out automatically on schedule.
  - *Manual approval* — drafts queue up for you to review, edit, and publish with one click.
- **Multi-project.** One account can run several independent "projects" — personal brand, company page, client accounts — each with its own topics, voice, schedule, connections, history.
- **Safety gate.** Per-project banned-words list and an optional Claude-powered moderation check runs before every post.
- **Analytics.** 30-day sparkline, per-platform and per-topic breakdown, success rate, expiry warnings.
- **Managed deploy.** Runs on Supabase Cloud (Postgres + Auth + scheduling) fronted by Netlify (Next.js runtime). No servers to babysit.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                  Next.js app (on Netlify)                        │
│                                                                  │
│  Landing ─ Auth ─ Dashboard ─ Drafts ─ Analytics ─ Settings      │
│                                                                  │
│  API routes:                                                     │
│   • /auth/callback          Supabase OAuth code exchange        │
│   • /api/linkedin/*         OAuth authorize + callback           │
│   • /api/cron/tick          Scheduled pipeline trigger           │
│   • /api/health             DB liveness check                    │
│                                                                  │
│  Server actions:                                                 │
│   • project CRUD, settings, connections, drafts, publish         │
└──────────────────────────────────────────────────────────────────┘
         │                    │                     │
         ▼                    ▼                     ▼
  ┌─────────────┐      ┌─────────────┐       ┌─────────────┐
  │  Supabase   │      │  Claude     │       │  External   │
  │  Cloud      │      │  Opus 4.7   │       │  sources    │
  │             │      │             │       │             │
  │ - Postgres  │      │ - generator │       │ - RSS feeds │
  │   (RLS)     │      │ - moderator │       │ - NewsAPI   │
  │ - Auth      │      │             │       │ - LinkedIn  │
  │ - pg_cron   │      │             │       │ - Telegram  │
  └─────────────┘      └─────────────┘       └─────────────┘
```

The app reaches Postgres exclusively through **supabase-js** (browser, server, and service-role clients), with **Row-Level Security** enforcing tenant isolation in the database itself. Identity is handled by **Supabase Auth** (email/password + Google OIDC). Scheduling is driven by **pg_cron + pg_net** inside Supabase, which calls `/api/cron/tick` on the deployed Netlify site.

Schema (tables): `User` → `Organization` ↔ `OrganizationMember` → `Project` → `ProjectSettings`, `ConnectedAccount`, `Draft`, `Post`. The `User` table is kept in sync with `auth.users` by a database trigger.

---

## Tech stack

- **Framework:** Next.js 16 (App Router) with TypeScript and Tailwind v4 (Turbopack builds)
- **UI:** shadcn/ui (New York style), Sonner for toasts, Lucide for icons
- **Auth:** Supabase Auth (email/password + Google OIDC), cookie-bound sessions via `@supabase/ssr`
- **Database:** Supabase Postgres, accessed via `@supabase/supabase-js` with a generated `Database` type; RLS for multi-tenant isolation; versioned SQL migrations under `supabase/migrations/`
- **AI:** Anthropic SDK → `claude-opus-4-7` (adaptive thinking + prompt caching)
- **News sources:** `rss-parser` + NewsAPI `/v2/everything`
- **Encryption:** Web Crypto AES-256-GCM (cross-runtime) for storing LinkedIn OAuth and Telegram bot tokens
- **Scheduling:** Supabase `pg_cron` + `pg_net` → `/api/cron/tick`
- **Hosting:** Netlify (official `@netlify/plugin-nextjs` runtime) + Supabase Cloud

---

## Prerequisites

You'll need accounts/keys for the services below. For a minimal local run you only need the first three.

| # | Service | Why | Required? |
|---|---|---|---|
| 1 | **Supabase project** | Postgres + Auth | **Yes** — free tier at [supabase.com](https://supabase.com) |
| 2 | **Node 22+** + **pnpm 10+** | Runtime | **Yes** |
| 3 | **Anthropic API key** | Post generation + moderation | **Yes** for generation |
| 4 | **Telegram bot** via [@BotFather](https://t.me/BotFather) | Telegram publishing | Only to publish to Telegram |
| 5 | **LinkedIn Developer app** | LinkedIn publishing | Only to publish to LinkedIn |
| 6 | **Google OAuth client** | "Sign in with Google" button | Optional (configured in Supabase) |
| 7 | **NewsAPI key** | Cleaner custom-topic search | Optional — Google News RSS is used when unset |

---

## Quick start (local)

```bash
# 1. Install
pnpm install

# 2. Install the Supabase CLI (one-time): https://supabase.com/docs/guides/cli
#    Then either link a cloud project or run a local stack:
supabase login
supabase link --project-ref <your-project-ref>
#    (or `supabase start` for a fully local Postgres + Auth stack)

# 3. Copy env template
cp .env.example .env.local

# 4. Fill in the minimum required values in .env.local:
#    NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
#    NEXT_PUBLIC_SUPABASE_ANON_KEY=...
#    SUPABASE_SERVICE_ROLE_KEY=...
#    DIRECT_URL=postgresql://...:5432/postgres        # for migrations
#    ENCRYPTION_KEY=$(openssl rand -base64 48)
#    AUTH_SECRET=$(openssl rand -base64 32)
#    CRON_SECRET=$(openssl rand -base64 32)
#    ANTHROPIC_API_KEY=sk-ant-...

# 5. Apply the schema to your Supabase database
supabase db push      # applies supabase/migrations/* over DIRECT_URL

# 6. Start the dev server
pnpm dev

# 7. Open http://localhost:3000 → sign up → you're in.
```

The first run auto-creates your workspace, a default project, and drops you at `/dashboard`. The onboarding card walks you through setting topics, connecting an account, and generating your first post.

---

## Environment variables

Full reference. See `.env.example` for defaults.

### Required

| Name | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (browser-safe) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/publishable key (browser-safe) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key — server-only, bypasses RLS. **Never** expose to the browser. |
| `ENCRYPTION_KEY` | AES-256-GCM key for storing OAuth/bot tokens. Generate: `openssl rand -base64 48` |
| `AUTH_SECRET` | HMAC key for LinkedIn OAuth signed-state (CSRF). Generate: `openssl rand -base64 32` |
| `CRON_SECRET` | Bearer token that `/api/cron/tick` requires; the Supabase pg_cron job sends it |
| `ANTHROPIC_API_KEY` | For post generation + moderation ([console.anthropic.com](https://console.anthropic.com)) |

### Migrations / tooling only

| Name | Purpose |
|---|---|
| `DATABASE_URL` | Pooled Postgres URL (PgBouncer, port 6543) for the `supabase` CLI / transient connections |
| `DIRECT_URL` | Direct Postgres URL (port 5432) — required for `supabase db push` / migrations |

The running app never reads these; it talks to Postgres through supabase-js.

### Optional — expands capabilities

| Name | Needed for |
|---|---|
| `AUTH_URL` | Fallback public origin when forwarded headers are absent (local/edge); used to build absolute OAuth redirect URIs |
| `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` | LinkedIn OAuth + publishing |
| `NEWSAPI_KEY` | Cleaner search for custom topics (Google News RSS is the keyless fallback) |
| `TELEGRAM_BOT_TOKEN` | Reserved for future use (per-project bots take precedence today) |

> **Google sign-in** is handled by Supabase Auth. Configure the Google OAuth client in the Supabase dashboard (Authentication → Providers → Google) — there is no `GOOGLE_CLIENT_ID`/`SECRET` in the app env.

---

## Feature walkthrough

### Sign up and project setup

- Email/password or "Continue with Google".
- On first sign-in you're given a workspace and one empty project. The dashboard's onboarding card walks you through the three remaining steps.

### Projects

A project is a unit with its own topics, voice, schedule, connections, and post history. Use the dropdown in the header to create, switch, rename, or delete projects. Typical use cases:

- Personal profile + company page separately
- One project per client (agency use case)
- One for English content, one for Russian content with different voice

### Topics

- **Templates:** Tech, AI / ML, Development, Web2 / SaaS, Web3 / Crypto, Startups, Design / UX, Security, DevOps / Cloud, Productivity — each backed by curated RSS feeds.
- **Custom:** free-text keywords (e.g. *indie hacking*, *edge computing*). These are keyword-searched via NewsAPI when `NEWSAPI_KEY` is set, otherwise via Google News RSS (no key needed). Articles from low-trust sources are cross-checked against other outlets before they can auto-publish (see *Fact-checking* below).

### Connections

Set up per-project in Settings.

**Telegram** — Create a bot with [@BotFather](https://t.me/BotFather), add it as an admin in your channel, paste the token + channel ID. A test message is sent on connect to verify. Tokens are encrypted at rest.

**LinkedIn** — Click "Connect LinkedIn" → OAuth flow → your member URN and access token are stored. Tokens last 60 days; a 14-day expiry banner with a one-click reconnect link appears on the dashboard.

### Voice

Choose a preset (Professional / Casual / Technical / Provocative) or provide custom instructions describing the voice exactly — the text becomes part of the Claude system prompt (cached for efficiency).

### Schedule

- Interval: daily / every 2 / 3 / 7 / 14 days
- Preferred hour: 0–23
- Timezone: any IANA zone (e.g. `Europe/Moscow`, `America/New_York`)
- Dashboard shows the next run in relative and absolute form

### Publishing modes

- **Autopilot** — every scheduled tick generates + publishes automatically. Failures surface in the Failed-posts inspector with retry.
- **Manual approval** — each tick creates a Draft. Review per-language text, edit, approve to publish or skip.

### Safety

- **Banned words / phrases** — comma-separated. Single tokens use whole-word match; multi-word phrases match as substrings. Any match blocks the post.
- **AI moderation** — toggle to run each post through Claude for hate-speech / illegal / incitement checks before publish. Fails open on transient errors so a Claude blip doesn't stop all posts.

### Analytics

- 7-day / 30-day / lifetime published counts + success rate
- 30-day daily activity stacked-bar chart (inline SVG, no chart lib)
- Per-platform (LinkedIn / Telegram) success breakdown
- Top 8 topics by published count

---

## How the pipeline works

Every post goes through the same pipeline, whether triggered manually ("Generate now") or on schedule:

```
 ┌──────────────┐     ┌────────────┐     ┌────────────┐     ┌───────────┐
 │ Pick topic   │ ──▶ │ Fetch news │ ──▶ │ Claude     │ ──▶ │ Moderation│
 │ (settings)   │     │ (RSS +     │     │ writes     │     │ gate      │
 │              │     │  NewsAPI)  │     │ post       │     │           │
 └──────────────┘     └────────────┘     └────────────┘     └─────┬─────┘
                                                                   │
                                         ┌─────────────────────────┴──────────┐
                                         │                                    │
                                  manual mode                           autopilot
                                         │                                    │
                                         ▼                                    ▼
                                ┌────────────────┐               ┌──────────────────────┐
                                │ Draft → /drafts│ ── approve ──▶│ Publish to LinkedIn  │
                                │ (edit, queue)  │               │ and/or Telegram      │
                                └────────────────┘               └──────────────────────┘
                                                                           │
                                                                           ▼
                                                                 ┌──────────────────┐
                                                                 │ Post row with    │
                                                                 │ external URL /   │
                                                                 │ error, shown on  │
                                                                 │ Analytics + Feed │
                                                                 └──────────────────┘
```

Key implementation details:

- **Dedup** — `pickFreshArticle` skips articles whose URL or title matches any of the last 200 posts for that project. No spam repeats.
- **Fact-checking** — every source gets a trust score (`source-trust.ts`): curated feed and major-outlet domains are high-trust; arbitrary domains (e.g. Google News search hits) are low-trust. A high-trust story ships as-is. A low-trust story is cross-checked — its headline keywords are searched across other publishers (`fact-check.ts`), and it's marked **corroborated** only if independent reputable outlets report the same story. Corroborated stories are written with attribution ("according to reports"); **unverified** stories (low-trust + uncorroborated) are written cautiously, have their confidence capped, and never auto-publish — they always wait for a human.
- **System-prompt caching** — the per-project system prompt (style + rules + languages + topics) is cached with `cache_control: {type: "ephemeral"}` so repeat generations on the same project are cheap.
- **Schedule evaluation** — `computeScheduleInfo(projectId)` uses `Intl.DateTimeFormat` to compute the next-run time in the project's timezone. The cron endpoint only triggers projects whose next-run has actually arrived in *their* timezone, not globally.
- **Parallel-language output** — Claude is asked to produce JSON with one entry per language. The first available language (English preferred, else first entry) is used per platform.

---

## Deployment — Supabase + Netlify

The app runs on **Supabase Cloud** (Postgres + Auth + scheduling) fronted by **Netlify** (Next.js runtime).

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Apply the schema: `supabase link --project-ref <ref>` then `supabase db push` (runs every file in `supabase/migrations/` over the direct connection). This also installs RLS policies and the `auth.users` → `User` sync trigger.
3. **Auth providers** — enable Email and (optionally) Google under Authentication → Providers. For Google, paste your Google OAuth client ID/secret into Supabase and register `https://<ref>.supabase.co/auth/v1/callback` as the Google redirect URI.
4. **Redirect URLs** — under Authentication → URL Configuration add your Netlify site URL (and `http://localhost:3000` for local dev) to the allow-list.
5. **Scheduling (pg_cron + pg_net)** — enable the `pg_cron` and `pg_net` extensions, then schedule a job that `POST`s to `https://YOUR-SITE.netlify.app/api/cron/tick` with header `Authorization: Bearer <CRON_SECRET>`. Store `CRON_SECRET` as a Supabase secret/vault entry the job reads (see `supabase/migrations/` for the scheduling migration).

### 2. Netlify

1. Push this repo to GitHub and import it into [netlify.com](https://app.netlify.com).
2. The official `@netlify/plugin-nextjs` runtime is auto-detected from `netlify.toml` — the build is a plain `next build`, no extra config.
3. **Environment variables** — add everything from the *Required* section (Supabase URL/anon/service-role, `ENCRYPTION_KEY`, `AUTH_SECRET`, `CRON_SECRET`, `ANTHROPIC_API_KEY`) plus any optional ones (`LINKEDIN_*`, `NEWSAPI_KEY`, `TELEGRAM_BOT_TOKEN`). `DATABASE_URL`/`DIRECT_URL` are only needed for CLI migrations, not the running site.
4. **OAuth callback URLs** — set the LinkedIn redirect URI to `https://YOUR-SITE.netlify.app/api/linkedin/callback`. Google's callback is owned by Supabase (step 1.3), not Netlify.
5. Deploy.

**Healthcheck:** `GET /api/health` returns `{ok: true, ts: ...}` when Supabase is reachable (a `head` count against `Project`). Use it as a readiness probe.

---

## Working with the database

All schema changes are versioned SQL under `supabase/migrations/`. There is no ORM — the app uses supabase-js against a hand-maintained generated `Database` type in `src/lib/database.types.ts`.

### Apply pending migrations

```bash
supabase db push              # applies any unapplied migrations over DIRECT_URL
```

### Create a new migration

```bash
supabase migration new add_retry_count
# edit the generated supabase/migrations/<ts>_add_retry_count.sql
# then regenerate the TypeScript types:
supabase gen types typescript --linked > src/lib/database.types.ts
# Commit both the SQL file and the updated types.
```

### Inspect the DB

```bash
supabase db studio            # opens the Supabase Studio DB GUI
```

### Current schema at a glance

- `User` — mirrors `auth.users` (kept in sync by a DB trigger)
- `Organization` + `OrganizationMember` — multi-tenancy
- `Project` + `ProjectSettings` — per-project configuration (topics, voice, schedule, mode, safety, languages)
- `ConnectedAccount` — LinkedIn + Telegram tokens (AES-encrypted at rest)
- `Draft` — AI-generated posts before they go live (pending / published / failed / skipped)
- `Post` — actual published records with external URL and/or failure reason

RLS policies scope every table to the caller's organization; the service-role key bypasses RLS for trusted server-side work (cron, publishing).

---

## Project structure

```
src/
├── app/
│   ├── (auth)/                 # sign-in, sign-up (public)
│   ├── (app)/                  # authenticated area:
│   │   ├── dashboard/          #   next-run + onboarding + expiry banner
│   │   ├── drafts/             #   pending + failed drafts, approve/retry
│   │   ├── analytics/          #   30-day metrics + sparkline
│   │   ├── settings/           #   6 tabs: General/Topics/Voice/Schedule/Mode/Safety
│   │   └── layout.tsx          #   header, project switcher, sign-out
│   ├── auth/callback/          # Supabase OAuth code exchange
│   ├── api/
│   │   ├── linkedin/{authorize,callback}/
│   │   ├── cron/tick/          #   scheduled pipeline entry
│   │   └── health/             #   DB liveness
│   └── page.tsx                # landing
│
├── components/
│   ├── ui/                     # shadcn primitives (button, card, dialog, ...)
│   ├── forms/                  # app-specific forms (settings, drafts, connections, switcher)
│   ├── onboarding-card.tsx
│   ├── expiry-banner.tsx
│   └── analytics-sparkline.tsx
│
├── lib/
│   ├── supabase/               # supabase-js clients + helpers
│   │   ├── browser.ts          #   browser (anon) client
│   │   ├── server.ts           #   cookie-bound server client (@supabase/ssr)
│   │   ├── service.ts          #   service-role client (bypasses RLS)
│   │   ├── middleware.ts       #   session refresh for the proxy
│   │   └── queries.ts          #   shared typed query helpers
│   ├── database.types.ts       # generated Database type (source of truth for tables)
│   ├── crypto.ts               # cross-runtime AES-256-GCM token storage
│   ├── schedule.ts             # timezone-aware next-run computation
│   ├── claude.ts               # post generator (cached system prompt)
│   ├── moderation.ts           # banned words + optional AI moderation
│   ├── news.ts                 # RSS + NewsAPI/Google News picker + corroboration
│   ├── news-feeds.ts           # topic → RSS URLs mapping
│   ├── newsapi.ts              # NewsAPI /v2/everything client
│   ├── news-types.ts           # shared NewsItem / FactCheck types
│   ├── source-trust.ts         # per-domain trust scoring
│   ├── fact-check.ts           # cross-source corroboration of low-trust stories
│   ├── telegram.ts             # Bot API client
│   ├── linkedin.ts             # OAuth + posts API + signed-state helper
│   ├── topic-templates.ts      # canonical topics, styles, languages, intervals
│   └── utils.ts                # cn()
│
├── server/
│   ├── auth-actions.ts         # sign-up, sign-in (Supabase Auth)
│   ├── oauth-actions.ts        # Google sign-in, sign-out (Supabase Auth)
│   ├── project.ts              # getCurrentUser, getCurrentProject
│   ├── project-actions.ts      # create/rename/switch/delete
│   ├── settings-actions.ts     # saveSettings, toggleProjectStatus
│   ├── connection-actions.ts   # connectTelegram, disconnectAccount
│   ├── draft-actions.ts        # approve/skip/retry/runNow
│   ├── publish.ts              # publishDraft (Telegram + LinkedIn) with moderation gate
│   ├── pipeline.ts             # runPipelineForProject, runPipelineForAllDue
│   └── analytics.ts            # getAnalytics
│
├── proxy.ts                    # route protection (Next.js 16 proxy)
└── types/                      # shared type augmentations

supabase/
└── migrations/                 # versioned SQL migrations (schema, RLS, triggers, pg_cron)

netlify.toml                    # Netlify build + Next.js runtime config
.env.example
```

---

## Scripts reference

```bash
pnpm dev                        # Next.js dev server with Turbopack
pnpm build                      # production build (next build)
pnpm start                      # run the production server
pnpm lint                       # ESLint

# Database (Supabase CLI — install separately):
supabase db push                # apply pending migrations over DIRECT_URL
supabase migration new <name>   # scaffold a new SQL migration
supabase gen types typescript --linked > src/lib/database.types.ts
supabase db studio              # DB GUI
```

---

## Troubleshooting

**Q: Landing page loads but sign-up fails with 500.**
Check that `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are set and that migrations have been applied (`supabase db push`). Also confirm `ENCRYPTION_KEY` and `AUTH_SECRET` are set — empty values cause cryptic crashes.

**Q: "Couldn't post to chat" when connecting Telegram.**
The bot must be added to the channel **as an admin** with the "Post Messages" permission. The channel ID should be `@username` for public channels or the numeric `-100xxxxxxxxxx` for private ones (get it from [@userinfobot](https://t.me/userinfobot) or [@getidsbot](https://t.me/getidsbot)).

**Q: LinkedIn callback errors with "invalid_redirect_uri".**
Your LinkedIn Developer app must have the exact redirect URI `{AUTH_URL}/api/linkedin/callback` registered. Mismatches (trailing slash, http vs https, wrong host) fail.

**Q: Google sign-in bounces back with an error.**
Google sign-in runs through Supabase Auth. Confirm the Google provider is enabled in the Supabase dashboard, that `https://<ref>.supabase.co/auth/v1/callback` is a registered Google redirect URI, and that your site origin is in Supabase's Authentication → URL Configuration allow-list.

**Q: LinkedIn connection expired after 60 days.**
That's LinkedIn's policy, not a bug. The dashboard shows a 14-day warning banner. Click "Reconnect LinkedIn" and re-authorize — the existing connection's token is updated in place.

**Q: Custom topic generates posts about the wrong subject.**
Custom topics are keyword-searched via Google News RSS by default (no key needed). For cleaner, better-attributed results set `NEWSAPI_KEY` (free tier at [newsapi.org](https://newsapi.org)) and the agent will prefer NewsAPI. Note NewsAPI's free tier delays articles ~24h and forbids production use.

**Q: A post is stuck "pending review" even in autopilot.**
If the story came from a low-trust source and couldn't be corroborated by other outlets, it's flagged *unverified* — it never auto-publishes regardless of mode, and its confidence is capped so a human reviews it first. Either approve it manually or rely on better-trusted sources.

**Q: Cron isn't firing.**
- Scheduling runs from Supabase `pg_cron` + `pg_net`, which `POST`s to `/api/cron/tick`. Check the `cron.job` / `cron.job_run_details` tables in Supabase, and confirm the job sends `Authorization: Bearer <CRON_SECRET>` matching the site's `CRON_SECRET`.
- Manual trigger: `curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://YOUR-SITE.netlify.app/api/cron/tick`

**Q: Got a "relation ... does not exist" / RLS error.**
Migrations haven't run or RLS is blocking the query. Run `supabase db push`, and for trusted server-side reads make sure the code path uses the service-role client (`src/lib/supabase/service.ts`), which bypasses RLS.

**Q: Moderation keeps blocking posts.**
Review the reason shown in the Failed section of `/drafts`. If AI moderation is over-triggering for your niche, turn it off and rely on banned words instead. The AI moderator only blocks hate speech, illegal content, direct incitement, and explicit material — opinionated/provocative content is allowed.

---

## Roadmap

Shipped (Phases 1–10):

- [x] Auth + multi-tenant schema + multi-project UI
- [x] Telegram + LinkedIn end-to-end publishing
- [x] RSS + NewsAPI hybrid news sourcing with dedup
- [x] Claude generator with prompt caching + adaptive thinking
- [x] Manual approval flow + autopilot + failed-post retry
- [x] Timezone-aware scheduling + cron endpoint + onboarding
- [x] Expiry warning banner + reconnect flow
- [x] Safety gate (banned words + AI moderation)
- [x] Analytics page (sparkline, platforms, topics, success rate)
- [x] Re-platform onto Supabase Cloud (Postgres + Auth + RLS) and Netlify

Planned:

- [ ] LinkedIn refresh-token flow (for apps that have the grant)
- [ ] Email reminders for expiring tokens (Resend integration)
- [ ] Stripe billing + plan-based limits (FREE / PRO / TEAM)
- [ ] External API (per-org keys for Zapier / n8n / scripts)
- [ ] Content safety rules extensibility (blocklist regexes, allowlist domains)
