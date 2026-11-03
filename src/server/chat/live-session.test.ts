import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Static checks of the local live-session script. It is not executed here; nothing in this file can reach AWS. */
const s = readFileSync(join(process.cwd(), "infra/history/v6/live-session.sh"), "utf8");

describe("infra/history/v6/live-session.sh", () => {
  it("is a dry run unless --execute AND the exact typed authorization are present", () => {
    expect(s).toContain('if [ "$EXECUTE" != 1 ]; then');
    expect(s).toContain("I_AUTHORIZE_A_LIVE_DEMO_SESSION_UP_TO_8_REQUESTS_AND_0.006_USD");
    expect(s.indexOf("DRY RUN")).toBeLessThan(s.indexOf("GITGHOST_LIVE_SESSION_AUTHORIZED:-"));
  });
  it("uses the existing demo profile unchanged: it exports it into the server's shell and never edits .env.local", () => {
    expect(s).toContain("PROFILE_FILE=infra/history/v6/profiles/demo.env");
    expect(s).toContain('. "$PROFILE_FILE"');
    expect(s).not.toMatch(/>>?\s*\.env/);
    expect(s).toContain("CAP=8");
  });
  it("checks every precondition before it starts anything: locked switch, allowance, free port, build", () => {
    const order = ['"$(kill_of admin)" = "True"', '"$REQ" -lt "$CAP"', "server_pids)\" ] ||", ".next/BUILD_ID", "nohup npx next start"].map((k) => s.indexOf(k));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it("starts the server first and unlocks only afterwards, and only if the switch is currently locked", () => {
    const start = s.indexOf("nohup npx next start");
    const unlock = s.indexOf(":f");
    expect(start).toBeGreaterThan(0);
    expect(unlock).toBeGreaterThan(start);
    expect(s).toContain('--condition-expression "#o = :t"');
  });
  it("always has a way back: an auto-relock timer (5 to 240 minutes) and a stop that needs no authorization", () => {
    expect(s).toContain('"$MINUTES" -lt 5');
    expect(s).toContain('"$MINUTES" -gt 240');
    expect(s).toContain("sleep $((MINUTES * 60))");
    const stop = s.slice(s.indexOf("  stop)"));
    expect(stop).toContain("relock");
    expect(stop).not.toContain("GITGHOST_LIVE_SESSION_AUTHORIZED");
  });
  it("the only kill-switch write that turns the lock OFF is the guarded unlock", () => {
    const offs = [...s.matchAll(/:f":\{"BOOL":false\}/g)];
    expect(offs.length).toBe(1);
    expect(s.match(/":t":\{"BOOL":true\}/g)?.length).toBeGreaterThanOrEqual(2);
  });
  it("touches no IAM, creates nothing, deletes nothing in AWS, and makes no model call itself", () => {
    expect(s).not.toMatch(/put-role-policy|create-|delete-item|delete-table|iam |bedrock-runtime|converse|invoke-model|batch-write/i);
  });
});

describe("infra/history/v6/serve-mock.sh", () => {
  const m = readFileSync(join(process.cwd(), "infra/history/v6/serve-mock.sh"), "utf8");
  it("forces the scripted provider and a closed Bedrock whatever .env.local says", () => {
    expect(m).toContain("GITGHOST_CHAT_PROVIDER=mock");
    expect(m).toContain("GITGHOST_BEDROCK_ENABLED=false");
    expect(m).toContain("GITGHOST_BEDROCK_KILL_SWITCH=true");
    expect(m).not.toMatch(/aws |dynamodb|demo\.env|dev\.env/);
  });
});
