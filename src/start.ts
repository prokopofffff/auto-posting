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

    if (!user && !isPublic(pathname)) {
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
