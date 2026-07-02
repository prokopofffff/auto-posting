import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

// Service-role client for trusted server code (server actions, the publishing
// pipeline, cron) that must bypass RLS. Never import this from Client Components
// or expose the key to the browser. Replaces the old Prisma `db` singleton.
//
// No cookies / no session: each call is fully privileged. Reused across
// invocations via a singleton.
//
// The real client is created lazily on first use, NOT at module load:
// `createClient` validates its URL eagerly and throws when env vars are absent,
// which happens during `next build` page-data collection (no runtime env yet).
// A lazy proxy keeps importing this module side-effect-free.
type Admin = SupabaseClient<Database>;

const globalForSupabase = globalThis as unknown as {
  supabaseService?: Admin;
};

let cached: Admin | undefined;

function getAdmin(): Admin {
  if (cached) return cached;
  if (globalForSupabase.supabaseService) {
    return (cached = globalForSupabase.supabaseService);
  }

  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase service client requires VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  cached = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // Survive HMR in dev without leaking a second client per reload.
  if (process.env.NODE_ENV !== "production") {
    globalForSupabase.supabaseService = cached;
  }
  return cached;
}

// Lazy proxy: property access (`supabaseAdmin.from`, `.rpc`, `.auth`, ...)
// instantiates the real client on first touch and forwards to it.
export const supabaseAdmin = new Proxy({} as Admin, {
  get(_target, prop, receiver) {
    const client = getAdmin();
    const value = Reflect.get(client as object, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
