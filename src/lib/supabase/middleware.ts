import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";

// Refreshes the Supabase auth session cookie on every matched request and
// forwards the rewritten cookies onto both the request (for downstream Server
// Components) and the response (for the browser). Call this from the root
// `middleware.ts`. Returning the produced response is required so refreshed
// cookies are not dropped.
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          supabaseResponse = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            supabaseResponse.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // IMPORTANT: do not run code between createServerClient and getUser(); a
  // refresh is triggered here and any stray async work can desync the session.
  // This single call both refreshes the cookie AND validates the user against
  // the auth server, so we return the user for the caller to reuse rather than
  // having it call getUser() a second time.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response: supabaseResponse, user };
}
