import { parseRepoInput } from "@/domain/repo-ref";
import { GitHubError } from "@/server/github/client";
import { fetchCodeFile, fetchCodeTree, isSafePath, isSha, repoFor } from "@/server/github/code";
import { clientKeyFromHeaders, getLimits } from "@/server/limits";

const STATUS_BY_CODE: Record<string, number> = { not_found: 404, rate_limited: 429, forbidden: 403, timeout: 504 };

function json(body: unknown, status: number, extra: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...extra } });
}

/**
 * GET /api/code?owner=o&repo=r[&at=<40-hex sha>]            the repository's readable files (the ghost's body)
 * GET /api/code?owner=o&repo=r&path=src/a.js[&at=<sha>]      one file's code, for the viewer
 * Read-only, public repositories only, same-origin only (another site must not spend our GitHub quota).
 * Without `at`, the default branch; with it, the code as it stood at that commit (Time Travel).
 */
export async function GET(request: Request) {
  // Browsers mark cross-site requests; a missing header (a script, a test) is judged by the rate limit instead.
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return json({ ok: false, code: "bad_origin", message: "Cross-site requests are not allowed." }, 403);

  const limits = getLimits();
  const perClient = limits.codeApi.take(clientKeyFromHeaders(request.headers));
  const limit = perClient.allowed ? limits.codeApiGlobal.take("all") : perClient;
  if (!limit.allowed) return json({ ok: false, code: "rate_limited", message: `Too many requests. Try again in ${limit.retryAfterSec} seconds.` }, 429, { "Retry-After": String(limit.retryAfterSec) });

  const q = new URL(request.url).searchParams;
  const parsed = parseRepoInput(`${q.get("owner") ?? ""}/${q.get("repo") ?? ""}`);
  if (!parsed.ok) return json({ ok: false, code: parsed.code, message: parsed.message }, 400);
  const at = q.get("at");
  if (at !== null && !isSha(at)) return json({ ok: false, code: "bad_request", message: "`at` must be a full commit SHA." }, 400);
  const path = q.get("path");
  if (path !== null && !isSafePath(path)) return json({ ok: false, code: "bad_request", message: "That is not a file path in this repository." }, 400);

  try {
    const repo = await repoFor({ owner: parsed.owner, repo: parsed.repo });
    if (path === null) return json({ ok: true, tree: await fetchCodeTree(repo, at) }, 200);
    const file = await fetchCodeFile(repo, path, at);
    if (!file) return json({ ok: false, code: "not_readable", message: "That file is binary or too large to show." }, 422);
    return json({ ok: true, file }, 200);
  } catch (err) {
    if (err instanceof GitHubError) return json({ ok: false, code: err.code, message: err.code === "not_found" ? "GitHub has no such file here." : err.message, resetAt: err.resetAt }, STATUS_BY_CODE[err.code] ?? 502);
    return json({ ok: false, code: "internal", message: "Something went wrong. Try again." }, 500);
  }
}
