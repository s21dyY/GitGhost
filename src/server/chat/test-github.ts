import { vi } from "vitest";

/**
 * Synthetic GitHub for tests. Every value here is invented fixture data for a made-up repository
 * (acme/ghostly), not a claim about any real project. Calls are recorded so tests can assert how
 * many requests a question causes.
 */
const sha = (n: number) => `${n.toString(16).padStart(2, "0")}${"ab".repeat(19)}`;

export type Scenario = {
  owner?: string;
  name?: string;
  id?: number;
  archived?: boolean;
  readme?: string | null;
  readmeStatus?: number;
  issues?: unknown[];
  issuesStatus?: number;
  pulls?: unknown[];
  pullsStatus?: number;
  comments?: unknown[];
  commits?: { sha: string; message: string; date: string }[];
  early?: { sha: string; message: string; date: string }[];
  repoStatus?: number;
  repoHeaders?: Record<string, string>;
  /** Per-path history and code for file questions. `older` adds a second page whose last entry is the earliest commit. */
  files?: Record<string, { commits: { sha: string; message: string; date: string }[]; older?: { sha: string; message: string; date: string }; content?: string }>;
  /** GraphQL line blame for any file. */
  blame?: { start: number; end: number; sha: string; headline: string; date: string }[];
  /** Pull requests a commit arrived through, by commit SHA. */
  commitPulls?: Record<string, unknown[]>;
};

export const defaultCommits = () =>
  [3, 2, 1].map((n) => ({ sha: sha(n), message: `Change number ${n}\n\nlong body`, date: `2023-0${n}-15T10:00:00Z` }));

export function fakeGitHub(s: Scenario = {}) {
  const owner = s.owner ?? "acme";
  const name = s.name ?? "ghostly";
  const base = `/repos/${owner}/${name}`;
  const calls: string[] = [];
  const readme = s.readme === undefined ? "# Ghostly\n\nA small library.\n" : s.readme;
  const commits = s.commits ?? defaultCommits();
  const j = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  const commitJson = (c: { sha: string; message: string; date: string }) => ({ sha: c.sha, commit: { message: c.message, committer: { date: c.date } } });

  const impl = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url.pathname + url.search);
    const p = url.pathname;
    if (p === base) {
      if (s.repoStatus) return j({ message: "x" }, s.repoStatus, s.repoHeaders);
      return j({
        id: s.id ?? 4242, name, full_name: `${owner}/${name}`, owner: { login: owner }, private: false,
        description: "A made-up test repository", default_branch: "main", archived: s.archived ?? true, language: "JavaScript",
        stargazers_count: 10, license: { spdx_id: "MIT" }, pushed_at: "2023-03-15T10:00:00Z", created_at: "2012-05-01T00:00:00Z", topics: ["testing"],
      });
    }
    if (p === "/graphql") {
      const ranges = (s.blame ?? []).map((r) => ({ startingLine: r.start, endingLine: r.end, commit: { oid: r.sha, messageHeadline: r.headline, committedDate: r.date } }));
      return j({ data: { repository: { object: { blame: { ranges } } } } });
    }
    if (p === `${base}/commits` && url.searchParams.has("path")) {
      const f = s.files?.[url.searchParams.get("path")!];
      if (!f) return j([]);
      if (url.searchParams.has("page")) return j(f.older ? [commitJson(f.older)] : []);
      const link: Record<string, string> = f.older ? { link: `<https://api.github.com${base}/commits?path=x&page=2>; rel="next", <https://api.github.com${base}/commits?path=x&page=2>; rel="last"` } : {};
      return j(f.commits.map(commitJson), 200, link);
    }
    if (p.startsWith(`${base}/contents/`)) {
      const path = decodeURIComponent(p.slice(`${base}/contents/`.length));
      const content = s.files?.[path]?.content;
      if (content === undefined) return j({ message: "Not Found" }, 404);
      const buf = Buffer.from(content, "utf8");
      return j({ type: "file", encoding: "base64", size: buf.length, content: buf.toString("base64"), path });
    }
    const pullsOf = /^\/repos\/[^/]+\/[^/]+\/commits\/([0-9a-f]{40})\/pulls$/.exec(p);
    if (pullsOf) return j(s.commitPulls?.[pullsOf[1]] ?? []);
    if (p === `${base}/commits`) {
      if (url.searchParams.get("per_page") === "1") return commits.length ? j([commitJson(commits[0])]) : j({ message: "empty" }, 409);
      if (url.searchParams.has("until")) return j((s.early ?? [{ sha: sha(90), message: "Initial import", date: "2012-05-02T00:00:00Z" }]).map(commitJson));
      return j(commits.map(commitJson));
    }
    if (p === `${base}/readme`) {
      if (s.readmeStatus) return j({ message: "x" }, s.readmeStatus);
      if (readme === null) return j({ message: "Not Found" }, 404);
      const buf = Buffer.from(readme, "utf8");
      return j({ name: "README.md", path: "README.md", size: buf.length, html_url: `https://github.com/${owner}/${name}/blob/main/README.md`, encoding: "base64", content: buf.toString("base64") });
    }
    if (p === `${base}/issues`) return s.issuesStatus ? j({ message: "x" }, s.issuesStatus, s.issuesStatus === 403 ? { "x-ratelimit-remaining": "0" } : {}) : j(s.issues ?? []);
    if (p === `${base}/pulls`) return s.pullsStatus ? j({ message: "x" }, s.pullsStatus) : j(s.pulls ?? []);
    if (/\/issues\/\d+\/comments$/.test(p)) return j(s.comments ?? []);
    return j({ message: "unrouted" }, 404);
  });
  return { fetch: impl as unknown as typeof fetch, calls, spy: impl, owner, name };
}

export const issue = (number: number, title: string, extra: Record<string, unknown> = {}) => ({
  number, title, state: "closed", body: `Body of ${title}`, comments: 3, created_at: "2022-01-01T00:00:00Z", updated_at: "2022-02-01T00:00:00Z", closed_at: "2022-02-01T00:00:00Z",
  user: { login: "someone-private" }, html_url: "https://evil.example/not-used", ...extra,
});
export const pull = (number: number, title: string, extra: Record<string, unknown> = {}) => ({
  number, title, state: "closed", body: null, merged_at: "2022-03-01T00:00:00Z", created_at: "2022-02-01T00:00:00Z", updated_at: "2022-03-01T00:00:00Z", user: { login: "x" }, ...extra,
});
