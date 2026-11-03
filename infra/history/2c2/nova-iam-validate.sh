#!/usr/bin/env bash
# Milestone 2C.2 Nova Lite: validate the PROPOSED role policy without attaching it. READ-ONLY.
# Uses IAM Access Analyzer validate-policy and iam simulate-custom-policy (both take the policy
# document as input; neither changes anything). The simulator evaluates only this identity policy:
# it cannot see the organization SCP, so "allowed" here does not prove the call will pass the SCP.
set -uo pipefail
cd "$(dirname "$0")"
export AWS_PAGER="" AWS_PROFILE=default
OUT="${GITGHOST_2C2_OUT:-/tmp/gitghost-2c2}"
mkdir -p "$OUT"
A=$(aws sts get-caller-identity --query Account --output text)
sed "s/__ACCOUNT_ID__/$A/g" permissions-policy-nova.json.tmpl > "$OUT/permissions-policy-nova.json"
chmod 600 "$OUT/permissions-policy-nova.json"
PASS=0
FAIL=0
ok() { echo "PASS  $1"; PASS=$((PASS+1)); }
bad() { echo "FAIL  $1"; FAIL=$((FAIL+1)); }

echo "== Access Analyzer =="
N=$(aws accessanalyzer validate-policy --region us-east-2 --policy-type IDENTITY_POLICY --policy-document "file://$OUT/permissions-policy-nova.json" --query 'length(findings)' --output text 2>&1)
if [ "$N" = "0" ]; then ok "validate-policy: zero findings"; else bad "validate-policy: $N finding(s) / $N"; fi

# simulate-custom-policy wants a JSON list of policy strings
python3 - "$OUT" <<'PY'
import json, sys
out = sys.argv[1]
doc = open(f"{out}/permissions-policy-nova.json").read()
json.dump([doc], open(f"{out}/policy-input-list.json", "w"))
PY
chmod 600 "$OUT/policy-input-list.json"
sim() { # action resource [context-entry ...]
  local action="$1" res="$2"; shift 2
  # (macOS bash 3.2 treats an empty array as unbound under set -u, so the two cases are separate)
  if [ $# -gt 0 ]; then
    aws iam simulate-custom-policy --policy-input-list "file://$OUT/policy-input-list.json" --action-names "$action" --resource-arns "$res" --context-entries "$@" --query 'EvaluationResults[0].EvalDecision' --output text 2>&1
  else
    aws iam simulate-custom-policy --policy-input-list "file://$OUT/policy-input-list.json" --action-names "$action" --resource-arns "$res" --query 'EvaluationResults[0].EvalDecision' --output text 2>&1
  fi
}
expect() { # description expected action resource [context...]
  local d="$1" want="$2"; shift 2
  local got; got=$(sim "$@")
  if [ "$got" = "$want" ]; then ok "$d -> $got"; else bad "$d -> $got (wanted $want)"; fi
}
NOVA2="arn:aws:bedrock:us-east-2::foundation-model/amazon.nova-lite-v1:0"
CPROFILE="arn:aws:bedrock:us-east-2:${A}:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0"
CMODEL="anthropic.claude-haiku-4-5-20251001-v1:0"
UT="arn:aws:dynamodb:us-east-2:${A}:table/gitghost-usage-counters"
IT="arn:aws:dynamodb:us-east-2:${A}:table/gitghost-entity-assignments"
LK() { echo "ContextKeyName=dynamodb:LeadingKeys,ContextKeyValues=$1,ContextKeyType=stringList"; }

echo "== Nova Lite: exactly one invocable resource =="
expect "InvokeModel on Nova Lite, us-east-2, bare model ID" allowed bedrock:InvokeModel "$NOVA2"
expect "Nova Lite in us-east-1" implicitDeny bedrock:InvokeModel "arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-lite-v1:0"
expect "Nova Lite in us-west-2" implicitDeny bedrock:InvokeModel "arn:aws:bedrock:us-west-2::foundation-model/amazon.nova-lite-v1:0"
expect "the cross-region Nova Lite inference profile" implicitDeny bedrock:InvokeModel "arn:aws:bedrock:us-east-2:${A}:inference-profile/us.amazon.nova-lite-v1:0"
expect "Nova Micro" implicitDeny bedrock:InvokeModel "arn:aws:bedrock:us-east-2::foundation-model/amazon.nova-micro-v1:0"
expect "Nova Pro" implicitDeny bedrock:InvokeModel "arn:aws:bedrock:us-east-2::foundation-model/amazon.nova-pro-v1:0"
expect "Nova 2 Lite" implicitDeny bedrock:InvokeModel "arn:aws:bedrock:us-east-2::foundation-model/amazon.nova-2-lite-v1:0"
expect "a wildcard resource" implicitDeny bedrock:InvokeModel "*"
expect "streaming invocation of Nova Lite" implicitDeny bedrock:InvokeModelWithResponseStream "$NOVA2"
expect "listing foundation models" implicitDeny bedrock:ListFoundationModels "*"
expect "getting a foundation model" implicitDeny bedrock:GetFoundationModel "$NOVA2"
expect "creating a guardrail or any other Bedrock write" implicitDeny bedrock:CreateGuardrail "*"

echo "== Claude access is unchanged =="
expect "Claude via its profile" allowed bedrock:InvokeModel "$CPROFILE"
expect "Claude foundation model via the profile (condition present)" allowed bedrock:InvokeModel "arn:aws:bedrock:us-east-1::foundation-model/${CMODEL}" "ContextKeyName=bedrock:InferenceProfileArn,ContextKeyValues=${CPROFILE},ContextKeyType=string"
expect "Claude foundation model WITHOUT the profile condition" implicitDeny bedrock:InvokeModel "arn:aws:bedrock:us-east-2::foundation-model/${CMODEL}"

echo "== every earlier restriction still holds =="
expect "UpdateItem on KILL#bedrock" implicitDeny dynamodb:UpdateItem "$UT" "$(LK 'KILL#bedrock')"
expect "UpdateItem on an RL# key" allowed dynamodb:UpdateItem "$UT" "$(LK 'RL#chat#x#1')"
expect "UpdateItem on a BUDGET# key" allowed dynamodb:UpdateItem "$UT" "$(LK 'BUDGET#2026-10-31')"
expect "UpdateItem with no LeadingKeys at all (Null: false)" implicitDeny dynamodb:UpdateItem "$UT"
expect "GetItem of the atom/atom identity" allowed dynamodb:GetItem "$IT" "$(LK '3228505')"
expect "GetItem of another repository's identity" implicitDeny dynamodb:GetItem "$IT" "$(LK '1')"
expect "GetItem on the identity table with no LeadingKeys" implicitDeny dynamodb:GetItem "$IT"
expect "PutItem on the identity table (no identity writes)" implicitDeny dynamodb:PutItem "$IT" "$(LK '3228505')"
expect "UpdateItem on the identity table" implicitDeny dynamodb:UpdateItem "$IT" "$(LK '3228505')"
expect "PutItem on the usage table" implicitDeny dynamodb:PutItem "$UT" "$(LK 'KILL#bedrock')"
expect "DeleteItem on the usage table" implicitDeny dynamodb:DeleteItem "$UT" "$(LK 'KILL#bedrock')"
expect "Scan of the usage table" implicitDeny dynamodb:Scan "$UT"
expect "DeleteTable" implicitDeny dynamodb:DeleteTable "$UT"
expect "reading kill switch (GetItem on usage table)" allowed dynamodb:GetItem "$UT"
expect "IAM read" implicitDeny iam:ListRoles "*"
expect "IAM role policy change" implicitDeny iam:PutRolePolicy "arn:aws:iam::${A}:role/gitghost-smoke-runtime"
expect "sts AssumeRole into another role" implicitDeny sts:AssumeRole "arn:aws:iam::${A}:role/anything"

echo "== the only change versus the policy attached today =="
LIVE=$(aws iam get-role-policy --role-name gitghost-smoke-runtime --policy-name gitghost-2c2-smoke --query PolicyDocument --output json 2>/dev/null)
echo "$LIVE" > "$OUT/policy-live-now.json"
chmod 600 "$OUT/policy-live-now.json"
if python3 - "$OUT" <<'PY'
import json, sys
out = sys.argv[1]
live = json.load(open(f"{out}/policy-live-now.json"))
new = json.load(open(f"{out}/permissions-policy-nova.json"))
ls = {s["Sid"]: s for s in live["Statement"]}
ns = {s["Sid"]: s for s in new["Statement"]}
added = [k for k in ns if k not in ls]
changed = [k for k in ls if k in ns and ns[k] != ls[k]]
removed = [k for k in ls if k not in ns]
print(f"  added={added} changed={changed} removed={removed}")
if live == new:
    print("  the live policy already equals the proposed policy (change applied)")
    sys.exit(0)
sys.exit(0 if added == ["InvokeNovaLiteInRegionOnly"] and not changed and not removed and live["Version"] == new["Version"] else 1)
PY
then ok "live policy is the proposed one already, or differs from it by exactly one added statement (none changed or removed)"; else bad "policy difference is not exactly one added statement"; fi

echo
echo "passed=$PASS failed=$FAIL"
echo "NOTE: the simulator cannot evaluate the organization SCP; in-region Nova Lite in us-east-2 is the lowest-risk target because the SCP already allows DynamoDB there."
[ "$FAIL" = 0 ]
