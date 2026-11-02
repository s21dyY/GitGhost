/**
 * Chat and Bedrock cost-control configuration. Fail closed: a malformed value is an error, never
 * silently replaced with a default, and any error makes chat unavailable.
 * Defaults are initial development values, NOT verified production-safe values.
 */
type Env = Record<string, string | undefined>;

export type ChatProviderId = "mock" | "bedrock";
export type UsageStoreKind = "dynamodb" | "memory";

export type ChatConfig = {
  bedrockEnabled: boolean;
  provider: ChatProviderId;
  /** Environment kill switch. A shared-store kill switch is checked as well (see service). */
  killSwitch: boolean;
  maxInputTokens: number;
  maxOutputTokens: number;
  perClientPerMinute: number;
  globalPerDay: number;
  globalConcurrency: number;
  dailyBudgetMicros: number;
  /** Price inputs for the cost estimate. No defaults: they must come from the operator. */
  inputUsdPerMTok: number | null;
  outputUsdPerMTok: number | null;
  /** Multiplier applied to every cost estimate and reconciliation, to cover price or token drift. */
  budgetSafetyFactor: number;
  timeoutMs: number;
  modelId: string | null;
  region: string | null;
  usageStore: UsageStoreKind | null;
  usageTable: string | null;
  /**
   * Optional named AWS profile used ONLY for billable work (the Bedrock call and the shared usage counters).
   * Identity storage keeps the default credential chain. Lets the billable path run as the restricted role
   * while the rest of the app keeps its existing credentials. Null means the default chain for everything.
   */
  billableProfile: string | null;
  production: boolean;
};

export type ConfigResult = { ok: true; config: ChatConfig } | { ok: false; errors: string[] };

function bool(env: Env, name: string, fallback: boolean, errors: string[]): boolean {
  const raw = env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  errors.push(`${name} must be true or false.`);
  return fallback;
}

function int(env: Env, name: string, fallback: number, min: number, max: number, errors: string[]): number {
  const raw = env[name]?.trim();
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(n) || n < min || n > max) {
    errors.push(`${name} must be a whole number from ${min} to ${max}.`);
    return fallback;
  }
  return n;
}

function decimal(env: Env, name: string, min: number, max: number, errors: string[]): number | null {
  const raw = env[name]?.trim();
  if (raw === undefined || raw === "") return null;
  const n = Number(raw);
  if (!/^\d+(\.\d+)?$/.test(raw) || !Number.isFinite(n) || n < min || n > max) {
    errors.push(`${name} must be a number from ${min} to ${max}.`);
    return null;
  }
  return n;
}

export function loadChatConfig(env: Env = process.env): ConfigResult {
  const errors: string[] = [];
  const bedrockEnabled = bool(env, "GITGHOST_BEDROCK_ENABLED", false, errors);
  const killSwitch = bool(env, "GITGHOST_BEDROCK_KILL_SWITCH", false, errors);

  const rawProvider = (env.GITGHOST_CHAT_PROVIDER ?? "mock").trim().toLowerCase();
  let provider: ChatProviderId = "mock";
  if (rawProvider === "mock" || rawProvider === "bedrock") provider = rawProvider;
  else errors.push('GITGHOST_CHAT_PROVIDER must be "mock" or "bedrock".');

  const budgetUsd = decimal(env, "GITGHOST_DAILY_BUDGET_USD", 0, 1000, errors) ?? (env.GITGHOST_DAILY_BUDGET_USD?.trim() ? 0 : 1);
  const factor = decimal(env, "GITGHOST_BUDGET_SAFETY_FACTOR", 1, 10, errors) ?? 1.25;

  const rawStore = env.GITGHOST_USAGE_STORE?.trim().toLowerCase();
  let usageStore: UsageStoreKind | null = null;
  const usageTable = env.GITGHOST_USAGE_TABLE?.trim() || null;
  if (rawStore === "memory" || rawStore === "dynamodb") usageStore = rawStore;
  else if (rawStore) errors.push('GITGHOST_USAGE_STORE must be "dynamodb" or "memory".');
  else if (usageTable) usageStore = "dynamodb";
  if (usageTable && !/^[A-Za-z0-9_.-]{3,255}$/.test(usageTable)) errors.push("GITGHOST_USAGE_TABLE is not a valid table name.");

  const profile = env.GITGHOST_BEDROCK_AWS_PROFILE?.trim() || null;
  if (profile && !/^[A-Za-z0-9_.-]{1,64}$/.test(profile)) errors.push("GITGHOST_BEDROCK_AWS_PROFILE is not a valid profile name.");
  const config: ChatConfig = {
    bedrockEnabled,
    provider,
    killSwitch,
    maxInputTokens: int(env, "GITGHOST_MAX_INPUT_TOKENS", 4000, 1, 200_000, errors),
    maxOutputTokens: int(env, "GITGHOST_MAX_OUTPUT_TOKENS", 300, 1, 8_000, errors),
    perClientPerMinute: int(env, "GITGHOST_CHAT_REQUESTS_PER_MINUTE", 5, 1, 1000, errors),
    globalPerDay: int(env, "GITGHOST_CHAT_REQUESTS_PER_DAY", 100, 0, 1_000_000, errors),
    globalConcurrency: int(env, "GITGHOST_CHAT_CONCURRENCY", 2, 1, 20, errors),
    dailyBudgetMicros: Math.round(budgetUsd * 1_000_000),
    inputUsdPerMTok: decimal(env, "GITGHOST_BEDROCK_INPUT_USD_PER_MTOK", 0, 10_000, errors),
    outputUsdPerMTok: decimal(env, "GITGHOST_BEDROCK_OUTPUT_USD_PER_MTOK", 0, 10_000, errors),
    budgetSafetyFactor: factor,
    timeoutMs: int(env, "GITGHOST_CHAT_TIMEOUT_MS", 20_000, 1000, 120_000, errors),
    modelId: env.BEDROCK_MODEL_ID?.trim() || null,
    region: env.AWS_REGION?.trim() || null,
    usageStore,
    usageTable,
    billableProfile: profile,
    production: env.NODE_ENV === "production",
  };
  return errors.length ? { ok: false, errors } : { ok: true, config };
}

/**
 * Extra requirements that apply only when the billable provider is actually selected and enabled.
 * Returns problems; an empty list means Bedrock may be used.
 */
export function bedrockReadiness(c: ChatConfig): string[] {
  const problems: string[] = [];
  if (!c.modelId || !/^[A-Za-z0-9._:-]{3,200}$/.test(c.modelId)) problems.push("BEDROCK_MODEL_ID must be set to a model or inference-profile ID.");
  if (!c.region || !/^[a-z]{2}-[a-z]+-\d$/.test(c.region)) problems.push("AWS_REGION must be set explicitly.");
  if (c.inputUsdPerMTok === null || c.outputUsdPerMTok === null) {
    problems.push("GITGHOST_BEDROCK_INPUT_USD_PER_MTOK and GITGHOST_BEDROCK_OUTPUT_USD_PER_MTOK must be set (no default prices are assumed).");
  }
  if (c.usageStore === null) problems.push("A shared usage store is required: set GITGHOST_USAGE_TABLE (DynamoDB).");
  if (c.usageStore === "memory" && c.production) problems.push("The in-memory usage store is not allowed in production for billable requests.");
  if (c.usageStore === "dynamodb" && !c.usageTable) problems.push("GITGHOST_USAGE_TABLE is required for the DynamoDB usage store.");
  return problems;
}
