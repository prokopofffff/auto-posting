import { createFileRoute, redirect } from "@tanstack/react-router";
import { createClient } from "@/lib/supabase/server";

// OAuth (and email-confirmation) callback. Supabase / the provider bounces the
// browser here with a `?code=`; we exchange it for a session, which the
// cookie-bound server client writes onto the response cookies. `next` carries
// the post-login destination set when the flow was kicked off.
async function handleCallback(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  // Only honour a same-origin relative path (must start with a single "/", not
  // "//") so a crafted `next` can't redirect to an off-site URL after sign-in.
  const nextParam = searchParams.get("next");
  const next =
    nextParam && /^\/(?!\/)/.test(nextParam) ? nextParam : "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Same-origin relative redirect; the session cookies set by
      // exchangeCodeForSession ride along on the response.
      throw redirect({ href: next });
    }
  }

  throw redirect({ href: "/sign-in?error=oauth" });
}

export const Route = createFileRoute("/auth/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => handleCallback(request),
    },
  },
});
