import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bedrockReadiness, loadChatConfig } from "./config";
import { maxRequestCostMicros } from "./spend";

/** The prepared (not applied) limit profiles for development and demo use. Offline: nothing is loaded or run. */
const read = (f: string) => {
  const env: Record<string, string> = {};
  for (const line of readFileSync(join(process.cwd(), "infra/v6/profiles", f), "utf8").split("\n")) {
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (m) env[m[1]] = m[2];
  }
  return env;
};
const known = new Set([...readFileSync(join(process.cwd(), ".env.example"), "utf8").matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]));
const cases = [
  { file: "dev.env", perDay: 3, perMinute: 1, budgetMicros: 3_000 },
  { file: "demo.env", perDay: 8, perMinute: 2, budgetMicros: 6_000 },
] as const;

describe.each(cases)("profile $file", ({ file, perDay, perMinute, budgetMicros }) => {
  const env = read(file);
  const loaded = loadChatConfig(env);
  if (!loaded.ok) throw new Error(loaded.errors.join());
  const c = loaded.config;
  it("is a valid, ready Bedrock configuration that uses only variables the project knows", () => {
    expect(bedrockReadiness(c)).toEqual([]);
    for (const k of Object.keys(env)) expect(known.has(k) || k === "AWS_PROFILE", k).toBe(true);
  });
  it(`allows ${perDay} requests a day, ${perMinute} a minute, one at a time`, () => {
    expect([c.globalPerDay, c.perClientPerMinute, c.globalConcurrency]).toEqual([perDay, perMinute, 1]);
  });
  it("keeps the approved model, prices, token caps, timeout and safety factor", () => {
    expect(c).toMatchObject({ modelId: "amazon.nova-lite-v1:0", region: "us-east-2", inputUsdPerMTok: 0.06, outputUsdPerMTok: 0.24, maxInputTokens: 4000, maxOutputTokens: 500, timeoutMs: 20_000, budgetSafetyFactor: 1.5, billableProfile: "gitghost-smoke" });
  });
  it("has a low budget ceiling that fits the day's requests even if every one timed out (full reservation kept), so the day cap is what binds", () => {
    const reserve = maxRequestCostMicros(c);
    expect(reserve).toBe(540);
    expect(c.dailyBudgetMicros).toBe(budgetMicros);
    expect(reserve * perDay).toBeLessThanOrEqual(c.dailyBudgetMicros);
    expect(c.dailyBudgetMicros).toBeLessThanOrEqual(10_000); // never above USD 0.01
  });
  it("bounds the real AWS charge for the whole day", () => {
    const perCallUsd = (4000 * 0.06 + 500 * 0.24) / 1e6; // USD 0.00036
    expect(perCallUsd * perDay).toBeLessThan(0.003);
  });
  it("never turns the environment kill switch off by omission, and does not touch the shared one", () => {
    expect(env.GITGHOST_BEDROCK_KILL_SWITCH).toBe("false"); // the env switch must be explicit; the shared KILL#bedrock lives in DynamoDB
    expect(Object.keys(env).some((k) => /SECRET|TOKEN|KEY|PASSWORD/i.test(k) && !/MAX_|_TOKENS|PER_MTOK/.test(k))).toBe(false);
  });
  it("sets no retry knob anywhere: the application has none, and the Bedrock client is built with a single attempt", () => {
    expect(Object.keys(env).some((k) => /RETR|ATTEMPT/i.test(k))).toBe(false);
  });
});
