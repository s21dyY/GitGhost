/**
 * Shared usage counters. Every mutating operation is a single atomic step in the store
 * (a conditional DynamoDB UpdateItem, or one synchronous step in memory), so concurrent requests on
 * many instances cannot both pass the same limit.
 */
export interface UsageStore {
  readonly kind: "memory" | "dynamodb";
  /** Atomically add 1 to `key` if the result stays within `limit`. */
  incrementIfBelow(key: string, limit: number, ttlSec: number): Promise<{ ok: boolean; count: number }>;
  /** Atomically add `amount` to `key` only if the total stays within `cap`. */
  addIfWithin(key: string, amount: number, cap: number, ttlSec: number): Promise<{ ok: boolean; total: number }>;
  /** Unconditional adjustment (refunds are negative). */
  add(key: string, delta: number, ttlSec: number): Promise<void>;
  /** Take one of `slots` expiring leases. A crashed holder stops blocking when its lease ends. */
  acquireLease(prefix: string, slots: number, leaseMs: number, owner: string): Promise<number | null>;
  releaseLease(prefix: string, slot: number, owner: string): Promise<void>;
  /** Strongly consistent read of an operator flag (the shared kill switch). */
  getFlag(key: string): Promise<boolean>;
}

/** Infrastructure failure (not a limit being reached). Callers must fail closed for billable work. */
export class UsageStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageStoreError";
  }
}

export function createMemoryUsageStore(now: () => number = Date.now): UsageStore & { setFlag(key: string, on: boolean): void } {
  const counters = new Map<string, { n: number; exp: number }>();
  const leases = new Map<string, { until: number; owner: string }>();
  const flags = new Map<string, boolean>();
  const live = (key: string) => {
    const e = counters.get(key);
    if (e && e.exp <= now()) {
      counters.delete(key);
      return undefined;
    }
    return e;
  };
  return {
    kind: "memory",
    async incrementIfBelow(key, limit, ttlSec) {
      const e = live(key);
      const n = e?.n ?? 0;
      if (limit <= 0 || n + 1 > limit) return { ok: false, count: n };
      counters.set(key, { n: n + 1, exp: now() + ttlSec * 1000 });
      return { ok: true, count: n + 1 };
    },
    async addIfWithin(key, amount, cap, ttlSec) {
      const e = live(key);
      const total = e?.n ?? 0;
      if (amount > cap || total + amount > cap) return { ok: false, total };
      counters.set(key, { n: total + amount, exp: now() + ttlSec * 1000 });
      return { ok: true, total: total + amount };
    },
    async add(key, delta, ttlSec) {
      const e = live(key);
      counters.set(key, { n: (e?.n ?? 0) + delta, exp: now() + ttlSec * 1000 });
    },
    async acquireLease(prefix, slots, leaseMs, owner) {
      for (let i = 0; i < slots; i++) {
        const k = `${prefix}#${i}`;
        const l = leases.get(k);
        if (!l || l.until <= now()) {
          leases.set(k, { until: now() + leaseMs, owner });
          return i;
        }
      }
      return null;
    },
    async releaseLease(prefix, slot, owner) {
      const k = `${prefix}#${slot}`;
      if (leases.get(k)?.owner === owner) leases.set(k, { until: 0, owner });
    },
    async getFlag(key) {
      return flags.get(key) === true;
    },
    setFlag(key, on) {
      flags.set(key, on);
    },
  };
}
