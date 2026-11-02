import { describe, expect, it } from "vitest";
import { formLines, formVoice, type Stage } from "@/config/entities";
import { identityFromAssignment, type EntityAssignment } from "@/domain/entity";
import type { Intent } from "@/server/evidence/intent";
import { atomAssignment, atomLiveRefs } from "../fixtures/atom-status";
import { validateModelOutput } from "../grounding";
import { composeMockSegments } from "./grounded-mock";

/** The Bellwraith: warm as a person; once changed it can only repeat, as exact, cited echoes of the evidence. */
const bell = (stage: EntityAssignment["currentStage"] = "transformed") => ({ ...atomAssignment(stage), originId: "bellwraith" }) as EntityAssignment;
const compose = (assignment: EntityAssignment, stage: Stage, intent: Intent = "general") =>
  composeMockSegments({ refs: atomLiveRefs(), intent, gaps: [], assignment, voice: stage === "human" ? "human" : "horror", stage, variant: 0, repo: { archived: true, fullName: "atom/atom" } });

describe("the Bellwraith's voice", () => {
  it("is warm as a person and replaces the temperament and horror voice", () => {
    const id = identityFromAssignment(bell());
    expect(formVoice(id, "human")).toMatch(/warm/);
    expect(formVoice(id, "human")).toMatch(/replaces the temperament and horror voice/);
    expect(formLines(id, "human", "k").opener).toMatch(/friend/i);
  });
  it("changed, it is told to repeat exact quotes, never to paraphrase", () => {
    const id = identityFromAssignment(bell());
    for (const stage of ["distorted", "transformed"] as const) expect(formVoice(id, stage)).toMatch(/Never paraphrase/);
    expect(formLines(id, "transformed", "k").opener).toMatch(/^Dong/);
  });
});

describe("scripted replies: echoes are exact and cited", () => {
  for (const stage of ["distorted", "transformed"] as const) {
    for (const intent of ["general", "status", "recent", "history"] as const) {
      it(`${stage}, ${intent}: every echo passes the strict validator and nothing factual is dropped`, () => {
        const segments = compose(bell(stage), stage, intent);
        const out = validateModelOutput(JSON.stringify({ segments }), atomLiveRefs(), { allowProse: false });
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.rejected).toEqual([]);
        expect(out.diagnostics.droppedFactual ?? 0).toBe(0);
        expect(segments.some((s) => s.kind === "verified" && / … “/.test(s.text))).toBe(true);
      });
    }
  }
  it("repeats what it was for (the README's first sentence) even when not asked", () => {
    const echo = compose(bell(), "transformed", "recent").find((s) => s.kind === "verified" && s.cites?.includes("E2"));
    expect(echo?.text).toMatch(/^“Atom and all repositories under Atom/);
  });
  it("each echo is shorter, and only the words of the quote", () => {
    const echo = compose(bell(), "transformed", "recent").find((s) => s.kind === "verified" && / … “/.test(s.text))!;
    const parts = echo.text.split(" … ").map((p) => p.replace(/[“”]/g, ""));
    expect(parts.length).toBe(3);
    for (const p of parts.slice(1)) expect(parts[0]).toContain(p);
    expect(parts[2].length).toBeLessThan(parts[1].length);
  });
  it("keeps its caveats: the unknown and interpretation lines are untouched", () => {
    const kinds = (a: EntityAssignment, s: Stage) => compose(a, s, "status").filter((x) => x.kind === "unknown" || x.kind === "interpretation").map((x) => x.text);
    expect(kinds(bell(), "transformed")).toEqual(kinds(atomAssignment("transformed"), "transformed"));
  });
  it("as a person it speaks plainly, with no echoes", () => {
    expect(compose(bell(), "human").some((s) => / … “/.test(s.text))).toBe(false);
  });
  it("other ghosts never echo", () => {
    expect(compose(atomAssignment("transformed"), "transformed").some((s) => / … “/.test(s.text))).toBe(false);
  });
});
