import { afterEach, describe, expect, it, vi } from "vitest";
import type { RepoMetadata } from "@/domain/repo";
import { clearCodeSearchCacheForTests, isSearchTerm, searchCode } from "./search";

const repo = { repoId: 7, owner: "acme", name: "ghostly", fullName: "acme/ghostly", htmlUrl: "https://github.com/acme/ghostly", defaultBranch: "main" } as RepoMetadata;
const respond = (body: unknown) => {
  const calls: string[] = [];
  const fetch = vi.fn(async (url: string) => {
    calls.push(String(url));
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  });
  return { calls, deps: { fetch: fetch as unknown as typeof globalThis.fetch, token: "t" } };
};
afterEach(() => clearCodeSearchCacheForTests());

describe("where else a name is used (GitHub code search)", () => {
  it("searches only names from the code, never free text or search operators", () => {
    for (const t of ["deserialize", "bufferForIdSync", "TextEditor.prototype", "$el", "_private"]) expect(isSearchTerm(t)).toBe(true);
    for (const t of ["", "a", "foo bar", "x repo:other/repo", '"quoted"', "user:me", "a".repeat(81), "1abc"]) expect(isSearchTerm(t)).toBe(false);
  });
  it("is scoped to this one repository, de-duplicates paths, drops unsafe ones, and says which branch it searched", async () => {
    const { calls, deps } = respond({ total_count: 3, items: [{ path: "src/a.js" }, { path: "src/a.js" }, { path: "../evil.js" }, { path: "spec/a-spec.js" }] });
    const r = await searchCode(repo, "deserialize", deps);
    expect(r).toEqual({ term: "deserialize", total: 3, paths: ["src/a.js", "spec/a-spec.js"], branch: "main", archived: false });
    expect(decodeURIComponent(calls[0])).toContain('/search/code?q="deserialize" repo:acme/ghostly');
  });
  it("caches, so a repeated question does not spend GitHub's small search allowance", async () => {
    const { calls, deps } = respond({ total_count: 0, items: [] });
    await searchCode(repo, "x1", deps);
    await searchCode(repo, "x1", deps);
    expect(calls).toHaveLength(1);
  });
  it("refuses a term that is not a name before calling GitHub", async () => {
    const { calls, deps } = respond({ total_count: 0, items: [] });
    await expect(searchCode(repo, "x repo:evil/evil", deps)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});
