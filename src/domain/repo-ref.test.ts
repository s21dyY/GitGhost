import { describe, expect, it } from "vitest";
import { githubUrl, parseRepoInput, repoPath } from "./repo-ref";

describe("parseRepoInput accepts", () => {
  it.each([
    ["mozilla/pdf.js", "mozilla", "pdf.js"],
    ["  atom/atom  ", "atom", "atom"],
    ["github.com/request/request", "request", "request"],
    ["www.github.com/bower/bower", "bower", "bower"],
    ["https://github.com/moment/moment", "moment", "moment"],
    ["HTTPS://GITHUB.COM/moment/moment/", "moment", "moment"],
    ["https://github.com/moment/moment.git", "moment", "moment"],
    ["mozilla/send/", "mozilla", "send"],
  ])("%s", (input, owner, repo) => {
    expect(parseRepoInput(input)).toEqual({ ok: true, owner, repo });
  });
});

describe("parseRepoInput rejects", () => {
  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["justowner", "bad_shape"],
    ["https://github.com/onlyowner", "bad_shape"],
    ["evil.com/owner/repo", "bad_host"],
    ["github.com.evil.com/owner/repo", "bad_host"],
    ["https://github.com.evil.com/owner/repo", "bad_host"],
    ["https://evilgithub.com/owner/repo", "bad_host"],
    ["https://gist.github.com/owner/repo", "bad_host"],
    ["https://github.com@evil.com/owner/repo", "bad_host"],
    ["https://user:pw@github.com/owner/repo", "bad_host"],
    ["github.com:8080/owner/repo", "bad_scheme"],
    ["http://github.com/owner/repo", "bad_scheme"],
    ["ftp://github.com/owner/repo", "bad_scheme"],
    ["javascript:alert(1)", "bad_shape"],
    ["https://github.com\\@evil.com/o/r", "bad_characters"],
    ["https://github.com/owner/repo extra", "bad_characters"],
    ["https://github.com/owner/repo?tab=readme", "extra_path"],
    ["https://github.com/owner/repo#readme", "extra_path"],
    ["https://github.com/owner/repo/tree/main", "extra_path"],
    ["owner//repo", "extra_path"],
    ["-owner/repo", "bad_owner"],
    ["own--er/repo", "bad_owner"],
    [`${"a".repeat(40)}/repo`, "bad_owner"],
    ["owner/..", "bad_repo"],
    ["owner/.git", "bad_repo"],
    ["owner/re%20po", "bad_repo"],
    ["owner/re$po", "bad_repo"],
    ["github.com/own\u0435r/repo", "bad_characters"],
    ["a/b".padEnd(301, "x"), "too_long"],
  ])("%j (%s)", (input, code) => {
    const r = parseRepoInput(input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe(code);
      expect(r.message.length).toBeGreaterThan(0);
    }
  });

  it("rejects non-strings", () => {
    expect(parseRepoInput(undefined).ok).toBe(false);
    expect(parseRepoInput({ owner: "a" }).ok).toBe(false);
  });
});

describe("helpers", () => {
  it("builds internal and external URLs", () => {
    expect(repoPath({ owner: "mozilla", repo: "pdf.js" })).toBe("/repo/mozilla/pdf.js");
    expect(githubUrl({ owner: "mozilla", repo: "pdf.js" })).toBe("https://github.com/mozilla/pdf.js");
  });
});
