"use server";

import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { signIn } from "@/auth";

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
  try {
    await signIn("credentials", { email, password, redirect: false });
    return { ok: true };
  } catch {
    return { ok: false, error: "Invalid email or password." };
  }
}
