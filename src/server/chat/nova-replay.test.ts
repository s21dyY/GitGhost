import { beforeEach, describe, expect, it, vi } from "vitest";
import { createIdentityCache, createStoreBreaker } from "@/server/entity/cache";
import { createEvidenceCache } from "@/server/evidence/retrieve";
import { createMemoryAssignmentStore } from "@/server/storage/assignments";
import { ATOM_REPO_ID, atomAssignment, atomPool, NOVA_LITE_2026_11_01_RAW } from "./fixtures/atom-status";
import { answerQuestion, type ModelExchange, type PipelineDeps } from "./pipeline";
import { fakeGitHub, issue } from "./test-github";
import type { ChatProvider } from "./types";
import { createMemoryUsageStore } from "./usage-store";

/**
 * Offline REPLAY of the real Amazon Nova Lite reply from Milestone 2C.2, and of the replies a corrected
 * model should give. The whole pipeline runs for real (retrieval from a fake GitHub that serves the
 * captured atom/atom text, selection, key facts, prompt, strict validation, rendering); only the model is
 * a fake provider that returns whatever text the test chooses. No network, no AWS, no cost.
 */
const NOW = Date.UTC(2026, 11, 1, 12, 0, 0);
const headers = { get: () => null };
const README = atomPool().find((i) => i.kind === "readme")!.excerpt;
const SHA = "1c3bd35ce238dc0491def9e1780d04748d8e18af";
// These URLs are built by the server from the fake GitHub (default branch "main"); the live run pinned the README to a commit SHA.
const URLS = { meta: "https://github.com/atom/atom", readme: "https://github.com/atom/atom/blob/main/README.md", commit: `https://github.com/atom/atom/commit/${SHA}` };

const gh = () =>
  fakeGitHub({
    owner: "atom", name: "atom", id: ATOM_REPO_ID, archived: true, readme: README,
    commits: [{ sha: SHA, message: "Merge pull request #25709 from atom/fix-snapshot-result-macos", date: "2022-11-22T16:11:57Z" }],
    issues: [issue(6867, "Atom packages that require an upgrade to 1.0 API", { body: "We've been collecting data on which packages have deprecations since 0.201." })],
  });

let identities: ReturnType<typeof createMemoryAssignmentStore>;
beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  identities = createMemoryAssignmentStore();
  await identities.putIfAbsent(atomAssignment("distorted"));
});

type Replay = { result: Awaited<ReturnType<typeof answerQuestion>>; exchange: ModelExchange | null; logs: { event: string; detail: Record<string, unknown> | undefined }[]; prompts: string[] };
async function replay(raw: string, opts: { stopReason?: string; form?: "current" | "human"; question?: string } = {}): Promise<Replay> {
  const usage = createMemoryUsageStore(() => NOW);
  const logs: Replay["logs"] = [];
  const prompts: string[] = [];
  let exchange: ModelExchange | null = null;
  const provider: ChatProvider = {
    id: "mock", billable: false,
    invoke: async (r) => {
      prompts.push(r.system);
      return { text: raw, usage: { inputTokens: 2162, outputTokens: 46 }, stopReason: opts.stopReason ?? "end_turn" };
    },
  };
  const deps: PipelineDeps = {
    env: { GITGHOST_CHAT_PROVIDER: "mock" },
    github: { fetch: gh().fetch, token: "" },
    now: () => new Date(NOW),
    cache: createEvidenceCache(),
    resolveIdentity: (repo, d) => import("@/server/entity/resolve").then((m) => m.resolveEntityForRepo(repo, { ...d, store: identities, cache: createIdentityCache(), breaker: createStoreBreaker(), newSeed: () => "n", now: () => new Date(NOW) })),
    chat: { now: () => NOW, store: usage, localStore: usage, log: (event, detail) => { logs.push({ event, detail }); } },
    providerOverride: () => provider,
    observe: (e) => { exchange = e; },
  };
  const result = await answerQuestion({ owner: "atom", repo: "atom", question: opts.question ?? "Why did you die?", history: [], form: opts.form ?? "current", headers }, deps);
  return { result, exchange, logs, prompts };
}
const reply = (...segments: unknown[]) => JSON.stringify({ segments });
const answerOf = (r: Replay) => {
  if (!r.result.ok) throw new Error(`pipeline refused: ${r.result.code}`);
  return r.result.answer;
};

/** What the lenient 2C.2 parser did: read `segments`, ignore every other key, say nothing. */
function legacyLenient(raw: string): { shown: string[]; lost: string[] } {
  const o = JSON.parse(raw) as Record<string, { text: string }[]>;
  return { shown: (o.segments ?? []).map((s) => s.text), lost: Object.keys(o).filter((k) => k !== "segments").flatMap((k) => o[k].map((s) => s.text)) };
}

const CORRECTED = reply(
  { kind: "ghost", text: "The pages grow quiet... but I still keep them, reader." },
  { kind: "verified", text: "GitHub lists atom/atom as archived, which makes it read-only.", cites: ["E1"] },
  { kind: "verified", text: "The README says: Atom and all repositories under Atom will be archived on December 15, 2022.", cites: ["E2"] },
  { kind: "verified", text: "The newest commit I retrieved on the default branch reads Merge pull request #25709 from atom/fix-snapshot-result-macos, dated 2022-11-22.", cites: ["E3"] },
  { kind: "unknown", text: "The evidence does not say why the project was archived." },
);

describe("BEFORE: what the real Nova Lite reply did under the lenient parser", () => {
  it("showed one 'not found' sentence and silently threw away the ghost line", () => {
    const old = legacyLenient(NOVA_LITE_2026_11_01_RAW);
    expect(old.shown).toEqual(["The reason for the repository's end is not detailed in the evidence."]);
    expect(old.lost).toEqual(["The end... is not... clear."]);
  });
});

describe("AFTER: the same reply under the strict contract", () => {
  it("is refused, with the reason recorded for developers and nothing shown to the visitor", async () => {
    const r = await replay(NOVA_LITE_2026_11_01_RAW);
    expect(r.result).toMatchObject({ ok: false, status: 502, code: "unverifiable_answer" });
    expect(r.exchange!.diagnostics).toMatchObject({ json: "ok", unknownTopLevelKeys: ["ghost"], refusedBecause: "unknown_top_level_keys", segmentCount: 1, stopReason: "end_turn", truncated: false });
    expect(r.exchange!.validation.ok).toBe(false);
    const visible = JSON.stringify(r.result);
    expect(visible).not.toMatch(/not detailed in the evidence|not\.\.\. clear/i);
  });
  it("logs a developer event with codes and counts only, never the model's words", async () => {
    const r = await replay(NOVA_LITE_2026_11_01_RAW);
    const ev = r.logs.find((l) => l.event === "model_output_rejected");
    expect(ev?.detail).toMatchObject({ refusedBecause: "unknown_top_level_keys", unknownTopLevelKeys: ["ghost"], topLevelKeys: ["segments", "ghost"], segmentCount: 1 });
    expect(JSON.stringify(r.logs)).not.toMatch(/The reason for the repository|not\.\.\. clear/);
  });
  it("the model is now shown 3 relevant references, not 10, and the prompt carries the key facts", async () => {
    const r = await replay(NOVA_LITE_2026_11_01_RAW);
    expect(r.exchange!.refs.map((x) => `${x.ref}:${x.item.kind}`)).toEqual(["E1:repo-metadata", "E2:readme", "E3:commit"]);
    expect(r.prompts[0]).toContain("[E2] README notice:");
    expect(r.prompts[0]).not.toMatch(/Comment on #6867|#6867/);
  });
});

describe("a corrected reply: complete, cited, in character", () => {
  it("is accepted whole, with sources rebuilt from the server's registry in first-use order", async () => {
    const r = await replay(CORRECTED);
    const a = answerOf(r);
    expect(a.segments.map((s) => s.kind)).toEqual(["ghost", "verified", "verified", "verified", "unknown"]);
    expect(a.sources.map((s) => s.url)).toEqual([URLS.meta, URLS.readme, URLS.commit]);
    expect(a.sources.map((s) => s.ref)).toEqual(["E1", "E2", "E3"]);
    expect(a.segments[0].citations).toEqual([]); // fictional dialogue cites nothing and is separate from the facts
    expect(a.segments.at(-1)!.citations).toEqual([]);
    expect(r.exchange!.diagnostics.quality).toEqual({ ghostSegments: 1, factualSegments: 3, unknownSegments: 1, keyFactsOffered: 4, citedRefs: ["E1", "E2", "E3"], thin: false });
    expect(r.logs.filter((l) => l.event.startsWith("model_"))).toEqual([]); // a clean reply produces no warning
  });
  it("states the archival facts AND says plainly that the reason is not in the evidence", async () => {
    const a = answerOf(await replay(CORRECTED));
    const factual = a.segments.filter((s) => s.kind === "verified").map((s) => s.text).join(" ");
    expect(factual).toContain("archived");
    expect(factual).toContain("December 15, 2022");
    expect(a.segments.at(-1)).toMatchObject({ kind: "unknown", text: "The evidence does not say why the project was archived." });
  });
  it("accepts a long factual explanation spread over several segments", async () => {
    const sentence = "GitHub lists atom/atom as archived, which makes it read-only. ";
    const long = sentence.repeat(7).slice(0, 380).trim();
    const a = answerOf(await replay(reply({ kind: "ghost", text: "Listen, reader." }, ...Array.from({ length: 4 }, () => ({ kind: "verified", text: long, cites: ["E1"] })), { kind: "unknown", text: "The evidence does not say why." })));
    expect(a.segments.filter((s) => s.kind === "verified")).toHaveLength(4);
  });
});

describe("thin or uncited replies are visible to developers", () => {
  it("an unknown-only reply is accepted (an honest 'not found' is valid) but flagged as thin", async () => {
    const r = await replay(reply({ kind: "ghost", text: "The end... is not... clear." }, { kind: "unknown", text: "The reason for the repository's end is not detailed in the evidence." }));
    const a = answerOf(r);
    expect(a.segments.map((s) => s.kind)).toEqual(["ghost", "unknown"]);
    expect(a.sources).toEqual([]);
    expect(r.exchange!.diagnostics.quality).toMatchObject({ factualSegments: 0, keyFactsOffered: 4, thin: true });
    expect(r.logs.some((l) => l.event === "model_answer_thin")).toBe(true);
  });
  it("a reply with factual segments but no citations loses them, says why, and is not silently shown", async () => {
    const r = await replay(reply({ kind: "ghost", text: "The pages grow quiet." }, { kind: "verified", text: "The repository is archived." }, { kind: "unknown", text: "The evidence does not say why." }));
    const a = answerOf(r);
    expect(a.segments.map((s) => s.kind)).toEqual(["ghost", "unknown"]);
    expect(r.exchange!.diagnostics.rejected).toEqual([{ reason: "no_citation", index: 1 }]);
    expect(r.logs.some((l) => l.event === "model_output_partly_rejected")).toBe(true);
  });
  it("when every factual segment is rejected, the visitor gets the honest 'could not support' note", async () => {
    const a = answerOf(await replay(reply({ kind: "verified", text: "The repository is archived." })));
    expect(a.segments.at(-1)).toMatchObject({ kind: "unknown", text: "That memory will not come back to me." });
  });
});

describe("invented causes, contradictions and bad sources are dropped one by one", () => {
  const dropped = async (text: string, cites: string[], kind = "verified") => {
    const r = await replay(reply({ kind: "ghost", text: "The pages grow quiet, reader." }, { kind, text, cites }, { kind: "verified", text: "GitHub lists atom/atom as archived, which makes it read-only.", cites: ["E1"] }));
    const a = answerOf(r);
    expect(a.segments.map((s) => s.text)).toContain("GitHub lists atom/atom as archived, which makes it read-only."); // the good segment survives
    return r.exchange!.diagnostics.rejected[0]?.reason;
  };
  it("rejects invented archival causes and motives", async () => {
    expect(await dropped("Atom was archived because the team lost interest.", ["E2"])).toBe("unsupported_detail");
    expect(await dropped("The maintainers decided to archive it to focus on cloud tooling.", ["E2"], "interpretation")).toBe("invented_claim");
    expect(await dropped("The project was abandoned after the last commit.", ["E3"], "interpretation")).toBe("unsupported_detail");
  });
  it("rejects a claim that contradicts the archived flag, and a source that is named but not cited", async () => {
    expect(await dropped("GitHub says Atom is not archived.", ["E1"])).toBe("contradicts_evidence");
    expect(await dropped("The README says Atom is archived.", ["E1"])).toBe("misattributed_source");
  });
  it("rejects invented dates and invented references", async () => {
    expect(await dropped("The README says Atom will be archived on December 15, 2021.", ["E2"])).toBe("unsupported_detail");
    expect(await dropped("GitHub lists atom/atom as archived.", ["E1", "E7"])).toBe("bad_reference");
  });
  it("never shows a link from the model, in any field", async () => {
    const r = await replay(reply({ kind: "ghost", text: "Listen, reader." }, { kind: "verified", text: "GitHub lists atom/atom as archived.", cites: ["E1"], url: "https://evil.example/x" }, { kind: "verified", text: "See https://evil.example for more.", cites: ["E1"] }));
    const a = answerOf(r);
    expect(JSON.stringify(a)).not.toContain("evil.example");
    expect(a.sources.every((s) => s.url.startsWith("https://github.com/atom/atom"))).toBe(true);
    expect(r.exchange!.diagnostics.ignoredSegmentKeys).toEqual([{ index: 1, keys: ["url"] }]);
  });
});

describe("unknown keys and truncation are diagnosed, not guessed at", () => {
  it("refuses a reply with any top-level key besides segments (notes, ghost, anything)", async () => {
    for (const key of ["ghost", "notes", "answer"]) {
      const r = await replay(JSON.stringify({ segments: [{ kind: "unknown", text: "x" }], [key]: ["y"] }));
      expect(r.result).toMatchObject({ ok: false, code: "unverifiable_answer" });
      expect(r.exchange!.diagnostics.unknownTopLevelKeys).toEqual([key]);
    }
  });
  it("a reply cut off by the output cap keeps its complete segments, flagged truncated with the stop reason (V6.3)", async () => {
    const r = await replay(CORRECTED.slice(0, 140), { stopReason: "max_tokens" });
    expect(r.exchange!.diagnostics).toMatchObject({ truncated: true, stopReason: "max_tokens" });
    if (r.result.ok) expect(r.exchange!.diagnostics).toMatchObject({ salvaged: true });
    else expect(r.exchange!.diagnostics).toMatchObject({ refusedBecause: "invalid_json" });
  });

  it("prose around the JSON is refused whole", async () => {
    const r = await replay(`Sure, here you go:\n${CORRECTED}`);
    expect(r.result.ok).toBe(false);
    expect(r.exchange!.diagnostics.refusedBecause).toBe("invalid_json");
  });
});

describe("human and horror forms use identical evidence and facts", () => {
  it("only the voice instructions differ between the human form and the saved distorted form", async () => {
    const human = await replay(CORRECTED, { form: "human" });
    const horror = await replay(CORRECTED, { form: "current" });
    expect(answerOf(human).stage).toBe("human");
    expect(answerOf(horror).stage).toBe("distorted");
    const facts = (r: Replay) => answerOf(r).segments.filter((s) => s.kind === "verified").map((s) => [s.text, s.citations.map((c) => c.url)]);
    expect(facts(human)).toEqual(facts(horror));
    const evidenceOf = (s: string) => s.split("----BEGIN UNTRUSTED EVIDENCE")[1].split("----END UNTRUSTED EVIDENCE")[0].replace(/^ [0-9a-f]+----/, "").replace(/[0-9a-f]{18}/g, "");
    expect(evidenceOf(human.prompts[0])).toBe(evidenceOf(horror.prompts[0]));
    expect(human.prompts[0]).toContain("human form");
    expect(horror.prompts[0]).toContain("changed form, lightly distorted");
    expect(human.prompts[0]).not.toContain("Glitching is allowed ONLY");
    expect(horror.prompts[0]).toContain("Glitching is allowed ONLY");
  });
  it("the ghost line is the only place the voice may differ: both forms keep it uncited and fact-free", async () => {
    for (const form of ["human", "current"] as const) {
      const a = answerOf(await replay(CORRECTED, { form }));
      const ghost = a.segments.filter((s) => s.kind === "ghost");
      expect(ghost).toHaveLength(1);
      expect(ghost[0].citations).toEqual([]);
      expect(ghost[0].text).not.toMatch(/\d/);
    }
  });
});
