# Deploying GitGhost to Vercel (with AWS via OIDC)

Amplify Hosting supports Next.js only up to 15 and not streaming; GitGhost is on Next.js 16 with Cache Components, so it runs on Vercel. AWS (Bedrock, DynamoDB) is reached with Vercel OIDC role credentials: no access keys anywhere. Cost controls are unchanged (`.kiro/steering/decisions.md`, D1).

Repository files: `vercel.json` (Node via `engines`, `npm ci`, `npm run build`, region `cle1` = us-east-2), `infra/vercel/permissions-policy.json`, `infra/vercel/trust-policy.json.tmpl`, `scripts/deploy-smoke.mts`.

Check locally first: `npm run build` must pass, because Vercel runs the same build.

## Step 1. First deploy: scripted replies, no AWS
1. Vercel → Add New Project → import the GitHub repository. Framework: Next.js (read from `vercel.json`).
2. Set these Production environment variables (mark `GITHUB_TOKEN` and `GITGHOST_CLIENT_KEY_PEPPER` as Sensitive):

| Variable | First deploy | Notes |
| --- | --- | --- |
| `GITHUB_TOKEN` | a read-only token | public repos only; server-side |
| `GITGHOST_CHAT_PROVIDER` | `mock` | scripted replies |
| `GITGHOST_BEDROCK_ENABLED` | `false` | |
| `LIVE_GENERATION_ENABLED` | `0` | |
| `GITGHOST_BEDROCK_KILL_SWITCH` | `false` | env switch; the shared `KILL#bedrock` item stays the instant one |
| `GITGHOST_TRUSTED_IP_SOURCE` | `header` | Vercel overwrites the forwarded IP to prevent spoofing |
| `GITGHOST_TRUSTED_IP_HEADER` | `x-vercel-forwarded-for` | |
| `GITGHOST_CLIENT_KEY_PEPPER` | a long random string | stored rate-limit keys cannot be reversed |
| `GITGHOST_CHAT_REQUESTS_PER_MINUTE` | `5` | |
| `GITGHOST_CHAT_REQUESTS_PER_DAY` | `1000000` | the budget is the binding limit (D1) |
| `GITGHOST_CHAT_CONCURRENCY` | `2` | |
| `GITGHOST_DAILY_BUDGET_USD` | `1.00` | |
| `GITGHOST_BUDGET_SAFETY_FACTOR` | `1.25` | |
| `GITGHOST_MAX_INPUT_TOKENS` | `32000` | |
| `GITGHOST_MAX_OUTPUT_TOKENS` | `800` | |
| `GITGHOST_CHAT_TIMEOUT_MS` | `20000` | `/api/chat` has `maxDuration = 60` |
| `GITGHOST_SPECIALIST_ENABLED` | `false` | the code reader; turned on in step 3 |
| `AWS_PROFILE`, `GITGHOST_BEDROCK_AWS_PROFILE` | unset | profiles are for local development only |

3. Deploy, then run `node scripts/deploy-smoke.mts https://<project>.vercel.app`. Without AWS the ghost's identity is "provisional" (not saved); everything else works.

## Step 2. Connect AWS (needs approval; creates IAM resources)
Vercel sets `AWS_REGION` itself (to the region the function runs in) and reserves the standard `AWS_*` key names, so GitGhost reads its own: `GITGHOST_AWS_REGION`, and for keys `GITGHOST_AWS_ACCESS_KEY_ID` / `GITGHOST_AWS_SECRET_ACCESS_KEY`.

**Option A: scoped IAM user (used for the Kiroween deploy).** The account's organization denies OIDC identity providers, so OIDC (option B) cannot be set up there.
1. IAM user `gitghost-vercel`, no console access, inline policy = `infra/vercel/permissions-policy.json` (one model, two tables), one access key.
2. Add variables (keys as Sensitive): `GITGHOST_AWS_ACCESS_KEY_ID`, `GITGHOST_AWS_SECRET_ACCESS_KEY`, `GITGHOST_AWS_REGION=us-east-2`, `GITGHOST_ASSIGNMENTS_TABLE=gitghost-entity-assignments`, `GITGHOST_USAGE_STORE=dynamodb`, `GITGHOST_USAGE_TABLE=gitghost-usage-counters`. Redeploy, run the smoke test; the ghost's identity is now saved.
3. After the event: `aws iam delete-access-key` for that key, or delete the user.

**Option B: Vercel OIDC (no keys), where the account allows it.**
1. Vercel → Settings → Security → OIDC Federation: Team issuer. Note the team slug and project name.
2. IAM → Identity providers → add OpenID Connect: URL `https://oidc.vercel.com/<TEAM_SLUG>`, audience `https://vercel.com/<TEAM_SLUG>`.
3. Create role `gitghost-vercel`: trust policy = `infra/vercel/trust-policy.json.tmpl` with `TEAM_SLUG` and `PROJECT_NAME` filled in (production only); permissions = `infra/vercel/permissions-policy.json`.
4. Add `AWS_ROLE_ARN` (the role) and the same region and table variables as option A.

## Step 3. Live AI (separate approval; billable)
1. Add `BEDROCK_MODEL_ID=amazon.nova-lite-v1:0`, `GITGHOST_BEDROCK_INPUT_USD_PER_MTOK=0.06`, `GITGHOST_BEDROCK_OUTPUT_USD_PER_MTOK=0.24` (re-check the AWS price page).
2. With the shared kill switch `KILL#bedrock` ON, set `GITGHOST_CHAT_PROVIDER=bedrock`, `GITGHOST_BEDROCK_ENABLED=true`, `LIVE_GENERATION_ENABLED=1`, redeploy, and confirm a question is refused with `kill_switch`.
3. The Specialist (code reader) uses the same model, so the role's policy already covers it. Add `GITGHOST_SPECIALIST_ENABLED=true`, `SPECIALIST_MODEL_ID=amazon.nova-lite-v1:0`, `SPECIALIST_INPUT_USD_PER_MTOK=0.06`, `SPECIALIST_OUTPUT_USD_PER_MTOK=0.24`, `SPECIALIST_DAILY_BUDGET_USD=1.00`. It has its own budget and counters (`BUDGET#specialist#…`) and obeys the same `KILL#bedrock`.
4. Turn `KILL#bedrock` off, ask one question on the site, check the reply in the UI and the spend in the usage table.
5. Open a repository's code on the site and check that the codebase intro appears.
6. Add an AWS Budgets alarm on the account.

## Rollback
Instant: set `KILL#bedrock` on (docs/COST_CONTROLS.md). Full: set `GITGHOST_CHAT_PROVIDER=mock` and redeploy, or promote the previous deployment in Vercel.
