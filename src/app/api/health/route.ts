import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Cheap connectivity probe — a head count against a known table stands in
    // for the old `SELECT 1` raw query.
    const { error } = await supabaseAdmin
      .from("Project")
      .select("id", { count: "exact", head: true });
    if (error) throw error;
    return NextResponse.json({ ok: true, ts: Date.now() });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 503 },
    );
  }
}
