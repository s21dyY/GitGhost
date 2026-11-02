# Milestone 2C.2, Stage 1: infrastructure approval package

> **UPDATE 2026-10-31: Stage 1 was approved and APPLIED. See section 11 for the result.** Changes after the original draft: both DynamoDB `LeadingKeys` conditions now also carry `Null: false`, and `stage1-apply.sh` was rewritten as plan-then-execute with resume support (section 11).

Date: 2026-10-31. Status: **prepared, not applied.** Nothing in AWS has been created or modified. Stage 2 (the two model calls) is a separate authorization and is not covered here.

Companion documents: `docs/AI_READINESS.md`, `docs/PHASE_A_PREFLIGHT_2C2.md`. Machine-readable artifacts (exactly what will be applied) are in `infra/2c2/`.

## 1. Your configuration, and where I changed or flagged something

| Setting | Your proposal | Status |
|---|---|---|
| Region | us-east-2 | as proposed |
| Model | `us.anthropic.claude-haiku-4-5-20251001-v1:0` | as proposed |
| Prices | Regional USD 1.10 in / 5.50 out per 1M tokens | as proposed (source: AWS Price List `AmazonBedrockFoundationModels`, version 20261012084008). Tier for the `us.` profile is my inference, so the higher tier is used |
| Calls | 2 | harness ceiling changed from 6 to 2 and the plan reduced to your two questions |
| Daily budget | USD 0.02 | enforced in code: ceiling 20,000 micro-dollars; the run refuses to start above it |
| Safety factor | 1.5 | as proposed |
| Tokens | 4,000 in / 300 out | as proposed |
| Concurrency, timeout | 1, 20 s | as proposed (ceilings in code) |
| Requests per day | (not stated) | **2**, enforced in code; per minute 2 |
| Retries | none | harness stops at the first failure and never retries |
| Public access | none | local server only; `GITGHOST_TRUSTED_IP_SOURCE=none`; no deployment |

Money check (micro-dollars, 1 USD = 1,000,000): worst-case reservation per call = (4000 x 1.10 + 300 x 5.50) x 1.5 = 9,075. Two calls = 18,150, inside the 20,000 budget. A third reservation would not fit, so the budget itself is a second guard on the call count. Hard token-level bound on real charges for two calls, before the factor: 2 x 6,050 = USD 0.0121. Expected, from my estimate of 1,500 to 2,500 input and 150 to 300 output tokens per call: about USD 0.006 to 0.010. Estimates until measured.

Two clarifications of your Stage 2 calls:
- **"Horror" form means the saved current form.** For `atom/atom` that is **distorted** (read-only lookup: Archivist origin, `cosmic` voice, `formal` temperament, overlays orbiting-eyes and missing-outline). The prompt for distorted says "mostly coherent, with occasional unsettling slips" and allows glitching only in `ghost` segments. The fully transformed (book-head) voice is not what these calls test.
- **Each call is independent** (no history), exactly as you listed them. Call 2 therefore has no memory of call 1.

## 2. Account access assumptions

- AWS account: the one behind profile `default` (account ID masked in all output). It is a member of an AWS Organization (all features). I can read neither the organization's policies nor the SCP text.
- Provisioning runs as IAM user `kiroween-dev` (AdministratorAccess) through the `default` profile. This is only for the one-time setup commands. Credentials live in `~/.aws/credentials`; I never read or print them.
- The test itself runs as the new role through a local profile `gitghost-smoke`. `kiroween-dev` can assume it because it is an administrator; the role's trust policy also names only that user. No MFA is assumed or required.
- The existing local profile `staging` and the existing budget "GitGhost Budget" (USD 10 monthly, alert above USD 0.01 actual) are not touched.
- `~/.aws/config` will be backed up next to itself, then one profile block is appended. A rendered copy of that block, the policy files and the budget files (with the account ID and, in one file, the budget e-mail address) are written to `/tmp/gitghost-2c2/` with mode 600.
- The test reads public GitHub data with the existing `GITHUB_TOKEN` from `.env.local` (read-only). `.env.local` is not edited.

## 3. AWS operations (all by `infra/2c2/stage1-apply.sh --apply`; dry run is the default)

The script refuses to run if the table, role, CLI profile or budget already exists, so it never modifies anything pre-existing.

| # | Operation | Region | Possible cost | Reversible |
|---|---|---|---|---|
| 1 | `dynamodb create-table gitghost-usage-counters`: key `pk` (String) HASH, **on-demand**, **deletion protection on**, tags project=gitghost, milestone=2c2 | us-east-2 | no idle charge; request charges for roughly 40 to 60 small requests: far below USD 0.01 | delete needs protection turned off first (separate approval) |
| 2 | `dynamodb wait table-exists`, `update-time-to-live` on `expiresAt` | us-east-2 | none (TTL deletions are free) | yes |
| 3 | **Lock:** `put-item KILL#bedrock on=true` (conditional: only if absent) | us-east-2 | none | flip to false in Stage 2 (separate authorization) |
| 4 | `iam create-role gitghost-smoke-runtime` with the trust policy below, max session 1 h, tagged | global | none | `delete-role-policy` + `delete-role` |
| 5 | `iam put-role-policy gitghost-2c2-smoke` with the permissions policy below | global | none | yes |
| 6 | Backup `~/.aws/config` to `config.bak-2c2-<timestamp>`, append profile `gitghost-smoke` | local file | none | restore the backup |
| 7 | `budgets create-budget "GitGhost 2C2 daily guard"`: COST, DAILY, USD 0.05, e-mail when ACTUAL spend is above 100% of the budget; recipient copied at run time from the existing budget's subscriber (not printed) | global | budgets without actions are free per AWS documentation (I did not verify this on the bill) | `delete-budget` |

Read-only validation already done in this package: both policies pass IAM Access Analyzer `validate-policy` with **zero findings** (also free), all JSON parses, both scripts pass `bash -n`, and the apply script's dry run prints exactly the commands above.

Budget alerts lag (usually hours) and fire after spend. They are a tripwire, not a cap; the cap is the application reservation plus the lock.

## 4. Final IAM documents (identical to `infra/2c2/*.tmpl`; `__ACCOUNT_ID__` is filled at apply time)

**Trust policy**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "OnlyTheDevUserForThisTest",
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::__ACCOUNT_ID__:user/kiroween-dev" },
      "Action": "sts:AssumeRole",
      "Condition": { "StringEquals": { "sts:RoleSessionName": "gitghost-2c2" } }
    }
  ]
}
```

**Permissions policy** (inline on the role)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "ReadUsageCountersAndKillSwitch", "Effect": "Allow", "Action": ["dynamodb:GetItem"],
      "Resource": "arn:aws:dynamodb:us-east-2:__ACCOUNT_ID__:table/gitghost-usage-counters" },
    { "Sid": "WriteCountersNeverTheKillSwitch", "Effect": "Allow", "Action": ["dynamodb:UpdateItem"],
      "Resource": "arn:aws:dynamodb:us-east-2:__ACCOUNT_ID__:table/gitghost-usage-counters",
      "Condition": { "ForAllValues:StringLike": { "dynamodb:LeadingKeys": ["RL#*", "REQ#*", "BUDGET#*", "LEASE#*"] },
                     "Null": { "dynamodb:LeadingKeys": "false" } } },
    { "Sid": "ReadOnlyTheAtomAtomGhostIdentity", "Effect": "Allow", "Action": ["dynamodb:GetItem"],
      "Resource": "arn:aws:dynamodb:us-east-2:__ACCOUNT_ID__:table/gitghost-entity-assignments",
      "Condition": { "ForAllValues:StringEquals": { "dynamodb:LeadingKeys": ["3228505"] },
                     "Null": { "dynamodb:LeadingKeys": "false" } } },
    { "Sid": "InvokeOnlyThroughThisInferenceProfile", "Effect": "Allow", "Action": ["bedrock:InvokeModel"],
      "Resource": "arn:aws:bedrock:us-east-2:__ACCOUNT_ID__:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0" },
    { "Sid": "InvokeUnderlyingModelOnlyViaThatProfile", "Effect": "Allow", "Action": ["bedrock:InvokeModel"],
      "Resource": [
        "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0",
        "arn:aws:bedrock:us-east-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0",
        "arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0" ],
      "Condition": { "StringEquals": { "bedrock:InferenceProfileArn": "arn:aws:bedrock:us-east-2:__ACCOUNT_ID__:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0" } } }
  ]
}
```

What this deliberately cannot do (tightened beyond Phase A):
- **Cannot turn the kill switch off.** `UpdateItem` is limited to key prefixes `RL#`, `REQ#`, `BUDGET#`, `LEASE#` (the only prefixes the code writes), so the test process cannot modify `KILL#bedrock`. It can only read it.
- **Cannot read any other ghost.** The identity read is limited to repository ID 3228505 (`atom/atom`); no `PutItem` on the identity table at all (chat is read-only for identities).
- No `Scan`, `Query`, `PutItem`, `DeleteItem`, `DescribeTable`, no wildcard resources, no `bedrock:*`, no model list/get calls, no other model, no streaming action.
- The underlying model can be invoked **only** through the named profile (the condition key `bedrock:InferenceProfileArn`).
- Usage-counter reads are table-wide (the code reads rate-limit, request, budget, lease and kill items), which is as narrow as `GetItem` can be without a per-key list.

Residual: this still lets a bug in the app burn Bedrock tokens, bounded by the app's own reservation, the lock, the daily budget, and one assumption: that `Converse` is authorized by `bedrock:InvokeModel` (per AWS documentation as I recall it; the simulator check and the first call test it).

## 5. Cross-region inference and SCP constraints: what I verified and what I could not

Verified now (read-only):
- The `us.` profile routes to us-east-1, us-east-2 and us-west-2.
- An organization **service control policy `p-buss865h` explicitly denies DynamoDB in us-east-1 and us-west-2** (the error message names it). I could not read its text (`organizations:DescribePolicy` is denied for this account).
- Bedrock **control-plane reads work in all three regions** (`ListInferenceProfiles`: 99, 98, 98 profiles), so Bedrock is not blanket-blocked by region.
- The IAM simulator says `bedrock:InvokeModel` on the profile is allowed for the admin user. The simulator cannot evaluate SCPs.

Not verifiable without a billable call: whether inference actually served from us-east-1 or us-west-2 is allowed, and whether the SCP's condition (for example `aws:RequestedRegion`) applies to the destination region. I recall AWS guidance that region-restricting SCPs may need to allow the destination regions of a cross-region profile, but I did not verify that, and I do not know what this SCP checks. An earlier 18-token call succeeded, which shows at least some routing works.

How this is handled: a denial is `AccessDeniedException` (4xx), which the code classifies as "not billed" and refunds; the harness stops on the first failure and does not retry. Worst case is one failed call and no spend. `stage1-verify.sh` re-runs the informational region probe and the IAM simulator for each destination region with the profile condition.

## 6. Verification after Stage 1 is applied (`infra/2c2/stage1-verify.sh`, no model call)

It checks: the profile assumes the role with session name `gitghost-2c2`; the table is ACTIVE, on-demand, `pk` HASH, deletion protection on; TTL enabled on `expiresAt`; `KILL#bedrock` is on and readable by the role; an `RL#` counter update works (one tiny item that expires in 2 minutes); the atom/atom identity is readable; and **must be denied** (each written so it cannot change data): updating `KILL#bedrock`, reading another repo's identity, `PutItem` and `Scan` on the usage table, `PutItem` on the identity table, `DeleteTable`, listing inference profiles, reading IAM. The simulator confirms `InvokeModel` is allowed on the profile and on each of the three regional models only with the profile condition, and not without it or for another model. It then checks the budget and prints the SCP probe. It exits non-zero on any failure, and I will stop and report instead of proceeding.

At the end of Stage 1 the system is **locked**: `KILL#bedrock` is on, `.env.local` still says mock and flag false, the harness would refuse, and nothing can invoke the model.

## 7. What Stage 2 will do (needs your separate authorization; not part of this approval)

1. Unlock: `aws dynamodb put-item ... KILL#bedrock on=false` with the admin profile (the role cannot).
2. Run, from the repo, in the shell only (nothing written to `.env.local`):

```
GITGHOST_LIVE_VALIDATION=1 GITGHOST_LIVE_VALIDATION_ACK=I_ACCEPT_COST_UP_TO_0.02_USD \
AWS_PROFILE=gitghost-smoke AWS_REGION=us-east-2 \
BEDROCK_MODEL_ID=us.anthropic.claude-haiku-4-5-20251001-v1:0 \
GITGHOST_CHAT_PROVIDER=bedrock GITGHOST_BEDROCK_ENABLED=true \
GITGHOST_BEDROCK_INPUT_USD_PER_MTOK=1.10 GITGHOST_BEDROCK_OUTPUT_USD_PER_MTOK=5.50 \
GITGHOST_BUDGET_SAFETY_FACTOR=1.5 GITGHOST_DAILY_BUDGET_USD=0.02 \
GITGHOST_CHAT_REQUESTS_PER_DAY=2 GITGHOST_CHAT_REQUESTS_PER_MINUTE=2 GITGHOST_CHAT_CONCURRENCY=1 \
GITGHOST_MAX_INPUT_TOKENS=4000 GITGHOST_MAX_OUTPUT_TOKENS=300 GITGHOST_CHAT_TIMEOUT_MS=20000 \
GITGHOST_USAGE_STORE=dynamodb GITGHOST_USAGE_TABLE=gitghost-usage-counters GITGHOST_TRUSTED_IP_SOURCE=none \
node --env-file=.env.local node_modules/vitest/vitest.mjs run src/server/chat/live.validation.test.ts
```

(Shell variables take precedence over `.env.local`; the file only supplies `GITHUB_TOKEN` and the identity table name.) Call 1, 30 s pause, call 2. Stops at the first failure; no retry. The report goes to `.local/2c2/` (git-ignored) with: raw model text, accepted and rejected segments with reasons, evidence references, final rendered dialogue text, input/output tokens, latency, reserved versus actual micro-dollars, live counters, and any provider error. Credentials are never read or stored; 12-digit numbers are masked.

3. Stage 3 starts immediately after: re-lock (`KILL#bedrock on=true`), confirm the lock with the role and with a harness attempt that must be refused before any model call, compare `BUDGET#<day>` and `REQ#bedrock#<day>` with the report, report cost, and give the evaluation (naturalness, expressiveness, grounding, overly strict validation) and a recommendation on the remaining four calls.

## 8. Rollback and cleanup (not planned; each needs approval)

Restore `~/.aws/config` from the backup; `aws budgets delete-budget`; `aws iam delete-role-policy` then `delete-role`; turn deletion protection off and `delete-table`. The lock item makes leaving everything in place safe.

## 9. Changes made to the repository in this step (offline only)

- `infra/2c2/`: policy and budget templates, CLI profile template, `stage1-apply.sh` (dry run by default), `stage1-verify.sh`.
- `validation-harness.ts`: ceilings lowered to 2 calls, USD 0.02, 2 requests per day; plan reduced to your two questions; the live runner's acknowledgement string now says `I_ACCEPT_COST_UP_TO_0.02_USD`.
- `validation-harness.test.ts`: updated and extended (23 offline tests, including AccessDenied refund and kill switch before any model call).
- This document. No application behavior changed. Nothing deployed, committed or deleted.

## 10. What I need from you to apply Stage 1

- [ ] Approve operations 1 to 7 in section 3, run as `kiroween-dev` through `infra/2c2/stage1-apply.sh --apply`.
- [ ] Approve the role design in section 4 (kill item unwritable by the role, identity read limited to 3228505).
- [ ] Approve the new budget "GitGhost 2C2 daily guard" (USD 0.05 daily) and reusing the existing budget's e-mail recipient.
- [ ] Approve editing `~/.aws/config` (backup first) to add `gitghost-smoke`.
- [ ] Confirm that leaving the table, role, profile and budget in place after the test is acceptable (default), or tell me to plan removal.
- [ ] Confirm you understand "horror form" for `atom/atom` is the saved **distorted** stage.

Stage 2 will ask again, separately, before any model call.

## 11. Result: Stage 1 applied and verified (2026-10-31)

**Pre-checks requested before applying**
1. `Null: false` added to both `dynamodb:LeadingKeys` conditions. Access Analyzer `validate-policy`: zero findings. The IAM simulator (with `aws:RequestedRegion=us-east-2`, which the organization SCP needs) agrees: `RL#` and `BUDGET#` keys allowed, `KILL#bedrock` implicitDeny, and no LeadingKeys context at all implicitDeny.
2. Budget: **notification-only and account-wide.** It has no cost filter, so it covers all spend in the account, not just GitGhost (a Bedrock-only filter would need the Cost Explorer service names, and that API is billed per request, so I did not look them up). It has no actions, and AWS does not support Budgets Actions on daily budgets at all. DAILY, COST, USD 0.05, one ACTUAL notification above 100%. Recipient: the existing "GitGhost Budget" subscriber, a single EMAIL subscriber, shown masked as `sa***@gmail.com` (23 characters); the verify script confirms the new budget's subscriber equals the old one. Please confirm that address is yours. Budget alerts lag spend by hours.
3. `stage1-apply.sh` safety, tested against a simulated AWS (`infra/2c2/test/test-apply.sh`, 107 checks, all passing): plan-then-execute; a resource that exists and matches is skipped, one that exists and differs is a CONFLICT that aborts before any change; an unreadable state is never treated as "absent"; the config file is replaced only via backup, temp file, prefix verification and atomic rename. Tested: a failure at each of the six create steps, both before and after the operation takes effect, each followed by a clean resume with no duplicates; eight conflict cases; unknown-state; wrong caller; dry run changes nothing; output never contains the account ID or e-mail. Breaking the script on purpose (accepting a kill switch that is OFF, re-appending the profile) made 2 and 6 tests fail. This testing also caught and fixed two real defects before the real run: a BSD `cmp -n` prefix check that wrongly refused, and a re-run false conflict on the omitted `ThresholdType`.

**Applied (as `kiroween-dev`, region us-east-2)**

| Operation | Result |
|---|---|
| Table `gitghost-usage-counters` | ACTIVE, on-demand, key `pk` HASH, deletion protection ON, tagged |
| TTL | ENABLED on `expiresAt` |
| `KILL#bedrock` | `on = true` (**locked**) |
| Role `gitghost-smoke-runtime` | created, max session 3600 s, tagged; trust policy limited to `kiroween-dev` with session name `gitghost-2c2` |
| Inline policy `gitghost-2c2-smoke` | attached (section 4 with `Null: false`) |
| `~/.aws/config` | backed up to `config.bak-2c2-20261031190842`, profile `gitghost-smoke` appended (diff against the backup shows only that block; mode 600) |
| Budget "GitGhost 2C2 daily guard" | created, USD 0.05 daily |

**Verification (`stage1-verify.sh`, no model call): 29 of 29 passed**, and a second plan run against the real account reported "skip" for all seven resources. The role assumes correctly; the table, TTL and lock are as designed; allowed: `UpdateItem` on an `RL#` key and the atom/atom identity read; denied: `UpdateItem` on `KILL#bedrock`, another repo's identity, `PutItem` and `Scan` on the usage table, `PutItem` on the identity table, `DeleteTable`, listing inference profiles, reading IAM. The usage table holds only the lock and a harmless `RL#chat#verify#0` counter that expires on its own; no `BUDGET#` or `REQ#bedrock#` item exists, so no model request has ever been counted. `Converse` authorization and the SCP behavior for inference routed into us-east-1 and us-west-2 are still unproven until Stage 2.

**State now:** kill switch ON, nothing unlocked, no model call made.
