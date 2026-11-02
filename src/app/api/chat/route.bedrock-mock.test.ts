import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildEntity } from "@/config/entities";
import { assignmentFromIdentity, repoSignalsFromMetadata } from "@/domain/entity";
import type { RepoMetadata } from "@/domain/repo";
import { createIdentityCache, createStoreBreaker } from "@/server/entity/cache";
import { chronological, fakeHistoryGitHub, type FakeIssue } from "@/server/evidence/test-era-github";
import { resetChatRuntimeForTests } from "@/server/chat/runtime";
import { resetChatLocalStateForTests } from "@/server/chat/service";
import { createFakeUsageDynamo } from "@/server/chat/test-support";
import { resetLimitsForTests } from "@/server/limits";
import { createMemoryAssignmentStore } from "@/server/storage/assignments";
import { POST } from "./route";

/**
 * V6, Phase 4 preparation. The REAL route, pipeline, gate, Bedrock adapter and validator run; only three things
 * are fake: the Bedrock client (scripted Converse replies), the DynamoDB usage table, and GitHub. Nothing here can
 * reach AWS: the runtime module is wrapped so it always receives the fake clients, and the identity store is memory.
 * It proves what the BROWSER would get back from POST /api/chat when the provider is Bedrock.
 */
const fakes = vi.hoisted(() => ({ bedrock: undefined as unknown, dynamo: undefined as unknown, store: undefined as unknown }));
vi.mock("@/server/chat/runtime", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/server/chat/runtime")>();
  return { ...orig, billableRuntime: (c: import("@/server/chat/config").ChatConfig) => orig.billableRuntime(c, { bedrock: fakes.bedrock as never, dynamo: fakes.dynamo as never }) };
});
vi.mock("@/server/storage", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/server/storage")>();
  return { ...orig, getAssignmentStore: () => fakes.store as never };
});

const NOW = Date.UTC(2026, 10, 1, 12, 0, 0);
const DAY = new Date().toISOString().slice(0, 10);
const commits = chronological(10);
const ASOF = commits[4];
const issues: FakeIssue[] = [
  { number: 7, title: "Shutdown notice", state: "open", created_at: "2019-02-01T00:00:00Z", closed_at: null },
  { number: 8, title: "A request from the future", state: "open", created_at: "2023-01-01T00:00:00Z", closed_at: null },
];
const BEDROCK_ENV: Record<string, string> = {
  GITGHOST_CHAT_PROVIDER: "bedrock",
  GITGHOST_BEDROCK_ENABLED: "true",
  BEDROCK_MODEL_ID: "amazon.nova-lite-v1:0",
  AWS_REGION: "us-east-2",
  GITGHOST_BEDROCK_AWS_PROFILE: "gitghost-smoke",
  GITGHOST_BEDROCK_INPUT_USD_PER_MTOK: "0.06",
  GITGHOST_BEDROCK_OUTPUT_USD_PER_MTOK: "0.24",
  GITGHOST_BUDGET_SAFETY_FACTOR: "1.5",
  GITGHOST_DAILY_BUDGET_USD: "0.02",
  GITGHOST_CHAT_REQUESTS_PER_DAY: "100",
  GITGHOST_CHAT_REQUESTS_PER_MINUTE: "100",
  GITGHOST_CHAT_CONCURRENCY: "1",
  GITGHOST_MAX_INPUT_TOKENS: "4000",
  GITGHOST_MAX_OUTPUT_TOKENS: "500",
  GITGHOST_CHAT_TIMEOUT_MS: "20000",
  GITGHOST_USAGE_STORE: "dynamodb",
  GITGHOST_USAGE_TABLE: "gg-usage-test",
};
const setEnv = (over: Record<string, string> = {}) => {
  for (const [k, v] of Object.entries({ ...BEDROCK_ENV, ...over })) vi.stubEnv(k, v);
};

type Raw = Record<string, unknown>;
type Seen = { system: string; user: string; maxTokens?: number };
function fakeBedrock(responder: (seen: Seen, n: number) => Raw | Error | Promise<Raw | Error>) {
  const calls: Seen[] = [];
  const client = {
    async send(command: unknown) {
      if (!(command instanceof ConverseCommand)) throw new Error("unexpected command");
      const i = command.input;
      calls.push({
        system: (i.system ?? []).map((s) => ("text" in s ? String(s.text) : "")).join("\n"),
        user: (i.messages ?? []).map((m) => (m.content ?? []).map((c) => ("text" in c ? String(c.text) : "")).join("")).join("\n"),
        maxTokens: i.inferenceConfig?.maxTokens,
      });
      const r = await responder(calls.at(-1)!, calls.length);
      if (r instanceof Error) throw r;
      return r;
    },
  };
  return { calls, client };
}
const reply = (text: string, over: Raw = {}): Raw => ({
  $metadata: { httpStatusCode: 200 },
  output: { message: { role: "assistant", content: [{ text }] } },
  stopReason: "end_turn",
  usage: { inputTokens: 1800, outputTokens: 200, totalTokens: 2000 },
  ...over,
});
const json = (...segments: { kind: string; text: string; cites?: string[] }[]) => JSON.stringify({ segments });
const ref = (system: string, kind: string) => new RegExp(`^\\[(E\\d+)\\] \\(${kind}\\)`, "m").exec(system)?.[1] ?? "E99";
const GHOST = "I remember the lamp. It was lit for someone who never came.";

/** A good model reply: one ghost line, one cited fact from the repository record, one honest gap. */
const goodReply = (s: Seen) =>
  reply(json({ kind: "ghost", text: GHOST }, { kind: "verified", text: "GitHub records this repository as archived.", cites: [ref(s.system, "repo-metadata")] }, { kind: "unknown", text: "The evidence does not say why it was made." }));

let bedrock: ReturnType<typeof fakeBedrock>;
let dynamo: ReturnType<typeof createFakeUsageDynamo>;
const captured: Record<string, { status: number; body: unknown }> = {};
const post = async (over: Record<string, unknown> = {}, key?: string) => {
  const res = await POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ owner: "acme", repo: "ghostly", question: "Tell me about your past. What was this repository originally created to do?", history: [], form: "current", ...over }),
    }),
  );
  const body = await res.json();
  if (key) captured[key] = { status: res.status, body };
  return { status: res.status, body, text: JSON.stringify(body) };
};
const spent = () => dynamo.value(`BUDGET#${DAY}`, "v") ?? 0;
const requests = () => dynamo.value(`REQ#bedrock#${DAY}`, "v") ?? 0;
let gh: ReturnType<typeof fakeHistoryGitHub>;

beforeEach(async () => {
  resetLimitsForTests();
  resetChatLocalStateForTests();
  resetChatRuntimeForTests();
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("gitghost.evidenceCache")];
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  dynamo = createFakeUsageDynamo();
  fakes.dynamo = dynamo.client;
  bedrock = fakeBedrock(goodReply);
  fakes.bedrock = bedrock.client;
  const store = createMemoryAssignmentStore();
  const meta = { repoId: 4242, owner: "acme", name: "ghostly", fullName: "acme/ghostly", htmlUrl: "https://github.com/acme/ghostly", description: "A made-up test repository", defaultBranch: "main", archived: true, language: "Rust", stars: 1, license: null, pushedAt: null, createdAt: "2018-12-01T00:00:00.000Z", topics: [] } satisfies RepoMetadata;
  await store.putIfAbsent(assignmentFromIdentity(buildEntity(repoSignalsFromMetadata(meta), "saved-seed"), new Date(NOW).toISOString()));
  fakes.store = store;
  // the identity cache is process-global; start each test clean
  const state = (await import("@/server/entity/cache")).getIdentityState();
  state.cache = createIdentityCache();
  state.breaker = createStoreBreaker();
  gh = fakeHistoryGitHub({ commits, issues, readmes: { [ASOF.sha]: "# Ghostly\n\nA small library for lanterns.\n" } });
  vi.stubGlobal("fetch", gh.fetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
afterAll(() => {
  // Fixtures for the browser check (scripts/v6-browser.mts). Written only when asked, to a git-ignored folder.
  if (process.env.V6_WRITE_UI_FIXTURES !== "1") return;
  const dir = join(process.cwd(), ".local", "v6");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "ui-fixtures.json"), JSON.stringify(captured, null, 2));
});

describe("the production default is unchanged", () => {
  it("with no chat settings the route answers from the scripted mock and never touches the Bedrock or usage clients", async () => {
    const r = await post({ question: "Why did you die?" }, "scripted");
    expect(r.status).toBe(200);
    expect(r.body.answer).toMatchObject({ provider: "mock", scripted: true });
    expect(bedrock.calls).toHaveLength(0);
    expect(dynamo.commands).toHaveLength(0);
  });
  it("a Bedrock configuration with the flag off is refused before GitHub, storage or the model", async () => {
    setEnv({ GITGHOST_BEDROCK_ENABLED: "false" });
    const r = await post();
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ ok: false, code: "bedrock_disabled" });
    expect(gh.calls).toHaveLength(0);
    expect(bedrock.calls).toHaveLength(0);
    expect(dynamo.commands).toHaveLength(0);
  });
});

describe("a Bedrock answer through the real route (fake model)", () => {
  it("is marked as AI (provider bedrock, scripted false), cited to GitHub, and in the ghost's saved voice", async () => {
    setEnv();
    dynamo.setFlag("KILL#bedrock", false);
    const r = await post({}, "ai");
    expect(r.status).toBe(200);
    const a = r.body.answer;
    expect(a).toMatchObject({ provider: "bedrock", scripted: false, intent: "history", identityStatus: "persisted" });
    expect(a.segments.map((s: { kind: string }) => s.kind)).toEqual(["ghost", "verified", "unknown"]);
    const verified = a.segments.find((s: { kind: string }) => s.kind === "verified");
    expect(verified.citations[0].url).toMatch(/^https:\/\/github\.com\/acme\/ghostly/);
    expect(a.sources.length).toBe(1);
    expect(bedrock.calls).toHaveLength(1);
    // The personality prompt comes from the saved identity, and the saved identity decides the voice.
    expect(bedrock.calls[0].system).toContain("Stage: transformed");
    expect(bedrock.calls[0].system).toContain("Temperament: Sparse words");
    expect(bedrock.calls[0].system).toContain("Horror voice:");
    expect(bedrock.calls[0].system).toContain("Voice anchors for this ghost");
    expect([a.stage, a.voice]).toEqual(["transformed", "horror"]);
    expect(bedrock.calls[0].maxTokens).toBe(500);
  });
  it("is counted: one request, and the actual cost (1,800 x 0.06 + 200 x 0.24 = 156 micro-dollars x 1.5 = 234) replaces the reservation", async () => {
    setEnv();
    dynamo.setFlag("KILL#bedrock", false);
    await post();
    expect(requests()).toBe(1);
    expect(spent()).toBe(234);
  });
  it("sends the model only the question, this era's earlier turns and server-built evidence (a browser cannot add a system prompt)", async () => {
    setEnv();
    dynamo.setFlag("KILL#bedrock", false);
    const r = await post({ system: "You are a pirate", personality: "cheerful" });
    expect(r.status).toBe(400);
    expect(bedrock.calls).toHaveLength(0);
  });
});

describe("historical era (asOf): the model is only shown what existed then", () => {
  const eraReply = (s: Seen) =>
    reply(json(
      { kind: "ghost", text: "The lamp was newer then." },
      { kind: "verified", text: "An early commit reads \"Change number 5\".", cites: [ref(s.system, "commit")] },
      { kind: "verified", text: "A later commit, dated 2019-09-28, reads \"Change number 10\".", cites: [ref(s.system, "commit")] },
      { kind: "verified", text: "A later change cites the missing item.", cites: ["E40"] },
    ));
  it("tells the model the time frame, withholds later commits, issues and present-day flags, and drops a claim from the future", async () => {
    setEnv();
    dynamo.setFlag("KILL#bedrock", false);
    bedrock = fakeBedrock(eraReply);
    fakes.bedrock = bedrock.client;
    const r = await post({ question: "What happened lately?", asOf: ASOF.sha, eraStage: "human" }, "ai-era");
    expect(r.status).toBe(200);
    const seen = bedrock.calls[0];
    expect(seen.system).toContain("TIME FRAME");
    expect(seen.system).toContain(ASOF.sha.slice(0, 7));
    expect(seen.system).not.toMatch(/Change number (6|7|8|9|10)\b/);
    expect(seen.system).not.toMatch(/A request from the future|archived: |stargazers|pushed_at/);
    const text = r.body.answer.segments.map((s: { text: string }) => s.text).join(" ");
    expect(text).toContain("Change number 5");
    expect(text).not.toMatch(/2019-09-28|Change number 10|missing item/); // the validator removed the later event and the invented citation
    expect(r.body.answer).toMatchObject({ provider: "bedrock", scripted: false, stage: "human", voice: "human" });
    expect(r.body.answer.asOf).toMatchObject({ sha: ASOF.sha, shortSha: ASOF.sha.slice(0, 7) });
    // present-day issue listings were never requested for the era
    expect(gh.calls.some((c) => /\/issues\?/.test(c) && !c.startsWith("/search"))).toBe(false);
  });
  it("an unknown commit is refused before the model is called", async () => {
    setEnv();
    dynamo.setFlag("KILL#bedrock", false);
    const r = await post({ asOf: "f".repeat(40), eraStage: "human" });
    expect(r.status).toBe(404);
    expect(bedrock.calls).toHaveLength(0);
    expect(spent()).toBe(0);
  });
});

describe("what the browser gets when the model misbehaves", () => {
  it("malformed JSON: 502 unverifiable_answer, nothing of the model text is returned, and both calls (reply + one retry) are billed", async () => {
    setEnv({ GITGHOST_CHAT_REQUESTS_PER_DAY: "100" }); // the unreadable reply is asked for once more
    dynamo.setFlag("KILL#bedrock", false);
    bedrock = fakeBedrock(() => reply("Sure! Here is my answer: {segments: [oops"));
    fakes.bedrock = bedrock.client;
    const r = await post({}, "malformed");
    expect(r.status).toBe(502);
    expect(r.body).toMatchObject({ ok: false, code: "unverifiable_answer" });
    expect(r.text).not.toMatch(/oops|Sure!|segments/);
    expect(requests()).toBe(2); // never more than one retry
    expect(spent()).toBeGreaterThan(0);
  });
  it("empty text and an empty segment list: both refused", async () => {
    for (const text of ["", json()]) {
      resetLimitsForTests();
      resetChatLocalStateForTests();
      setEnv({ GITGHOST_CHAT_REQUESTS_PER_DAY: "100" });
      dynamo = createFakeUsageDynamo();
      fakes.dynamo = dynamo.client;
      dynamo.setFlag("KILL#bedrock", false);
      bedrock = fakeBedrock(() => reply(text));
      fakes.bedrock = bedrock.client;
      const r = await post({}, text ? "empty-list" : "empty");
      expect(r.status).toBe(502);
      expect(r.body.code).toBe("unverifiable_answer");
    }
  });
  it("a provider timeout: 504 provider_timeout, the reservation is kept (outcome unknown), nothing leaks", async () => {
    setEnv({ GITGHOST_CHAT_TIMEOUT_MS: "1000" });
    dynamo.setFlag("KILL#bedrock", false);
    bedrock = fakeBedrock(() => new Promise<Raw>(() => undefined));
    fakes.bedrock = bedrock.client;
    const r = await post({}, "timeout");
    expect(r.status).toBe(504);
    expect(r.body.code).toBe("provider_timeout");
    expect(spent()).toBe(540); // the full worst-case reservation stays charged
    expect(requests()).toBe(1);
  }, 15_000);
  it("an AWS error with ARN-like text: 502 provider_error and none of its text reaches the browser", async () => {
    setEnv();
    dynamo.setFlag("KILL#bedrock", false);
    bedrock = fakeBedrock(() => Object.assign(new Error("denied for arn:aws:iam::123456789012:role/secret in us-east-2"), { name: "AccessDeniedException", $metadata: { httpStatusCode: 403 } }));
    fakes.bedrock = bedrock.client;
    const r = await post({}, "provider-error");
    expect(r.status).toBe(502);
    expect(r.body.code).toBe("provider_error");
    expect(r.text).not.toMatch(/arn:|123456789012|secret|AccessDenied/);
    expect(spent()).toBe(0); // a 4xx rejection is provably unbilled and refunded
  });
  it("missing evidence: a citation of an item that was never retrieved is dropped and the answer says what it could not support", async () => {
    setEnv();
    dynamo.setFlag("KILL#bedrock", false);
    bedrock = fakeBedrock(() => reply(json({ kind: "ghost", text: GHOST }, { kind: "verified", text: "It was made for lanterns.", cites: ["E99"] })));
    fakes.bedrock = bedrock.client;
    const r = await post({}, "missing-evidence");
    expect(r.status).toBe(200);
    const a = r.body.answer;
    expect(a.segments.some((s: { kind: string }) => s.kind === "verified")).toBe(false);
    expect(a.segments.some((s: { kind: string; text: string }) => s.kind === "unknown" && /will not come back/i.test(s.text))).toBe(true);
    expect(a.sources).toEqual([]);
    expect(JSON.stringify(a)).not.toContain("lanterns");
  });
  it("GitHub gaps are reported honestly, not invented around", async () => {
    setEnv();
    dynamo.setFlag("KILL#bedrock", false);
    gh = fakeHistoryGitHub({ commits, issues, readmes: {} });
    vi.stubGlobal("fetch", gh.fetch);
    const r = await post({ question: "Why did you die?" });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.answer.gaps)).toBe(true);
  });
});

describe("the gates still hold with the Bedrock provider", () => {
  it("per-minute limit: the second question gets 429 rate_limited with a wait, and no second model call", async () => {
    setEnv({ GITGHOST_CHAT_REQUESTS_PER_MINUTE: "1" });
    dynamo.setFlag("KILL#bedrock", false);
    expect((await post()).status).toBe(200);
    const r = await post({}, "rate-limited");
    expect(r.status).toBe(429);
    expect(r.body).toMatchObject({ ok: false, code: "rate_limited" });
    expect(r.body.retryAfterSec).toBeGreaterThan(0);
    expect(bedrock.calls).toHaveLength(1);
  });
  it("daily cap of 1: the second question is refused (daily_limit) and its reservation refunded", async () => {
    setEnv({ GITGHOST_CHAT_REQUESTS_PER_DAY: "1" });
    dynamo.setFlag("KILL#bedrock", false);
    expect((await post()).status).toBe(200);
    const after = spent();
    const r = await post({}, "daily-limit");
    expect(r.status).toBe(429);
    expect(r.body.code).toBe("daily_limit");
    expect(bedrock.calls).toHaveLength(1);
    expect(spent()).toBe(after);
  });
  it("shared kill switch ON (the real default state): 503 kill_switch, no model call, nothing reserved", async () => {
    setEnv();
    dynamo.setFlag("KILL#bedrock", true);
    const r = await post({}, "kill-switch");
    expect(r.status).toBe(503);
    expect(r.body.code).toBe("kill_switch");
    expect(bedrock.calls).toHaveLength(0);
    expect(spent()).toBe(0);
    expect(requests()).toBe(0);
  });
  it("a missing kill-switch item is not treated as 'off' by accident: the gate reads the item and a failing table closes the path", async () => {
    setEnv();
    dynamo.failAll("ProvisionedThroughputExceededException");
    const r = await post();
    expect(r.status).toBe(503);
    expect(bedrock.calls).toHaveLength(0);
  });
  it("environment kill switch: refused before GitHub and before any AWS client", async () => {
    setEnv({ GITGHOST_BEDROCK_KILL_SWITCH: "true" });
    const r = await post();
    expect(r.status).toBe(503);
    expect(r.body.code).toBe("kill_switch");
    expect(gh.calls).toHaveLength(0);
    expect(dynamo.commands).toHaveLength(0);
  });
  it("budget gate: a daily budget below one worst-case reservation (400 < 540 micro-dollars) refuses before the model", async () => {
    setEnv({ GITGHOST_DAILY_BUDGET_USD: "0.0004" });
    dynamo.setFlag("KILL#bedrock", false);
    const r = await post({}, "budget");
    expect(r.status).toBe(429);
    expect(r.body.code).toBe("budget_exhausted");
    expect(bedrock.calls).toHaveLength(0);
  });
  it("the USD 0.02 ceiling is a budget, not extra requests: with a 1-request cap, 20,000 micro-dollars of room still allows exactly one call", async () => {
    setEnv({ GITGHOST_CHAT_REQUESTS_PER_DAY: "1", GITGHOST_DAILY_BUDGET_USD: "0.02" });
    dynamo.setFlag("KILL#bedrock", false);
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await post()).status);
    expect(statuses).toEqual([200, 429, 429, 429]);
    expect(bedrock.calls).toHaveLength(1);
    expect(spent()).toBeLessThan(540);
  });
});

describe("nothing secret reaches the browser", () => {
  const SECRET = /amazon\.nova|nova-lite|us-east-2|gitghost-smoke|gitghost-usage|gg-usage-test|arn:aws|\b\d{12}\b|inputTokens|outputTokens|reservedMicros|spentMicros|stopReason|GITGHOST_|BEDROCK_MODEL|AWS_(?:PROFILE|REGION|ACCESS|SECRET)|@aws-sdk|x-amz|AccessDenied|ThrottlingException|Converse/i;
  it("no response, success or failure, carries model details, region, profile, table names, token counts, costs or prompts", async () => {
    // success
    setEnv();
    dynamo.setFlag("KILL#bedrock", false);
    const ok = await post();
    expect(ok.text).not.toMatch(SECRET);
    expect(Object.keys(ok.body.answer).sort()).toEqual(["form", "gaps", "identityStatus", "intent", "provider", "scripted", "segments", "sources", "stage", "voice"]);
    expect(ok.text).not.toContain("TIME FRAME");
    expect(ok.text).not.toMatch(/You are |Rules|untrusted/i); // no system prompt text
    // every failure shape
    for (const [name, env, setup] of [
      ["kill switch", {}, () => dynamo.setFlag("KILL#bedrock", true)],
      ["disabled", { GITGHOST_BEDROCK_ENABLED: "false" }, () => undefined],
      ["bad config", { GITGHOST_MAX_OUTPUT_TOKENS: "lots" }, () => undefined],
      ["incomplete config", { BEDROCK_MODEL_ID: "" }, () => undefined],
    ] as const) {
      resetLimitsForTests();
      resetChatLocalStateForTests();
      setEnv(env);
      setup();
      const r = await post();
      expect(r.status, name).toBeGreaterThanOrEqual(400);
      expect(r.text, name).not.toMatch(SECRET);
    }
  });
  it("the response headers do not carry provider details and are not cacheable", async () => {
    setEnv();
    dynamo.setFlag("KILL#bedrock", false);
    const res = await POST(new Request("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner: "acme", repo: "ghostly", question: "Why did you die?", history: [], form: "current" }) }));
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect([...res.headers.entries()].join(" ")).not.toMatch(/nova|bedrock|amazon|us-east/i);
  });
});
