export type ChatMessage = { role: "user" | "assistant"; content: string };

export type ChatRequest = {
  system: string;
  messages: ChatMessage[];
  maxOutputTokens: number;
  /** Optional sampling temperature (0 to 1). Providers default to a low value when absent. */
  temperature?: number;
};

export type TokenUsage = { inputTokens: number; outputTokens: number };

export type ChatResponse = {
  text: string;
  /** null when the provider could not report usage (then the full reservation is kept). */
  usage: TokenUsage | null;
  stopReason?: string;
};

/**
 * Whether a failed call may have been billed.
 * - not_billed: the provider rejected the request before any inference (safe to refund).
 * - unknown: timeout, network loss, server error, crash. Treated as billed at the reserved maximum.
 */
export type FailureOutcome = "not_billed" | "unknown";

export class ProviderError extends Error {
  constructor(message: string, readonly outcome: FailureOutcome, readonly code: string = "provider_error") {
    super(message);
    this.name = "ProviderError";
  }
}

export interface ChatProvider {
  readonly id: "mock" | "bedrock";
  /** True if a call can cost money. Billable calls go through the full reservation pipeline. */
  readonly billable: boolean;
  invoke(request: ChatRequest, opts: { signal: AbortSignal }): Promise<ChatResponse>;
}
