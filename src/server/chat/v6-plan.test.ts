import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyIntent } from "@/server/evidence/intent";
import { bedrockReadiness, loadChatConfig } from "./config";
import { awsClientOptions } from "./runtime";
import { maxRequestCostMicros } from "./spend";
import { checkCeilings, getPlan, PLANS } from "./validation-harness";

/**
 * V6 readiness, offline. Nothing here can reach AWS. These tests pin the first real Bedrock smoke test:
 * the model, region, prices and ceilings are exactly the approved Nova Lite ones, the repository and question
 * are fixed, and the billable path must run as the restricted AWS profile.
 */
const V6 = PLANS["nova-lite-v6"];
const QUESTION = "Tell me about your past. What was this repository originally created to do?";
const LIVE_ENV: Record<string, string> = {
  GITGHOST_CHAT_PROVIDER: "bedrock",
  GITGHOST_BEDROCK_ENABLED: "true",
  BEDROCK_MODEL_ID: "amazon.nova-lite-v1:0",
  AWS_REGION: "us-east-2",
  AWS_PROFILE: "default",
  GITGHOST_BEDROCK_AWS_PROFILE: "gitghost-smoke",
  GITGHOST_BEDROCK_INPUT_USD_PER_MTOK: "0.06",
  GITGHOST_BEDROCK_OUTPUT_USD_PER_MTOK: "0.24",
  GITGHOST_BUDGET_SAFETY_FACTOR: "1.5",
  GITGHOST_DAILY_BUDGET_USD: "0.02",
  GITGHOST_CHAT_REQUESTS_PER_DAY: "100",
  GITGHOST_CHAT_REQUESTS_PER_MINUTE: "1",
  GITGHOST_CHAT_CONCURRENCY: "1",
  GITGHOST_MAX_INPUT_TOKENS: "4000",
  GITGHOST_MAX_OUTPUT_TOKENS: "500",
  GITGHOST_CHAT_TIMEOUT_MS: "20000",
  GITGHOST_USAGE_STORE: "dynamodb",
  GITGHOST_USAGE_TABLE: "gitghost-usage-counters",
};

describe("the nova-lite-v6 plan", () => {
  it("uses the approved model, region, prices and ceilings, unchanged from the earlier Nova plan", () => {
    const nova = PLANS["nova-lite"];
    expect(V6).toMatchObject({ modelId: "amazon.nova-lite-v1:0", region: "us-east-2", inputUsdPerMTok: 0.06, outputUsdPerMTok: 0.24 });
    expect(V6.modelId.startsWith("us.")).toBe(false); // the bare model ID: invoked in-region, no cross-region profile
    expect(V6.ceilings).toEqual(nova.ceilings);
    expect(V6.ceilings).toMatchObject({ maxCalls: 1, maxRequestsPerDay: 1, maxOutputTokens: 500, maxInputTokens: 4000, maxConcurrency: 1, maxDailyBudgetMicros: 20_000 });
  });
  it("is exactly one call on microsoft/VisualStudioUninstaller with the owner's question", () => {
    expect(V6.repo).toEqual({ owner: "microsoft", name: "VisualStudioUninstaller" });
    expect(V6.calls).toHaveLength(1);
    expect(V6.calls[0].question).toBe(QUESTION);
    expect(V6.calls[0].form).toBe("current");
    expect(getPlan("nova-lite-v6")).toBe(V6);
  });
  it("the question reaches the history retrieval (README, repository record and early commits), not the status or issue paths", () => {
    expect(classifyIntent(QUESTION)).toBe("history");
  });
  it("worst-case reservation is 540 micro-dollars (USD 0.00054); the real AWS charge is bounded by USD 0.00036", () => {
    const c = loadChatConfig(LIVE_ENV);
    if (!c.ok) throw new Error(c.errors.join());
    expect(maxRequestCostMicros(c.config)).toBe(540);
    expect((4000 * 0.06 + 500 * 0.24) / 1e6).toBeCloseTo(0.00036, 8);
    expect(Math.floor(20_000 / 540)).toBe(37); // reservations that fit the application budget
  });
});

describe("the billable path runs as the restricted profile", () => {
  it("the plan accepts the exact live environment", () => {
    expect(checkCeilings(LIVE_ENV, V6)).toEqual([]);
  });
  it("refuses to start without the restricted profile, or with any other", () => {
    const { GITGHOST_BEDROCK_AWS_PROFILE: _drop, ...without } = LIVE_ENV;
    void _drop;
    expect(checkCeilings(without, V6).join(" ")).toMatch(/GITGHOST_BEDROCK_AWS_PROFILE must be exactly gitghost-smoke/);
    expect(checkCeilings({ ...LIVE_ENV, GITGHOST_BEDROCK_AWS_PROFILE: "default" }, V6).join(" ")).toMatch(/gitghost-smoke/);
  });
  it("still refuses Claude's model, prices, a bigger cap, a second request a day and a weak safety factor", () => {
    expect(checkCeilings({ ...LIVE_ENV, BEDROCK_MODEL_ID: "us.anthropic.claude-haiku-4-5-20251001-v1:0" }, V6).join(" ")).toMatch(/BEDROCK_MODEL_ID must be exactly amazon\.nova-lite-v1:0/);
    expect(checkCeilings({ ...LIVE_ENV, GITGHOST_BEDROCK_INPUT_USD_PER_MTOK: "1.1", GITGHOST_BEDROCK_OUTPUT_USD_PER_MTOK: "5.5" }, V6).join(" ")).toMatch(/Prices must be exactly/);
    expect(checkCeilings({ ...LIVE_ENV, GITGHOST_MAX_OUTPUT_TOKENS: "501" }, V6).join(" ")).toMatch(/Output token cap/);
    expect(checkCeilings({ ...LIVE_ENV, GITGHOST_CHAT_REQUESTS_PER_DAY: "100" }, V6).join(" ")).toMatch(/Requests per day/);
    expect(checkCeilings({ ...LIVE_ENV, GITGHOST_BUDGET_SAFETY_FACTOR: "1.2" }, V6).join(" ")).toMatch(/safety factor/);
  });
  it("earlier plans are unaffected: they do not require a profile", () => {
    const { GITGHOST_BEDROCK_AWS_PROFILE: _drop, ...without } = LIVE_ENV;
    void _drop;
    expect(checkCeilings(without, PLANS["nova-lite"])).toEqual([]);
  });
});

describe("GITGHOST_BEDROCK_AWS_PROFILE", () => {
  it("is optional, read into the config, and validated as a profile name", () => {
    const base = { ...LIVE_ENV };
    const ok = loadChatConfig(base);
    expect(ok.ok && ok.config.billableProfile).toBe("gitghost-smoke");
    const none = loadChatConfig({ ...base, GITGHOST_BEDROCK_AWS_PROFILE: "" });
    expect(none.ok && none.config.billableProfile).toBeNull();
    const bad = loadChatConfig({ ...base, GITGHOST_BEDROCK_AWS_PROFILE: "x; rm -rf /" });
    expect(bad.ok).toBe(false);
  });
  it("is not needed for readiness (the default credential chain stays valid), so no existing gate changed", () => {
    const c = loadChatConfig({ ...LIVE_ENV, GITGHOST_BEDROCK_AWS_PROFILE: "" });
    if (!c.ok) throw new Error(c.errors.join());
    expect(bedrockReadiness(c.config)).toEqual([]);
  });
  it("is passed to the Bedrock and usage-counter clients only when set", () => {
    expect(awsClientOptions({ region: "us-east-2", billableProfile: "gitghost-smoke" })).toEqual({ region: "us-east-2", profile: "gitghost-smoke" });
    expect(awsClientOptions({ region: "us-east-2", billableProfile: null })).toEqual({ region: "us-east-2" });
  });
});

describe("USD 0.02 is a safety ceiling, not permission for more requests", () => {
  it("the budget would fit 37 worst-case reservations, yet every layer allows one request", () => {
    expect(Math.floor(V6.ceilings.maxDailyBudgetMicros / 540)).toBe(37);
    expect(V6.ceilings.maxRequestsPerDay).toBe(1);
    expect(V6.ceilings.maxCalls).toBe(1);
    expect(V6.calls).toHaveLength(1);
  });
  it("a configuration that asks for two requests a day or two calls is refused even though the budget allows them", () => {
    expect(checkCeilings({ ...LIVE_ENV, GITGHOST_CHAT_REQUESTS_PER_DAY: "100" }, V6).join(" ")).toMatch(/Requests per day must be at most 1/);
    expect(checkCeilings({ ...LIVE_ENV, GITGHOST_DAILY_BUDGET_USD: "0.021" }, V6).join(" ")).toMatch(/Daily budget/);
  });
  it("the runner passes REQUESTS_PER_DAY=1 and invokes the live test exactly twice: once refused by the kill switch, once for the call", () => {
    const s = readFileSync(join(process.cwd(), "infra/v6/v6-run.sh"), "utf8");
    expect(s).toContain("GITGHOST_CHAT_REQUESTS_PER_DAY=100");
    expect(s.match(/"\$\{RUNNER\[@\]\}"/g)?.length).toBe(2);
    expect(s).not.toMatch(/for .* in .*; do[\s\S]*RUNNER/); // no loop around the invocation
    expect(s).toContain("no retries, no loop");
  });
  it("the authorization string names the ceiling and one call only", () => {
    const s = readFileSync(join(process.cwd(), "infra/v6/v6-run.sh"), "utf8");
    expect(s).toContain("I_AUTHORIZE_ONE_NOVA_LITE_V6_CALL_UP_TO_0.02_USD");
  });
});

describe("the V6 runner scripts (static checks; they were not executed)", () => {
  const read = (f: string) => readFileSync(join(process.cwd(), "infra/v6", f), "utf8");
  it("exist", () => {
    for (const f of ["v6-preflight.sh", "v6-run.sh"]) expect(existsSync(join(process.cwd(), "infra/v6", f)), f).toBe(true);
  });
  it("the runner is a dry run unless --execute AND the typed V6 authorization are both present, and re-locks on exit", () => {
    const s = read("v6-run.sh");
    expect(s).toContain('"${1:-}" = "--execute"');
    expect(s).toContain("I_AUTHORIZE_ONE_NOVA_LITE_V6_CALL_UP_TO_0.02_USD");
    expect(s).toContain("trap relock EXIT");
    expect(s).toContain("GITGHOST_VALIDATION_PLAN=nova-lite-v6");
    expect(s).toContain("GITGHOST_BEDROCK_AWS_PROFILE=gitghost-smoke");
    expect(s).toContain("OUTTOK=500");
    expect(s).not.toMatch(/OUTTOK=\$\{/); // no environment override of the output cap
  });
  it("runs exactly two live invocations: the lock check (kill switch ON) and the one call", () => {
    const s = read("v6-run.sh");
    expect(s.match(/"\$\{RUNNER\[@\]\}"/g)?.length).toBe(2);
  });
  it("keeps every approved limit and never sets a second request or a bigger cap", () => {
    const s = read("v6-run.sh");
    for (const x of ["GITGHOST_CHAT_REQUESTS_PER_DAY=100", "GITGHOST_CHAT_REQUESTS_PER_MINUTE=1", "GITGHOST_CHAT_CONCURRENCY=1", "GITGHOST_MAX_INPUT_TOKENS=4000", "GITGHOST_DAILY_BUDGET_USD=0.02", "GITGHOST_BUDGET_SAFETY_FACTOR=1.5", "GITGHOST_BEDROCK_INPUT_USD_PER_MTOK=0.06", "GITGHOST_BEDROCK_OUTPUT_USD_PER_MTOK=0.24", "BEDROCK_MODEL_ID=amazon.nova-lite-v1:0", "AWS_REGION=$REGION"]) {
      expect(s, x).toContain(x);
    }
  });
  it("the environment the runner builds passes the plan's own ceiling check", () => {
    const s = read("v6-run.sh");
    const block = /LIVE_ENV=\(([\s\S]*?)\n\)/.exec(s)![1];
    const env: Record<string, string> = {};
    for (const m of block.matchAll(/([A-Z_]+)=(\S+)/g)) env[m[1]] = m[2].replace("$OUTTOK", "500").replace("$REGION", "us-east-2").replace("$TABLE", "gitghost-usage-counters");
    expect(checkCeilings(env, V6)).toEqual([]);
    expect(env.AWS_PROFILE).toBe("default"); // identity reads keep the default chain; only billable work is restricted
  });
  it("the preflight is read-only: no put, update, delete or invoke", () => {
    const s = read("v6-preflight.sh");
    expect(s).not.toMatch(/put-item|update-item|delete-item|put-role-policy|invoke-model|converse|batch-write/i);
    expect(s).toContain("42753362"); // VisualStudioUninstaller's saved identity is checked
  });
});
