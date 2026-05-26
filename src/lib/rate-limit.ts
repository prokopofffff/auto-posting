type Bucket = {
  attempts: number;
  windowStart: number;
  lockedUntil: number;
};

type Store = Map<string, Bucket>;

const stores: Record<string, Store> = {};

function storeFor(namespace: string): Store {
  let s = stores[namespace];
  if (!s) {
    s = new Map();
    stores[namespace] = s;
  }
  return s;
}

export type RateLimitOptions = {
  namespace: string;
  windowMs: number;
  maxAttempts: number;
  lockoutMs: number;
};

export type RateLimitCheck =
  | { allowed: true }
  | { allowed: false; retryAfterMs: number };

function pruneIfFull(store: Store, now: number) {
  if (store.size < 10_000) return;
  for (const [k, v] of store) {
    if (v.lockedUntil < now && now - v.windowStart > 24 * 60 * 60 * 1000) {
      store.delete(k);
    }
  }
}

export function checkRateLimit(key: string, opts: RateLimitOptions): RateLimitCheck {
  const store = storeFor(opts.namespace);
  const now = Date.now();
  const bucket = store.get(key);
  if (!bucket) return { allowed: true };
  if (bucket.lockedUntil > now) {
    return { allowed: false, retryAfterMs: bucket.lockedUntil - now };
  }
  return { allowed: true };
}

export function recordFailure(key: string, opts: RateLimitOptions): RateLimitCheck {
  const store = storeFor(opts.namespace);
  const now = Date.now();
  pruneIfFull(store, now);
  let bucket = store.get(key);
  if (!bucket || now - bucket.windowStart > opts.windowMs) {
    bucket = { attempts: 0, windowStart: now, lockedUntil: 0 };
  }
  bucket.attempts++;
  if (bucket.attempts >= opts.maxAttempts) {
    bucket.lockedUntil = now + opts.lockoutMs;
  }
  store.set(key, bucket);
  if (bucket.lockedUntil > now) {
    return { allowed: false, retryAfterMs: bucket.lockedUntil - now };
  }
  return { allowed: true };
}

export function recordSuccess(key: string, opts: Pick<RateLimitOptions, "namespace">): void {
  storeFor(opts.namespace).delete(key);
}

export function formatRetryAfter(ms: number): string {
  const secs = Math.ceil(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.ceil(secs / 60);
  return `${mins} minute${mins === 1 ? "" : "s"}`;
}
