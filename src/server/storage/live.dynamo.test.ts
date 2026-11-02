import { describe, expect, it } from "vitest";
import { buildEntity } from "@/config/entities";
import { assignmentFromIdentity } from "@/domain/entity";
import { claimAssignment } from "./assignments";
import { assignmentsTableName, createDynamoAssignmentStore, createDynamoClient } from "./dynamo-assignments";

/**
 * Opt-in live check against the real table (billable but tiny: a few request units).
 *   GITGHOST_LIVE_DYNAMO=1 AWS_REGION=us-east-2 DYNAMODB_TABLE=gitghost-entity-assignments \
 *     npx vitest run src/server/storage/live.dynamo.test.ts
 * Never deletes or overwrites. The reserved ID is far above any real GitHub repository ID
 * (about 9.007e15; GitHub IDs are below 2e9 today), so it cannot collide with real data.
 * The reserved record stays in the table afterwards; re-runs verify it instead of rewriting it.
 */
const RESERVED_REPO_ID = 9_007_199_254_000_001;
const AT = "2026-10-30T12:00:00.000Z";

describe.skipIf(process.env.GITGHOST_LIVE_DYNAMO !== "1")("live DynamoDB first-write-wins (reserved test repoId)", () => {
  it("keeps the first assignment, rejects the conflicting one, and rereads consistently", async () => {
    expect(/^\d{12}$/.test(process.env.AWS_PROFILE ?? "")).toBe(false);
    const store = createDynamoAssignmentStore(createDynamoClient(), assignmentsTableName());

    const first = assignmentFromIdentity(buildEntity({ repoId: RESERVED_REPO_ID, repoName: "reserved/test" }, "live-test-first"), AT);
    const conflicting = assignmentFromIdentity(buildEntity({ repoId: RESERVED_REPO_ID, repoName: "reserved/test" }, "live-test-conflict"), AT);
    expect(conflicting).not.toEqual(first);

    const before = await store.get(RESERVED_REPO_ID);
    const a = await claimAssignment(store, first);
    // First run: the conditional write creates it. Later runs: it already exists and wins unchanged.
    expect(a.created).toBe(before === null);
    expect(a.assignment).toEqual(before ?? first);

    const winner = a.assignment;
    const b = await claimAssignment(store, conflicting);
    expect(b.created).toBe(false);
    expect(b.assignment).toEqual(winner);

    const reread = await store.get(RESERVED_REPO_ID); // ConsistentRead: true
    expect(reread).toEqual(winner);
    expect(reread).not.toEqual(conflicting);
  }, 30_000);
});
