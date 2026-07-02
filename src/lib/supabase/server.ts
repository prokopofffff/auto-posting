import { createServerClient } from "@supabase/ssr";
import { getCookies, setCookie } from "@tanstack/react-start/server";
import type { Database } from "@/lib/database.types";

// Cookie-bound anon-key client for server functions / server routes / loaders.
// Tracks the signed-in user and respects RLS. Replaces the Next `cookies()`
// store with TanStack Start's request-scoped cookie helpers
// (getCookies/setCookie from @tanstack/react-start/server), which operate on the
// current request/response via AsyncLocalStorage.
//
// Kept async to preserve the `await createClient()` call convention across the
// codebase (it was async under Next 16's async cookies()).
export async function createClient() {
  return createServerClient<Database>(
    process.env.VITE_SUPABASE_URL!,
    process.env.VITE_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return Object.entries(getCookies()).map(([name, value]) => ({
            name,
            value,
          }));
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              setCookie(name, value, options);
            }
          } catch {
            // No writable response in this context (e.g. a render after headers
            // were flushed). Session refresh runs in the global request
            // middleware, so dropping a write here is safe.
          }
        },
      },
    },
  );
}
