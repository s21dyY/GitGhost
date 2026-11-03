import type { CodeFile, CodeTree } from "@/domain/code";
import { approximateOutline } from "@/domain/outline";
import { detectFileRef } from "@/server/evidence/intent";
import type { GameData } from "./data";
import { MOCK_CODE } from "./fixtures";

/**
 * Possession: the visitor opens the ghost's body (its files) and reads its code. Where the code comes from (the
 * live API, or the offline demo's invented fixture), how the file list is ordered, and the questions the ghost
 * can be asked about a file. The questions go through the normal chat pipeline, so every answer stays grounded.
 */
export type CodeResult<T> = { ok: true; value: T } | { ok: false; message: string };

async function get<T>(params: Record<string, string>, key: "tree" | "file" | "search"): Promise<CodeResult<T>> {
  try {
    const res = await fetch(`/api/code?${new URLSearchParams(params)}`, { cache: "no-store" });
    const body = (await res.json()) as { ok: boolean; message?: string } & Record<string, unknown>;
    return body.ok ? { ok: true, value: body[key] as T } : { ok: false, message: body.message ?? "The code could not be read." };
  } catch {
    return { ok: false, message: "Could not reach GitGhost. Check your connection and try again." };
  }
}

/** GitHub code search inside the repository (default branch only). Live repositories only. */
export type CodeSearchResult = { term: string; total: number; paths: string[]; branch: string; archived: boolean };
export type CodeSource = {
  tree: (at: string | null) => Promise<CodeResult<CodeTree>>;
  file: (path: string, at: string | null) => Promise<CodeResult<CodeFile>>;
  search?: (term: string) => Promise<CodeResult<CodeSearchResult>>;
};
/** A name the server will search for (an identifier, never free text): see src/server/github/search.ts. */
export const searchable = (term: string) => /^[A-Za-z_$][\w$.]{1,79}$/.test(term);

/** The live repository through /api/code, or the demo's invented files. `at` is a commit SHA (Time Travel) or null. */
export function codeSource(g: Pick<GameData, "mode" | "repo">): CodeSource {
  if (g.mode === "mock") {
    return {
      tree: async () => ({ ok: true, value: { at: "mock", paths: Object.keys(MOCK_CODE), truncated: false } }),
      file: async (path) => {
        const text = MOCK_CODE[path];
        if (text === undefined) return { ok: false, message: "That file is not in the invented repository." };
        const lines = text.split("\n");
        const ext = /\.([A-Za-z0-9]+)$/.exec(path)?.[1] ?? "";
        return { ok: true, value: { path, at: "mock", lines, total: lines.length, truncated: false, url: "", outline: approximateOutline(lines, ext) } };
      },
    };
  }
  const base = { owner: g.repo.owner, repo: g.repo.name };
  return {
    tree: (at) => get<CodeTree>({ ...base, ...(at ? { at } : {}) }, "tree"),
    file: (path, at) => get<CodeFile>({ ...base, path, ...(at ? { at } : {}) }, "file"),
    search: (term) => get<CodeSearchResult>({ ...base, search: term }, "search"),
  };
}

/** Code first (src, lib, app…), shallow before deep, docs and config after; otherwise GitHub's order. */
export function rankPaths(paths: readonly string[]): string[] {
  const score = (p: string) => {
    const depth = p.split("/").length;
    const codeDir = /^(src|lib|app|packages|cmd|pkg|core|server|client)\//.test(p) ? 0 : 1;
    const doc = /\.(md|rst|txt)$/i.test(p) || /^(docs?|spec|test|tests|__tests__|fixtures|examples?)\//.test(p) ? 2 : 0;
    const dot = /(^|\/)\./.test(p) ? 3 : 0;
    return codeDir * 10 + doc * 10 + dot * 10 + depth;
  };
  return paths.map((p, i) => ({ p, i, s: score(p) })).sort((a, b) => a.s - b.s || a.i - b.i).map((x) => x.p);
}

/** Files whose names the chat recognises as files, so they can be asked about (others can still be read). */
export const askable = (path: string) => detectFileRef(path)?.path === path;

export type Lines = { from: number; to: number } | null;
const ref = (path: string, lines: Lines) => (lines ? `${path}:${lines.from}${lines.to > lines.from ? `-${lines.to}` : ""}` : path);

export type CodeQuestion = { id: "what" | "why" | "when"; label: string; question: string };
/**
 * The three things a visitor can ask about the code in front of them. Each names the file (and lines), and carries a
 * word ("source code", "commits", "commit") that makes the server answer with cited facts rather than fiction.
 */
export function codeQuestions(path: string, lines: Lines): CodeQuestion[] {
  const r = ref(path, lines);
  return [
    { id: "what", label: lines ? "What does this part do?" : "What is this file for?", question: lines ? `In the source code, what does ${r} do?` : `In the source code, what is ${r} for?` },
    { id: "why", label: "Why was it written this way?", question: `Why was ${r} written this way? What do its commits say?` },
    { id: "when", label: "When did it last change?", question: `When did ${r} last change, and in which commit?` },
  ];
}
