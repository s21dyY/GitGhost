import { ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { describe, expect, it, vi } from "vitest";
import {
  APPROVAL_FLAG,
  SMOKE_MAX_TOKENS,
  checkSmokePreconditions,
  liveGenerationEnabled,
  runConverseSmoke,
} from "./smoke";

const GOOD = {
  LIVE_GENERATION_ENABLED: "1",
  AWS_REGION: "us-east-2",
  BEDROCK_MODEL_ID: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
};

describe("smoke preconditions", () => {
  it("refuses unless live generation is enabled", () => {
    expect(checkSmokePreconditions({ ...GOOD, LIVE_GENERATION_ENABLED: "0" }, [APPROVAL_FLAG]).ok).toBe(false);
    expect(checkSmokePreconditions({ ...GOOD, LIVE_GENERATION_ENABLED: undefined }, [APPROVAL_FLAG]).ok).toBe(false);
  });

  it("refuses without the explicit approval flag", () => {
    const r = checkSmokePreconditions(GOOD, []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain(APPROVAL_FLAG);
  });

  it("requires an explicit region and a model ID, with no defaults", () => {
    expect(checkSmokePreconditions({ ...GOOD, AWS_REGION: undefined }, [APPROVAL_FLAG]).ok).toBe(false);
    expect(checkSmokePreconditions({ ...GOOD, AWS_REGION: "nowhere" }, [APPROVAL_FLAG]).ok).toBe(false);
    expect(checkSmokePreconditions({ ...GOOD, BEDROCK_MODEL_ID: "" }, [APPROVAL_FLAG]).ok).toBe(false);
    expect(checkSmokePreconditions({ ...GOOD, BEDROCK_MODEL_ID: "bad id; rm -rf" }, [APPROVAL_FLAG]).ok).toBe(false);
  });

  it("flags an AWS_PROFILE that is an account number", () => {
    expect(checkSmokePreconditions({ ...GOOD, AWS_PROFILE: "123456789012" }, [APPROVAL_FLAG]).ok).toBe(false);
    expect(checkSmokePreconditions({ ...GOOD, AWS_PROFILE: "default" }, [APPROVAL_FLAG]).ok).toBe(true);
  });

  it("passes with everything set, and accepts the legacy flag name", () => {
    expect(checkSmokePreconditions(GOOD, [APPROVAL_FLAG])).toEqual({
      ok: true,
      config: { region: "us-east-2", modelId: GOOD.BEDROCK_MODEL_ID },
    });
    expect(liveGenerationEnabled({ GITGHOST_LIVE_BEDROCK: "1" })).toBe(true);
    expect(liveGenerationEnabled({ LIVE_GENERATION_ENABLED: "true" })).toBe(true);
    expect(liveGenerationEnabled({})).toBe(false);
  });
});

describe("runConverseSmoke", () => {
  it("sends one tiny, deterministic Converse request and reports usage and latency", async () => {
    const send = vi.fn(async () => ({
      output: { message: { role: "assistant", content: [{ text: " ok " }] } },
      stopReason: "end_turn",
      usage: { inputTokens: 14, outputTokens: 2, totalTokens: 16 },
      metrics: { latencyMs: 420 },
    }));
    let t = 1000;
    const result = await runConverseSmoke({ send } as never, { region: "us-east-2", modelId: GOOD.BEDROCK_MODEL_ID }, () => (t += 500));
    expect(send).toHaveBeenCalledTimes(1);
    const cmd = (send.mock.calls[0] as unknown[])[0] as ConverseCommand;
    expect(cmd).toBeInstanceOf(ConverseCommand);
    expect(cmd.input.modelId).toBe(GOOD.BEDROCK_MODEL_ID);
    expect(cmd.input.inferenceConfig).toEqual({ maxTokens: SMOKE_MAX_TOKENS, temperature: 0 });
    expect(SMOKE_MAX_TOKENS).toBeLessThanOrEqual(32);
    expect(result).toMatchObject({
      text: "ok", stopReason: "end_turn", clientLatencyMs: 500, serverLatencyMs: 420,
      inputTokens: 14, outputTokens: 2, totalTokens: 16,
    });
  });

  it("tolerates missing usage and empty content without inventing values", async () => {
    const send = vi.fn(async () => ({ output: { message: { role: "assistant", content: [] } } }));
    const r = await runConverseSmoke({ send } as never, { region: "us-east-2", modelId: "x.y-z" });
    expect(r.text).toBe("");
    expect(r.inputTokens).toBeUndefined();
    expect(r.serverLatencyMs).toBeUndefined();
  });
});
