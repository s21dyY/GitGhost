import { z } from "zod";
import type { RepoMetadata } from "@/domain/repo";
import { GitHubError, githubGetWithHeaders, type GitHubDeps } from "./client";
import { cleanUntrustedText } from "./summon";

/**
 * Real commit history for Time Travel. Bounded: at most three GitHub calls (the newest 100 commits,
 * the page count from the Link header, and the oldest page). Authors are never read: this is about the
 * repository's changes, not about people. Every URL is built here from the numeric-checked repo name and
 * a 40-hex SHA, never copied from the API.
 *
 * History is "complete" only when every commit was fetched (up to 200). Longer histories are SAMPLED
 * from the newest and the oldest pages, and the result says so, with the exact total (the last page
 * tells us). Nothing between the two ends is invented.
 */
export const MAX_ERAS = 12;
const PAGE = 100;

const RawHistory = z.array(
  z.object({
    sha: z.string().regex(/^[0-9a-f]{40}$/),
    commit: z.object({
      message: z.string(),
      committer: z.object({ date: z.string().nullable().optional() }).nullable().optional(),
      author: z.object({ date: z.string().nullable().optional() }).nullable().optional(),
    }),
  }),
);

export type HistoryCommit = {
  sha: string;
  shortSha: string;
  /** ISO timestamp, or null if GitHub gave none that parses. */
  date: string | null;
  headline: string;
  url: string;
};

export type History = {
  /** Oldest first. At most MAX_ERAS entries. */
  commits: HistoryCommit[];
  /** Every commit of the default branch is in the list (history is short enough to read in full). */
  complete: boolean;
  /** Exact number of commits on the default branch when known (from the last page), else null. */
  total: number | null;
  /** Plain-words explanation when the list is not the whole history. */
  note: string | null;
};

const iso = (v: string | null | undefined) => {
  const t = v ? Date.parse(v) : NaN;
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

/** Page number of rel="last" in a GitHub Link header, or 1 when there is none. */
export function lastPageFromLink(link: string | null): number {
  if (!link) return 1;
  for (const part of link.split(",")) {
    if (!/rel="last"/.test(part)) continue;
    const n = Number(/[?&]page=(\d+)/.exec(part)?.[1]);
    if (Number.isInteger(n) && n >= 1 && n <= 100_000) return n;
  }
  return 1;
}

/** `count` indexes spread evenly over 0..length-1, always including both ends. */
export function spread(length: number, count: number): number[] {
  if (length <= count) return Array.from({ length }, (_, i) => i);
  const out = new Set<number>();
  for (let i = 0; i < count; i++) out.add(Math.round((i * (length - 1)) / (count - 1)));
  return [...out].sort((a, b) => a - b);
}

function toCommit(repo: RepoMetadata, c: z.infer<typeof RawHistory>[number]): HistoryCommit {
  const headline = cleanUntrustedText(c.commit.message.split("\n")[0] ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  return {
    sha: c.sha,
    shortSha: c.sha.slice(0, 7),
    date: iso(c.commit.committer?.date ?? c.commit.author?.date),
    headline: headline || "(no message)",
    url: `${repo.htmlUrl}/commit/${c.sha}`,
  };
}

export async function fetchHistory(repo: RepoMetadata, deps: GitHubDeps = {}): Promise<History> {
  const path = `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/commits?sha=${encodeURIComponent(repo.defaultBranch)}&per_page=${PAGE}`;
  let first;
  try {
    first = await githubGetWithHeaders(`${path}&page=1`, RawHistory, deps);
  } catch (err) {
    if (err instanceof GitHubError && err.code === "empty_repository") return { commits: [], complete: true, total: 0, note: "This repository has no commits." };
    throw err;
  }
  const newest = first.data; // newest first
  const pages = lastPageFromLink(first.headers.get("link"));
  if (pages === 1) {
    return { commits: pickAll(repo, [...newest].reverse()), complete: true, total: newest.length, note: newest.length > MAX_ERAS ? sampledNote(newest.length, MAX_ERAS, false) : null };
  }
  const last = (await githubGetWithHeaders(`${path}&page=${pages}`, RawHistory, deps)).data; // the oldest page, newest first
  const total = (pages - 1) * PAGE + last.length;
  if (pages === 2) {
    const all = [...newest, ...last].reverse();
    return { commits: pickAll(repo, all), complete: true, total, note: all.length > MAX_ERAS ? sampledNote(all.length, MAX_ERAS, false) : null };
  }
  // Long history: the oldest and the newest chunk only. The middle is not read and not shown.
  const oldChunk = [...last].reverse();
  const newChunk = [...newest].reverse();
  const half = MAX_ERAS / 2;
  const a = spread(oldChunk.length, half).map((i) => oldChunk[i]);
  const b = spread(newChunk.length, half).map((i) => newChunk[i]);
  return { commits: [...a, ...b].map((c) => toCommit(repo, c)), complete: false, total, note: sampledNote(total, a.length + b.length, true) };
}

function pickAll(repo: RepoMetadata, chronological: z.infer<typeof RawHistory>): HistoryCommit[] {
  return spread(chronological.length, MAX_ERAS).map((i) => toCommit(repo, chronological[i]));
}

function sampledNote(total: number, shown: number, gap: boolean): string {
  return gap
    ? `This repository has ${total} commits. GitGhost read the oldest and the newest of them and shows ${shown}; the commits in between were not read.`
    : `This repository has ${total} commits. ${shown} evenly spaced ones are shown.`;
}

/**
 * Short-lived process cache so a refresh or a second visitor does not re-read the same pages. Only successful
 * reads are kept; a failure is retried next time. The key includes the numeric repository id and the branch.
 */
type CacheEntry = { at: number; value: History };
const CACHE = Symbol.for("gitghost.historyCache");
type G = typeof globalThis & { [CACHE]?: Map<string, CacheEntry> };
export async function fetchHistoryCached(repo: RepoMetadata, deps: GitHubDeps = {}, opts: { ttlMs?: number; now?: () => number } = {}): Promise<History> {
  const cache = ((globalThis as G)[CACHE] ??= new Map());
  const now = (opts.now ?? Date.now)();
  const key = `${repo.repoId}:${repo.defaultBranch}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < (opts.ttlMs ?? 5 * 60_000)) return hit.value;
  const value = await fetchHistory(repo, deps);
  cache.set(key, { at: now, value });
  while (cache.size > 50) cache.delete(cache.keys().next().value as string);
  return value;
}

/** Test helper: forget cached histories. */
export function clearHistoryCacheForTests(): void {
  (globalThis as G)[CACHE]?.clear();
}
