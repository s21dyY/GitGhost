import { afterEach, describe, expect, it, vi } from "vitest";
import { resetLimitsForTests } from "@/server/limits";
import { POST } from "./route";

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/summon", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

const postWith = (headers: Record<string, string>, body: unknown = { input: "a/b" }) =>
  POST(new Request("http://localhost/api/summon", { method: "POST", headers, body: JSON.stringify(body) }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetLimitsForTests();
});

describe("POST /api/summon", () => {
  it("rejects malformed hosts with 400 and never calls GitHub", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const res = await post({ input: "https://github.com.evil.com/a/b" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, code: "bad_host" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects non-JSON bodies", async () => {
    expect((await post("not json")).status).toBe(400);
  });

  it("returns canonical owner/repo and numeric id on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          id: 1663468, name: "pdf.js", full_name: "mozilla/pdf.js", owner: { login: "mozilla" },
          default_branch: "master", archived: false, stargazers_count: 1,
        }),
      ),
    );
    const res = await post({ input: "Mozilla/PDF.js" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, repoId: 1663468, owner: "mozilla", repo: "pdf.js" });
  });

  it("maps GitHub 404 to 404 and rate limits to 429", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({}, { status: 404 })));
    expect((await post({ input: "a/b" })).status).toBe(404);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({}, { status: 429 })));
    expect((await post({ input: "a/b" })).status).toBe(429);
  });

  it("rejects cross-origin posts without calling GitHub", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const res = await postWith({ origin: "https://evil.example", host: "localhost" });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("bad_origin");
    expect(spy).not.toHaveBeenCalled();
  });

  it("allows same-origin posts", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({}, { status: 404 })));
    expect((await postWith({ origin: "http://localhost", host: "localhost" })).status).toBe(404);
  });

  const trustedProxy = () => {
    vi.stubEnv("GITGHOST_TRUSTED_IP_SOURCE", "xff-hops");
    vi.stubEnv("GITGHOST_TRUSTED_PROXY_HOPS", "1");
  };

  it("rate limits per VERIFIED client with 429 and Retry-After, before any GitHub call", async () => {
    trustedProxy();
    vi.stubEnv("SUMMON_API_LIMIT", "2");
    resetLimitsForTests();
    const spy = vi.fn(async () => Response.json({}, { status: 404 }));
    vi.stubGlobal("fetch", spy);
    const h = { "x-forwarded-for": "203.0.113.5" };
    expect((await postWith(h)).status).toBe(404);
    expect((await postWith(h)).status).toBe(404);
    const blocked = await postWith(h);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(spy).toHaveBeenCalledTimes(2);
    expect((await postWith({ "x-forwarded-for": "203.0.113.6" })).status).toBe(404);
  });

  it("forged X-Forwarded-For values cannot buy extra requests (default: no header is trusted)", async () => {
    vi.stubEnv("SUMMON_API_LIMIT", "2");
    resetLimitsForTests();
    const spy = vi.fn(async () => Response.json({}, { status: 404 }));
    vi.stubGlobal("fetch", spy);
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await postWith({ "x-forwarded-for": `198.51.100.${i + 1}` })).status);
    expect(statuses).toEqual([404, 404, 429, 429, 429]);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("a rotating forged left-hand entry does not change the trusted rightmost one", async () => {
    trustedProxy();
    vi.stubEnv("SUMMON_API_LIMIT", "2");
    resetLimitsForTests();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({}, { status: 404 })));
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await postWith({ "x-forwarded-for": `198.51.100.${i + 1}, 203.0.113.9` })).status);
    expect(codes).toEqual([404, 404, 429, 429]);
  });

  it("a global cap holds even when every request has a different verified identity", async () => {
    trustedProxy();
    vi.stubEnv("SUMMON_API_GLOBAL_LIMIT", "3");
    resetLimitsForTests();
    const spy = vi.fn(async () => Response.json({}, { status: 404 }));
    vi.stubGlobal("fetch", spy);
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await postWith({ "x-forwarded-for": `203.0.113.${i + 10}` })).status);
    expect(codes).toEqual([404, 404, 404, 429, 429, 429]);
    expect(spy).toHaveBeenCalledTimes(3);
  });
});
