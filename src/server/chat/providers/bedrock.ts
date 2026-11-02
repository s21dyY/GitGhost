import { ConverseCommand, type BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { ProviderError, type ChatProvider, type ChatRequest, type ChatResponse } from "../types";

/**
 * Only errors that describe a bad REQUEST (nothing could have run) may be refunded, and only when
 * the HTTP status confirms a client error (4xx). ASSUMPTION, not verified against AWS documentation
 * here: these are not billed. Everything else is treated as possibly billed at the reserved
 * maximum: timeouts, network loss, 5xx, stream errors, model errors, and anything unrecognized.
 * ThrottlingException is deliberately NOT in this list: a throttle can be reported by a layer that
 * has already started work, and a refund we cannot prove would weaken the spending cap.
 */
const REQUEST_REJECTED = new Set(["ValidationException", "AccessDeniedException", "ResourceNotFoundException"]);

export function classifyBedrockError(err: unknown): "not_billed" | "unknown" {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  const status = e?.$metadata?.httpStatusCode;
  return e?.name && REQUEST_REJECTED.has(e.name) && typeof status === "number" && status >= 400 && status < 500 ? "not_billed" : "unknown";
}

/**
 * Bedrock Converse provider. Only constructed when the runtime flag allows it, and only ever given
 * a client by the caller; this module never creates a client or reads credentials itself.
 */
export function createBedrockProvider(opts: {
  client: Pick<BedrockRuntimeClient, "send">;
  modelId: string;
}): ChatProvider {
  return {
    id: "bedrock",
    billable: true,
    async invoke(request: ChatRequest, { signal }): Promise<ChatResponse> {
      try {
        const res = await opts.client.send(
          new ConverseCommand({
            modelId: opts.modelId,
            system: [{ text: request.system }],
            messages: request.messages.map((m) => ({ role: m.role, content: [{ text: m.content }] })),
            inferenceConfig: { maxTokens: request.maxOutputTokens, temperature: Math.min(1, Math.max(0, request.temperature ?? 0.2)) },
          }),
          { abortSignal: signal },
        );
        const text = (res.output?.message?.content ?? [])
          .map((c) => ("text" in c && typeof c.text === "string" ? c.text : ""))
          .join("")
          .trim();
        const u = res.usage;
        return {
          text,
          usage:
            u && Number.isFinite(u.inputTokens) && Number.isFinite(u.outputTokens)
              ? { inputTokens: u.inputTokens as number, outputTokens: u.outputTokens as number }
              : null,
          stopReason: res.stopReason,
        };
      } catch (err) {
        const name = (err as { name?: string }).name ?? "Error";
        if (signal.aborted || name === "AbortError") throw new ProviderError("The model call was cancelled.", "unknown", "aborted");
        throw new ProviderError(`Bedrock call failed (${name}).`, classifyBedrockError(err), name);
      }
    },
  };
}
