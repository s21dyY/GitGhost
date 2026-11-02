import { z } from "zod";
import { buildEvidence, type EvidenceItem } from "@/domain/evidence";
import {
  MAX_TOPICS,
  TOPIC_RE,
  LatestCommitSchema,
  ReadmeSchema,
  RepoMetadataSchema,
  type LatestCommit,
  type Readme,
  type RepoMetadata,
  type SectionState,
  type SummonedRepo,
} from "@/domain/repo";
import { parseRepoInput, type RepoRef } from "@/domain/repo-ref";
import { deriveStatus } from "@/domain/status";
import { GitHubError, githubGet, type GitHubDeps } from "./client";

export const README_BYTE_CAP = 40_000;
export const README_EXCERPT_CHARS = 2000;
const DESCRIPTION_CHARS = 500;

const RawRepoSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  full_name: z.string().min(3),
  owner: z.object({ login: z.string().min(1) }),
  private: z.boolean().optional(),
  description: z.string().nullable().optional(),
  default_branch: z.string().min(1),
  archived: z.boolean(),
  language: z.string().nullable().optional(),
  stargazers_count: z.number().int().nonnegative(),
  license: z.object({ spdx_id: z.string().nullable().optional() }).nullable().optional(),
  pushed_at: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  topics: z.array(z.unknown()).optional(),
});

const RawCommitsSchema = z.array(
  z.object({
    sha: z.string().regex(/^[0-9a-f]{40}$/),
    commit: z.object({
      message: z.string(),
      committer: z.object({ date: z.string().nullable().optional() }).nullable().optional(),
      author: z.object({ date: z.string().nullable().optional() }).nullable().optional(),
    }),
  }),
);

const RawReadmeSchema = z.object({
  name: z.string(),
  path: z.string(),
  size: z.number().int().nonnegative(),
  html_url: z.string().nullable().optional(),
  encoding: z.string().optional(),
  content: z.string().optional(),
});

/** Strip control and bidi-override characters from untrusted text. */
export function cleanUntrustedText(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[\u202a-\u202e\u2066-\u2069]/g, "");
}

function isoOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** Keep only well-formed topic slugs; drop anything else, dedupe, cap. */
export function normalizeTopics(raw: readonly unknown[] | undefined): string[] {
  const out: string[] = [];
  for (const t of raw ?? []) {
    if (typeof t === "string" && TOPIC_RE.test(t) && !out.includes(t)) out.push(t);
    if (out.length >= MAX_TOPICS) break;
  }
  return out;
}

function repoApiPath(ref: RepoRef): string {
  return `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`;
}

/** Fetch and normalize core metadata. Throws GitHubError. */
export async function lookupRepository(ref: RepoRef, deps: GitHubDeps = {}): Promise<RepoMetadata> {
  const raw = await githubGet(repoApiPath(ref), RawRepoSchema, deps);
  if (raw.private === true) {
    throw new GitHubError("not_found", "Only public repositories can be summoned.");
  }
  // Rebuild the canonical name from GitHub's answer and re-validate it.
  const canonical = parseRepoInput(raw.full_name);
  if (!canonical.ok || canonical.owner !== raw.owner.login || canonical.repo !== raw.name) {
    throw new GitHubError("invalid_response", "GitHub returned an inconsistent repository name.");
  }
  const parsed = RepoMetadataSchema.safeParse({
    repoId: raw.id,
    owner: canonical.owner,
    name: canonical.repo,
    fullName: raw.full_name,
    htmlUrl: `https://github.com/${raw.full_name}`,
    description: raw.description ? cleanUntrustedText(raw.description).slice(0, DESCRIPTION_CHARS) : null,
    defaultBranch: raw.default_branch,
    archived: raw.archived,
    language: raw.language ?? null,
    stars: raw.stargazers_count,
    license: raw.license?.spdx_id ?? null,
    pushedAt: isoOrNull(raw.pushed_at),
    createdAt: isoOrNull(raw.created_at),
    topics: normalizeTopics(raw.topics),
  });
  if (!parsed.success) {
    throw new GitHubError("invalid_response", "GitHub returned data in an unexpected shape.");
  }
  return parsed.data;
}

async function fetchLatestCommit(
  repo: RepoMetadata,
  deps: GitHubDeps,
): Promise<LatestCommit | null> {
  let commits;
  try {
    commits = await githubGet(
      `${repoApiPath({ owner: repo.owner, repo: repo.name })}/commits?sha=${encodeURIComponent(repo.defaultBranch)}&per_page=1`,
      RawCommitsSchema,
      deps,
    );
  } catch (err) {
    if (err instanceof GitHubError && err.code === "empty_repository") return null;
    throw err;
  }
  const first = commits[0];
  if (!first) return null;
  const headline = cleanUntrustedText(first.commit.message.split("\n")[0] ?? "").slice(0, 200);
  return LatestCommitSchema.parse({
    sha: first.sha,
    htmlUrl: `${repo.htmlUrl}/commit/${first.sha}`,
    messageHeadline: headline,
    committedAt: isoOrNull(first.commit.committer?.date ?? first.commit.author?.date),
  });
}

export async function fetchReadme(
  repo: RepoMetadata,
  revisionSha: string | undefined,
  deps: GitHubDeps,
): Promise<Readme | null> {
  let raw;
  try {
    raw = await githubGet(
      `${repoApiPath({ owner: repo.owner, repo: repo.name })}/readme${revisionSha ? `?ref=${revisionSha}` : ""}`,
      RawReadmeSchema,
      deps,
    );
  } catch (err) {
    if (err instanceof GitHubError && err.code === "not_found") return null;
    throw err;
  }
  let text = "";
  let fileTruncated = raw.size > README_BYTE_CAP;
  if (raw.encoding === "base64" && raw.content) {
    const bytes = Buffer.from(raw.content, "base64");
    if (bytes.length > README_BYTE_CAP) fileTruncated = true;
    text = bytes.subarray(0, README_BYTE_CAP).toString("utf8").replace(/\uFFFD+$/, "");
  } else {
    // GitHub omits content for very large files; do not pretend we read it.
    fileTruncated = true;
  }
  text = cleanUntrustedText(text);
  const excerpt = text.slice(0, README_EXCERPT_CHARS);
  const own = `${repo.htmlUrl}/`;
  const htmlUrl =
    raw.html_url && raw.html_url.startsWith(own) && !/\s/.test(raw.html_url)
      ? raw.html_url
      : `${repo.htmlUrl}#readme`;
  return ReadmeSchema.parse({
    path: raw.path,
    htmlUrl,
    excerpt,
    truncated: fileTruncated || text.length > README_EXCERPT_CHARS,
    ...(revisionSha ? { revisionSha } : {}),
  });
}

export type SummonError = { code: string; message: string; resetAt?: string };
export type SummonResult =
  | { ok: true; data: SummonedRepo }
  | { ok: false; error: SummonError };

function sectionError(err: GitHubError): SectionState {
  return { state: "error", code: err.code, message: err.message };
}

export async function summonRepository(
  ref: RepoRef,
  deps: GitHubDeps & { now?: () => Date } = {},
): Promise<SummonResult> {
  const now = (deps.now ?? (() => new Date()))();
  const retrievedAt = now.toISOString();

  let repo: RepoMetadata;
  try {
    repo = await lookupRepository(ref, deps);
  } catch (err) {
    if (err instanceof GitHubError) {
      return { ok: false, error: { code: err.code, message: err.message, resetAt: err.resetAt } };
    }
    throw err;
  }

  const sections: SummonedRepo["sections"] = { commit: { state: "ok" }, readme: { state: "ok" } };
  let latestCommit: LatestCommit | null = null;
  try {
    latestCommit = await fetchLatestCommit(repo, deps);
    if (!latestCommit) sections.commit = { state: "empty" };
  } catch (err) {
    if (!(err instanceof GitHubError)) throw err;
    sections.commit = sectionError(err);
  }

  let readme: Readme | null = null;
  // Pin the README to the commit we read, when we have one (else default branch HEAD).
  const pinned = latestCommit?.sha;
  try {
    readme = await fetchReadme(repo, pinned, deps);
    if (!readme) sections.readme = { state: "empty" };
  } catch (err) {
    if (!(err instanceof GitHubError)) throw err;
    sections.readme = sectionError(err);
  }

  const evidence: EvidenceItem[] = [
    buildEvidence({
      repoId: repo.repoId,
      kind: "repo-metadata",
      sourceUrl: repo.htmlUrl,
      retrievedAt,
      excerpt: [
        `${repo.fullName}`,
        `default branch: ${repo.defaultBranch}`,
        `archived: ${repo.archived}`,
        `language: ${repo.language ?? "unknown"}`,
        `created on GitHub: ${repo.createdAt ?? "unknown"}`,
        `last push: ${repo.pushedAt ?? "unknown"}`,
      ].join("\n"),
      truncated: false,
    }),
  ];
  if (latestCommit) {
    evidence.push(
      buildEvidence({
        repoId: repo.repoId,
        kind: "commit",
        sourceUrl: latestCommit.htmlUrl,
        revisionSha: latestCommit.sha,
        retrievedAt,
        excerpt: `${latestCommit.messageHeadline}${latestCommit.committedAt ? `\n${latestCommit.committedAt}` : ""}`,
        truncated: false,
      }),
    );
  }
  if (readme) {
    evidence.push(
      buildEvidence({
        repoId: repo.repoId,
        kind: "readme",
        sourceUrl: readme.htmlUrl,
        ...(readme.revisionSha ? { revisionSha: readme.revisionSha } : {}),
        retrievedAt,
        excerpt: readme.excerpt,
        truncated: readme.truncated,
      }),
    );
  }

  return {
    ok: true,
    data: {
      repo,
      latestCommit,
      readme,
      evidence,
      retrievedAt,
      status: deriveStatus(repo.archived, latestCommit?.committedAt ?? null, now),
      sections,
    },
  };
}
