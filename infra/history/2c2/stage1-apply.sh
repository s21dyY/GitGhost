#!/usr/bin/env bash
# Milestone 2C.2 Stage 1: usage table, kill-switch lock, restricted role, CLI profile, small budget.
#
# SAFETY MODEL
#  1. PLAN first: every resource is probed read-only and classified as create / skip (already exists
#     and matches exactly) / CONFLICT (exists but differs) / ERROR (could not tell). Any conflict or
#     error aborts BEFORE anything is changed.
#  2. EXECUTE only the create actions, in order. Nothing that exists is ever modified, overwritten or
#     deleted. The only write to an existing local file is ~/.aws/config, via backup + atomic rename,
#     and the old content is verified to be an exact prefix of the new file first.
#  3. RESUMABLE: after a failure part-way, run it again. Finished steps are re-verified and skipped.
#
# DRY RUN by default (prints the plan, changes nothing). Add --apply only after owner approval.
# Runs as the admin profile `default` (user kiroween-dev). Never prints the account ID or the e-mail.
set -euo pipefail
cd "$(dirname "$0")"
APPLY=0
if [ "${1:-}" = "--apply" ]; then APPLY=1; fi
export AWS_PROFILE=default AWS_PAGER="" AWS_REGION=us-east-2
REGION=us-east-2
TABLE=gitghost-usage-counters
ROLE=gitghost-smoke-runtime
POLICY_NAME=gitghost-2c2-smoke
BUDGET_NAME="GitGhost 2C2 daily guard"
CONFIG="$HOME/.aws/config"
OUT="${GITGHOST_2C2_OUT:-/tmp/gitghost-2c2}"
mask() { sed -E 's/[0-9]{12}/<acct>/g'; }

COMPLETED=""
CURRENT="preflight"
on_exit() {
  local rc=$?
  if [ "$rc" -ne 0 ]; then
    echo >&2
    echo "STOPPED during: $CURRENT   (exit code $rc)" >&2
    echo "Completed before the stop: ${COMPLETED:-nothing}" >&2
    echo "Nothing that already existed was overwritten. Fix the cause and run this script again:" >&2
    echo "finished steps are re-verified and skipped, and unfinished steps are resumed." >&2
  fi
}
trap on_exit EXIT

# probe PATTERN COMMAND...  -> 0 found (output in PROBE_OUT), 1 not found, 2 any other error
PROBE_OUT=""
probe() {
  local pat="$1"; shift
  if PROBE_OUT=$("$@" 2>&1); then return 0; fi
  if echo "$PROBE_OUT" | grep -Eq "$pat"; then return 1; fi
  echo "Could not determine state (not treating it as absent): $(echo "$PROBE_OUT" | mask | head -c 300)" >&2
  return 2
}
# json_equal FILE_A FILE_B -> 0 if the JSON documents are equal after parsing
json_equal() {
  python3 - "$1" "$2" <<'PY'
import json, sys
a = json.load(open(sys.argv[1]))
b = json.load(open(sys.argv[2]))
sys.exit(0 if a == b else 1)
PY
}
conflict() { echo "CONFLICT: $1" >&2; exit 3; }
step_done() { COMPLETED="${COMPLETED:+$COMPLETED, }$1"; }
run() {
  printf '+ %s\n' "$*" | mask
  "$@" | mask
}

# ---------------------------------------------------------------- identity and rendering
CURRENT="identity check"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
CALLER=$(aws sts get-caller-identity --query Arn --output text)
case "$CALLER" in
  *:user/kiroween-dev) ;;
  *) echo "Unexpected caller identity; stopping." >&2; exit 1 ;;
esac
MODE=DRY-RUN
if [ "$APPLY" = 1 ]; then MODE=APPLY; fi
echo "mode: $MODE   caller: $(echo "$CALLER" | mask)   region: $REGION"

CURRENT="rendering templates"
mkdir -p "$OUT"
BUDGET_EMAIL=$(aws budgets describe-subscribers-for-notification --account-id "$ACCOUNT_ID" --budget-name "GitGhost Budget" \
  --notification NotificationType=ACTUAL,ComparisonOperator=GREATER_THAN,Threshold=0.01,ThresholdType=ABSOLUTE_VALUE \
  --query 'Subscribers[0].Address' --output text)
case "$BUDGET_EMAIL" in
  *@*.*) ;;
  *) echo "Could not read a valid budget recipient from the existing budget; stopping." >&2; exit 1 ;;
esac
render() { sed -e "s/__ACCOUNT_ID__/$ACCOUNT_ID/g" -e "s/__BUDGET_EMAIL__/$BUDGET_EMAIL/g" "$1" > "$2"; }
render trust-policy.json.tmpl "$OUT/trust-policy.json"
render permissions-policy.json.tmpl "$OUT/permissions-policy.json"
render budget.json.tmpl "$OUT/budget.json"
render budget-notifications.json.tmpl "$OUT/budget-notifications.json"
render cli-profile.txt.tmpl "$OUT/cli-profile.txt"
chmod 600 "$OUT"/*

# ---------------------------------------------------------------- PLAN (read-only)
TABLE_ACT=create; TTL_ACT=enable; LOCK_ACT=put; ROLE_ACT=create; POLICY_ACT=put; PROFILE_ACT=append; BUDGET_ACT=create

CURRENT="plan: table"
rc=0; probe "ResourceNotFoundException" aws dynamodb describe-table --region "$REGION" --table-name "$TABLE" \
  --query 'Table.[TableStatus,DeletionProtectionEnabled,BillingModeSummary.BillingMode,KeySchema[0].AttributeName,KeySchema[0].KeyType]' --output text || rc=$?
if [ "$rc" = 2 ]; then exit 2; fi
if [ "$rc" = 0 ]; then
  T=$(echo "$PROBE_OUT" | tr '\t' ' ')
  case "$T" in
    "ACTIVE True PAY_PER_REQUEST pk HASH"|"CREATING True PAY_PER_REQUEST pk HASH"|"CREATING True None pk HASH") TABLE_ACT=skip ;;
    *) conflict "table $TABLE exists but differs from the approved design ($T)" ;;
  esac
  CURRENT="plan: ttl"
  rc=0; probe "ResourceNotFoundException" aws dynamodb describe-time-to-live --region "$REGION" --table-name "$TABLE" \
    --query 'TimeToLiveDescription.[TimeToLiveStatus,AttributeName]' --output text || rc=$?
  if [ "$rc" != 0 ]; then exit 2; fi
  TTLV=$(echo "$PROBE_OUT" | tr '\t' ' ')
  case "$TTLV" in
    "ENABLED expiresAt"|"ENABLING expiresAt") TTL_ACT=skip ;;
    "DISABLED None"|"DISABLED "*) TTL_ACT=enable ;;
    *) conflict "table $TABLE has an unexpected TTL setting ($TTLV)" ;;
  esac
  CURRENT="plan: kill-switch item"
  rc=0; probe "ResourceNotFoundException" aws dynamodb get-item --region "$REGION" --table-name "$TABLE" --consistent-read \
    --key '{"pk":{"S":"KILL#bedrock"}}' --query 'Item.on.BOOL' --output text || rc=$?
  if [ "$rc" != 0 ]; then exit 2; fi
  case "$PROBE_OUT" in
    True) LOCK_ACT=skip ;;
    None|"") LOCK_ACT=put ;;
    *) conflict "KILL#bedrock exists and is not ON ($PROBE_OUT); refusing to overwrite it" ;;
  esac
fi

CURRENT="plan: role"
rc=0; probe "NoSuchEntity" aws iam get-role --role-name "$ROLE" --query Role.AssumeRolePolicyDocument --output json || rc=$?
if [ "$rc" = 2 ]; then exit 2; fi
if [ "$rc" = 0 ]; then
  echo "$PROBE_OUT" > "$OUT/existing-trust.json"
  if json_equal "$OUT/existing-trust.json" "$OUT/trust-policy.json"; then ROLE_ACT=skip; else conflict "role $ROLE exists with a different trust policy"; fi
  CURRENT="plan: role policy"
  rc=0; probe "NoSuchEntity" aws iam get-role-policy --role-name "$ROLE" --policy-name "$POLICY_NAME" --query PolicyDocument --output json || rc=$?
  if [ "$rc" = 2 ]; then exit 2; fi
  if [ "$rc" = 0 ]; then
    echo "$PROBE_OUT" > "$OUT/existing-policy.json"
    if json_equal "$OUT/existing-policy.json" "$OUT/permissions-policy.json"; then POLICY_ACT=skip; else conflict "role $ROLE has a different inline policy $POLICY_NAME"; fi
  fi
fi

CURRENT="plan: CLI profile"
if [ -f "$CONFIG" ] && grep -q '^\[profile gitghost-smoke\]' "$CONFIG"; then
  awk '/^\[profile gitghost-smoke\]/{p=1; print; next} /^\[/{p=0} p' "$CONFIG" | sed -e 's/[[:space:]]*$//' -e '/^$/d' > "$OUT/existing-profile.txt"
  sed -e 's/[[:space:]]*$//' -e '/^$/d' "$OUT/cli-profile.txt" > "$OUT/expected-profile.txt"
  if cmp -s "$OUT/existing-profile.txt" "$OUT/expected-profile.txt"; then PROFILE_ACT=skip; else conflict "CLI profile gitghost-smoke exists with different settings"; fi
fi

CURRENT="plan: budget"
rc=0; probe "NotFoundException" aws budgets describe-budget --account-id "$ACCOUNT_ID" --budget-name "$BUDGET_NAME" \
  --query 'Budget.[TimeUnit,BudgetLimit.Amount,BudgetType]' --output text || rc=$?
if [ "$rc" = 2 ]; then exit 2; fi
if [ "$rc" = 0 ]; then
  B=$(echo "$PROBE_OUT" | tr '\t' ' ')
  python3 - "$B" <<'PY' || conflict "budget exists but is not DAILY / USD 0.05 / COST ($B)"
import sys
t = sys.argv[1].split()
sys.exit(0 if len(t) == 3 and t[0] == "DAILY" and abs(float(t[1]) - 0.05) < 1e-9 and t[2] == "COST" else 1)
PY
  N=$(aws budgets describe-notifications-for-budget --account-id "$ACCOUNT_ID" --budget-name "$BUDGET_NAME" \
    --query 'Notifications[].[NotificationType,ComparisonOperator,Threshold,ThresholdType]' --output text | tr '\t' ' ')
  python3 - "$N" <<'PY' || conflict "budget exists with different notifications ($N)"
import sys
t = sys.argv[1].split()
# the API omits ThresholdType ("None") when it is the default, PERCENTAGE
sys.exit(0 if len(t) == 4 and t[0] == "ACTUAL" and t[1] == "GREATER_THAN" and abs(float(t[2]) - 100) < 1e-9 and t[3] in ("PERCENTAGE", "None") else 1)
PY
  S=$(aws budgets describe-subscribers-for-notification --account-id "$ACCOUNT_ID" --budget-name "$BUDGET_NAME" \
    --notification NotificationType=ACTUAL,ComparisonOperator=GREATER_THAN,Threshold=100,ThresholdType=PERCENTAGE \
    --query 'Subscribers[].[SubscriptionType,Address]' --output text | tr '\t' ' ')
  if [ "$S" != "EMAIL $BUDGET_EMAIL" ]; then conflict "budget exists with a different recipient"; fi
  BUDGET_ACT=skip
fi

CURRENT="printing plan"
echo "---- plan (nothing changed yet) ----"
echo "table $TABLE:               $TABLE_ACT"
echo "table TTL on expiresAt:     $TTL_ACT"
echo "KILL#bedrock = ON:          $LOCK_ACT"
echo "role $ROLE:        $ROLE_ACT"
echo "role inline policy:         $POLICY_ACT"
echo "CLI profile gitghost-smoke: $PROFILE_ACT"
echo "budget \"$BUDGET_NAME\": $BUDGET_ACT"
if [ "$APPLY" != 1 ]; then
  echo "dry run: no changes made. Review, then run with --apply."
  trap - EXIT
  exit 0
fi

# ---------------------------------------------------------------- EXECUTE (create actions only)
if [ "$TABLE_ACT" = create ]; then
  CURRENT="create table"
  run aws dynamodb create-table --region "$REGION" --table-name "$TABLE" \
    --attribute-definitions AttributeName=pk,AttributeType=S --key-schema AttributeName=pk,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST --deletion-protection-enabled \
    --tags Key=project,Value=gitghost Key=milestone,Value=2c2 --query 'TableDescription.TableStatus' --output text
  step_done "table created"
fi
CURRENT="wait for table"
run aws dynamodb wait table-exists --region "$REGION" --table-name "$TABLE"
if [ "$TTL_ACT" = enable ]; then
  CURRENT="enable TTL"
  run aws dynamodb update-time-to-live --region "$REGION" --table-name "$TABLE" --time-to-live-specification Enabled=true,AttributeName=expiresAt
  step_done "ttl enabled"
fi
if [ "$LOCK_ACT" = put ]; then
  CURRENT="set kill-switch lock"
  run aws dynamodb put-item --region "$REGION" --table-name "$TABLE" \
    --item '{"pk":{"S":"KILL#bedrock"},"on":{"BOOL":true}}' --condition-expression "attribute_not_exists(pk)"
  step_done "kill switch ON"
fi
if [ "$ROLE_ACT" = create ]; then
  CURRENT="create role"
  run aws iam create-role --role-name "$ROLE" --assume-role-policy-document "file://$OUT/trust-policy.json" --max-session-duration 3600 \
    --description "GitGhost 2C2 smoke test runtime: usage counters, one identity read, one Bedrock profile" \
    --tags Key=project,Value=gitghost Key=milestone,Value=2c2 --query 'Role.RoleName' --output text
  step_done "role created"
fi
if [ "$POLICY_ACT" = put ]; then
  CURRENT="attach inline policy"
  run aws iam put-role-policy --role-name "$ROLE" --policy-name "$POLICY_NAME" --policy-document "file://$OUT/permissions-policy.json"
  step_done "role policy attached"
fi
if [ "$PROFILE_ACT" = append ]; then
  CURRENT="add CLI profile"
  BAK="$CONFIG.bak-2c2-$(date +%Y%m%d%H%M%S)"
  cp -p "$CONFIG" "$BAK"
  TMP=$(mktemp "$CONFIG.tmp.XXXXXX")
  cat "$CONFIG" "$OUT/cli-profile.txt" > "$TMP"
  chmod 600 "$TMP"
  OLD_BYTES=$(wc -c < "$CONFIG" | tr -d ' ')
  # portable prefix test (BSD cmp -n treats reaching the end of the shorter file as a difference)
  if ! head -c "$OLD_BYTES" "$TMP" | cmp -s - "$CONFIG"; then rm -f "$TMP"; echo "Refusing: the old config is not an exact prefix of the new file." >&2; exit 1; fi
  mv "$TMP" "$CONFIG"
  echo "profile gitghost-smoke added to ~/.aws/config (backup: $(basename "$BAK"))"
  step_done "CLI profile added"
fi
if [ "$BUDGET_ACT" = create ]; then
  CURRENT="create budget"
  run aws budgets create-budget --account-id "$ACCOUNT_ID" --budget "file://$OUT/budget.json" --notifications-with-subscribers "file://$OUT/budget-notifications.json"
  step_done "budget created"
fi

CURRENT="done"
trap - EXIT
echo "done: applied (${COMPLETED:-nothing new}). Next: ./stage1-verify.sh"
