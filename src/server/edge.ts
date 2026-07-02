// Server-side client for the `tick` Supabase Edge Function — the single Claude/
// generation runtime. The Next app calls these actions instead of running Claude
// itself, so there is one pipeline implementation, not two.
//
// Auth is the shared CRON_SECRET (server-to-server). Callers MUST verify the
// signed-in user owns `projectId` before invoking any project-scoped action —
// the edge function trusts the secret and resolves that project's own credential.
// Server-only: reads CRON_SECRET; never import from a Client Component.

function functionsBase(): string {
  const url = process.env.VITE_SUPABASE_URL;
  if (!url) throw new Error("VITE_SUPABASE_URL is not set");
  // Supabase Edge Functions are served at <project>.supabase.co/functions/v1/<name>.
  return `${url.replace(/\/$/, "")}/functions/v1`;
}

export type EdgeAction =
  | "tick"
  | "generate"
  | "regenerate"
  | "compose"
  | "list-models"
  | "moderate"
  | "pick-photo";

/**
 * Calls the edge function and returns its JSON body verbatim as `T`. Every edge
 * action returns a domain envelope (`{ ok: false, error }` on domain failure,
 * even with a 500), so callers inspect `result.ok` themselves — this only
 * THROWS on a transport/parse failure the caller genuinely can't model
 * (unreachable service, non-JSON body). That keeps the transport vs domain
 * distinction out of every call site.
 */
export async function invokeEdge<T = unknown>(
  action: EdgeAction,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("CRON_SECRET is not set");

  let res: Response;
  try {
    res = await fetch(`${functionsBase()}/tick`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ action, ...payload }),
      cache: "no-store",
    });
  } catch (e) {
    throw new Error(`Could not reach the generation service: ${(e as Error).message}`);
  }

  try {
    return (await res.json()) as T;
  } catch {
    // Non-JSON body (gateway error page, etc.) — a real transport failure.
    throw new Error(`Generation service error (${res.status}).`);
  }
}
