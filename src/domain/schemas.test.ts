import { describe, expect, it } from "vitest";
import { EntityAssignmentSchema } from "./entity";
import { CONFIG_VERSION } from "@/config/entities";
import { buildEvidence, EvidenceItemSchema } from "./evidence";
import { deriveStatus } from "./status";

const goodAssignment = {
  repoId: 1663468,
  schemaVersion: CONFIG_VERSION,
  seed: "seed-abc",
  originId: "archivist",
  voiceId: "regret",
  temperamentId: "formal",
  mutationParts: ["ink-tears"],
  eraId: "timeless",
  languageMotif: "weathered brass details",
  currentStage: "distorted",
  originAssignment: { method: "fallback", matchedKeywords: [] },
  assignedAt: "2026-10-30T12:00:00Z",
};

describe("EntityAssignmentSchema", () => {
  it("accepts a valid assignment", () => {
    expect(EntityAssignmentSchema.safeParse(goodAssignment).success).toBe(true);
  });
  it.each([
    ["unknown origin", { originId: "wizard" }],
    ["non-integer repo id", { repoId: 1.5 }],
    ["bad date", { assignedAt: "yesterday" }],
    ["extra field", { owner: "mozilla" }],
    ["missing seed", { seed: "" }],
    ["unknown temperament", { temperamentId: "restrained" }],
    ["unknown mutation", { mutationParts: ["lantern"] }],
    ["mutation incompatible with origin and voice", { mutationParts: ["small-teeth"] }],
    ["unmigrated config version", { schemaVersion: CONFIG_VERSION + 1 }],
    ["human is not a stored stage", { currentStage: "human" }],
  ])("rejects %s", (_n, patch) => {
    expect(EntityAssignmentSchema.safeParse({ ...goodAssignment, ...patch }).success).toBe(false);
  });
});

const baseEvidence = {
  repoId: 1663468,
  kind: "readme" as const,
  sourceUrl: "https://github.com/mozilla/pdf.js#readme",
  retrievedAt: "2026-10-30T12:00:00.000Z",
  excerpt: "hello",
  truncated: false,
};

describe("EvidenceItemSchema", () => {
  it("builds namespaced, content-hashed ids", () => {
    const a = buildEvidence(baseEvidence);
    const b = buildEvidence({ ...baseEvidence, excerpt: "different" });
    expect(a.id.startsWith("ev:1663468:readme:current:")).toBe(true);
    expect(a.id).not.toBe(b.id);
    expect(buildEvidence(baseEvidence).id).toBe(a.id);
  });

  it("includes the revision in the id", () => {
    const sha = "a".repeat(40);
    expect(buildEvidence({ ...baseEvidence, revisionSha: sha }).id).toContain(`:${"a".repeat(12)}:`);
  });

  it("rejects ids from another repository", () => {
    const item = buildEvidence(baseEvidence);
    expect(EvidenceItemSchema.safeParse({ ...item, repoId: 42 }).success).toBe(false);
  });

  it("rejects non-GitHub source URLs and bad SHAs", () => {
    const item = buildEvidence(baseEvidence);
    expect(EvidenceItemSchema.safeParse({ ...item, sourceUrl: "https://evil.example/x" }).success).toBe(false);
    expect(EvidenceItemSchema.safeParse({ ...item, revisionSha: "abc" }).success).toBe(false);
  });
});

describe("deriveStatus", () => {
  const now = new Date("2026-10-30T00:00:00Z");
  it("archived wins", () => expect(deriveStatus(true, "2026-10-29T00:00:00Z", now)).toBe("archived"));
  it("recent commit is active", () => expect(deriveStatus(false, "2026-09-01T00:00:00Z", now)).toBe("active"));
  it("old commit is quiet", () => expect(deriveStatus(false, "2024-01-01T00:00:00Z", now)).toBe("quiet"));
  it("no commit date is unknown", () => {
    expect(deriveStatus(false, null, now)).toBe("unknown");
    expect(deriveStatus(false, "not a date", now)).toBe("unknown");
  });
});
