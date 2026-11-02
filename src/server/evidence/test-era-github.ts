import { vi } from "vitest";

/**
 * Synthetic GitHub for the history and Time Travel tests. Everything here is invented for a made-up
 * repository (acme/ghostly). It has paged commit history with a Link header, a README that differs by
 * commit, and an issue search that honours `created:<=`. Calls are recorded.
 */
export const sha = (n: number) => `${n.toString(16).padStart(8, "0")}${"ab".repeat(16)}`;
export type FakeCommit = { sha: string; message: string; date: string };
export type FakeIssue = { number: number; title: string; state: string; created_at: string; closed_at?: string | null; pull_request?: { merged_at?: string | null } };

/** `n` commits, oldest = index 0, one every 30 days from 2019-01-01. */
export const chronological = (n: number): FakeCommit[] =>
  Array.from({ length: n }, (_, i) => ({ sha: sha(i + 1), message: `Change number ${i + 1}\n\nBody ${i + 1}`, date: new Date(Date.UTC(2019, 0, 1) + i * 30 * 86_400_000).toISOString().replace(".000Z", "Z") }));

export function fakeHistoryGitHub(o: { commits: FakeCommit[]; readmes?: Record<string, string | null>; issues?: FakeIssue[]; owner?: string; name?: string; id?: number; searchStatus?: number }) {
  const owner = o.owner ?? "acme";
  const name = o.name ?? "ghostly";
  const base = `/repos/${owner}/${name}`;
  const calls: string[] = [];
  const newestFirst = [...o.commits].reverse();
  const j = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  const cj = (c: FakeCommit) => ({ sha: c.sha, commit: { message: c.message, committer: { date: c.date }, author: { name: "Someone Private", date: c.date } }, author: { login: "someone-private" } });
  const impl = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url.pathname + url.search);
    const p = url.pathname;
    const q = url.searchParams;
    if (p === base) {
      return j({
        id: o.id ?? 4242, name, full_name: `${owner}/${name}`, owner: { login: owner }, private: false, description: "A made-up test repository",
        default_branch: "main", archived: true, language: "Rust", stargazers_count: 9999, license: { spdx_id: "MIT" },
        pushed_at: "2030-01-01T00:00:00Z", created_at: "2018-12-01T00:00:00Z", topics: [],
      });
    }
    if (p === `${base}/commits`) {
      const per = Number(q.get("per_page") ?? 30);
      const ref = q.get("sha") ?? "main";
      if (/^[0-9a-f]{40}$/.test(ref)) {
        const idx = newestFirst.findIndex((c) => c.sha === ref);
        if (idx < 0) return j({ message: "No commit found for SHA" }, 422);
        let list = newestFirst.slice(idx);
        const until = q.get("until");
        if (until) list = list.filter((c) => Date.parse(c.date) <= Date.parse(until));
        return j(list.slice(0, per).map(cj));
      }
      if (newestFirst.length === 0) return j({ message: "Git Repository is empty." }, 409);
      const page = Number(q.get("page") ?? 1);
      const pages = Math.max(1, Math.ceil(newestFirst.length / per));
      const headers: Record<string, string> = pages > 1 ? { link: `<https://api.github.com${base}/commits?sha=main&per_page=${per}&page=${page + 1}>; rel="next", <https://api.github.com${base}/commits?sha=main&per_page=${per}&page=${pages}>; rel="last"` } : {};
      return j(newestFirst.slice((page - 1) * per, page * per).map(cj), 200, headers);
    }
    if (p === `${base}/readme`) {
      const ref = q.get("ref") ?? "HEAD";
      const text = o.readmes && ref in o.readmes ? o.readmes[ref] : o.readmes && "HEAD" in o.readmes ? o.readmes.HEAD : "# Ghostly\n\nA small library.\n";
      if (text === null || text === undefined) return j({ message: "Not Found" }, 404);
      const buf = Buffer.from(text, "utf8");
      return j({ name: "README.md", path: "README.md", size: buf.length, html_url: `https://github.com/${owner}/${name}/blob/${ref}/README.md`, encoding: "base64", content: buf.toString("base64") });
    }
    if (p === "/search/issues") {
      if (o.searchStatus) return j({ message: "x" }, o.searchStatus);
      const query = q.get("q") ?? "";
      const until = /created:<=(\S+)/.exec(query)?.[1];
      const items = (o.issues ?? []).filter((i) => !until || Date.parse(i.created_at) <= Date.parse(until));
      return j({ total_count: items.length, items: items.map((i) => ({ ...i, body: "A body that may have been edited since", comments: 99, user: { login: "someone-private" } })) });
    }
    return j({ message: "unrouted" }, 404);
  });
  return { fetch: impl as unknown as typeof fetch, calls, owner, name };
}
