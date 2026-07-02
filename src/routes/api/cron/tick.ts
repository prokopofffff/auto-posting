import { createFileRoute } from "@tanstack/react-router";
import { runTick } from "@/server/pipeline";

// Manual fallback trigger. Production scheduling is pg_cron → the edge function
// directly; this route just forwards to the same edge "tick" action so there's
// one pipeline. Gate on CRON_SECRET exactly as before.
//
// Long-duration note: the old Next handler set `maxDuration = 300` (5 min) and
// `dynamic = "force-dynamic"`. Those are Next-specific and have no TanStack
// Start equivalent in-file — the fan-out in runTick() can run for minutes, so
// the deployment/platform (function timeout, e.g. Vercel `maxDuration` or the
// serverless config) must allow a long timeout for this endpoint.
function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  const q = new URL(req.url).searchParams.get("secret");
  return q === secret;
}

async function handleTick(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await runTick();
    return Response.json(result);
  } catch (e) {
    return Response.json(
      { ok: false, error: (e as Error).message },
      { status: 500 },
    );
  }
}

export const Route = createFileRoute("/api/cron/tick")({
  server: {
    handlers: {
      GET: async ({ request }) => handleTick(request),
      POST: async ({ request }) => handleTick(request),
    },
  },
});
