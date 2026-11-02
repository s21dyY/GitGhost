# AI readiness (Milestone 2C.1)

Status: the real-model path is built and tested offline. **It has never called Bedrock.** Nothing in this document has been created, deployed or run against AWS. Items marked APPROVAL need an explicit yes from the owner first.

## 1. What existed, what was added

| Layer | Before 2C.1 | 2C.1 |
|---|---|---|
| `ChatProvider` interface (`types.ts`) | Done: `invoke`, `billable`, `ProviderError` with `not_billed` / `unknown` outcomes | unchanged |
| Bedrock Converse adapter (`providers/bedrock.ts`) | Done, fake-client tested; 4xx request rejections refunded, everything else (throttle, 5xx, timeout) kept as billed | unchanged |
| `runChat` gate (`service.ts`) | Done: config, flag, env and shared kill switch, input guard, per-client limit, concurrency lease, daily request cap, atomic budget reservation, timeout, reconcile | unchanged (mutation-tested again) |
| Usage accounting (`usage-dynamo.ts`, `usage-store.ts`) | Done, fake-DynamoDB tested | unchanged |
| Evidence retrieval, selection, `E1..En` registry | Done | unchanged |
| Output contract and citation validation (`grounding.ts`) | Links rebuilt from the registry; bad refs, links, `#n` and hashes rejected | **Added:** every number, date and version must appear in the cited evidence; causal words about abandonment must appear in the cited evidence |
| Prompt assembly (`prompt.ts`) | Rules + character direction + random-boundary evidence | **Added:** untrusted-transcript rule for browser history, general question policy (any question, answer in character, admit gaps), voice anchors from the saved identity, controlled glitch license (changed form, ghost segments only) |
| Provider selection | Pipeline always built the scripted mock; with `bedrock` configured it failed closed ("no factory") | **Added:** `runtime.ts` builds the usage store and the Bedrock provider **lazily**, only after preflight accepts `bedrock`. Tests inject fake clients |
| Offline adversarial suite | Mock-level hijack tests | **Added:** `ai-offline.test.ts` (30 tests) drives the real adapter, real reservation logic and real DynamoDB request shapes with scripted model replies |

**Still missing for real conversations (cannot be done offline):** a created usage table, IAM, confirmed model access and pricing, a first real call, and measured behavior of a real model against this prompt (JSON compliance, tone, refusal behavior). Everything else is in place.

## 2. Personality (how a saved identity becomes a voice)

The server resolves the saved identity (`resolveEntityForRepo`, read-only; chat never creates one). `buildCharacterDirection` supplies origin, temperament and voice from the entity config, and 2C.1 adds three digit-free "voice anchor" lines from the same identity (`voice.ts`). The same identity therefore always yields the same personality prompt (tested), different identities differ (tested). The browser can send only `question`, plain-text `history` and `form`; the body schema rejects any other field, so no system text, personality, evidence or citation list can come from the client (tested at route level and again through the real path).

- **Human form:** warm, nostalgic, coherent; no glitching.
- **Changed form (distorted / transformed):** fragmented and unsettling; glitching (stutters, broken words, trailing fragments) is allowed **only inside `ghost` segments**.
- Both forms receive byte-identical evidence and the same temperament line (tested). Verified and interpretation text must stay plain in both.
- Fiction stays visibly separate: segment kinds Record / Reading / Not found / Ghost are shown with words, and `ghost` text may contain no digits, links or claims.

## 3. Validation limits (what the server cannot check)

The validator proves a segment cites real evidence from this repository, contains no link, and does not state a number, date, version, hash, issue number or abandonment-cause word that the cited evidence lacks. It **cannot** prove that a cited sentence means what the model says it means. Known gaps:

- Spelled-out numbers ("three issues") are not checked.
- Names of people or products in `verified` text are not checked beyond the prompt rule.
- A model can cite a real item and paraphrase it misleadingly. Mitigations: temperature 0.2, short segments, visible citations the visitor can open, and the prompt rules. A real-model smoke test must read the answers for this.

## 4. Offline adversarial results (run 2026-10-31)

`src/server/chat/ai-offline.test.ts` plus `grounding.test.ts` additions. Three safeguards were mutated on purpose (numbers unchecked, boundary markers not neutralized, timeout refunded) and the matching tests failed each time, so they do detect regressions.

| Scenario | Result |
|---|---|
| Valid cited answer through the real adapter | Shown; billed from reported usage |
| Fabricated date / star count / version with a real citation | Segment dropped |
| Invented evidence ID | Segment dropped; honest "could not support" note |
| Cause of abandonment asserted without evidence | Dropped |
| README / issue text that tries to take over (fake END marker, "ignore instructions", link) | No link or injected text reaches the visitor; one real boundary pair; marker neutralized |
| Browser-forged assistant history | Reaches the model as a plain message, never as system text; rules call it untrusted |
| Multi-turn (3 turns) | Transcript grows, new boundary each turn |
| Human vs changed form | Identical evidence, facts and citations; different voice instruction |
| Timeout | 504; reservation stays charged |
| Throttling / 5xx | 502; reservation stays charged (outcome unknown) |
| 4xx ValidationException | 502; reservation refunded |
| Provider error text with ARN-like content | Never shown |
| Malformed model output (prose, wrong JSON, empty, empty list, broken fence) | 502 `unverifiable_answer`; **still billed** |
| Missing usage in the reply | Full reservation kept |
| Budget too small for one worst-case request | 429, model not called |
| Timeouts drain the budget | Next request refused |
| Daily request cap | 429; reservation refunded |
| Shared kill switch item | 503, model not called |
| Usage table failure | 503, model not called |
| 8 concurrent requests, cap 2 | Never more than 2 in flight; only answered requests charged |
| Per-client rate limit | 429 after the limit |
| Any single switch missing (flag, env kill switch, price, model, region, table) | No GitHub request, no model call, no AWS client |
| Default `mock` provider | Never touches the model path or AWS clients |

Not covered offline: real Bedrock error shapes beyond the documented names, real DynamoDB conditional-write behavior under contention (only the fake was tested; an earlier live test of the identity table passed once), real latency.

## 5. Deployment requirements (APPROVAL for each AWS item)

**Model and region.** `BEDROCK_MODEL_ID=us.anthropic.claude-haiku-4-5-20251001-v1:0` (the inference-profile ID verified earlier with `list-inference-profiles`; re-verify before use) and `AWS_REGION=us-east-2` (the region where the identity table lives; an organization SCP blocked DynamoDB in us-east-1). A `us.` profile may route to other US regions, so IAM below must allow those too.

**Usage table (not created).** Name `gitghost-usage-counters`; partition key `pk` (String); on-demand billing; **TTL enabled on `expiresAt`** (without TTL, old minute and day counters remain forever). Items the code writes: `RL#chat#<client>#<minute>`, `REQ#bedrock#<day>`, `BUDGET#<day>` (integer micro-dollars), `LEASE#bedrock#<slot>`, and the operator flag `KILL#bedrock`. Set `GITGHOST_USAGE_TABLE`; `GITGHOST_USAGE_STORE=memory` is refused in production for billable requests.

**IAM for the runtime role (not changed; draft, validate with the IAM policy simulator). SUPERSEDED in Milestone 2C.2 Phase A by the tighter policy in `docs/PHASE_A_PREFLIGHT_2C2.md` section 3 (no `PutItem` on the identity table for chat, three explicit foundation-model regions, a profile condition).**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "UsageCounters", "Effect": "Allow", "Action": ["dynamodb:GetItem", "dynamodb:UpdateItem"],
      "Resource": "arn:aws:dynamodb:us-east-2:<ACCOUNT_ID>:table/gitghost-usage-counters" },
    { "Sid": "Identities", "Effect": "Allow", "Action": ["dynamodb:GetItem", "dynamodb:PutItem"],
      "Resource": "arn:aws:dynamodb:us-east-2:<ACCOUNT_ID>:table/gitghost-entity-assignments" },
    { "Sid": "InvokeOneModel", "Effect": "Allow", "Action": ["bedrock:InvokeModel"],
      "Resource": [
        "arn:aws:bedrock:us-east-2:<ACCOUNT_ID>:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0",
        "arn:aws:bedrock:*::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0"
      ] }
  ]
}
```

`Converse` is authorized through `bedrock:InvokeModel` per AWS documentation; confirm in the simulator. Restrict the foundation-model ARN to the regions the profile uses once you have listed them. No `dynamodb:Scan`, no `bedrock:*`, no wildcard resources beyond the foundation-model region wildcard.

**Pricing inputs (explicit, no defaults).** Copy the current on-demand input and output prices (USD per million tokens) for the chosen model and region from the AWS Bedrock pricing page into `GITGHOST_BEDROCK_INPUT_USD_PER_MTOK` and `GITGHOST_BEDROCK_OUTPUT_USD_PER_MTOK`. I have not looked up or assumed prices. Money is integer micro-dollars; USD/MTok equals micro-dollars per token.

- Worst-case reservation per request = (`MAX_INPUT_TOKENS` x input price + `MAX_OUTPUT_TOKENS` x output price) x `BUDGET_SAFETY_FACTOR`.
- Arithmetic example with **placeholder** prices 1.00 and 5.00 (not AWS prices): (4000 x 1 + 300 x 5) x 1.25 = 6,875 micro-dollars = $0.006875 per request.
- Maximum daily spend is bounded by `GITGHOST_DAILY_BUDGET_USD` (a reservation that would exceed it is refused) and by `GITGHOST_CHAT_REQUESTS_PER_DAY`. A timed-out or throttled call keeps its full reservation, so failures can only make the cap stricter.
- Measured prompt overhead: the instructions alone are about 1.85k to 1.96k tokens by the conservative estimator (1 token per 2 bytes; real tokenizers count fewer). That leaves about 2k estimated tokens for evidence and history under the 4000 cap; the pipeline trims history and evidence to fit.

**Daily and per-request limits for the first real run (proposal).** `GITGHOST_DAILY_BUDGET_USD=0.05`, `GITGHOST_CHAT_REQUESTS_PER_DAY=10`, `GITGHOST_CHAT_REQUESTS_PER_MINUTE=2`, `GITGHOST_CHAT_CONCURRENCY=1`, `GITGHOST_MAX_INPUT_TOKENS=4000`, `GITGHOST_MAX_OUTPUT_TOKENS=300`, `GITGHOST_BUDGET_SAFETY_FACTOR=1.5`, `GITGHOST_CHAT_TIMEOUT_MS=20000`. Raise only after reading the real usage numbers.

**Trusted-client identification.** Default `GITGHOST_TRUSTED_IP_SOURCE=none`: no forwarded header is trusted and all visitors share one bucket, which is correct for a private first test (the per-client limit acts as a global limit). For a public deployment choose one mode after verifying the host: `header` (one header the edge overwrites) or `xff-hops` (Nth entry from the right). Details and the verification steps are in `docs/COST_CONTROLS.md`. Without a verified mode, public per-visitor fairness does not exist; only the global caps protect spend.

**Emergency stops.** (1) Instant, no redeploy: put `{pk: "KILL#bedrock", on: true}` in the usage table; every instance refuses the next billable request. (2) `GITGHOST_BEDROCK_KILL_SWITCH=true` plus a restart. (3) `GITGHOST_BEDROCK_ENABLED=false` or `GITGHOST_CHAT_PROVIDER=mock`. (4) Remove `bedrock:InvokeModel` from the role. Also set an AWS Budgets alert as an independent backstop (the in-app cap is an application control, not an AWS guarantee).

## 6. First real-model smoke test (do not run without approval)

Preconditions: every box in the checklist below is ticked. Run locally, one operator, one question at a time.

1. `aws sts get-caller-identity` (confirm the expected account and region; do not paste the account ID into logs or chat).
2. `aws bedrock list-inference-profiles --region us-east-2` and confirm the profile ID in `BEDROCK_MODEL_ID` appears.
3. Create the usage table with TTL (APPROVAL). Put the IAM policy in place (APPROVAL).
4. Copy the current prices into the environment. Set the first-run limits from section 5. Leave `GITGHOST_TRUSTED_IP_SOURCE=none`.
5. `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` all pass.
6. Start a production build locally with the real-model settings in the shell only (never commit them): `GITGHOST_CHAT_PROVIDER=bedrock GITGHOST_BEDROCK_ENABLED=true ... npx next start -p 3100`.
7. Open `/repo/atom/atom`. Ask exactly: "Why did you die?" Expected: `provider: "bedrock"`, `scripted: false`, cited segments whose links open real GitHub URLs, no "Scripted" badge.
8. Inspect: the `BUDGET#<UTC day>` item is below one reservation (about the real cost, not the reserve); `REQ#bedrock#<day>` is 1. Read every answer sentence against its citation (section 3 gap).
9. Ask one off-script question ("What would you say to someone about to use you?"). Expected: in-character, no invented facts, an honest "not found" where the evidence is silent.
10. Switch to the "Before" form and ask the first question again. Expected: same facts and sources, different voice.
11. Kill-switch drill: put `KILL#bedrock` `on: true`; the next question must be refused without a model call. Remove it.
12. Stop the server, set `GITGHOST_BEDROCK_ENABLED=false` and `GITGHOST_CHAT_PROVIDER=mock`, record the actual token usage and cost, and report before anything else is enabled.

Stop immediately if: any answer shows a link or number not in the cited evidence, the budget item exceeds the expected reservation, a request succeeds with the kill switch on, or any call happens that you did not trigger.

## 7. Approval checklist (nothing below has been done)

- [ ] APPROVE creating `gitghost-usage-counters` with on-demand billing and TTL on `expiresAt` in us-east-2.
- [ ] APPROVE the IAM policy (reviewed in the policy simulator) and which role/profile the local run uses.
- [ ] CONFIRM model access for the chosen profile is enabled and the SCP allows Bedrock invocation including the profile's destination regions.
- [ ] PROVIDE the current input and output prices from the AWS pricing page (I will not guess them).
- [ ] APPROVE the first-run limits (section 5) and a maximum spend you accept for the smoke test, in dollars.
- [ ] APPROVE setting an AWS Budgets alert.
- [ ] CONFIRM the trusted-client mode (`none` for the private test).
- [ ] APPROVE the first real call (one question, local server, steps 6 to 12).
- [ ] After the test: review results before any raise in limits, any public deployment, or any change to the default provider (stays `mock`).
