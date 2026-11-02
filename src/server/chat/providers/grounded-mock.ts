import { echoes, issuePerformance, resolveEntity, type Stage } from "@/config/entities";
import { identityFromAssignment, type EntityAssignment } from "@/domain/entity";
import type { Gap } from "@/server/evidence/retrieve";
import type { EvidenceRef } from "@/server/evidence/select";
import { STATUS_NOTICE_RE, type FileRef, type Intent } from "@/server/evidence/intent";
import { REASON_RE } from "@/server/evidence/plan";
import type { ModelSegment } from "../grounding";
import { asksWhatCodeDoes } from "../prompt";
import { estimateRequestTokens, estimateTokens } from "../tokens";
import { voiceLines, type Voice } from "../voice";
import type { ChatProvider, ChatRequest, ChatResponse } from "../types";

/**
 * Scripted stand-in for a model. It is NOT AI: it reads the same evidence references a real model
 * would get and composes question-sensitive answers from them with fixed templates, so the whole
 * pipeline (retrieval, selection, citation checks, UI) can be exercised offline. The UI labels
 * these replies as scripted.
 */
export type GroundedMockContext = {
  refs: readonly EvidenceRef[];
  intent: Intent;
  gaps: readonly Gap[];
  assignment: EntityAssignment;
  voice: Voice;
  /** The form speaking (human, distorted, transformed); picks the form's own scripted voice. */
  stage?: Stage;
  /** How many earlier user turns had the same intent; used to move on to fresh evidence. */
  variant: number;
  repo: { archived: boolean; fullName: string };
  /** Time Travel: present-day facts (the archived flag, the last push, language) are not evidence of that moment. */
  era?: { shortSha: string; date: string };
  /** The file (and line) a "file" question names. */
  file?: FileRef | null;
  /** The visitor's question, for telling "what does this code do" apart from its history. */
  question?: string;
};

const quote = (text: string, max = 180) => {
  const t = text
    .replace(/^\s*>+\s*/, "")
    .replace(/https?:\/\/\S+/g, "[link]")
    .replace(/\bwww\.\S+/g, "[link]")
    .replace(/\]\([^)]*\)/g, "]")
    .replace(/[[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return `“${t.length > max ? `${t.slice(0, max - 1)}…` : t}”`;
};
/** First sentence-like chunk that matches `re`, taken verbatim from the evidence text. */
const sentenceMatching = (text: string, re: RegExp) => text.split(/(?<=[.!?])\s+|\n+/).find((s) => re.test(s));
const titleOf = (excerpt: string) => /^#\d+ (.*?)(?: \[|$)/.exec(excerpt)?.[1] ?? "";
const numberOf = (excerpt: string) => /^#(\d+)\b/.exec(excerpt)?.[1];
const dateOf = (excerpt: string) => /\((?:committed )?(\d{4}-\d{2}-\d{2})T[\d:.]+Z\)/.exec(excerpt)?.[1];
const headlineOf = (excerpt: string) => excerpt.replace(/ \(committed [^)]*\)$/, "");
const field = (excerpt: string, name: string) => new RegExp(`^${name}: (.*)$`, "m").exec(excerpt)?.[1];
function slice<T>(list: T[], variant: number, n: number): T[] {
  if (list.length <= n) return list;
  const start = (variant * n) % list.length;
  return [...list, ...list].slice(start, start + n);
}

export function composeMockSegments(ctx: GroundedMockContext): ModelSegment[] {
  const { refs, intent, gaps, voice } = ctx;
  const lines = voiceLines(ctx.assignment, voice, `${intent}:${ctx.variant}`, ctx.stage);
  const of = (kind: string) => refs.filter((r) => r.item.kind === kind);
  const meta = of("repo-metadata")[0];
  const readme = of("readme")[0];
  const commits = of("commit");
  const issues = of("issue");
  const pulls = of("pull-request");
  const comments = of("issue-comment");
  const out: ModelSegment[] = [{ kind: "ghost", text: lines.opener }];
  const v = (text: string, ...cites: (EvidenceRef | undefined)[]) =>
    out.push({ kind: "verified", text, cites: cites.filter((x): x is EvidenceRef => !!x).map((x) => x.ref) });

  if (intent === "status") {
    out.push({ kind: "ghost", text: lines.bridge });
    if (ctx.era) {
      // Historical question: only what the commit's own time supports.
    } else if (meta) v(ctx.repo.archived ? `GitHub lists ${ctx.repo.fullName} as archived, which makes it read-only.` : `GitHub does not list ${ctx.repo.fullName} as archived.`, meta);
    const push = !ctx.era && meta && field(meta.item.excerpt, "last push");
    if (meta && push && push !== "unknown") v(`The last push GitHub records on this repository is ${push.slice(0, 10)}.`, meta);
    if (commits[0]) {
      const d = dateOf(commits[0].item.excerpt);
      v(`${ctx.era ? "As of this era the newest commit reads" : "The newest commit I retrieved on the default branch reads"} ${quote(headlineOf(commits[0].item.excerpt))}${d ? `, dated ${d}` : ""}.`, commits[0]);
    }

    let found = 0;
    const readmeNotice = readme && sentenceMatching(readme.item.excerpt, STATUS_NOTICE_RE);
    if (readme && readmeNotice) {
      v(`The README says ${quote(readmeNotice)}`, readme);
      found++;
    }
    for (const r of [...issues, ...pulls, ...comments].filter((x) => STATUS_NOTICE_RE.test(x.item.excerpt)).slice(0, 2)) {
      const n = numberOf(r.item.excerpt);
      const title = titleOf(r.item.excerpt);
      if (r.item.kind === "issue-comment") {
        const s = sentenceMatching(r.item.excerpt, STATUS_NOTICE_RE);
        if (s) {
          v(`A retrieved comment says ${quote(s)}`, r);
          found++;
        }
      } else if (n && title) {
        const word = STATUS_NOTICE_RE.exec(r.item.excerpt)?.[0];
        v(`${r.item.kind === "issue" ? "Issue" : "Pull request"} #${n}, titled ${quote(title, 120)}, mentions ${quote(word ?? "a status notice", 40)}.`, r);
        found++;
      }
    }
    if (found === 0) out.push({ kind: "unknown", text: "Nothing in the README, issues, pull requests or comments I retrieved states why activity slowed or stopped." });
    if (ctx.era && meta) {
      out.push({ kind: "interpretation", text: "What I can read is the repository as it was at this commit, not anyone's reasons or what came after, so any explanation I gave would be a guess.", cites: [meta.ref] });
    } else if (meta && ctx.repo.archived) {
      out.push({ kind: "interpretation", text: "Archiving is a choice made by a repository's owners, and the metadata I retrieved records no reason for it, so I cannot say why.", cites: [meta.ref] });
    } else if (meta && found === 0) {
      out.push({ kind: "interpretation", text: "The retrieved evidence shows the repository's state, not anyone's reasons, so any explanation I gave would be a guess.", cites: [meta.ref] });
    }
  } else if (intent === "recent") {
    out.push({ kind: "ghost", text: lines.bridge });
    for (const c of slice(commits, ctx.variant, 3)) v(`${dateOf(c.item.excerpt) ?? "Recently"}: ${quote(headlineOf(c.item.excerpt))}`, c);
    for (const p of slice([...pulls, ...issues], ctx.variant, 2)) {
      const n = numberOf(p.item.excerpt);
      if (n) v(`${p.item.kind === "issue" ? "Issue" : "Pull request"} #${n}: ${quote(titleOf(p.item.excerpt), 120)}.`, p);
    }
    if (commits.length === 0 && pulls.length + issues.length === 0) out.push({ kind: "unknown", text: "I retrieved no recent commits, issues or pull requests to describe." });
  } else if (intent === "file" && ctx.file && ctx.question && asksWhatCodeDoes(ctx.question)) {
    // what a part of the code does: without a model, only what the parser knows for certain, and the code itself
    const { path, line } = ctx.file;
    out.push({ kind: "ghost", text: lines.bridge });
    const code = refs.find((r) => r.item.kind === "file");
    const inside = code && /^inside: (.*)$/m.exec(code.item.excerpt)?.[1];
    const map = code && /^map of the file: (.*)$/m.exec(code.item.excerpt)?.[1];
    const first = code && new RegExp(`^${line ?? "\\d+"}: (.*\\S.*)$`, "m").exec(code.item.excerpt)?.[1]?.trim();
    if (code && inside) v(`${line ? `Line ${line} of ${path}` : path} is inside ${inside}.`, code);
    if (code && map) v(`The map of ${path} holds: ${map.split("; ").slice(0, 6).join("; ")}.`, code);
    if (code && first) v(`${line ? `Line ${line}` : "It"} reads ${quote(first, 140)}.`, code);
    if (!code) out.push({ kind: "unknown", text: `I could not find ${path} in this history.` });
  } else if (intent === "file" && ctx.file) {
    // one file's story, told only from what the commits and the pull request behind them say
    const { path, line } = ctx.file;
    out.push({ kind: "ghost", text: lines.bridge });
    const code = refs.find((r) => r.item.kind === "file");
    const blame = commits.find((c) => c.item.label?.startsWith("Line "));
    const touching = commits.filter((c) => c.item.label?.startsWith("Commit touching"));
    const earliest = commits.find((c) => c.item.label?.startsWith("Earliest commit"));
    const row = code && line ? new RegExp(`^${line}: (.*)$`, "m").exec(code.item.excerpt)?.[1]?.trim() : undefined;
    if (code && row) v(`Line ${line} of ${path} reads ${quote(row, 140)}.`, code);
    if (blame) {
      const d = dateOf(blame.item.excerpt);
      v(`It last changed in commit ${blame.item.revisionSha!.slice(0, 7)}, ${quote(headlineOf(blame.item.excerpt).replace(/^.*last changed by commit \w+: /, ""))}${d ? `, dated ${d}` : ""}.`, blame);
    }
    if (touching[0]) {
      const d = dateOf(touching[0].item.excerpt);
      v(`The newest change to ${path} reads ${quote(headlineOf(touching[0].item.excerpt))}${d ? `, dated ${d}` : ""}.`, touching[0]);
    }
    if (earliest && earliest.item.id !== touching[0]?.item.id) {
      const d = dateOf(earliest.item.excerpt);
      v(`The earliest commit GitHub lists for it reads ${quote(headlineOf(earliest.item.excerpt))}${d ? `, dated ${d}` : ""}.`, earliest);
    }
    const pr = pulls[0];
    const why = pr ? pr.item.excerpt.replace(/^#\d+ .*?\]\s*/, "").split(/(?<=[.!?])\s+/).find((s) => REASON_RE.test(s)) : undefined;
    if (pr) v(`It came through pull request #${numberOf(pr.item.excerpt)}, ${quote(titleOf(pr.item.excerpt), 120)}.`, pr);
    if (pr && why) v(`That pull request says ${quote(why, 200)}`, pr);
    if (!code && !touching.length) out.push({ kind: "unknown", text: `I could not find ${path} in this history.` });
    else if (!why) out.push({ kind: "unknown", text: "No commit message or pull request I read says why it was written this way." });
  } else if (intent === "history") {
    out.push({ kind: "ghost", text: lines.bridge });
    const created = meta && field(meta.item.excerpt, "created on GitHub");
    if (meta && created && created !== "unknown") v(`GitHub records this repository as created on ${created.slice(0, 10)}.`, meta);
    const early = commits.filter((c) => c.item.label?.startsWith("Early commit"));
    for (const c of slice(early, ctx.variant, 3)) {
      const d = dateOf(c.item.excerpt);
      v(`An early commit reads ${quote(headlineOf(c.item.excerpt))}${d ? `, dated ${d}` : ""}.`, c);
    }
    if (early[0]) out.push({ kind: "interpretation", text: "These are commits from near the time the repository appeared on GitHub; they are not necessarily the very first work.", cites: [early[0].ref] });
    if (!created && early.length === 0) out.push({ kind: "unknown", text: "I could not retrieve when this repository began." });
  } else if (intent === "issues") {
    out.push({ kind: "ghost", text: lines.bridge });
    const picked = slice(issues, ctx.variant, 3);
    for (const i of picked) {
      const n = numberOf(i.item.excerpt);
      const count = /(\d+) comments/.exec(i.item.excerpt)?.[1];
      const state = /\[(open|closed)/.exec(i.item.excerpt)?.[1];
      if (n) v(`Issue #${n}, ${quote(titleOf(i.item.excerpt), 120)}${state ? `, is ${state}` : ""}${count ? ` with ${count} comments` : ""}.`, i);
    }
    if (picked[0] && voice === "horror") {
      const n = Number(numberOf(picked[0].item.excerpt));
      const allowed = issues.map((x) => Number(numberOf(x.item.excerpt)));
      out.push({ kind: "ghost", text: issuePerformance(identityFromAssignment(ctx.assignment), n, allowed), cites: [picked[0].ref] });
    }
    if (comments[0]) v(`One retrieved comment reads ${quote(comments[0].item.excerpt.replace(/^Comment on #\d+ \([^)]*\): /, ""), 200)}`, comments[0]);
    if (picked.length === 0) out.push({ kind: "unknown", text: "I retrieved no issues for this repository, or issues are disabled." });
  } else {
    out.push({ kind: "ghost", text: lines.bridge });
    if (meta && ctx.era) v(`The default branch is ${field(meta.item.excerpt, "default branch") ?? "unknown"}.`, meta);
    else if (meta) v(`The default branch is ${field(meta.item.excerpt, "default branch") ?? "unknown"} and GitHub lists its main language as ${field(meta.item.excerpt, "language") ?? "unknown"}.`, meta);
    const first = readme && readme.item.excerpt.split(/(?<=[.!?])\s+/)[0];
    if (readme && first) v(`The README opens with ${quote(first)}`, readme);
    if (commits[0]) v(`The newest commit I retrieved reads ${quote(headlineOf(commits[0].item.excerpt))}.`, commits[0]);
    if (!meta && !readme && !commits[0]) out.push({ kind: "unknown", text: "I retrieved too little to say anything reliable." });
  }

  if (gaps.length) out.push({ kind: "unknown", text: `I could not read ${gaps.map((g) => g.source).join(", ")}, so this answer may be incomplete.` });
  out.push({ kind: "ghost", text: lines.closer });
  return ctx.stage && echoes(identityFromAssignment(ctx.assignment), ctx.stage) ? echoReply(out, refs, ctx.stage) : out;
}

/** “a viewer for old maps” … “old maps” … “maps”: one quote, said again shorter each time. Every echo is a substring of it. */
function echoQuote(q: string, stage: Stage): string {
  const words = q.replace(/…$/, "").split(" ");
  const tail = (n: number) => words.slice(-n).join(" ").replace(/[.,;:!?]+$/, "");
  const tails = stage === "distorted" ? [tail(Math.min(3, words.length))] : [tail(Math.min(3, words.length)), tail(1)];
  return [q, ...tails.filter((t) => t && t !== q)].map((t) => `“${t}”`).join(" … ");
}

/**
 * The changed form of a ghost that can only repeat (the Bellwraith). Quoted facts come back as echoes, and what it
 * was for (the README's first line) or a line of its code is repeated even unasked. Unquoted facts, interpretations and
 * stated gaps are left exactly as they were: the character never costs the reader a caveat.
 */
function echoReply(segments: ModelSegment[], refs: readonly EvidenceRef[], stage: Stage): ModelSegment[] {
  const out = segments
    .filter((s) => !(s.kind === "ghost" && s.cites?.length)) // its own performed lines (issuePerformance) are gone with its voice
    .map((s) => (s.kind === "verified" ? { ...s, text: s.text.replace(/“([^”]+)”/, (_, q: string) => echoQuote(q, stage)) } : s));
  const cited = new Set(out.flatMap((s) => s.cites ?? []));
  const readme = refs.find((r) => r.item.kind === "readme" && !cited.has(r.ref));
  const code = refs.find((r) => r.item.kind === "file" && !cited.has(r.ref));
  // the README's first real sentence: not a heading, badge, image or tag, and at least four words
  const purpose = readme?.item.excerpt.split(/\n+/).filter((l) => !/^\s*#/.test(l)).join("\n").split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/^[>*\s-]+/, "").trim()).find((s) => !/^[[!<]/.test(s) && s.split(/\s+/).length >= 4);
  const row = code && /^\d+: (.*\S.*)$/m.exec(code.item.excerpt)?.[1]?.trim();
  const repeat: ModelSegment | null = readme && purpose ? { kind: "verified", text: echoQuote(quote(purpose).slice(1, -1), stage), cites: [readme.ref] }
    : code && row ? { kind: "verified", text: echoQuote(quote(row, 140).slice(1, -1), stage), cites: [code.ref] } : null;
  if (repeat) out.splice(Math.min(2, out.length - 1), 0, repeat);
  return out;
}

export function createGroundedMock(ctx: GroundedMockContext): ChatProvider {
  // Resolve once so a bad assignment fails here, not halfway through composing.
  resolveEntity(identityFromAssignment(ctx.assignment));
  return {
    id: "mock",
    billable: false,
    async invoke(request: ChatRequest, opts): Promise<ChatResponse> {
      if (opts.signal.aborted) throw new DOMException("Aborted", "AbortError");
      const text = JSON.stringify({ segments: composeMockSegments(ctx) });
      return { text, usage: { inputTokens: estimateRequestTokens(request), outputTokens: estimateTokens(text) }, stopReason: "mock" };
    },
  };
}
