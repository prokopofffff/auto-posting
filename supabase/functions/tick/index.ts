// Supabase Edge Function `tick` — the scheduled content worker.
//
// Replaces the old Netlify /api/cron/tick route (src/app/api/cron/tick/route.ts):
// pg_cron + pg_net invoke THIS function on a schedule (see madrid-9i8.11), so the
// pipeline no longer round-trips back into the Next app. It runs entirely on the
// Deno Edge runtime against the database via supabase-js (service role).
//
// Auth: callers must present the CRON_SECRET as `Authorization: Bearer <secret>`
// or `?secret=<secret>`.
//
// ── HUMAN FOLLOW-UPS (need live infra; cannot be done in this sandbox) ───────
//  1. Deploy:   supabase functions deploy tick --no-verify-jwt
//     (--no-verify-jwt because we gate on CRON_SECRET ourselves, not a user JWT.)
//  2. Secrets:  supabase secrets set CRON_SECRET=... ANTHROPIC_API_KEY=... \
//                 ENCRYPTION_KEY=... LINKEDIN_CLIENT_ID=... \
//                 LINKEDIN_CLIENT_SECRET=... [NEWSAPI_KEY=...]
//     ENCRYPTION_KEY must be byte-identical to the app's so stored tokens decrypt.
//     SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected by the platform.
//     NOTE: TELEGRAM_BOT_TOKEN is NOT read here — the Telegram token is stored
//     per-ConnectedAccount (encrypted) and decrypted at publish time, matching
//     the app. Only set it if a future code path needs a global bot token.
//  3. Schedule (this is madrid-9i8.11): from SQL enable pg_cron + pg_net and
//     schedule an http_post to <project>.functions.supabase.co/tick carrying the
//     `Authorization: Bearer <CRON_SECRET>` header on the desired cadence.
// ─────────────────────────────────────────────────────────────────────────────
import { publishDueScheduledDrafts, runPipelineForAllDue } from "./lib/pipeline.ts";

function isAuthorized(req: Request): boolean {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  const q = new URL(req.url).searchParams.get("secret");
  return q === secret;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (!isAuthorized(req)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  const started = Date.now();
  try {
    // Same fan-out as the old route: run all due projects and flush any drafts
    // whose scheduledAt has passed, concurrently.
    const [pipeline, scheduled] = await Promise.all([
      runPipelineForAllDue(),
      publishDueScheduledDrafts(),
    ]);
    return json({
      ok: true,
      ...pipeline,
      scheduledPublished: scheduled.published,
      scheduledErrors: scheduled.errors,
      ms: Date.now() - started,
    });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
