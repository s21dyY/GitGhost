import { z } from "zod";
import { buildEvidence, type EvidenceItem } from "@/domain/evidence";
import type { RepoMetadata } from "@/domain/repo";
import { GitHubError, githubGet, githubGetWithHeaders, type GitHubDeps } from "@/server/github/client";
import { cleanUntrustedText } from "@/server/github/summon";

/**
 * Bounded GitHub fetchers that turn API responses into validated EvidenceItems.
 * Source URLs are always BUILT here from the canonical repo name and integer IDs, never copied
 * from API fields or model output. Author logins are deliberately dropped (no blame, no people).
 * All text is untrusted: control characters stripped, length capped.
 */
const EXCERPT = 600;
const COMMENT_EXCERPT = 500;
const iso = (v: string | null | undefined) => {
  const t = v ? Date.parse(v) : NaN;
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};
const clip = (text: string | null | undefined, max: number) => {
  const clean = cleanUntrustedText(text ?? "").replace(/\s+/g, " ").trim();
  return { text: clean.slice(0, max), truncated: clean.length > max };
};
const repoPath = (repo: RepoMetadata) => `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
const posInt = z.number().int().positive();

const RawCommits = z.array(
  z.object({
    sha: z.string().regex(/^[0-9a-f]{40}$/),
    commit: z.object({
      message: z.string(),
      committer: z.object({ date: z.string().nullable().optional() }).nullable().optional(),
      author: z.object({ date: z.string().nullable().optional() }).nullable().optional(),
    }),
  }),
);

const RawIssues = z.array(
  z.object({
    number: posInt,
    title: z.string(),
    state: z.string(),
    body: z.string().nullable().optional(),
    comments: z.number().int().nonnegative().optional(),
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
    closed_at: z.string().nullable().optional(),
    pull_request: z.object({}).passthrough().optional(),
  }),
);

const RawPulls = z.array(
  z.object({
    number: posInt,
    title: z.string(),
    state: z.string(),
    body: z.string().nullable().optional(),
    merged_at: z.string().nullable().optional(),
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
  }),
);

const RawComments = z.array(z.object({ id: posInt, body: z.string().nullable().optional(), created_at: z.string().nullable().optional() }));

export type FetchCtx = { repo: RepoMetadata; retrievedAt: string; deps: GitHubDeps };

function commitItems(raw: z.infer<typeof RawCommits>, { repo, retrievedAt }: FetchCtx, label: string): EvidenceItem[] {
  return raw.map((c) => {
    const headline = clip(c.commit.message.split("\n")[0], 200);
    const date = iso(c.commit.committer?.date ?? c.commit.author?.date);
    return buildEvidence({
      repoId: repo.repoId,
      kind: "commit",
      sourceUrl: `${repo.htmlUrl}/commit/${c.sha}`,
      label: `${label} ${c.sha.slice(0, 7)}`,
      revisionSha: c.sha,
      retrievedAt,
      excerpt: `${headline.text}${date ? ` (committed ${date})` : ""}`,
      truncated: headline.truncated,
    });
  });
}

export async function fetchRecentCommits(ctx: FetchCtx, count: number): Promise<EvidenceItem[]> {
  const { repo, deps } = ctx;
  const raw = await githubGet(`${repoPath(repo)}/commits?sha=${encodeURIComponent(repo.defaultBranch)}&per_page=${count}`, RawCommits, deps).catch((e) => {
    if (e instanceof GitHubError && e.code === "empty_repository") return [];
    throw e;
  });
  return commitItems(raw, ctx, "Commit");
}

/** Commits shortly after the repository was created on GitHub. NOT necessarily the first commit ever made. */
export async function fetchEarlyCommits(ctx: FetchCtx, count: number): Promise<EvidenceItem[]> {
  const { repo, deps } = ctx;
  if (!repo.createdAt) return [];
  const until = new Date(Date.parse(repo.createdAt) + 90 * 86_400_000).toISOString();
  const raw = await githubGet(`${repoPath(repo)}/commits?sha=${encodeURIComponent(repo.defaultBranch)}&until=${encodeURIComponent(until)}&per_page=${count}`, RawCommits, deps).catch((e) => {
    if (e instanceof GitHubError && e.code === "empty_repository") return [];
    throw e;
  });
  return commitItems(raw, ctx, "Early commit");
}

function issueLine(i: { title: string; state: string; body?: string | null; comments?: number; created_at?: string | null; closed_at?: string | null }) {
  const title = clip(i.title, 160);
  const body = clip(i.body, EXCERPT - 200);
  const parts = [`${title.text} [${i.state}`, iso(i.created_at) ? `opened ${iso(i.created_at)}` : "", iso(i.closed_at) ? `closed ${iso(i.closed_at)}` : "", i.comments !== undefined ? `${i.comments} comments` : ""].filter(Boolean);
  return { text: `${parts[0]}${parts.length > 1 ? ", " + parts.slice(1).join(", ") : ""}]${body.text ? ` ${body.text}` : ""}`, truncated: title.truncated || body.truncated };
}

export async function fetchIssues(ctx: FetchCtx, opts: { sort: "comments" | "updated" | "created"; direction?: "asc" | "desc"; count: number }): Promise<{ issues: EvidenceItem[]; pulls: EvidenceItem[] }> {
  const { repo, retrievedAt, deps } = ctx;
  const q = `state=all&sort=${opts.sort}&direction=${opts.direction ?? "desc"}&per_page=${Math.min(30, opts.count * 3)}`;
  const raw = await githubGet(`${repoPath(repo)}/issues?${q}`, RawIssues, deps);
  const issues: EvidenceItem[] = [];
  const pulls: EvidenceItem[] = [];
  for (const i of raw) {
    const isPr = i.pull_request !== undefined;
    const line = issueLine(i);
    const item = buildEvidence({
      repoId: repo.repoId,
      kind: isPr ? "pull-request" : "issue",
      sourceUrl: `${repo.htmlUrl}/${isPr ? "pull" : "issues"}/${i.number}`,
      label: `${isPr ? "Pull request" : "Issue"} #${i.number}`,
      retrievedAt,
      excerpt: `#${i.number} ${line.text}`,
      truncated: line.truncated,
    });
    (isPr ? pulls : issues).push(item);
  }
  return { issues: issues.slice(0, opts.count), pulls: pulls.slice(0, opts.count) };
}

export async function fetchPulls(ctx: FetchCtx, count: number): Promise<EvidenceItem[]> {
  const { repo, retrievedAt, deps } = ctx;
  const raw = await githubGet(`${repoPath(repo)}/pulls?state=all&sort=updated&direction=desc&per_page=${count}`, RawPulls, deps);
  return raw.map((p) => {
    const title = clip(p.title, 160);
    const body = clip(p.body, EXCERPT - 200);
    const merged = iso(p.merged_at);
    return buildEvidence({
      repoId: repo.repoId,
      kind: "pull-request",
      sourceUrl: `${repo.htmlUrl}/pull/${p.number}`,
      label: `Pull request #${p.number}`,
      retrievedAt,
      excerpt: `#${p.number} ${title.text} [${p.state}${merged ? `, merged ${merged}` : ""}]${body.text ? ` ${body.text}` : ""}`,
      truncated: title.truncated || body.truncated,
    });
  });
}

export async function fetchIssueComments(ctx: FetchCtx, number: number, count: number): Promise<EvidenceItem[]> {
  const { repo, retrievedAt, deps } = ctx;
  if (!Number.isInteger(number) || number <= 0) return [];
  const raw = await githubGet(`${repoPath(repo)}/issues/${number}/comments?per_page=${count}`, RawComments, deps);
  return raw.map((c) => {
    const body = clip(c.body, COMMENT_EXCERPT);
    return buildEvidence({
      repoId: repo.repoId,
      kind: "issue-comment",
      sourceUrl: `${repo.htmlUrl}/issues/${number}#issuecomment-${c.id}`,
      label: `Comment on #${number}`,
      retrievedAt,
      excerpt: `Comment on #${number}${iso(c.created_at) ? ` (${iso(c.created_at)})` : ""}: ${body.text}`,
      truncated: body.truncated,
    });
  });
}

/* ---------- one file's story (V7: "why is this line written this way?") ---------- */

const RawContent = z.object({ type: z.string(), encoding: z.string().optional(), size: z.number().int().nonnegative(), content: z.string().optional() });
/** Repository path, one encoded segment at a time (a path is never passed raw into a URL). */
export const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

/** Commits that touched `path` up to `at`, newest first; plus the earliest ones GitHub lists when there are more pages. */
export async function fetchFileCommits(ctx: FetchCtx, path: string, at: string, count = 8): Promise<{ newest: EvidenceItem[]; earliest: EvidenceItem[] }> {
  const { repo, deps } = ctx;
  const q = (extra: string) => `${repoPath(repo)}/commits?sha=${encodeURIComponent(at)}&path=${encodeURIComponent(path)}&per_page=${count}${extra}`;
  const first = await githubGetWithHeaders(q(""), RawCommits, deps);
  const newest = commitItems(first.data, ctx, `Commit touching ${path}`);
  const last = /<[^>]*[?&]page=(\d+)[^>]*>;\s*rel="last"/.exec(first.headers.get("link") ?? "")?.[1];
  if (!last || Number(last) < 2) {
    // one page holds the whole history of this path: its oldest entry is the earliest GitHub lists
    return { newest, earliest: first.data.length ? commitItems(first.data.slice(-1), ctx, `Earliest commit GitHub lists for ${path}`) : [] };
  }
  const tail = await githubGet(q(`&page=${Number(last)}`), RawCommits, deps);
  return { newest, earliest: tail.length ? commitItems(tail.slice(-1), ctx, `Earliest commit GitHub lists for ${path}`) : [] };
}

/** The code around a line (or the top of the file), with line numbers, as it stood at `at`. Untrusted text, clipped. */
export async function fetchFileExcerpt(ctx: FetchCtx, path: string, at: string, line?: number, endLine?: number): Promise<EvidenceItem | null> {
  const { repo, retrievedAt, deps } = ctx;
  const raw = await githubGet(`${repoPath(repo)}/contents/${encodePath(path)}?ref=${encodeURIComponent(at)}`, RawContent, deps);
  if (raw.type !== "file" || raw.encoding !== "base64" || !raw.content || raw.size > 1_000_000) return null;
  const lines = Buffer.from(raw.content, "base64").toString("utf8").split("\n");
  const from = line ? Math.max(1, line - 4) : 1;
  const to = Math.min(lines.length, line ? (endLine ?? line) + 4 : 14);
  if (line && line > lines.length) return null;
  const body = lines.slice(from - 1, to).map((l, i) => `${from + i}: ${cleanUntrustedText(l).replace(/\t/g, "  ").slice(0, 160)}`).join("\n");
  return buildEvidence({
    repoId: repo.repoId,
    kind: "file",
    sourceUrl: `${repo.htmlUrl}/blob/${at}/${encodePath(path)}#L${from}-L${to}`,
    label: `${path}, lines ${from}–${to}`,
    revisionSha: /^[0-9a-f]{40}$/.test(at) ? at : undefined,
    retrievedAt,
    excerpt: `${path} (lines ${from}–${to} of ${lines.length})\n${body}`.slice(0, 3000),
    truncated: to < lines.length || from > 1,
  });
}

/** The pull request(s) a commit arrived through: where the reasons for a change are usually written. */
export async function fetchCommitPulls(ctx: FetchCtx, sha: string, count = 1): Promise<EvidenceItem[]> {
  const { repo, retrievedAt, deps } = ctx;
  if (!/^[0-9a-f]{40}$/.test(sha)) return [];
  const raw = await githubGet(`${repoPath(repo)}/commits/${sha}/pulls`, RawPulls, deps);
  return raw.slice(0, count).map((p) => {
    const title = clip(p.title, 160);
    const body = clip(p.body, EXCERPT - 200);
    const merged = iso(p.merged_at);
    return buildEvidence({
      repoId: repo.repoId,
      kind: "pull-request",
      sourceUrl: `${repo.htmlUrl}/pull/${p.number}`,
      label: `Pull request #${p.number} (behind commit ${sha.slice(0, 7)})`,
      retrievedAt,
      excerpt: `#${p.number} ${title.text} [${p.state}${merged ? `, merged ${merged}` : ""}, the pull request behind commit ${sha.slice(0, 7)}]${body.text ? ` ${body.text}` : ""}`,
      truncated: title.truncated || body.truncated,
    });
  });
}
