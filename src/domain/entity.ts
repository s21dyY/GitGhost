import { z } from "zod";
import {
  CONFIG_VERSION,
  HORRORS,
  HUMANS,
  MUTATIONS,
  TEMPERAMENTS,
  resolveEntity,
  type EntityIdentity,
  type RepoSignals,
} from "@/config/entities";
import type { RepoMetadata } from "./repo";

/**
 * Storage/validation envelope for a fictional character identity, keyed by
 * numeric GitHub repo ID. Deliberately separate from repository metadata
 * (repo.ts). The ID lists come from src/config/entities, the single source of
 * truth. In Milestone 1B nothing creates or persists these; schema and
 * field-mapping only. Creation (`buildEntity`) and storage are Milestone 2A.
 *
 * Field mapping to the config pack's `EntityIdentity`:
 *   schemaVersion  <-> configVersion
 *   voiceId        <-> horrorId
 *   mutationParts  <-> mutationIds
 * Other pack fields keep their names. `assignedAt` is envelope-only.
 */
export const ORIGIN_IDS: readonly string[] = HUMANS.map((h) => h.id);
export const VOICE_IDS: readonly string[] = HORRORS.map((h) => h.id);
export const TEMPERAMENT_IDS: readonly string[] = TEMPERAMENTS.map((t) => t.id);
export const MUTATION_IDS: readonly string[] = MUTATIONS.map((m) => m.id);

const idIn = (ids: readonly string[]) => z.string().refine((v) => ids.includes(v), "Unknown config ID");

const AssignmentShape = z
  .strictObject({
    repoId: z.number().int().positive(),
    schemaVersion: z.number().int().positive(),
    seed: z.string().min(1).max(128),
    originId: idIn(ORIGIN_IDS),
    voiceId: idIn(VOICE_IDS),
    temperamentId: idIn(TEMPERAMENT_IDS),
    mutationParts: z.array(idIn(MUTATION_IDS)).max(2),
    eraId: z.string().min(1).max(64),
    languageMotif: z.string().min(1).max(100),
    currentStage: z.enum(["distorted", "transformed"]),
    originAssignment: z.strictObject({
      method: z.enum(["keyword", "fallback"]),
      matchedKeywords: z.array(z.string().min(1).max(40)).max(10),
    }),
    assignedAt: z.iso.datetime(),
  });

export type EntityAssignment = z.infer<typeof AssignmentShape>;

export const EntityAssignmentSchema = AssignmentShape.refine(
    (a) => {
      // Config version, compatibility and slot rules (pack's resolveEntity).
      // Unknown versions fail on purpose: migrate explicitly, never reroll.
      try {
        resolveEntity(identityFromAssignment(a));
        return true;
      } catch {
        return false;
      }
    },
    { message: "Assignment is incompatible with the current entity configuration" },
  );

export function identityFromAssignment(a: EntityAssignment): EntityIdentity {
  return {
    configVersion: a.schemaVersion,
    repoId: a.repoId,
    seed: a.seed,
    originId: a.originId,
    horrorId: a.voiceId,
    temperamentId: a.temperamentId,
    mutationIds: [...a.mutationParts],
    eraId: a.eraId,
    languageMotif: a.languageMotif,
    currentStage: a.currentStage,
    originAssignment: { method: a.originAssignment.method, matchedKeywords: [...a.originAssignment.matchedKeywords] },
  };
}

export function assignmentFromIdentity(identity: EntityIdentity, assignedAt: string): EntityAssignment {
  return EntityAssignmentSchema.parse({
    repoId: identity.repoId,
    schemaVersion: identity.configVersion,
    seed: identity.seed,
    originId: identity.originId,
    voiceId: identity.horrorId,
    temperamentId: identity.temperamentId,
    mutationParts: [...identity.mutationIds],
    eraId: identity.eraId,
    languageMotif: identity.languageMotif,
    currentStage: identity.currentStage,
    originAssignment: identity.originAssignment,
    assignedAt,
  });
}

/**
 * Maps fetched repository metadata to the pack's `RepoSignals`.
 * `repoName` is display-only in the pack and never used for assignment.
 */
export function repoSignalsFromMetadata(repo: RepoMetadata): RepoSignals {
  return {
    repoId: repo.repoId,
    repoName: repo.fullName,
    ...(repo.description ? { description: repo.description } : {}),
    ...(repo.language ? { primaryLanguage: repo.language } : {}),
    ...(repo.createdAt ? { createdAt: repo.createdAt } : {}),
    ...(repo.topics.length ? { topics: repo.topics } : {}),
  };
}

export { CONFIG_VERSION };
