import { describe, expect, it } from "vitest";
import { classifyTurn } from "@/server/chat/conversation";
import { classifyIntent } from "@/server/evidence/intent";
import { CHOICES, encounterBeats, type Via } from "./encounter";
import type { Game } from "./game-context";
import { mockGameData } from "./mock-data";

const game = (over: Partial<Game> = {}): Game => {
  const d = mockGameData();
  return { ...d, allEvidence: d.evidence, ...over };
};
const text = (g: Game, form: "human" | "distorted" | "horror", via: Via) => encounterBeats(g, form, via, "The era's own first line.").map((b) => b.map((s) => s.text).join(" "));

describe("the first encounter", () => {
  it("opens in four beats: it notices you, speaks in its own voice, says one true thing, and invites you to ask", () => {
    const beats = encounterBeats(game(), "human", "named", "The era's own first line.");
    expect(beats.map((b) => b[0].kind)).toEqual(["ghost", "ghost", "record", "ghost"]);
    expect(beats[1][0].text).toBe("The era's own first line.");
    expect(beats[3][0].text).toMatch(/ask me anything about what I was, or what I am made of/i);
  });
  it("reacts to how the visitor came", () => {
    const first = (via: Via) => text(game(), "human", via)[0];
    expect(first("graveyard")).toMatch(/followed my light/);
    expect(first("named")).toMatch(/said my name/);
    expect(new Set((["graveyard", "named", "direct"] as const).map(first)).size).toBe(3);
  });
  it("the record line is plain fact: the demo never claims GitHub, a live repository does, and emoji codes are dropped", () => {
    expect(text(game(), "human", "direct")[2]).toMatch(/^My record describes me as “An invented repository/);
    const live = game({ mode: "live", repo: { ...game().repo, description: ":atom: The hackable text editor" }, statusLine: "Archived. Retrieved 2026-11-02." });
    expect(text(live, "horror", "direct")[2]).toBe("GitHub describes me as “The hackable text editor”. Status: Archived.");
    expect(text(game({ repo: { ...game().repo, description: null } }), "human", "direct")[2]).toMatch(/^Status: /);
  });
  it("a changed Bellwraith has no words of its own, only the bell and the echo", () => {
    const [notice, , , want] = text(game({ sprite: "bellwraith" }), "horror", "graveyard");
    expect(notice).toMatch(/^Dong/);
    expect(want).toBe("Ask… ask… ask.");
    expect(text(game({ sprite: "bellwraith" }), "human", "graveyard")[0]).toMatch(/followed my light/);
  });
  it("its own lines state no repository facts (no digits, no links)", () => {
    for (const via of ["graveyard", "named", "direct"] as const) for (const form of ["human", "distorted", "horror"] as const) {
      const [notice, , , want] = text(game(), form, via);
      for (const line of [notice, want]) expect(line).not.toMatch(/\d|https?:/);
    }
  });
});

describe("the choice menu", () => {
  it("offers who, what happened, its code, and free speech", () => {
    expect(CHOICES.map((c) => c.id)).toEqual(["who", "what", "body", "other"]);
  });
  it("the two questions it sends are answered with cited facts, not fiction (keep a fact word when rewording them)", () => {
    for (const c of CHOICES.filter((x) => x.id === "who" || x.id === "what")) expect(classifyTurn(c.label)).toBe("factual");
    expect(classifyIntent(CHOICES.find((c) => c.id === "what")!.label)).toBe("status");
  });
});
