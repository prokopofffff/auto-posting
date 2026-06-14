"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
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

  // `name` rides along in user_metadata so the auth-user-sync trigger mirrors it
  // into public.User.name (it reads the `name`/`full_name` keys).
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: name ? { data: { name } } : undefined,
  });
  if (error) {
    return {
      ok: false,
      error:
        error.code === "user_already_exists"
          ? "An account with this email already exists."
          : error.message,
    };
  }
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
