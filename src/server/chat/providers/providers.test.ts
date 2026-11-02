import { ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderError } from "../types";
import { classifyBedrockError, createBedrockProvider } from "./bedrock";
import { createMockProvider } from "./mock";

afterEach(() => vi.unstubAllGlobals());
const req = { system: "sys", messages: [{ role: "user" as const, content: "hello ghost" }], maxOutputTokens: 300 };
const signal = () => new AbortController().signal;

describe("mock provider", () => {
  it("is deterministic, free, and makes no network call", async () => {
    const fetchSpy = vi.fn(() => { throw new Error("network used"); });
    vi.stubGlobal("fetch", fetchSpy);
    const p = createMockProvider();
    expect(p).toMatchObject({ id: "mock", billable: false });
    const a = await p.invoke(req, { signal: signal() });
    const b = await p.invoke(req, { signal: signal() });
    expect(a).toEqual(b);
    expect(a.text).toContain("[mock");
    expect(a.usage!.inputTokens).toBeGreaterThan(0);
    expect((await p.invoke({ ...req, messages: [{ role: "user", content: "different" }] }, { signal: signal() })).text).not.toBe(a.text);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("honors an already-aborted signal", async () => {
    const c = new AbortController();
    c.abort();
    await expect(createMockProvider().invoke(req, { signal: c.signal })).rejects.toBeDefined();
  });
});

describe("bedrock provider (fake client only)", () => {
  const response = { output: { message: { role: "assistant", content: [{ text: " hi " }] } }, stopReason: "end_turn", usage: { inputTokens: 20, outputTokens: 3, totalTokens: 23 } };

  it("sends one Converse request with the output cap and reports usage", async () => {
    const send = vi.fn(async () => response);
    const p = createBedrockProvider({ client: { send } as never, modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0" });
    expect(p).toMatchObject({ id: "bedrock", billable: true });
    const out = await p.invoke(req, { signal: signal() });
    expect(out).toEqual({ text: "hi", usage: { inputTokens: 20, outputTokens: 3 }, stopReason: "end_turn" });
    const cmd = (send.mock.calls[0] as unknown[])[0] as ConverseCommand;
    expect(cmd).toBeInstanceOf(ConverseCommand);
    expect(cmd.input.inferenceConfig?.maxTokens).toBe(300);
    expect(cmd.input.modelId).toBe("us.anthropic.claude-haiku-4-5-20251001-v1:0");
  });

  it("reports missing usage as null (the caller then keeps the full reservation)", async () => {
    const send = async () => ({ output: { message: { role: "assistant", content: [{ text: "x" }] } } });
    const out = await createBedrockProvider({ client: { send } as never, modelId: "m.m-m" }).invoke(req, { signal: signal() });
    expect(out.usage).toBeNull();
  });

  const httpErr = (name: string, httpStatusCode?: number) => Object.assign(new Error("boom 123456789012"), { name, ...(httpStatusCode ? { $metadata: { httpStatusCode } } : {}) });

  it.each([
    ["ValidationException", 400, "not_billed"],
    ["AccessDeniedException", 403, "not_billed"],
    ["ResourceNotFoundException", 404, "not_billed"],
    // same names without a 4xx status, or with a server status, are NOT refundable
    ["ValidationException", undefined, "unknown"],
    ["ValidationException", 500, "unknown"],
    ["AccessDeniedException", 503, "unknown"],
    // throttling and everything else is treated as possibly billed
    ["ThrottlingException", 429, "unknown"],
    ["ModelTimeoutException", 408, "unknown"],
    ["ModelErrorException", 424, "unknown"],
    ["InternalServerException", 500, "unknown"],
    ["ServiceUnavailableException", 503, "unknown"],
    ["TimeoutError", undefined, "unknown"],
    ["WeirdNewError", 400, "unknown"],
  ])("%s (HTTP %s) -> %s", async (name, status, outcome) => {
    const send = async () => { throw httpErr(name, status); };
    const err = await createBedrockProvider({ client: { send } as never, modelId: "m.m-m" }).invoke(req, { signal: signal() }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.outcome).toBe(outcome);
    expect(err.message).not.toContain("123456789012"); // raw AWS text is never passed along
  });

  it("classification never trusts a missing or malformed error object", () => {
    for (const bad of [null, undefined, "string", 42, {}, { name: "ValidationException", $metadata: {} }, { name: "ValidationException", $metadata: { httpStatusCode: "400" } }]) {
      expect(classifyBedrockError(bad)).toBe("unknown");
    }
  });

  it("an abort is an unknown outcome", async () => {
    const c = new AbortController();
    const send = async () => { c.abort(); throw Object.assign(new Error("x"), { name: "AbortError" }); };
    const err = await createBedrockProvider({ client: { send } as never, modelId: "m.m-m" }).invoke(req, { signal: c.signal }).catch((e) => e);
    expect(err.outcome).toBe("unknown");
  });
});

describe("no live AWS inference in normal runs", () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  const files = walk(join(process.cwd(), "src")).filter((f) => /\.(ts|tsx)$/.test(f));

  it("no application or test source builds a BedrockRuntimeClient except the opt-in live test", () => {
    const offenders = files.filter((f) => /new\s+BedrockRuntimeClient\s*\(/.test(readFileSync(f, "utf8")) && !f.endsWith("live.bedrock.test.ts") && !f.endsWith("providers.test.ts") && !f.endsWith("chat/runtime.ts"));
    expect(offenders).toEqual([]);
    // The one application site is lazy: inside a function, never at module level.
    const runtime = readFileSync(join(process.cwd(), "src/server/chat/runtime.ts"), "utf8");
    expect((runtime.match(/new\s+BedrockRuntimeClient\s*\(/g) ?? []).length).toBe(1);
    expect(runtime).toMatch(/createProvider: \(c\) => \{[\s\S]*new BedrockRuntimeClient/);
  });

  it("the live test is gated by its own opt-in variable, separate from the runtime feature flag", () => {
    const live = readFileSync(join(process.cwd(), "src/server/chat/live.bedrock.test.ts"), "utf8");
    expect(live).toContain("GITGHOST_LIVE_BEDROCK_TESTS");
    expect(live).toContain("skipIf");
    expect(live).not.toContain("process.env.GITGHOST_BEDROCK_ENABLED");
  });
});
