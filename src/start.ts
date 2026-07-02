import { createStart, createMiddleware } from "@tanstack/react-start";
import { redirect } from "@tanstack/react-router";
import { createServerClient } from "@supabase/ssr";
import { getCookies, setCookie } from "@tanstack/react-start/server";
import type { Database } from "@/lib/database.types";

// Paths reachable while signed out. Everything else redirects to /sign-in.
// (Ported verbatim from the old src/proxy.ts.)
const PUBLIC_PATHS = [
  "/",
  "/sign-in",
  "/sign-up",
  "/api/auth",
  "/api/cron",
  "/api/health",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}

// TanStack Start routes server-function calls through this base (POST to
// /_serverFn/<id>). The guard MUST NOT redirect these: sign-in/sign-up/Google
// OAuth are themselves server functions a signed-out user has to reach, and a
// redirect response would replace their result and make auth impossible. The
// session refresh above still runs for these requests; auth for protected
// functions is enforced inside each one (getCurrentUser + userOwnsProject) and
// inside protected loaders (requireCurrentProject redirects when signed out).
const SERVER_FN_BASE = "/_serverFn/";

// Global request middleware — the TanStack Start replacement for src/proxy.ts +
// src/lib/supabase/middleware.ts. Runs on EVERY request (page renders AND server
// function calls). It:
//   1. Refreshes the Supabase auth session, rotating the cookie via setCookie so
//      the browser keeps a valid session. The @supabase/ssr client reads the
//      request cookies (getCookies) and writes rotated ones (setCookie); both
//      operate on the current request via AsyncLocalStorage.
//   2. Redirects unauthenticated users away from non-public paths.
//
// IMPORTANT: do not run code between createServerClient and getUser(); a refresh
// is triggered there and stray async work can desync the session.
const authGuard = createMiddleware({ type: "request" }).server(
  async ({ next, request, pathname }) => {
    const supabase = createServerClient<Database>(
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
            for (const { name, value, options } of cookiesToSet) {
              setCookie(name, value, options);
            }
          },
        },
      },
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const url = new URL(request.url);

    if (
      !user &&
      !isPublic(pathname) &&
      !pathname.startsWith(SERVER_FN_BASE)
    ) {
      throw redirect({
        to: "/sign-in",
        search: { from: url.pathname },
      });
    }

    return next();
  },
);

// Register the guard as global request middleware. TanStack Start discovers this
// file (default: src/start.ts) and applies `requestMiddleware` to all requests.
export const startInstance = createStart(() => ({
  requestMiddleware: [authGuard],
}));
