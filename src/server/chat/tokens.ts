import type { ChatRequest } from "./types";

/**
 * Deliberately pessimistic token estimate: one token per 2 UTF-8 bytes. Real tokenizers average
 * about 4 characters per token for English, so this over-counts and rejects early rather than late.
 * It is an input guard only: the cost RESERVATION always assumes the configured maximum input.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(Buffer.byteLength(text, "utf8") / 2);
}

export function estimateRequestTokens(req: Pick<ChatRequest, "system" | "messages">): number {
  return estimateTokens(req.system) + req.messages.reduce((n, m) => n + estimateTokens(m.content) + 4, 0);
}
