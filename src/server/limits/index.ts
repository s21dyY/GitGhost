import { createCreationBudget, type CreationBudget } from "./budget";
import { createRateLimiter, type RateLimiter } from "./rate-limit";

export * from "./budget";
export * from "./client-key";
export * from "./rate-limit";

function intFromEnv(env: Record<string, string | undefined>, name: string, fallback: number, min: number, max: number): number {
  const n = Number(env[name]);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

export type Limits = {
  summonPage: RateLimiter;
  summonApi: RateLimiter;
  /** Process-wide caps that hold even if every request claims a different identity. */
  summonPageGlobal: RateLimiter;
  summonApiGlobal: RateLimiter;
  /** In-process gate in front of chat's GitHub retrieval. Never looser than the chat limit itself. */
  chatApi: RateLimiter;
  chatApiGlobal: RateLimiter;
  /** Reading the ghost's code (file list and files). Looser than summoning: a visitor opens many files. */
  codeApi: RateLimiter;
  codeApiGlobal: RateLimiter;
  creationBudget: CreationBudget;
};

export function createLimits(env: Record<string, string | undefined> = process.env, now?: () => number): Limits {
  const off = ["0", "false", "off"].includes((env.IDENTITY_CREATION_ENABLED ?? "").trim().toLowerCase());
  return {
    summonPage: createRateLimiter({
      limit: intFromEnv(env, "SUMMON_PAGE_LIMIT", 60, 1, 10_000),
      windowMs: intFromEnv(env, "SUMMON_PAGE_WINDOW_MIN", 10, 1, 1440) * 60_000,
      now,
    }),
    summonApi: createRateLimiter({ limit: intFromEnv(env, "SUMMON_API_LIMIT", 20, 1, 10_000), windowMs: 60_000, now }),
    summonPageGlobal: createRateLimiter({
      limit: intFromEnv(env, "SUMMON_PAGE_GLOBAL_LIMIT", 600, 1, 1_000_000),
      windowMs: intFromEnv(env, "SUMMON_PAGE_WINDOW_MIN", 10, 1, 1440) * 60_000,
      maxKeys: 1,
      now,
    }),
    summonApiGlobal: createRateLimiter({ limit: intFromEnv(env, "SUMMON_API_GLOBAL_LIMIT", 120, 1, 1_000_000), windowMs: 60_000, maxKeys: 1, now }),
    chatApi: createRateLimiter({ limit: intFromEnv(env, "GITGHOST_CHAT_REQUESTS_PER_MINUTE", 5, 1, 1000), windowMs: 60_000, now }),
    chatApiGlobal: createRateLimiter({ limit: intFromEnv(env, "GITGHOST_CHAT_API_GLOBAL_PER_MINUTE", 30, 1, 100_000), windowMs: 60_000, maxKeys: 1, now }),
    codeApi: createRateLimiter({ limit: intFromEnv(env, "CODE_API_LIMIT", 60, 1, 10_000), windowMs: 60_000, now }),
    codeApiGlobal: createRateLimiter({ limit: intFromEnv(env, "CODE_API_GLOBAL_LIMIT", 300, 1, 1_000_000), windowMs: 60_000, maxKeys: 1, now }),
    creationBudget: createCreationBudget({
      enabled: !off,
      perHour: intFromEnv(env, "IDENTITY_CREATES_PER_HOUR", 200, 0, 100_000),
      perClientPerHour: intFromEnv(env, "IDENTITY_CREATES_PER_CLIENT_PER_HOUR", 20, 0, 10_000),
      now,
    }),
  };
}

const KEY = Symbol.for("gitghost.limits");
type G = typeof globalThis & { [KEY]?: Limits };

/** Process-wide singleton (survives module duplication between Next route bundles). */
export function getLimits(): Limits {
  const g = globalThis as G;
  // A long-running dev server may hold limits built before a limiter was added: rebuild rather than crash.
  if (!g[KEY] || !("codeApi" in g[KEY])) g[KEY] = createLimits();
  return g[KEY];
}

/** Test helper. */
export function resetLimitsForTests(): void {
  delete (globalThis as G)[KEY];
}
