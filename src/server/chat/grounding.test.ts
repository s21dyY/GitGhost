import { describe, expect, it } from "vitest";
import { buildEvidence } from "@/domain/evidence";
import type { EvidenceRef } from "@/server/evidence/select";
import { parseModelJson, validateModelAnswer } from "./grounding";

const item = (n: number, kind: "readme" | "issue" | "commit" | "repo-metadata", excerpt: string, extra: Record<string, unknown> = {}) =>
  buildEvidence({
    repoId: 7, kind, sourceUrl: `https://github.com/acme/ghostly/${kind}/${n}`, label: `${kind} ${n}`, retrievedAt: "2026-10-31T12:00:00.000Z", excerpt, truncated: false, ...extra,
  });
const refs: EvidenceRef[] = [
  { ref: "E1", item: item(1, "repo-metadata", "acme/ghostly\narchived: true"), view: "" },
  { ref: "E2", item: item(2, "issue", "#42 Sunset plan [closed, 3 comments] We will archive."), view: "" },
  { ref: "E3", item: item(3, "commit", "Fix thing (committed 2023-01-15T10:00:00.000Z)", { revisionSha: "ab".repeat(20) }), view: "" },
];
const answer = (...segments: unknown[]) => JSON.stringify({ segments });
const ok = (...segments: unknown[]) => {
  const r = validateModelAnswer(answer(...segments), refs);
  if (!r) throw new Error("unparseable");
  return r;
};

describe("citation validation", () => {
  it("keeps supported claims and rebuilds links from the registry, not from the model", () => {
    const r = ok({ kind: "verified", text: "Issue #42 is titled Sunset plan.", cites: ["E2"], url: "https://evil.example/x", sourceUrl: "https://evil.example/y" });
    expect(r.segments).toHaveLength(1);
    expect(r.segments[0].citations).toEqual([
      { ref: "E2", id: refs[1].item.id, kind: "issue", label: "issue 2", url: "https://github.com/acme/ghostly/issue/2", excerpt: refs[1].item.excerpt.slice(0, 600) },
    ]);
    expect(JSON.stringify(r)).not.toContain("evil.example");
  });

  it("drops the WHOLE claim when any reference is not in the registry", () => {
    const r = ok({ kind: "verified", text: "The repository is archived.", cites: ["E1", "E99"] }, { kind: "verified", text: "Archived.", cites: ["E1"] });
    expect(r.segments.map((s) => s.text)).toEqual(["Archived."]);
    expect(r.rejected).toEqual([{ reason: "bad_reference", index: 0 }]);
  });

  it.each(["e1", "E01x", "https://github.com/acme/ghostly/issues/1", "../E1", ""])("rejects reference %j", (bad) => {
    expect(ok({ kind: "verified", text: "Something.", cites: [bad] }).segments).toHaveLength(0);
  });

  it("every number, date and version in a factual segment must appear in the cited evidence", () => {
    expect(ok({ kind: "verified", text: "That commit is dated 2023-01-15.", cites: ["E3"] }).segments).toHaveLength(1);
    expect(ok({ kind: "verified", text: "Issue #42 has 3 comments.", cites: ["E2"] }).segments).toHaveLength(1);
    for (const text of ["That commit is dated 2022-01-15.", "Issue #42 has 30 comments.", "It reached version 2.0.1.", "It has 12,000 stars."]) {
      expect(ok({ kind: "verified", text, cites: ["E2", "E3"] }).segments).toHaveLength(0);
    }
    expect(ok({ kind: "verified", text: "See E3 for the date 2023-01-15.", cites: ["E3"] }).segments).toHaveLength(1); // a reference word is not a number
  });
  it("a cause of abandonment is rejected unless the cited evidence itself uses that word", () => {
    expect(ok({ kind: "interpretation", text: "The team abandoned it.", cites: ["E2"] }).segments).toHaveLength(0);
    const withWord: EvidenceRef[] = [{ ref: "E1", item: item(9, "readme", "This project is abandoned. Use the fork."), view: "" }];
    const r = validateModelAnswer(answer({ kind: "verified", text: "The README says the project is abandoned.", cites: ["E1"] }), withWord);
    expect(r!.segments).toHaveLength(1);
  });
  it("requires a citation for verified and interpretation segments", () => {
    const r = ok({ kind: "verified", text: "It is archived." }, { kind: "interpretation", text: "Probably quiet." });
    expect(r.segments).toHaveLength(0);
    expect(r.rejected.map((x) => x.reason)).toEqual(["no_citation", "no_citation"]);
  });

  it("drops links of any shape in text", () => {
    for (const text of ["See https://evil.example now.", "See www.evil.example", "See [here](http://x.y)", "See evil.com/path"]) {
      expect(ok({ kind: "verified", text, cites: ["E1"] }).segments).toHaveLength(0);
    }
  });

  it("drops invented issue numbers and hashes, keeps ones the cited evidence contains", () => {
    expect(ok({ kind: "verified", text: "Issue #43 is about it.", cites: ["E2"] }).segments).toHaveLength(0);
    expect(ok({ kind: "verified", text: "Issue #42 says so.", cites: ["E2"] }).segments).toHaveLength(1);
    expect(ok({ kind: "verified", text: "Issue #42 says so.", cites: ["E1"] }).segments).toHaveLength(0); // wrong item cited
    expect(ok({ kind: "verified", text: "Commit abababa did it.", cites: ["E3"] }).segments).toHaveLength(1);
    expect(ok({ kind: "verified", text: "Commit 1234567 did it.", cites: ["E3"] }).segments).toHaveLength(0);
  });

  it("ghost segments carry no digits or links unless a cited item supports the number", () => {
    expect(ok({ kind: "ghost", text: "The margins remember." }).segments).toHaveLength(1);
    expect(ok({ kind: "ghost", text: "It happened in 2012." }).segments).toHaveLength(0);
    expect(ok({ kind: "ghost", text: "#42… the number is sewn beneath my skin.", cites: ["E2"] }).segments).toHaveLength(1);
    expect(ok({ kind: "ghost", text: "#42… the number is sewn beneath my skin." }).segments).toHaveLength(0);
    expect(ok({ kind: "ghost", text: "#43… beneath my skin.", cites: ["E2"] }).segments).toHaveLength(0);
  });

  it("unknown segments make no citations", () => {
    expect(ok({ kind: "unknown", text: "No reason is stated." }).segments).toHaveLength(1);
    expect(ok({ kind: "unknown", text: "No reason is stated.", cites: ["E1"] }).segments).toHaveLength(0);
  });

  it("unvalidated output is never shown: bad JSON or bad shape is rejected outright", () => {
    for (const raw of ["not json", "[]", "{}", JSON.stringify({ segments: [] }), JSON.stringify({ segments: [{ kind: "oracle", text: "x" }] }), JSON.stringify({ segments: [{ kind: "ghost", text: "" }] })]) {
      expect(validateModelAnswer(raw, refs)).toBeNull();
    }
  });

  it("tolerates a JSON code fence and strips control characters", () => {
    expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    const r = validateModelAnswer("```json\n" + answer({ kind: "verified", text: "Archived\u0000\u202e now.", cites: ["E1"] }) + "\n```", refs)!;
    expect(r.segments[0].text).toBe("Archived now.");
  });

  it("cannot cite evidence from another repository: only the supplied registry exists", () => {
    const foreign = buildEvidence({ repoId: 99, kind: "issue", sourceUrl: "https://github.com/other/repo/issues/1", retrievedAt: "2026-10-31T12:00:00.000Z", excerpt: "#1 foreign", truncated: false });
    expect(foreign.repoId).not.toBe(7);
    expect(validateModelAnswer(answer({ kind: "verified", text: "Foreign #1.", cites: ["E4"] }), refs)!.segments).toHaveLength(0);
  });
});
