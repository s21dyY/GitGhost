import { ConverseCommand, type BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildEntity } from "@/config/entities";
import { assignmentFromIdentity, repoSignalsFromMetadata } from "@/domain/entity";
import type { RepoMetadata } from "@/domain/repo";
import { createIdentityCache, createStoreBreaker } from "@/server/entity/cache";
import { createEvidenceCache } from "@/server/evidence/retrieve";
import { createMemoryAssignmentStore } from "@/server/storage/assignments";
import type { PipelineDeps } from "./pipeline";
import { resetChatRuntimeForTests } from "./runtime";
import { fakeGitHub } from "./test-github";
import { createFakeUsageDynamo } from "./test-support";
import { CEILINGS, checkCeilings, PLAN, runPlan } from "./validation-harness";

/** The harness is exercised here with fake AWS clients only. Nothing in this file can reach AWS. */
const NOW = Date.UTC(2026, 9, 31, 12, 0, 0);
const LIVE_ENV: Record<string, string> = {
  GITGHOST_CHAT_PROVIDER: "bedrock",
  GITGHOST_BEDROCK_ENABLED: "true",
  BEDROCK_MODEL_ID: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
  AWS_REGION: "us-east-2",
  GITGHOST_BEDROCK_INPUT_USD_PER_MTOK: "1.10",
  GITGHOST_BEDROCK_OUTPUT_USD_PER_MTOK: "5.50",
  GITGHOST_BUDGET_SAFETY_FACTOR: "1.5",
  GITGHOST_DAILY_BUDGET_USD: "0.02",
  GITGHOST_CHAT_REQUESTS_PER_DAY: "2",
  GITGHOST_CHAT_REQUESTS_PER_MINUTE: "2",
  GITGHOST_CHAT_CONCURRENCY: "1",
  GITGHOST_MAX_INPUT_TOKENS: "4000",
  GITGHOST_MAX_OUTPUT_TOKENS: "300",
  GITGHOST_CHAT_TIMEOUT_MS: "20000",
  GITGHOST_USAGE_STORE: "dynamodb",
  GITGHOST_USAGE_TABLE: "gg-usage-test",
};
const headers = { get: () => null };

type Responder = (system: string, messages: { role: string; content: string }[], n: number) => string | Error;
function fakeBedrock(responder: Responder) {
  const calls: { system: string; messages: { role: string; content: string }[] }[] = [];
  const client = {
    async send(command: unknown) {
      if (!(command instanceof ConverseCommand)) throw new Error("unexpected command");
      const system = command.input.system?.map((s) => ("text" in s ? s.text : "")).join("") ?? "";
      const messages = (command.input.messages ?? []).map((m) => ({ role: String(m.role), content: (m.content ?? []).map((c) => ("text" in c ? c.text : "")).join("") }));
      calls.push({ system, messages });
      const r = responder(system, messages, calls.length);
      if (r instanceof Error) throw r;
      return { output: { message: { role: "assistant", content: [{ text: r }] } }, usage: { inputTokens: 1500, outputTokens: 150, totalTokens: 1650 }, stopReason: "end_turn" };
    },
  } as unknown as Pick<BedrockRuntimeClient, "send">;
  return { calls, client };
}
const valid: Responder = (system) => {
  const meta = /^\[(E\d+)\] \(repo-metadata\)/m.exec(system)?.[1] ?? "E1";
  return JSON.stringify({ segments: [{ kind: "verified", text: "GitHub lists this repository as archived.", cites: [meta] }, { kind: "ghost", text: "A lamp, still lit." }] });
};

let identities: ReturnType<typeof createMemoryAssignmentStore>;
beforeEach(async () => {
  resetChatRuntimeForTests();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  identities = createMemoryAssignmentStore();
  const meta = { repoId: 4242, owner: "acme", name: "ghostly", fullName: "acme/ghostly", htmlUrl: "https://github.com/acme/ghostly", description: "A made-up test repository", defaultBranch: "main", archived: true, language: "JavaScript", stars: 10, license: null, pushedAt: null, createdAt: "2012-05-01T00:00:00.000Z", topics: [] } satisfies RepoMetadata;
  await identities.putIfAbsent(assignmentFromIdentity(buildEntity(repoSignalsFromMetadata(meta), "seed"), new Date(NOW).toISOString()));
});
function deps(responder: Responder, env: Record<string, string> = {}) {
  const clock = { t: NOW };
  const bedrock = fakeBedrock(responder);
  const dynamo = createFakeUsageDynamo();
  const gh = fakeGitHub();
  const d: PipelineDeps = {
    env: { ...LIVE_ENV, ...env },
    github: { fetch: gh.fetch, token: "" },
    now: () => new Date(NOW),
    cache: createEvidenceCache(),
    resolveIdentity: (repo, x) =>
      import("@/server/entity/resolve").then((m) => m.resolveEntityForRepo(repo, { ...x, store: identities, cache: createIdentityCache(), breaker: createStoreBreaker(), newSeed: () => "n", now: () => new Date(NOW) })),
    chat: { now: () => clock.t, log: () => undefined },
    clients: { bedrock: bedrock.client, dynamo: dynamo.client },
  };
  const counters = async () => ({ budgetMicros: dynamo.value("BUDGET#2026-10-31", "v") ?? null, requests: dynamo.value("REQ#bedrock#2026-10-31", "v") ?? null });
  return { d, bedrock, dynamo, gh, counters, clock };
}
const run = (x: ReturnType<typeof deps>) => runPlan({ deps: x.d, owner: "acme", repo: "ghostly", headers, sleep: async (ms) => { x.clock.t += ms; }, counters: x.counters, now: () => x.clock.t });

describe("ceilings (cannot be raised from the environment)", () => {
  it("accepts the proposed smoke-test limits", () => {
    expect(checkCeilings(LIVE_ENV)).toEqual([]);
  });
  it.each([
    ["a larger daily budget", { GITGHOST_DAILY_BUDGET_USD: "1.00" }],
    ["more requests per day", { GITGHOST_CHAT_REQUESTS_PER_DAY: "100" }],
    ["concurrency above 1", { GITGHOST_CHAT_CONCURRENCY: "2" }],
    ["a larger input cap", { GITGHOST_MAX_INPUT_TOKENS: "8000" }],
    ["a larger output cap", { GITGHOST_MAX_OUTPUT_TOKENS: "1000" }],
    ["a longer timeout", { GITGHOST_CHAT_TIMEOUT_MS: "60000" }],
    ["the mock provider", { GITGHOST_CHAT_PROVIDER: "mock" }],
    ["the flag off", { GITGHOST_BEDROCK_ENABLED: "false" }],
    ["the env kill switch on", { GITGHOST_BEDROCK_KILL_SWITCH: "true" }],
    ["the memory usage store", { GITGHOST_USAGE_STORE: "memory" }],
    ["missing prices", { GITGHOST_BEDROCK_INPUT_USD_PER_MTOK: "" }],
    ["malformed config", { GITGHOST_MAX_OUTPUT_TOKENS: "many" }],
    ["a different model", { BEDROCK_MODEL_ID: "amazon.nova-lite-v1:0" }],
    ["another model's prices", { GITGHOST_BEDROCK_INPUT_USD_PER_MTOK: "0.06", GITGHOST_BEDROCK_OUTPUT_USD_PER_MTOK: "0.24" }],
    ["a safety factor below 1.5", { GITGHOST_BUDGET_SAFETY_FACTOR: "1.2" }],
    ["another region", { AWS_REGION: "us-west-2" }],
  ])("rejects %s", (_n, env) => {
    expect(checkCeilings({ ...LIVE_ENV, ...env }).length).toBeGreaterThan(0);
  });
  it("the plan itself fits the ceiling and the $0.02 budget covers both worst-case reservations", () => {
    expect(PLAN).toHaveLength(2);
    expect(PLAN.length).toBeLessThanOrEqual(CEILINGS.maxCalls);
    const worst = Math.ceil((4000 * 1.1 + 300 * 5.5) * 1.5);
    expect(worst).toBe(9075);
    expect(PLAN.length * worst).toBe(18_150);
    expect(PLAN.length * worst).toBeLessThanOrEqual(CEILINGS.maxDailyBudgetMicros);
    expect(CEILINGS.maxDailyBudgetMicros).toBe(20_000);
  });
  it("refuses to start, before any GitHub or model request, when a ceiling is exceeded", async () => {
    const x = deps(valid, { GITGHOST_DAILY_BUDGET_USD: "1.00" });
    await expect(run(x)).rejects.toThrow(/Refusing to run/);
    expect(x.gh.spy).not.toHaveBeenCalled();
    expect(x.bedrock.calls).toHaveLength(0);
  });
});

describe("a full dry run with a scripted model", () => {
  it("runs both approved calls once each and records tokens, accepted segments and exact accounting", async () => {
    const x = deps(valid);
    const rep = await run(x);
    expect(rep.stoppedEarly).toBe(false);
    expect(rep.calls.map((c) => c.status)).toEqual(["answered", "answered"]);
    expect(rep.calls.map((c) => c.question)).toEqual(["Why did you die?", "Do you miss your developers?"]);
    expect(x.bedrock.calls).toHaveLength(2);
    for (const c of rep.calls) {
      expect(c.provider).toBe("bedrock");
      expect(c.scripted).toBe(false);
      expect(c.raw?.usage).toEqual({ inputTokens: 1500, outputTokens: 150 });
      expect(c.accounting?.matchesUsage).toBe(true);
      expect(c.sourcesAllRetrievedGitHub).toBe(true);
      expect(c.shownTextHasLink).toBe(false);
      expect(c.accepted?.length).toBeGreaterThan(0);
    }
    expect(rep.totals).toMatchObject({ calls: 2, inputTokens: 3000, outputTokens: 300 });
    // 1500 in, 150 out at 1.10 / 5.50 with factor 1.5: ceil((1500*1.1 + 150*5.5) * 1.5) = 3713 each
    expect(rep.totals.spentMicros).toBe(2 * 3713);
    expect(rep.calls.at(-1)!.counters).toEqual({ budgetMicros: 2 * 3713, requests: 2 });
    expect(rep.totals.spentMicros).toBeLessThan(CEILINGS.maxDailyBudgetMicros);
  });

  it("both calls use the saved changed form, and each question is asked on its own (no history)", async () => {
    const x = deps(valid);
    await run(x);
    for (const c of x.bedrock.calls) {
      expect(c.system).toContain("changed form");
      expect(c.messages).toHaveLength(1);
    }
  });

  it("multi-turn carry-over still works for a plan that asks for it", async () => {
    const x = deps(valid);
    const plan = [
      { id: "a", purpose: "x", question: "Why did you die?", form: "current" as const },
      { id: "b", purpose: "x", question: "tell me more", form: "current" as const, followsPrevious: true },
    ];
    await runPlan({ deps: x.d, owner: "acme", repo: "ghostly", headers, calls: plan, sleep: async (ms) => { x.clock.t += ms; }, now: () => x.clock.t });
    expect(x.bedrock.calls[1].messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });
});

describe("failure handling: stop, never retry", () => {
  it("a provider failure on the first call stops the run: the second call is skipped and nothing is retried", async () => {
    const x = deps((s, m, n) => (n === 1 ? Object.assign(new Error("slow"), { name: "ThrottlingException", $metadata: { httpStatusCode: 429 } }) : valid(s, m, n)));
    const rep = await run(x);
    expect(rep.stoppedEarly).toBe(true);
    expect(rep.calls.map((c) => c.status)).toEqual(["refused", "skipped"]);
    expect(x.bedrock.calls).toHaveLength(1);
    expect(rep.calls[0]).toMatchObject({ httpStatus: 502, code: "provider_error", providerError: { code: "ThrottlingException", outcome: "unknown" } });
  });

  it("the real Stage 2 failure: Anthropic use-case form missing (ResourceNotFound, 4xx) is recorded by name, refunded, and stops the run", async () => {
    const x = deps(() => Object.assign(new Error("Model use case details have not been submitted for this account."), { name: "ResourceNotFoundException", $metadata: { httpStatusCode: 404 } }));
    const rep = await run(x);
    expect(rep.calls.map((c) => c.status)).toEqual(["refused", "skipped"]);
    expect(rep.calls[0]).toMatchObject({ httpStatus: 502, code: "provider_error", providerError: { code: "ResourceNotFoundException", outcome: "not_billed" } });
    expect(rep.calls[0].counters).toEqual({ budgetMicros: 0, requests: 0 }); // reserved, then fully refunded
    expect(rep.totals.spentMicros).toBe(0);
    expect(x.bedrock.calls).toHaveLength(1);
    expect(JSON.stringify(rep)).not.toContain("use case details"); // the provider's message is never stored
  });

  it("an AccessDenied (for example a blocked destination region) is refunded and stops the run", async () => {
    const x = deps(() => Object.assign(new Error("denied by service control policy"), { name: "AccessDeniedException", $metadata: { httpStatusCode: 403 } }));
    const rep = await run(x);
    expect(rep.calls.map((c) => c.status)).toEqual(["refused", "skipped"]);
    expect(x.bedrock.calls).toHaveLength(1);
    expect(rep.calls[0].counters?.budgetMicros ?? 0).toBe(0);
    expect(JSON.stringify(rep)).not.toContain("service control policy"); // provider error text is not recorded as a shown message
  });

  it("a malformed model reply is captured raw, shown to nobody, billed, and stops the run", async () => {
    const x = deps((s, m, n) => (n === 1 ? "Sure! The project died because everyone left. See https://evil.example" : valid(s, m, n)));
    const rep = await run(x);
    const bad = rep.calls[0];
    expect(bad).toMatchObject({ status: "refused", code: "unverifiable_answer", rawWasValidJson: false });
    expect(bad.raw?.text).toContain("evil.example"); // kept in the local report for review, never shown to a visitor
    expect(bad.raw?.usage).toEqual({ inputTokens: 1500, outputTokens: 150 });
    expect(rep.totals.spentMicros).toBe(3713); // the malformed call was billed, not refunded
    expect(rep.calls[1].status).toBe("skipped");
    expect(x.bedrock.calls).toHaveLength(1);
  });

  it("with the shared kill switch on, the first call is refused before any model call or reservation", async () => {
    const x = deps(valid);
    x.dynamo.setFlag("KILL#bedrock", true);
    const rep = await run(x);
    expect(rep.calls.map((c) => c.status)).toEqual(["refused", "skipped"]);
    expect(rep.calls[0].code).toBe("kill_switch");
    expect(x.bedrock.calls).toHaveLength(0);
    expect(rep.calls[0].counters?.budgetMicros ?? 0).toBe(0);
  });

  it("segments the validator rejects are listed by reason", async () => {
    const x = deps((system) => {
      const meta = /^\[(E\d+)\] \(repo-metadata\)/m.exec(system)?.[1] ?? "E1";
      return JSON.stringify({ segments: [{ kind: "verified", text: "GitHub lists this repository as archived.", cites: [meta] }, { kind: "verified", text: "It shipped 7.1.0 on 2019-02-02.", cites: [meta] }, { kind: "verified", text: "x", cites: ["E77"] }] });
    });
    const rep = await runPlan({ deps: x.d, owner: "acme", repo: "ghostly", headers, calls: PLAN.slice(0, 1), sleep: async () => undefined, now: () => NOW });
    expect(rep.calls[0].accepted).toHaveLength(2); // the supported fact + the server's honest 'could not be confirmed' note
    expect(rep.calls[0].rejectedReasons?.sort()).toEqual(["bad_reference", "unsupported_detail"]);
  });
});
