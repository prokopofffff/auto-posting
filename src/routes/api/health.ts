import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/lib/supabase/service";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        try {
          // Cheap connectivity probe — a head count against a known table
          // stands in for the old `SELECT 1` raw query.
          const { error } = await supabaseAdmin
            .from("Project")
            .select("id", { count: "exact", head: true });
          if (error) throw error;
          return Response.json({ ok: true, ts: Date.now() });
        } catch (e) {
          return Response.json(
            { ok: false, error: (e as Error).message },
            { status: 503 },
          );
        }
      },
    },
  },
});
