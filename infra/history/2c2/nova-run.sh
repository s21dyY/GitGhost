#!/usr/bin/env bash
# Milestone 2C.2 Nova Lite runner: ONE Bedrock call against atom/atom, then re-lock. STAGE C ONLY.
#
# DRY RUN by default: prints the read-only go/no-go result and the plan, unlocks NOTHING.
# To execute, BOTH are required (the owner types the second one; never set it on their behalf):
#     ./nova-run.sh --execute
#     GITGHOST_NOVA_AUTHORIZED=I_AUTHORIZE_ONE_NOVA_LITE_CALL_UP_TO_0.02_USD
#
# Order: preflight -> lock check (kill switch still ON; the call must be refused with ZERO model calls)
# -> unlock -> the one call -> re-lock (always, via trap) -> verify lock and counters. No retries.
# Output cap: 500 tokens (the owner's Stage B decision). Fixed: no environment override.
set -uo pipefail
cd "$(dirname "$0")/../.."
export AWS_PAGER=""
REGION=us-east-2
TABLE=gitghost-usage-counters
EXECUTE=0
if [ "${1:-}" = "--execute" ]; then EXECUTE=1; fi
OUTTOK=500
admin() { AWS_PROFILE=default AWS_REGION=$REGION aws "$@"; }
role() { AWS_PROFILE=gitghost-smoke AWS_REGION=$REGION aws "$@"; }

relock() {
  admin dynamodb update-item --region $REGION --table-name $TABLE --key '{"pk":{"S":"KILL#bedrock"}}' \
    --update-expression "SET #o = :t" --expression-attribute-names '{"#o":"on"}' --expression-attribute-values '{":t":{"BOOL":true}}' >/dev/null 2>&1
  echo "re-lock: KILL#bedrock = $(admin dynamodb get-item --region $REGION --table-name $TABLE --key '{"pk":{"S":"KILL#bedrock"}}' --consistent-read --query 'Item.on.BOOL' --output text 2>&1)"
}

LIVE_ENV=(
  GITGHOST_VALIDATION_PLAN=nova-lite
  GITGHOST_LIVE_VALIDATION=1 GITGHOST_LIVE_VALIDATION_ACK=I_ACCEPT_COST_UP_TO_0.02_USD
  AWS_PROFILE=gitghost-smoke AWS_REGION=$REGION
  BEDROCK_MODEL_ID=amazon.nova-lite-v1:0
  GITGHOST_CHAT_PROVIDER=bedrock GITGHOST_BEDROCK_ENABLED=true
  GITGHOST_BEDROCK_INPUT_USD_PER_MTOK=0.06 GITGHOST_BEDROCK_OUTPUT_USD_PER_MTOK=0.24
  GITGHOST_BUDGET_SAFETY_FACTOR=1.5 GITGHOST_DAILY_BUDGET_USD=0.02
  GITGHOST_CHAT_REQUESTS_PER_DAY=1 GITGHOST_CHAT_REQUESTS_PER_MINUTE=1 GITGHOST_CHAT_CONCURRENCY=1
  GITGHOST_MAX_INPUT_TOKENS=4000 GITGHOST_MAX_OUTPUT_TOKENS=$OUTTOK GITGHOST_CHAT_TIMEOUT_MS=20000
  GITGHOST_USAGE_STORE=dynamodb GITGHOST_USAGE_TABLE=$TABLE GITGHOST_TRUSTED_IP_SOURCE=none
  GITGHOST_BEDROCK_KILL_SWITCH=false
)
RUNNER=(node --env-file=.env.local node_modules/vitest/vitest.mjs run src/server/chat/live.validation.test.ts)

echo "== 1. read-only go/no-go =="
./infra/history/2c2/nova-preflight.sh
PF=$?

if [ "$EXECUTE" != 1 ]; then
  echo
  echo "== DRY RUN: nothing unlocked, no model call. Preflight exit code: $PF (0 = GO). Plan when executed with authorization: =="
  echo "  2. lock check (kill switch still ON): the live runner's one call must be refused 'kill_switch' with zero Bedrock calls"
  echo "  3. wait 65 s (rate-limit window), then unlock KILL#bedrock (admin profile, conditional on it being ON)"
  echo "  4. the ONE call (atom/atom, saved distorted form): 'Why did you die?'"
  echo "  5. re-lock KILL#bedrock (always, even on failure), verify as admin and as the role, read BUDGET#/REQ# counters"
  echo "  worst-case reservation: (4000 x 0.06 + $OUTTOK x 0.24) x 1.5 = $(python3 -c "print(round((4000*0.06+$OUTTOK*0.24)*1.5))") micro-dollars"
  echo "  environment for the runner (shell only):"; printf '    %s\n' "${LIVE_ENV[@]}"
  echo "  command: env <the variables above> ${RUNNER[*]}"
  exit 0
fi

if [ "$PF" != 0 ]; then echo "NO-GO: nothing was unlocked or run." >&2; exit 1; fi
if [ "${GITGHOST_NOVA_AUTHORIZED:-}" != "I_AUTHORIZE_ONE_NOVA_LITE_CALL_UP_TO_0.02_USD" ]; then
  echo "Refusing: GITGHOST_NOVA_AUTHORIZED is not set to the exact authorization string. Nothing was unlocked." >&2
  exit 1
fi

trap relock EXIT   # whatever happens from here on, the kill switch is turned back ON
MARK=$(mktemp /tmp/nova-marker.XXXXXX)
# only reports written AFTER the marker count, so an older report can never be mistaken for this run
latest_report() { find .local/2c2 -name 'run-*.json' -newer "$MARK" 2>/dev/null | sort | tail -1; }

echo "== 2. lock check (kill switch ON): expect the call refused with zero model calls =="
sleep 1
env "${LIVE_ENV[@]}" "${RUNNER[@]}" > /tmp/nova-lockcheck.out 2>&1
R=$(latest_report)
if [ -z "$R" ] || ! python3 - "$R" <<'PY'
import json, sys
r = json.load(open(sys.argv[1]))
c = r["calls"][0]
ok = r["plan"]["name"] == "nova-lite" and c["status"] == "refused" and c.get("code") == "kill_switch" and "raw" not in c and r["totals"]["calls"] == 0 and c.get("counters", {}).get("budgetMicros") in (None, 0)
sys.exit(0 if ok else 1)
PY
then
  echo "LOCK CHECK FAILED: the call was not refused by the kill switch. Stopping. See /tmp/nova-lockcheck.out and the report." >&2
  exit 1
fi
echo "lock check passed: refused by kill_switch, no model call, nothing reserved ($(basename "$R"))"
sleep 65

echo "== 3. unlock =="
admin dynamodb update-item --region $REGION --table-name $TABLE --key '{"pk":{"S":"KILL#bedrock"}}' \
  --update-expression "SET #o = :f" --condition-expression "#o = :t" --expression-attribute-names '{"#o":"on"}' \
  --expression-attribute-values '{":f":{"BOOL":false},":t":{"BOOL":true}}' >/dev/null || { echo "unlock failed; stopping" >&2; exit 1; }
echo "kill switch: $(admin dynamodb get-item --region $REGION --table-name $TABLE --key '{"pk":{"S":"KILL#bedrock"}}' --consistent-read --query 'Item.on.BOOL' --output text)"

echo "== 4. the one approved call =="
touch "$MARK"; sleep 1
env "${LIVE_ENV[@]}" "${RUNNER[@]}" 2>&1 | tee /tmp/nova-live.out | sed -E 's/[0-9]{12}/<acct>/g'
RUNRC=${PIPESTATUS[0]}

echo "== 5. re-lock, verify, counters =="
relock
echo "role sees: $(role dynamodb get-item --region $REGION --table-name $TABLE --key '{"pk":{"S":"KILL#bedrock"}}' --consistent-read --query 'Item.on.BOOL' --output text 2>&1)"
D=$(date -u +%F)
for k in "BUDGET#$D" "REQ#bedrock#$D"; do printf '%s = ' "$k"; admin dynamodb get-item --region $REGION --table-name $TABLE --key "{\"pk\":{\"S\":\"$k\"}}" --consistent-read --query 'Item.v.N' --output text 2>&1; done
echo "report: $(latest_report)"
exit "$RUNRC"
