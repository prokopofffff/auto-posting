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
9. [Deployment — Vercel](#deployment--vercel)
10. [Deployment — self-hosted (Docker)](#deployment--self-hosted-docker)
11. [Working with the database](#working-with-the-database)
12. [Project structure](#project-structure)
13. [Scripts reference](#scripts-reference)
14. [Troubleshooting](#troubleshooting)
15. [Roadmap](#roadmap)

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
- **Two deployment paths.** One-click to Vercel *or* `docker compose up` on your own server.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                           Next.js app                            │
│                                                                  │
│  Landing ─ Auth ─ Dashboard ─ Drafts ─ Analytics ─ Settings      │
│                                                                  │
│  API routes:                                                     │
│   • /api/auth/[...]         Auth.js (email/password + Google)    │
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
  │  Postgres   │      │  Claude     │       │  External   │
  │  (Prisma)   │      │  Opus 4.7   │       │  sources    │
  │             │      │             │       │             │
  │ multi-tenant│      │ - generator │       │ - RSS feeds │
  │ schema      │      │ - moderator │       │ - NewsAPI   │
  │ encrypted   │      │             │       │ - LinkedIn  │
  │ OAuth tokens│      │             │       │ - Telegram  │
  └─────────────┘      └─────────────┘       └─────────────┘
```

Schema (tables): `User` → `Organization` ↔ `OrganizationMember` → `Project` → `ProjectSettings`, `ConnectedAccount`, `Draft`, `Post`. Auth.js-standard `Account` / `Session` / `VerificationToken` are also present for provider flexibility.

---

## Tech stack

- **Framework:** Next.js 16 (App Router) with TypeScript and Tailwind v4 (Turbopack builds)
- **UI:** shadcn/ui (New York style), Sonner for toasts, Lucide for icons
- **Auth:** Auth.js v5 (`next-auth@beta`) — JWT sessions, Credentials + Google providers, Prisma adapter
- **Database:** PostgreSQL with Prisma 6 (versioned migrations)
- **AI:** Anthropic SDK → `claude-opus-4-7` (adaptive thinking + prompt caching)
- **News sources:** `rss-parser` + NewsAPI `/v2/everything`
- **Encryption:** Node `crypto` AES-256-GCM for storing LinkedIn OAuth and Telegram bot tokens
- **Runtime:** Node 24 (Alpine in Docker)

---

## Prerequisites

You'll need accounts/keys for the services below. For a minimal local run you only need the first three.

| # | Service | Why | Required? |
|---|---|---|---|
| 1 | **Postgres** | App data | **Yes** — use [Neon](https://neon.tech) (free) or Docker |
| 2 | **Node 24+** + **npm 10+** | Runtime | **Yes** |
| 3 | **Anthropic API key** | Post generation + moderation | **Yes** for generation |
| 4 | **Telegram bot** via [@BotFather](https://t.me/BotFather) | Telegram publishing | Only to publish to Telegram |
| 5 | **LinkedIn Developer app** | LinkedIn publishing | Only to publish to LinkedIn |
| 6 | **Google OAuth client** | "Sign in with Google" button | Optional |
| 7 | **NewsAPI key** | Custom-topic news search | Only if you use custom topics |

---

## Quick start (local)

```bash
# 1. Install
npm install

# 2. Postgres — either use Neon, Supabase, or local Docker
docker run -d --name am-db -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:17-alpine

# 3. Copy env template
cp .env.example .env

# 4. Fill in the minimum required values in .env:
#    DATABASE_URL=postgresql://postgres:dev@localhost:5432/postgres
#    AUTH_SECRET=$(openssl rand -base64 32)
#    ENCRYPTION_KEY=$(openssl rand -base64 48)
#    CRON_SECRET=$(openssl rand -base64 32)
#    ANTHROPIC_API_KEY=sk-ant-...

# 5. Apply schema
npx prisma generate
npm run db:migrate:deploy

# 6. Start the dev server
npm run dev

# 7. Open http://localhost:3000 → sign up → you're in.
```

The first run auto-creates your workspace, a default project, and drops you at `/dashboard`. The onboarding card walks you through setting topics, connecting an account, and generating your first post.

---

## Environment variables

Full reference. See `.env.example` for defaults.

### Required

| Name | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string (`postgresql://user:pass@host:5432/db`) |
| `AUTH_SECRET` | Auth.js JWT signing key. Generate: `openssl rand -base64 32` |
| `ENCRYPTION_KEY` | AES-256-GCM key for storing OAuth/bot tokens. Generate: `openssl rand -base64 48` |
| `AUTH_URL` | Public URL of the app. Local: `http://localhost:3000`. Prod: your domain. |
| `CRON_SECRET` | Bearer token the cron sidecar / Vercel Cron uses to hit `/api/cron/tick` |
| `ANTHROPIC_API_KEY` | For post generation + moderation ([console.anthropic.com](https://console.anthropic.com)) |

### Optional — expands capabilities

| Name | Needed for |
|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | "Continue with Google" sign-in button |
| `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` | LinkedIn OAuth + publishing |
| `NEWSAPI_KEY` | News search for custom (non-template) topics |
| `TELEGRAM_BOT_TOKEN` | Reserved for future use (per-project bots take precedence today) |

### Deployment-specific

| Name | Needed for |
|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Docker Compose Postgres service (defaults exist) |
| `PORT` | Docker Compose host port mapping (default 3000) |
| `CRON_INTERVAL` | Docker cron sidecar ping frequency in seconds (default 3600 = 1h) |

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
- **Custom:** free-text keywords (e.g. *indie hacking*, *edge computing*). These are sourced via NewsAPI — set `NEWSAPI_KEY` or they silently produce nothing.

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
- **System-prompt caching** — the per-project system prompt (style + rules + languages + topics) is cached with `cache_control: {type: "ephemeral"}` so repeat generations on the same project are cheap.
- **Schedule evaluation** — `computeScheduleInfo(projectId)` uses `Intl.DateTimeFormat` to compute the next-run time in the project's timezone. The cron endpoint only triggers projects whose next-run has actually arrived in *their* timezone, not globally.
- **Parallel-language output** — Claude is asked to produce JSON with one entry per language. The first available language (English preferred, else first entry) is used per platform.

---

## Deployment — Vercel

Fastest path, recommended for MVP.

1. Push this repo to GitHub.
2. Import into [vercel.com](https://vercel.com).
3. **Environment variables** — add everything from the Required section above plus any optional ones you want. Skip Docker-specific ones.
4. **Database** — provision Postgres on [Neon](https://neon.tech) (free tier) or the Vercel Marketplace, set `DATABASE_URL`.
5. **OAuth callback URLs** — set to your Vercel domain:
   - Google: `https://YOUR-APP.vercel.app/api/auth/callback/google`
   - LinkedIn: `https://YOUR-APP.vercel.app/api/linkedin/callback`
6. Deploy. Vercel reads `vercel.json` and automatically wires `/api/cron/tick` as an hourly cron job.

Vercel's first deploy runs `npm run build` which includes `.next/standalone`. No special config needed.

---

## Deployment — self-hosted (Docker)

For when you want full control, multiple instances, or to avoid Vercel limits.

Ships three containers:

| Service | Image | Role |
|---|---|---|
| `app` | built from `Dockerfile` | Next.js standalone server |
| `db` | `postgres:17-alpine` | Database with persistent volume |
| `cron` | `alpine:3.20` | Curls `/api/cron/tick` every `CRON_INTERVAL` seconds (replaces Vercel Cron) |

```bash
# 1. Set env variables
cp .env.example .env
# Fill at minimum: AUTH_SECRET, ENCRYPTION_KEY, CRON_SECRET,
# ANTHROPIC_API_KEY, POSTGRES_PASSWORD.
# Generate secrets:
#   openssl rand -base64 32   → AUTH_SECRET, CRON_SECRET
#   openssl rand -base64 48   → ENCRYPTION_KEY

# 2. Build and start
docker compose up -d --build

# 3. Watch logs
docker compose logs -f app

# 4. Stop
docker compose down

# 5. Full reset (wipes DB)
docker compose down -v
```

**Reverse proxy + TLS:** put Caddy or nginx in front of the `app` service on port 3000, set `AUTH_URL=https://your-domain.com` in `.env`, restart the `app` container. Update LinkedIn and Google OAuth callbacks to the new domain.

**Healthcheck:** `GET /api/health` returns `{ok: true, ts: ...}` when Postgres is reachable. The Docker HEALTHCHECK uses this; your orchestrator can use it as a readiness probe.

**Migrations on boot:** `docker/entrypoint.sh` runs `prisma migrate deploy` before starting the server. The schema is brought up to date idempotently every time the app container starts.

---

## Working with the database

### Apply pending migrations

```bash
npm run db:migrate:deploy      # production-safe, applies any unapplied migrations
```

### Create a new migration (dev)

After editing `prisma/schema.prisma`:

```bash
npm run db:migrate -- --name add_retry_count
# creates prisma/migrations/<ts>_add_retry_count/ with SQL
# Commit the new folder to git.
```

### Inspect the DB

```bash
npm run db:studio              # opens Prisma Studio (GUI)
```

### Current schema at a glance

- `User` / `Account` / `Session` / `VerificationToken` — Auth.js standard tables
- `Organization` + `OrganizationMember` — multi-tenancy
- `Project` + `ProjectSettings` — per-project configuration (topics, voice, schedule, mode, safety, languages)
- `ConnectedAccount` — LinkedIn + Telegram tokens (AES-encrypted at rest)
- `Draft` — AI-generated posts before they go live (pending / published / failed / skipped)
- `Post` — actual published records with external URL and/or failure reason

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
│   ├── api/
│   │   ├── auth/[...nextauth]/ #   Auth.js catch-all
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
│   ├── db.ts                   # Prisma client
│   ├── crypto.ts               # AES-256-GCM wrappers for token storage
│   ├── schedule.ts             # timezone-aware next-run computation
│   ├── claude.ts               # post generator (cached system prompt)
│   ├── moderation.ts           # banned words + optional AI moderation
│   ├── news.ts                 # RSS + NewsAPI hybrid picker
│   ├── news-feeds.ts           # topic → RSS URLs mapping
│   ├── newsapi.ts              # NewsAPI /v2/everything client
│   ├── news-types.ts           # shared NewsItem type
│   ├── telegram.ts             # Bot API client
│   ├── linkedin.ts             # OAuth + posts API + signed-state helper
│   ├── topic-templates.ts      # canonical topics, styles, languages, intervals
│   └── utils.ts                # cn()
│
├── server/
│   ├── auth-actions.ts         # sign-up, sign-in
│   ├── oauth-actions.ts        # Google sign-in, sign-out
│   ├── project.ts              # getCurrentUser, getCurrentProject
│   ├── project-actions.ts      # create/rename/switch/delete
│   ├── settings-actions.ts     # saveSettings, toggleProjectStatus
│   ├── connection-actions.ts   # connectTelegram, disconnectAccount
│   ├── draft-actions.ts        # approve/skip/retry/runNow
│   ├── publish.ts              # publishDraft (Telegram + LinkedIn) with moderation gate
│   ├── pipeline.ts             # runPipelineForProject, runPipelineForAllDue
│   └── analytics.ts            # getAnalytics
│
├── auth.ts                     # Auth.js config (Credentials + Google + Prisma adapter)
├── auth-handlers.ts            # exports GET/POST for the route file
├── proxy.ts                    # route protection (Next.js 16 proxy)
└── types/next-auth.d.ts        # Session type augmentation

prisma/
├── schema.prisma
└── migrations/                 # versioned SQL migrations

docker/
└── entrypoint.sh               # prisma migrate deploy → node server.js

Dockerfile
docker-compose.yml
vercel.json
.env.example
```

---

## Scripts reference

```bash
npm run dev                     # Next.js dev server with Turbopack
npm run build                   # production build (outputs .next/standalone for Docker)
npm start                       # run the production server
npm run lint                    # ESLint

npm run db:migrate              # prisma migrate dev — creates new migration from schema changes
npm run db:migrate:deploy       # prisma migrate deploy — applies pending migrations (prod safe)
npm run db:studio               # prisma studio — DB GUI at http://localhost:5555
```

---

## Troubleshooting

**Q: Landing page loads but sign-up fails with 500.**
Check `DATABASE_URL` is reachable and migrations have been applied (`npm run db:migrate:deploy`). Also confirm `AUTH_SECRET` and `ENCRYPTION_KEY` are set — empty values cause cryptic crashes.

**Q: "Couldn't post to chat" when connecting Telegram.**
The bot must be added to the channel **as an admin** with the "Post Messages" permission. The channel ID should be `@username` for public channels or the numeric `-100xxxxxxxxxx` for private ones (get it from [@userinfobot](https://t.me/userinfobot) or [@getidsbot](https://t.me/getidsbot)).

**Q: LinkedIn callback errors with "invalid_redirect_uri".**
Your LinkedIn Developer app must have the exact redirect URI `{AUTH_URL}/api/linkedin/callback` registered. Mismatches (trailing slash, http vs https, wrong host) fail.

**Q: LinkedIn connection expired after 60 days.**
That's LinkedIn's policy, not a bug. The dashboard shows a 14-day warning banner. Click "Reconnect LinkedIn" and re-authorize — the existing connection's token is updated in place.

**Q: Custom topic generates posts about the wrong subject.**
Custom topics use NewsAPI. If `NEWSAPI_KEY` isn't set, there's no news source for custom topics and the agent falls back to generic tech feeds. Set the key (free tier at [newsapi.org](https://newsapi.org)) and add the topic again.

**Q: Cron isn't firing.**
- **Vercel:** check Project Settings → Cron Jobs. Ensure `CRON_SECRET` is set.
- **Docker:** `docker compose logs cron` — the sidecar logs each tick.
- Manual trigger: `curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/tick`

**Q: Got a Prisma error on boot — "The table ... does not exist".**
Migrations haven't run. Locally: `npm run db:migrate:deploy`. In Docker: the entrypoint should handle it automatically — check `docker compose logs app` for the migrate step output.

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
- [x] Vercel + Docker deployment paths
- [x] Versioned Prisma migrations
- [x] Expiry warning banner + reconnect flow
- [x] Safety gate (banned words + AI moderation)
- [x] Analytics page (sparkline, platforms, topics, success rate)

Planned:

- [ ] LinkedIn refresh-token flow (for apps that have the grant)
- [ ] Email reminders for expiring tokens (Resend integration)
- [ ] Stripe billing + plan-based limits (FREE / PRO / TEAM)
- [ ] External API (per-org keys for Zapier / n8n / scripts)
- [ ] Content safety rules extensibility (blocklist regexes, allowlist domains)
