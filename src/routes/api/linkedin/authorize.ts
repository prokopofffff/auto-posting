import { createFileRoute } from "@tanstack/react-router";
import { randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { userOwnsProject } from "@/server/project";
import { buildAuthorizeUrl, signState } from "@/lib/linkedin";

// Ports src/app/api/linkedin/authorize/route.ts (Next `GET`). Serves the same
// path /api/linkedin/authorize. The redirect_uri handed to LinkedIn MUST stay
// /api/linkedin/callback (built from the incoming request URL, exactly as
// before). Was `dynamic = "force-dynamic"` under Next — server route handlers
// here are always dynamic, so no equivalent flag is needed.
function redirectUri(req: Request): string {
  return new URL("/api/linkedin/callback", req.url).toString();
}

async function handleAuthorize(request: Request): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.redirect(new URL("/sign-in", request.url));
  }

  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!projectId) {
    return Response.json(
      { ok: false, error: "projectId is required" },
      { status: 400 },
    );
  }

  if (!(await userOwnsProject(user.id, projectId))) {
    return Response.json({ ok: false, error: "Project not found" }, { status: 404 });
  }

  const state = signState({
    u: user.id,
    p: projectId,
    n: randomBytes(16).toString("hex"),
  });

  const url = buildAuthorizeUrl(state, redirectUri(request));
  return Response.redirect(url);
}

export const Route = createFileRoute("/api/linkedin/authorize")({
  server: {
    handlers: {
      GET: async ({ request }) => handleAuthorize(request),
    },
  },
});
