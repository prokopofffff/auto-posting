import { NextResponse } from "next/server";
import { runTick } from "@/server/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 min — plenty for fan-out

// Manual fallback trigger. Production scheduling is pg_cron → the edge function
// directly; this route just forwards to the same edge "tick" action so there's
// one pipeline. Gate on CRON_SECRET exactly as before.
function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  const q = new URL(req.url).searchParams.get("secret");
  return q === secret;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await runTick();
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 },
    );
  }
}

export const POST = GET;
