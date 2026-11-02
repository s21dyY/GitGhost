import { z } from "zod";
import { EvidenceItemSchema } from "./evidence";
import { RepoStatus } from "./status";

export const MAX_TOPICS = 20;
/** GitHub topic format: lowercase letters, digits, hyphens; up to 50 chars. */
export const TOPIC_RE = /^[a-z0-9][a-z0-9-]{0,49}$/;

/** Fresh, normalized repository facts. Never stored with character identity. */
export const RepoMetadataSchema = z.strictObject({
  repoId: z.number().int().positive(),
  owner: z.string().min(1),
  name: z.string().min(1),
  fullName: z.string().min(3),
  htmlUrl: z.string().regex(/^https:\/\/github\.com\/[^\s]+$/),
  description: z.string().nullable(),
  defaultBranch: z.string().min(1),
  archived: z.boolean(),
  language: z.string().nullable(),
  stars: z.number().int().nonnegative(),
  license: z.string().nullable(),
  pushedAt: z.iso.datetime().nullable(),
  /** Repository creation time on GitHub; null if missing or unparseable. */
  createdAt: z.iso.datetime().nullable(),
  /** GitHub topics. Untrusted text: lowercase slugs only, at most 20. */
  topics: z.array(z.string().regex(TOPIC_RE)).max(MAX_TOPICS),
});
export type RepoMetadata = z.infer<typeof RepoMetadataSchema>;

export const LatestCommitSchema = z.strictObject({
  sha: z.string().regex(/^[0-9a-f]{40}$/),
  htmlUrl: z.string().regex(/^https:\/\/github\.com\/[^\s]+$/),
  /** First line of the message only, truncated. */
  messageHeadline: z.string().max(200),
  committedAt: z.iso.datetime().nullable(),
});
export type LatestCommit = z.infer<typeof LatestCommitSchema>;

export const ReadmeSchema = z.strictObject({
  path: z.string(),
  htmlUrl: z.string().regex(/^https:\/\/github\.com\/[^\s]+$/),
  /** Bounded text excerpt, treated as untrusted data. */
  excerpt: z.string(),
  /** True if the excerpt is shorter than the README itself. */
  truncated: z.boolean(),
  revisionSha: z.string().regex(/^[0-9a-f]{40}$/).optional(),
});
export type Readme = z.infer<typeof ReadmeSchema>;

export type SectionState =
  | { state: "ok" }
  | { state: "empty" }
  | { state: "error"; code: string; message: string };

export const SummonedRepoSchema = z.strictObject({
  repo: RepoMetadataSchema,
  latestCommit: LatestCommitSchema.nullable(),
  readme: ReadmeSchema.nullable(),
  evidence: z.array(EvidenceItemSchema),
  retrievedAt: z.iso.datetime(),
});
export type SummonedRepo = z.infer<typeof SummonedRepoSchema> & {
  status: RepoStatus;
  sections: { commit: SectionState; readme: SectionState };
};
