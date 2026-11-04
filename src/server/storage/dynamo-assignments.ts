import { awsRegion, withAwsCredentials } from "@/server/aws-credentials";
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  type AttributeValue,
} from "@aws-sdk/client-dynamodb";
import type { EntityAssignment } from "@/domain/entity";
import {
  parseStoredAssignment,
  StoredAssignmentError,
  type AssignmentStore,
} from "./assignments";

/** Only the `send` method is needed, which keeps this testable without AWS. */
export type DynamoSender = Pick<DynamoDBClient, "send">;

/** Canonical env var. `GITGHOST_ASSIGNMENTS_TABLE` is accepted as a legacy alias. */
export const TABLE_ENV = "DYNAMODB_TABLE";
export const LEGACY_TABLE_ENV = "GITGHOST_ASSIGNMENTS_TABLE";

export function assignmentsTableName(env: Record<string, string | undefined> = process.env): string {
  const name = env[TABLE_ENV] ?? env[LEGACY_TABLE_ENV];
  if (!name || !/^[A-Za-z0-9_.-]{3,255}$/.test(name)) {
    throw new Error(`${TABLE_ENV} must be set to a valid DynamoDB table name.`);
  }
  return name;
}

/**
 * Uses the AWS default credential chain, Vercel OIDC role credentials when AWS_ROLE_ARN is set, or the scoped IAM
 * user's GITGHOST_AWS_* keys; credentials never appear in code.
 * Fails fast on an AWS_PROFILE that is an account number (a known misconfiguration).
 */
export function createDynamoClient(
  region?: string,
  env: Record<string, string | undefined> = process.env,
): DynamoDBClient {
  region ??= awsRegion(env);
  if (!region) throw new Error("AWS_REGION must be set explicitly; no default region is assumed.");
  if (/^\d{12}$/.test(env.AWS_PROFILE?.trim() ?? "")) {
    throw new Error("AWS_PROFILE looks like an account number, not a profile name. Unset it or use a configured profile name.");
  }
  // Few retries so an unreachable table fails fast instead of stalling a page render.
  return new DynamoDBClient(withAwsCredentials({ region, maxAttempts: 2 }, env));
}

function readAssignment(item: Record<string, AttributeValue> | undefined, repoId: number): EntityAssignment {
  const json = item?.assignment?.S;
  const keyAttr = item?.repoId?.N;
  if (json === undefined || keyAttr !== String(repoId)) {
    throw new StoredAssignmentError("Stored item is malformed.", repoId);
  }
  return parseStoredAssignment(json, repoId);
}

export function createDynamoAssignmentStore(client: DynamoSender, tableName: string): AssignmentStore {
  async function get(repoId: number): Promise<EntityAssignment | null> {
    const res = await client.send(
      new GetItemCommand({
        TableName: tableName,
        Key: { repoId: { N: String(repoId) } },
        ConsistentRead: true, // the loser of a race must see the winner
      }),
    );
    return res.Item ? readAssignment(res.Item, repoId) : null;
  }

  return {
    get,
    async putIfAbsent(assignment) {
      try {
        await client.send(
          new PutItemCommand({
            TableName: tableName,
            Item: {
              repoId: { N: String(assignment.repoId) },
              schemaVersion: { N: String(assignment.schemaVersion) },
              assignedAt: { S: assignment.assignedAt },
              assignment: { S: JSON.stringify(assignment) },
            },
            ConditionExpression: "attribute_not_exists(repoId)",
          }),
        );
        return { created: true, assignment };
      } catch (err) {
        if ((err as { name?: string }).name !== "ConditionalCheckFailedException") throw err;
        const winner = await get(assignment.repoId);
        if (!winner) {
          // Condition failed but nothing is readable: do not guess or overwrite.
          throw new StoredAssignmentError("Assignment vanished after a write conflict.", assignment.repoId);
        }
        return { created: false, assignment: winner };
      }
    },
  };
}
