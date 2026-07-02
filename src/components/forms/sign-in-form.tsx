import { useState, useTransition } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { signInWithCredentialsAction } from "@/server/auth-actions";
import { signInWithGoogle } from "@/server/oauth-actions";

export function SignInForm() {
  const navigate = useNavigate();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          startTransition(async () => {
            setError(null);
            // Server-fn calling convention: pass the FormData under `data`.
            const res = await signInWithCredentialsAction({ data: fd });
            if (!res.ok) {
              setError(res.error);
              toast.error(res.error);
              return;
            }
            // Refresh loader/auth data (replaces router.refresh()), then navigate.
            await router.invalidate();
            await navigate({ to: "/dashboard" });
          });
        }}
      >
        <div className="field">
          <label className="field-label" htmlFor="email">
            Email
          </label>
          <input
            className="input"
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="password">
            Password
          </label>
          <input
            className="input"
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
          />
        </div>
        {error ? <div className="auth-error">{error}</div> : null}
        <button className="btn accent block" type="submit" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <div className="auth-divider">or</div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          // signInWithGoogle throws a redirect on the server; the browser follows
          // it. No client navigation needed.
          void signInWithGoogle();
        }}
      >
        <button className="btn block" type="submit">
          Continue with Google
        </button>
      </form>
    </div>
  );
}
