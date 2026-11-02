import type { ChatConfig } from "./config";
import type { TokenUsage } from "./types";

/**
 * Money is kept in integer micro-dollars (1 USD = 1,000,000). USD per million tokens equals
 * micro-dollars per token, so cost = tokens * price, then the safety factor, rounded UP.
 */
export function costMicros(usage: TokenUsage, c: Pick<ChatConfig, "inputUsdPerMTok" | "outputUsdPerMTok" | "budgetSafetyFactor">): number {
  if (c.inputUsdPerMTok === null || c.outputUsdPerMTok === null) throw new Error("Prices are not configured.");
  return Math.ceil((usage.inputTokens * c.inputUsdPerMTok + usage.outputTokens * c.outputUsdPerMTok) * c.budgetSafetyFactor);
}

/** Worst case for one request: the maximum input and maximum output allowed by configuration. */
export function maxRequestCostMicros(c: ChatConfig): number {
  return costMicros({ inputTokens: c.maxInputTokens, outputTokens: c.maxOutputTokens }, c);
}

export function utcDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}
