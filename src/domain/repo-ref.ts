/**
 * Strict parsing of user-typed repository references.
 * Accepts only: owner/repo, github.com/owner/repo, www.github.com/owner/repo,
 * https://github.com/owner/repo (optional trailing slash or ".git").
 * Nothing the user types is ever used as a URL to fetch.
 */
export type RepoRef = { owner: string; repo: string };

export type RepoRefErrorCode =
  | "empty"
  | "too_long"
  | "bad_characters"
  | "bad_scheme"
  | "bad_host"
  | "bad_shape"
  | "extra_path"
  | "bad_owner"
  | "bad_repo";

export type ParseResult =
  | ({ ok: true } & RepoRef)
  | { ok: false; code: RepoRefErrorCode; message: string };

const MAX_INPUT = 300;
// GitHub usernames/orgs: alphanumeric or single hyphens, 1-39 chars.
const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const ALLOWED_HOSTS = new Set(["github.com", "www.github.com"]);

function fail(code: RepoRefErrorCode, message: string): ParseResult {
  return { ok: false, code, message };
}

function validate(owner: string, repoRaw: string): ParseResult {
  const repo = repoRaw.endsWith(".git") ? repoRaw.slice(0, -4) : repoRaw;
  if (!OWNER_RE.test(owner)) {
    return fail(
      "bad_owner",
      "The owner name is not valid. Use letters, numbers and single hyphens.",
    );
  }
  if (!REPO_RE.test(repo) || repo === "." || repo === "..") {
    return fail(
      "bad_repo",
      "The repository name is not valid. Use letters, numbers, dots, hyphens and underscores.",
    );
  }
  return { ok: true, owner, repo };
}

export function parseRepoInput(input: unknown): ParseResult {
  if (typeof input !== "string") {
    return fail("empty", "Enter a repository such as owner/repo.");
  }
  const text = input.trim();
  if (text === "") return fail("empty", "Enter a repository such as owner/repo.");
  if (text.length > MAX_INPUT) {
    return fail("too_long", "That input is too long to be a GitHub repository.");
  }
  // Rejects whitespace, control characters, backslashes, and non-ASCII
  // (blocks lookalike hosts and URL-parser confusion).
  if (/[\s\\\u0000-\u001f\u007f]|[^\x20-\x7e]/.test(text)) {
    return fail(
      "bad_characters",
      "Remove spaces and unusual characters. Use owner/repo or a github.com URL.",
    );
  }

  let path: string;
  const schemeMatch = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(text);
  const hasScheme = schemeMatch !== null && text.slice(schemeMatch[0].length).startsWith("//");

  if (hasScheme || /^[^/]*\./.test(text.split("/")[0])) {
    // URL-like: let the URL parser split the pieces, then check each strictly.
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(text) && !hasScheme) {
      return fail("bad_scheme", "Only github.com repository links are supported.");
    }
    let url: URL;
    try {
      url = new URL(hasScheme ? text : `https://${text}`);
    } catch {
      return fail("bad_host", "That does not look like a github.com link.");
    }
    if (url.protocol !== "https:") {
      return fail("bad_scheme", "Only https://github.com links are supported.");
    }
    if (url.username || url.password || url.port) {
      return fail("bad_host", "Links with credentials or ports are not supported.");
    }
    if (!ALLOWED_HOSTS.has(url.hostname)) {
      return fail("bad_host", "Only github.com repositories can be summoned.");
    }
    if (url.search || url.hash) {
      return fail("extra_path", "Remove the query or fragment. Use github.com/owner/repo.");
    }
    path = url.pathname;
  } else {
    path = `/${text}`;
  }

  const parts = path.split("/").filter((p, i, a) => !(p === "" && (i === 0 || i === a.length - 1)));
  if (parts.length < 2) {
    return fail("bad_shape", "Use the form owner/repo, for example mozilla/pdf.js.");
  }
  if (parts.length > 2 || parts.some((p) => p === "")) {
    return fail("extra_path", "Use just owner/repo, without extra path segments.");
  }
  return validate(parts[0], parts[1]);
}

export function repoPath(ref: RepoRef): string {
  return `/repo/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`;
}

export function githubUrl(ref: RepoRef): string {
  return `https://github.com/${ref.owner}/${ref.repo}`;
}
