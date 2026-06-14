// The old NextAuth catch-all `/api/auth/[...nextauth]` route handler is obsolete
// under Supabase Auth: sign-in/out and the OAuth code exchange move to Supabase
// (`supabase.auth.*`) and a dedicated `/auth/callback` route (madrid-9i8.7).
// These stubs keep the existing route file compiling and return 410 Gone until
// madrid-9i8.8 deletes the route entirely.
import { NextResponse } from "next/server";

function gone() {
  return NextResponse.json(
    { error: "NextAuth endpoints are gone; auth now runs on Supabase." },
    { status: 410 },
  );
}

export async function GET() {
  return gone();
}

export async function POST() {
  return gone();
}
