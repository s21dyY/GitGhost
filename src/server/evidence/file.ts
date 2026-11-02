import { buildEvidence, type EvidenceItem } from "@/domain/evidence";
import { githubBlame, type GitHubDeps } from "@/server/github/client";
import { cleanUntrustedText } from "@/server/github/summon";
import { fetchCommitPulls, fetchFileCommits, fetchFileReading, type FetchCtx } from "./github-evidence";
import type { FileRef } from "./intent";
import type { Gap } from "./retrieve";

/**
 * Evidence for "why is this file (or this line) the way it is?". Bounded: at most five GitHub requests on top
 * of the base summon, and fewer when the file has a short history or no line was named:
 *   1. commits that touched the path (newest first)           always
 *   2. the last page of that list, for the earliest commits      only when the history has more than one page
 *   3. the code around the line (or the top of the file)        always
 *   4. line blame: the commit that last changed that line       only with a line and a GitHub token (GraphQL)
 *   5. the pull request behind the most telling commit          when there is a commit to ask about
 * Missing or failing sources become gaps the answer must admit. Nothing here decides why anything happened:
 * a reason is only ever quoted from a commit message or a pull request that states one.
 */
export async function fileEvidence(ctx: FetchCtx, file: FileRef, at: string, gaps: Gap[], deps: GitHubDeps): Promise<EvidenceItem[]> {
  const run = async <T,>(source: string, fallback: T, fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      const code = (err as { code?: string }).code ?? "error";
      gaps.push({ source, code, message: code === "not_found" ? `GitHub has no record of ${file.path} here.` : `${source} could not be read.` });
      return fallback;
    }
  };
  const [history, reading, blame] = await Promise.all([
    run(`history of ${file.path}`, { newest: [] as EvidenceItem[], earliest: [] as EvidenceItem[] }, () => fetchFileCommits(ctx, file.path, at)),
    run(`code of ${file.path}`, [] as EvidenceItem[], () => fetchFileReading(ctx, file.path, at, { line: file.line, endLine: file.endLine }, file.whole === true)),
    file.line ? run(`line history of ${file.path}`, null, () => githubBlame({ owner: ctx.repo.owner, name: ctx.repo.name, at, path: file.path }, deps)) : Promise.resolve(null),
  ]);
  if (!history.newest.length && !reading.length) {
    if (!gaps.some((g) => g.source.endsWith(file.path))) gaps.push({ source: `history of ${file.path}`, code: "not_found", message: `No commit in this history touches ${file.path}.` });
    return [];
  }
  // Order is what survives a tight budget: the code asked about, the commit that last changed it, the rest of the file
  // (for "what does this do"), then the file's history and the pull request behind it.
  const focus = reading.filter((r) => !/\((context|skeleton)\)$/.test(r.label ?? ""));
  const context = reading.filter((r) => /\((context|skeleton)\)$/.test(r.label ?? ""));
  const items: EvidenceItem[] = [...focus];
  // the commit that last changed the named line, from blame
  let key: string | undefined;
  const range = file.line && blame ? blame.find((r) => r.start <= file.line! && file.line! <= r.end) : undefined;
  if (range) {
    key = range.sha;
    const headline = cleanUntrustedText(range.headline).replace(/\s+/g, " ").slice(0, 200);
    const date = Number.isNaN(Date.parse(range.date)) ? "" : new Date(range.date).toISOString();
    items.push(buildEvidence({
      repoId: ctx.repo.repoId,
      kind: "commit",
      sourceUrl: `${ctx.repo.htmlUrl}/commit/${range.sha}`,
      label: `Line ${file.line} last changed in ${range.sha.slice(0, 7)}`,
      revisionSha: range.sha,
      retrievedAt: ctx.retrievedAt,
      excerpt: `line ${file.line} of ${file.path} (lines ${range.start}–${range.end}) last changed by commit ${range.sha.slice(0, 7)}: ${headline}${date ? ` (committed ${date})` : ""}`,
      truncated: false,
    }));
  } else if (file.line && blame === null && !(deps.token ?? process.env.GITHUB_TOKEN)) {
    gaps.push({ source: `line history of ${file.path}`, code: "unavailable", message: "Line-by-line history needs a GitHub token on the server." });
  }
  items.push(...context, ...history.newest.slice(0, 5), ...history.earliest);
  // the pull request behind the most telling commit: the one that changed the line, else the newest one
  key ??= history.newest[0]?.revisionSha;
  if (key) items.push(...(await run(`pull request behind ${key.slice(0, 7)}`, [] as EvidenceItem[], () => fetchCommitPulls(ctx, key!, 1))));
  return items;
}
