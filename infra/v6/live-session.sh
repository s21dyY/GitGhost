#!/usr/bin/env bash
# A bounded LIVE demo session on this machine: GitGhost on localhost with real Amazon Nova Lite replies.
#
#   ./infra/v6/live-session.sh status                     read-only: kill switch, today's allowance, server state
#   ./infra/v6/live-session.sh start [--minutes N]        DRY RUN: shows exactly what would happen, changes nothing
#   GITGHOST_LIVE_SESSION_AUTHORIZED=I_AUTHORIZE_A_LIVE_DEMO_SESSION_UP_TO_8_REQUESTS_AND_0.006_USD \
#       ./infra/v6/live-session.sh start --execute [--minutes N]
#   ./infra/v6/live-session.sh stop                       stop the server and RE-LOCK the kill switch (needs no authorization)
#
# What a session is: the production build served on http://localhost:3100 with infra/v6/profiles/demo.env exported into the
# server's shell only (never into .env.local): Nova Lite in us-east-2, 8 requests/day, 2/minute, concurrency 1, USD 0.006/day,
# 500 output tokens, one attempt per call. Billable work (Bedrock + usage counters + kill-switch reads) runs as the restricted
# profile gitghost-smoke; identities keep the default profile. The shared kill switch is unlocked only after the server is up,
# and it is locked again by `stop`, by the auto-relock timer (default 60 minutes, at most 240) or when `start` fails.
# The day's request cap and budget are shared with every other run, so a session can never spend more than what is left today.
set -uo pipefail
cd "$(dirname "$0")/../.."
export AWS_PAGER=""
REGION=us-east-2
TABLE=gitghost-usage-counters
PORT="${GITGHOST_PORT:-3100}"
PROFILE_FILE=infra/v6/profiles/demo.env
STATE=.local/v6
LOGF=$STATE/live-server.log
TIMERF=$STATE/live-timer.pid
CAP=8
admin() { AWS_PROFILE=default AWS_REGION=$REGION aws "$@"; }
role() { AWS_PROFILE=gitghost-smoke AWS_REGION=$REGION aws "$@"; }
kill_of() { "$1" dynamodb get-item --region $REGION --table-name $TABLE --key '{"pk":{"S":"KILL#bedrock"}}' --consistent-read --query 'Item.on.BOOL' --output text 2>&1; }
counter() { admin dynamodb get-item --region $REGION --table-name $TABLE --key "{\"pk\":{\"S\":\"$1\"}}" --consistent-read --query 'Item.v.N' --output text 2>&1 | sed 's/^None$/0/'; }
relock() {
  admin dynamodb update-item --region $REGION --table-name $TABLE --key '{"pk":{"S":"KILL#bedrock"}}' \
    --update-expression "SET #o = :t" --expression-attribute-names '{"#o":"on"}' --expression-attribute-values '{":t":{"BOOL":true}}' >/dev/null 2>&1
}
server_pids() { lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null; }
stop_server() { local p; p=$(server_pids); if [ -n "$p" ]; then kill $p 2>/dev/null; sleep 1; p=$(server_pids); [ -n "$p" ] && kill -9 $p 2>/dev/null; fi; true; }
stop_timer() { if [ -f $TIMERF ]; then kill "$(cat $TIMERF)" 2>/dev/null; rm -f $TIMERF; fi; true; }
show_status() {
  local day; day=$(date -u +%F)
  echo "UTC now:            $(date -u '+%F %T')  (the daily allowance resets at 00:00 UTC)"
  echo "kill switch:        admin=$(kill_of admin)  role=$(kill_of role)   (True = locked)"
  local req bud; req=$(counter "REQ#bedrock#$day"); bud=$(counter "BUDGET#$day")
  echo "requests today:     $req of $CAP   (this profile's cap; other runs count too)"
  echo "budget used today:  $bud of 6000 micro-dollars (USD 0.006)"
  if [ -n "$(server_pids)" ]; then echo "server on :$PORT:    RUNNING"; else echo "server on :$PORT:    not running"; fi
  local prov en bud perday
  prov=$(grep -E '^GITGHOST_CHAT_PROVIDER=' .env.local 2>/dev/null | tail -1 | cut -d= -f2); en=$(grep -E '^GITGHOST_BEDROCK_ENABLED=' .env.local 2>/dev/null | tail -1 | cut -d= -f2)
  bud=$(grep -E '^GITGHOST_DAILY_BUDGET_USD=' .env.local 2>/dev/null | tail -1 | cut -d= -f2); perday=$(grep -E '^GITGHOST_CHAT_REQUESTS_PER_DAY=' .env.local 2>/dev/null | tail -1 | cut -d= -f2)
  echo ".env.local:         provider=${prov:-unset} bedrock_enabled=${en:-unset} budget=USD ${bud:-unset}/day requests=${perday:-unset}/day"
  if [ "$prov" = "bedrock" ] && [ "$en" = "true" ]; then
    echo "WARNING: .env.local itself selects Bedrock. ANY 'next start' without the profile is live with those (looser) limits as soon as the kill switch is unlocked."
    echo "         The session profile (demo.env) is 8/day and USD 0.006/day. For browser checks use ./infra/v6/serve-mock.sh, which forces the scripted provider."
  fi
}

CMD="${1:-status}"; shift || true
case "$CMD" in
  status) show_status ;;

  start)
    EXECUTE=0; MINUTES=60
    while [ $# -gt 0 ]; do
      case "$1" in
        --execute) EXECUTE=1 ;;
        --minutes) shift; MINUTES="${1:-60}" ;;
        *) echo "unknown option: $1" >&2; exit 2 ;;
      esac
      shift
    done
    case "$MINUTES" in ''|*[!0-9]*) echo "--minutes must be a whole number" >&2; exit 2 ;; esac
    if [ "$MINUTES" -lt 5 ] || [ "$MINUTES" -gt 240 ]; then echo "--minutes must be between 5 and 240" >&2; exit 2; fi
    show_status
    echo
    echo "A live session would:"
    echo "  1. check the kill switch is still LOCKED, today's allowance has room, nothing is listening on :$PORT, and a build exists"
    echo "  2. start the production build on :$PORT with $PROFILE_FILE (Nova Lite, us-east-2, $CAP/day, 2/min, USD 0.006/day, gitghost-smoke for billing)"
    echo "  3. unlock KILL#bedrock (admin profile, only if it is currently locked)"
    echo "  4. lock it again automatically after $MINUTES minutes, or sooner with: ./infra/v6/live-session.sh stop"
    echo "  Worst case for what is left today: remaining requests x USD 0.00036 (4,000 in + 500 out tokens at USD 0.06 / 0.24 per million)."
    if [ "$EXECUTE" != 1 ]; then echo; echo "DRY RUN: nothing was started or unlocked."; exit 0; fi
    if [ "${GITGHOST_LIVE_SESSION_AUTHORIZED:-}" != "I_AUTHORIZE_A_LIVE_DEMO_SESSION_UP_TO_8_REQUESTS_AND_0.006_USD" ]; then
      echo "Refusing: GITGHOST_LIVE_SESSION_AUTHORIZED is not set to the exact authorization string. Nothing was started or unlocked." >&2; exit 1
    fi
    [ "$(kill_of admin)" = "True" ] || { echo "Refusing: the kill switch is not locked. Run 'stop' first." >&2; exit 1; }
    DAY=$(date -u +%F); REQ=$(counter "REQ#bedrock#$DAY")
    case "$REQ" in ''|*[!0-9]*) echo "Refusing: cannot read today's request count ($REQ)." >&2; exit 1 ;; esac
    [ "$REQ" -lt "$CAP" ] || { echo "Refusing: today's allowance is used up ($REQ of $CAP). It resets at 00:00 UTC." >&2; exit 1; }
    [ -z "$(server_pids)" ] || { echo "Refusing: something is already listening on :$PORT. Run 'stop' first." >&2; exit 1; }
    [ -f .next/BUILD_ID ] || { echo "Refusing: no production build. Run 'npm run build' first." >&2; exit 1; }
    mkdir -p $STATE
    set -a; . "$PROFILE_FILE"; set +a
    nohup npx next start -p "$PORT" > $LOGF 2>&1 < /dev/null &
    for _ in $(seq 1 40); do curl -s -m 2 -o /dev/null "http://127.0.0.1:$PORT/robots.txt" && break; sleep 1; done
    curl -s -m 2 -o /dev/null "http://127.0.0.1:$PORT/robots.txt" || { echo "The server did not start; see $LOGF. Nothing was unlocked." >&2; stop_server; exit 1; }
    admin dynamodb update-item --region $REGION --table-name $TABLE --key '{"pk":{"S":"KILL#bedrock"}}' \
      --update-expression "SET #o = :f" --condition-expression "#o = :t" --expression-attribute-names '{"#o":"on"}' \
      --expression-attribute-values '{":f":{"BOOL":false},":t":{"BOOL":true}}' >/dev/null || { echo "Unlock failed; stopping the server." >&2; stop_server; exit 1; }
    nohup bash -c "sleep $((MINUTES * 60)); cd '$PWD'; $(declare -f admin relock server_pids stop_server); TABLE=$TABLE; REGION=$REGION; PORT=$PORT; relock; stop_server" > /dev/null 2>&1 < /dev/null &
    echo $! > $TIMERF
    echo
    echo "LIVE. Open http://localhost:$PORT  (kill switch unlocked; it re-locks and the server stops in $MINUTES minutes)."
    echo "Stop and re-lock at any time:  ./infra/v6/live-session.sh stop"
    ;;

  stop)
    stop_timer
    stop_server
    relock
    echo "server stopped; kill switch: admin=$(kill_of admin)  role=$(kill_of role)   (True = locked)"
    day=$(date -u +%F)
    echo "requests today: $(counter "REQ#bedrock#$day") of $CAP   budget used: $(counter "BUDGET#$day") micro-dollars"
    [ "$(kill_of admin)" = "True" ] || { echo "WARNING: the kill switch is NOT locked. Re-run stop." >&2; exit 1; }
    ;;

  *) echo "usage: $0 status | start [--execute] [--minutes N] | stop" >&2; exit 2 ;;
esac
