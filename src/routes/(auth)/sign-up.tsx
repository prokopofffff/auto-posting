import { createFileRoute, Link } from "@tanstack/react-router";
import { SignUpForm } from "@/components/forms/sign-up-form";

// Ported from src/app/(auth)/sign-up/page.tsx. Mirrors the sign-in route.
export const Route = createFileRoute("/(auth)/sign-up")({
  component: SignUpPage,
});

function SignUpPage() {
  return (
    <div className="auth-card">
      <div className="auth-card-head">
        <div className="auth-eyebrow">create account</div>
        <h1 className="auth-title">Create your account</h1>
        <p className="auth-sub">Start posting in under a minute.</p>
      </div>
      <div className="auth-card-body">
        <SignUpForm />
      </div>
      <div className="auth-foot">
        Already have one? <Link to="/sign-in">Sign in</Link>
      </div>
    </div>
  );
}
