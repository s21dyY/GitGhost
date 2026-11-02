import { describe, expect, it } from "vitest";
import { parseRepoInput } from "@/domain/repo-ref";
import { fetchHistory, lastPageFromLink, MAX_ERAS, spread } from "@/server/github/history";
import { lookupRepository } from "@/server/github/summon";
import { dropFuture, retrieveEvidenceAsOf } from "./era";
import { createEvidenceCache } from "./retrieve";
import { chronological, fakeHistoryGitHub, sha, type FakeIssue } from "./test-era-github";

const ref = (() => {
  const r = parseRepoInput("acme/ghostly");
  if (!r.ok) throw new Error("bad ref");
  return r;
})();
const repoOf = async (gh: ReturnType<typeof fakeHistoryGitHub>) => lookupRepository(ref, { fetch: gh.fetch, token: "" });

describe("history helpers", () => {
  it("reads the last page from a Link header", () => {
    expect(lastPageFromLink(null)).toBe(1);
    expect(lastPageFromLink('<https://api.github.com/x?page=2>; rel="next", <https://api.github.com/x?per_page=100&page=57>; rel="last"')).toBe(57);
    expect(lastPageFromLink('<https://api.github.com/x?page=2>; rel="next"')).toBe(1);
  });
  it("spreads indexes evenly and always keeps both ends", () => {
    expect(spread(5, 12)).toEqual([0, 1, 2, 3, 4]);
    const s = spread(100, 12);
    expect(s).toHaveLength(12);
    expect(s[0]).toBe(0);
    expect(s.at(-1)).toBe(99);
  });
});

describe("fetchHistory", () => {
  it("returns a short history whole, oldest first, with GitHub links built by us and no authors", async () => {
    const gh = fakeHistoryGitHub({ commits: chronological(5) });
    const h = await fetchHistory(await repoOf(gh), { fetch: gh.fetch, token: "" });
    expect(h.complete).toBe(true);
    expect(h.total).toBe(5);
    expect(h.note).toBeNull();
    expect(h.commits.map((c) => c.headline)).toEqual(["Change number 1", "Change number 2", "Change number 3", "Change number 4", "Change number 5"]);
    expect(h.commits[0].url).toBe(`https://github.com/acme/ghostly/commit/${sha(1)}`);
    expect(JSON.stringify(h)).not.toMatch(/someone/i);
    expect(gh.calls.filter((c) => c.includes("/commits")).length).toBe(1);
  });
  it("reads two pages in full (up to 200 commits) and samples them evenly", async () => {
    const gh = fakeHistoryGitHub({ commits: chronological(130) });
    const h = await fetchHistory(await repoOf(gh), { fetch: gh.fetch, token: "" });
    expect(h.complete).toBe(true);
    expect(h.total).toBe(130);
    expect(h.commits).toHaveLength(MAX_ERAS);
    expect(h.commits[0].shortSha).toBe(sha(1).slice(0, 7));
    expect(h.commits.at(-1)!.shortSha).toBe(sha(130).slice(0, 7));
    expect(h.note).toMatch(/130 commits/);
  });
  it("never claims a long history is complete: it reads the oldest and the newest page and says what it skipped", async () => {
    const gh = fakeHistoryGitHub({ commits: chronological(640) });
    const h = await fetchHistory(await repoOf(gh), { fetch: gh.fetch, token: "" });
    expect(h.complete).toBe(false);
    expect(h.total).toBe(640);
    expect(h.commits).toHaveLength(MAX_ERAS);
    expect(h.note).toMatch(/640 commits/);
    expect(h.note).toMatch(/in between were not read/);
    // Only the first page and the last page were requested.
    const pages = gh.calls.filter((c) => c.includes("/commits")).map((c) => new URL(`https://x${c}`).searchParams.get("page"));
    expect(pages).toEqual(["1", "7"]);
    // Chronological order, oldest first, nothing from the middle.
    const times = h.commits.map((c) => Date.parse(c.date!));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(h.commits[0].shortSha).toBe(sha(1).slice(0, 7));
    expect(h.commits.at(-1)!.shortSha).toBe(sha(640).slice(0, 7));
    const middle = h.commits.filter((c) => { const n = parseInt(c.sha.slice(0, 8), 16); return n > 100 && n < 540; });
    expect(middle).toHaveLength(0);
  });
  it("handles an empty repository", async () => {
    const gh = fakeHistoryGitHub({ commits: [] });
    const h = await fetchHistory(await repoOf(gh), { fetch: gh.fetch, token: "" });
    expect(h).toMatchObject({ commits: [], complete: true, total: 0 });
  });
});

const commits = chronological(10); // 2019-01-01 + 30 days each
const ASOF = commits[4]; // the fifth commit
const ASOF_ISO = new Date(ASOF.date).toISOString();
const issues: FakeIssue[] = [
  { number: 1, title: "Early bug", state: "closed", created_at: "2019-01-20T00:00:00Z", closed_at: "2019-02-01T00:00:00Z" },
  { number: 2, title: "Closed later", state: "closed", created_at: "2019-03-01T00:00:00Z", closed_at: "2021-01-01T00:00:00Z" },
  { number: 3, title: "From the future", state: "open", created_at: "2022-01-01T00:00:00Z", closed_at: null },
  { number: 4, title: "A fix", state: "closed", created_at: "2019-02-01T00:00:00Z", closed_at: "2019-02-10T00:00:00Z", pull_request: { merged_at: "2019-02-10T00:00:00Z" } },
];

describe("Time Travel retrieval", () => {
  const run = async (intent: Parameters<typeof retrieveEvidenceAsOf>[1], over: Partial<Parameters<typeof fakeHistoryGitHub>[0]> = {}, at = ASOF.sha) => {
    const gh = fakeHistoryGitHub({ commits, issues, readmes: { [ASOF.sha]: "# Ghostly\n\nVersion one README.\n", HEAD: "# Ghostly\n\nThe present README mentions version nine.\n" }, ...over });
    const got = await retrieveEvidenceAsOf(ref, intent, at, { github: { fetch: gh.fetch, token: "" }, cache: createEvidenceCache(), now: () => new Date("2030-01-01T00:00:00Z") });
    return { got, gh };
  };

  it("reads only the selected commit and its ancestors", async () => {
    const { got, gh } = await run("recent");
    if (!got.ok) throw new Error(got.message);
    const commitItems = got.items.filter((i) => i.kind === "commit");
    expect(commitItems.length).toBeGreaterThan(0);
    expect(commitItems[0].revisionSha).toBe(ASOF.sha);
    for (const c of commitItems) expect(parseInt(c.revisionSha!.slice(0, 8), 16)).toBeLessThanOrEqual(5);
    expect(got.items.some((i) => i.excerpt.includes("Change number 6"))).toBe(false);
    expect(got.asOf).toMatchObject({ sha: ASOF.sha, shortSha: ASOF.sha.slice(0, 7), date: ASOF_ISO });
    expect(gh.calls.some((c) => c.includes(`sha=${ASOF.sha}`))).toBe(true);
    // The default branch head is never read for an era question.
    expect(gh.calls.some((c) => /commits\?sha=main/.test(c))).toBe(false);
  });
  it("reads the README at that commit, not at HEAD", async () => {
    const { got, gh } = await run("general");
    if (!got.ok) throw new Error(got.message);
    const readme = got.items.find((i) => i.kind === "readme");
    expect(readme?.excerpt).toContain("Version one");
    expect(readme?.excerpt).not.toContain("version nine");
    expect(readme?.revisionSha).toBe(ASOF.sha);
    expect(gh.calls.some((c) => c.includes(`/readme?ref=${ASOF.sha}`))).toBe(true);
  });
  it("leaves out present-day repository facts", async () => {
    const { got } = await run("status");
    if (!got.ok) throw new Error(got.message);
    const meta = got.items.find((i) => i.kind === "repo-metadata")!;
    expect(meta.excerpt).not.toMatch(/archived|stars|last push|Rust|9999|2030/i);
    expect(meta.excerpt).toContain("created on GitHub");
    expect(meta.excerpt).toContain("selected era");
  });
  it("searches issues created on or before the commit, and reconstructs their state at that time", async () => {
    const { got, gh } = await run("status");
    if (!got.ok) throw new Error(got.message);
    const search = gh.calls.find((c) => c.startsWith("/search/issues"))!;
    expect(decodeURIComponent(search)).toContain(`created:<=${ASOF_ISO}`);
    const threads = got.items.filter((i) => i.kind === "issue" || i.kind === "pull-request");
    const text = threads.map((t) => t.excerpt).join("\n");
    expect(text).toContain("Early bug");
    expect(text).not.toContain("From the future");
    // Closed in 2021, long after the commit: it was still open then, and the closing is not shown.
    const later = threads.find((t) => t.excerpt.includes("Closed later"))!;
    expect(later.excerpt).toContain("[open");
    expect(later.excerpt).not.toContain("2021");
    // Closed before the commit: shown as closed with its date.
    expect(threads.find((t) => t.excerpt.includes("Early bug"))!.excerpt).toContain("closed 2019-02-01");
    expect(threads.find((t) => t.excerpt.includes("A fix"))!.kind).toBe("pull-request");
    // No later edits can leak: bodies and comment counts are dropped.
    expect(text).not.toMatch(/may have been edited|99 comments/);
  });
  it("never lets a dated item past the commit through", () => {
    const base = { repoId: 4242, retrievedAt: "2030-01-01T00:00:00.000Z", truncated: false, sourceUrl: "https://github.com/acme/ghostly/issues/1" } as const;
    const mk = (n: number, excerpt: string) => ({ ...base, id: `ev:4242:issue:current:${n}`, kind: "issue" as const, excerpt });
    const kept = dropFuture([mk(1, "#1 Old [open, opened 2019-01-01T00:00:00Z]"), mk(2, "#2 New [open, opened 2022-01-01T00:00:00Z]")], Date.parse("2020-01-01T00:00:00Z"));
    expect(kept.map((k) => k.id)).toEqual(["ev:4242:issue:current:1"]);
  });
  it("makes no issue search for intents that do not need one, and reports a failed search as a gap", async () => {
    const a = await run("general");
    expect(a.gh.calls.some((c) => c.startsWith("/search"))).toBe(false);
    const b = await run("status", { searchStatus: 500 });
    if (!b.got.ok) throw new Error(b.got.message);
    expect(b.got.gaps.some((g) => g.source === "issues and pull requests")).toBe(true);
  });
  it("refuses a malformed SHA, a commit that is not in the repository, and a branch name", async () => {
    expect((await run("general", {}, "main")).got).toMatchObject({ ok: false, code: "bad_era" });
    expect((await run("general", {}, "../../etc")).got).toMatchObject({ ok: false, code: "bad_era" });
    expect((await run("general", {}, sha(999))).got).toMatchObject({ ok: false, code: "era_not_found" });
  });
  it("says so when the README did not exist at that commit", async () => {
    const { got } = await run("general", { readmes: { [ASOF.sha]: null } });
    if (!got.ok) throw new Error(got.message);
    expect(got.items.some((i) => i.kind === "readme")).toBe(false);
    expect(got.gaps.some((g) => g.source === "README" && /at that commit/.test(g.message))).toBe(true);
  });
  it("keeps different eras apart in the cache", async () => {
    const gh = fakeHistoryGitHub({ commits, issues });
    const cache = createEvidenceCache();
    const deps = { github: { fetch: gh.fetch, token: "" }, cache };
    const a = await retrieveEvidenceAsOf(ref, "general", commits[2].sha, deps);
    const b = await retrieveEvidenceAsOf(ref, "general", commits[6].sha, deps);
    if (!a.ok || !b.ok) throw new Error("failed");
    expect(a.asOf.sha).not.toBe(b.asOf.sha);
    expect(a.items.map((i) => i.id)).not.toEqual(b.items.map((i) => i.id));
  });
});
