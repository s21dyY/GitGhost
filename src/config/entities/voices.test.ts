import { describe, expect, it } from "vitest";
import { buildEntity, firstWords, formLines, formVoice, resolveEntity, TEMPERAMENTS, type EntityIdentity, type RepoSignals } from ".";

const repo: RepoSignals = { repoId: 1663468, repoName: "mozilla/pdf.js" };
/** Many saved ghosts, so every temperament and horror profile is exercised. */
const ghosts: EntityIdentity[] = Array.from({ length: 80 }, (_, i) => buildEntity(repo, `voice-${i}`));
const keys = ["a", "b", "c", "d", "e", "f"];
/** Some word (three letters or more) is said again in the same line. */
const repeats = (line: string) => {
  const w: string[] = line.toLowerCase().match(/[a-z]{3,}/g) ?? [];
  return w.some((x, i) => w.indexOf(x) !== i);
};

describe("each form speaks differently", () => {
  it("the human form is a person: clean sentences, no ellipses, no stutters", () => {
    for (const g of ghosts) for (const k of keys) {
      const l = formLines(g, "human", k);
      for (const line of [l.opener, l.bridge, l.closer]) {
        expect(line).not.toMatch(/…|\.\.\./);
        expect(line).not.toMatch(/\b([A-Za-z])-\1/);
      }
    }
  });

  it("the human form has a personality: different temperaments greet differently", () => {
    const byTemper = new Map<string, Set<string>>();
    for (const g of ghosts) for (const k of keys) {
      const t = resolveEntity(g).temperament.id;
      if (!byTemper.has(t)) byTemper.set(t, new Set());
      byTemper.get(t)!.add(formLines(g, "human", k).bridge);
    }
    expect(byTemper.size).toBeGreaterThanOrEqual(3);
    const bridges = new Set([...byTemper.values()].flatMap((s) => [...s]));
    expect(bridges.size).toBe(byTemper.size); // one turn of phrase per temperament, all different
  });

  it("the eldritch form is not a person: never \"I\", no contractions, and it repeats itself", () => {
    for (const g of ghosts) for (const k of keys) {
      const l = formLines(g, "transformed", k);
      for (const line of [l.opener, l.bridge, l.closer]) {
        expect(line).not.toMatch(/\bI\b/);
        expect(line).not.toMatch(/\b\w+'(s|t|re|ll|m|ve|d)\b/i);
      }
      expect(l.bridge).toMatch(/^(\w+)\. \1\. \1\./); // a word, three times
      expect(repeats(l.opener)).toBe(true); // it loops
    }
  });

  it("the distorted form is the person slipping: it repeats once and breaks off", () => {
    for (const g of ghosts) for (const k of keys) {
      const l = formLines(g, "distorted", k);
      expect(l.bridge).toMatch(/…/);
      expect(repeats(l.opener)).toBe(true);
    }
  });

  it("the model is told three different things for the three forms", () => {
    const g = ghosts[0];
    const [h, d, t] = (["human", "distorted", "transformed"] as const).map((s) => formVoice(g, s));
    expect(new Set([h, d, t]).size).toBe(3);
    expect(h).toContain("a living person");
    expect(h).toContain(resolveEntity(g).temperament.id === "formal" ? "Courteous" : "");
    expect(d).toContain("coming apart");
    expect(t).toContain("not a person");
    expect(t).toContain('Never "I"');
  });

  it("every temperament has a human voice described for the model", () => {
    for (const temper of TEMPERAMENTS) {
      const g = ghosts.find((x) => resolveEntity(x).temperament.id === temper.id);
      if (g) expect(formVoice(g, "human").length).toBeGreaterThan(80);
    }
  });

  it("first words are deterministic per era and follow the era's form", () => {
    const g = ghosts[3];
    expect(firstWords(g, "human", "abc123")).toBe(firstWords(g, "human", "abc123"));
    expect(firstWords(g, "transformed", "abc123")).not.toMatch(/\bI\b/);
    expect(firstWords(g, "human", "abc123")).not.toBe(firstWords(g, "transformed", "abc123"));
  });
});
