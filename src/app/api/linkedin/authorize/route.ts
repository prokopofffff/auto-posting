import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { userOwnsProject } from "@/server/project";
import { buildAuthorizeUrl, signState } from "@/lib/linkedin";

export const dynamic = "force-dynamic";

function redirectUri(req: Request): string {
  return new URL("/api/linkedin/callback", req.url).toString();
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/sign-in", req.url));
  }

  const projectId = new URL(req.url).searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ ok: false, error: "projectId is required" }, { status: 400 });
  }

  if (!(await userOwnsProject(user.id, projectId))) {
    return NextResponse.json({ ok: false, error: "Project not found" }, { status: 404 });
  }

  const state = signState({
    u: user.id,
    p: projectId,
    n: randomBytes(16).toString("hex"),
  });

  const url = buildAuthorizeUrl(state, redirectUri(req));
  return NextResponse.redirect(url);
}
