import { supabaseAdmin } from "@/lib/supabase/service";

// Postgres-backed rate limiter (madrid-9i8.12). The state lives in the
// "RateLimit" table so it survives Netlify's ephemeral, multi-instance
// functions — a process-local Map would reset on every cold start and never be
// shared across instances, so lockout/backoff would not persist. All access
// goes through the service-role client, which bypasses RLS; the failure
// increment is delegated to the rate_limit_record_failure() rpc so the
// read-modify-write is atomic across concurrent instances.

export type RateLimitOptions = {
  namespace: string;
  windowMs: number;
  maxAttempts: number;
  lockoutMs: number;
};

export type RateLimitCheck =
  | { allowed: true }
  | { allowed: false; retryAfterMs: number };

export async function checkRateLimit(
  key: string,
  opts: RateLimitOptions,
): Promise<RateLimitCheck> {
  const now = Date.now();
  const { data, error } = await supabaseAdmin
    .from("RateLimit")
    .select("lockedUntil")
    .eq("namespace", opts.namespace)
    .eq("key", key)
    .maybeSingle();

  // Fail open: a transient DB error must not lock everyone out of sign-in.
  if (error || !data) return { allowed: true };
  if (data.lockedUntil > now) {
    return { allowed: false, retryAfterMs: data.lockedUntil - now };
  }
  return { allowed: true };
}

export async function recordFailure(
  key: string,
  opts: RateLimitOptions,
): Promise<RateLimitCheck> {
  const now = Date.now();
  const { data, error } = await supabaseAdmin.rpc("rate_limit_record_failure", {
    p_namespace: opts.namespace,
    p_key: key,
    p_now: now,
    p_window_ms: opts.windowMs,
    p_max_attempts: opts.maxAttempts,
    p_lockout_ms: opts.lockoutMs,
  });

  // rpc returns the resulting "lockedUntil" (0 when not locked). Fail open on
  // error so a DB blip can't both miss the increment and reject the user.
  if (error || data == null) return { allowed: true };
  const lockedUntil = data;
  if (lockedUntil > now) {
    return { allowed: false, retryAfterMs: lockedUntil - now };
  }
  return { allowed: true };
}

export async function recordSuccess(
  key: string,
  opts: Pick<RateLimitOptions, "namespace">,
): Promise<void> {
  await supabaseAdmin
    .from("RateLimit")
    .delete()
    .eq("namespace", opts.namespace)
    .eq("key", key);
}

export function formatRetryAfter(ms: number): string {
  const secs = Math.ceil(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.ceil(secs / 60);
  return `${mins} minute${mins === 1 ? "" : "s"}`;
}
