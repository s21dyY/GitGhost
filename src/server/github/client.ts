import { z } from "zod";

/**
 * Minimal GitHub REST client (server use only: reads GITHUB_TOKEN).
 * The base URL is fixed; callers pass only validated owner/repo segments
 * (see domain/repo-ref.ts), never user URLs. GitHub may answer a renamed
 * repository with a redirect inside api.github.com, which is followed.
 */
export const GITHUB_API = "https://api.github.com";
const TIMEOUT_MS = 8000;

export type GitHubErrorCode =
  | "not_found"
  | "rate_limited"
  | "forbidden"
  | "empty_repository"
  | "upstream"
  | "network"
  | "timeout"
  | "invalid_response";

export class GitHubError extends Error {
  constructor(
    readonly code: GitHubErrorCode,
    message: string,
    readonly status?: number,
    readonly resetAt?: string,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

export type GitHubDeps = {
  fetch?: typeof fetch;
  token?: string;
  signal?: AbortSignal;
};

function resetFrom(headers: Headers): string | undefined {
  const raw = headers.get("x-ratelimit-reset");
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? new Date(n * 1000).toISOString() : undefined;
}

/** GET a path under api.github.com and validate the JSON with a schema. */
export async function githubGet<T>(
  path: string,
  schema: z.ZodType<T>,
  deps: GitHubDeps = {},
): Promise<T> {
  return (await githubGetWithHeaders(path, schema, deps)).data;
}

/** Only repository paths and the issue-search path are reachable; callers never pass user URLs. */
const allowedPath = (path: string) => path.startsWith("/repos/") || path.startsWith("/search/issues?");

/** Same as githubGet, but also returns the response headers (for example Link, used to count history pages). */
export async function githubGetWithHeaders<T>(
  path: string,
  schema: z.ZodType<T>,
  deps: GitHubDeps = {},
): Promise<{ data: T; headers: Headers }> {
  if (!allowedPath(path)) {
    throw new GitHubError("invalid_response", "Unsupported GitHub path.");
  }
  const doFetch = deps.fetch ?? globalThis.fetch;
  const token = deps.token ?? process.env.GITHUB_TOKEN;
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const signal = deps.signal ? AbortSignal.any([deps.signal, timeout]) : timeout;

  let res: Response;
  try {
    res = await doFetch(`${GITHUB_API}${path}`, {
      method: "GET",
      cache: "no-store",
      redirect: "follow",
      signal,
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "GitGhost-Kiroween2026",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch (err) {
    if (timeout.aborted) throw new GitHubError("timeout", "GitHub took too long to respond.");
    if (deps.signal?.aborted) throw err;
    throw new GitHubError("network", "Could not reach GitHub.");
  }

  if (!res.ok) {
    const remaining = res.headers.get("x-ratelimit-remaining");
    if (res.status === 429 || (res.status === 403 && (remaining === "0" || res.headers.has("retry-after")))) {
      throw new GitHubError(
        "rate_limited",
        "GitHub's rate limit was reached. Try again later.",
        res.status,
        resetFrom(res.headers),
      );
    }
    if (res.status === 404) throw new GitHubError("not_found", "GitHub has no public record of that.", 404);
    if (res.status === 409) throw new GitHubError("empty_repository", "The repository is empty.", 409);
    if (res.status === 403 || res.status === 451) {
      throw new GitHubError("forbidden", "GitHub refused access to that repository.", res.status);
    }
    throw new GitHubError("upstream", `GitHub returned an error (${res.status}).`, res.status);
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new GitHubError("invalid_response", "GitHub returned unreadable data.");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new GitHubError("invalid_response", "GitHub returned data in an unexpected shape.");
  }
  return { data: parsed.data, headers: res.headers };
}
