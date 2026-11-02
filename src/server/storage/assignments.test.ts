import { GetItemCommand, PutItemCommand, type AttributeValue } from "@aws-sdk/client-dynamodb";
import { describe, expect, it } from "vitest";
import { buildEntity } from "@/config/entities";
import { assignmentFromIdentity, type EntityAssignment } from "@/domain/entity";
import {
  claimAssignment,
  createMemoryAssignmentStore,
  parseStoredAssignment,
  StoredAssignmentError,
  type AssignmentStore,
} from "./assignments";
import { assignmentsTableName, createDynamoAssignmentStore, createDynamoClient, type DynamoSender } from "./dynamo-assignments";

const candidate = (repoId: number, seed: string): EntityAssignment =>
  assignmentFromIdentity(buildEntity({ repoId, repoName: "o/r" }, seed), "2026-10-30T12:00:00.000Z");

/** Fake DynamoDB: honors attribute_not_exists atomically. No network, no AWS. */
function fakeDynamo() {
  const table = new Map<string, Record<string, AttributeValue>>();
  const commands: unknown[] = [];
  const client = {
    async send(command: unknown) {
      commands.push(command);
      await Promise.resolve(); // let concurrent callers interleave
      if (command instanceof PutItemCommand) {
        const item = command.input.Item!;
        const key = item.repoId.N!;
        if (command.input.ConditionExpression === "attribute_not_exists(repoId)" && table.has(key)) {
          throw Object.assign(new Error("The conditional request failed"), { name: "ConditionalCheckFailedException" });
        }
        table.set(key, item);
        return {};
      }
      if (command instanceof GetItemCommand) {
        return { Item: table.get(command.input.Key!.repoId.N!) };
      }
      throw new Error("unexpected command");
    },
  } as unknown as DynamoSender;
  return { client, table, commands };
}

const stores: [string, () => { store: AssignmentStore; poison?: (repoId: number, raw: Record<string, AttributeValue>) => void }][] = [
  ["memory store", () => ({ store: createMemoryAssignmentStore() })],
  [
    "dynamo store (fake backend)",
    () => {
      const f = fakeDynamo();
      return { store: createDynamoAssignmentStore(f.client, "gitghost-test"), poison: (id, raw) => f.table.set(String(id), raw) };
    },
  ],
];

describe.each(stores)("first-write-wins: %s", (_name, make) => {
  it("stores the first assignment and returns it unchanged on read", async () => {
    const { store } = make();
    const a = candidate(1663468, "seed-a");
    expect(await store.get(1663468)).toBeNull();
    expect(await claimAssignment(store, a)).toEqual({ created: true, assignment: a });
    expect(await store.get(1663468)).toEqual(a);
  });

  it("a later, different candidate loses and gets the stored winner back", async () => {
    const { store } = make();
    const first = candidate(7, "seed-first");
    const second = candidate(7, "seed-second");
    expect(second).not.toEqual(first);
    await claimAssignment(store, first);
    const result = await claimAssignment(store, second);
    expect(result.created).toBe(false);
    expect(result.assignment).toEqual(first);
    expect(await store.get(7)).toEqual(first);
  });

  it("20 concurrent first summons converge on exactly one assignment", async () => {
    const { store } = make();
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => claimAssignment(store, candidate(99, `racer-${i}`))));
    expect(results.filter((r) => r.created)).toHaveLength(1);
    const winner = results.find((r) => r.created)!.assignment;
    for (const r of results) expect(r.assignment).toEqual(winner);
    expect(await store.get(99)).toEqual(winner);
  });

  it("different repositories do not interfere", async () => {
    const { store } = make();
    const [a, b] = [candidate(1, "s"), candidate(2, "s")];
    await Promise.all([claimAssignment(store, a), claimAssignment(store, b)]);
    expect(await store.get(1)).toEqual(a);
    expect(await store.get(2)).toEqual(b);
  });

  it("rejects invalid candidates before touching storage", async () => {
    const { store } = make();
    await expect(claimAssignment(store, { ...candidate(5, "s"), originId: "wizard" })).rejects.toThrow();
    await expect(claimAssignment(store, { ...candidate(5, "s"), schemaVersion: 999 })).rejects.toThrow();
    expect(await store.get(5)).toBeNull();
  });
});

describe("hostile or stale stored data", () => {
  it("rejects bad JSON, schema violations, version drift and wrong-repo rows without overwriting", () => {
    const good = candidate(10, "s");
    expect(() => parseStoredAssignment("{nope", 10)).toThrow(StoredAssignmentError);
    expect(() => parseStoredAssignment(JSON.stringify({ ...good, originId: "wizard" }), 10)).toThrow(StoredAssignmentError);
    expect(() => parseStoredAssignment(JSON.stringify({ ...good, schemaVersion: good.schemaVersion + 1 }), 10)).toThrow(StoredAssignmentError);
    expect(() => parseStoredAssignment(JSON.stringify(good), 11)).toThrow(/different repository/);
    expect(parseStoredAssignment(JSON.stringify(good), 10)).toEqual(good);
  });

  it("dynamo store surfaces a corrupt row instead of replacing it", async () => {
    const f = fakeDynamo();
    f.table.set("10", { repoId: { N: "10" }, assignment: { S: "{corrupt" } });
    const store = createDynamoAssignmentStore(f.client, "gitghost-test");
    await expect(store.get(10)).rejects.toBeInstanceOf(StoredAssignmentError);
    await expect(claimAssignment(store, candidate(10, "s"))).rejects.toBeInstanceOf(StoredAssignmentError);
    expect(f.table.get("10")!.assignment.S).toBe("{corrupt");
  });

  it("dynamo store rejects a row whose key attribute disagrees with the requested repo", async () => {
    const f = fakeDynamo();
    f.table.set("10", { repoId: { N: "11" }, assignment: { S: JSON.stringify(candidate(10, "s")) } });
    await expect(createDynamoAssignmentStore(f.client, "t").get(10)).rejects.toBeInstanceOf(StoredAssignmentError);
  });
});

describe("dynamo request shape", () => {
  it("puts with a not-exists condition and reads consistently", async () => {
    const f = fakeDynamo();
    const store = createDynamoAssignmentStore(f.client, "gitghost-test");
    const a = candidate(42, "s");
    await claimAssignment(store, a);
    await claimAssignment(store, candidate(42, "other")); // loses, triggers consistent read
    const put = f.commands.find((c) => c instanceof PutItemCommand) as PutItemCommand;
    expect(put.input.TableName).toBe("gitghost-test");
    expect(put.input.ConditionExpression).toBe("attribute_not_exists(repoId)");
    expect(put.input.Item!.repoId).toEqual({ N: "42" });
    const get = f.commands.find((c) => c instanceof GetItemCommand) as GetItemCommand;
    expect(get.input.ConsistentRead).toBe(true);
  });

  it("createDynamoClient needs an explicit region and rejects an account-number profile", () => {
    expect(() => createDynamoClient(undefined, {})).toThrow(/AWS_REGION/);
    expect(() => createDynamoClient("us-east-2", { AWS_PROFILE: "123456789012" })).toThrow(/account number/);
    expect(() => createDynamoClient("us-east-2", { AWS_PROFILE: "default" })).not.toThrow();
  });

  it("propagates non-conflict errors (throttling) instead of guessing", async () => {
    const client = {
      send: async () => {
        throw Object.assign(new Error("slow down"), { name: "ProvisionedThroughputExceededException" });
      },
    } as unknown as DynamoSender;
    await expect(claimAssignment(createDynamoAssignmentStore(client, "t"), candidate(3, "s"))).rejects.toThrow("slow down");
  });

  it("requires a valid table name from the environment", () => {
    expect(() => assignmentsTableName({})).toThrow();
    expect(() => assignmentsTableName({ DYNAMODB_TABLE: "bad name!" })).toThrow();
    expect(assignmentsTableName({ DYNAMODB_TABLE: "gitghost-entity-assignments" })).toBe("gitghost-entity-assignments");
    // legacy alias still works; the canonical name wins when both are set
    expect(assignmentsTableName({ GITGHOST_ASSIGNMENTS_TABLE: "legacy-table" })).toBe("legacy-table");
    expect(assignmentsTableName({ DYNAMODB_TABLE: "new-table", GITGHOST_ASSIGNMENTS_TABLE: "legacy-table" })).toBe("new-table");
  });
});
