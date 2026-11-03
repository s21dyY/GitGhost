import { z } from "zod";
import type { EvidenceRef } from "@/server/evidence/select";

/**
 * Model output contract and citation validation.
 *
 * CONTRACT (Milestone 2C.3, strict):
 *  - The reply is exactly ONE JSON object whose only key is "segments" (a code fence is tolerated).
 *  - ANY other top-level key makes the whole reply unusable. Rationale: the first real Nova Lite reply
 *    put its ghost line in a top-level "ghost" array; a lenient parser dropped it without a trace. Content
 *    in an unexpected place is a broken contract, not something to guess about, so the reply is refused
 *    (fail closed) and the reason is reported to developers.
 *  - Each segment is validated on its own; one bad segment no longer discards the others.
 *  - Unknown keys INSIDE a segment (for example "url" or "source") are ignored, because every field that
 *    matters (links, citation labels) is rebuilt from the server's registry; they are reported, never used.
 *
 * The model may only point at evidence by the short references it was given (E1, E2, ...). Links are
 * NEVER taken from model text. A segment with any bad reference, or with a factual detail the cited
 * evidence does not contain, is dropped as a whole.
 *
 * V6.3 (conversational freedom): fiction and facts are validated separately and per SENTENCE.
 *  - "ghost" text is creative (emotion, stutter, repeated phrases, odd typography, small numbers) and needs no citation,
 *    but a sentence that states a concrete repository fact (a date, version, #number, hash, commit/issue/release event,
 *    maintainer, reason a project ended, or hindsight in a historical era) is removed on its own. Other sentences stay.
 *  - "verified" / "interpretation" sentences are each checked against the cited evidence; unsupported ones are removed on
 *    their own, so a good sentence is not lost with a bad one.
 *  - A truncated reply keeps its complete segments; a plain-prose reply becomes ghost text filtered the same way.
 *  - Nothing unsupported is ever promoted to "verified": removal is the only repair.
 *
 * Diagnostics describe WHAT was dropped and WHY with codes and counts only. They never contain the
 * model's text, so they are safe for developer logs and are never shown to visitors.
 */
export const SEGMENT_KINDS = ["verified", "interpretation", "unknown", "ghost"] as const;
export type { SegmentKind, Citation, AnswerSegment } from "@/domain/chat";
import type { AnswerSegment } from "@/domain/chat";

const SegmentSchema = z.object({
  kind: z.enum(SEGMENT_KINDS),
  text: z.string().min(1).max(700),
  cites: z.array(z.string()).max(8).optional(),
});
export type ModelSegment = z.infer<typeof SegmentSchema>;

export type RejectionReason =
  | "bad_reference"
  | "no_citation"
  | "unsupported_detail"
  | "contains_link"
  | "empty"
  | "bad_shape"
  | "malformed_segment"
  | "copied_example"
  | "unreadable"
  | "invented_claim"
  | "contradicts_evidence"
  | "misattributed_source"
  | "repo_claim_in_fiction";
/** `partial` is set when only some sentences of the segment were removed and the rest was kept. */
export type Rejection = { reason: RejectionReason; index?: number; partial?: true };

export type OutputRejectReason = "invalid_json" | "not_an_object" | "unknown_top_level_keys" | "segments_missing" | "segments_not_array" | "segments_empty" | "too_many_segments" | "all_segments_malformed";

export type OutputDiagnostics = {
  json: "ok" | "invalid" | "not_an_object";
  fenced: boolean;
  /** Names are sanitized and truncated: they come from untrusted output. */
  topLevelKeys: string[];
  unknownTopLevelKeys: string[];
  segmentsKey: "ok" | "missing" | "not_an_array" | "empty" | "too_many";
  segmentCount: number;
  /** Unknown keys found inside segments (ignored, never used). */
  ignoredSegmentKeys: { index: number; keys: string[] }[];
  rejected: Rejection[];
  accepted: { verified: number; interpretation: number; unknown: number; ghost: number };
  /** Set when the WHOLE reply was refused, with the reason. */
  refusedBecause?: OutputRejectReason;
  /** True when a truncated or trailing-garbage reply was accepted by keeping only its complete segments. */
  salvaged?: boolean;
  /** True when a plain-prose reply (no JSON) was accepted as filtered ghost text. */
  prose?: boolean;
  /** Factual (verified/interpretation) segments or sentences removed because the evidence did not support them. */
  droppedFactual?: number;
  /** Filled in by the pipeline: the provider's stop reason, and whether the reply was cut off. */
  stopReason?: string;
  truncated?: boolean;
  /**
   * Filled in by the pipeline for accepted replies. "thin" means the server offered relevant key facts but
   * the accepted answer states none of them (for example an unknown-only reply). It is reported to
   * developers, not rejected: an honest "not found" is a valid answer.
   */
  quality?: { ghostSegments: number; factualSegments: number; unknownSegments: number; keyFactsOffered: number; citedRefs: string[]; thin: boolean };
};

export type ModelOutputResult =
  | { ok: true; segments: AnswerSegment[]; rejected: Rejection[]; diagnostics: OutputDiagnostics }
  | { ok: false; reason: OutputRejectReason; diagnostics: OutputDiagnostics };

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g;
const LINK = /(https?:\/\/|www\.|\]\(|\bgit@|\w+\.(com|org|io|net|dev)\/)/i;
const NUMBER_REF = /#(\d{1,7})\b/g;
const HEX = /\b[0-9a-f]{7,40}\b/gi;

/** Phrases that only occur in the format example of the prompt. A reply that repeats them copied the example. */
export const EXAMPLE_MARKERS = ["moth-lantern", "moths are welcome", "tended the lantern", "moths... they still circle", "moths… they still circle"] as const;

/** Extract the JSON object from a model reply, tolerating a code fence. */
export function parseModelJson(raw: string): unknown | null {
  let t = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
  if (fence) t = fence[1];
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

/** Any run of digits with date/version/decimal glue: 2019-04-01, 12:30, 1.0.4, 12,345, 40%. */
const NUMERIC_TOKEN = /\d[\d.,:/-]*\d|\d/g;
const REF_WORD = /\bE\d{1,2}\b/g;
/**
 * Every number, date and version a factual segment states must literally appear in the evidence it
 * cites. This is what stops a model that cites a real item from adding a made-up date, count or version.
 * Spelled-out numbers ("three issues") cannot be checked this way; see docs/history/AI_READINESS.md.
 */
function numbersSupported(text: string, haystack: string): boolean {
  const flat = haystack.replace(/(\d),(?=\d{3}\b)/g, "$1");
  for (const m of text.replace(REF_WORD, " ").matchAll(NUMERIC_TOKEN)) {
    const token = m[0].replace(/[.,:/-]+$/, "");
    const bare = token.replace(/(\d),(?=\d{3}\b)/g, "$1");
    if (!haystack.includes(token) && !flat.includes(bare)) return false;
  }
  return true;
}

/**
 * Words that assert WHY a project stopped or what people felt. The prompt forbids them without a
 * maintainer statement; this makes the server enforce it: the word must occur in the cited evidence.
 */
const CAUSAL = /\b(abandon(?:ed|ing|ment)?|gave up|give up|lost interest|burn(?:ed|t)? out|burnout|ran out of (?:time|money|funding|energy)|no longer cared|neglect(?:ed)?|forgot(?:ten)?|died because|killed by|failed because)\b/gi;
/** A person-like subject followed by a verb of motive or departure: "the maintainers moved on". */
const MOTIVE = /\b(developers?|maintainers?|authors?|contributors?|creators?|the team|they|he|she)\b[^.!?]{0,40}\b(left|quit|gave up|stopped caring|lost interest|moved on|walked away|forgot|didn['’]?t care|were tired|burn(?:ed|t)? out|felt|wanted|decided|chose)\b/gi;

function supports(text: string, cited: EvidenceRef[]): boolean {
  const haystack = cited.map((c) => `${c.item.excerpt}\n${c.item.label ?? ""}\n${c.item.revisionSha ?? ""}`).join("\n").toLowerCase();
  if (!numbersSupported(text.toLowerCase(), haystack)) return false;
  for (const m of text.matchAll(CAUSAL)) if (!haystack.includes(m[0].toLowerCase())) return false;
  for (const m of text.matchAll(NUMBER_REF)) if (!haystack.includes(`#${m[1]}`)) return false;
  for (const m of text.matchAll(HEX)) {
    const token = m[0].toLowerCase();
    // Plain English words made only of a-f letters are not hashes; require at least one digit.
    if (/\d/.test(token) && !haystack.includes(token)) return false;
  }
  return true;
}

/** True when the text states a motive/departure that the cited evidence does not use itself. */
function inventsMotive(text: string, cited: EvidenceRef[]): boolean {
  const haystack = cited.map((c) => c.item.excerpt).join("\n").toLowerCase();
  for (const m of text.matchAll(MOTIVE)) if (!haystack.includes(m[2].toLowerCase())) return true;
  return false;
}

/**
 * Deterministic contradiction check for the one fact the server can verify exactly: the archived flag.
 * It only applies to sentences that rest on the repository metadata (they do not mention README, issues
 * or commits as their source).
 */
function contradictsArchivedFlag(text: string, cited: EvidenceRef[]): boolean {
  const meta = cited.find((c) => c.item.kind === "repo-metadata");
  if (!meta || SAYS_README.test(text) || SAYS_COMMIT.test(text) || SAYS_ISSUE.test(text)) return false;
  const flag = /^.*\barchived: (true|false)\b/m.exec(meta.item.excerpt)?.[1] ?? /\barchived: (true|false)\b/.exec(meta.item.excerpt)?.[1];
  if (!flag || !/\barchived\b/i.test(text) && !/\b(still|actively) (maintained|active|developed)\b/i.test(text)) return false;
  const negated = /\b(not|n['’]t|no|never)\b[^.]{0,50}\barchived\b/i.test(text) || /\b(still|actively) (maintained|active|developed)\b/i.test(text);
  return flag === "true" ? negated : !negated;
}

/**
 * Attribution check: a sentence that names its source must cite an item of that kind. Phrase-based on
 * purpose ("the README says", "the newest commit", "issue #12"), so words that merely appear inside text
 * quoted from the evidence (a commit headline such as "Merge pull request #25709") never trigger it.
 */
const SAYS_README = /\b(?:the|this)\s+README\b/i;
const SAYS_COMMIT = /\b(?:the|a|this)\s+(?:(?:newest|latest|last|most recent|recent)\s+)?commits?\b/i;
const SAYS_ISSUE = /\bissue\s*#\d+|\b(?:the|an?|this)\s+(?:issue|comment|pull request)\b/i;
function misattributes(text: string, cited: EvidenceRef[]): boolean {
  const kinds = new Set(cited.map((c) => c.item.kind));
  if (SAYS_README.test(text) && !kinds.has("readme")) return true;
  if (SAYS_COMMIT.test(text) && !kinds.has("commit")) return true;
  if (SAYS_ISSUE.test(text) && !kinds.has("issue") && !kinds.has("pull-request") && !kinds.has("issue-comment")) return true;
  return false;
}

/**
 * A ghost line is fiction, so only truly unreadable text is refused: very long, mostly symbols, or a huge run of one
 * character. Ellipses, stutters, repeated words and unusual typography are allowed (V6.3).
 */
function unreadable(text: string): boolean {
  const visible = text.replace(/\s/g, "");
  const letters = (text.match(/\p{L}/gu) ?? []).length;
  return text.length > 400 || letters < visible.length * 0.5 || /(.)\1{11,}/.test(text);
}

const MONTH = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const REPO_NOUN = "commits?|issues?|stars?|forks?|contributors?|maintainers?|releases?|pull requests?|prs?|files?|lines|versions?|branches|tags?|years?|months?|weeks?|days?";
const NUMBER_WORD = "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozens?|hundreds?|thousands?|dozen|many|several|countless";
/**
 * Concrete repository claims that fiction must not state. Matched per sentence. Plain emotion, metaphor and
 * small numbers ("three candles", "3 a.m.") are not on this list.
 */
/** `numeric` rules are skipped when the segment cites evidence that literally contains its numbers (for example "#31" from a retrieved issue). */
const FICTION_CLAIM: [RegExp, RejectionReason, boolean?][] = [
  [/#\d{1,7}\b/, "unsupported_detail", true],
  [/\b\d{4}-\d{2}(?:-\d{2})?\b/, "unsupported_detail", true],
  [/\b(?:19|20)\d{2}\b/, "unsupported_detail", true],
  [new RegExp(`\\b(?:${MONTH})\\.?\\s+\\d{1,4}\\b`, "i"), "unsupported_detail", true],
  [/\bv?\d+\.\d+(?:\.\d+)?\b/, "unsupported_detail", true],
  [new RegExp(`\\b\\d[\\d,]*\\s*(?:${REPO_NOUN})\\b`, "i"), "unsupported_detail", true],
  [new RegExp(`\\b(?:${NUMBER_WORD})\\s+(?:${REPO_NOUN})\\b`, "i"), "repo_claim_in_fiction"],
  [/\b(?:first|last|final|latest|newest|oldest|initial|original)\s+(?:commit|release|version|issue|push|merge|change|tag)\b/i, "repo_claim_in_fiction"],
  [/\b(?:archived|deprecated|unmaintained|read-only|forked|merged|released|deployed|shipped|maintained by|created by|written by|owned by|founded by)\b/i, "repo_claim_in_fiction"],
  [/\b(?:maintainers?|contributors?|committers?)\b/i, "repo_claim_in_fiction"],
  [/@\w{2,}/, "repo_claim_in_fiction"],
  [SAYS_README, "misattributed_source"],
  [SAYS_COMMIT, "misattributed_source"],
  [SAYS_ISSUE, "misattributed_source"],
];
/** Only in a historical era: hindsight the ghost cannot have. */
const HINDSIGHT = /\b(?:later|eventually|in the end|would (?:later |one day |soon )?(?:become|be|end|fade|die)|years? (?:later|from now)|these days|nowadays|today|nowadays|these last)\b/i;

function fictionClaim(sentence: string, era: boolean, cited: EvidenceRef[]): RejectionReason | null {
  const numbersBacked = cited.length > 0 && supports(sentence, cited);
  const sourceBacked = cited.length > 0 && !misattributes(sentence, cited);
  for (const [re, reason, numeric] of FICTION_CLAIM) {
    if (numeric && numbersBacked) continue;
    if (reason === "misattributed_source" && sourceBacked) continue;
    if (re.test(sentence)) return reason;
  }
  // A hex-looking token is a hash only when it contains a digit ("decade" and "defaced" are words).
  if (!numbersBacked && (sentence.match(HEX) ?? []).some((t) => /\d/.test(t))) return "unsupported_detail";
  if (new RegExp(CAUSAL.source, "i").test(sentence) || new RegExp(MOTIVE.source, "i").test(sentence)) return "invented_claim";
  if (era && HINDSIGHT.test(sentence)) return "repo_claim_in_fiction";
  return null;
}

/** Split into sentences without cutting decimals, versions or "..." inside a sentence. */
function sentencesOf(text: string): string[] {
  return text.split(/(?<=[.!?\u2026]["')\]]?)\s+(?=[A-Z"'(\[\u2018\u201c])/).map((t) => t.trim()).filter(Boolean);
}

/** Why a factual (verified / interpretation / unknown) sentence is not supported by the evidence it cites. */
function factualFailure(sentence: string, kind: "verified" | "interpretation" | "unknown", cited: EvidenceRef[]): RejectionReason | null {
  if (!supports(sentence, cited)) return "unsupported_detail";
  if (kind === "unknown") return null;
  if (inventsMotive(sentence, cited)) return "invented_claim";
  if (contradictsArchivedFlag(sentence, cited)) return "contradicts_evidence";
  if (misattributes(sentence, cited)) return "misattributed_source";
  return null;
}

/**
 * Keep the complete segment objects of a reply that was cut off (stop reason max_tokens) or that has trailing text.
 * Every kept object still goes through the full per-segment validation. Returns null when nothing complete exists.
 */
function salvageSegments(raw: string): unknown[] | null {
  const t = raw.trim().replace(/^```(?:json)?\s*/i, "");
  const head = /^\{\s*"segments"\s*:\s*\[/.exec(t);
  if (!head) return null;
  const out: unknown[] = [];
  let i = head[0].length;
  for (;;) {
    while (i < t.length && /[\s,]/.test(t[i])) i++;
    if (t[i] !== "{") break;
    let depth = 0, inStr = false, esc = false, end = -1;
    for (let j = i; j < t.length; j++) {
      const c = t[j];
      if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) { end = j; break; }
    }
    if (end < 0) break;
    try { out.push(JSON.parse(t.slice(i, end + 1))); } catch { break; }
    i = end + 1;
    if (out.length >= 12) break;
  }
  return out.length ? out : null;
}

/** A plain-prose reply (no JSON at all) as ghost segments, so a good in-character answer is not thrown away. */
function proseSegments(raw: string): unknown[] | null {
  const t = raw.trim();
  // Anything that looks like broken JSON or markup is a contract failure, not a story.
  if (!t || /[{}\[\]`<>]|"segments"|"kind"/.test(t) || t.length > 2400) return null;
  const paragraphs = t.split(/\n{2,}|\n/).map((p) => p.trim()).filter(Boolean).slice(0, 6);
  const out: unknown[] = [];
  for (const p of paragraphs) for (let i = 0; i < p.length; i += 380) out.push({ kind: "ghost", text: p.slice(i, i + 380) });
  return out.length ? out.slice(0, 6) : null;
}

const cleanKey = (k: string) => k.replace(/[^A-Za-z0-9_.-]/g, "?").slice(0, 40);
const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function emptyDiagnostics(): OutputDiagnostics {
  return {
    json: "invalid", fenced: false, topLevelKeys: [], unknownTopLevelKeys: [], segmentsKey: "missing", segmentCount: 0,
    ignoredSegmentKeys: [], rejected: [], accepted: { verified: 0, interpretation: 0, unknown: 0, ghost: 0 },
  };
}

export type ValidateOptions = {
  /** Historical era: the ghost may not state hindsight. */
  era?: boolean;
  /** Accept a plain-prose reply as filtered ghost text. The pipeline allows this only for character and mixed turns. */
  allowProse?: boolean;
};

export function validateModelOutput(raw: string, refs: readonly EvidenceRef[], opts: ValidateOptions = {}): ModelOutputResult {
  const d = emptyDiagnostics();
  d.fenced = /^```/.test(raw.trim());
  let json = parseModelJson(raw);
  if (json === null && raw.trim() !== "null") {
    // Not valid JSON. Keep what is safely recoverable instead of refusing a whole expressive reply (V6.3).
    const kept = salvageSegments(raw);
    const prose = kept || !opts.allowProse ? null : proseSegments(raw);
    const recovered = kept ?? prose;
    if (!recovered) {
      d.refusedBecause = "invalid_json";
      return { ok: false, reason: "invalid_json", diagnostics: d };
    }
    if (kept) d.salvaged = true;
    else d.prose = true;
    json = { segments: recovered };
  }
  if (!isPlain(json)) {
    d.json = "not_an_object";
    d.refusedBecause = "not_an_object";
    return { ok: false, reason: "not_an_object", diagnostics: d };
  }
  d.json = d.salvaged || d.prose ? "invalid" : "ok";
  const keys = Object.keys(json);
  d.topLevelKeys = keys.slice(0, 8).map(cleanKey);
  d.unknownTopLevelKeys = keys.filter((k) => k !== "segments").slice(0, 8).map(cleanKey);
  const segs = json.segments;
  d.segmentsKey = !("segments" in json) ? "missing" : !Array.isArray(segs) ? "not_an_array" : segs.length === 0 ? "empty" : segs.length > 12 ? "too_many" : "ok";
  d.segmentCount = Array.isArray(segs) ? segs.length : 0;
  const refuse = (reason: OutputRejectReason): ModelOutputResult => {
    d.refusedBecause = reason;
    return { ok: false, reason, diagnostics: d };
  };
  // Strict top level: anything besides "segments" is a broken contract. Checked first because the content
  // may be hiding in the unexpected key (the 2026-11-01 Nova Lite reply did exactly that).
  if (d.unknownTopLevelKeys.length) return refuse("unknown_top_level_keys");
  if (d.segmentsKey === "missing") return refuse("segments_missing");
  if (d.segmentsKey === "not_an_array") return refuse("segments_not_array");
  if (d.segmentsKey === "empty") return refuse("segments_empty");
  if (d.segmentsKey === "too_many") return refuse("too_many_segments");

  const byRef = new Map(refs.map((r) => [r.ref, r]));
  const segments: AnswerSegment[] = [];
  const reject = (reason: RejectionReason, index: number) => d.rejected.push({ reason, index });
  (segs as unknown[]).forEach((el, index) => {
    const parsed = SegmentSchema.safeParse(el);
    if (!parsed.success) return reject("malformed_segment", index);
    if (isPlain(el)) {
      const extra = Object.keys(el).filter((k) => k !== "kind" && k !== "text" && k !== "cites");
      if (extra.length) d.ignoredSegmentKeys.push({ index, keys: extra.slice(0, 6).map(cleanKey) });
    }
    const seg = parsed.data;
    const text = seg.text.replace(CONTROL, "").replace(/\s+/g, " ").trim();
    if (!text) return reject("empty", index);
    if (LINK.test(text)) return reject("contains_link", index);
    const lower = text.toLowerCase();
    if (EXAMPLE_MARKERS.some((m) => lower.includes(m))) return reject("copied_example", index);
    const cites = [...new Set(seg.cites ?? [])];
    const cited: EvidenceRef[] = [];
    for (const c of cites) {
      const r = byRef.get(c);
      if (!r) return reject("bad_reference", index);
      cited.push(r);
    }
    if ((seg.kind === "verified" || seg.kind === "interpretation") && cited.length === 0) {
      d.droppedFactual = (d.droppedFactual ?? 0) + 1;
      return reject("no_citation", index);
    }
    if (seg.kind === "unknown" && cited.length) return reject("bad_shape", index);
    // Each sentence is its own claim unit. Unsupported ones are removed alone; the rest of the segment stays.
    const kept: string[] = [];
    let firstFailure: RejectionReason | null = null;
    for (const sentence of sentencesOf(text)) {
      const failure = seg.kind === "ghost" ? (fictionClaim(sentence, opts.era === true, cited)) : factualFailure(sentence, seg.kind, cited);
      if (failure) {
        firstFailure ??= failure;
        if (seg.kind !== "ghost") d.droppedFactual = (d.droppedFactual ?? 0) + 1;
      } else kept.push(sentence);
    }
    if (seg.kind === "ghost" && unreadable(kept.join(" "))) return reject("unreadable", index);
    if (kept.length === 0) return reject(firstFailure ?? "empty", index);
    if (firstFailure) d.rejected.push({ reason: firstFailure, index, partial: true });
    const finalText = kept.join(" ");
    d.accepted[seg.kind]++;
    segments.push({
      kind: seg.kind,
      text: finalText,
      citations: cited.map((c) => ({
        ref: c.ref, id: c.item.id, kind: c.item.kind, label: c.item.label ?? c.item.kind, url: c.item.sourceUrl,
        excerpt: c.item.excerpt.slice(0, 600), ...(c.item.revisionSha ? { revisionSha: c.item.revisionSha } : {}),
      })),
    });
  });
  // A recovered (truncated or prose) reply with nothing usable left is refused like any other broken reply.
  if ((d.salvaged || d.prose) && segments.length === 0) return refuse("invalid_json");
  // Nothing in the reply was even well-formed: refuse it rather than present a polite "no answer".
  if (segments.length === 0 && d.rejected.length === d.segmentCount && d.rejected.every((r) => r.reason === "malformed_segment")) return refuse("all_segments_malformed");
  return { ok: true, segments, rejected: d.rejected, diagnostics: d };
}

/** Back-compatible wrapper: null when the reply as a whole is unusable. */
export function validateModelAnswer(
  raw: string,
  refs: readonly EvidenceRef[],
): { segments: AnswerSegment[]; rejected: Rejection[] } | null {
  const r = validateModelOutput(raw, refs);
  return r.ok ? { segments: r.segments, rejected: r.rejected } : null;
}
