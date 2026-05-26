"use server";

import bcrypt from "bcryptjs";
import { headers } from "next/headers";
import { z } from "zod";
import { db } from "@/lib/db";
import { signIn } from "@/auth";
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

export async function signUpAction(formData: FormData): Promise<ActionResult> {
  const parsed = signUpSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { ok: false, error: "Invalid input. Email and 8+ char password required." };

  const { name, email, password } = parsed.data;
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return { ok: false, error: "An account with this email already exists." };

  const hashedPassword = await bcrypt.hash(password, 10);

  const user = await db.user.create({
    data: { email, name: name || null, hashedPassword },
  });
  const org = await db.organization.create({
    data: { name: name ? `${name}'s workspace` : "My workspace", ownerId: user.id },
  });
  await db.organizationMember.create({
    data: { orgId: org.id, userId: user.id, role: "OWNER" },
  });

  try {
    await signIn("credentials", { email: user.email, password, redirect: false });
  } catch {
    // non-fatal — user can sign in manually
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

  const ipCheck = checkRateLimit(ip, LOGIN_LIMIT_IP);
  if (!ipCheck.allowed) {
    return {
      ok: false,
      error: `Too many sign-in attempts. Try again in ${formatRetryAfter(ipCheck.retryAfterMs)}.`,
    };
  }
  if (emailKey) {
    const emailCheck = checkRateLimit(emailKey, LOGIN_LIMIT_EMAIL);
    if (!emailCheck.allowed) {
      return {
        ok: false,
        error: `Too many sign-in attempts for this account. Try again in ${formatRetryAfter(emailCheck.retryAfterMs)}.`,
      };
    }
  }

  try {
    await signIn("credentials", { email, password, redirect: false });
    recordSuccess(ip, LOGIN_LIMIT_IP);
    if (emailKey) recordSuccess(emailKey, LOGIN_LIMIT_EMAIL);
    return { ok: true };
  } catch {
    recordFailure(ip, LOGIN_LIMIT_IP);
    if (emailKey) recordFailure(emailKey, LOGIN_LIMIT_EMAIL);
    return { ok: false, error: "Invalid email or password." };
  }
}
