import { describe, expect, it } from "vitest";
import { buildEvidence } from "@/domain/evidence";
import type { EvidenceRef } from "@/server/evidence/select";
import { atomAssignment } from "./fixtures/atom-status";
import { validateModelOutput } from "./grounding";
import { asksWhatCodeDoes, buildPrompt } from "./prompt";
import { composeMockSegments } from "./providers/grounded-mock";

/** A question about what code does gets the explain shape; questions about its history keep the history shape. */
describe("explaining code", () => {
  it("tells 'what does it do' apart from why, when and who", () => {
    for (const q of ["In the source code, what does src/a.js:12-20 do?", "In the source code, what is src/a.js for?", "What does this function handle?"]) expect(asksWhatCodeDoes(q)).toBe(true);
    for (const q of ["Why was src/a.js:12 written this way? What do its commits say?", "When did src/a.js last change, and in which commit?", "Who wrote src/a.js?"]) expect(asksWhatCodeDoes(q)).toBe(false);
  });

  const excerpt = "src/a.js (lines 2–4 of 40)\ninside: class Ghost (lines 1–40) › method haunt (lines 2–4)\n2:   haunt(room) {\n3:     return room.lights.off();\n4:   }";
  const code: EvidenceRef = {
    ref: "E1",
    view: excerpt, // what the evidence selector shows the model
    item: buildEvidence({
      repoId: 7, kind: "file", sourceUrl: "https://github.com/acme/ghostly/blob/main/src/a.js#L2-L4", label: "src/a.js, lines 2–4", retrievedAt: "2026-11-02T00:00:00.000Z", truncated: true,
      excerpt,
    }),
  };
  const prompt = (question: string) => buildPrompt({ assignment: atomAssignment("distorted"), stage: "distorted", refs: [code], gaps: [], history: [], question, repoName: "acme/ghostly", intent: "file", turn: "factual", file: { path: "src/a.js", line: 2, endLine: 4 } }).system;

  it("the model is asked to explain only what the shown code visibly does", () => {
    const s = prompt("In the source code, what does src/a.js:2-4 do?");
    expect(s).toMatch(/what a part of your code does/);
    expect(s).toMatch(/say what they call, not what that code does/);
    expect(s).toMatch(/inside: class Ghost/); // the parser's fact reaches the model
    expect(prompt("Why was src/a.js:2-4 written this way? What do its commits say?")).not.toMatch(/what a part of your code does/);
  });

  it("without a model, the scripted answer states only what the parser knows and quotes the code, and passes validation", () => {
    const segments = composeMockSegments({
      refs: [code], intent: "file", gaps: [], assignment: atomAssignment("distorted"), voice: "horror", stage: "distorted", variant: 0,
      repo: { archived: false, fullName: "acme/ghostly" }, file: { path: "src/a.js", line: 2, endLine: 4 }, question: "In the source code, what does src/a.js:2-4 do?",
    });
    const facts = segments.filter((s) => s.kind === "verified").map((s) => s.text);
    expect(facts).toEqual(["Line 2 of src/a.js is inside class Ghost (lines 1–40) › method haunt (lines 2–4).", "Line 2 reads “haunt(room) {”."]);
    const out = validateModelOutput(JSON.stringify({ segments }), [code], { allowProse: false });
    expect(out.ok && out.rejected).toEqual([]);
  });
});
