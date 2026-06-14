import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

// Service-role client for trusted server code (server actions, the publishing
// pipeline, cron) that must bypass RLS. Never import this from Client Components
// or expose the key to the browser. Replaces the old Prisma `db` singleton.
//
// No cookies / no session: each call is fully privileged. Reused across
// invocations via a module-level singleton.
const globalForSupabase = globalThis as unknown as {
  supabaseService?: ReturnType<typeof createClient<Database>>;
};

export const supabaseAdmin =
  globalForSupabase.supabaseService ??
  createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );

if (process.env.NODE_ENV !== "production") {
  globalForSupabase.supabaseService = supabaseAdmin;
}
