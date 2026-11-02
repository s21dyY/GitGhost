import { z } from "zod";
import { buildEvidence, type EvidenceItem } from "@/domain/evidence";
import type { RepoMetadata } from "@/domain/repo";
import { GitHubError, githubGet, type GitHubDeps } from "@/server/github/client";
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
