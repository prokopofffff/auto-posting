import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";

// Anon-key client for client components. Safe to expose; RLS enforces access.
// Client env vars are read from import.meta.env and MUST be prefixed VITE_ so
// Vite inlines them into the browser bundle.
export function createClient() {
  return createBrowserClient<Database>(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY,
  );
}
