import Link from "next/link";
import { SignInForm } from "@/components/forms/sign-in-form";

export default function SignInPage() {
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
        No account? <Link href="/sign-up">Create one</Link>
      </div>
    </div>
  );
}
