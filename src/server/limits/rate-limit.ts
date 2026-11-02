/**
 * Bounded in-memory sliding-window rate limiter. No external service.
 * State is per server process: on serverless hosting each instance counts separately,
 * so this limits bursts and runaway loops, not a distributed attacker.
 */
export type RateDecision = { allowed: boolean; remaining: number; retryAfterSec: number };

export type RateLimiter = {
  /** Record one hit if allowed. */
  take(key: string): RateDecision;
  /** Check without recording. */
  peek(key: string): RateDecision;
  size(): number;
};

export function createRateLimiter(opts: {
  limit: number;
  windowMs: number;
  /** Cap on tracked keys; oldest keys are dropped first. */
  maxKeys?: number;
  now?: () => number;
}): RateLimiter {
  const { limit, windowMs } = opts;
  const maxKeys = opts.maxKeys ?? 5000;
  const now = opts.now ?? Date.now;
  const hits = new Map<string, number[]>();

  function recent(key: string, t: number): number[] {
    const list = (hits.get(key) ?? []).filter((ts) => t - ts < windowMs);
    return list;
  }
  function decide(list: number[], t: number, consumed: number): RateDecision {
    if (list.length < limit) return { allowed: true, remaining: Math.max(0, limit - list.length - consumed), retryAfterSec: 0 };
    // A limit of 0 means "always blocked": there is no oldest hit to wait out.
    const retryMs = list.length ? list[0] + windowMs - t : windowMs;
    return { allowed: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil(retryMs / 1000)) };
  }

  return {
    peek(key) {
      const t = now();
      return decide(recent(key, t), t, 0);
    },
    take(key) {
      const t = now();
      const list = recent(key, t);
      const d = decide(list, t, 1);
      if (!d.allowed) {
        if (list.length) hits.set(key, list);
        return d;
      }
      list.push(t);
      hits.delete(key); // refresh insertion order
      hits.set(key, list);
      while (hits.size > maxKeys) {
        const oldest = hits.keys().next().value;
        if (oldest === undefined) break;
        hits.delete(oldest);
      }
      return d;
    },
    size: () => hits.size,
  };
}
