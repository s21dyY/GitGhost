import { randomUUID } from "node:crypto";
import { buildEntity } from "@/config/entities";
import { assignmentFromIdentity, repoSignalsFromMetadata, type EntityAssignment } from "@/domain/entity";
import type { RepoMetadata } from "@/domain/repo";
import { claimAssignment, StoredAssignmentError, type AssignmentStore } from "@/server/storage/assignments";
import { getAssignmentStore } from "@/server/storage";
import { getLimits, type CreationBudget } from "@/server/limits";
import { getIdentityState, type IdentityCache, type StoreBreaker } from "./cache";

/**
 * Resolve the one fictional identity for a repository, keyed by its numeric GitHub ID.
 * - Existing stored identity: returned unchanged (consistent read), never regenerated.
 * - None yet: a candidate is built from a server-generated seed and written with a
 *   conditional put; concurrent sessions converge on the single winner.
 * - Store unreachable, not configured, in cooldown after a failure, or the creation budget is
 *   spent: a deterministic PROVISIONAL identity is returned, clearly labeled, and nothing is
 *   written. It may differ from the eventual saved one. At most one write is attempted per call.
 * - Saved identities are cached in memory (they never change); provisional ones never are.
 * - Stored data that fails validation: reported as an error. It is never overwritten.
 */
export type ProvisionalReason =
  | "store_unavailable"
  | "store_not_configured"
  | "creation_disabled"
  | "budget_exceeded"
  | "client_budget_exceeded"
  | "not_created";

export type EntityResult =
  | { status: "persisted"; assignment: EntityAssignment; created: boolean }
  | { status: "provisional"; assignment: EntityAssignment; reason: ProvisionalReason }
  | { status: "error"; code: "stored_invalid"; message: string };

export type ResolveDeps = {
  store?: AssignmentStore | (() => AssignmentStore);
  newSeed?: () => string;
  now?: () => Date;
  timeoutMs?: number;
  /** Opaque rate-limit key for the requester (see limits/client-key). */
  clientKey?: string;
  budget?: CreationBudget;
  cache?: IdentityCache;
  breaker?: StoreBreaker;
  /** Never create an identity: look only. Used by chat so it cannot be a way to mass-create ghosts. */
  readOnly?: boolean;
};

const DEFAULT_TIMEOUT_MS = 4000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Identity store timed out.")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function logStoreProblem(err: unknown): void {
  const e = err as { name?: string; message?: string };
  console.error(`[entity] identity store problem: ${e.name ?? "Error"}: ${(e.message ?? "").replace(/\d{12}/g, "************")}`);
}

function candidateFor(repo: RepoMetadata, seed: string, now: Date): EntityAssignment {
  return assignmentFromIdentity(buildEntity(repoSignalsFromMetadata(repo), seed), now.toISOString());
}

export async function resolveEntityForRepo(repo: RepoMetadata, deps: ResolveDeps = {}): Promise<EntityResult> {
  const now = (deps.now ?? (() => new Date()))();
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cache = deps.cache ?? getIdentityState().cache;
  const breaker = deps.breaker ?? getIdentityState().breaker;
  const provisional = (reason: ProvisionalReason): EntityResult => ({
    status: "provisional",
    // Deterministic so a refresh shows the same provisional look; never written anywhere.
    assignment: candidateFor(repo, `provisional:${repo.repoId}`, now),
    reason,
  });

  const cached = cache.get(repo.repoId);
  if (cached) return { status: "persisted", assignment: cached, created: false };
  if (breaker.isOpen()) return provisional("store_unavailable");

  let store: AssignmentStore;
  try {
    const source = deps.store ?? getAssignmentStore;
    store = typeof source === "function" ? source() : source;
  } catch (err) {
    logStoreProblem(err);
    return provisional("store_not_configured");
  }

  try {
    const existing = await withTimeout(store.get(repo.repoId), timeoutMs);
    breaker.recordSuccess();
    if (existing) {
      cache.set(existing);
      return { status: "persisted", assignment: existing, created: false };
    }

    if (deps.readOnly) return provisional("not_created");

    // A new identity means a DynamoDB write: spend budget first, and never write when denied.
    const budget = (deps.budget ?? getLimits().creationBudget).tryConsume(deps.clientKey ?? "unknown");
    if (!budget.ok) return provisional(budget.reason);

    const seed = (deps.newSeed ?? randomUUID)();
    const result = await withTimeout(claimAssignment(store, candidateFor(repo, seed, now)), timeoutMs);
    cache.set(result.assignment);
    return { status: "persisted", assignment: result.assignment, created: result.created };
  } catch (err) {
    if (err instanceof StoredAssignmentError) {
      logStoreProblem(err);
      return {
        status: "error",
        code: "stored_invalid",
        message: "The saved identity for this repository could not be read. It was left untouched.",
      };
    }
    logStoreProblem(err);
    breaker.recordFailure();
    return provisional("store_unavailable");
  }
}
