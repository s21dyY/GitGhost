import { z } from "zod";

/**
 * The Specialist's findings, and the checks they must pass before a player sees any of them. The model is told the
 * shape; nothing it returns is trusted. Every observation must point at lines it was actually shown, any code it
 * quotes must be there word for word, every number must appear in the evidence, and it may not state links or
 * anyone's intent. Links are built here from the repository, the commit and the line range, never taken from the model.
 */
export const FindingsSchema = z.object({
  summary: z.string().min(1).max(600),
  observations: z.array(z.object({ text: z.string().min(1).max(400), path: z.string().min(1).max(300), from: z.number().int().min(1), to: z.number().int().min(1) })).min(1).max(8),
  uncertainties: z.array(z.string().min(1).max(300)).max(6).default([]),
  followUps: z.array(z.string().min(1).max(200)).max(5).default([]),
});

export type Observation = { text: string; from: number; to: number; url: string };
export type Findings = { summary: string; observations: Observation[]; uncertainties: string[]; followUps: string[] };
export type FindingsResult =
  | { ok: true; findings: Findings; dropped: number }
  | { ok: false; reason: "unreadable" | "no_supported_observation" | "unsupported_summary"; dropped: number };

/** What the Specialist was shown: the file's lines by number (from the evidence parts) and all evidence text. */
export type Shown = { path: string; lines: ReadonlyMap<number, string>; evidence: string; fileUrl: (from: number, to: number) => string };

const MAX_SPAN = 120;
const LINK = /https?:\/\/|\bwww\.\S/i;
/** Someone's intent or feelings, which the code itself cannot show. */
const INTENT = /\b(developers?|maintainers?|authors?|contributors?|the team|they|he|she)\b[^.!?]{0,50}\b(wanted|decided|chose|intended|meant to|tried to|hoped|felt|preferred|planned)\b/i;
const NUMBER = /\b\d+(?:\.\d+)?\b/g;

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

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
/** A sentence is supported if it has no link, states no intent, and every number in it appears in the evidence as a
 *  whole number ("3" is not supported by "103"). */
function plainAndSupported(text: string, numbers: ReadonlySet<string>): boolean {
  if (LINK.test(text) || INTENT.test(text)) return false;
  for (const m of text.matchAll(NUMBER)) if (!numbers.has(m[0])) return false;
  return true;
}

export function validateFindings(raw: string, shown: Shown): FindingsResult {
  const parsed = FindingsSchema.safeParse(parse(raw));
  if (!parsed.success) return { ok: false, reason: "unreadable", dropped: 0 };
  const f = parsed.data;
  const shownText = squash([...shown.lines.values()].join("\n"));
  const numbers = new Set([...shown.evidence.matchAll(NUMBER)].map((m) => m[0]));
  let dropped = 0;
  const observations: Observation[] = [];
  for (const o of f.observations) {
    const inside = o.path === shown.path && o.from <= o.to && o.to - o.from <= MAX_SPAN && Array.from({ length: o.to - o.from + 1 }, (_, i) => o.from + i).every((n) => shown.lines.has(n));
    const quotes = [...o.text.matchAll(/`([^`]+)`/g)].map((m) => squash(m[1]));
    const quotedExactly = quotes.every((q) => q.length > 0 && shownText.includes(q));
    if (inside && quotedExactly && plainAndSupported(o.text.replace(/`[^`]+`/g, ""), numbers)) {
      observations.push({ text: squash(o.text), from: o.from, to: o.to, url: shown.fileUrl(o.from, o.to) });
    } else dropped++;
  }
  if (!observations.length) return { ok: false, reason: "no_supported_observation", dropped };
  if (!plainAndSupported(f.summary.replace(/`[^`]+`/g, ""), numbers)) return { ok: false, reason: "unsupported_summary", dropped };
  const keep = (list: string[]) => list.map(squash).filter((t) => !LINK.test(t) && !INTENT.test(t));
  return { ok: true, findings: { summary: squash(f.summary), observations, uncertainties: keep(f.uncertainties), followUps: keep(f.followUps).slice(0, 3) }, dropped };
}
