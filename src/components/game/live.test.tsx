import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { buildEntity } from "@/config/entities";
import { assignmentFromIdentity, repoSignalsFromMetadata } from "@/domain/entity";
import type { GroundedAnswer } from "@/domain/chat";
import type { RepoMetadata, SummonedRepo } from "@/domain/repo";
import { clearHistoryCacheForTests, fetchHistory, fetchHistoryCached } from "@/server/github/history";
import { chronological, fakeHistoryGitHub } from "@/server/evidence/test-era-github";
import { liveAsk, toAskResult } from "./ask";
import { buildLiveData } from "./live-data";
import { spriteFor } from "./scene-theme";
import { mockGameData } from "./mock-data";
import { presentationFor, stageFor } from "./presentation";
import { GameProvider } from "./game-context";
import { ArchiveSummary, CiteChip, EvidenceDetail, MemoryJournal, RecordsBody } from "./panels";
import { Game } from "./Game";

const repo: RepoMetadata = {
  repoId: 4242, owner: "acme", name: "ghostly", fullName: "acme/ghostly", htmlUrl: "https://github.com/acme/ghostly", description: "A made-up test repository",
  defaultBranch: "main", archived: true, language: "Rust", stars: 5, license: null, pushedAt: "2024-05-05T00:00:00.000Z", createdAt: "2018-12-01T00:00:00.000Z", topics: [],
};
const assignment = (stage: "distorted" | "transformed" = "transformed") => ({
  ...assignmentFromIdentity(buildEntity(repoSignalsFromMetadata(repo), "live-test-seed"), "2026-11-01T00:00:00.000Z"),
  currentStage: stage,
});
const sha = (n: number) => `${n.toString(16).padStart(8, "0")}${"ab".repeat(16)}`;
function summoned(over: Partial<SummonedRepo> = {}): SummonedRepo {
  return {
    repo, status: "archived", retrievedAt: "2026-11-01T12:00:00.000Z", sections: { commit: { state: "ok" }, readme: { state: "ok" } },
    latestCommit: { sha: sha(10), htmlUrl: `${repo.htmlUrl}/commit/${sha(10)}`, messageHeadline: "Last words", committedAt: "2024-05-05T00:00:00.000Z" },
    readme: { path: "README.md", htmlUrl: `${repo.htmlUrl}#readme`, excerpt: "# Ghostly\n\nA small library.", truncated: false },
    evidence: [{ id: "ev:4242:repo-metadata:current:aaaaaaaaaa", repoId: 4242, kind: "repo-metadata", sourceUrl: repo.htmlUrl, retrievedAt: "2026-11-01T12:00:00.000Z", excerpt: "acme/ghostly\narchived: true\nlast push: 2024-05-05T00:00:00.000Z", truncated: false }],
    ...over,
  };
}
const history = async (n: number) => {
  const gh = fakeHistoryGitHub({ commits: chronological(n) });
  return fetchHistory(repo, { fetch: gh.fetch, token: "" });
};

describe("how the ghost looks in each era (a narrative convention)", () => {
  it("shows the saved form at the latest era and a human at the first", () => {
    const ids = Array.from({ length: 12 }, (_, i) => sha(i + 1));
    for (const saved of ["distorted", "transformed"] as const) {
      const p = presentationFor(ids, saved);
      expect(p[0].stage).toBe("human");
      expect(p.at(-1)!.stage).toBe(saved);
    }
  });
  it("only moves forwards through human, distorted, saved", () => {
    const order = { human: 0, distorted: 1, transformed: 2 } as const;
    const p = presentationFor(Array.from({ length: 12 }, (_, i) => sha(i + 1)), "transformed");
    const ranks = p.map((x) => order[x.stage]);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    expect(new Set(ranks).size).toBe(3);
  });
  it("invents no progression from a short history: fewer than three commits all show the saved form", () => {
    expect(presentationFor([sha(1), sha(2)], "distorted").map((x) => x.stage)).toEqual(["distorted", "distorted"]);
    expect(presentationFor([sha(1)], "transformed")[0].stage).toBe("transformed");
    expect(stageFor(0, 2, "transformed")).toBe("transformed");
  });
  it("is deterministic and depends only on the commit ids and the saved form", () => {
    const ids = [sha(1), sha(2), sha(3), sha(4)];
    expect(presentationFor(ids, "distorted")).toEqual(presentationFor(ids, "distorted"));
  });
  it("puts no facts in the ghost's era lines", () => {
    for (const e of presentationFor(Array.from({ length: 30 }, (_, i) => sha(i + 1)), "transformed")) expect(e.ghostLine).not.toMatch(/\d|github|commit|issue|archived/i);
  });
});

describe("buildLiveData", () => {
  it("names the ghost after the repository and keeps the saved identity", async () => {
    const d = buildLiveData({ summoned: summoned(), history: await history(30), ghost: { status: "persisted", assignment: assignment() }, replyMode: "scripted" });
    expect(d.mode).toBe("live");
    expect(d.ghostName).toBe("ghostly");
    expect(d.repo.fullName).toBe("acme/ghostly");
    expect(d.identity.state).toBe("saved");
    expect(d.restingStage).toBe("transformed");
    expect(d.eras).toHaveLength(12);
    expect(d.eras.at(-1)!.stage).toBe("transformed");
  });
  it("makes every era a real commit with a GitHub link and a full SHA", async () => {
    const d = buildLiveData({ summoned: summoned(), history: await history(30), ghost: { status: "persisted", assignment: assignment() }, replyMode: "scripted" });
    for (const e of d.eras) {
      expect(e.fullSha).toMatch(/^[0-9a-f]{40}$/);
      expect(e.url).toBe(`https://github.com/acme/ghostly/commit/${e.fullSha}`);
      expect(e.sha).toBe(e.fullSha!.slice(0, 7));
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
  it("shows present-day facts only from the latest era on", async () => {
    const d = buildLiveData({ summoned: summoned(), history: await history(30), ghost: { status: "persisted", assignment: assignment() }, replyMode: "scripted" });
    const last = d.eras.length - 1;
    const now = d.evidence.find((e) => e.id === "repo:now")!;
    expect(now.since).toBe(last);
    expect(d.evidence.find((e) => e.id === "repo:readme")!.since).toBe(last);
    expect(d.observed.find((o) => o.id === "o-archived")!.since).toBe(last);
    expect(d.observed.find((o) => o.id === "o-created")!.since).toBe(0);
    expect(d.readings.every((r) => r.since === last)).toBe(true);
  });
  it("says when the history is only a sample, and never claims it is whole", async () => {
    const d = buildLiveData({ summoned: summoned(), history: await history(640), ghost: { status: "persisted", assignment: assignment() }, replyMode: "scripted" });
    expect(d.history).toMatchObject({ complete: false, total: 640 });
    expect(d.history.note).toMatch(/640 commits/);
    expect(d.unknown.some((u) => /in between were not read/.test(u.text))).toBe(false); // the long sampling sentence is no longer shown; the journal says "N of total commits"
  });
  it("does not invent a timeline when history could not be read: the latest commit alone, with the reason", () => {
    const d = buildLiveData({ summoned: summoned(), history: null, historyProblem: "The commit history could not be loaded (GitHub took too long to respond).", ghost: { status: "persisted", assignment: assignment() }, replyMode: "scripted" });
    expect(d.eras).toHaveLength(1);
    expect(d.eras[0].fullSha).toBe(sha(10));
    expect(d.history.note).toMatch(/could not be loaded/);
    expect(d.unknown.some((u) => /could not be loaded/.test(u.text))).toBe(true);
  });
  it("has no eras at all when GitHub gave no commit", () => {
    const d = buildLiveData({ summoned: summoned({ latestCommit: null, sections: { commit: { state: "empty" }, readme: { state: "ok" } } }), history: null, ghost: { status: "persisted", assignment: assignment() }, replyMode: "scripted" });
    expect(d.eras).toEqual([]);
    expect(d.evidence.filter((e) => e.kind === "commit")).toHaveLength(0);
  });
  it("labels a provisional identity as not saved", () => {
    const d = buildLiveData({ summoned: summoned(), history: null, ghost: { status: "provisional", assignment: assignment(), reason: "store_unavailable" }, replyMode: "scripted" });
    expect(d.identity.state).toBe("provisional");
    expect(d.identity.note).toMatch(/not saved/);
  });
  it("is serializable, so the server can hand it to the browser", async () => {
    const d = buildLiveData({ summoned: summoned(), history: await history(30), ghost: { status: "persisted", assignment: assignment() }, replyMode: "scripted" });
    expect(JSON.parse(JSON.stringify(d))).toEqual(d);
  });
  it("renders with real data: the ghost is named for the repository, the live label is shown, and no prototype tools or Mock labels appear", async () => {
    const d = buildLiveData({ summoned: summoned(), history: await history(30), ghost: { status: "persisted", assignment: assignment() }, replyMode: "scripted" });
    const html = renderToStaticMarkup(<Game data={d} />);
    expect(html).toContain('data-testid="live-banner"');
    expect(html).toContain(">ghostly<");
    expect(html).not.toContain('data-testid="tools"');
    expect(html).not.toContain("Invented data");
    expect(html).not.toMatch(/>Mock</);
    expect(html).not.toContain("Identity saved");
  });
  it("renders the offline demo with Mock labels and, when asked for, the review tools", () => {
    const html = renderToStaticMarkup(<Game data={mockGameData()} />);
    expect(html).toContain('data-testid="mock-banner"');
    expect(html).toContain(">Mock<");
    expect(html).not.toContain('data-testid="tools"');
    expect(renderToStaticMarkup(<Game data={mockGameData()} tools />)).toContain('data-testid="tools"');
  });
});

describe("asking from the browser", () => {
  const answer = (over: Partial<GroundedAnswer> = {}): GroundedAnswer => ({
    segments: [
      { kind: "ghost", text: "A sound without a translation.", citations: [] },
      { kind: "verified", text: "The README opens with a line.", citations: [{ ref: "E1", id: "ev:4242:readme:abc:1", kind: "readme", label: "readme", url: "https://github.com/acme/ghostly#readme", excerpt: "# Ghostly" }] },
      { kind: "unknown", text: "The evidence does not say why.", citations: [] },
    ],
    sources: [{ ref: "E1", id: "ev:4242:readme:abc:1", kind: "readme", label: "readme", url: "https://github.com/acme/ghostly#readme", excerpt: "# Ghostly", revisionSha: sha(3) }],
    intent: "general", form: "current", stage: "distorted", voice: "horror", provider: "mock", scripted: true, gaps: [], identityStatus: "persisted", ...over,
  });
  it("keeps theatre and facts apart: ghost lines are ghost, record lines carry sources", () => {
    const r = toAskResult(answer(), 3);
    expect(r.reply.segments.map((s) => s.kind)).toEqual(["ghost", "record", "unknown"]);
    expect(r.reply.segments[0].cites).toEqual([]);
    expect(r.reply.segments[1].cites).toEqual(["ev:4242:readme:abc:1"]);
    expect(r.evidence[0]).toMatchObject({ url: "https://github.com/acme/ghostly#readme", excerpt: "# Ghostly", since: 3, source: "answer", revision: sha(3).slice(0, 7) });
  });
  const data = { repo: { owner: "acme", name: "ghostly" } as never, eras: buildLiveData({ summoned: summoned(), history: null, ghost: { status: "persisted", assignment: assignment() }, replyMode: "scripted" }).eras };
  const twoEras = {
    repo: data.repo,
    eras: [
      { ...data.eras[0], id: "a", fullSha: sha(1), stage: "human" as const },
      { ...data.eras[0], id: "b", fullSha: sha(2), stage: "transformed" as const },
    ],
  };
  const respond = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
  it("asks about the present for the latest era and sends no era", async () => {
    const f = respond({ ok: true, answer: answer() });
    await liveAsk(twoEras, f)({ question: "Why?", eraIdx: 1, history: [] });
    const body = JSON.parse((vi.mocked(f).mock.calls[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({ owner: "acme", repo: "ghostly", question: "Why?", form: "current" });
    expect(body.asOf).toBeUndefined();
    expect(body.eraStage).toBeUndefined();
  });
  it("sends the full SHA and the era's look for an earlier era", async () => {
    const f = respond({ ok: true, answer: answer() });
    await liveAsk(twoEras, f)({ question: "Why?", eraIdx: 0, history: [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }] });
    const body = JSON.parse((vi.mocked(f).mock.calls[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({ asOf: sha(1), eraStage: "human" });
    expect(Object.keys(body).sort()).toEqual(["asOf", "eraStage", "form", "history", "owner", "question", "repo"]);
  });
  it("reports a server failure with its reason, a network failure plainly, and unreadable data", async () => {
    const fail = await liveAsk(twoEras, respond({ ok: false, code: "provider_error", message: "The ghost could not answer right now." }))({ question: "x", eraIdx: 1, history: [] });
    expect(fail).toEqual({ ok: false, code: "provider_error", message: "The ghost could not answer right now.", retryAfterSec: undefined });
    const down = await liveAsk(twoEras, (async () => { throw new TypeError("offline"); }) as unknown as typeof fetch)({ question: "x", eraIdx: 1, history: [] });
    expect(down).toMatchObject({ ok: false, code: "network" });
    const junk = await liveAsk(twoEras, (async () => new Response("<html>", { status: 502 })) as unknown as typeof fetch)({ question: "x", eraIdx: 1, history: [] });
    expect(junk).toMatchObject({ ok: false, code: "bad_response" });
  });
});

describe("history cache", () => {
  it("reads GitHub once for repeated page loads, and again after it expires", async () => {
    clearHistoryCacheForTests();
    const gh = fakeHistoryGitHub({ commits: chronological(5) });
    const deps = { fetch: gh.fetch, token: "" };
    let t = 1_000;
    await fetchHistoryCached(repo, deps, { now: () => t });
    await fetchHistoryCached(repo, deps, { now: () => t + 1000 });
    expect(gh.calls.filter((c) => c.includes("/commits"))).toHaveLength(1);
    t += 10 * 60_000;
    await fetchHistoryCached(repo, deps, { now: () => t });
    expect(gh.calls.filter((c) => c.includes("/commits"))).toHaveLength(2);
    clearHistoryCacheForTests();
  });
});

describe("which ghost body a saved identity gets", () => {
  it("follows the saved origin, so the same repository always gets the same ghost", () => {
    expect(spriteFor("watchkeeper")).toBe("watchkeeper");
    expect(spriteFor("radio-operator")).toBe("hound");
    expect(spriteFor("archivist")).toBe("archivist");
    expect(spriteFor("clockmaker")).toBe("clockmaker");
    expect(spriteFor(undefined)).toBe("archivist");
  });
});

describe("Memory Journal and evidence detail", () => {
  const withGame = async (n: number, node: (g: ReturnType<typeof asGame>) => React.ReactElement) => {
    const d = buildLiveData({ summoned: summoned(), history: await history(n), ghost: { status: "persisted", assignment: assignment() }, replyMode: "scripted" });
    const game = asGame(d);
    return renderToStaticMarkup(<GameProvider value={game}>{node(game)}</GameProvider>);
  };
  function asGame(d: ReturnType<typeof buildLiveData>) {
    return {
      ...d,
      allEvidence: [
        ...d.evidence,
        { id: "ev:cited", kind: "issue", label: "Issue #7", excerpt: "#7 Shutdown notice [open, opened 2016-01-01T00:00:00.000Z]", url: "https://github.com/acme/ghostly/issues/7", since: 2, source: "answer" as const },
      ],
    };
  }
  it("shows an older era clearly, with the way back, and keeps the coverage disclosure", async () => {
    const html = await withGame(640, () => <MemoryJournal eraIdx={3} visited={[3]} onSelect={() => undefined} />);
    expect(html).toContain("An older memory");
    expect(html).not.toContain("return-present"); // the one way back lives on the stage chip, not here
    expect(html).not.toMatch(/Return to [Pp]resent/);
    expect(html).toMatch(/12 of 640 commits/); // compact, still honest that this is a sample
    expect(html).not.toContain("in between were not read");
    expect(html).toContain("life-summary");
  });
  it("makes every shown commit a button and marks exactly one as selected and one as the present", async () => {
    const html = await withGame(30, () => <MemoryJournal eraIdx={5} visited={[5, 2]} onSelect={() => undefined} />);
    expect((html.match(/data-testid="era-\d+"/g) ?? []).length).toBe(12);
    expect((html.match(/aria-current="true"/g) ?? []).length).toBe(1);
    expect((html.match(/data-present="true"/g) ?? []).length).toBe(1);
    expect(html).toContain("Last commit");
    expect(html).not.toMatch(/Unopened|Revisited/);
  });
  it("shows no way back while in the present", async () => {
    const html = await withGame(30, (g) => <MemoryJournal eraIdx={g.eras.length - 1} visited={[]} onSelect={() => undefined} />);
    expect(html).not.toContain("return-present");
    expect(html).toContain("The present");
  });
  it("lists nothing when no commit could be read, instead of inventing a past", () => {
    const d = buildLiveData({ summoned: summoned({ latestCommit: null, sections: { commit: { state: "empty" }, readme: { state: "ok" } } }), history: null, ghost: { status: "persisted", assignment: assignment() }, replyMode: "scripted" });
    const html = renderToStaticMarkup(<GameProvider value={asGame(d)}><MemoryJournal eraIdx={0} visited={[]} onSelect={() => undefined} /></GameProvider>);
    expect(html).toContain("No commits could be read");
    expect(html).not.toContain("data-testid=\"era-");
  });
  it("offers the proof as a quiet seal with an accessible name, not as a visible block of chips", async () => {
    const html = await withGame(30, () => <CiteChip ids={["ev:cited"]} onCite={() => undefined} />);
    expect(html).toContain('class="gg-cite"');
    expect(html).toContain('aria-label="Open records for this line: Issue #7"');
    expect(html).toContain("<svg");
    expect(html.replace(/<[^>]+>/g, "").trim()).toBe(""); // no visible text at all
  });
  it("the records drawer lists every source behind a line, each with its text and GitHub link", async () => {
    const html = await withGame(30, () => <RecordsBody ids={["ev:cited", "repo:readme"]} />);
    expect((html.match(/<section/g) ?? []).length).toBe(2);
    expect(html).toContain("Shutdown notice");
  });
  it("the archive panel is short and in-world: no archetype wording in the normal view, a place instead", async () => {
    const html = await withGame(30, (g) => <ArchiveSummary form="distorted" emotion="neutral" eraIdx={g.eras.length - 1} />);
    expect(html).not.toMatch(/fictional ghost|Archetype|archetype|The Archivist|storytelling/i);
    expect(html).toMatch(/Haunts (the )?[a-z ]+/);
    expect(html).toContain("View on GitHub");
  });
  it("shows the evidence type, source, retrieved text, GitHub link and the era it was read for", async () => {
    const html = await withGame(30, () => <EvidenceDetail id="ev:cited" />);
    expect(html).toContain("Issue");
    expect(html).toContain("Shutdown notice");
    expect(html).toContain('href="https://github.com/acme/ghostly/issues/7"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toMatch(/Read for the era of commit [0-9a-f]{7}/);
    expect(html).toContain("Nothing after that commit was used");
  });
  it("says so for a source that is not available", async () => {
    expect(await withGame(30, () => <EvidenceDetail id="nope" />)).toContain("not available");
  });
});
