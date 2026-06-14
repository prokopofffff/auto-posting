import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// OAuth (and email-confirmation) callback. Supabase / the provider bounces the
// browser here with a `?code=`; we exchange it for a session, which the
// cookie-bound server client writes onto the response cookies. `next` carries
// the post-login destination set when the flow was kicked off.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
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
      return NextResponse.redirect(new URL(next, origin));
    }
  }

  return NextResponse.redirect(new URL("/sign-in?error=oauth", origin));
}
