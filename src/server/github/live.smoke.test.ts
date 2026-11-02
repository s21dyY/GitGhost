import { describe, expect, it } from "vitest";
import { summonRepository } from "./summon";

/** Opt-in live check against api.github.com: GITGHOST_LIVE=1 npm test */
describe.skipIf(process.env.GITGHOST_LIVE !== "1")("live GitHub smoke (mozilla/pdf.js)", () => {
  it("fetches real metadata, latest commit and README", async () => {
    const r = await summonRepository({ owner: "mozilla", repo: "pdf.js" });
    if (!r.ok) throw new Error(`live summon failed: ${r.error.code} ${r.error.message}`);
    expect(r.data.repo.repoId).toBe(1663468);
    expect(r.data.repo.fullName).toBe("mozilla/pdf.js");
    expect(r.data.latestCommit?.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(r.data.readme?.excerpt.length).toBeGreaterThan(0);
    expect(r.data.evidence.length).toBe(3);
    expect(r.data.repo.createdAt).not.toBeNull();
    expect(Array.isArray(r.data.repo.topics)).toBe(true);
  }, 30_000);
});
