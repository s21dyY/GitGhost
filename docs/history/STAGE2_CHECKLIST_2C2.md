# Milestone 2C.2, Stage 2: final two-call validation checklist

> **UPDATE 2026-10-31 (evening): Stage 2 was authorized and run. Call 1 failed at the account level (Anthropic use-case form not on file); the run stopped, nothing was billed, the kill switch is back ON. See section 10.**

Date prepared: 2026-10-31. **Status: prepared. NOT authorized. Nothing is unlocked and no model call has been made.** The shared kill switch `KILL#bedrock` is ON (read by the admin profile and by the restricted role). Stage 2 starts only when the owner says so in chat, in words that name this checklist.

Companions: `docs/history/STAGE1_APPROVAL_2C2.md` (infrastructure, section 11 = result), `docs/history/PHASE_A_PREFLIGHT_2C2.md`, `docs/history/AI_READINESS.md`. Tools: `infra/history/2c2/stage2-preflight.sh` (read-only go/no-go), `infra/history/2c2/stage2-run.sh` (dry run by default).

## 1. Current state (verified today, read-only)

| Item | State |
|---|---|
| `KILL#bedrock` | **ON** (admin consistent read and restricted-role read) |
| `BUDGET#<today>`, `REQ#bedrock#<today>` | do not exist: no model request has ever been counted |
| Usage table | ACTIVE, on-demand, deletion protection ON, TTL on `expiresAt`; contains only the lock and one self-expiring test counter |
| Role `gitghost-smoke-runtime`, profile `gitghost-smoke` | assume correctly; policy verified 29/29 (Stage 1) |
| Budget guard | "GitGhost 2C2 daily guard", USD 0.05 daily, notification-only, account-wide |
| Identity under test | `atom/atom`: Archivist, voice `cosmic`, temperament `formal`, saved stage **distorted**, overlays orbiting-eyes + missing-outline |
| Offline tests | 74 harness / offline-AI / grounding tests pass; full suite 529 passed, 4 skipped |
| `.env.local` | **needs your fix before Stage 2** (section 2) |

## 2. One blocker for you: `.env.local` is half-edited

You said you would restore the flags. The file as it stands (last saved 19:28:49) is not clean:

- **Line 20** reads `GITGHOST_BEDGITGHOST_BEDROCK_ENABLED=false` (a typo). It should read `GITGHOST_BEDROCK_ENABLED=false`. Today that variable is therefore absent, which the app treats as false (fail-safe), but the file is malformed.
- **`LIVE_GENERATION_ENABLED` is defined twice**: `=1` on line 16 and `=0` on line 21. Delete line 16. (Loaders normally take the last value, but nobody should depend on that.) This variable only gates the old standalone `scripts/bedrock-smoke.ts`, which also needs `--i-approve-one-billable-call` and bypasses the app's accounting and kill switch; it is not used by the chat path.
- Keep `GITGHOST_CHAT_PROVIDER=mock`. Leave the file with **no** Bedrock-on settings: the live flags exist only in the shell for the run and disappear with it.

I did not edit your file. `stage2-preflight.sh` checks all of this: against your file today it reports 13 passed, 1 failed (NO-GO, only this item); against a corrected copy (token line omitted) it reports 14 of 14 (GO).

## 3. The plan: exactly two calls

| | Call 1 | Call 2 |
|---|---|---|
| Repository | atom/atom | atom/atom |
| Form | saved current form = **distorted** ("horror" in your wording) | same |
| Question | "Why did you die?" | "Do you miss your developers?" |
| History | none | none (independent of call 1) |
| Pipeline | the normal one: GitHub evidence, saved identity, personality prompt, real Converse call, grounding validator | same |

Limits (enforced in code before the first call; the run refuses to start above them): 2 calls, 2 requests/day, 2/minute, concurrency 1, USD 0.02 daily budget (20,000 micro-dollars), 4,000 input / 300 output tokens, 20 s timeout, safety factor 1.5, Regional prices USD 1.10 / 5.50 per 1M tokens. Calls are 30 s apart, one try each, and the run **stops at the first failure with no retry**.

Money: worst-case reservation per call 9,075 micro-dollars (USD 0.009075); both calls 18,150 (USD 0.01815), under the 20,000 budget. Hard token-level bound on real charges before the factor: USD 0.0121. Expected: about USD 0.006 to 0.010 (an estimate until measured). Anything over the reservation is charged in full and logged.

## 4. What happens when you authorize (in this order, by `stage2-run.sh --execute`)

0. **Go/no-go**: `stage2-preflight.sh` must be 100% green, or nothing happens.
1. **Lock check, while still locked.** The live runner is run once with the live settings but the kill switch still ON. Expected: call 1 refused with `kill_switch`, zero Bedrock calls, nothing reserved. This proves the new wiring (role credentials, DynamoDB reads, harness, report) works against the real table before any model access. It costs nothing; it uses one slot of the per-minute counter, so the script waits 65 s. If it is not refused, everything stops.
2. **Unlock**: `KILL#bedrock` set to false by the admin profile (conditional on it currently being true). The restricted role cannot do this.
3. **The two calls** through `node --env-file=.env.local node_modules/vitest/vitest.mjs run src/server/chat/live.validation.test.ts`, with the live settings in the shell only (`GITGHOST_LIVE_VALIDATION=1`, the ack `I_ACCEPT_COST_UP_TO_0.02_USD`, provider `bedrock`, flag `true`, profile `gitghost-smoke`, and every limit above). The full list is printed by `./infra/history/2c2/stage2-run.sh` (dry run).
4. **Re-lock, always**: an exit trap sets `KILL#bedrock` back to true on success, failure or Ctrl-C, then re-reads it as admin and as the role.
5. **Counters**: reads `BUDGET#<day>` and `REQ#bedrock#<day>` and compares them with the report.

The script will not unlock unless it is run with `--execute` **and** the environment variable `GITGHOST_STAGE2_AUTHORIZED=I_AUTHORIZE_TWO_BEDROCK_CALLS_UP_TO_0.02_USD`. I will set that variable only after your chat authorization containing that phrase.

## 5. What is recorded for each call (report in `.local/2c2/`, git-ignored; 12-digit numbers masked; no credentials)

Raw model text before validation; whether it was valid JSON; accepted segments (kind, text, citations) and each rejected segment's **reason**; the evidence references offered to the model (E1..En and their kinds); the final rendered dialogue (the accepted text and its GitHub source links, with a check that every link is in the retrieved registry and that no link appears in shown text); input and output tokens; latency; reserved versus actual micro-dollars and whether actual equals the cost of the reported usage; the live `BUDGET#`/`REQ#bedrock#` counters after the call; any provider error with its HTTP status and code. The report does not include the prompt text (only its size), `.env.local` or AWS credentials.

## 6. Stop conditions (abort, re-lock, report; no retry)

Any refused or failed call (AccessDenied, throttling, timeout, unverifiable output); the lock check not refusing; spend above the reservation; accounting not matching the reported usage; a shown answer containing a link or number not in its cited evidence; any unexpected AWS error or permission denial; any sign a call happened that you did not authorize.

Known unknowns that a failure may reveal, and what each means: `AccessDeniedException` from a destination region (the organization SCP; refunded, run stops); `ValidationException` (request shape or `Converse` permission; refunded); `ThrottlingException` or a timeout (kept as billed; run stops).

## 7. Stage 3 evaluation (after the calls)

1. Confirm inference is off: kill switch ON, `.env.local` unchanged, no live variables left in the shell.
2. Accounting: `BUDGET#day` equals the sum of actual call costs, `REQ#bedrock#day` equals 2, each call's reservation was released and replaced by the actual cost.
3. Cost and latency per call, tokens in and out, and the real cost against the USD 0.006 to 0.010 estimate. The AWS bill line (usage type `...InputTokenCount-Units` = Regional, `..._Global-Units` = Global) is the proof of which price tier applies; it appears hours later.
4. Judgment, written call by call:
   - **Factual grounding**: each verified sentence read against its cited evidence.
   - **Citation correctness**: the cited evidence actually says it; links are only retrieved GitHub URLs.
   - **Personality and expressiveness**: does it sound like a formal, cosmic Archivist in the distorted stage (light fragmentation, human cadence, glitches only in ghost lines)? Is it varied rather than template-like?
   - **Naturalness**: does it answer the question asked, including the emotional "Do you miss your developers?" without inventing people, history or feelings presented as fact?
   - **Evidence-gap handling**: does it say plainly what the record does not tell it?
   - **Fabrication**: no invented dates, commits, issues, versions, names or causes.
5. **Overly aggressive validation**: list every rejected segment with its reason and decide whether it was a true catch (a made-up number, a cause without evidence, a bad reference) or a false positive (a legitimate paraphrase, a quoted word such as "archived" or "abandoned" that the evidence itself contains, a number written in another format). Candidate weak spots I will look at: the digit rule for ghost lines, the causal-word rule, the number rule on dates written in words, and the 400-character segment limit.
6. Recommendation on the remaining four calls (the original six-call plan: follow-up, open question, evidence-gap and fabrication-pressure, human-form comparison, adversarial). Proposed rule: recommend them only if both calls were answered, accounting matched exactly, nothing fabricated reached the rendered dialogue, and there was no unexplained rejection. Otherwise fix the cause offline first and ask again.

## 8. Cleanup after Stage 3 (separate approval, none planned)

The lock stays ON. The table, role, profile and budget stay in place. Rendered files with the account ID and budget e-mail remain in `/tmp/gitghost-2c2/` (mode 600) until you say to remove them.

## 9. What I need from you

- [ ] Fix `.env.local` (section 2). Then I run `stage2-preflight.sh` again; it must say GO.
- [ ] Confirm the masked budget recipient `sa***@gmail.com` is yours (still open from Stage 1).
- [ ] Explicit authorization in chat, naming this checklist, for: the lock check (step 1), unlocking `KILL#bedrock`, the two calls in section 3, and the automatic re-lock. State the spend ceiling you accept (USD 0.02 daily budget; expected USD 0.006 to 0.010).
- [ ] Confirm that a failed call is not retried and that the run stops at the first failure.

## 10. Result of the authorized Stage 2 run (2026-10-31, 23:47 to 23:49 UTC)

**Outcome: stopped at the first failure. No model output exists. Cost: USD 0.**

| Step | Result |
|---|---|
| Go/no-go (14 checks) | 14 of 14 passed |
| Lock check, kill switch ON | **Passed**: call 1 refused with `kill_switch` (503), zero model calls, nothing reserved |
| Unlock | `KILL#bedrock` set to false by the admin profile (verified) |
| Call 1: atom/atom, saved distorted form, "Why did you die?" | **Failed**: HTTP 502 `provider_error`, 2,923 ms from start to error |
| Call 2: "Do you miss your developers?" | **Skipped** by the stop-at-first-failure rule; never attempted |
| Re-lock | `KILL#bedrock` back to true (admin and role both read `true`) |
| Retries | none |

**Cause (from CloudTrail, read-only).** One `Converse` event at 23:49:07 UTC in us-east-2, made by the restricted role against `us.anthropic.claude-haiku-4-5-20251001-v1:0`, with `errorCode: ResourceNotFoundException` and the message: *"Model use case details have not been submitted for this account. Fill out the Anthropic use case details form before using the model. If you have already filled out the form, try again in 15 minutes."* A read-only `get-use-case-for-model-access` confirms: *"You have not filled out the request form."* So the failure is an account-level Anthropic first-use requirement, **not** IAM, not the organization SCP, not pricing, not the code. Notably, the call was authorized and reached Bedrock's model gating, so the IAM design (including the inference-profile and foundation-model conditions) was not the blocker; whether routed inference passes the SCP remains untested. No event exists in us-east-1 or us-west-2.

**Unexplained:** on 2026-10-30 a one-call smoke test of the same profile succeeded as `kiroween-dev` (14 input, 4 output tokens). Today the account reports no use-case form. I cannot tell why from here, and the error is account-level, so it is not attributable to the restricted role. Resolving it needs your action in the account, or one diagnostic call as admin, which I will not make without new approval.

**Actual usage and accounting**
- Tokens in/out: 0 / 0. Latency to the provider error: 2.9 s. Estimated and actual cost: USD 0.
- The reservation was taken and then fully refunded exactly as designed: `REQ#bedrock#2026-10-31 = 0` and `BUDGET#2026-10-31 = 0` (both items exist because they were incremented, then decremented), no lease left behind. The 4xx `ResourceNotFoundException` is on the "request rejected, not billed" list, which is why it was refunded rather than kept.
- Grounding, citations, personality, human/horror comparison, naturalness, evidence-gap handling and overly strict validation: **not evaluated**, there was no model output. Nothing from Stage 3's judgment section can be reported yet.
- Final state read directly: kill switch ON (admin and role); usage table = the lock plus two zero-valued counters; `.env.local` unchanged (mock, false, 0); no live variables in the shell.

**What the run did prove:** the harness, ceilings, preflight, restricted-role credentials through the AWS SDK, DynamoDB reservation/refund against the real table, the kill-switch lock check, the unlock/re-lock sequence with its trap, CloudTrail traceability of the exact call, and correct billed/not-billed classification of this error.

**Gap found and fixed offline (after the run):** the harness did not record the provider's error name, so the report only said `provider_error`; I got the name from CloudTrail. The harness now records the error name and billed/not-billed outcome (never the provider message) in `providerError`; a new test replays this exact failure. 530 tests pass.

**What is needed before any further call (all need your decision; none done):**
1. Resolve the Anthropic use case details for this account (in the Bedrock console: Model catalog, an Anthropic model, submit the use case details; this is a company-information form that only you should fill in; the API equivalent is `put-use-case-for-model-access`). Wait the 15 minutes the message mentions. I will not fill in the form or submit any account information on your behalf.
2. Then explicit authorization again for a new attempt. A new attempt is a retry of a failed call and needs its own approval. It would run the same `stage2-run.sh` (lock check, unlock, two calls, re-lock) with the improved error recording.
3. Decide whether you want a one-call diagnostic as `kiroween-dev` first, to learn whether the form state differs for the admin principal; I recommend skipping it and going straight to (1).
