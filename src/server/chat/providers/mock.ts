import { createHash } from "node:crypto";
import { estimateRequestTokens, estimateTokens } from "../tokens";
import type { ChatProvider, ChatRequest, ChatResponse } from "../types";

/** Deterministic, offline stand-in. No network, no AWS, no cost. */
export function createMockProvider(): ChatProvider {
  return {
    id: "mock",
    billable: false,
    async invoke(request: ChatRequest, opts): Promise<ChatResponse> {
      if (opts.signal.aborted) throw new DOMException("Aborted", "AbortError");
      const last = request.messages[request.messages.length - 1]?.content ?? "";
      const tag = createHash("sha256").update(request.system).update("\u0000").update(last).digest("hex").slice(0, 8);
      const text = `[mock ${tag}] This is a scripted placeholder reply. No model was called.`;
      return {
        text,
        usage: { inputTokens: estimateRequestTokens(request), outputTokens: estimateTokens(text) },
        stopReason: "mock",
      };
    },
  };
}
