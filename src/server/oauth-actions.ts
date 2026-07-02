import { createServerFn } from "@tanstack/react-start";
import { getRequestHost, getRequestProtocol } from "@tanstack/react-start/server";
import { redirect } from "@tanstack/react-router";
import { createClient } from "@/lib/supabase/server";

// Build the absolute origin of the current deployment from the request. Supabase
// needs an absolute `redirectTo`, and Google's OAuth client only honours
// whitelisted absolute redirect URIs, so this must resolve to the real public
// origin behind the proxy. Falls back to AUTH_URL when the host is absent.
function origin(): string {
  const host = getRequestHost({ xForwardedHost: true });
  if (host && host !== "localhost") {
    const proto = getRequestProtocol({ xForwardedProto: true });
    return `${proto}://${host}`;
  }
  return process.env.AUTH_URL ?? "http://localhost:3000";
}

// Kick off the Google OAuth dance: Supabase returns the provider authorize URL,
// then Google bounces the browser back to /auth/callback with a `code` that the
// callback route exchanges for a session. `redirect()` here THROWS a redirect
// (external `href` for the provider URL), so it must run outside any try/catch.
//
// Calling convention from a client component: await signInWithGoogle()
export const signInWithGoogle = createServerFn({ method: "POST" }).handler(
  async () => {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${origin()}/auth/callback?next=/dashboard`,
      },
    });
    if (error || !data.url) {
      throw redirect({ to: "/sign-in", search: { error: "oauth" } });
    }
    throw redirect({ href: data.url });
  },
);

// Calling convention from a client component: await signOutAction()
export const signOutAction = createServerFn({ method: "POST" }).handler(
  async () => {
    const supabase = await createClient();
    await supabase.auth.signOut();
    throw redirect({ to: "/" });
  },
);
