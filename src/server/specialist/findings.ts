import { z } from "zod";

/**
 * The Specialist's findings, and the checks they must pass before a player sees any of them. The model is told the
 * shape; nothing it returns is trusted. Every observation must point at lines (or, for the codebase's intro, files and
 * folders) it was actually shown, any code it quotes must be there word for word, every number must appear in the
 * evidence, and it may not state links or anyone's intent. Links are built here, never taken from the model.
 *
 * The SHAPE is read leniently: a smaller model often writes a summary a little too long, line numbers as strings, or
 * one item too many. Those are trimmed and coerced rather than thrown away ("garbled"); the CONTENT checks stay strict.
 */
export type Observation = { text: string; path: string; from?: number; to?: number; url: string };
export type Findings = { summary: string; observations: Observation[]; uncertainties: string[]; followUps: string[] };
export type FindingsResult =
  | { ok: true; findings: Findings; dropped: number }
  | { ok: false; reason: "unreadable" | "no_supported_observation" | "unsupported_summary"; dropped: number };

/** What the Specialist was shown for one file: its lines by number (from the evidence parts), the declarations on the
 *  file's map (exact line ranges, for a file too large to show whole), and all evidence text. */
export type Shown = { path: string; lines: ReadonlyMap<number, string>; declarations?: readonly { from: number; to: number }[]; evidence: string; fileUrl: (from: number, to: number) => string };
/** What it was shown for the codebase's intro: the files and folders on the map, and all evidence text. */
export type ShownMap = { files: ReadonlySet<string>; dirs: ReadonlySet<string>; evidence: string; pathUrl: (path: string, dir: boolean) => string };

const MAX_SPAN = 120;
const LINK = /https?:\/\/|\bwww\.\S/i;
/** Someone's intent or feelings, which the code itself cannot show. */
const INTENT = /\b(developers?|maintainers?|authors?|contributors?|the team|they|he|she)\b[^.!?]{0,50}\b(wanted|decided|chose|intended|meant to|tried to|hoped|felt|preferred|planned)\b/i;
const NUMBER = /\b\d+(?:\.\d+)?\b/g;

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
/** Shortened at the last sentence end that fits, or at a word with an ellipsis: never mid-word. */
function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return end > max * 0.5 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : max - 1)}…`;
}
const strings = (v: unknown[], max: number, chars: number) => v.filter((x): x is string => typeof x === "string").map(squash).filter(Boolean).map((t) => clip(t, chars)).slice(0, max);
const lineNo = z.preprocess((v) => (v === null || v === undefined || v === "" ? undefined : Number(v)), z.number().int().min(1).optional());

const RawObservation = z.preprocess(
  (v) => (v && typeof v === "object" && !("text" in v) ? { ...v, text: (v as Record<string, unknown>).description ?? (v as Record<string, unknown>).explanation } : v),
  z.object({ text: z.string(), path: z.string().optional(), from: lineNo, to: lineNo }),
);
const Raw = z.object({
  summary: z.string(),
  observations: z.array(z.unknown()).catch([]),
  uncertainties: z.array(z.unknown()).catch([]),
  followUps: z.array(z.unknown()).catch([]),
});

/** The model's JSON, tolerating a code fence or prose around one object. Null if there is none. */
function parse(raw: string): unknown {
  const t = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(t.slice(a, b + 1));
  } catch {
    return null;
  }
}

/** The reply's shape, leniently; null only when there is no summary at all. Also says why, for the server log. */
export function readShape(raw: string): { summary: string; observations: unknown[]; uncertainties: string[]; followUps: string[] } | { error: string } {
  const json = parse(raw);
  if (json === null) return { error: "no JSON object" };
  const r = Raw.safeParse(json);
  if (!r.success) return { error: `bad shape: ${r.error.issues.map((i) => i.path.join(".") || i.code).join(", ")}` };
  const summary = clip(squash(r.data.summary), 600);
  if (!summary) return { error: "empty summary" };
  return { summary, observations: r.data.observations.slice(0, 8), uncertainties: strings(r.data.uncertainties, 4, 300), followUps: strings(r.data.followUps, 3, 200) };
}

/** A sentence is supported if it has no link, states no intent, and every number in it appears in the evidence as a
 *  whole number ("3" is not supported by "103"). */
function plainAndSupported(text: string, numbers: ReadonlySet<string>): boolean {
  if (LINK.test(text) || INTENT.test(text)) return false;
  for (const m of text.matchAll(NUMBER)) if (!numbers.has(m[0])) return false;
  return true;
}
const quotesIn = (text: string, source: string) => [...text.matchAll(/`([^`]+)`/g)].map((m) => squash(m[1])).every((q) => q.length > 0 && source.includes(q));
const unquoted = (text: string) => text.replace(/`[^`]+`/g, "");
const numbersOf = (evidence: string) => new Set([...evidence.matchAll(NUMBER)].map((m) => m[0]));

function finish(shape: Exclude<ReturnType<typeof readShape>, { error: string }>, observations: Observation[], dropped: number, numbers: ReadonlySet<string>): FindingsResult {
  if (!observations.length) return { ok: false, reason: "no_supported_observation", dropped };
  if (!plainAndSupported(unquoted(shape.summary), numbers)) return { ok: false, reason: "unsupported_summary", dropped };
  const keep = (list: string[]) => list.filter((t) => !LINK.test(t) && !INTENT.test(t));
  return { ok: true, findings: { summary: shape.summary, observations, uncertainties: keep(shape.uncertainties), followUps: keep(shape.followUps) }, dropped };
}

/** One file (or some of its lines): every observation names lines it was shown. */
export function validateFindings(raw: string, shown: Shown): FindingsResult {
  const shape = readShape(raw);
  if ("error" in shape) return { ok: false, reason: "unreadable", dropped: 0 };
  const shownText = squash(`${[...shown.lines.values()].join("\n")}\n${shown.evidence}`);
  const numbers = numbersOf(shown.evidence);
  let dropped = 0;
  const observations: Observation[] = [];
  for (const item of shape.observations) {
    const o = RawObservation.safeParse(item);
    if (!o.success || o.data.from === undefined) {
      dropped++;
      continue;
    }
    const text = clip(squash(o.data.text), 400);
    const from = o.data.from, to = o.data.to ?? o.data.from;
    const path = o.data.path ?? shown.path;
    // Lines it was shown, or exactly one whole declaration on the file's map (its name and range were shown).
    const inside = path === shown.path && from <= to && (
      (to - from <= MAX_SPAN && Array.from({ length: to - from + 1 }, (_, i) => from + i).every((n) => shown.lines.has(n))) ||
      !!shown.declarations?.some((d) => d.from === from && d.to === to));
    if (text && inside && quotesIn(text, shownText) && plainAndSupported(unquoted(text), numbers)) observations.push({ text, path, from, to, url: shown.fileUrl(from, to) });
    else dropped++;
  }
  return finish(shape, observations, dropped, numbers);
}

/** The codebase's intro: every observation names a file or folder that is really on its map. */
export function validateOverview(raw: string, shown: ShownMap): FindingsResult {
  const shape = readShape(raw);
  if ("error" in shape) return { ok: false, reason: "unreadable", dropped: 0 };
  const numbers = numbersOf(shown.evidence);
  const source = squash(shown.evidence);
  let dropped = 0;
  const observations: Observation[] = [];
  for (const item of shape.observations) {
    const o = RawObservation.safeParse(item);
    const text = o.success ? clip(squash(o.data.text), 400) : "";
    const path = o.success ? (o.data.path ?? "").trim().replace(/^\.?\//, "").replace(/\/+$/, "") : "";
    const dir = shown.dirs.has(path);
    if (text && path && (dir || shown.files.has(path)) && quotesIn(text, source) && plainAndSupported(unquoted(text), numbers)) {
      observations.push({ text, path: dir ? `${path}/` : path, url: shown.pathUrl(path, dir) });
    } else dropped++;
  }
  return finish(shape, observations, dropped, numbers);
}
