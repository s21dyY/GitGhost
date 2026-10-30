/**
 * Curated featured graveyard entries.
 * RECORDED SNAPSHOT: values below were read from the GitHub REST API on
 * 2026-10-30 (via `gh api repos/{owner}/{repo}`). They are not live.
 */
export type FeaturedStatus = "archived" | "quiet" | "active";

export type FeaturedRepo = {
  /** Numeric GitHub repository ID (stable identity). */
  repoId: number;
  owner: string;
  repo: string;
  language: string;
  /** Short neutral summary of what the project is. */
  summary: string;
  /** archived = GitHub archived flag; quiet/active are derived from lastPushedAt. */
  status: FeaturedStatus;
  /** ISO timestamp of the default branch's last push at snapshot time. */
  lastPushedAt: string;
  retrievedAt: string;
};

export const SNAPSHOT_DATE = "2026-10-30";

export const STATUS_LABELS: Record<FeaturedStatus, { label: string; definition: string }> = {
  archived: {
    label: "Archived",
    definition: "The repository's archived flag was set when last fetched.",
  },
  quiet: {
    label: "Quiet by last fetched push",
    definition: "Not archived, and no push for over 12 months before the snapshot date.",
  },
  active: {
    label: "Active by last fetched push",
    definition: "Not archived, and pushed within 12 months of the snapshot date.",
  },
};

export const FEATURED_REPOS: readonly FeaturedRepo[] = [
  {
    repoId: 3228505,
    owner: "atom",
    repo: "atom",
    language: "JavaScript",
    summary: "A hackable text editor.",
    status: "archived",
    lastPushedAt: "2023-01-03T10:49:48Z",
    retrievedAt: "2026-10-30",
  },
  {
    repoId: 92104803,
    owner: "mozilla",
    repo: "send",
    language: "FreeMarker",
    summary: "A file sharing service.",
    status: "archived",
    lastPushedAt: "2021-05-21T21:29:10Z",
    retrievedAt: "2026-10-30",
  },
  {
    repoId: 1283503,
    owner: "request",
    repo: "request",
    language: "JavaScript",
    summary: "A simplified HTTP request client for Node.js.",
    status: "quiet",
    lastPushedAt: "2024-08-14T00:09:41Z",
    retrievedAt: "2026-10-30",
  },
  {
    repoId: 5710341,
    owner: "bower",
    repo: "bower",
    language: "JavaScript",
    summary: "A package manager for the web.",
    status: "quiet",
    lastPushedAt: "2024-10-13T10:45:05Z",
    retrievedAt: "2026-10-30",
  },
  {
    repoId: 1424470,
    owner: "moment",
    repo: "moment",
    language: "JavaScript",
    summary: "A JavaScript date library for parsing and formatting dates.",
    status: "active",
    lastPushedAt: "2026-10-08T16:26:56Z",
    retrievedAt: "2026-10-30",
  },
  {
    repoId: 1663468,
    owner: "mozilla",
    repo: "pdf.js",
    language: "JavaScript",
    summary: "A PDF viewer built with web standards.",
    status: "active",
    lastPushedAt: "2026-10-30T07:58:00Z",
    retrievedAt: "2026-10-30",
  },
];

export function repoUrl(r: Pick<FeaturedRepo, "owner" | "repo">): string {
  return `https://github.com/${r.owner}/${r.repo}`;
}
