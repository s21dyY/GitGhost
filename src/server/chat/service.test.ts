import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatConfig } from "./config";
import { maxRequestCostMicros } from "./spend";
import { runChat, type ChatDeps, type ChatInput } from "./service";
import { createFakeUsageDynamo } from "./test-support";
import { ProviderError, type ChatProvider, type ChatResponse } from "./types";
import { createDynamoUsageStore } from "./usage-dynamo";
import { createMemoryUsageStore, UsageStoreError, type UsageStore } from "./usage-store";

const T0 = Date.UTC(2026, 9, 31, 12, 0, 10);
const DAY = "2026-10-31";
const headers = (map: Record<string, string> = {}) => ({ get: (n: string) => map[n.toLowerCase()] ?? null });
const input = (h: Record<string, string> = {}, text = "What changed lately?"): ChatInput => ({
  headers: headers(h), system: "You are a ghost.", messages: [{ role: "user", content: text }],
});

const BEDROCK_ENV = {
  GITGHOST_BEDROCK_ENABLED: "true", GITGHOST_CHAT_PROVIDER: "bedrock", BEDROCK_MODEL_ID: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
  AWS_REGION: "us-east-2", GITGHOST_BEDROCK_INPUT_USD_PER_MTOK: "1", GITGHOST_BEDROCK_OUTPUT_USD_PER_MTOK: "5",
  GITGHOST_USAGE_TABLE: "gitghost-usage-test", GITGHOST_BEDROCK_KILL_SWITCH: "false",
};
const TRUST = { GITGHOST_TRUSTED_IP_SOURCE: "xff-hops", GITGHOST_TRUSTED_PROXY_HOPS: "1" };
// With prices 1 and 5 and the default 4000/300 caps and factor 1.25: (4000*1 + 300*5) * 1.25 = 6875 micro-dollars.
const RESERVE = 6875;

type Fake = ChatProvider & { calls: number; maxInFlight: number };
function fakeBilled(behavior: (n: number, signal: AbortSignal) => Promise<ChatResponse>): Fake {
  let inFlight = 0;
  const p = {
    id: "bedrock" as const, billable: true, calls: 0, maxInFlight: 0,
    async invoke(_req: unknown, { signal }: { signal: AbortSignal }) {
      p.calls++;
      inFlight++;
      p.maxInFlight = Math.max(p.maxInFlight, inFlight);
      try { return await behavior(p.calls, signal); } finally { inFlight--; }
    },
  };
  return p;
}
const reply = (usage: ChatResponse["usage"] = { inputTokens: 100, outputTokens: 50 }): ChatResponse => ({ text: "boo", usage });

let now = T0;
let store: ReturnType<typeof createMemoryUsageStore>;
const logs: string[] = [];
function deps(over: Partial<ChatDeps> & { env?: Record<string, string> } = {}, provider?: ChatProvider): ChatDeps {
  return {
    env: { ...BEDROCK_ENV, ...(over.env ?? {}) }, now: () => now, store, localStore: createMemoryUsageStore(() => now),
    createProvider: provider ? () => provider : undefined, log: (e) => { logs.push(e); }, newId: (() => { let i = 0; return () => `id${++i}`; })(),
    ...over, ...(over.env ? { env: { ...BEDROCK_ENV, ...over.env } } : {}),
  };
}
const total = async (key: string) => (await store.addIfWithin(key, 0, Number.MAX_SAFE_INTEGER, 60)).total;

beforeEach(() => { now = T0; logs.length = 0; store = createMemoryUsageStore(() => now); });
afterEach(() => { vi.useRealTimers(); });

describe("Bedrock disabled / invalid configuration", () => {
  it("default environment uses the mock, spends nothing and needs no shared store", async () => {
    const r = await runChat(input(), { env: {}, now: () => now, localStore: createMemoryUsageStore(() => now) });
    expect(r).toMatchObject({ ok: true, provider: "mock", billable: false, spentMicros: 0 });
    if (r.ok) expect(r.text).toContain("[mock");
  });

  it("provider=bedrock with the flag false is refused before any provider or store work", async () => {
    const factory = vi.fn();
    const spy = vi.spyOn(store, "incrementIfBelow");
    const r = await runChat(input(), deps({ env: { GITGHOST_BEDROCK_ENABLED: "false" }, createProvider: factory }));
    expect(r).toMatchObject({ ok: false, status: 503, code: "bedrock_disabled" });
    expect(factory).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    ["malformed flag", { GITGHOST_BEDROCK_ENABLED: "yes" }],
    ["malformed limit", { GITGHOST_MAX_OUTPUT_TOKENS: "lots" }],
    ["malformed budget", { GITGHOST_DAILY_BUDGET_USD: "$1" }],
    ["unknown provider", { GITGHOST_CHAT_PROVIDER: "gpt" }],
  ])("%s -> invalid_config, nothing is called", async (_n, env) => {
    const factory = vi.fn();
    const r = await runChat(input(), deps({ env, createProvider: factory }));
    expect(r).toMatchObject({ ok: false, status: 503, code: "invalid_config" });
    expect(factory).not.toHaveBeenCalled();
  });

  it.each([
    ["no prices", { GITGHOST_BEDROCK_INPUT_USD_PER_MTOK: "" }],
    ["no model", { BEDROCK_MODEL_ID: "" }],
    ["no region", { AWS_REGION: "" }],
    ["no shared store", { GITGHOST_USAGE_TABLE: "" }],
  ])("incomplete Bedrock setup (%s) is refused", async (_n, env) => {
    const factory = vi.fn();
    const r = await runChat(input(), deps({ env, createProvider: factory }));
    expect(r).toMatchObject({ ok: false, code: "invalid_config" });
    expect(factory).not.toHaveBeenCalled();
  });

  it("an unconfigured Bedrock provider factory fails closed without touching counters", async () => {
    const spy = vi.spyOn(store, "addIfWithin");
    const r = await runChat(input(), { ...deps(), createProvider: undefined });
    expect(r).toMatchObject({ ok: false, code: "invalid_config" });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("kill switch", () => {
  it("environment kill switch stops new invocations before any counter is touched", async () => {
    const p = fakeBilled(async () => reply());
    const spy = vi.spyOn(store, "acquireLease");
    const r = await runChat(input(), deps({ env: { GITGHOST_BEDROCK_KILL_SWITCH: "true" } }, p));
    expect(r).toMatchObject({ ok: false, code: "kill_switch" });
    expect(p.calls).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it("the shared kill switch takes effect immediately, without a redeploy, and spends nothing", async () => {
    const p = fakeBilled(async () => reply());
    store.setFlag("KILL#bedrock", true);
    const r = await runChat(input(), deps({}, p));
    expect(r).toMatchObject({ ok: false, code: "kill_switch" });
    expect(p.calls).toBe(0);
    expect(await total(`BUDGET#${DAY}`)).toBe(0);
  });
});

describe("input limits", () => {
  it("rejects oversized or empty input before any shared-store traffic", async () => {
    const spy = vi.spyOn(store, "incrementIfBelow");
    const big = "x".repeat(9000);
    expect(await runChat(input({}, big), deps({}, fakeBilled(async () => reply())))).toMatchObject({ ok: false, status: 413, code: "input_too_large" });
    expect(await runChat({ ...input(), messages: [] }, deps({}, fakeBilled(async () => reply())))).toMatchObject({ code: "input_too_large" });
    expect(spy).not.toHaveBeenCalled();
  });
  it("passes the configured output cap to the provider, never more", async () => {
    let seen = 0;
    const p = { ...fakeBilled(async () => reply()), async invoke(r: { maxOutputTokens: number }) { seen = r.maxOutputTokens; return reply(); } } as ChatProvider;
    await runChat(input(), deps({ env: { GITGHOST_MAX_OUTPUT_TOKENS: "123" } }, p));
    expect(seen).toBe(123);
  });
});

describe("per-client rate limit and bypass attempts", () => {
  it("allows 5 per minute per verified client, then 429 with a retry time; resets next minute", async () => {
    const env = { ...TRUST, GITGHOST_CHAT_PROVIDER: "mock" };
    const h = { "x-forwarded-for": "203.0.113.9" };
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) {
      const r = await runChat(input(h), deps({ env }));
      codes.push(r.ok ? 200 : r.status);
    }
    expect(codes).toEqual([200, 200, 200, 200, 200, 429, 429]);
    const blocked = await runChat(input(h), deps({ env }));
    expect(blocked).toMatchObject({ ok: false, code: "rate_limited" });
    expect(blocked.ok === false && blocked.retryAfterSec).toBeGreaterThan(0);
    expect((await runChat(input({ "x-forwarded-for": "203.0.113.10" }), deps({ env }))).ok).toBe(true);
    now += 60_000;
    expect((await runChat(input(h), deps({ env }))).ok).toBe(true);
  });

  it("forged forwarded headers cannot create new buckets when no header is trusted (default)", async () => {
    const env = { GITGHOST_CHAT_PROVIDER: "mock" };
    const codes: number[] = [];
    for (let i = 0; i < 8; i++) {
      const r = await runChat(input({ "x-forwarded-for": `198.51.100.${i + 1}`, "x-real-ip": `198.51.100.${i + 50}` }), deps({ env }));
      codes.push(r.ok ? 200 : r.status);
    }
    expect(codes.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(codes.slice(5)).toEqual([429, 429, 429]);
  });

  it("with a trusted proxy, forging the client-controlled left side does not help", async () => {
    const env = { ...TRUST, GITGHOST_CHAT_PROVIDER: "mock" };
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) {
      const r = await runChat(input({ "x-forwarded-for": `198.51.100.${i + 1}, 203.0.113.9` }), deps({ env }));
      codes.push(r.ok ? 200 : r.status);
    }
    expect(codes.filter((c) => c === 200)).toHaveLength(5);
  });

  it("global daily and budget limits hold when every request is a different verified client", async () => {
    const env = { ...TRUST, GITGHOST_CHAT_REQUESTS_PER_DAY: "4", GITGHOST_CHAT_CONCURRENCY: "20" };
    const p = fakeBilled(async () => reply());
    const codes: string[] = [];
    for (let i = 0; i < 10; i++) {
      const r = await runChat(input({ "x-forwarded-for": `203.0.113.${i + 20}` }), deps({ env }, p));
      codes.push(r.ok ? "ok" : r.code);
    }
    expect(codes.filter((c) => c === "ok")).toHaveLength(4);
    expect(codes.slice(4).every((c) => c === "daily_limit")).toBe(true);
    expect(p.calls).toBe(4);
  });
});

describe("budget reservation, reconciliation and exhaustion", () => {
  it("reserves the worst case first and reconciles to the actual usage", async () => {
    const seenReserved: number[] = [];
    const p = fakeBilled(async () => {
      seenReserved.push(await total(`BUDGET#${DAY}`)); // visible to the world while the call is in flight
      return reply({ inputTokens: 100, outputTokens: 50 });
    });
    const r = await runChat(input(), deps({}, p));
    expect(seenReserved).toEqual([RESERVE]);
    const actual = Math.ceil((100 * 1 + 50 * 5) * 1.25); // 438
    expect(r).toMatchObject({ ok: true, billable: true, reservedMicros: RESERVE, spentMicros: actual });
    expect(await total(`BUDGET#${DAY}`)).toBe(actual);
    expect(await total(`REQ#bedrock#${DAY}`)).toBe(1);
  });

  it("the reservation formula uses the configured maximums", () => {
    const c = { inputUsdPerMTok: 1, outputUsdPerMTok: 5, budgetSafetyFactor: 1.25, maxInputTokens: 4000, maxOutputTokens: 300 } as ChatConfig;
    expect(maxRequestCostMicros(c)).toBe(RESERVE);
  });

  it("missing usage keeps the whole reservation", async () => {
    const r = await runChat(input(), deps({}, fakeBilled(async () => reply(null))));
    expect(r).toMatchObject({ ok: true, spentMicros: RESERVE });
    expect(await total(`BUDGET#${DAY}`)).toBe(RESERVE);
  });

  it("usage above the reservation is charged in full (never hidden)", async () => {
    const r = await runChat(input(), deps({}, fakeBilled(async () => reply({ inputTokens: 9000, outputTokens: 900 }))));
    const actual = Math.ceil((9000 + 4500) * 1.25);
    expect(r).toMatchObject({ ok: true, spentMicros: actual });
    expect(await total(`BUDGET#${DAY}`)).toBe(actual);
    expect(logs).toContain("under_reserved");
  });

  it("refuses when the remaining budget cannot cover another worst case, without invoking the provider", async () => {
    const env = { GITGHOST_DAILY_BUDGET_USD: "0.010", GITGHOST_CHAT_CONCURRENCY: "5" }; // 10,000 micros fits one reservation of 6,875
    const p = fakeBilled(async () => reply(null));
    const results = [];
    for (let i = 0; i < 3; i++) results.push(await runChat(input(), deps({ env }, p)));
    expect(results[0].ok).toBe(true);
    expect(results[1]).toMatchObject({ ok: false, status: 429, code: "budget_exhausted" });
    expect(results[2]).toMatchObject({ code: "budget_exhausted" });
    expect(p.calls).toBe(1);
    expect(await total(`BUDGET#${DAY}`)).toBe(RESERVE); // the refused attempts left nothing behind
    expect(await total(`REQ#bedrock#${DAY}`)).toBe(1); // and returned their request slots
  });

  it("a zero budget or zero daily limit blocks every billable request", async () => {
    const p = fakeBilled(async () => reply());
    expect(await runChat(input(), deps({ env: { GITGHOST_DAILY_BUDGET_USD: "0" } }, p))).toMatchObject({ code: "budget_exhausted" });
    expect(await runChat(input(), deps({ env: { GITGHOST_CHAT_REQUESTS_PER_DAY: "0" } }, p))).toMatchObject({ code: "daily_limit" });
    expect(p.calls).toBe(0);
  });

  it("the budget resets on the next UTC day", async () => {
    const env = { GITGHOST_DAILY_BUDGET_USD: "0.010" };
    const p = fakeBilled(async () => reply(null));
    await runChat(input(), deps({ env }, p));
    expect(await runChat(input(), deps({ env }, p))).toMatchObject({ code: "budget_exhausted" });
    now = Date.UTC(2026, 10, 1, 0, 0, 1);
    expect((await runChat(input(), deps({ env }, p))).ok).toBe(true);
  });
});

describe("concurrency", () => {
  it("never runs more than the configured number of invocations at once", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const p = fakeBilled(async () => { await gate; return reply(); });
    const env = { ...TRUST, GITGHOST_CHAT_CONCURRENCY: "2", GITGHOST_CHAT_REQUESTS_PER_MINUTE: "100" };
    const calls = Array.from({ length: 10 }, (_, i) => runChat(input({ "x-forwarded-for": `203.0.113.${i + 1}` }), deps({ env }, p)));
    await vi.waitFor(() => expect(p.calls).toBe(2));
    release();
    const results = await Promise.all(calls);
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(results.filter((r) => !r.ok && r.code === "busy")).toHaveLength(8);
    expect(p.maxInFlight).toBe(2);
    expect(await total(`REQ#bedrock#${DAY}`)).toBe(2); // busy requests consumed nothing
  });

  it("concurrent requests cannot jointly overspend the budget", async () => {
    const env = { ...TRUST, GITGHOST_DAILY_BUDGET_USD: "0.020", GITGHOST_CHAT_CONCURRENCY: "20", GITGHOST_CHAT_REQUESTS_PER_MINUTE: "100" };
    const p = fakeBilled(async () => reply(null));
    const results = await Promise.all(Array.from({ length: 25 }, (_, i) => runChat(input({ "x-forwarded-for": `203.0.113.${i + 1}` }), deps({ env }, p))));
    const okCount = results.filter((r) => r.ok).length;
    expect(okCount).toBe(2); // floor(20,000 / 6,875)
    expect(p.calls).toBe(2);
    expect(await total(`BUDGET#${DAY}`)).toBeLessThanOrEqual(20_000);
  });

  it("releases the slot after success so the next request can run", async () => {
    const env = { GITGHOST_CHAT_CONCURRENCY: "1", GITGHOST_CHAT_REQUESTS_PER_MINUTE: "100" };
    const p = fakeBilled(async () => reply());
    expect((await runChat(input(), deps({ env }, p))).ok).toBe(true);
    expect((await runChat(input(), deps({ env }, p))).ok).toBe(true);
  });
});

describe("provider failures, timeouts and unknown outcomes", () => {
  it("a rejection before inference (not billed) refunds budget, request count and the slot", async () => {
    const env = { GITGHOST_CHAT_CONCURRENCY: "1" };
    const p = fakeBilled(async () => { throw new ProviderError("denied", "not_billed", "AccessDeniedException"); });
    expect(await runChat(input(), deps({ env }, p))).toMatchObject({ ok: false, status: 502, code: "provider_error" });
    expect(await total(`BUDGET#${DAY}`)).toBe(0);
    expect(await total(`REQ#bedrock#${DAY}`)).toBe(0);
    const ok = fakeBilled(async () => reply());
    expect((await runChat(input(), deps({ env }, ok))).ok).toBe(true); // slot was released
  });

  it("an unknown failure keeps the full reservation and holds the slot until its lease expires", async () => {
    const env = { GITGHOST_CHAT_CONCURRENCY: "1", GITGHOST_CHAT_REQUESTS_PER_MINUTE: "100" };
    const p = fakeBilled(async () => { throw new ProviderError("network lost", "unknown"); });
    expect(await runChat(input(), deps({ env }, p))).toMatchObject({ ok: false, code: "provider_error" });
    expect(await total(`BUDGET#${DAY}`)).toBe(RESERVE);
    expect(await total(`REQ#bedrock#${DAY}`)).toBe(1);
    expect(await runChat(input(), deps({ env }, fakeBilled(async () => reply())))).toMatchObject({ code: "busy" });
    now += 40_000; // timeout (20 s) + 10 s margin has passed
    expect((await runChat(input(), deps({ env }, fakeBilled(async () => reply())))).ok).toBe(true);
  });

  it("a crash-like error (not even a ProviderError) is treated as an unknown outcome", async () => {
    const p = fakeBilled(async () => { throw new TypeError("kaboom"); });
    expect(await runChat(input(), deps({}, p))).toMatchObject({ ok: false, code: "provider_error" });
    expect(await total(`BUDGET#${DAY}`)).toBe(RESERVE);
  });

  it("a process that dies mid-call leaves the reservation in place (nothing ever refunds it)", async () => {
    const p = fakeBilled(() => new Promise<ChatResponse>(() => undefined)); // never settles, like a dead process
    void runChat(input(), deps({ env: { GITGHOST_CHAT_TIMEOUT_MS: "120000" } }, p));
    await vi.waitFor(() => expect(p.calls).toBe(1));
    expect(await total(`BUDGET#${DAY}`)).toBe(RESERVE);
    expect(await total(`REQ#bedrock#${DAY}`)).toBe(1);
  });

  it("a timeout aborts the call, answers 504 and keeps the reservation", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let aborted = false;
    const p = fakeBilled((_n, signal) => new Promise<ChatResponse>(() => { signal.addEventListener("abort", () => { aborted = true; }); }));
    const pending = runChat(input(), deps({ env: { GITGHOST_CHAT_TIMEOUT_MS: "1000" } }, p));
    await vi.waitFor(() => expect(p.calls).toBe(1));
    await vi.advanceTimersByTimeAsync(1001);
    const r = await pending;
    expect(r).toMatchObject({ ok: false, status: 504, code: "provider_timeout" });
    expect(aborted).toBe(true);
    expect(await total(`BUDGET#${DAY}`)).toBe(RESERVE);
    expect(logs).toContain("timeout_kept_reservation");
  });

  it("a late answer after the timeout cannot change the books", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let finish!: (r: ChatResponse) => void;
    const p = fakeBilled(() => new Promise<ChatResponse>((res) => { finish = res; }));
    const pending = runChat(input(), deps({ env: { GITGHOST_CHAT_TIMEOUT_MS: "1000" } }, p));
    await vi.waitFor(() => expect(p.calls).toBe(1));
    await vi.advanceTimersByTimeAsync(1001);
    await pending;
    finish(reply({ inputTokens: 1, outputTokens: 1 }));
    await Promise.resolve();
    expect(await total(`BUDGET#${DAY}`)).toBe(RESERVE);
  });

  it("a failed reconciliation write keeps the reservation and still returns the answer", async () => {
    const real = store.add.bind(store);
    store.add = async (k, d, t) => { if (d < 0) throw new UsageStoreError("down"); return real(k, d, t); };
    const r = await runChat(input(), deps({}, fakeBilled(async () => reply())));
    expect(r).toMatchObject({ ok: true, spentMicros: RESERVE });
    expect(await total(`BUDGET#${DAY}`)).toBe(RESERVE);
    expect(logs).toContain("reconcile_failed");
  });

  it("a mock provider can never be used for the billable path, and vice versa", async () => {
    const mock = { id: "mock" as const, billable: false, invoke: vi.fn() };
    expect(await runChat(input(), deps({}, mock))).toMatchObject({ ok: false, code: "invalid_config" });
    expect(mock.invoke).not.toHaveBeenCalled();
    const billed = fakeBilled(async () => reply());
    expect(await runChat(input(), deps({ env: { GITGHOST_CHAT_PROVIDER: "mock" } }, billed))).toMatchObject({ ok: false, code: "invalid_config" });
    expect(billed.calls).toBe(0);
  });
});

describe("budget storage unavailable: billable requests are rejected", () => {
  const broken = (): UsageStore => {
    const boom = async () => { throw new UsageStoreError("down"); };
    return { kind: "dynamodb", incrementIfBelow: boom, addIfWithin: boom, add: boom, acquireLease: boom, releaseLease: boom, getFlag: boom } as UsageStore;
  };

  it("every billable request fails closed and the provider is never called", async () => {
    const p = fakeBilled(async () => reply());
    const r = await runChat(input(), deps({ store: broken() }, p));
    expect(r).toMatchObject({ ok: false, status: 503, code: "budget_unavailable" });
    expect(p.calls).toBe(0);
  });

  it("no store at all also fails closed", async () => {
    const p = fakeBilled(async () => reply());
    const r = await runChat(input(), { ...deps({}, p), store: undefined });
    expect(r).toMatchObject({ ok: false, code: "budget_unavailable" });
    expect(p.calls).toBe(0);
  });

  it.each(["getFlag", "acquireLease", "incrementIfBelow", "addIfWithin"] as const)("failure at step %s stops the call and leaves no stuck reservation", async (step) => {
    const s = createMemoryUsageStore(() => now);
    const orig = s[step].bind(s) as (...a: unknown[]) => Promise<unknown>;
    let seenRateLimitCall = false;
    (s as unknown as Record<string, unknown>)[step] = async (...a: unknown[]) => {
      // the first incrementIfBelow is the per-client rate limit; fail the daily-count one instead
      if (step === "incrementIfBelow" && !seenRateLimitCall) { seenRateLimitCall = true; return orig(...a); }
      if (step === "addIfWithin" && a[1] === 0) return orig(...a); // the test's own balance read
      throw new UsageStoreError("down");
    };
    store = s;
    const p = fakeBilled(async () => reply());
    const r = await runChat(input(), deps({ store: s }, p));
    expect(r).toMatchObject({ ok: false, code: "budget_unavailable" });
    expect(p.calls).toBe(0);
    expect(await total(`BUDGET#${DAY}`)).toBe(0);
  });

  it("the free mock path degrades to process memory when the shared store fails", async () => {
    const r = await runChat(input(), { env: {}, now: () => now, store: broken(), localStore: createMemoryUsageStore(() => now) });
    expect(r).toMatchObject({ ok: true, provider: "mock" });
  });
});

describe("against the DynamoDB request shapes (fake backend)", () => {
  it("the whole pipeline works on the DynamoDB store implementation, atomically under concurrency", async () => {
    const fake = createFakeUsageDynamo();
    const dstore = createDynamoUsageStore(fake.client, "gitghost-usage-test", () => now);
    const env = { ...TRUST, GITGHOST_DAILY_BUDGET_USD: "0.020", GITGHOST_CHAT_CONCURRENCY: "20", GITGHOST_CHAT_REQUESTS_PER_MINUTE: "100" };
    const p = fakeBilled(async () => reply(null));
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => runChat(input({ "x-forwarded-for": `203.0.113.${i + 1}` }), deps({ env, store: dstore }, p))));
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(p.calls).toBe(2);
    expect(fake.value(`BUDGET#${DAY}`, "v")).toBe(RESERVE * 2);
    expect(fake.value(`REQ#bedrock#${DAY}`, "v")).toBe(2);
  });

  it("the shared kill switch flag is read from the table", async () => {
    const fake = createFakeUsageDynamo();
    fake.setFlag("KILL#bedrock", true);
    const p = fakeBilled(async () => reply());
    const r = await runChat(input(), deps({ store: createDynamoUsageStore(fake.client, "t", () => now) }, p));
    expect(r).toMatchObject({ code: "kill_switch" });
    expect(p.calls).toBe(0);
  });

  it("a table outage (throttling) rejects billable requests", async () => {
    const fake = createFakeUsageDynamo();
    fake.failAll("ProvisionedThroughputExceededException");
    const p = fakeBilled(async () => reply());
    const r = await runChat(input(), deps({ store: createDynamoUsageStore(fake.client, "t", () => now) }, p));
    expect(r).toMatchObject({ code: "budget_unavailable" });
    expect(p.calls).toBe(0);
  });
});
