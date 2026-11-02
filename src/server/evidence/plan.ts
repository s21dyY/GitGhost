import type { EvidenceItem } from "@/domain/evidence";
import { STATUS_NOTICE_RE, type FileRef, type Intent } from "./intent";
import type { EvidenceRef } from "./select";

/**
 * Deterministic evidence planner (Milestone 2C.3). It NEVER decides what is true and NEVER writes new
 * claims: it only (a) ranks which retrieved items matter for a question (see selectEvidence) and
 * (b) lifts the most relevant facts out of the already-selected items, word for word, and attaches the
 * E-number of the item each one came from. The model still has to cite them, and the validator still
 * checks every number, date, word of cause and reference.
 *
 * Why it exists: the first real model reply to "Why did you die?" cited nothing, although the README
 * announced the archival, because ten loosely ranked items (five of them comments on a 2015 issue about
 * package upgrades) buried the two or three that mattered.
 */
export type KeyFact = { ref: string; text: string };
export type CausePlan = { stated: boolean; ref?: string; sentence?: string };

/** Stricter than STATUS_NOTICE_RE: "deprecat…", "replac…" and "successor" match countless ordinary issues. */
export const STRICT_NOTICE_RE = /\b(sunset\w*|archiv\w*|no longer (maintain\w*|develop\w*|support\w*)|end of life|unmaintained|discontinu\w*|shut ?down|wind(ing)? down|abandon\w*)\b/i;
/** Words with which a maintainer explains a decision. Used only to detect that a reason is written down. */
export const REASON_RE = /\b(because|due to|in order to|so that we|in favou?r of|to focus on|focus(ing)? on|prioriti[sz]\w*|lack of|no longer have|run out of|moving to|moved to)\b/i;

/** Markdown and URLs removed so a quoted sentence is plain text (links are never copied from evidence). */
export function plainText(text: string, max = 220): string {
  const t = text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\bwww\.\S+/g, " ")
    .replace(/^[\s>#*_-]+/, "")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Sentences, never spanning a line break (so a heading and the quote below it stay separate). */
const sentences = (text: string) =>
  text
    .split(/\n+/)
    .map((line) => plainText(line, 4000))
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .filter(Boolean);
/** First line of an issue or pull request, without its number and state. */
export const titleOf = (item: EvidenceItem) => /^#\d+ (.*?)(?: \[|$)/.exec(item.excerpt)?.[1] ?? "";
const commentText = (item: EvidenceItem) => /^Comment on #\d+ \([^)]*\): ([\s\S]*)$/.exec(item.excerpt)?.[1] ?? "";

/** True for an issue, pull request or comment that reads like a maintainer notice about the project's status. */
export function isStatusNotice(item: EvidenceItem): boolean {
  if (item.kind === "issue" || item.kind === "pull-request") return STRICT_NOTICE_RE.test(titleOf(item));
  if (item.kind === "issue-comment") return sentences(commentText(item)).some((s) => STRICT_NOTICE_RE.test(s));
  return false;
}

const ISO_DAY = /\b(\d{4}-\d{2}-\d{2})(?:T[\d:.]+Z)?/;

/** A file's story, lifted word for word: the named line, the commit that last changed it, the file's newest and earliest commits, and the pull request behind them (with a reason only if one is written). */
function fileFacts(refs: readonly EvidenceRef[], file?: FileRef | null): KeyFact[] {
  const facts: KeyFact[] = [];
  const headline = (r: EvidenceRef) => plainText(r.item.excerpt.replace(/\s*\(committed [^)]*\)\s*$/, "").replace(/^[^:]*last changed by commit \w+: /, ""), 160);
  const day = (r: EvidenceRef) => ISO_DAY.exec(r.item.excerpt)?.[1];
  const code = refs.find((r) => r.item.kind === "file");
  const blame = refs.find((r) => r.item.kind === "commit" && r.item.label?.startsWith("Line "));
  const touching = refs.find((r) => r.item.kind === "commit" && r.item.label?.startsWith("Commit touching"));
  const earliest = refs.find((r) => r.item.kind === "commit" && r.item.label?.startsWith("Earliest commit"));
  const pr = refs.find((r) => r.item.kind === "pull-request");
  if (code && file?.line) {
    const row = new RegExp(`^${file.line}: (.*)$`, "m").exec(code.item.excerpt)?.[1];
    if (row !== undefined) facts.push({ ref: code.ref, text: `line ${file.line} of ${file.path} reads: "${row.trim().slice(0, 140)}"` });
  }
  if (blame) facts.push({ ref: blame.ref, text: `line ${file?.line ?? "?"} last changed by commit ${blame.item.revisionSha?.slice(0, 7)}${day(blame) ? ` (${day(blame)})` : ""}: "${headline(blame)}"` });
  if (touching) facts.push({ ref: touching.ref, text: `newest commit touching ${file?.path ?? "the file"}${day(touching) ? ` (${day(touching)})` : ""}: "${headline(touching)}"` });
  if (earliest && earliest.item.id !== touching?.item.id) facts.push({ ref: earliest.ref, text: `earliest commit GitHub lists for ${file?.path ?? "the file"}${day(earliest) ? ` (${day(earliest)})` : ""}: "${headline(earliest)}"` });
  if (pr) {
    facts.push({ ref: pr.ref, text: `pull request behind that commit: "${plainText(titleOf(pr.item), 160)}"` });
    const why = sentences(pr.item.excerpt.replace(/^#\d+ .*?\]\s*/, "")).find((s) => REASON_RE.test(s));
    if (why) facts.push({ ref: pr.ref, text: `that pull request gives a reason: "${plainText(why, 200)}"` });
  }
  return facts.slice(0, 7);
}

export function keyFacts(refs: readonly EvidenceRef[], intent: Intent, file?: FileRef | null): KeyFact[] {
  if (intent === "file") return fileFacts(refs, file);
  const facts: KeyFact[] = [];
  const meta = refs.find((r) => r.item.kind === "repo-metadata");
  const readme = refs.find((r) => r.item.kind === "readme");
  const commit = refs.find((r) => r.item.kind === "commit");
  const notices = refs.filter((r) => isStatusNotice(r.item));

  if (meta) {
    const archived = /\barchived: (true|false)\b/.exec(meta.item.excerpt)?.[1];
    if (archived) facts.push({ ref: meta.ref, text: `archived: ${archived} (GitHub's flag on the repository)` });
    const push = /\blast push: (\S+)/.exec(meta.item.excerpt)?.[1];
    if (push && push !== "unknown") facts.push({ ref: meta.ref, text: `last push: ${ISO_DAY.exec(push)?.[1] ?? push}` });
    if (intent === "history") {
      const created = /\bcreated on GitHub: (\S+)/.exec(meta.item.excerpt)?.[1];
      if (created) facts.push({ ref: meta.ref, text: `created on GitHub: ${ISO_DAY.exec(created)?.[1] ?? created}` });
    }
  }
  if (readme && (intent === "status" || intent === "general")) {
    const s = sentences(readme.item.excerpt).find((x) => STATUS_NOTICE_RE.test(x));
    if (s) facts.push({ ref: readme.ref, text: `README notice: "${plainText(s, 240)}"` });
  }
  if (commit && intent !== "issues") {
    // Two stored shapes: "headline\nISO-date" (the newest commit, from the summon step) and "headline (committed ISO-date)".
    const day = ISO_DAY.exec(commit.item.excerpt)?.[1];
    const headline = plainText((commit.item.excerpt.split("\n")[0] ?? "").replace(/\s*\(committed [^)]*\)\s*$/, ""), 160);
    facts.push({ ref: commit.ref, text: `newest commit retrieved${day ? ` (${day})` : ""}: "${headline}"` });
  }
  if (intent === "status" || intent === "issues") {
    for (const n of notices.slice(0, 2)) {
      facts.push({ ref: n.ref, text: `${n.item.kind === "issue-comment" ? "comment" : n.item.kind === "pull-request" ? "pull request" : "issue"} about the project's status: "${plainText(n.item.kind === "issue-comment" ? commentText(n.item) : titleOf(n.item), 200)}"` });
    }
  }
  return facts.slice(0, 7);
}

/** Does any selected item state a reason, in writing, next to a status notice? Keyword check, so it can miss one. */
export function causeCheck(refs: readonly EvidenceRef[]): CausePlan {
  for (const r of refs) {
    if (r.item.kind !== "readme" && !isStatusNotice(r.item)) continue;
    const text = r.item.kind === "issue-comment" ? commentText(r.item) : r.item.excerpt;
    const hit = sentences(text).find((s) => STRICT_NOTICE_RE.test(s) && REASON_RE.test(s));
    if (hit) return { stated: true, ref: r.ref, sentence: plainText(hit, 240) };
  }
  return { stated: false };
}
