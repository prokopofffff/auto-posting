import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { exchangeCode, fetchUserInfo, verifyState } from "@/lib/linkedin";

export const dynamic = "force-dynamic";

function callbackUri(req: Request): string {
  return new URL("/api/linkedin/callback", req.url).toString();
}

function fail(req: Request, message: string) {
  const url = new URL("/settings", req.url);
  url.searchParams.set("li_error", message);
  return NextResponse.redirect(url);
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.redirect(new URL("/sign-in", req.url));

  const params = new URL(req.url).searchParams;
  const code = params.get("code");
  const state = params.get("state");
  const error = params.get("error");
  if (error) return fail(req, params.get("error_description") ?? error);
  if (!code || !state) return fail(req, "Missing code or state");

  const decoded = verifyState(state);
  if (!decoded) return fail(req, "Invalid state");
  if (decoded.u !== session.user.id) return fail(req, "State/user mismatch");

  const projectId = decoded.p;
  const project = await db.project.findFirst({
    where: { id: projectId, org: { members: { some: { userId: session.user.id } } } },
  });
  if (!project) return fail(req, "Project not found");

  let tokens;
  try {
    tokens = await exchangeCode(code, callbackUri(req));
  } catch (e) {
    return fail(req, `Token exchange failed: ${(e as Error).message}`);
  }

  let info;
  try {
    info = await fetchUserInfo(tokens.access_token);
  } catch (e) {
    return fail(req, `User info failed: ${(e as Error).message}`);
  }

  const urn = `urn:li:person:${info.sub}`;
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  await db.connectedAccount.upsert({
    where: {
      projectId_platform_externalId: {
        projectId,
        platform: "LINKEDIN",
        externalId: urn,
      },
    },
    create: {
      projectId,
      platform: "LINKEDIN",
      externalId: urn,
      displayName:
        info.name ?? (`${info.given_name ?? ""} ${info.family_name ?? ""}`.trim() || null),
      accessToken: encrypt(tokens.access_token),
      refreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
      expiresAt,
      meta: { scope: tokens.scope, memberId: info.sub, email: info.email, picture: info.picture },
    },
    update: {
      displayName: info.name ?? undefined,
      accessToken: encrypt(tokens.access_token),
      refreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
      expiresAt,
      meta: { scope: tokens.scope, memberId: info.sub, email: info.email, picture: info.picture },
    },
  });

  const url = new URL("/settings", req.url);
  url.searchParams.set("li_ok", "1");
  return NextResponse.redirect(url);
}
