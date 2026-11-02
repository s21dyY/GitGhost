# DynamoDB design: entity assignments

Status: **table `gitghost-entity-assignments` exists in `us-east-2` (created manually; verified ACTIVE, key `repoId` N only, PAY_PER_REQUEST, deletion protection on, PITR off, no indexes).** A live first-write-wins test passed once against it using the reserved test ID 9007199254000001 (see `KIRO_LOG.md`). The store is not wired to any route yet. `us-east-1` must not be used: an organization service control policy denies DynamoDB there.

## Purpose
Persist one fictional entity assignment per numeric GitHub repository ID, first write wins. Two simultaneous first summons must converge on one identity (BUILD.md sections 5 and 11). Assignments never contain repository facts, session data, self-claims or viewer identity.

## Table
| Setting | Value |
|---|---|
| Name | `gitghost-entity-assignments` (from env `DYNAMODB_TABLE`; legacy alias `GITGHOST_ASSIGNMENTS_TABLE`) |
| Region | **`us-east-2` recommended** (see below). Confirm before creating |
| Partition key | `repoId` (Number). No sort key, no GSIs |
| Billing | On-demand (`PAY_PER_REQUEST`) |
| Encryption | AWS-owned default key |
| TTL | None. Assignments are permanent by design |
| Point-in-time recovery | Off by default (adds a recurring charge). Turn on only if the team decides losing assignments is unacceptable |
| Deletion protection | Recommended on for the deployed table |

Item (about 540 bytes at most in a 2,000-sample estimate, well under 1 KB):
- `repoId` N, the key
- `schemaVersion` N (config version, for migrations and ops queries)
- `assignedAt` S (ISO timestamp)
- `assignment` S (JSON of `EntityAssignment`)

The full record is stored as one validated JSON string so the zod schema stays the single source of truth. Reads re-validate it (`parseStoredAssignment`), check that the stored `repoId` matches the key, and fail loudly on bad JSON, unknown IDs, version drift or wrong-repo data. The store never "repairs" or overwrites a bad row. Version drift needs an explicit migration.

### Region
A read-only `dynamodb:ListTables` on 2026-10-30 returned an empty list in `us-east-2` and `AccessDeniedException` in `us-east-1` with an explicit deny from an organization service control policy. Do not work around an SCP. Use `us-east-2` for the table, and keep `AWS_REGION` consistent with it (the default profile and `.env.local` already say `us-east-2`). Bedrock `list` calls worked in both regions, but whether `InvokeModel` is allowed in each is untested.

## Write and read rules
- **Create:** `PutItem` with `ConditionExpression: attribute_not_exists(repoId)`. This is atomic: exactly one concurrent writer succeeds.
- **Conflict:** on `ConditionalCheckFailedException`, do a `GetItem` with `ConsistentRead: true` and return the stored winner. The loser's candidate is discarded.
- **Other errors** (throttling, network, auth) propagate. Callers must not invent an identity. BUILD.md allows a deterministic *provisional* fallback only when the durable store is down, and only if it is labeled provisional and never presented as durable.
- No update or delete operations exist. Changing an identity is a migration, not a write path.

## Cost review (nothing has been incurred)
Figures below are request-unit counts, not prices. Check current AWS pricing for your region before creating the table; free-tier eligibility is not assumed.
- First summon of a repo: 1 write request unit (item under 1 KB) for the conditional put.
- Losing a race: the failed conditional put is still billed as a write, plus 1 strongly consistent read request unit (item under 4 KB).
- Every later séance: 1 strongly consistent read request unit (or half that if eventually consistent reads are used where staleness is harmless).
- Storage: well under 1 MB for thousands of repositories.
- On-demand has no idle charge. Expected cost for a contest-scale demo is very small; the larger cost risk is Bedrock inference, which this table does not affect.

## Creating the table (reference only; the table was already created manually)
```bash
aws dynamodb create-table \
  --table-name gitghost-entity-assignments \
  --attribute-definitions AttributeName=repoId,AttributeType=N \
  --key-schema AttributeName=repoId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --deletion-protection-enabled \
  --region us-east-2 --profile <your-profile>
```
Then set `GITGHOST_ASSIGNMENTS_TABLE` and grant the runtime role only `dynamodb:GetItem` and `dynamodb:PutItem` on that table's ARN.

## What exists in code
- `src/server/storage/assignments.ts`: `AssignmentStore` interface, `claimAssignment`, `parseStoredAssignment`, in-memory store.
- `src/server/storage/dynamo-assignments.ts`: DynamoDB implementation, table-name check, client factory using the default AWS credential chain.
- `src/server/storage/assignments.test.ts`: first-write-wins, 20-way concurrency, hostile stored data and request-shape tests on both stores. DynamoDB behavior is simulated by a fake that honors `attribute_not_exists`; it does not prove real DynamoDB behavior.
- `src/server/storage/index.ts`: `getAssignmentStore()` builds the configured DynamoDB store from `DYNAMODB_TABLE` and `AWS_REGION` (no memory fallback).
- `src/server/storage/live.dynamo.test.ts`: opt-in live test (`GITGHOST_LIVE_DYNAMO=1`) on reserved repoId 9007199254000001. It never deletes or overwrites; that one record stays in the table.
- Not wired to any route or page. No character is created by the app yet.

## Bedrock access check
Verified read-only on 2026-10-30 (details in `KIRO_LOG.md`): `get-foundation-model-availability` for `anthropic.claude-haiku-4-5-20251001-v1:0` reports `authorizationStatus: AUTHORIZED`, `entitlementAvailability: AVAILABLE`, `regionAvailability: AVAILABLE` in both `us-east-1` and `us-east-2`. This model lists only `INFERENCE_PROFILE` support, so Converse needs the profile ID `us.anthropic.claude-haiku-4-5-20251001-v1:0` (ACTIVE, routes across us-east-1, us-east-2, us-west-2), not the bare model ID. No inference has been run yet.

Opt-in billable smoke test (one call, `maxTokens` 16), refuses unless all three conditions hold:
```bash
# in .env.local: LIVE_GENERATION_ENABLED=1, AWS_REGION=us-east-2, BEDROCK_MODEL_ID=us.anthropic.claude-haiku-4-5-20251001-v1:0
node --env-file=.env.local scripts/bedrock-smoke.ts --i-approve-one-billable-call
```
