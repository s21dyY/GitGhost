# Milestone 2C.2: Amazon Nova Lite fallback (Stage A report, Stage B and C approval packages)
> **Historical (superseded 2026-11-02).** The one-call / separate-approval Bedrock plan described here was cancelled by the owner; see `.kiro/steering/decisions.md` (D1). Kept as a record; do not use it as the current policy.


Date: 2026-11-01 (UTC). **Status: Stage A and B done; Stage C RUN on 2026-11-01 (section 12): exactly one Nova Lite call, answered, USD 0.000141 raw / 212 micro-dollars recorded, kill switch re-locked and verified. No further inference is authorized. Approval for Claude is not approval for Nova Lite.**

Claude support is untouched: the Claude plan, its IAM statements and its runner scripts remain. Claude is simply blocked at the account level until the Anthropic use-case form is submitted (see `docs/history/STAGE2_CHECKLIST_2C2.md`, section 10).

## 1. Access and region verification (read-only, us-east-2)

| Question | Answer | How verified |
|---|---|---|
| Does the model exist and is it active? | Yes: `amazon.nova-lite-v1:0`, "Nova Lite", provider Amazon, lifecycle **ACTIVE** (start of life 2024-12-03) | `bedrock get-foundation-model` |
| Output | TEXT (inputs TEXT/IMAGE/VIDEO; we send text only) | same |
| Inference modes | **`ON_DEMAND` and `INFERENCE_PROFILE`** | same |
| Does the bare model ID support direct Converse? | **Yes.** `ON_DEMAND` means the bare ID `amazon.nova-lite-v1:0` can be invoked directly, in-region, with no inference profile. (Contrast Claude Haiku 4.5 here: `INFERENCE_PROFILE` only.) I did not make a call to prove it; the mode list is the evidence. | same |
| Cross-region alternative | Profile `us.amazon.nova-lite-v1:0` (SYSTEM_DEFINED, ACTIVE) routes to us-east-1, us-east-2, us-west-2. **Not used**: in-region is preferred, and the SCP (`p-buss865h`, which explicitly denies DynamoDB in us-east-1 and us-west-2) makes routed regions riskier. | `list-inference-profiles` |
| Account authorization | `authorizationStatus AUTHORIZED`, `entitlementAvailability AVAILABLE`, `regionAvailability AVAILABLE`, `agreementAvailability AVAILABLE` | `get-foundation-model-availability` |
| Any subscription, marketplace agreement or use-case form? | **None applies.** `list-foundation-model-agreement-offers` answers "Agreement not supported for this model". The Anthropic-style form is specific to Anthropic models. Amazon first-party models are enabled by default on Bedrock as far as I know; I could not prove this beyond the AUTHORIZED status. | read-only calls |
| Is it actually invocable by us? | Not yet provable: (a) the restricted role's policy has no Nova statement (Stage B), (b) an invocation has never been attempted, (c) the SCP's effect on Bedrock invocation in us-east-2 is unknown (it allows DynamoDB there, and `ListInferenceProfiles` worked). | |

Other Nova models offered here (not used): `amazon.nova-micro-v1:0`, `amazon.nova-pro-v1:0` and `amazon.nova-2-lite-v1:0` are `INFERENCE_PROFILE` only. Note that **"Nova 2.0 Lite" is a different product with different prices** (about 5.5x higher on input and 11.5x on output: USD 0.33 and 2.75 per million tokens on-demand) and a different ID; it is not the target.

## 2. Verified official pricing (not Claude's)

Source: AWS Price List bulk API, public and unauthenticated: `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrock/current/us-east-2/index.json`, offer `AmazonBedrock`, **version 20261030160456, published 2026-10-30T16:04:56Z**, terms effective **2026-10-01**. Product "Nova Lite", feature "On-demand Inference", region us-east-2 (Ohio):

| Item | SKU | usagetype | Price | Unit | Per million tokens |
|---|---|---|---|---|---|
| Input tokens | `68N2Y76KQKQ4CEB8` | `USE2-NovaLite-input-tokens` | USD 0.00006 | per 1K tokens | **USD 0.06** |
| Output tokens | `T4U7KW6SXXKERZG3` | `USE2-NovaLite-output-tokens` | USD 0.00024 | per 1K tokens | **USD 0.24** |

Identical in us-east-1 and us-west-2. Other Nova Lite rows (batch input 0.00003 / output 0.00012; cache read 0.000015; cache write 0.00) do not apply: we use neither batch nor prompt caching. The price list has no separate cross-region or "global" tier for Nova Lite (unlike Claude Haiku 4.5), so the Regional-versus-Global uncertainty from the Claude plan does not arise. I did not cross-check the human pricing page. Both prices are pinned in code and the run refuses any other value (section 5).

## 3. First-call cost calculation

Money is kept in micro-dollars (USD per million tokens equals micro-dollars per token). Safety factor 1.5 as requested.

| Case | Input tok | Output tok | Raw cost | With 1.5 factor |
|---|---|---|---|---|
| **Worst-case reservation (the budget gate)** | 4,000 | 300 | 4,000 x 0.06 + 300 x 0.24 = 240 + 72 = **312 µ$** | **468 µ$ = USD 0.000468** |
| Worst case if the output cap is 500 | 4,000 | 500 | 360 µ$ | 540 µ$ = USD 0.00054 |
| Realistic call (my estimate) | about 1,800 | about 200 | 108 + 48 = 156 µ$ | 234 µ$ |
| Expected range (estimate) | 1,200 to 2,200 | 150 to 300 | 100 to 200 µ$ | 150 to 300 µ$ |

- The **real AWS charge for the whole first call is bounded above by USD 0.000312** (the factor is an application safety margin, not part of the AWS bill). Expected about **USD 0.0001 to 0.0002, i.e. about two hundredths of a cent.**
- The recorded spend uses actual reported tokens x prices x 1.5, rounded up. The 468 µ$ reservation is taken before the call and replaced by the actual cost afterwards.
- The USD 0.02 budget is 20,000 µ$, which is **42 reservations**. For this cheap model the budget is therefore not the binding limit; **1 request per day is**. If you want the budget to be a meaningful tripwire too, USD 0.001 (about two reservations) is a closer fit; I kept your USD 0.02.
- Rounding check: in floating point, (4000 x 0.06 + 300 x 0.24) x 1.5 is exactly 468 (verified), no off-by-one.
- The real input size is unmeasured: the Claude run never produced a reply, and no token count was ever reported. The prompt instructions alone are about 3.7 to 3.9 KB, evidence is trimmed to fit the input cap, and the cap check uses a deliberately pessimistic 1 token per 2 bytes.

## 4. IAM audit and the minimum change

Audit of the attached policy `gitghost-2c2-smoke` (read live; it equals the rendered template exactly, no drift):

| Statement | Effect | Needed for Nova? |
|---|---|---|
| `ReadUsageCountersAndKillSwitch`: `dynamodb:GetItem` on the usage table | read counters and the kill switch | yes, unchanged |
| `WriteCountersNeverTheKillSwitch`: `dynamodb:UpdateItem` only on `RL#`, `REQ#`, `BUDGET#`, `LEASE#` keys, `Null: false` | reservations, refunds, leases | yes, unchanged |
| `ReadOnlyTheAtomAtomGhostIdentity`: `dynamodb:GetItem`, key 3228505 only, `Null: false` | the identity | yes, unchanged |
| `InvokeOnlyThroughThisInferenceProfile` and `InvokeUnderlyingModelOnlyViaThatProfile` | Claude Haiku 4.5 via its profile | not for Nova; **kept** so Claude support is not removed |
| (nothing for Nova) | | **missing: this is the whole change** |

**The minimum change is one added statement:**

```json
{
  "Sid": "InvokeNovaLiteInRegionOnly",
  "Effect": "Allow",
  "Action": ["bedrock:InvokeModel"],
  "Resource": "arn:aws:bedrock:us-east-2::foundation-model/amazon.nova-lite-v1:0"
}
```

Why this is enough and no more: Nova Lite is invoked by its bare model ID, so the only resource involved is the single foundation-model ARN in us-east-2; no inference profile is used, so the `bedrock:InferenceProfileArn` condition of the Claude statements is neither needed nor applicable. The action stays `bedrock:InvokeModel` (Converse is authorized through it; evidence: the failed Claude call passed IAM and reached Bedrock's model gating, with a `ResourceNotFoundException` rather than `AccessDenied`). Because the ARN pins the region and the model, the role cannot call Nova Lite elsewhere, the cross-region profile, any other Nova model, or any other Bedrock action.

**All existing restrictions are preserved** (verified by simulating the proposed policy, section 4a): `KILL#bedrock` cannot be written; the identity read is limited to `atom/atom`; no identity writes; counter writes only on the four prefixes with `Null: false`; no Scan, Put, Delete, Query; no Bedrock wildcard; no IAM or STS access; Claude access unchanged. The role is not replaced and is not given administrator rights.

### 4a. Validation of the proposed policy (read-only; nothing attached)
- **IAM Access Analyzer:** zero findings.
- **`simulate-custom-policy` of the proposed document (`infra/history/2c2/nova-iam-validate.sh`): 34 of 34 expectations pass**, including: InvokeModel on the Nova Lite foundation model in us-east-2 allowed; Nova Lite in us-east-1 and us-west-2 denied; the `us.amazon.nova-lite-v1:0` profile denied; Nova Micro, Pro, 2 Lite denied; wildcard denied; streaming, `ListFoundationModels`, `GetFoundationModel`, guardrail creation denied; Claude via profile still allowed and Claude without the profile condition still denied; every DynamoDB and IAM restriction from the list above still denied or allowed exactly as before.
- **Difference against the live policy:** exactly one statement added; none changed or removed; same `Version`.
- **Limit of this evidence:** the simulator evaluates only the identity policy. It cannot see the organization SCP, so it does not prove the call will pass the SCP. In-region us-east-2 is the lowest-risk target because the same SCP allows DynamoDB there.

## 5. Harness and tests (offline)

**Changes (no change to application behavior or defaults):**
- `validation-harness.ts`: a **plan registry**. Each plan pins one model ID, region, verified prices, ceilings and call list. `nova-lite`: model `amazon.nova-lite-v1:0`, us-east-2, 0.06 / 0.24, 1 call, 1 request/day, USD 0.02, 4,000 in, output ceiling 500, concurrency 1, 20 s. `claude-haiku-4-5` keeps its numbers. `checkCeilings` now also requires the exact model ID, region, **exact prices**, and a safety factor of at least 1.5. No plan is the default: `GITGHOST_VALIDATION_PLAN` must be named, and unknown or prototype names (`constructor`, `__proto__`) are refused. The run cannot start with Claude's prices on Nova or the reverse.
- The report now records the plan, model, prices, source, worst-case reservation, **the provider's stop reason** and the call's provider error name.
- `service.ts` and `pipeline.ts`: the **stop reason** now reaches the report. The adapter already read it but `runChat` dropped it, so a reply cut off by `max_tokens` would have been invisible.
- `live.validation.test.ts` takes the plan from the environment. `nova-iam-update.sh` (add the one statement, dry run by default, backup, verification, rollback), `nova-iam-validate.sh`, `nova-preflight.sh`, `nova-run.sh` (dry run by default; two locks to execute).

**Adapter handling of Nova (verified against Nova-shaped fake replies):** the Bedrock adapter reads `output.message.content[].text` (joins several text blocks, ignores non-text blocks), `usage.inputTokens` / `outputTokens` (extra fields such as `totalTokens`, `cacheReadInputTokens`, `cacheWriteInputTokens` and `metrics.latencyMs` are ignored) and `stopReason`. The request is `modelId`, one system text block, alternating user/assistant messages starting with the user, `maxTokens` and `temperature: 0.2` (valid for Nova's 0 to 1 range). No guardrail, tool or extra fields are sent.

**New offline tests: `nova-offline.test.ts` (53 tests)**, plus extended harness tests; full suite **587 passed, 4 skipped** (was 530):
- Plan pinning (model, region, prices, ceilings; 15 refusals including Claude's ID and prices, the cross-region profile, other Nova models, 2 requests/day, a 501-token cap, a 1.2 safety factor).
- Request shape (bare model ID, one system block, alternating roles, 300 max tokens, 0.2 temperature, exactly four request fields).
- Reply shapes: clean JSON; ```json fence (accepted); JSON split over several text blocks (accepted); **prose before the JSON (refused, billed)**; **`max_tokens` truncation (refused, billed, stop reason reported)**; `content_filtered` and `guardrail_intervened` with empty content (refused, billed); non-text-only content (refused); missing or malformed usage (full reservation kept).
- Provider errors (Nova-specific names): throttling, model timeout, model not ready, service unavailable, internal error, model error keep the reservation; `AccessDeniedException` (for example an SCP denial), `ValidationException`, `ResourceNotFoundException` are refunded; provider text never reaches the visitor; timeouts are 504 and keep the reservation.
- **Grounding on whatever Nova writes:** fabricated date, star count, version, invented evidence ID `E99`, a link, a cause of abandonment and a dated ghost line are all dropped while the supported sentence survives; a model that obeys injected repository text cannot put a link on screen.
- Spend at Nova scale: a budget below one reservation (400 < 468 µ$) refuses before any model call; second request in a day refused and refunded; kill switch and a failing usage table stop the model; concurrency 1 never exceeded; every missing setting closes the path before GitHub or the model is touched.
- Harness dry run on the `nova-lite` plan with fake clients, including the lock-check case.
- **Mutation checks:** removing the price check, removing the number/date validation, and dropping the stop reason each made the right tests fail; accepting a drifted IAM policy made 4 of the IAM-script tests fail.
- IAM update script simulation: 29 checks (dry run, apply, no-op rerun, rollback, drift, unreadable state, Access Analyzer finding, failed write before and after taking effect, wrong caller). The earlier Stage 1 simulation still passes (107).

**Behaviors the offline tests cannot predict** (and the first call will show): whether Nova Lite returns clean JSON or adds prose around it (small models often do; this pipeline refuses such a reply whole, by design), how many segments it cites correctly, its tone, and its real token counts. A refused reply costs about USD 0.0002, so learning this is cheap.

**Unsupported factual claims and malformed output are still rejected**: confirmed by the tests above, including the number/date and causal-word rules added in 2C.1.

## 6. Proposed limits (yours, plus two points to decide)

| Setting | Value | Note |
|---|---|---|
| Calls | **1** (atom/atom, saved distorted Archivist, "Why did you die?") | as you proposed |
| Application daily budget | USD 0.02 (20,000 µ$) | as proposed; 42 reservations fit, so the request cap is what binds |
| Requests per day / per minute | **1 / 1** | my addition, enforced in code |
| Max input | 4,000 estimated tokens | unchanged; the estimator is pessimistic (2 bytes per token) |
| Max output | **300 as you stated; I propose 500** | see below |
| Concurrency, timeout, safety factor | 1, 20 s, 1.5 | as proposed (all enforced) |
| Retries | none; stop at the first failure | harness |
| Kill switch | ON before the run and re-locked after | runner |

**Decision for you: output cap 300 versus 500.** The model must answer with a JSON object (keys, quotes, a `cites` array per segment) in up to 6 segments of up to 400 characters. A typical 3-segment answer is about 120 to 220 tokens, but a cut-off JSON reply is refused whole and would waste the single call. Raising the cap to 500 costs nothing unless it is used: worst-case reservation 540 instead of 468 µ$ (a difference of USD 0.000072). I recommend 500. If you do not choose, the runner uses your 300 (`NOVA_MAX_OUTPUT_TOKENS=500` switches it, and only 300 or 500 are accepted).

## 7. Stage B: approval package for the IAM change (do not run until you approve)

**What changes:** the inline policy `gitghost-2c2-smoke` on role `gitghost-smoke-runtime` gains one statement (section 4). No other IAM object, no trust-policy change, no new role or user. Cost: none.

**Exact commands** (as `kiroween-dev`):

```
cd infra/history/2c2
./nova-iam-validate.sh          # read-only: Access Analyzer + 34 simulator checks + "exactly one statement added"
./nova-iam-update.sh            # dry run: compares live policy with the known previous one, validates, shows the difference
./nova-iam-update.sh --apply    # backs up the live policy, put-role-policy, reads it back and compares
./nova-preflight.sh             # expected to turn GO (the IAM checks pass); still read-only
```

Safeguards: it refuses unless the live policy equals the known previous policy exactly (drift stops it), requires zero Access Analyzer findings, keeps a mode-600 backup in `/tmp/gitghost-2c2/`, verifies the result and prints the rollback command. **Rollback:** `./nova-iam-update.sh --rollback` restores the previous policy (only if the live policy is the new one). The change takes effect within seconds to a minute; the simulator checks in the preflight confirm it.

Stage B checklist (all unchecked):
- [ ] Approve adding the single `InvokeNovaLiteInRegionOnly` statement to `gitghost-2c2-smoke`.
- [ ] Approve running `nova-iam-update.sh --apply` as `kiroween-dev`.
- [ ] Decide output cap: 300 (default) or 500 (recommended).

## 8. Stage C: smoke-test authorization checklist (after Stage B is applied and verified; separate approval)

Go/no-go (`./infra/history/2c2/nova-preflight.sh`, read-only, 18 checks): `.env.local` clean (provider mock, flag false, live-generation 0); no live variables in the shell; **kill switch ON** (admin and role); today's `BUDGET#`/`REQ#bedrock#` absent or zero; table, TTL, role, budget guard; **model ACTIVE with ON_DEMAND, AUTHORIZED, no agreement needed**; **live role policy equals the Nova policy** and the simulator allows `InvokeModel` on `amazon.nova-lite-v1:0` for the role; atom/atom identity unchanged (Archivist, cosmic, formal, distorted, overlays orbiting-eyes + missing-outline); Nova, harness, offline-AI, grounding and IAM-script tests pass.

**Current go/no-go: NO-GO, by design.** 16 of 18 checks pass today; the two failures are exactly "live policy is not the Nova policy yet" and "simulator denies the role on Nova Lite", which Stage B resolves.

When you authorize Stage C, `nova-run.sh --execute` (with `GITGHOST_NOVA_AUTHORIZED=I_AUTHORIZE_ONE_NOVA_LITE_CALL_UP_TO_0.02_USD`) does, in order: preflight; **lock check with the kill switch still ON** (the call must be refused with `kill_switch` and zero model calls); wait 65 s; unlock (conditional update, admin only); **the one call**; re-lock (an exit trap does it on any outcome); verify the lock as admin and as the role; read the counters. The report in `.local/2c2/` (git-ignored, no credentials, 12-digit numbers masked) records: raw model text, valid-JSON flag, **stop reason**, accepted and rejected segments with reasons, the evidence references offered, source links checked against the retrieved registry, tokens in/out, latency, reserved versus actual micro-dollars, live counters, and any provider error name.

Stop conditions: any refused or failed call (no retry); the lock check not refusing; spend above the reservation or accounting not matching the reported usage; a link or number on screen that is not in its cited evidence; any unexpected AWS error; any sign of a call you did not authorize.

Stage C checklist (all unchecked):
- [ ] Stage B applied and `nova-preflight.sh` says GO.
- [ ] Explicit authorization naming this document, covering: the lock check, unlocking `KILL#bedrock`, one `amazon.nova-lite-v1:0` call on atom/atom, the automatic re-lock, a daily budget of USD 0.02 (worst-case reservation USD 0.000468, expected real cost about USD 0.0002), no retries.
- [ ] Output cap choice (300 or 500) restated.

## 9. Remaining risks and unknowns (honest list)
1. `Converse` authorization via `bedrock:InvokeModel` on the foundation-model ARN is inferred, not tested.
2. Whether the SCP allows Bedrock invocation in us-east-2 is unknown (a denial would be a refunded 4xx and would stop the run at a cost of zero).
3. Nova Lite's JSON discipline, citation accuracy, tone and token usage are unmeasured. It is a small model: expect more rejected segments than Claude, which would be useful evidence about how strict the validator is, not necessarily a failure.
4. I did not look at the human pricing page, and AWS prices can change; the run refuses any price other than the pinned ones, so a price change requires a code update.
5. Nova models are enabled by default on Bedrock according to the AUTHORIZED/AVAILABLE status and my recollection of AWS behavior; I could not prove it without a call.
6. The temperature (0.2) and the prompt were designed and tested with Claude in mind; Nova may respond differently to the "output only JSON" instruction.

## 10. Stage B result: IAM change applied (2026-11-01, authorized by the owner for this change only)

**Applied:** one statement added to the inline policy `gitghost-2c2-smoke` on role `gitghost-smoke-runtime`, with `kiroween-dev`, via `infra/history/2c2/nova-iam-update.sh --apply`:

```json
{ "Sid": "InvokeNovaLiteInRegionOnly", "Effect": "Allow", "Action": ["bedrock:InvokeModel"],
  "Resource": "arn:aws:bedrock:us-east-2::foundation-model/amazon.nova-lite-v1:0" }
```

| Step | Result |
|---|---|
| `nova-iam-validate.sh` (read-only, before) | Access Analyzer 0 findings; simulator 34 of 34; difference = exactly one added statement |
| `nova-iam-update.sh` dry run | live policy state `previous`, zero findings, added=[InvokeNovaLiteInRegionOnly], changed=[], removed=[] |
| Independent drift check | live policy == the template I reviewed; the 5 existing statements byte-identical in the new policy; trust policy == the rendered one; the role has exactly one inline policy and no attached policies |
| Apply | backed up the live policy (mode 600, equals the previous policy), `put-role-policy`, read back and compared: **applied and verified** |
| Independent readback | live policy == approved new policy; statement IDs = the original 5 plus the Nova one; no `*` in any action or resource |
| Simulator against the **attached** role (organization policy evaluated; region context supplied), 17 checks | all pass: Nova Lite in us-east-2 allowed; us-east-1, the `us.*` profile, Nova Pro, streaming denied; Claude via its profile still allowed and Claude without the profile condition still denied; `KILL#bedrock` write denied; `RL#` and `BUDGET#` writes allowed; no-LeadingKeys denied; atom/atom identity read allowed, other identity denied, identity write denied, usage-table `PutItem` and `Scan` denied; `iam:PutRolePolicy` on itself denied |
| `nova-preflight.sh` | **18 of 18, GO** |
| Kill switch | **ON**, read directly via admin and via the restricted role, before and after |
| CloudTrail audit (since 2026-11-01 00:00 UTC) | exactly one IAM write, `PutRolePolicy` by `kiroween-dev`; no Bedrock event other than read-only listing calls |

Unchanged: Claude permissions, all DynamoDB restrictions, the trust policy, the table, the budget guard, `.env.local` (provider `mock`, flag `false`, live-generation `0`). Claude support is not removed.

The simulator including the organization policy returned "allowed" for Nova Lite in us-east-2. That is simulation, not a call: it still does not prove Bedrock will accept the request.

**Rollback if ever needed:** `infra/history/2c2/nova-iam-update.sh --rollback` (restores the previous policy; tested offline, 29/29).

### 10a. Harness updated to the 500-token output cap (owner decision)
- Plan `nova-lite` ceilings, enforced in code before the call: **1 call, 1 request/day, USD 0.02 (20,000 micro-dollars), 4,000 input tokens, 500 output tokens (was 300), concurrency 1, 20 s timeout, safety factor at least 1.5, exact model ID and exact prices**. No retries; the run stops at the first failure. The runner fixes the cap at 500 (the `NOVA_MAX_OUTPUT_TOKENS` override was removed).
- **Worst-case reservation: (4,000 x 0.06 + 500 x 0.24) x 1.5 = 540 micro-dollars = USD 0.00054** (468 at the old 300 cap). 37 reservations fit the budget. Hard bound on the real AWS charge before the safety factor: 4,000 x 0.06 + 500 x 0.24 = 360 micro-dollars = USD 0.00036. Expected real cost is unchanged at about USD 0.0001 to 0.0003.
- Tests: 56 tests in `nova-offline.test.ts` (was 53). New ones assert the plan ceilings exactly, that the runner script fixes `OUTTOK=500` with no override, keeps every other approved limit, is locked behind `--execute` and the typed authorization, re-locks on exit, has exactly two runner invocations (the lock check and the one call), and that the environment the runner builds passes the plan's own ceiling check. Mutations caught: runner cap back to 300, authorization check weakened, a second (retry) invocation added.
- Suite: **590 passed, 4 skipped**; typecheck, lint and build clean; IAM-script simulation 29/29; Stage 1 simulation 107/107.
- Both locks verified with a GO preflight: `nova-run.sh --execute` with a **wrong** authorization string and with **none** each refused ("Nothing was unlocked."); the kill switch stayed ON and no report was written.

## 11. Stage C: final checklist (NOT authorized; waiting for the owner)

**Current go/no-go: GO (18 of 18, read-only).** Everything below happens only after you authorize it in chat.

What `nova-run.sh --execute` does, in this order:
1. Read-only preflight (the 18 checks); stops on any failure.
2. **Lock check with the kill switch still ON:** the live runner is run once; the call must be refused `kill_switch` with zero model calls and nothing reserved (this proves the wiring against the real table at no cost). It uses the per-minute slot, so the script waits 65 s.
3. **Unlock:** `KILL#bedrock` set to false by the admin profile, only if it is currently true. The restricted role cannot do this.
4. **The one call:** atom/atom, saved distorted Archivist, "Why did you die?", model `amazon.nova-lite-v1:0` invoked directly in us-east-2 as the restricted role (`gitghost-smoke`), full GitGhost pipeline (GitHub evidence, saved identity, personality prompt, Bedrock adapter, grounding validator).
5. **Re-lock, always:** an exit trap sets `KILL#bedrock` back to true on success, failure or Ctrl-C; the script re-reads it as admin and as the role, then reads `BUDGET#`/`REQ#bedrock#`.

Limits (all enforced in code, none raisable from the environment): 1 billable call; no retries; stop at the first failure; 4,000 input tokens; **500 output tokens**; concurrency 1; 20 s timeout; safety factor 1.5; application budget USD 0.02; 1 request per day and per minute; Nova Lite prices USD 0.06 / 0.24 per million tokens.

Cost: worst-case reservation **USD 0.00054**; real AWS charge bounded by **USD 0.00036**; expected about USD 0.0001 to 0.0003.

What the report records (`.local/2c2/`, git-ignored, no credentials, 12-digit numbers masked): raw model text; valid-JSON flag; **stop reason**; accepted and rejected segments with reasons; evidence references offered; source links checked against the retrieved registry and for any link in shown text; the final rendered dialogue; input/output tokens; latency; reserved versus actual micro-dollars (and whether actual equals the cost of the reported usage); live counters; any provider error name and billed/not-billed outcome.

Stop conditions: the lock check not refusing; any refused or failed call (no retry); spend above the reservation or accounting mismatch; a link or number on screen not in its cited evidence; any unexpected AWS error or denial; any sign of an unauthorized call.

Known unknowns the call may reveal: whether Converse is authorized via `InvokeModel` on the foundation-model ARN; whether your organization policy allows Bedrock invocation in us-east-2 (a denial is a refunded 4xx and stops the run at zero cost); Nova Lite's JSON discipline (prose around JSON is refused whole by design), citation accuracy, tone and real token counts.

Authorization needed (all unchecked):
- [ ] Explicit chat authorization naming `docs/history/NOVA_LITE_2C2.md`, covering: the lock check, unlocking `KILL#bedrock`, ONE `amazon.nova-lite-v1:0` call on atom/atom ("Why did you die?"), the automatic re-lock.
- [ ] The spend ceiling you accept: USD 0.02 application budget (worst-case reservation USD 0.00054; expected real cost about USD 0.0002).
- [ ] Confirmation of: 500 output tokens, 1 call, no retries, stop at first failure.
- [ ] I set `GITGHOST_NOVA_AUTHORIZED=I_AUTHORIZE_ONE_NOVA_LITE_CALL_UP_TO_0.02_USD` only after that message.

## 12. Stage C result: the one authorized Nova Lite call (2026-11-01, 02:47:56 UTC)

**Outcome: the call succeeded end to end. The reply was valid JSON but thin: one "not found" sentence, and the ghost line was lost because the model put it in the wrong place. Nothing false reached the screen.**

| Step | Result |
|---|---|
| Preflight (18 checks) | 18 of 18, GO |
| Lock check, kill switch ON | passed: refused `kill_switch`, zero model calls, nothing reserved (report 02:46:46Z) |
| Unlock | `KILL#bedrock` set to false by the admin profile (verified) |
| The call | atom/atom, saved distorted Archivist, "Why did you die?", `amazon.nova-lite-v1:0`, us-east-2, as `gitghost-smoke-runtime`, full pipeline |
| Re-lock | `KILL#bedrock` = true, read back as admin and as the role |
| Retries / further calls | none; CloudTrail shows exactly one `Converse` event (us-east-2, this model, this role, no error) |

**What the call proved:** `Converse` is authorized through `bedrock:InvokeModel` on the foundation-model ARN; the organization policy allows Bedrock invocation in us-east-2; direct in-region invocation by the bare model ID works; the restricted role works for the whole path; the usage store's reserve, reconcile and lease logic works against the **real** DynamoDB table (until now only an emulator had tested it).

**Raw model output (before validation), valid JSON, no surrounding prose:**

```
{"segments":[{"kind":"unknown","text":"The reason for the repository's end is not detailed in the evidence."}],"ghost":[{"kind":"ghost","text":"The end... is not... clear."}]}
```

| Item | Value |
|---|---|
| Stop reason | `end_turn` (not truncated; it used 46 of 500 output tokens, so the 300 to 500 change did not matter here) |
| Accepted segments | 1: `unknown` "The reason for the repository's end is not detailed in the evidence." (no citations, by design for `unknown`) |
| Rejected segments | 0 (no validation rejection occurred) |
| Silently lost | the ghost line "The end... is not... clear." The model wrote it in a top-level `"ghost"` array instead of inside `segments`; the output schema ignores unknown keys, so it was dropped without any signal |
| Evidence offered | 10 references: E1 repo-metadata, E2 README, E3 issue, E4 commit, E5 to E9 issue comments, E10 issue |
| Citations / source links shown | none (an `unknown` segment cites nothing); `sources` is empty; no link in shown text |
| Rendered dialogue (as the pipeline returns it) | one line tagged "Not found": "The reason for the repository's end is not detailed in the evidence." No ghost line, no source links. I did not run the UI for this call. |
| Input / output tokens | 2,162 / 46 (input cap 4,000, output cap 500) |
| Prompt size | 7,263 bytes of system prompt plus evidence, about 3.4 bytes per token |
| Latency | 3,545 ms measured around the whole pipeline step (GitHub evidence retrieval, identity read, reservation, the Bedrock call). It is not the model's own latency; Bedrock's reported latency was not captured. |

**Cost and reconciliation**
- Raw cost at the verified prices: 2,162 x 0.06 + 46 x 0.24 = 129.72 + 11.04 = 140.76 micro-dollars = **USD 0.000141**. Recorded with the 1.5 safety factor, rounded up: **212 micro-dollars**, and `accounting.matchesUsage` is true.
- Reserved 540 before the call; reconciled to 212, so 328 was released. `BUDGET#2026-11-01 = 212` (exactly the one call's recorded cost), `REQ#bedrock#2026-11-01 = 1`, `LEASE#bedrock#0` released (deadline 0). Earlier counters (`2026-10-31`) are 0.
- The application budget is not an AWS billing cap. The real AWS charge should appear in billing as usage type `USE2-NovaLite-input-tokens` and `...-output-tokens`, with a delay of hours; I have not seen the bill.

**Final state (read directly, after the run):** `KILL#bedrock` = true via admin and via the restricted role; usage table contains the lock, the counters above, two rate-limit counters and the released lease; the role policy is unchanged; `.env.local` unchanged (mock, false, 0); no live variables remain in the shell; no further inference was run.

### 12a. Evaluation
- **Factual grounding: safe, but unhelpful.** Nothing was invented. The one sentence is true: the README says Atom "will be archived on December 15, 2022" and links to an announcement, but the README itself gives no reason, and no maintainer statement was in the evidence. However the model ignored two verified facts it had: `archived: true` (E1) and the README's archive notice (E2). The scripted mock for the same question states both. A visitor asking "Why did you die?" got only "not detailed".
- **Citation correctness: not tested.** The model produced no verified or interpretation segment, so there was nothing to cite and nothing for the validator to check.
- **Character personality: essentially absent in what was shown.** The accepted sentence is flat. The lost ghost line ("The end... is not... clear.") did use the light fragmentation intended for the distorted stage, so the model understood the voice; the format error removed it.
- **Naturalness / expressiveness:** one short, stiff sentence. Not yet a conversational experience.
- **Evidence-gap handling: good.** It said plainly that the reason is not in the evidence rather than guessing.
- **Overly aggressive validation: none observed, and none can be judged from this sample.** Zero segments were rejected. The only content lost was lost by the schema (an unexpected top-level key), which is a missing-signal problem, not strictness.
- **Human/horror consistency: not tested** (one call, one form).
- **Format compliance:** valid JSON, no prose before or after (the case I worried about did not occur), `end_turn`. The deviation was structural: an extra `ghost` key.

### 12b. Recommendation (nothing below has been done)
Do not spend more calls on the current prompt: the likely outcome is another thin answer. Fixes to make **offline first** (each is cheap to test with the existing fake-Bedrock suite):
1. **Prompt:** add one compact worked example of the exact JSON (a `verified` segment with `cites`, a `ghost` segment, both inside `segments`) and the sentence "never add other top-level keys". It costs about 150 input tokens (about USD 0.00001 per call) and addresses the observed error directly.
2. **Visibility:** have the validator report unknown top-level keys and any content dropped for that reason in the diagnostic report, so silent loss is visible.
3. **Helpfulness for status questions:** guidance to lead with the archived flag and the README notice when the evidence contains them, while still never stating a cause. The validator still enforces everything.
4. **Optional, needs a decision:** accept a top-level `ghost` array as ghost segments after the same validation. I recommend 1 and 2 first and treating 4 as a separate decision, because it widens what the parser tolerates.
Then, with your separate approval, one more Nova Lite call (about USD 0.0002) with the same limits to see whether the fix works, and later a human-form comparison. Claude remains blocked until the Anthropic use-case form is submitted. The remaining questions ("Do you miss your developers?", the other four planned calls) were not asked.

**Unresolved / unproven:** real AWS billing for this call (hours-delayed; only the price list was checked); Nova's variability across calls (n = 1); how the rendered dialogue looks in the UI for this answer.

## 13. Follow-up: Milestone 2C.3 (offline only)

The thin first reply led to a strict output contract, a deterministic evidence planner with key facts, stronger persona instructions and replay tests; see `docs/history/EVIDENCE_RICH_2C3.md`. Nothing in 2C.3 touched AWS: the kill switch is still ON and no further call has been made. A one-call retest is proposed there and needs its own authorization; it cannot run before 2026-11-02 00:00 UTC because today's single allowed request is already used.
