import { afterEach, describe, expect, it, vi } from "vitest";
import { resetLimitsForTests } from "@/server/limits";
import { GET } from "./route";

const get = (query: string, headers: Record<string, string> = {}) => GET(new Request(`http://localhost/api/code?${query}`, { headers }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetLimitsForTests();
});

describe("GET /api/code", () => {
  it("refuses cross-site requests before touching GitHub", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const res = await get("owner=a&repo=b", { "sec-fetch-site": "cross-site" });
    expect(res.status).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });
  it("refuses bad repositories, paths and commit ids with 400, without calling GitHub", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    for (const q of ["owner=&repo=b", "owner=a&repo=b&path=../etc/passwd", "owner=a&repo=b&path=/abs.js", "owner=a&repo=b&at=main"]) {
      const res = await get(q, { "sec-fetch-site": "same-origin" });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ ok: false });
    }
    expect(spy).not.toHaveBeenCalled();
  });
  it("rate limits each client", async () => {
    vi.stubEnv("CODE_API_LIMIT", "2");
    resetLimitsForTests();
    vi.stubGlobal("fetch", vi.fn());
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push((await get("owner=a&repo=b&at=main")).status);
    expect(codes).toEqual([400, 400, 429]);
  });
  it("refuses a search that is not a name, and says plainly when searching needs a token", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    expect((await get("owner=a&repo=b&search=x%20repo:evil/evil", { "sec-fetch-site": "same-origin" })).status).toBe(400);
    vi.stubEnv("GITHUB_TOKEN", "");
    const res = await get("owner=a&repo=b&search=deserialize", { "sec-fetch-site": "same-origin" });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "search_unavailable" });
    expect(spy).not.toHaveBeenCalled();
  });
});
