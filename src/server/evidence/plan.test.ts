import { describe, expect, it } from "vitest";
import { buildEvidence, type EvidenceItem } from "@/domain/evidence";
import { atomPool } from "@/server/chat/fixtures/atom-status";
import { causeCheck, isStatusNotice, keyFacts, plainText, STRICT_NOTICE_RE } from "./plan";
import { selectEvidence, type EvidenceRef } from "./select";

/** Evidence planning on the captured atom/atom evidence (no network). */
const pool = atomPool();
const select = (items: readonly EvidenceItem[], intent: Parameters<typeof selectEvidence>[1]["intent"] = "status", byteBudget = 3000) =>
  selectEvidence(items, { intent, question: "Why did you die?", byteBudget });
const item = (kind: EvidenceItem["kind"], excerpt: string, n = 1): EvidenceItem =>
  buildEvidence({ repoId: 7, kind, sourceUrl: `https://github.com/acme/ghostly/${kind}/${n}`, label: `${kind} ${n}`, retrievedAt: "2026-11-01T00:00:00.000Z", excerpt, truncated: false });
const asRefs = (items: EvidenceItem[]): EvidenceRef[] => items.map((it, i) => ({ ref: `E${i + 1}`, item: it, view: it.excerpt }));

describe("status selection: the question decides, not lexical noise", () => {
  it("picks the repository record, the README and the newest commit, and leaves the 2015 package thread out", () => {
    const refs = select(pool);
    expect(refs.map((r) => `${r.ref}:${r.item.kind}`)).toEqual(["E1:repo-metadata", "E2:readme", "E3:commit"]);
    expect(refs.some((r) => /#6867|Comment on/.test(r.item.excerpt))).toBe(false);
  });
  it("the 2015 issue mentions 'deprecations' in its body but is not a status notice", () => {
    const old = pool.find((i) => i.kind === "issue")!;
    expect(/deprecat/i.test(old.excerpt)).toBe(true);
    expect(isStatusNotice(old)).toBe(false);
    expect(STRICT_NOTICE_RE.test("deprecated APIs")).toBe(false);
  });
  it("includes an issue or comment only when its title or sentence reads like a maintainer notice", () => {
    const notice = item("issue", "#12 Project sunset notice [closed] We are winding down.", 12);
    const noise = item("issue", "#13 Cache bug [open] It crashes.", 13);
    const comment = item("issue-comment", "Comment on #12 (2022-06-08T00:00:00.000Z): This repository is archived now, thank you all.", 12);
    const refs = select([...pool.slice(0, 3), noise, notice, comment]);
    const kinds = refs.map((r) => r.item.excerpt.slice(0, 20));
    expect(refs.some((r) => r.item.id === notice.id)).toBe(true);
    expect(refs.some((r) => r.item.id === comment.id)).toBe(true);
    expect(refs.some((r) => r.item.id === noise.id)).toBe(false);
    expect(kinds.length).toBe(5);
  });
  it("fills with non-comment items only when fewer than three core items exist", () => {
    const refs = select(pool.filter((i) => i.kind !== "readme"));
    expect(refs.map((r) => r.item.kind)).toEqual(["repo-metadata", "commit", "issue"]);
    expect(refs.some((r) => r.item.kind === "issue-comment")).toBe(false);
  });
  it("keeps the E-numbering contiguous, the order deterministic, and respects the byte budget", () => {
    const a = select(pool, "status", 900);
    const b = select(pool, "status", 900);
    expect(a.map((r) => r.item.id)).toEqual(b.map((r) => r.item.id));
    expect(a.map((r) => r.ref)).toEqual(a.map((_, i) => `E${i + 1}`));
    expect(a.reduce((n, r) => n + Buffer.byteLength(r.view), 0)).toBeLessThanOrEqual(900);
  });
  it("other intents keep their own ranking (an issues question still gets the issue thread)", () => {
    const refs = select(pool, "issues");
    expect(refs.some((r) => r.item.kind === "issue")).toBe(true);
    expect(refs.some((r) => r.item.kind === "issue-comment")).toBe(true);
  });
  it("shows the model a README without badge and image markup, while the raw excerpt used for validation is untouched", () => {
    const readme = select(pool)[1];
    expect(readme.view).not.toContain("dev.azure.com");
    expect(readme.view).not.toMatch(/!\[/);
    expect(readme.view).toContain("will be archived on December 15, 2022");
    expect(readme.item.excerpt).toContain("dev.azure.com");
  });
});

describe("key facts: copied from the selected evidence, with the E-number of their source", () => {
  const refs = select(pool);
  const facts = keyFacts(refs, "status");
  it("lists the archived flag, last push, README notice and newest commit", () => {
    expect(facts).toEqual([
      { ref: "E1", text: "archived: true (GitHub's flag on the repository)" },
      { ref: "E1", text: "last push: 2023-01-03" },
      { ref: "E2", text: 'README notice: "Atom and all repositories under Atom will be archived on December 15, 2022."' },
      { ref: "E3", text: 'newest commit retrieved (2022-11-22): "Merge pull request #25709 from atom/fix-snapshot-result-macos"' },
    ]);
  });
  it("every fact is plain text: no links, no markdown, no heading merged into a quote", () => {
    for (const f of facts) {
      expect(f.text).not.toMatch(/https?:|www\.|\]\(|!\[|^#/);
      expect(f.text).not.toContain("Atom >");
    }
  });
  it("every number and date in a fact appears in the evidence it points to (nothing is invented)", () => {
    for (const f of facts) {
      const source = refs.find((r) => r.ref === f.ref)!.item.excerpt;
      for (const n of f.text.match(/\d[\d-]*\d|\d/g) ?? []) expect(source).toContain(n);
    }
  });
  it("is deterministic and bounded", () => {
    expect(keyFacts(refs, "status")).toEqual(facts);
    expect(facts.length).toBeLessThanOrEqual(7);
  });
  it("reports 'archived: false' as it is, and adds no README notice when the README has none", () => {
    const out = keyFacts(asRefs([item("repo-metadata", "acme/ghostly\narchived: false\nlast push: 2026-10-30T10:00:00.000Z"), item("readme", "# Ghostly\n\nA small library.")]), "status");
    expect(out.map((f) => f.text)).toEqual(["archived: false (GitHub's flag on the repository)", "last push: 2026-10-30"]);
  });
  it("handles both stored commit shapes", () => {
    const a = keyFacts(asRefs([item("commit", "Fix cache (committed 2024-05-06T00:00:00.000Z)")]), "recent");
    const b = keyFacts(asRefs([item("commit", "Fix cache\n2024-05-06T00:00:00.000Z")]), "recent");
    expect(a[0].text).toBe('newest commit retrieved (2024-05-06): "Fix cache"');
    expect(b[0].text).toBe(a[0].text);
  });
  it("surfaces a maintainer notice from an issue title for status questions", () => {
    const out = keyFacts(asRefs([item("repo-metadata", "acme/ghostly\narchived: true"), item("issue", "#12 Sunsetting this project [closed] Goodbye.", 12)]), "status");
    expect(out.some((f) => f.ref === "E2" && f.text.startsWith("issue about the project's status:"))).toBe(true);
  });
});

describe("cause check: is a reason written down?", () => {
  it("atom/atom: the README announces the archival but states no reason", () => {
    expect(causeCheck(select(pool))).toEqual({ stated: false });
  });
  it("detects a reason stated next to the notice and quotes it", () => {
    const r = asRefs([item("readme", "# Ghostly\n\nThis project is archived in favor of the new library. Thank you.")]);
    const c = causeCheck(r);
    expect(c.stated).toBe(true);
    expect(c).toMatchObject({ ref: "E1", sentence: "This project is archived in favor of the new library." });
  });
  it("ignores reason words that are not next to a notice", () => {
    const r = asRefs([item("readme", "# Ghostly\n\nWe built this because we love lamps. The project is archived.")]);
    expect(causeCheck(r).stated).toBe(false);
  });
});

describe("plainText", () => {
  it("removes images, links and quote markers but keeps the words", () => {
    expect(plainText("> See the [official announcement](https://example.com/x) ![img](a.png) now")).toBe("See the official announcement now");
  });
  it("bounds length", () => {
    expect(plainText("a".repeat(500), 50).length).toBe(50);
  });
});
