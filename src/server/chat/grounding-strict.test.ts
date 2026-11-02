import { describe, expect, it } from "vitest";
import { buildEvidence } from "@/domain/evidence";
import { selectEvidence, type EvidenceRef } from "@/server/evidence/select";
import { atomPool } from "./fixtures/atom-status";
import { EXAMPLE_MARKERS, validateModelAnswer, validateModelOutput } from "./grounding";
import { EXAMPLE_JSON } from "./prompt";

/**
 * The strict output contract (Milestone 2C.3). Evidence comes from the captured atom/atom fixture, as
 * selected for a status question: E1 repository record, E2 README, E3 newest commit.
 */
const refs = selectEvidence(atomPool(), { intent: "status", question: "Why did you die?", byteBudget: 3000 });
const reply = (...segments: unknown[]) => JSON.stringify({ segments });
const run = (raw: string, r: readonly EvidenceRef[] = refs) => validateModelOutput(raw, r);
const accepted = (raw: string, r: readonly EvidenceRef[] = refs) => {
  const out = run(raw, r);
  if (!out.ok) throw new Error(`refused: ${out.reason}`);
  return out;
};
const customRef = (kind: "repo-metadata" | "readme" | "commit" | "issue", excerpt: string, ref = "E1"): EvidenceRef => ({
  ref,
  view: excerpt,
  item: buildEvidence({ repoId: 7, kind, sourceUrl: `https://github.com/acme/ghostly/${kind}`, label: kind, retrievedAt: "2026-11-01T00:00:00.000Z", excerpt, truncated: false }),
});

it("the fixture selection is what the tests assume", () => {
  expect(refs.map((r) => `${r.ref}:${r.item.kind}`)).toEqual(["E1:repo-metadata", "E2:readme", "E3:commit"]);
});

describe("top level: exactly one object with only 'segments'", () => {
  it("refuses a reply with an extra top-level key, names the key, and keeps the diagnostics free of model text", () => {
    const raw = '{"segments":[{"kind":"unknown","text":"Secret text A."}],"ghost":[{"kind":"ghost","text":"Secret text B."}]}';
    const out = run(raw);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("unknown_top_level_keys");
    expect(out.diagnostics).toMatchObject({ json: "ok", topLevelKeys: ["segments", "ghost"], unknownTopLevelKeys: ["ghost"], segmentCount: 1, refusedBecause: "unknown_top_level_keys" });
    expect(JSON.stringify(out.diagnostics)).not.toMatch(/Secret text/);
    expect(validateModelAnswer(raw, refs)).toBeNull();
  });
  it("sanitizes and bounds key names that come from untrusted output", () => {
    const keys = Object.fromEntries([["x\nINJECTED log line", 1], ["a".repeat(200), 2], ...Array.from({ length: 12 }, (_, i) => [`k${i}`, i])]);
    const out = run(JSON.stringify({ segments: [{ kind: "unknown", text: "x" }], ...keys }));
    expect(out.ok).toBe(false);
    const names = out.diagnostics.unknownTopLevelKeys;
    expect(names.length).toBeLessThanOrEqual(8);
    expect(names[0]).toBe("x?INJECTED?log?line");
    expect(names.every((n) => n.length <= 40 && !/[\n\r]/.test(n))).toBe(true);
  });
  it.each([
    ["invalid JSON", "Sure! Here is my answer.", "invalid_json"],
    ["a JSON array", "[]", "not_an_object"],
    ["a JSON string", '"hello"', "not_an_object"],
    ["segments missing", '{"answer":[]}', "unknown_top_level_keys"],
    ["segments missing and nothing else", "{}", "segments_missing"],
    ["segments not an array", '{"segments":"nope"}', "segments_not_array"],
    ["segments empty", '{"segments":[]}', "segments_empty"],
    ["thirteen segments", JSON.stringify({ segments: Array.from({ length: 13 }, () => ({ kind: "unknown", text: "x" })) }), "too_many_segments"],
  ])("refuses %s", (_n, raw, reason) => {
    const out = run(raw);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe(reason);
  });
  it("tolerates a ```json fence and says so in the diagnostics", () => {
    const out = accepted("```json\n" + reply({ kind: "unknown", text: "No reason is stated." }) + "\n```");
    expect(out.diagnostics.fenced).toBe(true);
    expect(out.segments).toHaveLength(1);
  });
});

describe("segments are judged one by one", () => {
  it("one malformed segment no longer discards the others", () => {
    const out = accepted(reply({ kind: "oracle", text: "x" }, { kind: "unknown", text: "No reason is stated." }));
    expect(out.segments.map((s) => s.kind)).toEqual(["unknown"]);
    expect(out.rejected).toEqual([{ reason: "malformed_segment", index: 0 }]);
  });
  it("a reply in which every segment is malformed is refused outright", () => {
    const out = run(reply({ kind: "oracle", text: "x" }, { kind: "ghost", text: "" }, { nope: true }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("all_segments_malformed");
  });
  it("ignores unknown keys inside a segment (never used) and reports them", () => {
    const out = accepted(reply({ kind: "verified", text: "GitHub lists this repository as archived.", cites: ["E1"], url: "https://evil.example/x", source: "E9" }));
    expect(out.segments).toHaveLength(1);
    expect(out.segments[0].citations[0].url).toBe("https://github.com/atom/atom");
    expect(JSON.stringify(out.segments)).not.toContain("evil.example");
    expect(out.diagnostics.ignoredSegmentKeys).toEqual([{ index: 0, keys: ["url", "source"] }]);
  });
  it("long explanations are fine: five 380-character segments are all kept; a 701-character one is dropped alone", () => {
    const sentence = "GitHub lists this repository as archived. ";
    const long = sentence.repeat(9).slice(0, 380).trim();
    const five = Array.from({ length: 5 }, () => ({ kind: "verified", text: long, cites: ["E1"] }));
    expect(accepted(reply(...five)).segments).toHaveLength(5);
    const out = accepted(reply(...five.slice(0, 2), { kind: "verified", text: "x".repeat(701), cites: ["E1"] }, { kind: "unknown", text: "Nothing more is stated." }));
    expect(out.segments.map((s) => s.kind)).toEqual(["verified", "verified", "unknown"]);
    expect(out.rejected).toEqual([{ reason: "malformed_segment", index: 2 }]);
  });
  it("counts accepted segments by kind in the diagnostics", () => {
    const out = accepted(reply({ kind: "ghost", text: "The pages remember, reader." }, { kind: "verified", text: "GitHub lists this repository as archived.", cites: ["E1"] }, { kind: "unknown", text: "No reason is stated." }));
    expect(out.diagnostics.accepted).toEqual({ verified: 1, interpretation: 0, unknown: 1, ghost: 1 });
  });
});

describe("the format example in the prompt cannot be passed off as an answer", () => {
  it("every example segment is rejected as copied, even when its references exist", () => {
    const out = accepted(EXAMPLE_JSON);
    expect(out.segments).toHaveLength(0);
    expect(out.rejected.map((r) => r.reason)).toEqual(["copied_example", "copied_example", "copied_example"]);
  });
  it("the example is valid in shape, has exactly one top-level key, and is covered by the copy markers", () => {
    const parsed = JSON.parse(EXAMPLE_JSON) as { segments: { kind: string; text: string }[] };
    expect(Object.keys(parsed)).toEqual(["segments"]);
    for (const s of parsed.segments) expect(EXAMPLE_MARKERS.some((m) => s.text.toLowerCase().includes(m))).toBe(true);
  });
});

describe("ghost lines: character, readable, and no invented claims", () => {
  const ghost = (text: string) => accepted(reply({ kind: "ghost", text }, { kind: "unknown", text: "No reason is stated." }));
  it("accepts the in-voice line Nova Lite actually wrote", () => {
    expect(ghost("The end... is not... clear.").segments.map((s) => s.kind)).toEqual(["ghost", "unknown"]);
  });
  it.each([
    ["mostly symbols", "~~ ## ~~ ## ~~ ## ~~ ## ~~ ## ~~ ## ae", "unreadable"],
    ["a huge run of one character", `A${"a".repeat(14)}h the dusk`, "unreadable"],
    ["longer than 400 characters", `${"The long dusk settles over the pages and the pages remember. ".repeat(8)}`, "unreadable"],
    ["a year", "I was last awake in 2019.", "unsupported_detail"],
    ["a claim about the developers", "The developers moved on and never came back.", "invented_claim"],
    ["a stated cause", "They abandoned me to the dust.", "invented_claim"],
  ])("rejects a ghost line with %s", (_n, text, reason) => {
    const out = accepted(reply({ kind: "ghost", text }, { kind: "unknown", text: "No reason is stated." }));
    expect(out.rejected).toEqual([{ reason, index: 0 }]);
  });
  it.each([
    ["many ellipses and stutters", "I... see... the... pages... fade... away. S-s-so cold."],
    ["a repeated phrase", "Stay. Stay. Stay. Please stay."],
    ["a small spoken number", "I counted forty shelves once, and 3 a.m. never ended."],
    ["a long expressive line", `${"The dusk settles over the pages and they remember. ".repeat(6)}`],
  ])("V6.3: accepts a ghost line with %s", (_n, text) => {
    const out = accepted(reply({ kind: "ghost", text }));
    expect(out.segments.map((s) => s.kind)).toEqual(["ghost"]);
    expect(out.rejected).toEqual([]);
  });
});

describe("invented causes and motives", () => {
  const rejectedAs = (text: string, kind = "interpretation", cites = ["E2"]) => accepted(reply({ kind, text, cites }, { kind: "unknown", text: "No reason is stated." })).rejected[0]?.reason;
  it("rejects a stated cause of archival that no cited item contains", () => {
    expect(rejectedAs("The team gave up on the project and archived it.")).toBe("unsupported_detail");
    expect(rejectedAs("The repository was abandoned before it was archived.")).toBe("unsupported_detail");
    expect(rejectedAs("The maintainers decided to archive it to focus on cloud tooling.")).toBe("invented_claim");
    expect(rejectedAs("They lost interest after the last push.")).toBe("unsupported_detail");
  });
  it("accepts the motive wording only when the cited item uses it itself", () => {
    const own = customRef("readme", "We decided to archive this project. Learn more elsewhere.", "E2");
    const out = accepted(reply({ kind: "verified", text: "The README says the maintainers decided to archive it.", cites: ["E2"] }), [own]);
    expect(out.segments).toHaveLength(1);
  });
  it("does not accept inactivity presented as the cause: the date is a fact, 'neglect' is a claim", () => {
    expect(rejectedAs("The last push was on 2023-01-03.", "verified", ["E1"])).toBeUndefined();
    expect(rejectedAs("The project ended because it was neglected after its last push.", "interpretation", ["E1"])).toBe("unsupported_detail");
  });
});

describe("contradictory or misattributed sources", () => {
  const decision = (text: string, cites: string[], r: readonly EvidenceRef[] = refs) => accepted(reply({ kind: "verified", text, cites }, { kind: "unknown", text: "No reason is stated." }), r).rejected[0]?.reason;
  it("rejects a status claim that contradicts the archived flag it cites", () => {
    expect(decision("GitHub says this repository is not archived.", ["E1"])).toBe("contradicts_evidence");
    expect(decision("The repository is still actively maintained.", ["E1"])).toBe("contradicts_evidence");
    expect(decision("GitHub lists this repository as archived.", ["E1"])).toBeUndefined();
  });
  it("rejects 'archived' for a repository whose record says it is not, and accepts the negative", () => {
    const live = customRef("repo-metadata", "acme/ghostly\narchived: false\nlast push: 2026-10-01T00:00:00.000Z");
    expect(decision("GitHub lists this repository as archived.", ["E1"], [live])).toBe("contradicts_evidence");
    expect(decision("GitHub does not list this repository as archived.", ["E1"], [live])).toBeUndefined();
  });
  it("rejects naming a source the segment does not cite", () => {
    expect(decision("The README says the repository is archived.", ["E1"])).toBe("misattributed_source");
    expect(decision("The newest commit reads a merge of a pull request.", ["E2"])).toBe("misattributed_source");
    expect(decision("The README says Atom will be archived on December 15, 2022.", ["E1", "E2"])).toBeUndefined();
    expect(decision("The newest commit I retrieved was dated 2022-11-22.", ["E3"])).toBeUndefined();
  });
  it("still rejects a wrong date or number even with a correct source", () => {
    expect(decision("The README says Atom will be archived on December 15, 2021.", ["E2"])).toBe("unsupported_detail");
    expect(decision("The newest commit was dated 2021-11-22.", ["E3"])).toBe("unsupported_detail");
  });
  it("rejects invented references", () => {
    expect(decision("GitHub lists this repository as archived.", ["E1", "E99"])).toBe("bad_reference");
  });
});

describe("V6.3: fiction and facts are validated separately, claim by claim", () => {
  const texts = (raw: string, opts?: Parameters<typeof validateModelOutput>[2]) => {
    const out = validateModelOutput(raw, refs, opts);
    if (!out.ok) throw new Error(`refused: ${out.reason}`);
    return out;
  };
  it("1. pure fiction with no citations is accepted", () => {
    const out = texts(reply({ kind: "ghost", text: "Lonely? The dark keeps me company... it always has." }));
    expect(out.segments).toHaveLength(1);
    expect(out.diagnostics.droppedFactual ?? 0).toBe(0);
  });
  it("2. a cited factual answer is accepted", () => {
    const out = texts(reply({ kind: "verified", text: "GitHub lists this repository as archived.", cites: ["E1"] }));
    expect(out.segments.map((s) => s.kind)).toEqual(["verified"]);
    expect(out.segments[0].citations.map((c) => c.ref)).toEqual(["E1"]);
  });
  it("3. a mixed reply with supported facts is accepted whole", () => {
    const out = texts(reply({ kind: "ghost", text: "I felt the lamps go out one by one." }, { kind: "verified", text: "GitHub lists this repository as archived.", cites: ["E1"] }));
    expect(out.segments.map((s) => s.kind)).toEqual(["ghost", "verified"]);
    expect(out.rejected).toEqual([]);
  });
  it("4. a mixed reply with one unsupported claim keeps the safe parts", () => {
    const out = texts(reply(
      { kind: "ghost", text: "The dark was kind to me. It shipped version 9.9.9 on 2015-05-05." },
      { kind: "verified", text: "GitHub lists this repository as archived. It had 4821 stars.", cites: ["E1"] },
    ));
    expect(out.segments.map((s) => s.text)).toEqual(["The dark was kind to me.", "GitHub lists this repository as archived."]);
    expect(out.rejected.map((r) => r.partial)).toEqual([true, true]);
    expect(out.diagnostics.droppedFactual).toBe(1);
  });
  it("5. invented maintainers, issues, commits and dates are removed from fiction", () => {
    for (const text of [
      "The maintainers left me here.",
      "Issue #42 broke my heart.",
      "Commit abc1234 was my happiest hour.",
      "My first commit was a lullaby.",
      "I was archived on a Tuesday.",
      "The README says I am loved.",
      "It all ended in March 2021.",
    ]) {
      const out = texts(reply({ kind: "ghost", text: `${text} Hush.` }));
      expect(out.segments.map((s) => s.text), text).toEqual(["Hush."]);
    }
  });
  it("6. a bare invented factual segment is never promoted to a supported one", () => {
    const out = texts(reply({ kind: "ghost", text: "Hush." }, { kind: "verified", text: "The founder quit.", cites: ["E77"] }));
    expect(out.segments.map((s) => s.kind)).toEqual(["ghost"]);
    expect(out.rejected).toEqual([{ reason: "bad_reference", index: 1 }]);
  });
  it("7. a historical era blocks hindsight in fiction but keeps feeling", () => {
    const raw = reply({ kind: "ghost", text: "I feel the young pages warm. I would later become a ruin." });
    expect(texts(raw, { era: true }).segments.map((s) => s.text)).toEqual(["I feel the young pages warm."]);
    expect(texts(raw).segments[0].text).toContain("later");
  });
  it("8. a truncated reply keeps its complete segments", () => {
    const full = reply({ kind: "ghost", text: "First line." }, { kind: "ghost", text: "Second line that gets cut" });
    const out = texts(full.slice(0, full.indexOf("Second") + 8));
    expect(out.segments.map((s) => s.text)).toEqual(["First line."]);
    expect(out.diagnostics).toMatchObject({ salvaged: true, json: "invalid" });
  });
  it("9. plain prose is accepted as ghost text only when the caller allows it, and never with links", () => {
    expect(validateModelOutput("The dark is my oldest friend.", refs).ok).toBe(false);
    const out = texts("The dark is my oldest friend.", { allowProse: true });
    expect(out.segments.map((s) => s.kind)).toEqual(["ghost"]);
    expect(validateModelOutput("See https://evil.example now.", refs, { allowProse: true }).ok).toBe(false);
    expect(validateModelOutput('Here: {"segments":[]}', refs, { allowProse: true }).ok).toBe(false);
  });
});
