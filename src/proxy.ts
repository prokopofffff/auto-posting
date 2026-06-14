import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Paths reachable while signed out. Everything else redirects to /sign-in.
const PUBLIC_PATHS = ["/", "/sign-in", "/sign-up", "/api/auth", "/api/cron", "/api/health"];

// Supabase @supabase/ssr proxy (formerly NextAuth's `auth()` middleware wrapper).
// `updateSession` refreshes the session cookie and hands back the cookie-bearing
// response plus a client bound to the rewritten cookies; we read the user from
// that same client so the refresh and the auth check stay in sync. The refreshed
// `response` MUST be the one returned (or have its cookies copied onto a redirect),
// otherwise the rotated session cookie is dropped.
export default async function proxy(request: NextRequest) {
  const { nextUrl } = request;
  const { supabase, response } = await updateSession(request);

  const isPublic = PUBLIC_PATHS.some(
    (p) => nextUrl.pathname === p || nextUrl.pathname.startsWith(p + "/"),
  );
  if (isPublic) return response;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const url = new URL("/sign-in", nextUrl);
    url.searchParams.set("from", nextUrl.pathname);
    const redirect = NextResponse.redirect(url);
    // Carry the refreshed session cookies onto the redirect so they are not lost.
    for (const cookie of response.cookies.getAll()) {
      redirect.cookies.set(cookie);
    }
    return redirect;
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)"],
};
