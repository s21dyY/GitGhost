import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * V6 review of the split-credential approach, offline. The AWS SDK constructors are replaced by recorders, so
 * nothing here can reach AWS. Two files build AWS clients (three constructors); this pins down which
 * credentials each one uses.
 */
const made = vi.hoisted(() => ({ dynamo: [] as Record<string, unknown>[], bedrock: [] as Record<string, unknown>[] }));
vi.mock("@aws-sdk/client-dynamodb", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@aws-sdk/client-dynamodb")>();
  class FakeDynamo { constructor(o: Record<string, unknown>) { made.dynamo.push(o); } async send() { return {}; } }
  return { ...orig, DynamoDBClient: FakeDynamo };
});
vi.mock("@aws-sdk/client-bedrock-runtime", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@aws-sdk/client-bedrock-runtime")>();
  class FakeBedrock { constructor(o: Record<string, unknown>) { made.bedrock.push(o); } async send() { return {}; } }
  return { ...orig, BedrockRuntimeClient: FakeBedrock };
});

import { loadChatConfig } from "./config";
import { billableRuntime, resetChatRuntimeForTests } from "./runtime";
import { createDynamoClient } from "@/server/storage/dynamo-assignments";

const ENV: Record<string, string> = {
  GITGHOST_CHAT_PROVIDER: "bedrock", GITGHOST_BEDROCK_ENABLED: "true", BEDROCK_MODEL_ID: "amazon.nova-lite-v1:0", AWS_REGION: "us-east-2",
  GITGHOST_BEDROCK_INPUT_USD_PER_MTOK: "0.06", GITGHOST_BEDROCK_OUTPUT_USD_PER_MTOK: "0.24", GITGHOST_USAGE_STORE: "dynamodb", GITGHOST_USAGE_TABLE: "gitghost-usage-counters",
};
const cfg = (over: Record<string, string> = {}) => {
  const c = loadChatConfig({ ...ENV, ...over });
  if (!c.ok) throw new Error(c.errors.join());
  return c.config;
};
beforeEach(() => {
  made.dynamo.length = 0;
  made.bedrock.length = 0;
  resetChatRuntimeForTests();
});

describe("which credentials each AWS client uses", () => {
  it("billable work (the Bedrock call and the usage counters / kill switch) uses the restricted profile", () => {
    const rt = billableRuntime(cfg({ GITGHOST_BEDROCK_AWS_PROFILE: "gitghost-smoke" }));
    expect(rt.store).toBeDefined();
    rt.createProvider!(cfg({ GITGHOST_BEDROCK_AWS_PROFILE: "gitghost-smoke" }));
    expect(made.dynamo).toEqual([{ region: "us-east-2", profile: "gitghost-smoke" }]);
    expect(made.bedrock).toEqual([{ region: "us-east-2", profile: "gitghost-smoke", maxAttempts: 1 }]);
  });
  it("the identity store is built from the default credential chain with no profile option, whatever the billable profile is", () => {
    createDynamoClient("us-east-2", { AWS_PROFILE: "default" });
    expect(made.dynamo).toEqual([{ region: "us-east-2", maxAttempts: 2 }]);
    expect("profile" in made.dynamo[0]).toBe(false);
  });
  it("with no billable profile configured nothing changes from before: no profile option anywhere", () => {
    const c = cfg();
    billableRuntime(c).createProvider!(c);
    expect(made.dynamo).toEqual([{ region: "us-east-2" }]);
    expect(made.bedrock).toEqual([{ region: "us-east-2", maxAttempts: 1 }]);
  });
  it("the usage-store cache is keyed by profile, so a restricted client is never reused for another profile", () => {
    billableRuntime(cfg({ GITGHOST_BEDROCK_AWS_PROFILE: "gitghost-smoke" }));
    billableRuntime(cfg({ GITGHOST_BEDROCK_AWS_PROFILE: "gitghost-smoke" }));
    billableRuntime(cfg({ GITGHOST_BEDROCK_AWS_PROFILE: "other" }));
    expect(made.dynamo.map((o) => o.profile)).toEqual(["gitghost-smoke", "other"]);
  });
  it("only these two files construct AWS clients (billable runtime, identity store) in the application code (a new one would need review)", async () => {
    const { execSync } = await import("node:child_process");
    const out = execSync(String.raw`grep -rlE "new (DynamoDBClient|BedrockRuntimeClient)\(" src --include=*.ts | grep -v '\.test\.' | sort`, { cwd: process.cwd() }).toString().trim().split("\n");
    expect(out.sort()).toEqual(["src/server/chat/runtime.ts", "src/server/storage/dynamo-assignments.ts"]);
  });
});
