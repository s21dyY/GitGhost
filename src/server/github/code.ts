import { z } from "zod";
import type { CodeFile, CodeTree } from "@/domain/code";
import type { RepoRef } from "@/domain/repo-ref";
import type { RepoMetadata } from "@/domain/repo";
import { outlineFor } from "@/server/code/outline";
import { githubGet, type GitHubDeps } from "./client";
import { cleanUntrustedText, lookupRepository } from "./summon";

/**
 * The ghost's body: its file list and the code of one file, read from GitHub for the code viewer ("Possession").
 * Display only: the chat still reads its own bounded evidence for answers. At most two GitHub requests per view
 * (the whole tree in one, then one file), kept in a short process cache. Everything read is untrusted text.
 */

/** Folders and files a visitor never needs to read: dependencies, builds, binaries, lockfiles, minified code. */
const SKIP_DIR = /(^|\/)(node_modules|vendor|third_party|bower_components|dist|build|out|coverage|\.git|__pycache__|\.yarn|\.next)\//;
const SKIP_FILE = /(\.(png|jpe?g|gif|ico|svg|webp|bmp|tiff?|pdf|zip|gz|tgz|bz2|7z|rar|jar|war|class|woff2?|ttf|otf|eot|mp3|mp4|m4a|wav|ogg|webm|mov|avi|exe|dll|so|dylib|a|o|bin|dat|db|sqlite|psd|ai|sketch|map)|\.min\.(js|css)|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|composer\.lock|Gemfile\.lock|poetry\.lock))$/i;
export const MAX_PATHS = 4000;
export const MAX_LINES = 2000;
const MAX_LINE_CHARS = 400;

/** A path a visitor may ask for: relative, no "." or ".." segments, no empty segments, not absurdly long. */
export function isSafePath(path: string): boolean {
  return path.length > 0 && path.length <= 300 && !path.startsWith("/") && !path.split("/").some((s) => s === "" || s === "." || s === "..");
}
export const isSha = (s: string) => /^[0-9a-f]{40}$/.test(s);

const RawTree = z.object({
  truncated: z.boolean().optional(),
  tree: z.array(z.object({ path: z.string(), type: z.string(), size: z.number().int().nonnegative().optional() })),
});
const RawContent = z.object({ type: z.string(), encoding: z.string().optional(), size: z.number().int().nonnegative(), content: z.string().optional(), html_url: z.string().nullable().optional() });
const repoPath = (repo: RepoMetadata) => `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

/** Short-lived process cache (successful reads only), shared across route bundles like the history cache. */
type Entry = { at: number; value: unknown };
const CACHE = Symbol.for("gitghost.codeCache");
type G = typeof globalThis & { [CACHE]?: Map<string, Entry> };
async function cached<T>(key: string, ttlMs: number, read: () => Promise<T>, now = Date.now()): Promise<T> {
  const cache = ((globalThis as G)[CACHE] ??= new Map());
  const hit = cache.get(key);
  if (hit && now - hit.at < ttlMs) return hit.value as T;
  const value = await read();
  cache.set(key, { at: now, value });
  while (cache.size > 200) cache.delete(cache.keys().next().value as string);
  return value;
}
export function clearCodeCacheForTests(): void {
  (globalThis as G)[CACHE]?.clear();
}

export async function repoFor(ref: RepoRef, deps: GitHubDeps = {}): Promise<RepoMetadata> {
  return cached(`repo:${ref.owner.toLowerCase()}/${ref.repo.toLowerCase()}`, 10 * 60_000, () => lookupRepository(ref, deps));
}

/** Every readable file of the repository at `at` (a commit SHA, or the default branch), in GitHub's order. */
export async function fetchCodeTree(repo: RepoMetadata, at: string | null, deps: GitHubDeps = {}): Promise<CodeTree> {
  const ref = at ?? repo.defaultBranch;
  return cached(`tree:${repo.repoId}:${ref}`, 10 * 60_000, async () => {
    const raw = await githubGet(`${repoPath(repo)}/git/trees/${encodeURIComponent(ref)}?recursive=1`, RawTree, deps);
    const files = raw.tree.filter((e) => e.type === "blob" && isSafePath(e.path) && !SKIP_DIR.test(e.path) && !SKIP_FILE.test(e.path)).map((e) => cleanUntrustedText(e.path));
    return { at: ref, paths: files.slice(0, MAX_PATHS), truncated: raw.truncated === true || files.length > MAX_PATHS };
  });
}

/** One file's code at `at`, line by line, cleaned. Null for a binary or a file too large to show. */
export async function fetchCodeFile(repo: RepoMetadata, path: string, at: string | null, deps: GitHubDeps = {}): Promise<CodeFile | null> {
  const ref = at ?? repo.defaultBranch;
  return cached(`file:${repo.repoId}:${ref}:${path}`, 10 * 60_000, async () => {
    const raw = await githubGet(`${repoPath(repo)}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`, RawContent, deps);
    if (raw.type !== "file" || raw.encoding !== "base64" || !raw.content || raw.size > 1_000_000) return null;
    const text = Buffer.from(raw.content, "base64").toString("utf8");
    if (text.includes("\u0000")) return null; // binary
    const all = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
    const lines = all.slice(0, MAX_LINES).map((l) => cleanUntrustedText(l).replace(/\t/g, "  ").slice(0, MAX_LINE_CHARS));
    const outline = await outlineFor(path, all.join("\n"));
    return { path, at: ref, lines, total: all.length, truncated: all.length > MAX_LINES, url: `${repo.htmlUrl}/blob/${encodeURIComponent(ref)}/${encodePath(path)}`, outline };
  });
}
