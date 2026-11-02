import { EntityAssignmentSchema, type EntityAssignment } from "@/domain/entity";

/**
 * First-write-wins storage for fictional entity assignments, keyed by numeric
 * GitHub repository ID. Storage only: it never creates or rerolls identities
 * (that is the character engine, Milestone 2A). See docs/DYNAMODB_ASSIGNMENTS.md.
 */
export type PutResult = {
  /** True if this call stored the assignment; false if another one already existed. */
  created: boolean;
  /** The winning assignment: always the stored one. */
  assignment: EntityAssignment;
};

export interface AssignmentStore {
  get(repoId: number): Promise<EntityAssignment | null>;
  /** Atomically store `assignment` only if none exists for its repoId. */
  putIfAbsent(assignment: EntityAssignment): Promise<PutResult>;
}

/** Stored data exists but is not valid for the current configuration. */
export class StoredAssignmentError extends Error {
  constructor(message: string, readonly repoId: number) {
    super(message);
    this.name = "StoredAssignmentError";
  }
}

/** Parse untrusted stored JSON. Never "repairs" or overwrites on failure. */
export function parseStoredAssignment(json: string, expectedRepoId: number): EntityAssignment {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new StoredAssignmentError("Stored assignment is not valid JSON.", expectedRepoId);
  }
  const parsed = EntityAssignmentSchema.safeParse(value);
  if (!parsed.success) {
    throw new StoredAssignmentError(
      "Stored assignment is invalid or needs an explicit config migration.",
      expectedRepoId,
    );
  }
  if (parsed.data.repoId !== expectedRepoId) {
    throw new StoredAssignmentError("Stored assignment belongs to a different repository.", expectedRepoId);
  }
  return parsed.data;
}

/**
 * Store a candidate if the repo has no assignment; otherwise return the
 * existing winner. Concurrent callers converge on one assignment.
 */
export async function claimAssignment(
  store: AssignmentStore,
  candidate: unknown,
): Promise<PutResult> {
  const valid = EntityAssignmentSchema.parse(candidate);
  return store.putIfAbsent(valid);
}

/** In-memory implementation with the same semantics, for tests and local dev. */
export function createMemoryAssignmentStore(): AssignmentStore {
  const rows = new Map<number, string>();
  return {
    async get(repoId) {
      const raw = rows.get(repoId);
      return raw === undefined ? null : parseStoredAssignment(raw, repoId);
    },
    async putIfAbsent(assignment) {
      const existing = rows.get(assignment.repoId);
      if (existing !== undefined) {
        return { created: false, assignment: parseStoredAssignment(existing, assignment.repoId) };
      }
      rows.set(assignment.repoId, JSON.stringify(assignment));
      return { created: true, assignment };
    },
  };
}
