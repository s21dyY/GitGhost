import { describe, expect, it } from "vitest";
import { bedrockReadiness, loadChatConfig, type ChatConfig } from "./config";

const ok = (env: Record<string, string | undefined>): ChatConfig => {
  const r = loadChatConfig(env);
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.config;
};

describe("defaults (initial development values, not verified production-safe values)", () => {
  it("Bedrock is off and the provider is the mock", () => {
    expect(ok({})).toMatchObject({
      bedrockEnabled: false, provider: "mock", killSwitch: false,
      maxInputTokens: 4000, maxOutputTokens: 300, perClientPerMinute: 5, globalPerDay: 100,
      globalConcurrency: 2, dailyBudgetMicros: 1_000_000, inputUsdPerMTok: null, outputUsdPerMTok: null,
    });
  });
  it("reads the values in .env.local style", () => {
    const c = ok({
      GITGHOST_BEDROCK_ENABLED: "false", GITGHOST_CHAT_PROVIDER: "mock", GITGHOST_MAX_OUTPUT_TOKENS: "300",
      GITGHOST_MAX_INPUT_TOKENS: "4000", GITGHOST_CHAT_REQUESTS_PER_MINUTE: "5", GITGHOST_CHAT_REQUESTS_PER_DAY: "100",
      GITGHOST_DAILY_BUDGET_USD: "1.00",
    });
    expect(c.dailyBudgetMicros).toBe(1_000_000);
  });
  it("accepts overrides and a zero budget", () => {
    expect(ok({ GITGHOST_DAILY_BUDGET_USD: "0.25" }).dailyBudgetMicros).toBe(250_000);
    expect(ok({ GITGHOST_DAILY_BUDGET_USD: "0" }).dailyBudgetMicros).toBe(0);
    expect(ok({ GITGHOST_CHAT_REQUESTS_PER_DAY: "0" }).globalPerDay).toBe(0);
  });
});

describe("invalid configuration is an error, never a silent default", () => {
  it.each([
    ["GITGHOST_BEDROCK_ENABLED", "yes"],
    ["GITGHOST_BEDROCK_ENABLED", "TRUE!"],
    ["GITGHOST_BEDROCK_KILL_SWITCH", "maybe"],
    ["GITGHOST_CHAT_PROVIDER", "openai"],
    ["GITGHOST_MAX_OUTPUT_TOKENS", "-5"],
    ["GITGHOST_MAX_OUTPUT_TOKENS", "0"],
    ["GITGHOST_MAX_OUTPUT_TOKENS", "300.5"],
    ["GITGHOST_MAX_INPUT_TOKENS", "1e3"],
    ["GITGHOST_MAX_INPUT_TOKENS", "999999999"],
    ["GITGHOST_CHAT_REQUESTS_PER_MINUTE", "abc"],
    ["GITGHOST_CHAT_CONCURRENCY", "0"],
    ["GITGHOST_DAILY_BUDGET_USD", "$1"],
    ["GITGHOST_DAILY_BUDGET_USD", "-1"],
    ["GITGHOST_DAILY_BUDGET_USD", "NaN"],
    ["GITGHOST_BEDROCK_INPUT_USD_PER_MTOK", "free"],
    ["GITGHOST_BUDGET_SAFETY_FACTOR", "0.5"],
    ["GITGHOST_USAGE_STORE", "redis"],
    ["GITGHOST_USAGE_TABLE", "bad name!"],
  ])("%s=%s", (name, value) => {
    const r = loadChatConfig({ [name]: value });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toContain(name);
  });

  it("a malformed budget never becomes a larger budget", () => {
    const r = loadChatConfig({ GITGHOST_DAILY_BUDGET_USD: "oops" });
    expect(r.ok).toBe(false);
  });
});

describe("Bedrock readiness (only relevant when Bedrock is selected)", () => {
  const good = {
    GITGHOST_BEDROCK_ENABLED: "true", GITGHOST_CHAT_PROVIDER: "bedrock", BEDROCK_MODEL_ID: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    AWS_REGION: "us-east-2", GITGHOST_BEDROCK_INPUT_USD_PER_MTOK: "1", GITGHOST_BEDROCK_OUTPUT_USD_PER_MTOK: "5",
    GITGHOST_USAGE_TABLE: "gitghost-usage-counters",
  };
  it("passes with model, region, prices and a shared store", () => {
    expect(bedrockReadiness(ok(good))).toEqual([]);
  });
  it.each([
    ["BEDROCK_MODEL_ID", undefined, /BEDROCK_MODEL_ID/],
    ["AWS_REGION", undefined, /AWS_REGION/],
    ["GITGHOST_BEDROCK_INPUT_USD_PER_MTOK", undefined, /PER_MTOK/],
    ["GITGHOST_BEDROCK_OUTPUT_USD_PER_MTOK", undefined, /PER_MTOK/],
    ["GITGHOST_USAGE_TABLE", undefined, /shared usage store/],
  ])("missing %s", (name, value, pattern) => {
    expect(bedrockReadiness(ok({ ...good, [name]: value })).join(" ")).toMatch(pattern);
  });
  it("the memory store is refused in production", () => {
    const c = ok({ ...good, GITGHOST_USAGE_TABLE: undefined, GITGHOST_USAGE_STORE: "memory", NODE_ENV: "production" });
    expect(bedrockReadiness(c).join(" ")).toMatch(/not allowed in production/);
    expect(bedrockReadiness(ok({ ...good, GITGHOST_USAGE_TABLE: undefined, GITGHOST_USAGE_STORE: "memory", NODE_ENV: "development" }))).toEqual([]);
  });
});
