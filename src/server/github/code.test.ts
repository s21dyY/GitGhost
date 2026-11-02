import { afterEach, describe, expect, it, vi } from "vitest";
import type { RepoMetadata } from "@/domain/repo";
import { clearCodeCacheForTests, fetchCodeFile, fetchCodeTree, isSafePath, isSha, MAX_LINES } from "./code";

const repo = { repoId: 7, owner: "acme", name: "ghostly", fullName: "acme/ghostly", htmlUrl: "https://github.com/acme/ghostly", defaultBranch: "main" } as RepoMetadata;
const respond = (body: unknown) => {
  const calls: string[] = [];
  const fetch = vi.fn(async (url: string) => {
    calls.push(String(url));
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  });
  return { calls, deps: { fetch: fetch as unknown as typeof globalThis.fetch, token: "" } };
};
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
afterEach(() => clearCodeCacheForTests());

describe("paths a visitor may ask for", () => {
  it("are relative, without . or .. segments", () => {
    for (const p of ["src/a.js", "README.md", "a/b/c.d.ts"]) expect(isSafePath(p)).toBe(true);
    for (const p of ["", "/etc/passwd", "../x", "a/../b", "a//b", "./a", "a/.", "x".repeat(301)]) expect(isSafePath(p)).toBe(false);
  });
  it("commit ids must be full SHAs", () => {
    expect(isSha("a".repeat(40))).toBe(true);
    for (const s of ["main", "abc123", "A".repeat(40)]) expect(isSha(s)).toBe(false);
  });
});

describe("the ghost's body (file tree)", () => {
  it("lists readable files in one request, skipping folders, dependencies, builds, binaries, lockfiles and minified code", async () => {
    const { calls, deps } = respond({
      truncated: false,
      tree: [
        { path: "src", type: "tree" },
        { path: "src/a.js", type: "blob" }, { path: "README.md", type: "blob" },
        { path: "node_modules/x/index.js", type: "blob" }, { path: "dist/app.js", type: "blob" }, { path: "vendor/lib.rb", type: "blob" },
        { path: "logo.png", type: "blob" }, { path: "package-lock.json", type: "blob" }, { path: "static/app.min.js", type: "blob" },
        { path: "a/../evil.js", type: "blob" },
      ],
    });
    const t = await fetchCodeTree(repo, null, deps);
    expect(t).toEqual({ at: "main", paths: ["src/a.js", "README.md"], truncated: false });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("/repos/acme/ghostly/git/trees/main?recursive=1");
  });
  it("reads an older era at its commit, and caches", async () => {
    const { calls, deps } = respond({ tree: [{ path: "a.js", type: "blob" }] });
    const sha = "b".repeat(40);
    await fetchCodeTree(repo, sha, deps);
    await fetchCodeTree(repo, sha, deps);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain(`/git/trees/${sha}`);
  });
});

describe("one file", () => {
  it("comes back line by line, tabs as two spaces, control characters removed, with its GitHub link", async () => {
    const { calls, deps } = respond({ type: "file", encoding: "base64", size: 30, content: b64("a\n\tb\u0007\r\nc\n") });
    const f = await fetchCodeFile(repo, "src/my file.js", null, deps);
    expect(f).toMatchObject({ path: "src/my file.js", at: "main", lines: ["a", "  b", "c"], total: 3, truncated: false, url: "https://github.com/acme/ghostly/blob/main/src/my%20file.js" });
    expect(f?.outline).toEqual({ method: "none", language: "javascript", symbols: [] });
    expect(calls[0]).toContain("/contents/src/my%20file.js?ref=main");
  });
  it("carries its outline, read from the whole file", async () => {
    const { deps } = respond({ type: "file", encoding: "base64", size: 60, content: b64("class Ghost {\n  haunt() {}\n}\n") });
    const f = await fetchCodeFile(repo, "ghost.js", null, deps);
    expect(f?.outline).toEqual({ method: "parsed", language: "javascript", symbols: [{ name: "Ghost", kind: "class", from: 1, to: 3, depth: 0 }, { name: "haunt", kind: "method", from: 2, to: 2, depth: 1 }] });
  });
  it("shows at most the first lines of a long file and says so", async () => {
    const { deps } = respond({ type: "file", encoding: "base64", size: 9000, content: b64(Array.from({ length: MAX_LINES + 5 }, (_, i) => `l${i}`).join("\n")) });
    const f = await fetchCodeFile(repo, "big.js", null, deps);
    expect([f?.lines.length, f?.total, f?.truncated]).toEqual([MAX_LINES, MAX_LINES + 5, true]);
  });
  it("refuses binaries, folders and huge files", async () => {
    expect(await fetchCodeFile(repo, "x.bin", null, respond({ type: "file", encoding: "base64", size: 3, content: b64("a\u0000b") }).deps)).toBeNull();
    expect(await fetchCodeFile(repo, "dir", null, respond({ type: "dir", size: 0 }).deps)).toBeNull();
    expect(await fetchCodeFile(repo, "huge.js", null, respond({ type: "file", encoding: "base64", size: 2_000_000, content: b64("a") }).deps)).toBeNull();
  });
});
