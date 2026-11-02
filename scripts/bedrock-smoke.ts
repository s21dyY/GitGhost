/**
 * One tiny Bedrock Converse call. Billable. Refuses to run unless:
 *   LIVE_GENERATION_ENABLED=1, AWS_REGION and BEDROCK_MODEL_ID are set,
 *   and --i-approve-one-billable-call is passed.
 *
 *   node --env-file=.env.local scripts/bedrock-smoke.ts --i-approve-one-billable-call
 *
 * Credentials come from the default AWS credential chain; none are read or printed here.
 */
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { checkSmokePreconditions, runConverseSmoke } from "../src/server/bedrock/smoke.ts";

const pre = checkSmokePreconditions(process.env, process.argv.slice(2));
if (!pre.ok) {
  console.error(`Refusing to call Bedrock: ${pre.reason}`);
  process.exit(2);
}

try {
  const client = new BedrockRuntimeClient({ region: pre.config.region });
  const result = await runConverseSmoke(client, pre.config);
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  const e = err as { name?: string; message?: string };
  // Print the error class and message only; mask 12-digit account numbers.
  console.error(`Bedrock call failed: ${e.name ?? "Error"}: ${(e.message ?? "").replace(/\d{12}/g, "************")}`);
  process.exit(1);
}
