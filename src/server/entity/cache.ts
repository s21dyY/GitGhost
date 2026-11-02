import type { EntityAssignment } from "@/domain/entity";

/**
 * Saved identities never change (first write wins, there is no update path), so a successful
 * lookup is safe to cache. Only persisted identities are cached: never provisional or error
 * results. TTL and size are bounded so a manually deleted record cannot linger forever.
 */
export type IdentityCache = { get(repoId: number): EntityAssignment | undefined; set(a: EntityAssignment): void; size(): number };

export function createIdentityCache(opts: { max?: number; ttlMs?: number; now?: () => number } = {}): IdentityCache {
  const max = opts.max ?? 500;
  const ttl = opts.ttlMs ?? 24 * 3_600_000;
  const now = opts.now ?? Date.now;
  const map = new Map<number, { a: EntityAssignment; at: number }>();
  return {
    get(repoId) {
      const e = map.get(repoId);
      if (!e) return undefined;
      if (now() - e.at > ttl) {
        map.delete(repoId);
        return undefined;
      }
      return e.a;
    },
    set(a) {
      map.delete(a.repoId);
      map.set(a.repoId, { a, at: now() });
      while (map.size > max) {
        const oldest = map.keys().next().value;
        if (oldest === undefined) break;
        map.delete(oldest);
      }
    },
    size: () => map.size,
  };
}

/**
 * After a store failure, skip the store for a cooldown instead of making every page view wait
 * and retry. Together with the SDK's 2 attempts, this bounds retries.
 */
export type StoreBreaker = { isOpen(): boolean; recordFailure(): void; recordSuccess(): void };

export function createStoreBreaker(opts: { cooldownMs?: number; now?: () => number } = {}): StoreBreaker {
  const cooldown = opts.cooldownMs ?? 30_000;
  const now = opts.now ?? Date.now;
  let openUntil = 0;
  return {
    isOpen: () => now() < openUntil,
    recordFailure() {
      openUntil = now() + cooldown;
    },
    recordSuccess() {
      openUntil = 0;
    },
  };
}

const KEY = Symbol.for("gitghost.identityState");
type State = { cache: IdentityCache; breaker: StoreBreaker };
type G = typeof globalThis & { [KEY]?: State };

export function getIdentityState(): State {
  const g = globalThis as G;
  return (g[KEY] ??= { cache: createIdentityCache(), breaker: createStoreBreaker() });
}
