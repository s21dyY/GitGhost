import { describe, expect, it, vi } from "vitest";
import { deriveStatus, vitalityOf } from "@/domain/status";
import { liveAsk } from "./ask";
import type { EraData } from "./data";
import { presentationFor } from "./presentation";

const NOW = new Date("2026-11-02T00:00:00Z");
const ids = Array.from({ length: 12 }, (_, i) => `sha${i}`);

describe("alive or left behind", () => {
  it("a repository committed to this year is alive; archived or quiet for over a year is left behind", () => {
    expect(vitalityOf(deriveStatus(false, "2026-03-01T00:00:00Z", NOW))).toBe("alive");
    expect(vitalityOf(deriveStatus(false, "2024-06-01T00:00:00Z", NOW))).toBe("dead");
    expect(vitalityOf(deriveStatus(true, "2026-10-01T00:00:00Z", NOW))).toBe("dead"); // archived, even if recently touched
  });
  it("without evidence it is never shown dead", () => {
    expect(vitalityOf(deriveStatus(false, null, NOW))).toBe("alive");
  });
});

describe("how each era looks", () => {
  it("a living repository is a person in every era, in warm light", () => {
    const look = presentationFor(ids, "transformed", undefined, "alive");
    expect(new Set(look.map((e) => e.stage))).toEqual(new Set(["human"]));
    expect(new Set(look.map((e) => e.tone))).toEqual(new Set(["warm"]));
  });
  it("a repository left behind still decays through its eras into its saved form", () => {
    const look = presentationFor(ids, "transformed", undefined, "dead");
    expect(look[0].stage).toBe("human");
    expect(look.at(-1)!.stage).toBe("transformed");
    expect(look.some((e) => e.stage === "distorted")).toBe(true);
  });
});

describe("the voice", () => {
  const era = (stage: EraData["stage"], i: number): EraData => ({ id: `e${i}`, sha: `abc${i}`, fullSha: `${i}`.padStart(40, "a"), date: "2026-01-01", message: "m", url: null, stage, emotion: "neutral", tone: "warm", ghostLine: "x", evidenceId: `c${i}` });
  const sent = async (eras: EraData[], eraIdx: number) => {
    const f = vi.fn(async () => new Response(JSON.stringify({ ok: false, code: "x", message: "x" })));
    await liveAsk({ repo: { fullName: "a/b", owner: "a", name: "b", url: null, description: null }, eras }, f as unknown as typeof fetch)({ question: "Who were you?", eraIdx, history: [] });
    return JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
  };
  it("a living ghost answers in its human voice in the present", async () => {
    expect((await sent([era("human", 0), era("human", 1)], 1)).form).toBe("human");
  });
  it("a ghost left behind answers in its current (changed) voice in the present", async () => {
    expect((await sent([era("human", 0), era("transformed", 1)], 1)).form).toBe("current");
  });
});

describe("the menu", () => {
  it("a living ghost is asked about its present; both questions still get cited facts", async () => {
    const { choicesFor } = await import("./encounter");
    const { classifyIntent } = await import("@/server/evidence/intent");
    const { classifyTurn } = await import("@/server/chat/conversation");
    const alive = choicesFor("alive");
    expect(alive.map((c) => c.id)).toEqual(["who", "what", "body", "other"]);
    expect(alive[0].label).toMatch(/^Who are you\?/);
    expect(alive.map((c) => c.label).join(" ")).not.toMatch(/were you|stop/i);
    for (const c of alive.slice(0, 2)) expect(classifyTurn(c.label)).toBe("factual");
    expect(classifyIntent(alive[1].label)).toBe("recent");
    expect(choicesFor("dead")[0].label).toMatch(/^Who were you\?/);
  });
});
