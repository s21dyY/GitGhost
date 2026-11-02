import type { CodeOutline } from "@/domain/code";
import { enclosing } from "@/domain/outline";

/** The longest function shown whole; longer ones are shown around the chosen lines. */
export const WHOLE_MAX = 60;
const MAP_MAX = 40;

export type CodeWindow = {
  from: number;
  to: number;
  /** Where the chosen lines live, from the outline: "class TextEditor (lines 73–5855) › method deserialize (lines 103–135)". */
  inside: string | null;
  /** For a whole-file question: the file's declarations, so the ghost can say what the file holds. */
  map: string | null;
  /** The chosen lines were more than could be shown. */
  cut: boolean;
};

/**
 * Which lines of a file the ghost is shown for a question, and what the outline says about them. Pure.
 *  - Lines inside a function that fits (≤ WHOLE_MAX lines): the whole function, so it can explain it rather than a fragment.
 *  - Otherwise the chosen lines with four lines around them (a long choice is cut, and `cut` says so).
 *  - No lines chosen: the top of the file, plus its map.
 */
export function codeWindow(total: number, outline: CodeOutline, line?: number, endLine?: number): CodeWindow {
  const approx = outline.method === "approximate";
  if (!line) {
    const shown = outline.symbols.filter((s) => s.depth <= 1).slice(0, MAP_MAX);
    const map = shown.length
      ? `${shown.map((s) => `${s.depth ? "  " : ""}${s.kind} ${s.name} (lines ${s.from}–${s.to})`).join("; ")}${outline.symbols.length > shown.length ? "; …" : ""}${approx ? " [approximate]" : ""}`
      : null;
    return { from: 1, to: Math.min(total, 14), inside: null, map, cut: false };
  }
  const end = Math.max(line, endLine ?? line);
  const chain = enclosing(outline.symbols, line, end);
  const inside = chain.length ? `${chain.map((s) => `${s.kind} ${s.name} (lines ${s.from}–${s.to})`).join(" › ")}${approx ? " [approximate]" : ""}` : null;
  const own = chain.at(-1);
  if (own && own.to - own.from + 1 <= WHOLE_MAX) return { from: own.from, to: Math.min(total, own.to), inside, map: null, cut: false };
  if (end - line + 1 <= WHOLE_MAX) return { from: Math.max(1, line - 4), to: Math.min(total, end + 4), inside, map: null, cut: false };
  return { from: line, to: Math.min(total, line + WHOLE_MAX - 1), inside, map: null, cut: true };
}

/** Files up to this size are read whole (beyond the focus) when the question is what the code does. */
export const WHOLE_FILE_BYTES = 48_000;
/**
 * A large file's skeleton is kept to the parts nearest the focus: with much more, the model's answer drifts away from
 * the code asked about (seen with Nova Lite on atom's 5,855-line text-editor.js). A whole-file question gets a few
 * parts for an overview; a question about chosen lines gets one, since the lines themselves are what matter.
 */
export const SKELETON_PARTS = 4;
export const SKELETON_PARTS_FOR_LINES = 1;
/** One evidence item holds at most this much code (the evidence schema caps an excerpt at 4,000 characters). */
export const PART_BYTES = 3_400;
const LINE_CHARS = 160;

export type ReadingPart = { from: number; to: number; role: "focus" | "context" | "skeleton"; head: string[]; body: string };

const lineText = (lines: readonly string[], n: number) => `${n}: ${lines[n - 1].replace(/\t/g, "  ").slice(0, LINE_CHARS)}`;
/** Code lines as numbered text, cut into parts of at most PART_BYTES, never mid-line. */
function cut(lines: readonly string[], numbers: readonly number[]): { from: number; to: number; body: string }[] {
  const parts: { from: number; to: number; body: string }[] = [];
  let buf: string[] = [], from = 0, to = 0, size = 0;
  for (const n of numbers) {
    const t = lineText(lines, n);
    if (buf.length && size + t.length + 1 > PART_BYTES) {
      parts.push({ from, to, body: buf.join("\n") });
      buf = [];
      size = 0;
    }
    if (!buf.length) from = n;
    buf.push(t);
    size += t.length + 1;
    to = n;
  }
  if (buf.length) parts.push({ from, to, body: buf.join("\n") });
  return parts;
}
const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);
/** A comment line in most languages. */
const COMMENT = /^\s*(\/\/|\/\*|\*|#(?![!{[])|--|;|"""|'''|<!--)/;

/**
 * Everything the ghost is shown for one question about a file, in the order it should be kept if the budget runs
 * short. Pure.
 *  1. focus     the code asked about (see codeWindow), with what the outline knows about it.
 *  2. context   only for "what does this do" questions, and only for files up to WHOLE_FILE_BYTES: the rest of the
 *               file, in parts, nearest to the focus first, so the ghost can say how the part fits into the whole.
 *  3. skeleton  the same questions about a larger file: every declaration's first line and the comment written
 *               above it. Real text from the file, so it is citable; bodies are not shown, and it says so.
 */
export function readingPlan(lines: readonly string[], outline: CodeOutline, ref: { line?: number; endLine?: number }, whole: boolean, path: string): ReadingPart[] {
  const total = lines.length;
  const w = codeWindow(total, outline, ref.line, ref.endLine);
  const focusHead = [...(w.inside ? [`inside: ${w.inside}`] : []), ...(w.map ? [`map of the file: ${w.map}`.slice(0, 1400)] : []), ...(w.cut ? ["(the chosen lines run past what is shown)"] : [])];
  const parts: ReadingPart[] = cut(lines, range(w.from, w.to)).map((p, i) => ({ ...p, role: "focus", head: i === 0 ? focusHead : ["(the part asked about, continued)"] }));
  if (!whole) return parts;
  const mid = (w.from + w.to) / 2;
  const near = (a: { from: number; to: number }, b: { from: number; to: number }) => Math.abs((a.from + a.to) / 2 - mid) - Math.abs((b.from + b.to) / 2 - mid);
  const bytes = lines.reduce((n, l) => n + l.length + 1, 0);
  if (bytes <= WHOLE_FILE_BYTES) {
    const rest = [...cut(lines, range(1, w.from - 1)), ...cut(lines, range(w.to + 1, total))].sort(near);
    return [...parts, ...rest.map((p): ReadingPart => ({ ...p, role: "context", head: ["(the rest of this file, for context)"] }))];
  }
  // too large to read whole: its skeleton, from the outline
  const keep = new Set<number>();
  for (const s of outline.symbols.filter((x) => x.depth <= 2)) {
    keep.add(s.from);
    for (let n = s.from - 1, k = 0; n >= 1 && k < 3 && COMMENT.test(lines[n - 1]); n--, k++) keep.add(n);
  }
  const skeleton = cut(lines, [...keep].filter((n) => n < w.from || n > w.to).sort((a, b) => a - b)).sort(near).slice(0, ref.line ? SKELETON_PARTS_FOR_LINES : SKELETON_PARTS);
  const note = `(skeleton of ${path} near the part asked about, too large to read whole: each declaration's first line and the comment above it; bodies are not shown)`;
  return [...parts, ...skeleton.map((p): ReadingPart => ({ ...p, role: "skeleton", head: [note] }))];
}
