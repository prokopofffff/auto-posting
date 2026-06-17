// Supabase-Auth replacement for the old NextAuth core (Credentials + Google +
// JWT + PrismaAdapter, all removed). Data access and identity now go through
// supabase-js; this module only exposes the small surface the rest of the app
// still imports from `@/auth`:
//
//   - `auth()`        read the current session from the cookie-bound server
//                     client. Returns a NextAuth-`Session`-shaped object so the
//                     handful of `await auth()` callers keep working unchanged
//                     until they are ported (madrid-9i8.8).
//   - `auth(handler)` legacy proxy-wrapper form used by src/proxy.ts. Kept as a
//                     thin pass-through so the tree compiles; the real Supabase
//                     `@supabase/ssr` proxy lands in madrid-9i8.8.
//   - `signIn` / `signOut` deprecated shims. The sign-in/sign-up flow
//                     (madrid-9i8.7) replaces these with `supabase.auth.*`; they
//                     throw so a stray call surfaces loudly instead of silently
//                     no-op'ing. (The old NextAuth `handlers` export is gone; the
//                     `/api/auth/[...nextauth]` route now returns 410 — see
//                     src/auth-handlers.ts.)
import { cache } from "react";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Mirrors the old NextAuth `Session` shape (see src/types/next-auth.d.ts) so the
// ~3 `await auth()` callers (app layout, the two LinkedIn route handlers) keep
// reading `session.user.id`/`.email` without changes.
export type Session = {
  user: {
    id: string;
    email: string | null;
    name?: string | null;
    image?: string | null;
  };
};

// Read the signed-in user from the cookie-bound Supabase server client.
//
// `getClaims()` verifies the access token's JWT — locally (no network round
// trip) when the project uses asymmetric signing keys, and transparently
// falling back to a `getUser()` auth-server check for legacy symmetric keys —
// so it is never weaker than the previous `getUser()` call but is much faster
// when local verification is available.
//
// Wrapped in React `cache()` so every `await auth()` in a single request — the
// app layout and the rendered page both resolve the session — shares ONE
// verification instead of each making its own. Returns `null` when signed out.
const getSession = cache(async function getSession(): Promise<Session | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  const meta = (claims.user_metadata ?? {}) as {
    name?: string;
    avatar_url?: string;
  };
  return {
    user: {
      id: claims.sub,
      email: claims.email ?? null,
      name: meta.name ?? null,
      image: meta.avatar_url ?? null,
    },
  };
});

// The request the proxy handler receives, carrying the resolved session on
// `.auth` exactly like NextAuth's `NextAuthRequest` did, so src/proxy.ts keeps
// reading `req.auth` unchanged until madrid-9i8.8 rewrites it.
type AuthedRequest = NextRequest & { auth: Session | null };
type ProxyHandler = (
  req: AuthedRequest,
) => NextResponse | Promise<NextResponse>;

// Overloaded to match NextAuth's dual `auth`: call it with no args to read the
// session, or pass a handler to wrap a proxy (src/proxy.ts). The wrapper form
// resolves the session, attaches it as `req.auth`, then runs the handler; the
// proper `@supabase/ssr` proxy (with cookie refresh) lands in madrid-9i8.8.
export function auth(): Promise<Session | null>;
export function auth(
  handler: ProxyHandler,
): (req: NextRequest) => Promise<NextResponse>;
export function auth(
  handler?: ProxyHandler,
): Promise<Session | null> | ((req: NextRequest) => Promise<NextResponse>) {
  if (handler) {
    return async (req: NextRequest) => {
      const authed = req as AuthedRequest;
      authed.auth = await getSession();
      return handler(authed);
    };
  }
  return getSession();
}

// --- deprecated shims (replaced by madrid-9i8.7 / madrid-9i8.8) -------------

const PORTED =
  "next-auth signIn/signOut have been removed; use supabase.auth.* (see madrid-9i8.7).";

// Variadic so the not-yet-ported call sites in auth-actions/oauth-actions keep
// type-checking; any actual call throws so it surfaces loudly mid-migration.
export async function signIn(...args: unknown[]): Promise<never> {
  void args;
  throw new Error(PORTED);
}

export async function signOut(...args: unknown[]): Promise<never> {
  void args;
  throw new Error(PORTED);
}
