import { parseRepoInput } from "@/domain/repo-ref";
import { GitHubError } from "@/server/github/client";
import { clientKeyFromHeaders, getLimits } from "@/server/limits";
import { lookupRepository } from "@/server/github/summon";

const STATUS_BY_CODE: Record<string, number> = {
  not_found: 404,
  rate_limited: 429,
  forbidden: 403,
  timeout: 504,
};

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * POST /api/summon  { "input": "owner/repo" | "github.com/owner/repo" }
 * Validates the reference and confirms the public repository exists.
 * Returns the canonical owner/name and numeric ID. No identity is assigned.
 */
export async function POST(request: Request) {
  // Same-origin only: a cross-site page must not be able to spend our GitHub quota.
  const origin = request.headers.get("origin");
  if (origin) {
    let originHost = "";
    try {
      originHost = new URL(origin).host;
    } catch {
      /* treated as mismatch below */
    }
    const host = request.headers.get("host") ?? new URL(request.url).host;
    if (originHost !== host) {
      return json({ ok: false, code: "bad_origin", message: "Cross-site requests are not allowed." }, 403);
    }
  }

  const limits = getLimits();
  // Per-client bucket first (shared "unverified" bucket unless a trusted IP source is configured),
  // then a process-wide cap that still holds if requests rotate identifiers.
  const perClient = limits.summonApi.take(clientKeyFromHeaders(request.headers));
  const limit = perClient.allowed ? limits.summonApiGlobal.take("all") : perClient;
  if (!limit.allowed) {
    return Response.json(
      { ok: false, code: "rate_limited", message: `Too many summons. Try again in ${limit.retryAfterSec} seconds.` },
      { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  const raw = await request.text();
  if (raw.length > 2000) {
    return json({ ok: false, code: "too_long", message: "Request body is too large." }, 413);
  }
  let input: unknown;
  try {
    input = (JSON.parse(raw) as { input?: unknown }).input;
  } catch {
    return json({ ok: false, code: "bad_request", message: "Send JSON like {\"input\":\"owner/repo\"}." }, 400);
  }

  const parsed = parseRepoInput(input);
  if (!parsed.ok) {
    return json({ ok: false, code: parsed.code, message: parsed.message }, 400);
  }

  try {
    const repo = await lookupRepository({ owner: parsed.owner, repo: parsed.repo });
    return json({ ok: true, repoId: repo.repoId, owner: repo.owner, repo: repo.name }, 200);
  } catch (err) {
    if (err instanceof GitHubError) {
      return json(
        { ok: false, code: err.code, message: err.message, resetAt: err.resetAt },
        STATUS_BY_CODE[err.code] ?? 502,
      );
    }
    return json({ ok: false, code: "internal", message: "Something went wrong. Try again." }, 500);
  }
}
