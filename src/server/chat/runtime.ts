import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import type { ChatConfig } from "./config";
import { createBedrockProvider } from "./providers/bedrock";
import type { ChatDeps } from "./service";
import { createDynamoUsageStore, type UsageSender } from "./usage-dynamo";
import { createMemoryUsageStore, type UsageStore } from "./usage-store";

/**
 * Production wiring for the billable provider. Nothing here runs unless chat has already passed
 * preflight (valid config, provider "bedrock", feature flag on, env kill switch off, readiness).
 *
 * - Clients are created lazily, on first use, and never at import time. Creating an AWS client does
 *   not call AWS; credentials are resolved by the SDK on the first request.
 * - Tests inject fake clients, so offline runs never reach AWS.
 * - This is the ONLY application file that constructs AWS clients for chat.
 */
export type RuntimeClients = {
  bedrock?: Pick<BedrockRuntimeClient, "send">;
  dynamo?: UsageSender;
};

let memoryStore: UsageStore | undefined;
const dynamoStores = new Map<string, UsageStore>();
let bedrockClient: BedrockRuntimeClient | undefined;

export function resetChatRuntimeForTests(): void {
  memoryStore = undefined;
  dynamoStores.clear();
  bedrockClient = undefined;
}

/**
 * Client options for billable AWS calls: the region, plus the restricted named profile when one is configured. */
export function awsClientOptions(config: Pick<ChatConfig, "region" | "billableProfile">): { region: string; profile?: string } {
  return { region: config.region ?? "", ...(config.billableProfile ? { profile: config.billableProfile } : {}) };
}

export function billableRuntime(config: ChatConfig, clients: RuntimeClients = {}): Pick<ChatDeps, "store" | "createProvider"> {
  let store: UsageStore | undefined;
  if (config.usageStore === "dynamodb" && config.usageTable && config.region) {
    const key = `${config.region}/${config.usageTable}/${config.billableProfile ?? ""}`;
    store = clients.dynamo ? createDynamoUsageStore(clients.dynamo, config.usageTable) : dynamoStores.get(key);
    if (!store) {
      store = createDynamoUsageStore(new DynamoDBClient(awsClientOptions(config)), config.usageTable);
      dynamoStores.set(key, store);
    }
  } else if (config.usageStore === "memory") {
    memoryStore ??= createMemoryUsageStore();
    store = memoryStore;
  }
  return {
    store,
    createProvider: (c) => {
      if (!c.modelId || !c.region) throw new Error("Bedrock model or region is not configured.");
      bedrockClient ??= clients.bedrock ? undefined : new BedrockRuntimeClient({ ...awsClientOptions(c), maxAttempts: 1 });
      const client = clients.bedrock ?? bedrockClient!;
      return createBedrockProvider({ client, modelId: c.modelId });
    },
  };
}
