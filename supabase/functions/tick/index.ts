// Supabase Edge Function `tick` — the single Claude/generation runtime.
//
// pg_cron + pg_net invoke this on a schedule (the default `tick` action). The
// Next app ALSO calls this function over HTTP for every Claude-backed action
// ("Generate now", ad-hoc compose, the model picker, moderation) via
// src/server/edge.ts — so generation logic and per-project credential handling
// live here once, not duplicated in the Node runtime.
//
// Auth: callers present CRON_SECRET as `Authorization: Bearer <secret>` or
// `?secret=<secret>`. The Next app holds CRON_SECRET server-side and calls
// these actions only AFTER verifying the signed-in user owns the project, so
// per-project credential isolation is enforced before the request ever arrives.
//
// ── HUMAN FOLLOW-UPS (need live infra) ───────────────────────────────────────
//  1. Deploy:   supabase functions deploy tick --no-verify-jwt
//  2. Secrets:  supabase secrets set CRON_SECRET=... ENCRYPTION_KEY=... \
//                 LINKEDIN_CLIENT_ID=... LINKEDIN_CLIENT_SECRET=... [NEWSAPI_KEY=...]
//     ENCRYPTION_KEY must be byte-identical to the app's so stored tokens decrypt.
//     NOTE: ANTHROPIC_API_KEY / CLAUDE_CODE_OAUTH_TOKEN are NO LONGER read here —
//     Claude credentials are stored per-project (encrypted) in AiCredential and
//     resolved at use time. There is no shared/global key.
//  3. Schedule: from SQL enable pg_cron + pg_net and schedule an http_post to
//     <project>.functions.supabase.co/tick with the Bearer CRON_SECRET header.
// ─────────────────────────────────────────────────────────────────────────────
import {
  publishDueScheduledDrafts,
  runPipelineForAllDue,
  runPipelineForProject,
} from "./lib/pipeline.ts";
import { generateAdHocPost, type AdHocInput } from "./lib/claude.ts";
import { listModels, resolveModel } from "./lib/ai-credentials.ts";
import { moderate, type ModerationInput } from "./lib/moderation.ts";

function isAuthorized(req: Request): boolean {
  const secret = Deno.env.get("CRON_SECRET");
  // Diagnostic logging (visible in Supabase function logs) WITHOUT leaking the
  // secret: the common 401 causes are (a) the CRON_SECRET secret was never set
  // on the function, or (b) the caller's Bearer token doesn't match it. We log
  // which case it is and a short prefix so a mismatch is obvious at a glance.
  if (!secret) {
    console.error("auth: CRON_SECRET is not set on this function");
    return false;
  }
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  const q = new URL(req.url).searchParams.get("secret");
  if (q === secret) return true;
  const sent = auth?.startsWith("Bearer ") ? auth.slice(7) : (q ?? "");
  console.error(
    `auth: token mismatch (sent prefix="${sent.slice(0, 6)}…" len=${sent.length}, ` +
      `expected prefix="${secret.slice(0, 6)}…" len=${secret.length})`,
  );
  return false;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type Body = {
  action?: "tick" | "generate" | "compose" | "list-models" | "moderate";
  projectId?: string;
  input?: AdHocInput;
  /** Manual topic override for the "generate" action (empty → all topics). */
  topics?: string[];
} & Partial<ModerationInput>;

// The scheduled fan-out: run all due projects + flush due scheduled drafts.
async function runTick(started: number): Promise<Response> {
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
}

Deno.serve(async (req: Request) => {
  if (!isAuthorized(req)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  const started = Date.now();

  // A bodyless POST/GET (pg_cron) parses to {} → the default "tick" action,
  // preserving the original scheduled behavior.
  let body: Body = {};
  try {
    if (req.headers.get("content-type")?.includes("application/json")) {
      body = (await req.json()) as Body;
    }
  } catch {
    body = {};
  }

  const action = body.action ?? "tick";
  try {
    switch (action) {
      case "tick":
        return await runTick(started);

      case "generate": {
        if (!body.projectId) return json({ ok: false, error: "projectId required" }, 400);
        const res = await runPipelineForProject(body.projectId, body.topics);
        return json(res);
      }

      case "compose": {
        if (!body.projectId || !body.input) {
          return json({ ok: false, error: "projectId and input required" }, 400);
        }
        const resolved = await resolveModel(body.projectId);
        const result = await generateAdHocPost(body.input, resolved);
        return json({ ok: true, ...result });
      }

      case "list-models": {
        if (!body.projectId) return json({ ok: false, error: "projectId required" }, 400);
        const { models, live } = await listModels(body.projectId);
        return json({ ok: true, models, live });
      }

      case "moderate": {
        if (!body.projectId || !body.texts) {
          return json({ ok: false, error: "projectId and texts required" }, 400);
        }
        const result = await moderate({
          texts: body.texts,
          bannedWords: body.bannedWords ?? [],
          moderationEnabled: body.moderationEnabled ?? false,
          projectId: body.projectId,
        });
        return json({ ok: true, ...result });
      }

      default:
        return json({ ok: false, error: `unknown action: ${action}` }, 400);
    }
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
