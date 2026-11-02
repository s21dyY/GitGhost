#!/usr/bin/env bash
# Milestone 2C.2 Stage 2 runner: TWO Bedrock calls against atom/atom, then re-lock.
#
# DRY RUN by default: runs the read-only go/no-go checks and prints the plan. It unlocks NOTHING.
# To execute, BOTH are required (the owner types the second one; do not set it on their behalf):
#     ./stage2-run.sh --execute
#     GITGHOST_STAGE2_AUTHORIZED=I_AUTHORIZE_TWO_BEDROCK_CALLS_UP_TO_0.02_USD
#
# Order: preflight -> lock check (kill switch still ON; the first call must be refused with ZERO model
# calls) -> unlock -> the two calls -> re-lock (always, via trap) -> verify lock and counters.
# No retries: the harness stops at the first failure.
set -uo pipefail
cd "$(dirname "$0")/../.."
export AWS_PAGER=""
REGION=us-east-2
TABLE=gitghost-usage-counters
EXECUTE=0
if [ "${1:-}" = "--execute" ]; then EXECUTE=1; fi
mask() { sed -E 's/[0-9]{12}/<acct>/g'; }
admin() { AWS_PROFILE=default AWS_REGION=$REGION aws "$@"; }
role() { AWS_PROFILE=gitghost-smoke AWS_REGION=$REGION aws "$@"; }

relock() {
  admin dynamodb update-item --region $REGION --table-name $TABLE --key '{"pk":{"S":"KILL#bedrock"}}' \
    --update-expression "SET #o = :t" --expression-attribute-names '{"#o":"on"}' --expression-attribute-values '{":t":{"BOOL":true}}' >/dev/null 2>&1
  local s
  s=$(admin dynamodb get-item --region $REGION --table-name $TABLE --key '{"pk":{"S":"KILL#bedrock"}}' --consistent-read --query 'Item.on.BOOL' --output text 2>&1)
  echo "re-lock: KILL#bedrock = $s"
}

echo "== 1. read-only go/no-go =="
if ! ./infra/2c2/stage2-preflight.sh; then echo "NO-GO: nothing was unlocked or run." >&2; exit 1; fi

# The environment the live runner gets. Shell variables take precedence over .env.local.
LIVE_ENV=(
  GITGHOST_LIVE_VALIDATION=1 GITGHOST_LIVE_VALIDATION_ACK=I_ACCEPT_COST_UP_TO_0.02_USD
  AWS_PROFILE=gitghost-smoke AWS_REGION=$REGION
  BEDROCK_MODEL_ID=us.anthropic.claude-haiku-4-5-20251001-v1:0
  GITGHOST_CHAT_PROVIDER=bedrock GITGHOST_BEDROCK_ENABLED=true
  GITGHOST_BEDROCK_INPUT_USD_PER_MTOK=1.10 GITGHOST_BEDROCK_OUTPUT_USD_PER_MTOK=5.50
  GITGHOST_BUDGET_SAFETY_FACTOR=1.5 GITGHOST_DAILY_BUDGET_USD=0.02
  GITGHOST_CHAT_REQUESTS_PER_DAY=2 GITGHOST_CHAT_REQUESTS_PER_MINUTE=2 GITGHOST_CHAT_CONCURRENCY=1
  GITGHOST_MAX_INPUT_TOKENS=4000 GITGHOST_MAX_OUTPUT_TOKENS=300 GITGHOST_CHAT_TIMEOUT_MS=20000
  GITGHOST_USAGE_STORE=dynamodb GITGHOST_USAGE_TABLE=$TABLE GITGHOST_TRUSTED_IP_SOURCE=none
  GITGHOST_BEDROCK_KILL_SWITCH=false
)
RUNNER=(node --env-file=.env.local node_modules/vitest/vitest.mjs run src/server/chat/live.validation.test.ts)

if [ "$EXECUTE" != 1 ]; then
  echo
  echo "== DRY RUN: nothing unlocked, no model call. Plan when executed with authorization: =="
  echo "  2. lock check (kill switch still ON): run the live runner; call 1 must be refused 'kill_switch' with zero Bedrock calls"
  echo "  3. wait 65 s (rate-limit window), then unlock KILL#bedrock (admin profile)"
  echo "  4. run the two calls (atom/atom, saved current form): 'Why did you die?' then 'Do you miss your developers?'"
  echo "  5. re-lock KILL#bedrock (always, even on failure), verify, read BUDGET#/REQ# counters"
  echo "  environment for the runner (shell only):"; printf '    %s\n' "${LIVE_ENV[@]}"
  echo "  command: env <the variables above> ${RUNNER[*]}"
  exit 0
fi

if [ "${GITGHOST_STAGE2_AUTHORIZED:-}" != "I_AUTHORIZE_TWO_BEDROCK_CALLS_UP_TO_0.02_USD" ]; then
  echo "Refusing: GITGHOST_STAGE2_AUTHORIZED is not set to the exact authorization string. Nothing was unlocked." >&2
  exit 1
fi

trap relock EXIT   # whatever happens from here on, the kill switch is turned back ON

MARK=/tmp/stage2-marker
# only reports written AFTER the marker count, so an older report can never be mistaken for this run
latest_report() { find .local/2c2 -name 'run-*.json' -newer "$MARK" 2>/dev/null | sort | tail -1; }

echo "== 2. lock check (kill switch ON): expect call 1 refused with zero model calls =="
touch "$MARK"; sleep 1
env "${LIVE_ENV[@]}" "${RUNNER[@]}" > /tmp/stage2-lockcheck.out 2>&1
R=$(latest_report)
if [ -z "$R" ] || ! python3 - "$R" <<'PY'
import json, sys
r = json.load(open(sys.argv[1]))
c = r["calls"][0]
ok = c["status"] == "refused" and c.get("code") == "kill_switch" and "raw" not in c and r["totals"]["calls"] == 0 and c.get("counters", {}).get("budgetMicros") in (None, 0)
sys.exit(0 if ok else 1)
PY
then
  echo "LOCK CHECK FAILED: the first call was not refused by the kill switch. Stopping. See /tmp/stage2-lockcheck.out and the report." >&2
  exit 1
fi
echo "lock check passed: refused by kill_switch, no model call, nothing reserved ($(basename "$R"))"
sleep 65

echo "== 3. unlock =="
admin dynamodb update-item --region $REGION --table-name $TABLE --key '{"pk":{"S":"KILL#bedrock"}}' \
  --update-expression "SET #o = :f" --condition-expression "#o = :t" --expression-attribute-names '{"#o":"on"}' \
  --expression-attribute-values '{":f":{"BOOL":false},":t":{"BOOL":true}}' >/dev/null || { echo "unlock failed; stopping" >&2; exit 1; }
echo "kill switch: $(admin dynamodb get-item --region $REGION --table-name $TABLE --key '{"pk":{"S":"KILL#bedrock"}}' --consistent-read --query 'Item.on.BOOL' --output text)"

echo "== 4. the two approved calls =="
touch "$MARK"; sleep 1
env "${LIVE_ENV[@]}" "${RUNNER[@]}" 2>&1 | tee /tmp/stage2-live.out | sed -E 's/[0-9]{12}/<acct>/g'
RUNRC=${PIPESTATUS[0]}

echo "== 5. re-lock, verify, counters =="
relock
echo "role sees: $(role dynamodb get-item --region $REGION --table-name $TABLE --key '{"pk":{"S":"KILL#bedrock"}}' --consistent-read --query 'Item.on.BOOL' --output text 2>&1)"
D=$(date -u +%F)
for k in "BUDGET#$D" "REQ#bedrock#$D"; do printf '%s = ' "$k"; admin dynamodb get-item --region $REGION --table-name $TABLE --key "{\"pk\":{\"S\":\"$k\"}}" --consistent-read --query 'Item.v.N' --output text 2>&1; done
echo "report: $(latest_report)"
exit "$RUNRC"
