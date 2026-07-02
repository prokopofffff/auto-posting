import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { SignInForm } from "@/components/forms/sign-in-form";

// Ported from src/app/(auth)/sign-in/page.tsx. `?from` (set by the auth guard in
// src/start.ts) and `?error` (OAuth failures) are read via validateSearch and
// exposed through Route.useSearch().
const searchSchema = z.object({
  from: z.string().optional(),
  error: z.string().optional(),
});

export const Route = createFileRoute("/(auth)/sign-in")({
  validateSearch: searchSchema,
  component: SignInPage,
});

function SignInPage() {
  return (
    <div className="auth-card">
      <div className="auth-card-head">
        <div className="auth-eyebrow">sign in</div>
        <h1 className="auth-title">Welcome back</h1>
        <p className="auth-sub">Sign in to manage your posts.</p>
      </div>
      <div className="auth-card-body">
        <SignInForm />
      </div>
      <div className="auth-foot">
        No account? <Link to="/sign-up">Create one</Link>
      </div>
    </div>
  );
}
