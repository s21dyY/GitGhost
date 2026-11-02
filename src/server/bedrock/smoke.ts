import { ConverseCommand, type BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";

/**
 * Isolated Bedrock Converse smoke test. Not used by any route or page.
 * One tiny, billable call; guarded so it can never run by accident.
 */
export const APPROVAL_FLAG = "--i-approve-one-billable-call";
export const SMOKE_MAX_TOKENS = 16;
const PROMPT = "Reply with exactly one word: ok";

export type SmokeConfig = { region: string; modelId: string };

/** Live generation is enabled by LIVE_GENERATION_ENABLED (legacy: GITGHOST_LIVE_BEDROCK). */
export function liveGenerationEnabled(env: Record<string, string | undefined>): boolean {
  const v = (env.LIVE_GENERATION_ENABLED ?? env.GITGHOST_LIVE_BEDROCK ?? "").trim().toLowerCase();
  return v === "1" || v === "true";
}

export type Preconditions = { ok: true; config: SmokeConfig } | { ok: false; reason: string };

export function checkSmokePreconditions(
  env: Record<string, string | undefined>,
  argv: readonly string[],
): Preconditions {
  if (!liveGenerationEnabled(env)) {
    return { ok: false, reason: "Live generation is disabled. Set LIVE_GENERATION_ENABLED=1 to allow a billable call." };
  }
  if (!argv.includes(APPROVAL_FLAG)) {
    return { ok: false, reason: `Missing explicit approval. Re-run with ${APPROVAL_FLAG}.` };
  }
  const region = env.AWS_REGION?.trim();
  if (!region || !/^[a-z]{2}-[a-z]+-\d$/.test(region)) {
    return { ok: false, reason: "AWS_REGION must be set explicitly (for example us-east-2). No default is assumed." };
  }
  const modelId = env.BEDROCK_MODEL_ID?.trim();
  if (!modelId || !/^[A-Za-z0-9._:-]{3,200}$/.test(modelId)) {
    return { ok: false, reason: "BEDROCK_MODEL_ID must be set to a model or inference-profile ID from your account." };
  }
  if (/^\d{12}$/.test(env.AWS_PROFILE?.trim() ?? "")) {
    return { ok: false, reason: "AWS_PROFILE looks like an account number, not a profile name. Unset it or use a name from `aws configure list-profiles`." };
  }
  return { ok: true, config: { region, modelId } };
}

export type SmokeResult = {
  modelId: string;
  region: string;
  text: string;
  stopReason: string | undefined;
  clientLatencyMs: number;
  serverLatencyMs: number | undefined;
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  totalTokens: number | undefined;
};

export async function runConverseSmoke(
  client: Pick<BedrockRuntimeClient, "send">,
  config: SmokeConfig,
  now: () => number = () => performance.now(),
): Promise<SmokeResult> {
  const started = now();
  const res = await client.send(
    new ConverseCommand({
      modelId: config.modelId,
      messages: [{ role: "user", content: [{ text: PROMPT }] }],
      inferenceConfig: { maxTokens: SMOKE_MAX_TOKENS, temperature: 0 },
    }),
  );
  const clientLatencyMs = Math.round(now() - started);
  const text = (res.output?.message?.content ?? [])
    .map((c) => ("text" in c && typeof c.text === "string" ? c.text : ""))
    .join("")
    .trim();
  return {
    modelId: config.modelId,
    region: config.region,
    text,
    stopReason: res.stopReason,
    clientLatencyMs,
    serverLatencyMs: res.metrics?.latencyMs,
    inputTokens: res.usage?.inputTokens,
    outputTokens: res.usage?.outputTokens,
    totalTokens: res.usage?.totalTokens,
  };
}
