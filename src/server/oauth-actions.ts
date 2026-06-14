"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Build the absolute origin of the current deployment from the forwarded
// headers (Server Actions have no request object). Supabase needs an absolute
// `redirectTo`, and Google's OAuth client only honours whitelisted absolute
// redirect URIs, so this must resolve to the real public origin behind the
// proxy. Falls back to AUTH_URL for local/edge cases where the header is absent.
async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (host) {
    const proto = h.get("x-forwarded-proto") ?? "https";
    return `${proto}://${host}`;
  }
  return process.env.AUTH_URL ?? "http://localhost:3000";
}

// Kick off the Google OAuth dance: Supabase returns the provider authorize URL,
// then Google bounces the browser back to /auth/callback with a `code` that the
// callback route exchanges for a session. `redirect()` throws, so it must run
// outside any try/catch.
export async function signInWithGoogle() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${await origin()}/auth/callback?next=/dashboard`,
    },
  });
  if (error || !data.url) {
    redirect("/sign-in?error=oauth");
  }
  redirect(data.url);
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
