export class TransientPublishError extends Error {
  readonly status?: number;
  readonly retryAfterMs?: number;

  constructor(message: string, opts: { status?: number; retryAfterMs?: number } = {}) {
    super(message);
    this.name = "TransientPublishError";
    this.status = opts.status;
    this.retryAfterMs = opts.retryAfterMs;
  }
}

export function parseRetryAfter(header: string | null | undefined): number | undefined {
  if (!header) return undefined;
  const secs = Number(header);
  if (Number.isFinite(secs) && secs >= 0) return Math.floor(secs * 1000);
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return undefined;
}

export type RetryOptions = {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  onRetry?: (err: TransientPublishError, attempt: number, delayMs: number) => void;
};

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 3;
  const base = opts.baseDelayMs ?? 500;
  const max = opts.maxDelayMs ?? 8000;
  const factor = opts.factor ?? 2;

  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof TransientPublishError) || attempt >= retries) throw e;
      const expo = Math.min(max, base * Math.pow(factor, attempt));
      const jittered = Math.floor(expo / 2 + Math.random() * (expo / 2));
      const delay = e.retryAfterMs ?? jittered;
      opts.onRetry?.(e, attempt + 1, delay);
      await new Promise((r) => setTimeout(r, delay));
      attempt++;
    }
  }
}
