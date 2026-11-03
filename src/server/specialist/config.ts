/**
 * The Specialist: code explanation by its own model on Amazon Bedrock (Nova Lite or Claude), offered as the player
 * opens the ghost's code: the codebase at a glance, then each file, then each part they choose.
 * It runs through the SAME guarded path as chat (runChat: kill switch, concurrency lease, rate limit, request cap,
 * budget reservation), with its own model, prices, limits and counters. Off unless GITGHOST_SPECIALIST_ENABLED is true,
 * and unavailable until a model and its prices are configured: prices are never guessed.
 *
 *   GITGHOST_SPECIALIST_ENABLED          true | false (default false)
 *   SPECIALIST_MODEL_ID                  e.g. us.anthropic.claude-sonnet-5-5 (an inference profile)
 *   SPECIALIST_INPUT_USD_PER_MTOK        required, from the AWS price list
 *   SPECIALIST_OUTPUT_USD_PER_MTOK       required, from the AWS price list
 *   SPECIALIST_MAX_INPUT_TOKENS          default 12000 (smaller than chat: the model costs more)
 *   SPECIALIST_MAX_OUTPUT_TOKENS         default 1500
 *   SPECIALIST_REQUESTS_PER_DAY          default 300
 *   SPECIALIST_REQUESTS_PER_MINUTE       default 8 per visitor (readings come as the player opens code; answers are cached)
 *   SPECIALIST_DAILY_BUDGET_USD          default 1.00 (separate from chat's budget)
 * Chat's own switches still apply: GITGHOST_BEDROCK_ENABLED, the env kill switch, the shared KILL#bedrock flag.
 */
type Env = Record<string, string | undefined>;

export type SpecialistUnavailable = { ok: false; code: "specialist_disabled" | "specialist_not_configured" | "bedrock_disabled"; message: string };
export type SpecialistReady = { ok: true; modelId: string; env: Env };

const UNREACHABLE = "The Specialist cannot be reached right now.";
const num = (v: string | undefined) => (v !== undefined && /^\d+(\.\d+)?$/.test(v.trim()) ? Number(v.trim()) : null);

/**
 * Whether the Specialist may run, and the environment runChat should use for it: the chat settings with the
 * Specialist's model, prices and limits put in their place. Never reads or returns credentials.
 */
export function specialistReadiness(env: Env = process.env): SpecialistReady | SpecialistUnavailable {
  if ((env.GITGHOST_SPECIALIST_ENABLED ?? "").trim().toLowerCase() !== "true") return { ok: false, code: "specialist_disabled", message: UNREACHABLE };
  if ((env.GITGHOST_BEDROCK_ENABLED ?? "").trim().toLowerCase() !== "true") return { ok: false, code: "bedrock_disabled", message: UNREACHABLE };
  const modelId = env.SPECIALIST_MODEL_ID?.trim() ?? "";
  const input = num(env.SPECIALIST_INPUT_USD_PER_MTOK);
  const output = num(env.SPECIALIST_OUTPUT_USD_PER_MTOK);
  if (!/^[A-Za-z0-9._:-]{3,200}$/.test(modelId) || input === null || output === null) return { ok: false, code: "specialist_not_configured", message: UNREACHABLE };
  const or = (name: string, fallback: string) => env[name]?.trim() || fallback;
  return {
    ok: true,
    modelId,
    env: {
      ...env,
      GITGHOST_CHAT_PROVIDER: "bedrock",
      BEDROCK_MODEL_ID: modelId,
      GITGHOST_BEDROCK_INPUT_USD_PER_MTOK: String(input),
      GITGHOST_BEDROCK_OUTPUT_USD_PER_MTOK: String(output),
      GITGHOST_MAX_INPUT_TOKENS: or("SPECIALIST_MAX_INPUT_TOKENS", "12000"),
      GITGHOST_MAX_OUTPUT_TOKENS: or("SPECIALIST_MAX_OUTPUT_TOKENS", "1500"),
      GITGHOST_CHAT_REQUESTS_PER_DAY: or("SPECIALIST_REQUESTS_PER_DAY", "300"),
      GITGHOST_CHAT_REQUESTS_PER_MINUTE: or("SPECIALIST_REQUESTS_PER_MINUTE", "8"),
      GITGHOST_DAILY_BUDGET_USD: or("SPECIALIST_DAILY_BUDGET_USD", "1.00"),
    },
  };
}
