import type { EvidenceItem } from "@/domain/evidence";
import { STATUS_NOTICE_RE, type Intent } from "./intent";
import { isStatusNotice } from "./plan";

/** One selected piece of evidence with the short reference the model must use (E1, E2, ...). */
export type EvidenceRef = { ref: string; item: EvidenceItem; view: string };

const WEIGHTS: Record<Intent, Partial<Record<EvidenceItem["kind"], number>>> = {
  status: { "repo-metadata": 100, readme: 80, "issue-comment": 70, issue: 65, "pull-request": 60, commit: 55 },
  recent: { "repo-metadata": 100, commit: 90, "pull-request": 70, issue: 60, readme: 30, "issue-comment": 20 },
  history: { "repo-metadata": 100, commit: 90, readme: 50, issue: 20 },
  issues: { "repo-metadata": 100, issue: 90, "issue-comment": 80, "pull-request": 50, readme: 30, commit: 30 },
  general: { "repo-metadata": 100, readme: 80, commit: 70, issue: 30, "pull-request": 30 },
  // one file's story: its code, the commits that touched it and the pull request behind them, then the record
  file: { file: 100, commit: 95, "pull-request": 90, "repo-metadata": 60, readme: 10, issue: 10 },
};

const WORD = /[a-z0-9]{4,}/g;
const bytes = (s: string) => Buffer.byteLength(s, "utf8");

/** README badges and images carry no meaning for the model and cost bytes: remove them from the VIEW only. */
const stripBadges = (text: string) =>
  text
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    // an excerpt can end in the middle of an image or link: drop the unfinished tail too
    .replace(/!\[[^\]]*\]\([^)]*$/, "")
    .replace(/\]\([^)]*$/, "]")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
function viewOf(item: EvidenceItem): string {
  const max = item.kind === "readme" ? 700 : item.kind === "repo-metadata" ? 400 : item.kind === "file" ? 1100 : 420;
  // The raw excerpt (used to validate every number and word the model states) is never altered; only the view is cleaned.
  const text = item.kind === "readme" ? stripBadges(item.excerpt) : item.excerpt;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * Status questions ("why did you die?", "are you abandoned?") get a fixed priority order instead of a
 * score: the repository record (archived flag, last push), the README (where archival notices live), the
 * newest commit, then only issues or comments whose TITLE or sentences read like a maintainer notice
 * about the project's status. Unrelated issue threads are left out on purpose: the model should not be
 * handed (or asked to cite) material that does not bear on the question, and every item costs tokens.
 * Only if fewer than three items qualify do the best remaining non-comment items fill the gap, so the model
 * is never handed material that does not bear on the question just to reach a count.
 */
function selectStatus(
  items: readonly EvidenceItem[],
  opts: { question: string; byteBudget: number; maxItems?: number },
): EvidenceRef[] {
  const first = (k: EvidenceItem["kind"]) => items.find((i) => i.kind === k);
  const priority: EvidenceItem[] = [first("repo-metadata"), first("readme"), first("commit")].filter((x): x is EvidenceItem => !!x);
  for (const n of items.filter(isStatusNotice).slice(0, 3)) if (!priority.includes(n)) priority.push(n);
  if (priority.length < 3) {
    for (const i of items) {
      if (priority.length >= 3) break;
      if (!priority.includes(i) && i.kind !== "issue-comment") priority.push(i);
    }
  }
  const chosen: { item: EvidenceItem; view: string }[] = [];
  let used = 0;
  for (const item of priority) {
    if (chosen.length >= (opts.maxItems ?? 10)) break;
    const view = viewOf(item);
    const cost = bytes(view) + 40;
    if (used + cost > opts.byteBudget) continue;
    chosen.push({ item, view });
    used += cost;
  }
  return chosen.map((c, i) => ({ ref: `E${i + 1}`, item: c.item, view: c.view }));
}

export function selectEvidence(
  items: readonly EvidenceItem[],
  opts: { intent: Intent; question: string; byteBudget: number; maxItems?: number },
): EvidenceRef[] {
  if (opts.intent === "status") return selectStatus(items, opts);
  const words = new Set(opts.question.toLowerCase().match(WORD) ?? []);
  // The newest commit (first commit in the list, from the base fetch) is core context for most questions.
  const newestCommit = items.find((i) => i.kind === "commit");
  const scored = items.map((item, index) => {
    let score = WEIGHTS[opts.intent][item.kind] ?? 10;
    if (item === newestCommit && opts.intent !== "history" && opts.intent !== "issues" && opts.intent !== "file") score += 40;
    // for a file question the commit that last changed the named line matters most
    if (opts.intent === "file" && item.kind === "commit" && item.label?.startsWith("Line ")) score += 30;
    if (opts.intent === "status" && STATUS_NOTICE_RE.test(item.excerpt)) score += 60;
    for (const w of item.excerpt.toLowerCase().match(WORD) ?? []) if (words.has(w)) score += 2;
    return { item, score: score - index * 0.01 };
  });
  scored.sort((a, b) => b.score - a.score);

  const chosen: { item: EvidenceItem; view: string }[] = [];
  let used = 0;
  for (const { item } of scored) {
    if (chosen.length >= (opts.maxItems ?? 10)) break;
    const view = viewOf(item);
    const cost = bytes(view) + 40; // reference tag and framing
    if (used + cost > opts.byteBudget) continue;
    chosen.push({ item, view });
    used += cost;
  }
  return chosen.map((c, i) => ({ ref: `E${i + 1}`, item: c.item, view: c.view }));
}
