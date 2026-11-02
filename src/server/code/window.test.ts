import { describe, expect, it } from "vitest";
import type { CodeOutline } from "@/domain/code";
import { codeWindow, PART_BYTES, readingPlan, SKELETON_PARTS, SKELETON_PARTS_FOR_LINES, WHOLE_MAX } from "./window";

const outline: CodeOutline = {
  method: "parsed", language: "javascript",
  symbols: [
    { name: "TextEditor", kind: "class", from: 73, to: 5855, depth: 0 },
    { name: "deserialize", kind: "method", from: 103, to: 135, depth: 1 },
    { name: "constructor", kind: "method", from: 137, to: 400, depth: 1 },
  ],
};

describe("what the ghost is shown for a question about code", () => {
  it("lines inside a function that fits: the whole function, and where it lives", () => {
    expect(codeWindow(5855, outline, 104, 108)).toEqual({ from: 103, to: 135, inside: "class TextEditor (lines 73–5855) › method deserialize (lines 103–135)", map: null, cut: false });
  });
  it("lines inside a function too long to show: the lines with a little around them", () => {
    expect(codeWindow(5855, outline, 200, 210)).toMatchObject({ from: 196, to: 214, cut: false });
  });
  it("a choice longer than can be shown is cut, and says so", () => {
    expect(codeWindow(5855, outline, 200, 400)).toMatchObject({ from: 200, to: 200 + WHOLE_MAX - 1, cut: true });
  });
  it("a whole-file question: the top of the file and its map", () => {
    const w = codeWindow(5855, outline);
    expect([w.from, w.to, w.inside]).toEqual([1, 14, null]);
    expect(w.map).toBe("class TextEditor (lines 73–5855);   method deserialize (lines 103–135);   method constructor (lines 137–400)");
  });
  it("an approximate outline is labelled approximate, so it is never taken as exact", () => {
    const approx = { ...outline, method: "approximate" as const };
    expect(codeWindow(5855, approx, 104).inside).toMatch(/\[approximate\]$/);
    expect(codeWindow(5855, approx).map).toMatch(/\[approximate\]$/);
  });
  it("no outline: just the lines", () => {
    expect(codeWindow(30, { method: "none", language: null, symbols: [] }, 10)).toEqual({ from: 6, to: 14, inside: null, map: null, cut: false });
  });
});

describe("reading the whole file for 'what does this do'", () => {
  const file = (n: number, width = 30) => Array.from({ length: n }, (_, i) => `line ${i + 1} `.padEnd(width, "x"));
  const small: CodeOutline = { method: "parsed", language: "javascript", symbols: [{ name: "a", kind: "function", from: 10, to: 20, depth: 0 }, { name: "b", kind: "function", from: 30, to: 40, depth: 0 }] };

  it("why/when questions read only the part asked about", () => {
    const parts = readingPlan(file(100), small, { line: 12 }, false, "a.js");
    expect(parts.map((p) => [p.role, p.from, p.to])).toEqual([["focus", 10, 20]]);
  });
  it("a small file is read whole: the focus first, then every other line, nearest first, nothing twice", () => {
    const parts = readingPlan(file(100), small, { line: 12 }, true, "a.js");
    expect(parts[0]).toMatchObject({ role: "focus", from: 10, to: 20 });
    const seen = parts.flatMap((p) => p.body.split("\n").map((l) => Number(l.split(":")[0])));
    expect(seen.sort((x, y) => x - y)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
    expect(parts.slice(1).every((p) => p.role === "context")).toBe(true);
    expect(parts[1].from < 10 || parts[1].from === 21).toBe(true); // a neighbour of the focus comes first
  });
  it("every part fits one evidence item", () => {
    for (const p of readingPlan(file(1200, 38), small, { line: 12 }, true, "a.js")) expect(p.body.length).toBeLessThanOrEqual(PART_BYTES);
  });
  it("a file too large to read whole gets its skeleton: declarations and the comments above them, and says so", () => {
    const lines = file(4000, 40);
    lines[28] = "// b: the second function"; // line 29, just above b (line 30)
    const big: CodeOutline = { ...small, symbols: [...small.symbols, { name: "c", kind: "function", from: 3000, to: 3010, depth: 0 }] };
    const parts = readingPlan(lines, big, { line: 12 }, true, "big.js");
    const skeleton = parts.filter((p) => p.role === "skeleton");
    expect(skeleton.length).toBeGreaterThan(0);
    expect(skeleton[0].head[0]).toMatch(/too large to read whole.*bodies are not shown/);
    const shown = skeleton.flatMap((p) => p.body.split("\n").map((l) => Number(l.split(":")[0])));
    expect(shown).toEqual(expect.arrayContaining([29, 30, 3000]));
    expect(shown).not.toContain(31); // bodies are not shown
    expect(shown).not.toContain(12); // the focus is not repeated
  });
  it("a large file's skeleton is only the parts nearest the focus", () => {
    const lines = file(9000, 40);
    const many: CodeOutline = { method: "parsed", language: "javascript", symbols: Array.from({ length: 800 }, (_, i) => ({ name: `f${i}`, kind: "function" as const, from: i * 11 + 1, to: i * 11 + 10, depth: 0 })) };
    const forLines = readingPlan(lines, many, { line: 4405 }, true, "big.js").filter((p) => p.role === "skeleton");
    expect(forLines.length).toBe(SKELETON_PARTS_FOR_LINES);
    expect(Math.abs(forLines[0].from - 4405)).toBeLessThan(1500);
    expect(readingPlan(lines, many, {}, true, "big.js").filter((p) => p.role === "skeleton").length).toBe(SKELETON_PARTS);
  });
});
