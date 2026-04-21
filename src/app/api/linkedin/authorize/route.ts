import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { buildAuthorizeUrl, signState } from "@/lib/linkedin";

export const dynamic = "force-dynamic";

function redirectUri(req: Request): string {
  return new URL("/api/linkedin/callback", req.url).toString();
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/sign-in", req.url));
  }

  const projectId = new URL(req.url).searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ ok: false, error: "projectId is required" }, { status: 400 });
  }

  const project = await db.project.findFirst({
    where: { id: projectId, org: { members: { some: { userId: session.user.id } } } },
  });
  if (!project) {
    return NextResponse.json({ ok: false, error: "Project not found" }, { status: 404 });
  }

  const state = signState({
    u: session.user.id,
    p: projectId,
    n: randomBytes(16).toString("hex"),
  });

  const url = buildAuthorizeUrl(state, redirectUri(req));
  return NextResponse.redirect(url);
}
