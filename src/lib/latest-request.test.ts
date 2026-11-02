import { describe, expect, it } from "vitest";
import { createLatestGuard } from "./latest-request";

describe("createLatestGuard", () => {
  it("marks the older request stale and aborts it when a newer one begins", () => {
    const guard = createLatestGuard();
    const first = guard.begin();
    expect(first.isCurrent()).toBe(true);
    const second = guard.begin();
    expect(first.isCurrent()).toBe(false);
    expect(first.signal.aborted).toBe(true);
    expect(second.isCurrent()).toBe(true);
  });

  it("a slow response for repo A cannot replace the selection of repo B", async () => {
    const guard = createLatestGuard();
    let selected = "";
    const run = async (repo: string, delayMs: number) => {
      const ticket = guard.begin();
      await new Promise((r) => setTimeout(r, delayMs));
      if (ticket.isCurrent()) selected = repo;
    };
    await Promise.all([run("atom/atom", 30), run("mozilla/pdf.js", 5)]);
    expect(selected).toBe("mozilla/pdf.js");
  });

  it("cancel invalidates in-flight requests", () => {
    const guard = createLatestGuard();
    const t = guard.begin();
    guard.cancel();
    expect(t.isCurrent()).toBe(false);
  });
});
