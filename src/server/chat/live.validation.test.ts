import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { describe, expect, it } from "vitest";
import { checkCeilings, getPlan, runPlan } from "./validation-harness";

/**
 * OPT-IN, BILLABLE. Milestone 2C.2. Does nothing unless BOTH are set in the shell:
 *   GITGHOST_LIVE_VALIDATION=1
 *   GITGHOST_LIVE_VALIDATION_ACK=I_ACCEPT_COST_UP_TO_0.02_USD
 * plus GITGHOST_VALIDATION_PLAN (claude-haiku-4-5 or nova-lite; there is no default, because the
 * authorization names the model) and the full chat configuration. It runs the approved calls of that
 * plan through the normal pipeline, one at a time, stops at the first failure and never retries.
 * The report goes to .local/2c2/ (git-ignored) and contains no credentials. NOT RUN until the
 * owner approves the infrastructure, pricing and spend ceiling.
 */
const on = process.env.GITGHOST_LIVE_VALIDATION === "1" && process.env.GITGHOST_LIVE_VALIDATION_ACK === "I_ACCEPT_COST_UP_TO_0.02_USD";
const scrub = (s: string) => s.replace(/\b\d{12}\b/g, "<acct>");

describe.skipIf(!on)("controlled real-model validation (opt-in, billable)", () => {
  it("runs the approved plan (GITGHOST_VALIDATION_PLAN) against the repository the plan names", async () => {
    const env = process.env;
    // No default plan: the owner's authorization names the model, so the plan must be named explicitly.
    const vp = getPlan(env.GITGHOST_VALIDATION_PLAN);
    const problems = checkCeilings(env, vp);
    if (problems.length) throw new Error(`Refusing to run: ${problems.join(" ")}`);
    const table = env.GITGHOST_USAGE_TABLE!;
    const dynamo = new DynamoDBClient({ region: env.AWS_REGION, ...(env.GITGHOST_BEDROCK_AWS_PROFILE ? { profile: env.GITGHOST_BEDROCK_AWS_PROFILE } : {}) });
    const day = new Date().toISOString().slice(0, 10);
    const read = async (pk: string) => {
      const r = await dynamo.send(new GetItemCommand({ TableName: table, Key: { pk: { S: pk } }, ConsistentRead: true }));
      return r.Item?.v?.N === undefined ? null : Number(r.Item.v.N);
    };
    const report = await runPlan({
      deps: { env },
      validationPlan: vp,
      owner: vp.repo?.owner ?? "atom",
      repo: vp.repo?.name ?? "atom",
      headers: { get: () => null },
      counters: async () => ({ budgetMicros: await read(`BUDGET#${day}`), requests: await read(`REQ#bedrock#${day}`) }),
    });
    const dir = join(process.cwd(), ".local", "2c2");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `run-${report.startedAt.replace(/[:.]/g, "-")}.json`);
    writeFileSync(file, scrub(JSON.stringify(report, null, 2)));
    console.log(`report: ${file}`);
    console.log(JSON.stringify({ stoppedEarly: report.stoppedEarly, totals: report.totals, statuses: report.calls.map((c) => `${c.id}:${c.status}`) }, null, 1));
    expect(report.totals.calls).toBeLessThanOrEqual(vp.calls.length);
  }, 900_000);
});
