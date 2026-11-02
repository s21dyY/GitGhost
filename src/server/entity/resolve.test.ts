import { describe, expect, it, vi } from "vitest";
import { CONFIG_VERSION } from "@/config/entities";
import { EntityAssignmentSchema } from "@/domain/entity";
import type { RepoMetadata } from "@/domain/repo";
import { claimAssignment, createMemoryAssignmentStore, StoredAssignmentError, type AssignmentStore } from "@/server/storage/assignments";
import { createCreationBudget } from "@/server/limits";
import { createIdentityCache, createStoreBreaker } from "./cache";
import { resolveEntityForRepo } from "./resolve";

const repo = (repoId = 1663468, over: Partial<RepoMetadata> = {}): RepoMetadata => ({
  repoId, owner: "mozilla", name: "pdf.js", fullName: "mozilla/pdf.js", htmlUrl: "https://github.com/mozilla/pdf.js",
  description: "A PDF viewer", defaultBranch: "master", archived: false, language: "JavaScript", stars: 1, license: null,
  pushedAt: null, createdAt: "2011-03-04T05:06:07.000Z", topics: [], ...over,
});
const NOW = () => new Date("2026-10-30T12:00:00Z");
// Fresh cache, breaker and a roomy budget per call, so tests never share global state.
const open = () => createCreationBudget({ enabled: true, perHour: 1000, perClientPerHour: 1000 });
import type { ResolveDeps } from "./resolve";
const isolated = (deps: ResolveDeps = {}): ResolveDeps => ({ cache: createIdentityCache(), breaker: createStoreBreaker(), budget: open(), ...deps });
let n = 0;
const seeds = () => `seed-${++n}`;

describe("first summon creates exactly one saved identity", () => {
  it("stores a valid assignment keyed by the numeric repo id, tied to current config", async () => {
    const store = createMemoryAssignmentStore();
    const r = await resolveEntityForRepo(repo(), isolated({ store, newSeed: () => "s1", now: NOW }));
    expect(r.status).toBe("persisted");
    if (r.status !== "persisted") return;
    expect(r.created).toBe(true);
    expect(r.assignment.repoId).toBe(1663468);
    expect(r.assignment.seed).toBe("s1");
    expect(r.assignment.schemaVersion).toBe(CONFIG_VERSION);
    expect(EntityAssignmentSchema.safeParse(r.assignment).success).toBe(true);
    expect(await store.get(1663468)).toEqual(r.assignment);
  });

  it("uses real metadata: createdAt drives era, description drives origin", async () => {
    const store = createMemoryAssignmentStore();
    const r = await resolveEntityForRepo(repo(5, { description: "Authentication and security", createdAt: "2008-01-01T00:00:00.000Z" }), isolated({ store, newSeed: () => "x" }));
    if (r.status !== "persisted") throw new Error("expected persisted");
    expect(r.assignment.originId).toBe("watchkeeper");
    expect(r.assignment.eraId).toBe("early-web-inspired");
  });
});

describe("later summons and sessions see the same identity", () => {
  it("a refresh returns the saved assignment unchanged and does not write again", async () => {
    const store = createMemoryAssignmentStore();
    const put = vi.spyOn(store, "putIfAbsent");
    const first = await resolveEntityForRepo(repo(), isolated({ store, newSeed: () => "first", now: NOW }));
    const again = await resolveEntityForRepo(repo(), isolated({ store, newSeed: () => "different", now: () => new Date("2027-01-01T00:00:00Z") }));
    if (first.status !== "persisted" || again.status !== "persisted") throw new Error("expected persisted");
    expect(again.created).toBe(false);
    expect(again.assignment).toEqual(first.assignment);
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("20 simultaneous sessions with different seeds converge on one identity (origin, voice, temperament, mutations, seed)", async () => {
    const store = createMemoryAssignmentStore();
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => resolveEntityForRepo(repo(), isolated({ store, newSeed: () => `racer-${i}` }))));
    const assignments = results.map((r) => (r.status === "persisted" ? r.assignment : null));
    expect(assignments.every((a) => a !== null)).toBe(true);
    const winner = assignments[0]!;
    for (const a of assignments) {
      expect(a).toEqual(winner);
      expect(a!.seed).toBe(winner.seed);
    }
    expect(results.filter((r) => r.status === "persisted" && r.created)).toHaveLength(1);
  });

  it("different repositories get independent identities", async () => {
    const store = createMemoryAssignmentStore();
    const a = await resolveEntityForRepo(repo(1), isolated({ store, newSeed: () => "a" }));
    const b = await resolveEntityForRepo(repo(2), isolated({ store, newSeed: () => "b" }));
    if (a.status !== "persisted" || b.status !== "persisted") throw new Error("expected persisted");
    expect(a.assignment.repoId).toBe(1);
    expect(b.assignment.repoId).toBe(2);
    expect(a.assignment.seed).not.toBe(b.assignment.seed);
  });

  it("a grave and a URL summon of the same repository share one identity", async () => {
    const store = createMemoryAssignmentStore();
    const viaGrave = await resolveEntityForRepo(repo(), isolated({ store, newSeed: seeds }));
    const viaUrl = await resolveEntityForRepo(repo(1663468, { name: "PDF.js" }), isolated({ store, newSeed: seeds }));
    if (viaGrave.status !== "persisted" || viaUrl.status !== "persisted") throw new Error("expected persisted");
    expect(viaUrl.assignment).toEqual(viaGrave.assignment);
  });
});

describe("incompatible or stale saved data is rejected, never rerolled", () => {
  const brokenStore = (err: unknown): AssignmentStore => ({
    get: async () => { throw err; },
    putIfAbsent: vi.fn(async () => { throw new Error("must not write"); }),
  });

  it("reports an error and writes nothing when the saved record fails validation", async () => {
    const store = brokenStore(new StoredAssignmentError("bad", 1663468));
    const r = await resolveEntityForRepo(repo(), isolated({ store, newSeed: () => "x" }));
    expect(r.status).toBe("error");
    expect(store.putIfAbsent).not.toHaveBeenCalled();
  });

  it("rejects an incompatible mutation set (small-teeth on an archivist) and never stores it", async () => {
    const store = createMemoryAssignmentStore();
    const ok = await resolveEntityForRepo(repo(9), isolated({ store: createMemoryAssignmentStore(), newSeed: () => "s" }));
    if (ok.status !== "persisted") throw new Error("expected persisted");
    expect(ok.assignment.originId).toBe("archivist");
    const bad = { ...ok.assignment, mutationParts: ["small-teeth"] };
    expect(EntityAssignmentSchema.safeParse(bad).success).toBe(false);
    await expect(claimAssignment(store, bad)).rejects.toThrow();
    expect(await store.get(9)).toBeNull();
  });
});

describe("store unavailable: honest provisional identity", () => {
  it("returns a labeled provisional assignment, deterministic across refreshes, and writes nothing", async () => {
    const put = vi.fn();
    const store: AssignmentStore = { get: async () => { throw new Error("connect ETIMEDOUT"); }, putIfAbsent: put };
    const a = await resolveEntityForRepo(repo(), isolated({ store, now: NOW }));
    const b = await resolveEntityForRepo(repo(), isolated({ store, now: NOW }));
    expect(a.status).toBe("provisional");
    if (a.status !== "provisional" || b.status !== "provisional") return;
    expect(a.reason).toBe("store_unavailable");
    expect(b.assignment).toEqual(a.assignment);
    expect(a.assignment.seed).toBe("provisional:1663468");
    expect(put).not.toHaveBeenCalled();
  });

  it("falls back to provisional if the write fails after a clean read", async () => {
    const store: AssignmentStore = { get: async () => null, putIfAbsent: async () => { throw new Error("throttled"); } };
    expect((await resolveEntityForRepo(repo(), isolated({ store, newSeed: () => "x" }))).status).toBe("provisional");
  });

  it("falls back to provisional on timeout", async () => {
    const store: AssignmentStore = { get: () => new Promise(() => undefined), putIfAbsent: async () => { throw new Error("no"); } };
    const r = await resolveEntityForRepo(repo(), isolated({ store, timeoutMs: 20 }));
    expect(r.status).toBe("provisional");
  });

  it("reports not-configured when the store cannot be built (missing env or bad profile)", async () => {
    const r = await resolveEntityForRepo(repo(), isolated({ store: () => { throw new Error("AWS_REGION must be set"); } }));
    expect(r.status).toBe("provisional");
    if (r.status === "provisional") expect(r.reason).toBe("store_not_configured");
  });

  it("never leaks the 12-digit account number into logs", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const store: AssignmentStore = { get: async () => { throw new Error("arn:aws:iam::123456789012:user/x denied"); }, putIfAbsent: async () => { throw new Error("n/a"); } };
    await resolveEntityForRepo(repo(), isolated({ store }));
    expect(spy.mock.calls.flat().join(" ")).not.toContain("123456789012");
    spy.mockRestore();
  });
});

describe("caching, circuit breaker and creation budget", () => {
  const countingStore = () => {
    const inner = createMemoryAssignmentStore();
    return { inner, get: vi.fn(inner.get), putIfAbsent: vi.fn(inner.putIfAbsent) } satisfies AssignmentStore & Record<string, unknown>;
  };

  it("serves repeat views of a saved identity from memory (no DynamoDB read)", async () => {
    const store = countingStore();
    const shared = { cache: createIdentityCache(), breaker: createStoreBreaker(), budget: open() };
    const a = await resolveEntityForRepo(repo(), { ...shared, store, newSeed: () => "s" });
    const b = await resolveEntityForRepo(repo(), { ...shared, store, newSeed: () => "other" });
    const c = await resolveEntityForRepo(repo(), { ...shared, store });
    if (a.status !== "persisted" || b.status !== "persisted" || c.status !== "persisted") throw new Error("expected persisted");
    expect(b.assignment).toEqual(a.assignment);
    expect(c.assignment).toEqual(a.assignment);
    expect(store.get).toHaveBeenCalledTimes(1);
    expect(store.putIfAbsent).toHaveBeenCalledTimes(1);
  });

  it("caches an identity that already existed in the store, but never provisional or error results", async () => {
    const cache = createIdentityCache();
    const failing: AssignmentStore = { get: async () => { throw new Error("down"); }, putIfAbsent: async () => { throw new Error("down"); } };
    await resolveEntityForRepo(repo(), isolated({ store: failing, cache }));
    expect(cache.size()).toBe(0);
    const seeded = createMemoryAssignmentStore();
    await resolveEntityForRepo(repo(), isolated({ store: seeded, newSeed: () => "seed" }));
    await resolveEntityForRepo(repo(), isolated({ store: seeded, cache }));
    expect(cache.size()).toBe(1);
  });

  it("cache entries expire", () => {
    let t = 0;
    const cache = createIdentityCache({ ttlMs: 1000, now: () => t });
    const a = { repoId: 1 } as never;
    cache.set(a);
    expect(cache.get(1)).toBeDefined();
    t = 1001;
    expect(cache.get(1)).toBeUndefined();
  });

  it("after a store failure the store is skipped during the cooldown (bounded retries), then retried once", async () => {
    let t = 0;
    const breaker = createStoreBreaker({ cooldownMs: 30_000, now: () => t });
    const get = vi.fn(async () => { throw new Error("down"); });
    const store: AssignmentStore = { get, putIfAbsent: async () => { throw new Error("down"); } };
    const call = () => resolveEntityForRepo(repo(), { store, breaker, cache: createIdentityCache(), budget: open() });
    expect((await call()).status).toBe("provisional");
    expect((await call()).status).toBe("provisional");
    expect((await call()).status).toBe("provisional");
    expect(get).toHaveBeenCalledTimes(1);
    t = 31_000;
    await call();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("a spent per-client budget gives a provisional ghost and writes nothing; reads of existing ghosts still work", async () => {
    const store = countingStore();
    const budget = createCreationBudget({ enabled: true, perHour: 100, perClientPerHour: 2 });
    const run = (id: number, key: string) => resolveEntityForRepo(repo(id), { store, budget, clientKey: key, cache: createIdentityCache(), breaker: createStoreBreaker(), newSeed: seeds });
    expect((await run(1, "k")).status).toBe("persisted");
    expect((await run(2, "k")).status).toBe("persisted");
    const denied = await run(3, "k");
    expect(denied.status).toBe("provisional");
    if (denied.status === "provisional") expect(denied.reason).toBe("client_budget_exceeded");
    expect(await store.inner.get(3)).toBeNull();
    expect(store.putIfAbsent).toHaveBeenCalledTimes(2);
    // an already-saved ghost is still readable for the same client
    expect((await run(1, "k")).status).toBe("persisted");
    // another client is unaffected
    expect((await run(4, "other")).status).toBe("persisted");
  });

  it("the global budget and the kill switch stop all new writes", async () => {
    const store = countingStore();
    const run = (budget: ReturnType<typeof createCreationBudget>, id: number) =>
      resolveEntityForRepo(repo(id), { store, budget, clientKey: `c${id}`, cache: createIdentityCache(), breaker: createStoreBreaker(), newSeed: seeds });
    const small = createCreationBudget({ enabled: true, perHour: 1, perClientPerHour: 10 });
    expect((await run(small, 10)).status).toBe("persisted");
    const over = await run(small, 11);
    expect(over.status === "provisional" && over.reason).toBe("budget_exceeded");
    const off = await run(createCreationBudget({ enabled: false, perHour: 10, perClientPerHour: 10 }), 12);
    expect(off.status === "provisional" && off.reason).toBe("creation_disabled");
    expect(store.putIfAbsent).toHaveBeenCalledTimes(1);
  });
});
