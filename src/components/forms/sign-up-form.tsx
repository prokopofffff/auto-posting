"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { signUpAction } from "@/server/auth-actions";
import { signInWithGoogle } from "@/server/oauth-actions";

export function SignUpForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <form
        action={(fd: FormData) =>
          startTransition(async () => {
            setError(null);
            const res = await signUpAction(fd);
            if (!res.ok) {
              setError(res.error);
              toast.error(res.error);
              return;
            }
            toast.success("Welcome!");
            router.push("/dashboard");
            router.refresh();
          })
        }
      >
        <div className="field">
          <label className="field-label" htmlFor="name">
            Name <span className="field-help">optional</span>
          </label>
          <input className="input" id="name" name="name" autoComplete="name" />
        </div>
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
            minLength={8}
            autoComplete="new-password"
          />
        </div>
        {error ? <div className="auth-error">{error}</div> : null}
        <button className="btn accent block" type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create account"}
        </button>
      </form>

      <div className="auth-divider">or</div>

      <form action={signInWithGoogle}>
        <button className="btn block" type="submit">
          Continue with Google
        </button>
      </form>
    </div>
  );
}
