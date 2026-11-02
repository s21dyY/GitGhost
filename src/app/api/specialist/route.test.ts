import { afterEach, describe, expect, it, vi } from "vitest";
import { resetLimitsForTests } from "@/server/limits";
import { POST } from "./route";

const SHA = "d".repeat(40);
const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(new Request("http://localhost/api/specialist", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }));
const good = { owner: "acme", repo: "ghostly", path: "src/a.js", at: SHA, from: 3, to: 9 };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetLimitsForTests();
});

describe("POST /api/specialist", () => {
  it("refuses cross-site requests and non-JSON before anything else", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    expect((await post(good, { origin: "https://evil.example" })).status).toBe(403);
    expect((await POST(new Request("http://localhost/api/specialist", { method: "POST", body: "x" }))).status).toBe(415);
    expect(spy).not.toHaveBeenCalled();
  });
  it("refuses malformed requests: a branch instead of a commit, unknown fields, oversized bodies", async () => {
    for (const body of [{ ...good, at: "main" }, { ...good, extra: 1 }, { ...good, stage: "ghostly" }, "{not json"]) expect((await post(body)).status).toBe(400);
    expect((await post({ ...good, question: "x".repeat(1900) })).status).toBe(413);
  });
  it("when the Specialist is off it says so, and reads nothing from GitHub", async () => {
    vi.stubEnv("GITGHOST_SPECIALIST_ENABLED", "false");
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const res = await post(good);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, code: "specialist_disabled", message: "The Specialist cannot be reached right now." });
    expect(spy).not.toHaveBeenCalled();
  });
});
