import { describe, expect, it } from "vitest";
import { createCreationBudget } from "./budget";
import { createLimits } from "./index";
import { createRateLimiter } from "./rate-limit";

describe("rate limiter", () => {
  it("allows up to the limit, then blocks with a retry time, then recovers", () => {
    let t = 0;
    const rl = createRateLimiter({ limit: 3, windowMs: 10_000, now: () => t });
    expect([1, 2, 3].map(() => rl.take("a").allowed)).toEqual([true, true, true]);
    const blocked = rl.take("a");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBe(10);
    t = 4_000;
    expect(rl.take("a").retryAfterSec).toBe(6);
    t = 10_001;
    expect(rl.take("a").allowed).toBe(true);
  });

  it("a limit of zero always blocks, with a finite retry time", () => {
    const rl = createRateLimiter({ limit: 0, windowMs: 5000 });
    expect(rl.take("a")).toEqual({ allowed: false, remaining: 0, retryAfterSec: 5 });
    expect(rl.peek("a").allowed).toBe(false);
  });

  it("keys are independent, and peek never consumes", () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 1000 });
    expect(rl.peek("a").allowed).toBe(true);
    expect(rl.peek("a").allowed).toBe(true);
    expect(rl.take("a").allowed).toBe(true);
    expect(rl.take("a").allowed).toBe(false);
    expect(rl.take("b").allowed).toBe(true);
  });

  it("tracks a bounded number of keys", () => {
    const rl = createRateLimiter({ limit: 5, windowMs: 60_000, maxKeys: 100 });
    for (let i = 0; i < 1000; i++) rl.take(`k${i}`);
    expect(rl.size()).toBeLessThanOrEqual(100);
  });

  it("a blocked key cannot grow its own history", () => {
    const rl = createRateLimiter({ limit: 2, windowMs: 60_000 });
    for (let i = 0; i < 10_000; i++) rl.take("spam");
    expect(rl.take("spam").allowed).toBe(false);
    expect(rl.size()).toBe(1);
  });
});

describe("creation budget", () => {
  it("a denied request consumes nothing", () => {
    const b = createCreationBudget({ enabled: true, perHour: 2, perClientPerHour: 1 });
    expect(b.tryConsume("a")).toEqual({ ok: true });
    expect(b.tryConsume("a")).toEqual({ ok: false, reason: "client_budget_exceeded" });
    expect(b.tryConsume("b")).toEqual({ ok: true });
    expect(b.tryConsume("c")).toEqual({ ok: false, reason: "budget_exceeded" });
  });
  it("replenishes after an hour", () => {
    let t = 0;
    const b = createCreationBudget({ enabled: true, perHour: 1, perClientPerHour: 1, now: () => t });
    expect(b.tryConsume("a").ok).toBe(true);
    expect(b.tryConsume("a").ok).toBe(false);
    t = 3_600_001;
    expect(b.tryConsume("a").ok).toBe(true);
  });
  it("kill switch", () => {
    expect(createCreationBudget({ enabled: false, perHour: 5, perClientPerHour: 5 }).tryConsume("a")).toEqual({ ok: false, reason: "creation_disabled" });
  });
});

describe("limits from environment", () => {
  it("uses safe defaults and ignores invalid values", () => {
    const l = createLimits({ IDENTITY_CREATES_PER_HOUR: "banana", SUMMON_PAGE_LIMIT: "-5" });
    for (let i = 0; i < 60; i++) expect(l.summonPage.take("k").allowed).toBe(true);
    expect(l.summonPage.take("k").allowed).toBe(false);
    for (let i = 0; i < 20; i++) expect(l.creationBudget.tryConsume(`c${i}`).ok).toBe(true);
  });
  it("honors IDENTITY_CREATION_ENABLED=0 and custom limits", () => {
    expect(createLimits({ IDENTITY_CREATION_ENABLED: "0" }).creationBudget.tryConsume("a").ok).toBe(false);
    const l = createLimits({ SUMMON_API_LIMIT: "2" });
    expect([1, 2, 3].map(() => l.summonApi.take("k").allowed)).toEqual([true, true, false]);
  });
});
