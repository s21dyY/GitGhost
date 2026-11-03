#!/usr/bin/env bash
# Milestone 2C.2 Nova Lite: add ONE statement (InvokeNovaLiteInRegionOnly) to the restricted role's
# inline policy gitghost-2c2-smoke. NOT TO BE RUN WITHOUT SEPARATE OWNER APPROVAL (Stage B).
#
#   ./nova-iam-update.sh              dry run: validates and prints the plan, changes nothing
#   ./nova-iam-update.sh --apply      apply (only after approval)
#   ./nova-iam-update.sh --rollback   put the previous policy back (only if the live policy is the new one)
#
# Safety: the live policy must equal EITHER the known previous policy (then it is updated) OR the new
# policy (then nothing happens). Anything else is a CONFLICT and nothing is written. The new policy must
# pass IAM Access Analyzer with zero findings. The live policy is backed up before the write and read
# back afterwards. Runs as the admin profile `default` (user kiroween-dev). No account ID is printed.
set -euo pipefail
cd "$(dirname "$0")"
MODE=plan
case "${1:-}" in
  --apply) MODE=apply ;;
  --rollback) MODE=rollback ;;
  "") ;;
  *) echo "Unknown option: $1" >&2; exit 1 ;;
esac
export AWS_PROFILE=default AWS_PAGER="" AWS_REGION=us-east-2
ROLE=gitghost-smoke-runtime
POLICY_NAME=gitghost-2c2-smoke
NEW_SID=InvokeNovaLiteInRegionOnly
OUT="${GITGHOST_2C2_OUT:-/tmp/gitghost-2c2}"
mask() { sed -E 's/[0-9]{12}/<acct>/g'; }
mkdir -p "$OUT"
CURRENT="preflight"
trap 'rc=$?; if [ "$rc" -ne 0 ]; then echo "STOPPED during: $CURRENT (exit $rc). The live policy was only written in the step named \"write\"." >&2; fi' EXIT

CALLER=$(aws sts get-caller-identity --query Arn --output text)
case "$CALLER" in
  *:user/kiroween-dev) ;;
  *) echo "Unexpected caller identity; stopping." >&2; exit 1 ;;
esac
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
render() { sed "s/__ACCOUNT_ID__/$ACCOUNT_ID/g" "$1" > "$2"; chmod 600 "$2"; }
render permissions-policy.json.tmpl "$OUT/policy-previous.json"
render permissions-policy-nova.json.tmpl "$OUT/policy-new.json"
json_equal() { python3 - "$1" "$2" <<'PY'
import json, sys
sys.exit(0 if json.load(open(sys.argv[1])) == json.load(open(sys.argv[2])) else 1)
PY
}
echo "mode: $MODE   caller: $(echo "$CALLER" | mask)"

CURRENT="read live policy"
if ! LIVE=$(aws iam get-role-policy --role-name "$ROLE" --policy-name "$POLICY_NAME" --query PolicyDocument --output json 2>&1); then
  echo "Could not read the live policy (not treating it as absent): $(echo "$LIVE" | mask | head -c 300)" >&2
  exit 2
fi
echo "$LIVE" > "$OUT/policy-live.json"; chmod 600 "$OUT/policy-live.json"
STATE=conflict
if json_equal "$OUT/policy-live.json" "$OUT/policy-previous.json"; then STATE=previous
elif json_equal "$OUT/policy-live.json" "$OUT/policy-new.json"; then STATE=new; fi
echo "live policy state: $STATE"

if [ "$MODE" = rollback ]; then
  case "$STATE" in
    previous) echo "Already the previous policy: nothing to roll back."; trap - EXIT; exit 0 ;;
    new) ;;
    *) echo "CONFLICT: the live policy is neither the previous nor the new one; refusing to roll back." >&2; exit 3 ;;
  esac
  CURRENT="write"
  aws iam put-role-policy --role-name "$ROLE" --policy-name "$POLICY_NAME" --policy-document "file://$OUT/policy-previous.json"
  CURRENT="verify rollback"
  aws iam get-role-policy --role-name "$ROLE" --policy-name "$POLICY_NAME" --query PolicyDocument --output json > "$OUT/policy-after.json"
  json_equal "$OUT/policy-after.json" "$OUT/policy-previous.json" || { echo "Rollback verification FAILED." >&2; exit 4; }
  echo "rolled back: the live policy equals the previous policy again."
  trap - EXIT; exit 0
fi

if [ "$STATE" = conflict ]; then
  echo "CONFLICT: the live policy differs from both the known previous policy and the new policy (drift). Nothing was written." >&2
  exit 3
fi

CURRENT="validate new policy"
N=$(aws accessanalyzer validate-policy --region "$AWS_REGION" --policy-type IDENTITY_POLICY --policy-document "file://$OUT/policy-new.json" --query 'length(findings)' --output text)
if [ "$N" != "0" ]; then echo "Access Analyzer reported $N finding(s) for the new policy; stopping before any write." >&2; exit 5; fi
echo "Access Analyzer: zero findings"
python3 - "$OUT" "$NEW_SID" <<'PY'
import json, sys
out, sid = sys.argv[1], sys.argv[2]
a = {s["Sid"]: s for s in json.load(open(f"{out}/policy-previous.json"))["Statement"]}
b = {s["Sid"]: s for s in json.load(open(f"{out}/policy-new.json"))["Statement"]}
added = [k for k in b if k not in a]; changed = [k for k in a if k in b and a[k] != b[k]]; removed = [k for k in a if k not in b]
print(f"difference: added={added} changed={changed} removed={removed}")
sys.exit(0 if added == [sid] and not changed and not removed else 1)
PY

if [ "$STATE" = new ]; then echo "The live policy already is the new policy: nothing to do."; trap - EXIT; exit 0; fi
if [ "$MODE" != apply ]; then echo "dry run: no changes made. Run with --apply after approval."; trap - EXIT; exit 0; fi

CURRENT="backup"
BAK="$OUT/policy-before-nova-$(date +%Y%m%d%H%M%S).json"
cp "$OUT/policy-live.json" "$BAK"; chmod 600 "$BAK"
echo "backup of the live policy: $BAK"
CURRENT="write"
aws iam put-role-policy --role-name "$ROLE" --policy-name "$POLICY_NAME" --policy-document "file://$OUT/policy-new.json"
CURRENT="verify"
aws iam get-role-policy --role-name "$ROLE" --policy-name "$POLICY_NAME" --query PolicyDocument --output json > "$OUT/policy-after.json"
if json_equal "$OUT/policy-after.json" "$OUT/policy-new.json"; then echo "applied and verified: the live policy equals the new policy."; else echo "VERIFICATION FAILED. Roll back with: ./nova-iam-update.sh --rollback" >&2; exit 4; fi
trap - EXIT
