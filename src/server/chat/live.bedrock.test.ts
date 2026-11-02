import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { describe, expect, it } from "vitest";
import { createBedrockProvider } from "./providers/bedrock";

/**
 * OPT-IN, BILLABLE live check. It does not run unless BOTH are set in the shell:
 *   GITGHOST_LIVE_BEDROCK_TESTS=1  GITGHOST_LIVE_BEDROCK_TESTS_ACK=I_ACCEPT_COST
 * plus AWS_REGION and BEDROCK_MODEL_ID. This switch is deliberately separate from the runtime
 * flag GITGHOST_BEDROCK_ENABLED, which the app uses. It bypasses the app's budget pipeline, so
 * run it only for a single tiny call. NOT RUN in Milestone 2B.
 */
const on = process.env.GITGHOST_LIVE_BEDROCK_TESTS === "1" && process.env.GITGHOST_LIVE_BEDROCK_TESTS_ACK === "I_ACCEPT_COST";

describe.skipIf(!on)("live Bedrock provider (opt-in, billable)", () => {
  it("answers one tiny request", async () => {
    const region = process.env.AWS_REGION;
    const modelId = process.env.BEDROCK_MODEL_ID;
    if (!region || !modelId) throw new Error("AWS_REGION and BEDROCK_MODEL_ID are required.");
    const provider = createBedrockProvider({ client: new BedrockRuntimeClient({ region }), modelId });
    const out = await provider.invoke(
      { system: "Reply with one word.", messages: [{ role: "user", content: "ok?" }], maxOutputTokens: 16 },
      { signal: AbortSignal.timeout(20_000) },
    );
    expect(out.text.length).toBeGreaterThan(0);
    expect(out.usage?.outputTokens).toBeLessThanOrEqual(16);
  }, 30_000);
});
