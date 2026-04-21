import { NextResponse } from "next/server";
import { runPipelineForAllDue } from "@/server/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 min — plenty for fan-out

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  // Vercel Cron also passes the header, but users can also hit manually
  const q = new URL(req.url).searchParams.get("secret");
  return q === secret;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const started = Date.now();
  try {
    const result = await runPipelineForAllDue();
    return NextResponse.json({ ok: true, ...result, ms: Date.now() - started });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 },
    );
  }
}

export const POST = GET;
