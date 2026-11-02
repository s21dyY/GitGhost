import type { EvidenceItem } from "@/domain/evidence";
import type { RepoMetadata, SummonedRepo } from "@/domain/repo";
import type { RepoRef } from "@/domain/repo-ref";
import { GitHubError, type GitHubDeps } from "@/server/github/client";
import { summonRepository } from "@/server/github/summon";
import { fetchEarlyCommits, fetchIssueComments, fetchIssues, fetchPulls, fetchRecentCommits, type FetchCtx } from "./github-evidence";
import { fileEvidence } from "./file";
import { STATUS_NOTICE_RE, type FileRef, type Intent } from "./intent";

/**
 * Selective, bounded retrieval. At most 3 base calls + 4 intent calls per cold question; results
 * are cached briefly in process memory. Missing, deleted or rate-limited sources become `gaps`
 * that the answer must admit, never silent omissions.
 */
export type Gap = { source: string; code: string; message: string };

export type Retrieved = {
  ok: true;
  repo: RepoMetadata;
  base: SummonedRepo;
  /** Deduplicated, base evidence first. */
  items: EvidenceItem[];
  gaps: Gap[];
  intent: Intent;
};
export type RetrieveFailure = { ok: false; code: string; message: string; resetAt?: string };

export type RetrieveDeps = { github?: GitHubDeps; now?: () => Date; cache?: EvidenceCache };

type CacheEntry = { at: number; value: Retrieved };
export type EvidenceCache = { get(key: string): Retrieved | undefined; set(key: string, v: Retrieved): void; size(): number };

export function createEvidenceCache(opts: { ttlMs?: number; max?: number; now?: () => number } = {}): EvidenceCache {
  const ttl = opts.ttlMs ?? 10 * 60_000;
  const max = opts.max ?? 100;
  const now = opts.now ?? Date.now;
  const map = new Map<string, CacheEntry>();
  return {
    get(k) {
      const e = map.get(k);
      if (!e) return undefined;
      if (now() - e.at > ttl) {
        map.delete(k);
        return undefined;
      }
      return e.value;
    },
    set(k, v) {
      map.delete(k);
      map.set(k, { at: now(), value: v });
      while (map.size > max) map.delete(map.keys().next().value as string);
    },
    size: () => map.size,
  };
}

const KEY = Symbol.for("gitghost.evidenceCache");
type G = typeof globalThis & { [KEY]?: EvidenceCache };
export const sharedEvidenceCache = (): EvidenceCache => ((globalThis as G)[KEY] ??= createEvidenceCache());

const gapFrom = (source: string, err: unknown): Gap => {
  if (err instanceof GitHubError) return { source, code: err.code, message: err.message };
  return { source, code: "error", message: "This source could not be read." };
};

async function task(source: string, gaps: Gap[], run: () => Promise<EvidenceItem[]>): Promise<EvidenceItem[]> {
  try {
    return await run();
  } catch (err) {
    gaps.push(gapFrom(source, err));
    return [];
  }
}

const dedupe = (items: EvidenceItem[]) => [...new Map(items.map((i) => [i.id, i])).values()];

/** A file key for caches: path plus line range, so two questions about different lines never share evidence. */
export const fileKey = (file?: FileRef | null) => (file ? `:${file.path}:${file.line ?? ""}-${file.endLine ?? ""}` : "");

export async function retrieveEvidence(ref: RepoRef, intent: Intent, deps: RetrieveDeps = {}, file?: FileRef | null): Promise<Retrieved | RetrieveFailure> {
  const cache = deps.cache ?? sharedEvidenceCache();
  const cacheKey = `${ref.owner.toLowerCase()}/${ref.repo.toLowerCase()}:${intent}${intent === "file" ? fileKey(file) : ""}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;

  const gdeps = deps.github ?? {};
  const base = await summonRepository(ref, { ...gdeps, now: deps.now });
  if (!base.ok) return { ok: false, code: base.error.code, message: base.error.message, resetAt: base.error.resetAt };

  const { repo, retrievedAt } = base.data;
  const ctx: FetchCtx = { repo, retrievedAt, deps: gdeps };
  const gaps: Gap[] = [];
  if (base.data.sections.commit.state === "error") gaps.push({ source: "latest commit", code: base.data.sections.commit.code, message: base.data.sections.commit.message });
  if (base.data.sections.readme.state === "error") gaps.push({ source: "README", code: base.data.sections.readme.code, message: base.data.sections.readme.message });
  if (base.data.sections.readme.state === "empty") gaps.push({ source: "README", code: "not_found", message: "This repository has no README." });

  let extra: EvidenceItem[][] = [];
  switch (intent) {
    case "status": {
      const [commits, issues, pulls] = await Promise.all([
        task("recent commits", gaps, () => fetchRecentCommits(ctx, 6)),
        task("issues", gaps, async () => {
          const r = await fetchIssues(ctx, { sort: "comments", count: 8 });
          return [...r.issues, ...r.pulls];
        }),
        task("pull requests", gaps, () => fetchPulls(ctx, 8)),
      ]);
      // One follow-up call: comments of the thread most likely to be a status notice.
      const threads = [...issues, ...pulls].filter((i) => i.kind === "issue");
      const best = threads.find((i) => STATUS_NOTICE_RE.test(i.excerpt)) ?? threads[0];
      const n = best ? Number(/#(\d+)/.exec(best.excerpt)?.[1]) : NaN;
      const comments = Number.isInteger(n) ? await task("issue comments", gaps, () => fetchIssueComments(ctx, n, 5)) : [];
      extra = [commits, issues, pulls, comments];
      break;
    }
    case "recent": {
      const [commits, pulls, issues] = await Promise.all([
        task("recent commits", gaps, () => fetchRecentCommits(ctx, 8)),
        task("pull requests", gaps, () => fetchPulls(ctx, 6)),
        task("issues", gaps, async () => (await fetchIssues(ctx, { sort: "updated", count: 6 })).issues),
      ]);
      extra = [commits, pulls, issues];
      break;
    }
    case "history":
      extra = [await task("early commits", gaps, () => fetchEarlyCommits(ctx, 6))];
      break;
    case "issues": {
      const [byComments, byUpdated] = await Promise.all([
        task("issues", gaps, async () => (await fetchIssues(ctx, { sort: "comments", count: 8 })).issues),
        task("recent issues", gaps, async () => (await fetchIssues(ctx, { sort: "updated", count: 6 })).issues),
      ]);
      const top = byComments[0];
      const n = top ? Number(/#(\d+)/.exec(top.excerpt)?.[1]) : NaN;
      const comments = Number.isInteger(n) ? await task("issue comments", gaps, () => fetchIssueComments(ctx, n, 4)) : [];
      extra = [byComments, byUpdated, comments];
      break;
    }
    case "file":
      // one file's story; without a usable path this falls back to the general question
      extra = file ? [await fileEvidence(ctx, file, repo.defaultBranch, gaps, gdeps)] : [await task("recent commits", gaps, () => fetchRecentCommits(ctx, 5))];
      break;
    default:
      extra = [await task("recent commits", gaps, () => fetchRecentCommits(ctx, 5))];
  }

  const result: Retrieved = { ok: true, repo, base: base.data, items: dedupe([...base.data.evidence, ...extra.flat()]), gaps, intent };
  // Transient failures are not cached, so the next question can try again.
  if (!gaps.some((g) => ["rate_limited", "network", "timeout", "upstream", "error"].includes(g.code))) cache.set(cacheKey, result);
  return result;
}
