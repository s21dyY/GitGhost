import { z } from "zod";
import type { RepoMetadata } from "@/domain/repo";
import { githubGet, type GitHubDeps } from "./client";
import { isSafePath } from "./code";
import { cleanUntrustedText } from "./summon";

/**
 * "Where else is this used?": GitHub code search inside ONE repository, read-only. No model is involved: the result is
 * GitHub's own list of files. GitHub searches the default branch only (never an older commit), requires a token, and
 * allows about ten searches a minute, so results are cached and the caller rate-limits.
 *
 * The term is an identifier (letters, digits, _ $ and dots), never free text, so no search operator can be smuggled in;
 * the query is always scoped to the repository.
 */
/** `archived`: GitHub's code search often does not cover archived repositories (atom/atom returns nothing at all). */
export type CodeSearch = { term: string; total: number; paths: string[]; branch: string; archived: boolean };

const TERM = /^[A-Za-z_$][\w$.]{1,79}$/;
export const isSearchTerm = (t: string) => TERM.test(t);
const MAX_RESULTS = 20;

const RawSearch = z.object({ total_count: z.number().int().nonnegative(), items: z.array(z.object({ path: z.string() })) });

type Entry = { at: number; value: CodeSearch };
const CACHE = Symbol.for("gitghost.codeSearchCache");
type G = typeof globalThis & { [CACHE]?: Map<string, Entry> };
export function clearCodeSearchCacheForTests(): void {
  (globalThis as G)[CACHE]?.clear();
}

export async function searchCode(repo: RepoMetadata, term: string, deps: GitHubDeps = {}, now = Date.now()): Promise<CodeSearch> {
  if (!isSearchTerm(term)) throw new Error("Not a searchable name.");
  const cache = ((globalThis as G)[CACHE] ??= new Map());
  const key = `${repo.repoId}:${term}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < 10 * 60_000) return hit.value;
  const q = encodeURIComponent(`"${term}" repo:${repo.owner}/${repo.name}`);
  const raw = await githubGet(`/search/code?q=${q}&per_page=${MAX_RESULTS}`, RawSearch, deps);
  const paths = [...new Set(raw.items.map((i) => cleanUntrustedText(i.path)).filter(isSafePath))].slice(0, MAX_RESULTS);
  const value: CodeSearch = { term, total: raw.total_count, paths, branch: repo.defaultBranch, archived: repo.archived === true };
  cache.set(key, { at: now, value });
  while (cache.size > 200) cache.delete(cache.keys().next().value as string);
  return value;
}
