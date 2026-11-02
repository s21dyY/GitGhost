#!/usr/bin/env bash
# V6 go / no-go for the first real Bedrock smoke test (microsoft/VisualStudioUninstaller). READ-ONLY.
# Makes no model call, changes nothing, unlocks nothing. Same checks as infra/2c2/nova-preflight.sh, with the V6 ghost.
# Exit 0 only if every check passes. Until the IAM change (nova-iam-update.sh --apply) has been separately
# approved and applied, it is EXPECTED to say NO-GO on the IAM checks.
set -uo pipefail
cd "$(dirname "$0")/../.."
export AWS_PAGER="" AWS_REGION=us-east-2
REGION=us-east-2
TABLE=gitghost-usage-counters
MODEL=amazon.nova-lite-v1:0
mask() { sed -E 's/[0-9]{12}/<acct>/g'; }
PASS=0
FAIL=0
ok() { echo "PASS  $1"; PASS=$((PASS+1)); }
bad() { echo "FAIL  $1"; FAIL=$((FAIL+1)); }
admin() { AWS_PROFILE=default aws "$@"; }
role() { AWS_PROFILE=gitghost-smoke aws "$@"; }
DAY=$(date -u +%F)
A=$(admin sts get-caller-identity --query Account --output text)

echo "== .env.local must stay locked-down (live flags exist only in the shell for the run) =="
python3 - <<'PY'
import os, re, sys
known = set()
for line in open(".env.example"):
    m = re.match(r"^#?\s*([A-Z][A-Z0-9_]+)=", line)
    if m: known.add(m.group(1))
vals, problems = {}, []
legacy = {"GITGHOST_ASSIGNMENTS_TABLE", "DYNAMODB_TABLE", "GITHUB_TOKEN", "AWS_PROFILE", "AWS_REGION", "BEDROCK_MODEL_ID"}
for n, line in enumerate(open(os.environ.get("ENV_FILE", ".env.local")), 1):
    s = line.rstrip("\n")
    if not s.strip() or s.lstrip().startswith("#"): continue
    m = re.match(r"^([A-Z][A-Z0-9_]*)=(.*)$", s)
    if not m: problems.append(f"line {n}: not a KEY=value line"); continue
    k = m.group(1)
    if k in vals: problems.append(f"line {n}: {k} is defined twice")
    vals.setdefault(k, (n, m.group(2)))
    if k not in known and k not in legacy: problems.append(f"line {n}: unrecognized variable name {k}")
def val(k): return vals.get(k, (0, ""))[1].strip().lower()
if val("GITGHOST_BEDROCK_ENABLED") not in ("false", "0"): problems.append("GITGHOST_BEDROCK_ENABLED must be present and false")
if val("LIVE_GENERATION_ENABLED") not in ("0", "false"): problems.append("LIVE_GENERATION_ENABLED must be 0")
if val("GITGHOST_CHAT_PROVIDER") != "mock": problems.append("GITGHOST_CHAT_PROVIDER must be mock")
for p in problems: print("PROBLEM " + p)
sys.exit(1 if problems else 0)
PY
if [ $? -eq 0 ]; then ok ".env.local: clean, no duplicates, Bedrock flag false, live-generation 0, provider mock"; else bad ".env.local needs fixing"; fi
if [ -z "${GITGHOST_LIVE_VALIDATION:-}" ] && [ -z "${GITGHOST_LIVE_VALIDATION_ACK:-}" ] && [ -z "${GITGHOST_VALIDATION_PLAN:-}" ] && [ "${GITGHOST_BEDROCK_ENABLED:-false}" != "true" ] && [ "${GITGHOST_CHAT_PROVIDER:-mock}" = "mock" ]; then ok "no live variables in this shell"; else bad "this shell already has live variables set"; fi

echo "== shared kill switch =="
K1=$(admin dynamodb get-item --region $REGION --table-name $TABLE --key '{"pk":{"S":"KILL#bedrock"}}' --consistent-read --query 'Item.on.BOOL' --output text 2>&1)
if [ "$K1" = "True" ]; then ok "KILL#bedrock is ON (admin, consistent read)"; else bad "KILL#bedrock is not ON ($K1)"; fi
K2=$(role dynamodb get-item --region $REGION --table-name $TABLE --key '{"pk":{"S":"KILL#bedrock"}}' --consistent-read --query 'Item.on.BOOL' --output text 2>&1)
if [ "$K2" = "True" ]; then ok "KILL#bedrock is ON as seen by the restricted role"; else bad "role does not see the kill switch ON ($K2)"; fi

echo "== today's allowance: room for exactly the one planned request =="
getv() { admin dynamodb get-item --region $REGION --table-name $TABLE --key "{\"pk\":{\"S\":\"$1\"}}" --consistent-read --query 'Item.v.N' --output text 2>&1; }
REQ=$(getv "REQ#bedrock#$DAY"); BUD=$(getv "BUDGET#$DAY")
[ "$REQ" = "None" ] && REQ=0
[ "$BUD" = "None" ] && BUD=0
if [ "$REQ" = "0" ]; then ok "REQ#bedrock#$DAY = 0: the day's single allowed request is unused"; else bad "REQ#bedrock#$DAY = $REQ: today's single allowed request is already used (the allowance resets at 00:00 UTC; the daily cap is 1)"; fi
if [ "$BUD" -ge 0 ] 2>/dev/null && [ $((BUD + 540)) -le 20000 ]; then ok "BUDGET#$DAY = $BUD micro-dollars: one more worst-case reservation (540) fits under 20,000"; else bad "BUDGET#$DAY = $BUD: one more reservation would not fit under 20,000"; fi

echo "== infrastructure =="
T=$(admin dynamodb describe-table --region $REGION --table-name $TABLE --query 'Table.[TableStatus,DeletionProtectionEnabled,BillingModeSummary.BillingMode]' --output text 2>&1 | tr '\t' ' ')
if [ "$T" = "ACTIVE True PAY_PER_REQUEST" ]; then ok "table: $T"; else bad "table: $T"; fi
TTL=$(admin dynamodb describe-time-to-live --region $REGION --table-name $TABLE --query 'TimeToLiveDescription.[TimeToLiveStatus,AttributeName]' --output text 2>&1 | tr '\t' ' ')
if [ "$TTL" = "ENABLED expiresAt" ]; then ok "TTL: $TTL"; else bad "TTL: $TTL"; fi
if role sts get-caller-identity --query Arn --output text 2>&1 | mask | grep -q "assumed-role/gitghost-smoke-runtime/gitghost-2c2"; then ok "profile gitghost-smoke assumes the restricted role"; else bad "role assumption"; fi
if admin budgets describe-budget --account-id "$A" --budget-name "GitGhost 2C2 daily guard" --query 'Budget.[TimeUnit,BudgetLimit.Amount]' --output text 2>&1 | tr '\t' ' ' | grep -q "DAILY 0.05"; then ok "budget guard exists (USD 0.05 daily)"; else bad "budget guard"; fi

echo "== the model =="
M=$(admin bedrock get-foundation-model --region $REGION --model-identifier $MODEL --query 'modelDetails.[modelLifecycle.status,inferenceTypesSupported[?@==`ON_DEMAND`]|[0],outputModalities[0]]' --output text 2>&1 | tr '\t' ' ')
if [ "$M" = "ACTIVE ON_DEMAND TEXT" ]; then ok "$MODEL in $REGION: ACTIVE, ON_DEMAND supported (direct in-region invocation), TEXT output"; else bad "model: $M"; fi
AV=$(admin bedrock get-foundation-model-availability --region $REGION --model-id $MODEL --query '[authorizationStatus,entitlementAvailability,regionAvailability]' --output text 2>&1 | tr '\t' ' ')
if [ "$AV" = "AUTHORIZED AVAILABLE AVAILABLE" ]; then ok "availability: $AV"; else bad "availability: $AV"; fi
AGR=$(admin bedrock list-foundation-model-agreement-offers --region $REGION --model-id $MODEL 2>&1 || true)   # (an error is the expected answer; capture it so pipefail cannot misread it)
if echo "$AGR" | grep -q "Agreement not supported"; then ok "no marketplace agreement or use-case form applies to this Amazon model"; else bad "unexpected agreement answer: $(echo "$AGR" | mask | head -c 160)"; fi

echo "== IAM: the live role policy must be the approved Nova policy =="
mkdir -p /tmp/gitghost-2c2
sed "s/__ACCOUNT_ID__/$A/g" infra/2c2/permissions-policy-nova.json.tmpl > /tmp/gitghost-2c2/policy-new-pf.json
chmod 600 /tmp/gitghost-2c2/policy-new-pf.json
admin iam get-role-policy --role-name gitghost-smoke-runtime --policy-name gitghost-2c2-smoke --query PolicyDocument --output json > /tmp/gitghost-2c2/policy-live-pf.json 2>/dev/null
chmod 600 /tmp/gitghost-2c2/policy-live-pf.json
if python3 -c "
import json,sys
sys.exit(0 if json.load(open('/tmp/gitghost-2c2/policy-live-pf.json'))==json.load(open('/tmp/gitghost-2c2/policy-new-pf.json')) else 1)"; then ok "live policy equals the approved Nova policy"; else bad "live policy is NOT the Nova policy yet (IAM change not applied; expected until Stage B is approved)"; fi
SIM=$(admin iam simulate-principal-policy --policy-source-arn "arn:aws:iam::${A}:role/gitghost-smoke-runtime" --action-names bedrock:InvokeModel --resource-arns "arn:aws:bedrock:us-east-2::foundation-model/$MODEL" --context-entries "ContextKeyName=aws:RequestedRegion,ContextKeyValues=us-east-2,ContextKeyType=string" --query 'EvaluationResults[0].EvalDecision' --output text 2>&1)
if [ "$SIM" = "allowed" ]; then ok "simulator: the role may InvokeModel on $MODEL in us-east-2"; else bad "simulator for the role: $SIM"; fi

echo "== the ghost under test is the one we planned for (microsoft/VisualStudioUninstaller, repo id 42753362) =="
ID=$(admin dynamodb get-item --region $REGION --table-name gitghost-entity-assignments --key '{"repoId":{"N":"42753362"}}' --consistent-read --query 'Item.assignment.S' --output text 2>&1 | python3 -c "
import sys, json
try:
    a = json.loads(sys.stdin.read()); print(a.get('originId'), a.get('temperamentId'))
except Exception: print('unreadable')")
if [ "$ID" = "archivist curious" ]; then ok "VisualStudioUninstaller has a saved identity: $ID (read as the default profile)"; else bad "VisualStudioUninstaller identity differs: $ID"; fi
RID=$(role dynamodb get-item --region $REGION --table-name gitghost-entity-assignments --key '{"repoId":{"N":"42753362"}}' --consistent-read 2>&1 | mask | head -c 200)
if echo "$RID" | grep -q "AccessDenied"; then ok "the restricted role cannot read that identity (expected: the V6 run reads identities with the default profile and uses the restricted profile only for Bedrock and the usage counters)"; else bad "unexpected: the restricted role can read the VSU identity ($RID)"; fi

echo "== code and ceilings (offline tests) =="
if npx vitest run src/server/chat/v6-plan.test.ts src/server/chat/nova-offline.test.ts src/server/chat/nova-replay.test.ts src/server/chat/validation-harness.test.ts src/server/chat/ai-offline.test.ts src/server/chat/grounding.test.ts src/server/chat/grounding-strict.test.ts src/server/chat/prompt.test.ts src/server/evidence/plan.test.ts > /tmp/nova-preflight-tests.out 2>&1; then ok "Nova, harness, offline-AI and grounding tests pass ($(grep -E 'Tests ' /tmp/nova-preflight-tests.out | sed -E 's/^ +//'))"; else bad "offline tests failed (see /tmp/nova-preflight-tests.out)"; fi
if bash infra/2c2/test/test-nova-iam.sh > /tmp/nova-iam-sim.out 2>&1; then ok "IAM update script simulation passes ($(tail -1 /tmp/nova-iam-sim.out))"; else bad "IAM update script simulation failed"; fi

echo
echo "passed=$PASS failed=$FAIL"
if [ "$FAIL" = 0 ]; then echo "GO (read-only checks only; this is not authorization)"; else echo "NO-GO"; fi
[ "$FAIL" = 0 ]
