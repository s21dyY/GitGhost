#!/usr/bin/env bash
# Milestone 2C.2 Stage 1 verification. Makes NO model call.
# Read-only, except one tiny TTL'd counter item (RL#chat#verify#0) written through the restricted role
# to prove the allowed write works. Every deliberate "must be denied" attempt carries a condition that
# can never succeed, so it cannot change data even if the policy were wrong.
set -uo pipefail
export AWS_PAGER="" AWS_REGION=us-east-2
REGION=us-east-2
TABLE=gitghost-usage-counters
IDTABLE=gitghost-entity-assignments
mask() { sed -E 's/[0-9]{12}/<acct>/g'; }
PASS=0
FAIL=0
ok() { echo "PASS  $1"; PASS=$((PASS+1)); }
bad() { echo "FAIL  $1"; FAIL=$((FAIL+1)); }
admin() { AWS_PROFILE=default aws "$@"; }
role() { AWS_PROFILE=gitghost-smoke aws "$@"; }
expect_denied() {
  local d="$1"; shift
  local out
  out=$("$@" 2>&1)
  if echo "$out" | grep -q "AccessDenied\|not authorized"; then ok "denied as expected: $d"; else bad "NOT denied: $d -> $(echo "$out" | mask | head -c 200)"; fi
}
A=$(admin sts get-caller-identity --query Account --output text)

echo "== identity =="
if role sts get-caller-identity --query Arn --output text 2>&1 | mask | grep -q "assumed-role/gitghost-smoke-runtime/gitghost-2c2"; then ok "profile assumes the restricted role with session name gitghost-2c2"; else bad "role assumption"; fi

echo "== table =="
T=$(admin dynamodb describe-table --region $REGION --table-name $TABLE --query 'Table.[TableStatus,DeletionProtectionEnabled,BillingModeSummary.BillingMode,KeySchema[0].AttributeName,KeySchema[0].KeyType]' --output text 2>&1 | tr '\t' ' ')
if [ "$T" = "ACTIVE True PAY_PER_REQUEST pk HASH" ]; then ok "table: $T"; else bad "table: $T"; fi
TTL=$(admin dynamodb describe-time-to-live --region $REGION --table-name $TABLE --query 'TimeToLiveDescription.[TimeToLiveStatus,AttributeName]' --output text 2>&1 | tr '\t' ' ')
case "$TTL" in "ENABLED expiresAt"|"ENABLING expiresAt") ok "TTL: $TTL" ;; *) bad "TTL: $TTL" ;; esac

echo "== kill-switch lock =="
if role dynamodb get-item --region $REGION --table-name $TABLE --key '{"pk":{"S":"KILL#bedrock"}}' --consistent-read --query 'Item.on.BOOL' --output text 2>&1 | grep -q "True"; then ok "KILL#bedrock is ON (inference locked) and readable by the role"; else bad "kill switch not ON or not readable"; fi

echo "== allowed through the role =="
EXP=$(( $(date +%s) + 120 ))
if role dynamodb update-item --region $REGION --table-name $TABLE --key '{"pk":{"S":"RL#chat#verify#0"}}' --update-expression "SET expiresAt = :e ADD v :one" --expression-attribute-values "{\":e\":{\"N\":\"$EXP\"},\":one\":{\"N\":\"1\"}}" >/dev/null 2>&1; then ok "UpdateItem on an RL# counter"; else bad "UpdateItem on an RL# counter"; fi
if role dynamodb get-item --region $REGION --table-name $IDTABLE --key '{"repoId":{"N":"3228505"}}' --query 'Item.repoId.N' --output text 2>&1 | grep -q 3228505; then ok "GetItem of the atom/atom identity"; else bad "GetItem of the atom/atom identity"; fi

echo "== must be denied through the role =="
expect_denied "UpdateItem on KILL#bedrock" role dynamodb update-item --region $REGION --table-name $TABLE --key '{"pk":{"S":"KILL#bedrock"}}' --update-expression "SET #o = :f" --condition-expression "attribute_exists(zzz_never)" --expression-attribute-names '{"#o":"on"}' --expression-attribute-values '{":f":{"BOOL":false}}'
expect_denied "GetItem of another repository's identity" role dynamodb get-item --region $REGION --table-name $IDTABLE --key '{"repoId":{"N":"1"}}'
expect_denied "PutItem on the usage table" role dynamodb put-item --region $REGION --table-name $TABLE --item '{"pk":{"S":"TEST#denied"}}' --condition-expression "attribute_exists(pk)"
expect_denied "Scan of the usage table" role dynamodb scan --region $REGION --table-name $TABLE --max-items 1
expect_denied "PutItem on the identity table" role dynamodb put-item --region $REGION --table-name $IDTABLE --item '{"repoId":{"N":"1"}}' --condition-expression "attribute_exists(repoId)"
expect_denied "DeleteTable" role dynamodb delete-table --region $REGION --table-name $TABLE
expect_denied "list inference profiles" role bedrock list-inference-profiles --region $REGION
expect_denied "IAM read" role iam list-roles --max-items 1

echo "== IAM simulator (IAM policies only; it cannot see service control policies) =="
R="arn:aws:iam::${A}:role/gitghost-smoke-runtime"
PROFILE="arn:aws:bedrock:us-east-2:${A}:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0"
MODEL="anthropic.claude-haiku-4-5-20251001-v1:0"
sim() { admin iam simulate-principal-policy --policy-source-arn "$R" --action-names "$1" --resource-arns "$2" "${@:3}" --query 'EvaluationResults[0].EvalDecision' --output text 2>&1; }
if [ "$(sim bedrock:InvokeModel "$PROFILE")" = "allowed" ]; then ok "InvokeModel on the profile: allowed"; else bad "InvokeModel on the profile"; fi
for r in us-east-1 us-east-2 us-west-2; do
  d=$(sim bedrock:InvokeModel "arn:aws:bedrock:${r}::foundation-model/${MODEL}" --context-entries "ContextKeyName=bedrock:InferenceProfileArn,ContextKeyValues=${PROFILE},ContextKeyType=string")
  if [ "$d" = "allowed" ]; then ok "foundation model in $r via the profile: allowed"; else bad "foundation model in $r via the profile: $d"; fi
done
d=$(sim bedrock:InvokeModel "arn:aws:bedrock:us-east-2::foundation-model/${MODEL}")
if [ "$d" != "allowed" ]; then ok "foundation model WITHOUT the profile condition: $d"; else bad "model reachable without the profile"; fi
d=$(sim bedrock:InvokeModel "arn:aws:bedrock:us-east-2::foundation-model/amazon.nova-micro-v1:0")
if [ "$d" != "allowed" ]; then ok "a different model: $d"; else bad "different model allowed"; fi

echo "== LeadingKeys conditions (attached policy, and simulator with and without the key) =="
POLDOC=$(admin iam get-role-policy --role-name gitghost-smoke-runtime --policy-name gitghost-2c2-smoke --query PolicyDocument --output json 2>&1)
if echo "$POLDOC" | python3 -c "
import json,sys
d=json.load(sys.stdin); n=0
for st in d['Statement']:
    c=st.get('Condition',{})
    if any(k.startswith('ForAllValues:') and 'dynamodb:LeadingKeys' in v for k,v in c.items()):
        n+=1
        if c.get('Null',{}).get('dynamodb:LeadingKeys')!='false': sys.exit(1)
sys.exit(0 if n==2 else 1)"; then ok "both LeadingKeys statements require the key to be present (Null: false)"; else bad "LeadingKeys Null:false conditions"; fi
UT="arn:aws:dynamodb:us-east-2:${A}:table/${TABLE}"
# The organization SCP is evaluated by the simulator and denies when aws:RequestedRegion is missing, so supply it.
REGION_CTX="ContextKeyName=aws:RequestedRegion,ContextKeyValues=us-east-2,ContextKeyType=string"
simk() { admin iam simulate-principal-policy --policy-source-arn "$R" --action-names dynamodb:UpdateItem --resource-arns "$UT" --context-entries "$REGION_CTX" "$@" --query 'EvaluationResults[0].EvalDecision' --output text 2>&1; }
d=$(simk "ContextKeyName=dynamodb:LeadingKeys,ContextKeyValues=RL#chat#x#1,ContextKeyType=stringList"); if [ "$d" = "allowed" ]; then ok "simulator: UpdateItem with key RL#... allowed"; else bad "simulator RL# key: $d"; fi
d=$(simk "ContextKeyName=dynamodb:LeadingKeys,ContextKeyValues=KILL#bedrock,ContextKeyType=stringList"); if [ "$d" != "allowed" ]; then ok "simulator: UpdateItem with key KILL#bedrock not allowed ($d)"; else bad "simulator allows KILL# key"; fi
d=$(simk); if [ "$d" = "implicitDeny" ]; then ok "simulator: UpdateItem with NO LeadingKeys context is implicitDeny (Null: false works)"; else bad "simulator allows UpdateItem without LeadingKeys"; fi

echo "== budget: notification-only, account-wide, recipient =="
BJ=$(admin budgets describe-budget --account-id "$A" --budget-name "GitGhost 2C2 daily guard" --output json 2>&1)
if echo "$BJ" | python3 -c "
import json,sys
b=json.load(sys.stdin)['Budget']
ok=b['TimeUnit']=='DAILY' and b['BudgetType']=='COST' and float(b['BudgetLimit']['Amount'])==0.05 and b['BudgetLimit']['Unit']=='USD'
sys.exit(0 if ok else 1)"; then ok "budget is DAILY, COST, USD 0.05"; else bad "budget definition"; fi
if echo "$BJ" | python3 -c "
import json,sys
b=json.load(sys.stdin)['Budget']
sys.exit(1 if b.get('CostFilters') or b.get('PlannedBudgetLimits') else 0)"; then ok "no cost filters: it covers the WHOLE account, not only GitGhost"; else bad "budget has cost filters"; fi
ACT=$(admin budgets describe-budget-actions-for-budget --account-id "$A" --budget-name "GitGhost 2C2 daily guard" --query 'length(Actions)' --output text 2>&1)
if [ "$ACT" = "0" ]; then ok "no budget actions: notification only, it cannot change or stop anything"
elif echo "$ACT" | grep -q "don't support daily granularity"; then ok "AWS Budgets Actions are not supported for daily budgets at all, so this budget cannot have actions (notification only)"
else bad "budget actions: $ACT"; fi
NOTIF=$(admin budgets describe-notifications-for-budget --account-id "$A" --budget-name "GitGhost 2C2 daily guard" --query 'Notifications[].[NotificationType,ComparisonOperator,Threshold,ThresholdType]' --output text 2>&1 | tr '\t' ' ')
# the API omits ThresholdType when it is the default (PERCENTAGE); the subscriber lookup below confirms it by identity
if [ "$NOTIF" = "ACTUAL GREATER_THAN 100.0 PERCENTAGE" ] || [ "$NOTIF" = "ACTUAL GREATER_THAN 100.0 None" ] || [ "$NOTIF" = "ACTUAL GREATER_THAN 100 PERCENTAGE" ]; then ok "notification: $NOTIF"; else bad "notification: $NOTIF"; fi
NEWSUB=$(admin budgets describe-subscribers-for-notification --account-id "$A" --budget-name "GitGhost 2C2 daily guard" --notification NotificationType=ACTUAL,ComparisonOperator=GREATER_THAN,Threshold=100,ThresholdType=PERCENTAGE --query 'Subscribers[].[SubscriptionType,Address]' --output text 2>&1 | tr '\t' ' ')
OLDSUB=$(admin budgets describe-subscribers-for-notification --account-id "$A" --budget-name "GitGhost Budget" --notification NotificationType=ACTUAL,ComparisonOperator=GREATER_THAN,Threshold=0.01,ThresholdType=ABSOLUTE_VALUE --query 'Subscribers[].[SubscriptionType,Address]' --output text 2>&1 | tr '\t' ' ')
MASKED=$(echo "$NEWSUB" | python3 -c "import sys; t,a=sys.stdin.read().split(); u,d=a.split('@'); print(t, u[:2]+'***@'+d)")
if [ -n "$NEWSUB" ] && [ "$NEWSUB" = "$OLDSUB" ]; then ok "recipient is the same single e-mail subscriber as the existing budget: $MASKED"; else bad "recipient differs from the existing budget"; fi

echo "== service control policy probe (informational; the SCP text is not readable from this account) =="
for r in us-east-1 us-east-2 us-west-2; do
  if admin dynamodb list-tables --region $r >/dev/null 2>&1; then echo "  $r: dynamodb ListTables allowed"; else echo "  $r: dynamodb ListTables denied (SCP explicit deny expected outside us-east-2)"; fi
  if admin bedrock list-inference-profiles --region $r >/dev/null 2>&1; then echo "  $r: bedrock ListInferenceProfiles allowed"; else echo "  $r: bedrock ListInferenceProfiles denied"; fi
done
echo "  NOTE: whether inference routed into us-east-1 or us-west-2 is allowed can only be proven by a real call."

echo
echo "passed=$PASS failed=$FAIL"
[ "$FAIL" = 0 ]
