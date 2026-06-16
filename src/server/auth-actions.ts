"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/service";
import {
  checkRateLimit,
  formatRetryAfter,
  recordFailure,
  recordSuccess,
  type RateLimitOptions,
} from "@/lib/rate-limit";

const LOGIN_LIMIT_IP: RateLimitOptions = {
  namespace: "login:ip",
  windowMs: 15 * 60 * 1000,
  maxAttempts: 20,
  lockoutMs: 15 * 60 * 1000,
};

const LOGIN_LIMIT_EMAIL: RateLimitOptions = {
  namespace: "login:email",
  windowMs: 15 * 60 * 1000,
  maxAttempts: 5,
  lockoutMs: 15 * 60 * 1000,
};

async function getClientIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return h.get("x-real-ip") ?? "unknown";
}

const signUpSchema = z.object({
  name: z.string().min(1).max(80).optional().or(z.literal("")),
  email: z.string().email(),
  password: z.string().min(8).max(200),
});

export type ActionResult = { ok: true } | { ok: false; error: string };

// Supabase Auth owns identity now (auth.users); the app-side public.User /
// Organization rows are seeded by the on_auth_user_created trigger plus the
// upsert-on-first-use in src/server/project.ts, so these actions only drive
// supabase.auth.* and let the cookie-bound server client persist the session.
export async function signUpAction(formData: FormData): Promise<ActionResult> {
  const parsed = signUpSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { ok: false, error: "Invalid input. Email and 8+ char password required." };

  const { name, email, password } = parsed.data;
  const supabase = await createClient();

  // Email verification is disabled for now. We deliberately do NOT use the
  // public `auth.signUp` flow: when the project has "Confirm email" enabled (the
  // production setting), signUp SENDS a verification email and withholds a
  // session until the user clicks the link. Instead we create the account
  // already confirmed via the service role — Supabase never sends a verification
  // email and never gates sign-in, regardless of the project toggle.
  //
  // The on_auth_user_created trigger still seeds public.User; `name` rides in
  // user_metadata so that trigger mirrors it into public.User.name.
  const { error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: name ? { name } : undefined,
  });
  if (createError) {
    const alreadyExists =
      createError.code === "email_exists" ||
      createError.status === 422 ||
      /already (been )?registered|already exists/i.test(createError.message);
    return {
      ok: false,
      error: alreadyExists
        ? "An account with this email already exists."
        : createError.message,
    };
  }

  // Establish a cookie-bound session so the caller lands on /dashboard.
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError) return { ok: false, error: signInError.message };

  return { ok: true };
}

export async function signInWithCredentialsAction(
  formData: FormData,
): Promise<ActionResult> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const ip = await getClientIp();
  const emailKey = email.trim().toLowerCase();

  // Both checks are independent reads — run them together. IP still takes
  // precedence in the returned message (checked first below).
  const [ipCheck, emailCheck] = await Promise.all([
    checkRateLimit(ip, LOGIN_LIMIT_IP),
    emailKey ? checkRateLimit(emailKey, LOGIN_LIMIT_EMAIL) : null,
  ]);
  if (!ipCheck.allowed) {
    return {
      ok: false,
      error: `Too many sign-in attempts. Try again in ${formatRetryAfter(ipCheck.retryAfterMs)}.`,
    };
  }
  if (emailCheck && !emailCheck.allowed) {
    return {
      ok: false,
      error: `Too many sign-in attempts for this account. Try again in ${formatRetryAfter(emailCheck.retryAfterMs)}.`,
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    await recordFailure(ip, LOGIN_LIMIT_IP);
    if (emailKey) await recordFailure(emailKey, LOGIN_LIMIT_EMAIL);
    return { ok: false, error: "Invalid email or password." };
  }

  await recordSuccess(ip, LOGIN_LIMIT_IP);
  if (emailKey) await recordSuccess(emailKey, LOGIN_LIMIT_EMAIL);
  return { ok: true };
}
