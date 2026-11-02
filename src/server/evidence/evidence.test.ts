import { describe, expect, it } from "vitest";
import { EvidenceItemSchema } from "@/domain/evidence";
import { fakeGitHub, issue, pull } from "@/server/chat/test-github";
import { classifyIntent, intentForTurn, isFollowUp } from "./intent";
import { createEvidenceCache, retrieveEvidence } from "./retrieve";
import { selectEvidence } from "./select";

const ref = { owner: "acme", repo: "ghostly" };
const NOW = () => new Date("2026-10-31T12:00:00Z");
const run = (gh: ReturnType<typeof fakeGitHub>, intent: Parameters<typeof retrieveEvidence>[1], cache = createEvidenceCache()) =>
  retrieveEvidence(ref, intent, { github: { fetch: gh.fetch, token: "" }, now: NOW, cache });

describe("intent", () => {
  it.each([
    ["Why did you die?", "status"], ["Are you abandoned?", "status"], ["Is this project still maintained?", "status"],
    ["What happened lately?", "recent"], ["What changed recently", "recent"],
    ["How did you begin?", "history"], ["Tell me about your origin", "history"],
    ["What were people complaining about?", "issues"], ["Any bugs?", "issues"],
    ["Hello there", "general"],
  ])("%s -> %s", (q, intent) => expect(classifyIntent(q)).toBe(intent));

  it("short follow-ups keep the earlier topic; real questions do not", () => {
    expect(isFollowUp("Tell me more")).toBe(true);
    expect(isFollowUp("and then?")).toBe(true);
    expect(intentForTurn("tell me more", ["Why did you die?", "ok"])).toBe("status");
    expect(intentForTurn("tell me more", ["hello"])).toBe("general");
    expect(intentForTurn("What were the bugs?", ["Why did you die?"])).toBe("issues");
    expect(isFollowUp("Tell me more about how the release process works in detail please")).toBe(false);
  });
});

describe("normalization into evidence", () => {
  it("builds validated, uniquely identified items with server-built GitHub URLs", async () => {
    const gh = fakeGitHub({ issues: [issue(7, "Sunset plan"), pull(9, "Archive notice", { pull_request: {} })] });
    const r = await run(gh, "status");
    if (!r.ok) throw new Error("expected ok");
    expect(r.repo.repoId).toBe(4242);
    const ids = new Set<string>();
    for (const item of r.items) {
      expect(EvidenceItemSchema.safeParse(item).success).toBe(true);
      expect(item.repoId).toBe(4242);
      expect(item.sourceUrl.startsWith("https://github.com/acme/ghostly")).toBe(true);
      expect(item.sourceUrl).not.toContain("evil.example"); // API html_url fields are ignored
      ids.add(item.id);
    }
    expect(ids.size).toBe(r.items.length);
    const kinds = r.items.map((i) => i.kind);
    expect(kinds).toEqual(expect.arrayContaining(["repo-metadata", "commit", "readme", "issue"]));
    expect(r.items.find((i) => i.kind === "issue")!.sourceUrl).toBe("https://github.com/acme/ghostly/issues/7");
    expect(r.items.find((i) => i.kind === "issue")!.label).toBe("Issue #7");
  });

  it("separates pull requests that GitHub lists among issues, and drops author names", async () => {
    const gh = fakeGitHub({ issues: [issue(1, "A bug"), issue(2, "Merged change", { pull_request: {} })] });
    const r = await run(gh, "issues");
    if (!r.ok) throw new Error("expected ok");
    expect(r.items.filter((i) => i.kind === "issue").map((i) => i.excerpt.slice(0, 2))).toEqual(["#1"]);
    expect(JSON.stringify(r.items)).not.toContain("someone-private");
  });

  it("strips control characters and bounds long text", async () => {
    const gh = fakeGitHub({ issues: [issue(3, `Bad\u0000 title\u202e ${"x".repeat(500)}`, { body: "y".repeat(5000) })] });
    const r = await run(gh, "issues");
    if (!r.ok) throw new Error("expected ok");
    const it = r.items.find((i) => i.kind === "issue")!;
    expect(it.excerpt).not.toMatch(/[\u0000\u202e]/);
    expect(it.excerpt.length).toBeLessThanOrEqual(900);
    expect(it.truncated).toBe(true);
  });

  it("comments get fragment URLs built from integer IDs", async () => {
    const gh = fakeGitHub({ issues: [issue(5, "Sunset notice")], comments: [{ id: 99, body: "We are archiving this.", created_at: "2022-03-01T00:00:00Z" }] });
    const r = await run(gh, "status");
    if (!r.ok) throw new Error("expected ok");
    const c = r.items.find((i) => i.kind === "issue-comment")!;
    expect(c.sourceUrl).toBe("https://github.com/acme/ghostly/issues/5#issuecomment-99");
  });
});

describe("selective, bounded retrieval", () => {
  const count = (gh: ReturnType<typeof fakeGitHub>, re: RegExp) => gh.calls.filter((c) => re.test(c)).length;

  it.each([
    ["status", 7], ["recent", 6], ["history", 4], ["issues", 6], ["general", 4],
  ] as const)("%s uses at most %i GitHub requests", async (intent, max) => {
    const gh = fakeGitHub({ issues: [issue(1, "One")], pulls: [pull(2, "Two")] });
    await run(gh, intent);
    expect(gh.calls.length).toBeLessThanOrEqual(max);
    for (const c of gh.calls) {
      const per = Number(/per_page=(\d+)/.exec(c)?.[1] ?? 1);
      expect(per).toBeLessThanOrEqual(30);
    }
  });

  it("never walks the whole history: no pagination, only the newest page", async () => {
    const gh = fakeGitHub();
    await run(gh, "status");
    expect(gh.calls.some((c) => /[?&]page=/.test(c))).toBe(false);
  });

  it("only fetches what the question needs", async () => {
    const history = fakeGitHub();
    await run(history, "history");
    expect(count(history, /\/issues/)).toBe(0);
    expect(count(history, /until=/)).toBe(1);
    const general = fakeGitHub();
    await run(general, "general");
    expect(count(general, /\/(issues|pulls)/)).toBe(0);
  });

  it("is cached briefly, so a repeat question makes no GitHub calls", async () => {
    const cache = createEvidenceCache();
    const gh = fakeGitHub();
    await run(gh, "recent", cache);
    const n = gh.calls.length;
    await run(gh, "recent", cache);
    expect(gh.calls.length).toBe(n);
  });
});

describe("missing, deleted and rate-limited evidence", () => {
  it("a missing README is a gap, not a failure", async () => {
    const r = await run(fakeGitHub({ readme: null }), "general");
    if (!r.ok) throw new Error("expected ok");
    expect(r.gaps.map((g) => g.source)).toContain("README");
    expect(r.items.some((i) => i.kind === "readme")).toBe(false);
  });

  it("disabled issues (410) and failing pulls become gaps while other evidence survives", async () => {
    const r = await run(fakeGitHub({ issuesStatus: 410, pullsStatus: 500 }), "status");
    if (!r.ok) throw new Error("expected ok");
    expect(r.gaps.map((g) => g.source)).toEqual(expect.arrayContaining(["issues", "pull requests"]));
    expect(r.items.some((i) => i.kind === "repo-metadata")).toBe(true);
  });

  it("rate limiting of one source is reported and is not cached", async () => {
    const cache = createEvidenceCache();
    const limited = await run(fakeGitHub({ issuesStatus: 403 }), "issues", cache);
    if (!limited.ok) throw new Error("expected ok");
    expect(limited.gaps.some((g) => g.code === "rate_limited")).toBe(true);
    expect(cache.size()).toBe(0);
  });

  it("an unknown or deleted repository fails cleanly", async () => {
    const r = await run(fakeGitHub({ repoStatus: 404 }), "status");
    expect(r).toMatchObject({ ok: false, code: "not_found" });
  });

  it("GitHub rate limiting of the repository itself is surfaced", async () => {
    const r = await run(fakeGitHub({ repoStatus: 403, repoHeaders: { "x-ratelimit-remaining": "0" } }), "status");
    expect(r).toMatchObject({ ok: false, code: "rate_limited" });
  });

  it("malformed list responses become gaps, never thrown errors", async () => {
    const r = await run(fakeGitHub({ issues: [{ number: "nope" }] as never }), "issues");
    if (!r.ok) throw new Error("expected ok");
    expect(r.gaps.some((g) => g.code === "invalid_response")).toBe(true);
  });
});

describe("selection within a context budget", () => {
  async function items(gh = fakeGitHub({ issues: [issue(1, "Sunset notice", { body: "We will archive this." }), issue(2, "Cache bug")] })) {
    const r = await run(gh, "status");
    if (!r.ok) throw new Error("expected ok");
    return r.items;
  }

  it("respects the byte budget and the item cap, and numbers references E1..En", async () => {
    const all = await items();
    const refs = selectEvidence(all, { intent: "status", question: "Why did you die?", byteBudget: 900 });
    expect(refs.reduce((n, r) => n + Buffer.byteLength(r.view), 0)).toBeLessThanOrEqual(900);
    expect(refs.map((r) => r.ref)).toEqual(refs.map((_, i) => `E${i + 1}`));
    expect(selectEvidence(all, { intent: "status", question: "x", byteBudget: 100_000, maxItems: 2 })).toHaveLength(2);
    expect(selectEvidence(all, { intent: "status", question: "x", byteBudget: 10 })).toHaveLength(0);
  });

  it("prefers status notices for status questions and metadata first", async () => {
    const all = await items(fakeGitHub({ issues: [issue(1, "Cache bug"), issue(2, "Project sunset notice", { body: "This project is deprecated." })] }));
    const refs = selectEvidence(all, { intent: "status", question: "Why did you die?", byteBudget: 1500 });
    expect(refs[0].item.kind).toBe("repo-metadata");
    const titles = refs.map((r) => r.item.excerpt);
    expect(titles.some((t) => t.includes("sunset"))).toBe(true);
    // 2C.3: an unrelated issue is left out once enough relevant items exist, instead of merely ranked lower
    expect(titles.some((t) => t.includes("Cache bug"))).toBe(false);
  });

  it("is deterministic", async () => {
    const all = await items();
    const a = selectEvidence(all, { intent: "status", question: "Why did you die?", byteBudget: 1500 });
    const b = selectEvidence(all, { intent: "status", question: "Why did you die?", byteBudget: 1500 });
    expect(a.map((r) => r.item.id)).toEqual(b.map((r) => r.item.id));
  });
});
