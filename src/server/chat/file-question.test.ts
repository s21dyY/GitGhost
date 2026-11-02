import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildEntity } from "@/config/entities";
import { assignmentFromIdentity, repoSignalsFromMetadata, type EntityAssignment } from "@/domain/entity";
import type { RepoMetadata } from "@/domain/repo";
import { createIdentityCache, createStoreBreaker } from "@/server/entity/cache";
import { classifyIntent, detectFileRef } from "@/server/evidence/intent";
import { createEvidenceCache } from "@/server/evidence/retrieve";
import { createMemoryAssignmentStore } from "@/server/storage/assignments";
import { answerQuestion, type PipelineDeps, type PipelineRequest } from "./pipeline";
import { fakeGitHub, pull, type Scenario } from "./test-github";
import { createMemoryUsageStore } from "./usage-store";

/** V7: "why is this file (or this line) written this way?" Every repository, commit and pull request here is invented. */
const headers = () => ({ get: () => null });
const req = (over: Partial<PipelineRequest> = {}): PipelineRequest => ({ owner: "acme", repo: "ghostly", question: "Why does lib/retry.js line 3 wait so long?", history: [], form: "current", headers: headers(), ...over });
const now = Date.UTC(2026, 9, 31, 12, 0, 0);
const hex = (n: number) => `${n.toString(16).padStart(2, "0")}${"ab".repeat(19)}`;
const CHANGED = hex(0x31), FIRST = hex(0x20), NEWEST = hex(0x40);

let usage: ReturnType<typeof createMemoryUsageStore>;
let identities: ReturnType<typeof createMemoryAssignmentStore>;
let counter = 0;

function harness(gh: ReturnType<typeof fakeGitHub>, token = "test-token"): PipelineDeps {
  return {
    env: { GITGHOST_CHAT_PROVIDER: "mock" },
    github: { fetch: gh.fetch, token },
    now: () => new Date(now),
    cache: createEvidenceCache(),
    resolveIdentity: (repo: RepoMetadata, d) =>
      import("@/server/entity/resolve").then((m) =>
        m.resolveEntityForRepo(repo, { ...d, store: identities, cache: createIdentityCache(), breaker: createStoreBreaker(), newSeed: () => `seed-${++counter}`, now: () => new Date(now) }),
      ),
    chat: { now: () => now, store: usage, localStore: usage, log: () => undefined },
  };
}
async function saveIdentity(): Promise<EntityAssignment> {
  const meta = { repoId: 4242, owner: "acme", name: "ghostly", fullName: "acme/ghostly", htmlUrl: "https://github.com/acme/ghostly", description: "A made-up test repository", defaultBranch: "main", archived: true, language: "JavaScript", stars: 1, license: null, pushedAt: null, createdAt: "2012-05-01T00:00:00.000Z", topics: [] } satisfies RepoMetadata;
  const a = assignmentFromIdentity(buildEntity(repoSignalsFromMetadata(meta), "saved-seed"), new Date(now).toISOString());
  await identities.putIfAbsent(a);
  return a;
}
const RETRY = ["export async function retry(fn) {", "  for (let i = 0; i < 5; i++) {", "    await sleep(3000); // slow down between attempts", "    try { return await fn(); } catch {}", "  }", "}"].join("\n");
const scenario = (over: Partial<Scenario> = {}): Scenario => ({
  files: {
    "lib/retry.js": {
      commits: [{ sha: NEWEST, message: "Tidy retry helper", date: "2021-06-01T10:00:00Z" }, { sha: CHANGED, message: "Back off before retrying", date: "2019-04-01T10:00:00Z" }],
      older: { sha: FIRST, message: "Add retry helper", date: "2015-02-01T10:00:00Z" },
      content: RETRY,
    },
  },
  blame: [{ start: 1, end: 2, sha: FIRST, headline: "Add retry helper", date: "2015-02-01T10:00:00Z" }, { start: 3, end: 3, sha: CHANGED, headline: "Back off before retrying", date: "2019-04-01T10:00:00Z" }],
  commitPulls: { [CHANGED]: [pull(412, "Back off to avoid rate limits", { body: "We wait three seconds because the API rejects bursts of requests.", merged_at: "2019-04-01T09:00:00Z" })] },
  ...over,
});

beforeEach(() => {
  usage = createMemoryUsageStore(() => now);
  identities = createMemoryAssignmentStore();
  counter = 0;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("finding the file in a question", () => {
  it("reads paths, line numbers and ranges, and leaves ordinary questions alone", () => {
    expect(detectFileRef("Why does lib/retry.js wait 3 seconds?")).toEqual({ path: "lib/retry.js" });
    expect(detectFileRef("what is src/api.ts:42 doing")).toEqual({ path: "src/api.ts", line: 42 });
    expect(detectFileRef("explain server.py#L10-L20")).toEqual({ path: "server.py", line: 10, endLine: 20 });
    expect(detectFileRef("why is line 42 of index.js like this")).toEqual({ path: "index.js", line: 42 });
    expect(detectFileRef("I love Node.js")).toBeNull();
    expect(detectFileRef("Why did you die?")).toBeNull();
    expect(classifyIntent("Why did lib/retry.js stop working?")).toBe("file"); // naming a file wins over "status" words
  });
  it("can only ever name a file inside the repository", () => {
    expect(detectFileRef("read ../../etc/passwd.txt")).toBeNull();
    expect(detectFileRef("see https://evil.example/x.js")?.path ?? "").not.toMatch(/https?:|\.\.|evil/); // a URL is not a file here
    expect(detectFileRef(`${"a/".repeat(200)}b.js`)).toBeNull();
  });
});

describe("why is this line written this way?", () => {
  it("names the line, the commit that changed it, the file's first commit and the pull request's stated reason, all cited", async () => {
    await saveIdentity();
    const gh = fakeGitHub(scenario());
    const r = await answerQuestion(req(), harness(gh));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const a = r.answer;
    const t = a.segments.map((s) => s.text).join(" ");
    expect(a.intent).toBe("file");
    expect(t).toContain("sleep(3000)");
    expect(t).toContain("Back off before retrying");
    expect(t).toContain("Add retry helper");
    expect(t).toContain("#412");
    expect(t).toContain("because the API rejects bursts");
    for (const s of a.segments.filter((x) => x.kind === "verified")) expect(s.citations.length).toBeGreaterThan(0);
    const urls = a.sources.map((s) => s.url);
    expect(urls).toContain(`https://github.com/acme/ghostly/commit/${CHANGED}`);
    expect(urls).toContain("https://github.com/acme/ghostly/pull/412");
    expect(urls.some((u) => u.startsWith("https://github.com/acme/ghostly/blob/main/lib/retry.js#L"))).toBe(true);
    // bounded: three base calls plus at most five for the file
    expect(gh.calls.length).toBeLessThanOrEqual(8);
  });

  it("without a GitHub token there is no line blame, and the answer admits it instead of guessing", async () => {
    await saveIdentity();
    const r = await answerQuestion(req(), harness(fakeGitHub(scenario()), ""));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.answer.gaps.join(" ")).toContain("needs a GitHub token");
    const t = r.answer.segments.map((s) => s.text).join(" ");
    expect(t).toContain("sleep(3000)"); // the code is still read
    expect(t).not.toContain("last changed in commit"); // but no line is pinned on a commit
  });

  it("a reason is quoted only when a commit or pull request states one; otherwise it says nobody wrote it down", async () => {
    await saveIdentity();
    const quiet = scenario({ commitPulls: { [CHANGED]: [pull(412, "Retry changes", { body: "Adjusted the delay." })] } });
    const r = await answerQuestion(req(), harness(fakeGitHub(quiet)));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const unknown = r.answer.segments.filter((s) => s.kind === "unknown").map((s) => s.text).join(" ");
    expect(unknown).toMatch(/says why/);
    expect(r.answer.segments.map((s) => s.text).join(" ")).not.toMatch(/because/);
  });

  it("a file that is not in the history is admitted, not invented", async () => {
    await saveIdentity();
    const r = await answerQuestion(req({ question: "Why does lib/missing.js exist?" }), harness(fakeGitHub(scenario())));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.answer.segments.filter((s) => s.kind === "verified")).toHaveLength(0);
    expect(r.answer.segments.map((s) => s.text).join(" ")).toMatch(/could not find lib\/missing\.js/);
  });

  it("a short follow-up keeps talking about the same file", async () => {
    await saveIdentity();
    const r = await answerQuestion(
      req({ question: "tell me more", history: [{ role: "user", content: "Why does lib/retry.js line 3 wait so long?" }, { role: "assistant", content: "It remembers." }] }),
      harness(fakeGitHub(scenario())),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.answer.intent).toBe("file");
    expect(r.answer.segments.map((s) => s.text).join(" ")).toContain("Back off before retrying");
  });

  it("in an older era, the file is read as it stood then: a pull request merged later is not known", async () => {
    await saveIdentity();
    const s = scenario({ commitPulls: { [CHANGED]: [pull(412, "Back off to avoid rate limits", { body: "Because bursts fail.", merged_at: "2024-01-01T00:00:00Z", created_at: "2023-12-01T00:00:00Z" })] } });
    const gh = fakeGitHub({ ...s, commits: [{ sha: CHANGED, message: "Back off before retrying", date: "2019-04-01T10:00:00Z" }] });
    const r = await answerQuestion(req({ asOf: CHANGED, eraStage: "distorted" }), harness(gh));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.answer.asOf?.sha).toBe(CHANGED);
    expect(r.answer.sources.map((x) => x.url)).not.toContain("https://github.com/acme/ghostly/pull/412");
  });
});
