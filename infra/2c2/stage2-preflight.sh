#!/usr/bin/env bash
# Milestone 2C.2 Stage 2 go / no-go. READ-ONLY. Makes no model call, changes nothing, unlocks nothing.
# Exit 0 only if every check passes. Run it right before asking for Stage 2 authorization, and
# again as the first step of stage2-run.sh.
set -uo pipefail
cd "$(dirname "$0")/../.."
export AWS_PAGER="" AWS_REGION=us-east-2
REGION=us-east-2
TABLE=gitghost-usage-counters
mask() { sed -E 's/[0-9]{12}/<acct>/g'; }
PASS=0
FAIL=0
ok() { echo "PASS  $1"; PASS=$((PASS+1)); }
bad() { echo "FAIL  $1"; FAIL=$((FAIL+1)); }
admin() { AWS_PROFILE=default aws "$@"; }
role() { AWS_PROFILE=gitghost-smoke aws "$@"; }
DAY=$(date -u +%F)

echo "== .env.local must stay locked-down (the live flags exist only in the shell for the run) =="
python3 - <<'PY'
import os, re, sys
known = set()
for line in open(".env.example"):
    m = re.match(r"^#?\s*([A-Z][A-Z0-9_]+)=", line)
    if m: known.add(m.group(1))
vals, problems = {}, []
for n, line in enumerate(open(os.environ.get("ENV_FILE", ".env.local")), 1):
    s = line.rstrip("\n")
    if not s.strip() or s.lstrip().startswith("#"): continue
    m = re.match(r"^([A-Z][A-Z0-9_]*)=(.*)$", s)
    if not m: problems.append(f"line {n}: not a KEY=value line"); continue
    k = m.group(1)
    if k in vals: problems.append(f"line {n}: {k} is defined twice (also line {vals[k][0]})")
    vals.setdefault(k, (n, m.group(2)))
    legacy = {"GITGHOST_ASSIGNMENTS_TABLE", "DYNAMODB_TABLE", "GITHUB_TOKEN", "AWS_PROFILE", "AWS_REGION", "BEDROCK_MODEL_ID"}
    if k not in known and k not in legacy: problems.append(f"line {n}: unrecognized variable name {k}")
def val(k): return vals.get(k, (0, ""))[1].strip().lower()
if val("GITGHOST_BEDROCK_ENABLED") not in ("false", "0"): problems.append(f"GITGHOST_BEDROCK_ENABLED must be present and false (is '{val('GITGHOST_BEDROCK_ENABLED') or 'absent'}')")
if val("LIVE_GENERATION_ENABLED") not in ("0", "false"): problems.append(f"LIVE_GENERATION_ENABLED must be 0 (is '{val('LIVE_GENERATION_ENABLED') or 'absent'}')")
if val("GITGHOST_CHAT_PROVIDER") != "mock": problems.append(f"GITGHOST_CHAT_PROVIDER must be mock (is '{val('GITGHOST_CHAT_PROVIDER') or 'absent'}')")
if val("GITGHOST_BEDROCK_KILL_SWITCH") == "false" and False: pass
for p in problems: print("PROBLEM " + p)
sys.exit(1 if problems else 0)
PY
if [ $? -eq 0 ]; then ok ".env.local: clean, no duplicates, Bedrock flag false, live-generation 0, provider mock"; else bad ".env.local needs fixing (see PROBLEM lines above)"; fi

echo "== this shell must not already carry live flags =="
if [ -z "${GITGHOST_LIVE_VALIDATION:-}" ] && [ -z "${GITGHOST_LIVE_VALIDATION_ACK:-}" ] && [ "${GITGHOST_BEDROCK_ENABLED:-false}" != "true" ] && [ "${GITGHOST_CHAT_PROVIDER:-mock}" = "mock" ]; then ok "no live-validation, Bedrock-enabled or bedrock-provider variables in this shell"; else bad "this shell already has live variables set"; fi

echo "== shared kill switch =="
K1=$(admin dynamodb get-item --region $REGION --table-name $TABLE --key '{"pk":{"S":"KILL#bedrock"}}' --consistent-read --query 'Item.on.BOOL' --output text 2>&1)
if [ "$K1" = "True" ]; then ok "KILL#bedrock is ON (admin, consistent read)"; else bad "KILL#bedrock is not ON ($K1)"; fi
K2=$(role dynamodb get-item --region $REGION --table-name $TABLE --key '{"pk":{"S":"KILL#bedrock"}}' --consistent-read --query 'Item.on.BOOL' --output text 2>&1)
if [ "$K2" = "True" ]; then ok "KILL#bedrock is ON as seen by the restricted role"; else bad "role does not see the kill switch ON ($K2)"; fi

echo "== nothing has been spent or counted =="
for k in "BUDGET#$DAY" "REQ#bedrock#$DAY"; do
  v=$(admin dynamodb get-item --region $REGION --table-name $TABLE --key "{\"pk\":{\"S\":\"$k\"}}" --consistent-read --query 'Item.v.N' --output text 2>&1)
  if [ "$v" = "None" ]; then ok "$k does not exist yet"; else bad "$k = $v (expected absent before Stage 2)"; fi
done

echo "== infrastructure =="
T=$(admin dynamodb describe-table --region $REGION --table-name $TABLE --query 'Table.[TableStatus,DeletionProtectionEnabled,BillingModeSummary.BillingMode]' --output text 2>&1 | tr '\t' ' ')
if [ "$T" = "ACTIVE True PAY_PER_REQUEST" ]; then ok "table: $T"; else bad "table: $T"; fi
TTL=$(admin dynamodb describe-time-to-live --region $REGION --table-name $TABLE --query 'TimeToLiveDescription.[TimeToLiveStatus,AttributeName]' --output text 2>&1 | tr '\t' ' ')
if [ "$TTL" = "ENABLED expiresAt" ]; then ok "TTL: $TTL"; else bad "TTL: $TTL"; fi
if role sts get-caller-identity --query Arn --output text 2>&1 | mask | grep -q "assumed-role/gitghost-smoke-runtime/gitghost-2c2"; then ok "profile gitghost-smoke assumes the restricted role"; else bad "role assumption"; fi
A=$(admin sts get-caller-identity --query Account --output text)
if admin budgets describe-budget --account-id "$A" --budget-name "GitGhost 2C2 daily guard" --query 'Budget.[TimeUnit,BudgetLimit.Amount]' --output text 2>&1 | tr '\t' ' ' | grep -q "DAILY 0.05"; then ok "budget guard exists (USD 0.05 daily)"; else bad "budget guard"; fi
INV=$(admin bedrock list-inference-profiles --region $REGION --query "inferenceProfileSummaries[?inferenceProfileId=='us.anthropic.claude-haiku-4-5-20251001-v1:0'].status" --output text 2>&1)
if [ "$INV" = "ACTIVE" ]; then ok "inference profile us.anthropic.claude-haiku-4-5-20251001-v1:0 is ACTIVE"; else bad "inference profile: $INV"; fi

echo "== the ghost under test is the one we planned for =="
ID=$(role dynamodb get-item --region $REGION --table-name gitghost-entity-assignments --key '{"repoId":{"N":"3228505"}}' --consistent-read --query 'Item.assignment.S' --output text 2>&1 | python3 -c "
import sys, json
try:
    a = json.loads(sys.stdin.read()); print(a.get('originId'), a.get('voiceId'), a.get('temperamentId'), a.get('currentStage'), ','.join(a.get('mutationParts', [])))
except Exception: print('unreadable')")
if [ "$ID" = "archivist cosmic formal distorted orbiting-eyes,missing-outline" ]; then ok "atom/atom identity unchanged: $ID"; else bad "atom/atom identity differs from the plan: $ID"; fi

echo "== code and ceilings (offline tests) =="
if npx vitest run src/server/chat/validation-harness.test.ts src/server/chat/ai-offline.test.ts src/server/chat/grounding.test.ts > /tmp/stage2-preflight-tests.out 2>&1; then ok "harness, offline AI and grounding tests pass ($(grep -E 'Tests ' /tmp/stage2-preflight-tests.out | sed -E 's/^ +//'))"; else bad "offline tests failed (see /tmp/stage2-preflight-tests.out)"; fi
if git diff --quiet -- src/server/chat/validation-harness.ts 2>/dev/null; then :; fi
CEIL=$(grep -E "maxCalls: 2|maxDailyBudgetMicros: 20_000|maxRequestsPerDay: 2" src/server/chat/validation-harness.ts | wc -l | tr -d ' ')
if [ "$CEIL" = "3" ]; then ok "harness ceilings are 2 calls, 20,000 micro-dollars, 2 requests/day"; else bad "harness ceilings differ from the approved values"; fi

echo
echo "passed=$PASS failed=$FAIL"
if [ "$FAIL" = 0 ]; then echo "GO (read-only checks only; this is not authorization)"; else echo "NO-GO"; fi
[ "$FAIL" = 0 ]
