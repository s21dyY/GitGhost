import { createHash } from "node:crypto";
import { z } from "zod";

export const EVIDENCE_KINDS = ["repo-metadata", "commit", "readme", "issue", "issue-comment", "pull-request", "file"] as const;

export const EvidenceItemSchema = z
  .strictObject({
    id: z.string().min(1).max(200),
    repoId: z.number().int().positive(),
    kind: z.enum(EVIDENCE_KINDS),
    sourceUrl: z.string().max(500).regex(/^https:\/\/github\.com\/[^\s]+$/),
    /** Short human-readable name for link text, built by the server (for example "Issue #12"). */
    label: z.string().max(200).optional(),
    revisionSha: z.string().regex(/^[0-9a-f]{40}$/).optional(),
    retrievedAt: z.iso.datetime(),
    excerpt: z.string().max(4000),
    truncated: z.boolean(),
  })
  .refine((e) => e.id.startsWith(`ev:${e.repoId}:`), {
    message: "Evidence id must be namespaced by its repository id",
    path: ["id"],
  });

export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

/** Server-controlled ID: repo, kind, revision (or "current") and excerpt hash. */
export function makeEvidenceId(
  repoId: number,
  kind: (typeof EVIDENCE_KINDS)[number],
  revisionSha: string | undefined,
  excerpt: string,
  /** Distinguishes items whose text is identical but whose source differs. */
  sourceUrl = "",
): string {
  const hash = createHash("sha256").update(sourceUrl).update("\u0000").update(excerpt).digest("hex").slice(0, 10);
  return `ev:${repoId}:${kind}:${revisionSha?.slice(0, 12) ?? "current"}:${hash}`;
}

export function buildEvidence(input: Omit<EvidenceItem, "id">): EvidenceItem {
  const item = {
    ...input,
    id: makeEvidenceId(input.repoId, input.kind, input.revisionSha, input.excerpt, input.sourceUrl),
  };
  return EvidenceItemSchema.parse(item);
}
