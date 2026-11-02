import { z } from "zod";
import { buildEvidence, type EvidenceItem } from "@/domain/evidence";
import type { RepoMetadata, SummonedRepo } from "@/domain/repo";
import type { RepoRef } from "@/domain/repo-ref";
import { deriveStatus } from "@/domain/status";
import { GitHubError, githubGet, githubGetWithHeaders, type GitHubDeps } from "@/server/github/client";
import { cleanUntrustedText, fetchReadme, lookupRepository } from "@/server/github/summon";
import type { Intent } from "./intent";
import { sharedEvidenceCache, type EvidenceCache, type Gap, type Retrieved, type RetrieveDeps, type RetrieveFailure } from "./retrieve";

/**
 * Time Travel retrieval: evidence as it stood at one commit.
 *
 * Rules that make the answer historical rather than a present-day answer wearing an old costume:
 *  - Commits come from `commits?sha=<SHA>`, so only that commit and its ancestors are ever read.
 *  - The README is read at that SHA, not at HEAD.
 *  - Present-day repository facts (archived flag, stars, last push, language) are NOT evidence of the
 *    past and are left out. Only the name, the default branch name and the creation date are kept.
 *  - Issues and pull requests come from a search limited to `created:<=` the commit time. Their state is
 *    reconstructed as of that time (closed later means still open then), comment counts are dropped, and
 *    bodies are dropped because they may have been edited since. Titles can also have been edited; the
 *    limitation is documented.
 *  - A last defensive pass drops any commit, issue or pull request whose excerpt shows a date after the commit.
 * Authors are never read.
 */
const SHA_RE = /^[0-9a-f]{40}$/;
const clip = (text: string | null | undefined, max: number) => cleanUntrustedText(text ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const iso = (v: string | null | undefined) => {
  const t = v ? Date.parse(v) : NaN;
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

const RawCommits = z.array(
  z.object({
    sha: z.string().regex(SHA_RE),
    commit: z.object({
      message: z.string(),
      committer: z.object({ date: z.string().nullable().optional() }).nullable().optional(),
      author: z.object({ date: z.string().nullable().optional() }).nullable().optional(),
    }),
  }),
);
const RawSearch = z.object({
  items: z.array(
    z.object({
      number: z.number().int().positive(),
      title: z.string(),
      state: z.string(),
      created_at: z.string().nullable().optional(),
      closed_at: z.string().nullable().optional(),
      pull_request: z.object({ merged_at: z.string().nullable().optional() }).passthrough().optional(),
    }),
  ),
});

const repoPath = (repo: RepoMetadata) => `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;

function commitEvidence(repo: RepoMetadata, retrievedAt: string, raw: z.infer<typeof RawCommits>, label: string): EvidenceItem[] {
  return raw.map((c) => {
    const date = iso(c.commit.committer?.date ?? c.commit.author?.date);
    return buildEvidence({
      repoId: repo.repoId,
      kind: "commit",
      sourceUrl: `${repo.htmlUrl}/commit/${c.sha}`,
      label: `${label} ${c.sha.slice(0, 7)}`,
      revisionSha: c.sha,
      retrievedAt,
      excerpt: `${clip(c.commit.message.split("\n")[0], 200)}${date ? ` (committed ${date})` : ""}`,
      truncated: false,
    });
  });
}

/** Issues and pull requests that existed at `asOf`, with their state at that moment. */
function threadEvidence(repo: RepoMetadata, retrievedAt: string, asOfMs: number, raw: z.infer<typeof RawSearch>["items"], count: number): { issues: EvidenceItem[]; pulls: EvidenceItem[] } {
  const issues: EvidenceItem[] = [];
  const pulls: EvidenceItem[] = [];
  for (const i of raw) {
    const created = iso(i.created_at);
    if (!created || Date.parse(created) > asOfMs) continue;
    const isPr = i.pull_request !== undefined;
    const closed = iso(i.closed_at);
    const merged = iso(i.pull_request?.merged_at);
    let state = "open";
    if (merged && Date.parse(merged) <= asOfMs) state = `merged ${merged}`;
    else if (closed && Date.parse(closed) <= asOfMs) state = `closed ${closed}`;
    const title = clip(i.title, 160);
    const item = buildEvidence({
      repoId: repo.repoId,
      kind: isPr ? "pull-request" : "issue",
      sourceUrl: `${repo.htmlUrl}/${isPr ? "pull" : "issues"}/${i.number}`,
      label: `${isPr ? "Pull request" : "Issue"} #${i.number}`,
      retrievedAt,
      excerpt: `#${i.number} ${title} [${state.startsWith("open") ? "open" : state.split(" ")[0]}, opened ${created}${state.includes(" ") ? `, ${state}` : ""}]`,
      truncated: false,
    });
    (isPr ? pulls : issues).push(item);
  }
  return { issues: issues.slice(0, count), pulls: pulls.slice(0, count) };
}

const ISO_IN_TEXT = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g;
/** Defensive: drop any dated item that mentions a moment after the selected commit. */
export function dropFuture(items: EvidenceItem[], asOfMs: number): EvidenceItem[] {
  return items.filter((i) => {
    if (i.kind !== "commit" && i.kind !== "issue" && i.kind !== "pull-request") return true;
    return !(i.excerpt.match(ISO_IN_TEXT) ?? []).some((d) => Date.parse(d) > asOfMs);
  });
}

const gapFrom = (source: string, err: unknown): Gap =>
  err instanceof GitHubError ? { source, code: err.code, message: err.message } : { source, code: "error", message: "This source could not be read." };

async function task<T>(source: string, gaps: Gap[], fallback: T, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    gaps.push(gapFrom(source, err));
    return fallback;
  }
}

export type EraRetrieved = Retrieved & { asOf: { sha: string; shortSha: string; date: string } };
export type EraFailure = RetrieveFailure;

export async function retrieveEvidenceAsOf(ref: RepoRef, intent: Intent, asOfSha: string, deps: RetrieveDeps = {}): Promise<EraRetrieved | EraFailure> {
  if (!SHA_RE.test(asOfSha)) return { ok: false, code: "bad_era", message: "That commit reference is not valid." };
  const cache: EvidenceCache = deps.cache ?? sharedEvidenceCache();
  const cacheKey = `${ref.owner.toLowerCase()}/${ref.repo.toLowerCase()}:${intent}:asof:${asOfSha}`;
  const hit = cache.get(cacheKey) as EraRetrieved | undefined;
  if (hit) return hit;

  const gdeps: GitHubDeps = deps.github ?? {};
  const retrievedAt = (deps.now ?? (() => new Date()))().toISOString();
  let repo: RepoMetadata;
  try {
    repo = await lookupRepository(ref, gdeps);
  } catch (err) {
    if (err instanceof GitHubError) return { ok: false, code: err.code, message: err.message, resetAt: err.resetAt };
    throw err;
  }

  // The selected commit and its ancestors. The first entry must be the commit itself.
  const countByIntent = intent === "recent" ? 8 : intent === "status" ? 6 : 5;
  let commits: z.infer<typeof RawCommits>;
  try {
    commits = await githubGet(`${repoPath(repo)}/commits?sha=${asOfSha}&per_page=${countByIntent}`, RawCommits, gdeps);
  } catch (err) {
    if (err instanceof GitHubError && (err.code === "not_found" || err.status === 422)) return { ok: false, code: "era_not_found", message: "That commit was not found in this repository." };
    if (err instanceof GitHubError) return { ok: false, code: err.code, message: err.message, resetAt: err.resetAt };
    throw err;
  }
  const anchor = commits[0];
  const asOfIso = iso(anchor?.commit.committer?.date ?? anchor?.commit.author?.date);
  if (!anchor || anchor.sha !== asOfSha || !asOfIso) return { ok: false, code: "era_not_found", message: "That commit could not be read, so its time cannot be established." };
  const asOfMs = Date.parse(asOfIso);
  const gaps: Gap[] = [];

  const meta = buildEvidence({
    repoId: repo.repoId,
    kind: "repo-metadata",
    sourceUrl: repo.htmlUrl,
    revisionSha: asOfSha,
    retrievedAt,
    excerpt: [repo.fullName, `default branch: ${repo.defaultBranch}`, `created on GitHub: ${repo.createdAt ?? "unknown"}`, `selected era: commit ${asOfSha.slice(0, 7)}, ${asOfIso}`].join("\n"),
    truncated: false,
  });

  const readme = await task("README", gaps, null, () => fetchReadme(repo, asOfSha, gdeps));
  if (!readme && !gaps.some((g) => g.source === "README")) gaps.push({ source: "README", code: "not_found", message: "This repository had no README at that commit." });
  const readmeItem = readme
    ? buildEvidence({ repoId: repo.repoId, kind: "readme", sourceUrl: readme.htmlUrl, revisionSha: asOfSha, retrievedAt, excerpt: readme.excerpt, truncated: readme.truncated })
    : null;

  const base = commitEvidence(repo, retrievedAt, commits, "Commit");
  let extra: EvidenceItem[] = [];
  if (intent === "history") {
    const until = new Date(Math.min(asOfMs, repo.createdAt ? Date.parse(repo.createdAt) + 90 * 86_400_000 : asOfMs)).toISOString();
    const early = await task("early commits", gaps, [] as z.infer<typeof RawCommits>, () => githubGet(`${repoPath(repo)}/commits?sha=${asOfSha}&until=${encodeURIComponent(until)}&per_page=6`, RawCommits, gdeps));
    extra = commitEvidence(repo, retrievedAt, early, "Early commit");
  } else if (intent === "status" || intent === "recent" || intent === "issues") {
    const sort = intent === "recent" ? "created" : "comments";
    const q = encodeURIComponent(`repo:${repo.owner}/${repo.name} created:<=${asOfIso}`);
    const found = await task("issues and pull requests", gaps, [] as z.infer<typeof RawSearch>["items"], async () =>
      (await githubGetWithHeaders(`/search/issues?q=${q}&sort=${sort}&order=desc&per_page=30`, RawSearch, gdeps)).data.items,
    );
    const t = threadEvidence(repo, retrievedAt, asOfMs, found, intent === "recent" ? 6 : 8);
    extra = [...t.issues, ...t.pulls];
  }

  const items = dropFuture([...new Map([meta, ...(readmeItem ? [readmeItem] : []), ...base, ...extra].map((i) => [i.id, i])).values()], asOfMs);
  const latest = commits[0];
  const summoned: SummonedRepo = {
    repo,
    latestCommit: { sha: latest.sha, htmlUrl: `${repo.htmlUrl}/commit/${latest.sha}`, messageHeadline: clip(latest.commit.message.split("\n")[0], 200), committedAt: asOfIso },
    readme,
    evidence: items,
    retrievedAt,
    status: deriveStatus(false, asOfIso, new Date(asOfMs)),
    sections: { commit: { state: "ok" }, readme: readme ? { state: "ok" } : { state: "empty" } },
  };
  const result: EraRetrieved = { ok: true, repo, base: summoned, items, gaps, intent, asOf: { sha: asOfSha, shortSha: asOfSha.slice(0, 7), date: asOfIso } };
  if (!gaps.some((g) => ["rate_limited", "network", "timeout", "upstream", "error"].includes(g.code))) cache.set(cacheKey, result);
  return result;
}
