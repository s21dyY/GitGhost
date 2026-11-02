import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { UsageStoreError, type UsageStore } from "./usage-store";

/**
 * DynamoDB-backed UsageStore. Needs a table that DOES NOT EXIST YET (see docs/COST_CONTROLS.md):
 *   partition key `pk` (String); TTL enabled on attribute `expiresAt` (Number, epoch seconds).
 * Runtime IAM needed: dynamodb:UpdateItem and dynamodb:GetItem on that table only.
 * Nothing here creates or changes AWS resources.
 */
/** Counters and budgets share ONE numeric attribute, `v`, so refunds (`add`) always hit the same value. */
export type UsageSender = Pick<DynamoDBClient, "send">;

const isConditionFailure = (e: unknown) => (e as { name?: string }).name === "ConditionalCheckFailedException";

export function createDynamoUsageStore(client: UsageSender, tableName: string, now: () => number = Date.now): UsageStore {
  const exp = (ttlSec: number) => String(Math.floor(now() / 1000) + ttlSec);
  const wrap = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof UsageStoreError) throw err;
      throw new UsageStoreError(`Usage store failed (${(err as { name?: string }).name ?? "Error"}).`);
    }
  };

  return {
    kind: "dynamodb",

    incrementIfBelow: (key, limit, ttlSec) =>
      wrap(async () => {
        if (limit <= 0) return { ok: false, count: 0 };
        try {
          const res = await client.send(
            new UpdateItemCommand({
              TableName: tableName,
              Key: { pk: { S: key } },
              UpdateExpression: "SET #c = if_not_exists(#c, :zero) + :one, expiresAt = :exp",
              ConditionExpression: "attribute_not_exists(#c) OR #c < :limit",
              ExpressionAttributeNames: { "#c": "v" },
              ExpressionAttributeValues: { ":zero": { N: "0" }, ":one": { N: "1" }, ":limit": { N: String(limit) }, ":exp": { N: exp(ttlSec) } },
              ReturnValues: "UPDATED_NEW",
            }),
          );
          return { ok: true, count: Number(res.Attributes?.v?.N ?? "0") };
        } catch (err) {
          if (isConditionFailure(err)) return { ok: false, count: limit };
          throw err;
        }
      }),

    addIfWithin: (key, amount, cap, ttlSec) =>
      wrap(async () => {
        const room = cap - amount;
        if (!Number.isInteger(amount) || amount < 0 || room < 0) return { ok: false, total: 0 };
        try {
          const res = await client.send(
            new UpdateItemCommand({
              TableName: tableName,
              Key: { pk: { S: key } },
              UpdateExpression: "SET #t = if_not_exists(#t, :zero) + :amt, expiresAt = :exp",
              ConditionExpression: "attribute_not_exists(#t) OR #t <= :room",
              ExpressionAttributeNames: { "#t": "v" },
              ExpressionAttributeValues: { ":zero": { N: "0" }, ":amt": { N: String(amount) }, ":room": { N: String(room) }, ":exp": { N: exp(ttlSec) } },
              ReturnValues: "UPDATED_NEW",
            }),
          );
          return { ok: true, total: Number(res.Attributes?.v?.N ?? "0") };
        } catch (err) {
          if (isConditionFailure(err)) return { ok: false, total: cap };
          throw err;
        }
      }),

    add: (key, delta, ttlSec) =>
      wrap(async () => {
        await client.send(
          new UpdateItemCommand({
            TableName: tableName,
            Key: { pk: { S: key } },
            UpdateExpression: "SET expiresAt = :exp ADD #t :delta",
            ExpressionAttributeNames: { "#t": "v" },
            ExpressionAttributeValues: { ":exp": { N: exp(ttlSec) }, ":delta": { N: String(delta) } },
          }),
        );
      }),

    acquireLease: (prefix, slots, leaseMs, owner) =>
      wrap(async () => {
        const t = now();
        for (let i = 0; i < slots; i++) {
          try {
            await client.send(
              new UpdateItemCommand({
                TableName: tableName,
                Key: { pk: { S: `${prefix}#${i}` } },
                UpdateExpression: "SET leaseUntilMs = :until, #o = :owner, expiresAt = :exp",
                ConditionExpression: "attribute_not_exists(leaseUntilMs) OR leaseUntilMs < :now",
                ExpressionAttributeNames: { "#o": "owner" },
                ExpressionAttributeValues: {
                  ":until": { N: String(t + leaseMs) },
                  ":now": { N: String(t) },
                  ":owner": { S: owner },
                  ":exp": { N: exp(Math.ceil(leaseMs / 1000) + 3600) },
                },
              }),
            );
            return i;
          } catch (err) {
            if (!isConditionFailure(err)) throw err;
          }
        }
        return null;
      }),

    releaseLease: (prefix, slot, owner) =>
      wrap(async () => {
        try {
          await client.send(
            new UpdateItemCommand({
              TableName: tableName,
              Key: { pk: { S: `${prefix}#${slot}` } },
              UpdateExpression: "SET leaseUntilMs = :zero",
              ConditionExpression: "#o = :owner",
              ExpressionAttributeNames: { "#o": "owner" },
              ExpressionAttributeValues: { ":zero": { N: "0" }, ":owner": { S: owner } },
            }),
          );
        } catch (err) {
          if (!isConditionFailure(err)) throw err; // someone else holds it now: nothing to release
        }
      }),

    getFlag: (key) =>
      wrap(async () => {
        const res = await client.send(new GetItemCommand({ TableName: tableName, Key: { pk: { S: key } }, ConsistentRead: true }));
        return res.Item?.on?.BOOL === true;
      }),
  };
}
