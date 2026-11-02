import { createRateLimiter } from "./rate-limit";

export type BudgetDecision =
  | { ok: true }
  | { ok: false; reason: "creation_disabled" | "budget_exceeded" | "client_budget_exceeded" };

export type CreationBudget = { tryConsume(clientKey: string): BudgetDecision };

/**
 * Application-level budget for NEW identity writes (each is one DynamoDB write).
 * Reads of existing identities are never counted. Includes a kill switch.
 */
export function createCreationBudget(opts: {
  enabled: boolean;
  perHour: number;
  perClientPerHour: number;
  now?: () => number;
}): CreationBudget {
  const hour = 3_600_000;
  const global = createRateLimiter({ limit: opts.perHour, windowMs: hour, maxKeys: 1, now: opts.now });
  const perClient = createRateLimiter({ limit: opts.perClientPerHour, windowMs: hour, maxKeys: 5000, now: opts.now });
  return {
    tryConsume(clientKey) {
      if (!opts.enabled) return { ok: false, reason: "creation_disabled" };
      // Check both first so a denied request consumes nothing.
      if (!perClient.peek(clientKey).allowed) return { ok: false, reason: "client_budget_exceeded" };
      if (!global.peek("all").allowed) return { ok: false, reason: "budget_exceeded" };
      perClient.take(clientKey);
      global.take("all");
      return { ok: true };
    },
  };
}
