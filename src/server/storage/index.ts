import { createDynamoAssignmentStore, assignmentsTableName, createDynamoClient } from "./dynamo-assignments";
import type { AssignmentStore } from "./assignments";

export * from "./assignments";
export { assignmentsTableName } from "./dynamo-assignments";

let cached: AssignmentStore | undefined;

/**
 * The configured durable assignment store (DynamoDB). Reads DYNAMODB_TABLE and
 * AWS_REGION from the environment and uses the default AWS credential chain.
 * Throws if either is missing: there is no silent fallback to memory, because a
 * non-durable store would break first-write-wins across server instances.
 * Not yet used by any route (the character engine arrives in Milestone 2A).
 */
export function getAssignmentStore(): AssignmentStore {
  cached ??= createDynamoAssignmentStore(createDynamoClient(), assignmentsTableName());
  return cached;
}
