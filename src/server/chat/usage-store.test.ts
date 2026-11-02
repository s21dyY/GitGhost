import { GetItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { describe, expect, it } from "vitest";
import { createFakeUsageDynamo } from "./test-support";
import { createDynamoUsageStore } from "./usage-dynamo";
import { createMemoryUsageStore, UsageStoreError, type UsageStore } from "./usage-store";

type Make = () => { store: UsageStore; advance: (ms: number) => void; fake?: ReturnType<typeof createFakeUsageDynamo> };

const makers: [string, Make][] = [
  ["memory", () => { let t = 1_000_000; return { store: createMemoryUsageStore(() => t), advance: (ms) => { t += ms; } }; }],
  ["dynamodb (fake backend)", () => { let t = 1_000_000; const fake = createFakeUsageDynamo(); return { store: createDynamoUsageStore(fake.client, "gitghost-usage-test", () => t), advance: (ms) => { t += ms; }, fake }; }],
];

describe.each(makers)("usage store contract: %s", (_n, make) => {
  it("incrementIfBelow admits exactly `limit` of many concurrent callers", async () => {
    const { store } = make();
    const results = await Promise.all(Array.from({ length: 40 }, () => store.incrementIfBelow("k", 5, 60)));
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    expect((await store.incrementIfBelow("k", 5, 60)).ok).toBe(false);
  });

  it("a zero limit always refuses (even for the first caller)", async () => {
    const { store } = make();
    expect((await store.incrementIfBelow("z", 0, 60)).ok).toBe(false);
  });

  it("addIfWithin never lets concurrent reservations exceed the cap", async () => {
    const { store } = make();
    const results = await Promise.all(Array.from({ length: 30 }, () => store.addIfWithin("b", 300, 1000, 60)));
    expect(results.filter((r) => r.ok)).toHaveLength(3); // 3 x 300 = 900 <= 1000 < 1200
    const last = await store.addIfWithin("b", 100, 1000, 60);
    expect(last).toMatchObject({ ok: true, total: 1000 });
    expect((await store.addIfWithin("b", 1, 1000, 60)).ok).toBe(false);
  });

  it("addIfWithin refuses a single amount larger than the cap, and a zero cap", async () => {
    const { store } = make();
    expect((await store.addIfWithin("c", 5000, 1000, 60)).ok).toBe(false);
    expect((await store.addIfWithin("d", 1, 0, 60)).ok).toBe(false);
  });

  it("add (refund) frees budget for later reservations", async () => {
    const { store } = make();
    await store.addIfWithin("e", 900, 1000, 60);
    expect((await store.addIfWithin("e", 900, 1000, 60)).ok).toBe(false);
    await store.add("e", -800, 60);
    expect((await store.addIfWithin("e", 900, 1000, 60)).ok).toBe(true);
  });

  it("leases cap concurrency, are owner-released, and expire if the holder crashes", async () => {
    const { store, advance } = make();
    const got = await Promise.all(Array.from({ length: 6 }, (_, i) => store.acquireLease("L", 2, 30_000, `o${i}`)));
    expect(got.filter((s) => s !== null)).toHaveLength(2);
    const holders = got.map((s, i) => [s, `o${i}`] as const).filter(([s]) => s !== null);
    await store.releaseLease("L", holders[0][0]!, "someone-else"); // wrong owner: no effect
    expect(await store.acquireLease("L", 2, 30_000, "late")).toBeNull();
    await store.releaseLease("L", holders[0][0]!, holders[0][1]);
    expect(await store.acquireLease("L", 2, 30_000, "after-release")).not.toBeNull();
    advance(30_001); // crashed holders stop blocking
    expect(await store.acquireLease("L", 2, 30_000, "after-expiry")).not.toBeNull();
  });

  it("getFlag is false unless an operator set it", async () => {
    const { store } = make();
    expect(await store.getFlag("KILL#bedrock")).toBe(false);
  });
});

describe("memory store expiry", () => {
  it("counters expire after their TTL", async () => {
    let t = 0;
    const s = createMemoryUsageStore(() => t);
    await s.incrementIfBelow("k", 1, 60);
    expect((await s.incrementIfBelow("k", 1, 60)).ok).toBe(false);
    t = 61_000;
    expect((await s.incrementIfBelow("k", 1, 60)).ok).toBe(true);
  });
});

describe("dynamodb request shapes and failure handling", () => {
  it("uses single conditional UpdateItem calls with a TTL attribute", async () => {
    const fake = createFakeUsageDynamo();
    const store = createDynamoUsageStore(fake.client, "gitghost-usage-test", () => 5_000_000);
    await store.incrementIfBelow("RL#x", 5, 120);
    await store.addIfWithin("BUDGET#d", 6875, 1_000_000, 100);
    await store.add("BUDGET#d", -6000, 100);
    const [inc, spend, refund] = fake.commands as UpdateItemCommand[];
    expect(inc.input.TableName).toBe("gitghost-usage-test");
    expect(inc.input.ConditionExpression).toBe("attribute_not_exists(#c) OR #c < :limit");
    expect(inc.input.UpdateExpression).toContain("if_not_exists");
    expect(inc.input.ExpressionAttributeValues![":exp"]).toEqual({ N: String(5000 + 120) });
    expect(spend.input.ConditionExpression).toBe("attribute_not_exists(#t) OR #t <= :room");
    expect(spend.input.ExpressionAttributeValues![":room"]).toEqual({ N: String(1_000_000 - 6875) });
    expect(refund.input.ConditionExpression).toBeUndefined();
    expect(refund.input.UpdateExpression).toContain("ADD #t :delta");
    expect(fake.value("BUDGET#d", "v")).toBe(875);
  });

  it("reads the kill switch with a strongly consistent GetItem", async () => {
    const fake = createFakeUsageDynamo();
    fake.setFlag("KILL#bedrock", true);
    const store = createDynamoUsageStore(fake.client, "t");
    expect(await store.getFlag("KILL#bedrock")).toBe(true);
    const get = fake.commands.find((c) => c instanceof GetItemCommand) as GetItemCommand;
    expect(get.input.ConsistentRead).toBe(true);
  });

  it("wraps infrastructure failures in UsageStoreError (not a limit result)", async () => {
    const fake = createFakeUsageDynamo();
    fake.failAll("ProvisionedThroughputExceededException");
    const store = createDynamoUsageStore(fake.client, "t");
    await expect(store.incrementIfBelow("k", 5, 60)).rejects.toBeInstanceOf(UsageStoreError);
    await expect(store.addIfWithin("k", 1, 10, 60)).rejects.toBeInstanceOf(UsageStoreError);
    await expect(store.add("k", 1, 60)).rejects.toBeInstanceOf(UsageStoreError);
    await expect(store.acquireLease("L", 2, 1000, "o")).rejects.toBeInstanceOf(UsageStoreError);
    await expect(store.getFlag("k")).rejects.toBeInstanceOf(UsageStoreError);
  });
});

describe("lease expiry is decided by application logic, not by DynamoDB TTL deletion", () => {
  it("the acquire condition compares stored lease time with the caller's clock and never reads the TTL attribute", async () => {
    const fake = createFakeUsageDynamo();
    const store = createDynamoUsageStore(fake.client, "t", () => 10_000);
    await store.acquireLease("LEASE#x", 1, 30_000, "a");
    const cmd = fake.commands[0] as UpdateItemCommand;
    expect(cmd.input.ConditionExpression).toBe("attribute_not_exists(leaseUntilMs) OR leaseUntilMs < :now");
    expect(cmd.input.ConditionExpression).not.toContain("expiresAt");
  });

  it("a crashed holder's lease stops blocking at its own deadline even though the item was never deleted", async () => {
    let t = 10_000;
    const fake = createFakeUsageDynamo();
    const store = createDynamoUsageStore(fake.client, "t", () => t);
    expect(await store.acquireLease("LEASE#x", 1, 30_000, "crashed")).toBe(0);
    expect(fake.items.has("LEASE#x#0")).toBe(true); // TTL has not removed it (the fake never does)
    t = 39_999;
    expect(await store.acquireLease("LEASE#x", 1, 30_000, "next")).toBeNull();
    t = 40_001;
    expect(await store.acquireLease("LEASE#x", 1, 30_000, "next")).toBe(0);
    expect(fake.items.has("LEASE#x#0")).toBe(true);
  });

  it("the TTL attribute is far later than the lease, so TTL cleanup can never shorten a live lease", async () => {
    const fake = createFakeUsageDynamo();
    const store = createDynamoUsageStore(fake.client, "t", () => 1_000_000);
    await store.acquireLease("LEASE#x", 1, 30_000, "a");
    const leaseUntilSec = Number(fake.items.get("LEASE#x#0")!.leaseUntilMs.N) / 1000;
    expect(Number(fake.items.get("LEASE#x#0")!.expiresAt.N)).toBeGreaterThan(leaseUntilSec + 3000);
  });

  it("a late release by an old owner cannot free a slot that someone else now holds", async () => {
    let t = 0;
    const store = createDynamoUsageStore(createFakeUsageDynamo().client, "t", () => t);
    const slot = await store.acquireLease("L", 1, 1000, "old");
    t = 2000;
    expect(await store.acquireLease("L", 1, 1000, "new")).toBe(0);
    await store.releaseLease("L", slot!, "old");
    expect(await store.acquireLease("L", 1, 1000, "third")).toBeNull();
  });

  it("window counters live under per-window keys, so a surviving old item never affects a new window", async () => {
    const store = createDynamoUsageStore(createFakeUsageDynamo().client, "t");
    expect((await store.incrementIfBelow("RL#chat#c#100", 1, 120)).ok).toBe(true);
    expect((await store.incrementIfBelow("RL#chat#c#101", 1, 120)).ok).toBe(true);
  });
});
