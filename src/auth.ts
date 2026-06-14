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

// Read the signed-in user from the cookie-bound Supabase server client. Uses
// getUser() (not getSession()) so the access token is verified against the auth
// server rather than trusted from the cookie. Returns `null` when signed out.
async function getSession(): Promise<Session | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return {
    user: {
      id: user.id,
      email: user.email ?? null,
      name: (user.user_metadata?.name as string | undefined) ?? null,
      image: (user.user_metadata?.avatar_url as string | undefined) ?? null,
    },
  };
}

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
export async function signIn(..._args: unknown[]): Promise<never> {
  throw new Error(PORTED);
}

export async function signOut(..._args: unknown[]): Promise<never> {
  throw new Error(PORTED);
}
