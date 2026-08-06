/**
 * Tiny in-memory rate limiter for a single Node process.
 * Token bucket + optional in-flight concurrency cap.
 */
type Bucket = {
  tokens: number;
  updatedAt: number;
  inflight: number;
};

const buckets = new Map<string, Bucket>();

export type RateLimitResult =
  | { ok: true; release: () => void }
  | { ok: false; retryAfterMs: number };

export type RateLimitOptions = {
  /** Max tokens in the bucket */
  capacity: number;
  /** Tokens added per second */
  refillPerSec: number;
  /** Max concurrent holders (0 = no concurrency cap) */
  maxInflight?: number;
};

function getBucket(key: string, capacity: number): Bucket {
  let b = buckets.get(key);
  if (!b) {
    b = { tokens: capacity, updatedAt: Date.now(), inflight: 0 };
    buckets.set(key, b);
  }
  return b;
}

function refill(b: Bucket, capacity: number, refillPerSec: number) {
  const now = Date.now();
  const elapsed = (now - b.updatedAt) / 1000;
  if (elapsed > 0) {
    b.tokens = Math.min(capacity, b.tokens + elapsed * refillPerSec);
    b.updatedAt = now;
  }
}

/** Prune idle buckets occasionally (lazy). */
function maybePrune() {
  if (buckets.size < 5000) return;
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [k, b] of buckets) {
    if (b.inflight === 0 && b.updatedAt < cutoff) buckets.delete(k);
  }
}

export function takeRateLimit(
  key: string,
  opts: RateLimitOptions,
): RateLimitResult {
  maybePrune();
  const { capacity, refillPerSec, maxInflight = 0 } = opts;
  const b = getBucket(key, capacity);
  refill(b, capacity, refillPerSec);

  if (maxInflight > 0 && b.inflight >= maxInflight) {
    return { ok: false, retryAfterMs: 500 };
  }
  if (b.tokens < 1) {
    const need = 1 - b.tokens;
    const retryAfterMs = Math.ceil((need / refillPerSec) * 1000);
    return { ok: false, retryAfterMs: Math.max(200, retryAfterMs) };
  }

  b.tokens -= 1;
  b.inflight += 1;
  let released = false;
  return {
    ok: true,
    release: () => {
      if (released) return;
      released = true;
      b.inflight = Math.max(0, b.inflight - 1);
    },
  };
}

/** Client IP from common proxy headers, fallback unknown. */
export function clientIpFromRequest(req: Request): string {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) {
    const first = xf.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;
  return "unknown";
}

/** Aggressive navigate limits: ~5 / 2s burst, ~20 / min, max 2 in-flight. */
export const NAVIGATE_RATE_LIMIT: RateLimitOptions = {
  capacity: 5,
  refillPerSec: 5 / 12, // ~20/min
  maxInflight: 2,
};

/** Stricter report submission: ~3 / min. */
export const REPORT_RATE_LIMIT: RateLimitOptions = {
  capacity: 3,
  refillPerSec: 3 / 60,
  maxInflight: 1,
};
