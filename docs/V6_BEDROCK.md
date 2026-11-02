# V6: real AWS Bedrock conversation (Phases 1 to 3: readiness; NOTHING PAID HAS BEEN RUN)

Date: 2026-11-01 (UTC). No model call, no kill-switch change, no AWS write, no IAM change. `.env.local` is unchanged (provider `mock`, flag `false`). Read-only AWS calls only (the preflight).

## 1. What already exists (reused, not rebuilt)
`ChatProvider` interface; Bedrock Converse adapter; the `runChat` gate (config, flag, env and shared kill switch, input guard, per-client limit, concurrency lease, daily request cap, atomic budget reservation, timeout, reconcile); DynamoDB usage counters; evidence retrieval and the era-scoped `asOf` path; strict output contract and citation validator; saved-identity personality prompt; UI that discloses `provider` and `scripted` per reply. One real Nova Lite call was made on 2026-11-01 (see `docs/NOVA_LITE_2C2.md` section 12): it worked end to end but the answer was thin; 2C.3 changed the prompt and contract offline only (`docs/EVIDENCE_RICH_2C3.md`) and that is still unproven on a real model.

## 2. What prevents a real inference request today (exact blockers)
| # | Blocker | Kind | Status |
|---|---|---|---|
| 1 | **Daily allowance spent.** `REQ#bedrock#2026-11-01 = 1` against a cap of 1/day. Budget used: 212 of 20,000 micro-dollars. | time | resets at **2026-11-02 00:00 UTC** (the preflight turns GO by itself) |
| 2 | **Shared kill switch ON** (`KILL#bedrock = true`, seen by admin and by the restricted role). | intended | stays ON until you authorize |
| 3 | `.env.local` is mock-safe by design: provider `mock`, flag `false`, `LIVE_GENERATION_ENABLED=0`, no prices, no usage-table settings, and `BEDROCK_MODEL_ID` is the **Claude** Haiku profile (blocked at account level, not approved). | config | live values exist only in the shell for the run (runner sets them) |
| 4 | **The restricted role cannot read VisualStudioUninstaller's saved identity.** Its IAM allows `GetItem` on the identity table for repo ID 3228505 (atom/atom) only; VSU is 42753362 -> `AccessDenied`. Run entirely as the restricted profile, the ghost would fall back to a provisional (different) personality. | permissions | **solved without IAM changes** by `GITGHOST_BEDROCK_AWS_PROFILE` (below) |
| 5 | The 2C.2 harness was hard-wired to atom/atom and "Why did you die?". | code | solved: plan `nova-lite-v6` |

Everything else passes (18 of 19 preflight checks): model ACTIVE and ON_DEMAND, AUTHORIZED, no agreement needed, role policy equals the approved Nova policy, simulator allows InvokeModel on the model, table ACTIVE with TTL, budget guard, VSU identity = archivist/curious, 243 related offline tests.

## 3. Model and prices (verified, not assumed)
- Model: `amazon.nova-lite-v1:0`, invoked directly (bare ID) in `us-east-2`; `get-foundation-model` says ACTIVE, `ON_DEMAND`, TEXT output; availability AUTHORIZED / AVAILABLE; no marketplace agreement or use-case form (re-run read-only today by the preflight).
- Prices: AWS Price List API, offer `AmazonBedrock` version **20261030160456** (published 2026-10-30), terms effective 2026-10-01, us-east-2, on-demand: input tokens **USD 0.00006 per 1K = 0.06 per million**, output tokens **USD 0.00024 per 1K = 0.24 per million**. Re-fetched and read today. Batch and cache-read rows do not apply (no batch, no prompt caching).

## 4. Changes made in this phase (offline, tested)
- `GITGHOST_BEDROCK_AWS_PROFILE` (optional, validated name): when set, the Bedrock client and the usage-counter DynamoDB client use that named profile; identity storage keeps the default credential chain. Verified read-only: with `AWS_PROFILE=default`, a client built with `profile: "gitghost-smoke"` is denied on the identity table while a plain client reads it. No gate changed; unset means the old behaviour.
- Plan `nova-lite-v6` in the validation harness: same model, region, prices and ceilings as `nova-lite` (1 call, 1 request/day, USD 0.02 budget, 4,000 input / 500 output tokens, concurrency 1, 20 s, safety factor at least 1.5), pinned to `microsoft/VisualStudioUninstaller` and the question "Tell me about your past. What was this repository originally created to do?", and it **refuses to start unless `GITGHOST_BEDROCK_AWS_PROFILE=gitghost-smoke`**.
- `infra/v6/v6-preflight.sh` (read-only, 19 checks) and `infra/v6/v6-run.sh` (dry run by default; needs `--execute` AND `GITGHOST_NOVA_AUTHORIZED=I_AUTHORIZE_ONE_NOVA_LITE_V6_CALL_UP_TO_0.02_USD`; lock check with the kill switch ON must refuse with zero model calls; unlock; the one call; re-lock via an exit trap; verify; counters). The dry run was executed: it unlocked nothing.
- `src/server/chat/v6-plan.test.ts` (17 tests). Full suite: typecheck, lint, 800 tests passed (4 skipped).
- The question classifies as the `history` intent: the page evidence (repository record, README excerpt, newest commit) plus the six earliest commits are retrieved. The scripted mock answers it from the record and early commits (it does not cite the README), so how well a model uses the README for "what was it created to do" is exactly what the real call will show.

## 5. The proposed single call (not authorized)
| Item | Value |
|---|---|
| Model ID | `amazon.nova-lite-v1:0` (bare, in-region, no inference profile) |
| Region | `us-east-2` |
| Profiles | billable work (Bedrock + usage counters + kill-switch read): `gitghost-smoke` (assumes `gitghost-smoke-runtime`). Identity read: `default`. Kill-switch unlock/relock: `default` (admin), done by the runner, not by the app |
| Allowance | 1 request per UTC day; today's is used; next window opens 2026-11-02 00:00 UTC |
| Missing configuration | none in the runner (it sets everything in the shell). `.env.local` deliberately stays mock |
| Estimated max cost | worst-case reservation **540 micro-dollars = USD 0.00054** (applies the 1.5 safety factor); the real AWS charge is bounded by 4,000 x 0.06 + 500 x 0.24 = **USD 0.00036**; expected about USD 0.0002 (about 2,000 input tokens and 150 to 300 output tokens, based on the earlier call: 2,162 in, 46 out, USD 0.000141) |
| Kill-switch change | `KILL#bedrock` true -> false by the admin profile, only inside the runner, only after the lock check passes; set back to true by an exit trap on any outcome |
| Stop conditions | lock check not refused; any failed or refused call (no retry); accounting mismatch; any link or number on screen not in its cited evidence |
| Rollback | the runner re-locks automatically. By hand: `AWS_PROFILE=default aws dynamodb update-item --region us-east-2 --table-name gitghost-usage-counters --key '{"pk":{"S":"KILL#bedrock"}}' --update-expression "SET #o = :t" --expression-attribute-names '{"#o":"on"}' --expression-attribute-values '{":t":{"BOOL":true}}'`. Also: `GITGHOST_BEDROCK_ENABLED=false` / provider `mock`, or remove `bedrock:InvokeModel` from the role. Nothing is committed, deployed or created, so there is nothing else to undo |

## 6. Phase 4 notes (after one successful authorized call)
Run the app with the same shell environment as the runner, plus `GITGHOST_CHAT_PROVIDER=bedrock` and the kill switch unlocked by you. With `GITGHOST_BEDROCK_AWS_PROFILE=gitghost-smoke` the restricted role handles billable work and the default profile keeps handling identities, so every repository keeps its saved personality. The UI already shows per reply whether it was scripted or AI-written; the mock provider remains the default and the fallback.

## 7. Authorization needed
- [ ] Wait for 2026-11-02 00:00 UTC (or explicitly raise the daily ceiling for this one run; not recommended).
- [ ] Explicit message authorizing: the lock check, unlocking `KILL#bedrock`, ONE `amazon.nova-lite-v1:0` call on microsoft/VisualStudioUninstaller with the question above, the automatic re-lock, a USD 0.02 application budget (worst-case reservation USD 0.00054), no retries.
- [ ] Then I (or you) run `GITGHOST_NOVA_AUTHORIZED=I_AUTHORIZE_ONE_NOVA_LITE_V6_CALL_UP_TO_0.02_USD ./infra/v6/v6-run.sh --execute`.

## 8. Phase 4 preparation with a mocked model (2026-11-01; no paid call, kill switch still ON, cap still 1)
Verified offline (typecheck, lint, 833 tests passed / 4 skipped; browser: V6 80 checks, V5 demo 104, failures 18, V5.3 42):

- **Wiring.** The browser already reaches the provider through `/api/chat` -> `answerQuestion` -> `runChat` -> `ChatProvider`; nothing about that changed and the default stays `mock`. `src/app/api/chat/route.bedrock-mock.test.ts` (22 tests) drives the REAL route, pipeline, gate, Bedrock adapter and validator with a fake model, a fake usage table and fake GitHub (the runtime and identity store are wrapped so no AWS client can be built).
- **Rendering.** `scripts/v6-browser.mts` replays the route's actual responses (written by that test to `.local/v6/ui-fixtures.json`) into the V5.3 dialogue. AI answers show a visible "AI" tag and "AI-written, checked against sources"; scripted ones show "scripted, no AI"; both coexist in one conversation. The server banner for a model-configured server reads "replies: AI model, each reply labelled".
- **Failure shapes**, each shown as an alert with a retry and no answer, with only the server's own plain message: malformed JSON, empty text, empty segment list, provider timeout (504, reservation kept), provider error with ARN-like text (502, none of it shown), rate limit (429 with wait), daily cap, budget, kill switch (also offers the offline demo, never a silent scripted answer), dropped connection, a non-JSON gateway page. A citation of an unretrieved item is dropped and the answer says it could not support one.
- **Gates still bite.** Env kill switch refuses before GitHub or any AWS client; shared kill switch ON -> 503 and nothing reserved; failing usage table -> 503; budget below one reservation -> 429 before the model; per-minute and daily limits -> 429; with a 1/day cap and USD 0.02 of room, four questions give one call and three 429s.
- **Era.** An earlier commit sends its full SHA and look; the model prompt gets the TIME FRAME clause and none of the later commits, issues or present-day flags; a claim with a later date or an invented citation is dropped; back in the present no era is sent.
- **Secrets.** No success or failure body contains model ID, region, profile, table name, token counts, costs or prompt text; the answer has exactly ten keys; the page markup, storage and all downloaded scripts contain no model ID, profile, table, SDK or key.
- **USD 0.02.** It is a budget ceiling: the plan allows 1 call and 1 request/day (the budget alone would fit 37 reservations), the checker refuses 2 requests/day, and the runner invokes the live test exactly twice (kill-switch lock check, then the one call).
- **Split credentials, reviewed.** Only two files build AWS clients. The usage counters/kill-switch read and Bedrock use `gitghost-smoke` (verified by a constructor-recording test). The identity store uses the default chain with no profile. **Residual risk, stated plainly:** "default" is the admin profile, so identity reads do NOT run with minimal permissions; they only avoid the restricted role's inability to read VSU's identity. Least privilege for identities would need a separate identity role (an IAM change, not made).
- **Findings.** (1) The validator checks numbers by substring, so a bare small integer can be "supported" by any digit inside the cited text (for example "Change number 9" citing a commit whose date contains 9). Dates, versions, hashes, issue numbers and invented citations are caught. Not changed here; worth tightening to word-boundary matching. (2) A server configured for Bedrock whose shared kill switch is ON still shows the "AI model" banner until a question is asked; each answer or refusal is labelled individually.
- **Small UI changes made:** AI tag and note, the banner wording, and the error's offline-demo link for kill-switch/daily/budget/provider codes.

## 9. Test-call policy for development and demo (prepared, NOT applied; no paid call)
**Where the daily ceiling lives.** It is enforced in three layers, and only the first is a setting you change for the running app:
1. `GITGHOST_CHAT_REQUESTS_PER_DAY` (`src/server/chat/config.ts`, default 100 in code, `.env.example`). `runChat` counts every request in the shared table (`REQ#bedrock#<UTC day>`) and refuses the next one with 429 `daily_limit`, refunding its reservation.
2. The validation plans (`src/server/chat/validation-harness.ts`, field `maxRequestsPerDay`, currently 1 for `nova-lite` and `nova-lite-v6`). They only govern the one-shot runner in `infra/v6/v6-run.sh`, and they are deliberately left at 1.
3. The preflight allowance check (`infra/v6/v6-preflight.sh`, "room for one more request today"), which belongs to the same one-shot runner.

**Prepared profiles** (plain shell files, never loaded automatically, never touching `.env.local`, the kill switch or IAM): `infra/v6/profiles/dev.env` and `infra/v6/profiles/demo.env`. Use them in the shell only: `set -a; . infra/v6/profiles/dev.env; set +a; npx next start -p 3100`. `src/server/chat/limit-profiles.test.ts` checks both.

| Setting | Current one-shot runner | Development (`dev.env`) | Demo (`demo.env`) |
|---|---|---|---|
| Requests per UTC day | 1 | **3** | **8** (inside your 5 to 10) |
| Per client per minute | 1 | 1 | 2 |
| Concurrency | 1 | 1 | 1 |
| Daily application budget | USD 0.02 | **USD 0.003** (3,000 micro-dollars) | **USD 0.006** (6,000 micro-dollars) |
| Max input / output tokens | 4,000 / 500 | 4,000 / 500 | 4,000 / 500 |
| Timeout, safety factor | 20 s, 1.5 | 20 s, 1.5 | 20 s, 1.5 |
| Worst-case reservation per request | 540 micro-dollars | 540 | 540 |
| Reservations the budget fits | 37 | 5 | 11 |
| Worst-case AWS charge for the day (requests x USD 0.00036) | USD 0.00036 | **USD 0.00108** | **USD 0.00288** |
| Expected real cost for the day (about USD 0.0002 each) | USD 0.0002 | about USD 0.0006 | about USD 0.0016 |

Why these numbers: the day cap is the binding limit, and the budget is a second, tighter tripwire (it fits the day's requests even if every one timed out and kept its full reservation, but nothing close to the old USD 0.02). Both stay far below the independent AWS Budgets guard (USD 0.05 a day).

**What stays exactly as it was:** the shared kill switch (`KILL#bedrock` stays ON until you unlock it; a profile cannot do that), the environment kill switch (explicit `false` in the profile), token caps, per-client rate limit, concurrency 1, atomic budget reservation and reconcile, usage accounting in DynamoDB, the restricted `gitghost-smoke` profile for billable work, the approved model, region and prices. `GITGHOST_TRUSTED_IP_SOURCE=none` means all visitors share one rate-limit bucket, which is right for a private session and wrong for a public one.

**No automatic retries: a gap found and closed.** The application has no retry logic, but the AWS SDK's default is three attempts on throttling and server errors, so a Bedrock call could have been repeated behind the cost gate's back. The Bedrock client is now built with `maxAttempts: 1` (`src/server/chat/runtime.ts`, pinned by `credential-split.test.ts`). The usage-counter client keeps the SDK default: a retried counter increment can only over-count, which makes the cap stricter. No existing gate or default changed.

**To apply a profile later** (needs your explicit approval and the kill switch unlocked by you): source the file in the shell that starts the server. To go back, stop the server or start it without the file; the default configuration is the scripted provider.

## 10. V6.1: running GitGhost locally with live Bedrock, and shutting it down

**Prepared, not started.** `infra/v6/live-session.sh` runs the production build on `http://localhost:3100` with `infra/v6/profiles/demo.env` (Nova Lite `amazon.nova-lite-v1:0`, us-east-2, 8 requests/day, 2/minute, concurrency 1, USD 0.006/day, 4,000 in / 500 out tokens, one attempt per call, billing as `gitghost-smoke`, identities as `default`). The profile is exported into the server's shell only, so `.env.local` is never read for those values and never edited.

```
npm run build                                     # only if the source changed
./infra/v6/live-session.sh status                 # read-only: kill switch, today's count, server, and a warning if .env.local is live
./infra/v6/live-session.sh start --minutes 60     # DRY RUN: prints exactly what would happen
GITGHOST_LIVE_SESSION_AUTHORIZED=I_AUTHORIZE_A_LIVE_DEMO_SESSION_UP_TO_8_REQUESTS_AND_0.006_USD \
  ./infra/v6/live-session.sh start --execute --minutes 60
```
`start --execute` refuses unless: the kill switch is locked, today's count is below the cap (8), nothing listens on :3100, and a build exists. It starts the server, then unlocks `KILL#bedrock` (only if locked), then schedules an automatic re-lock and server stop after N minutes (5 to 240).

```
./infra/v6/live-session.sh stop                   # stops the server, cancels the timer, RE-LOCKS the kill switch, prints counters
```
`stop` needs no authorization and exits non-zero if the switch is not locked afterwards. For browser checks that must never reach a model use `./infra/v6/serve-mock.sh` (forces the scripted provider whatever `.env.local` says).

**The app shows who wrote each reply.** Every reply carries "AI-written, checked against sources" with an AI tag, or "scripted, no AI". The header shows "Scripted replies" or "AI replies" on wide screens (`?dev=1` shows the long form).

### Incident during V6.1 (what happened, stated plainly)
While `.env.local` had been switched by the owner to `GITGHOST_CHAT_PROVIDER=bedrock` / `GITGHOST_BEDROCK_ENABLED=true` (limits there: 100 requests/day, USD 1.00/day) and the shared kill switch had been unlocked, my browser verification started a server from that `.env.local` without checking it. The questions the checks asked were therefore answered by real Nova Lite: **10 requests**, taking today's count from 1 to 11 and the recorded spend from 212 to 1,775 micro-dollars (about USD 0.0016 recorded including the 1.5 safety factor; roughly USD 0.001 raw). This was not authorized for that phase. As soon as I found it I stopped the server and re-locked the kill switch (`live-session.sh stop`), then re-ran the matrix on the mock-pinned server and confirmed the count stayed at 11. The one useful by-product: `docs/screenshots/v6-1/live-ai-reply-desktop.png` is a real AI reply rendered in the dialogue (labelled AI, seals open the records). In that reply the model produced no ghost line, only plain facts, so voice quality is still unproven.

Open items that are the owner's decisions: (1) `.env.local` currently selects Bedrock with looser limits than the demo profile; (2) `infra/v6/v6-run.sh` and `src/server/chat/v6-plan.test.ts` were edited to 100 requests/day, which the plan's own ceiling check (max 1) refuses, so 3 tests in `v6-plan.test.ts` currently fail. I did not touch either.
