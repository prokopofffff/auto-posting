// Server-side session helper built on Supabase Auth. Identity is read from the
// cookie-bound server client; there is no NextAuth surface anymore (the old
// `auth(handler)` proxy-wrapper, the throwing signIn/signOut shims, and the
// NextAuth `Session` module augmentation are all gone — the auth guard now lives
// in src/start.ts, and sign-in/up run through Supabase in
// src/server/auth-actions.ts).
//
// Call `getSession()` (or its alias `auth()`) from a server function or route
// loader to read the current user. Returns `null` when signed out.
import { createClient } from "@/lib/supabase/server";

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
// `getClaims()` verifies the access token's JWT — locally (no network round trip)
// when the project uses asymmetric signing keys, transparently falling back to a
// `getUser()` auth-server check for legacy symmetric keys — so it is never weaker
// than `getUser()` but much faster when local verification is available.
export async function getSession(): Promise<Session | null> {
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
}

// Backwards-compatible alias so existing `await auth()` read-callers keep working
// without a rename.
export function auth(): Promise<Session | null> {
  return getSession();
}
