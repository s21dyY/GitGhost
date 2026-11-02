#!/usr/bin/env bash
# Stand-in for the `aws` CLI, used ONLY by test-apply.sh. It keeps simulated AWS state in $STUB_STATE
# and logs every call. It never contacts AWS. Failure injection:
#   FAIL_ON="<service> <command>"      fail that command before it takes effect
#   APPLY_THEN_FAIL=1 (with FAIL_ON)   take effect, then report an error (like a dropped connection)
#   ERR_DESCRIBE_TABLE=1               describe-table fails with AccessDenied (state unknowable)
set -uo pipefail
S="$STUB_STATE"
svc="$1"; cmd="$2"; shift 2
all="$svc $cmd"
echo "$all $*" >> "$S/calls.log"
fail() { echo "An error occurred ($1) when calling the $2 operation: stub" >&2; exit 254; }
getarg() { local f="$1"; shift; while [ $# -gt 0 ]; do if [ "$1" = "$f" ]; then echo "$2"; return; fi; shift; done; }
if [ "${FAIL_ON:-}" = "$all" ] && [ -z "${APPLY_THEN_FAIL:-}" ]; then fail ThrottlingException "$cmd"; fi
after() { if [ "${FAIL_ON:-}" = "$all" ] && [ -n "${APPLY_THEN_FAIL:-}" ]; then fail InternalFailure "$cmd"; fi; }
need_table() { [ -f "$S/table" ] || fail ResourceNotFoundException "$cmd"; }

case "$all" in
  "sts get-caller-identity")
    if [ "$(getarg --query "$@")" = "Account" ]; then echo 123456789012; else echo "arn:aws:iam::123456789012:user/kiroween-dev"; fi ;;
  "dynamodb describe-table")
    if [ -n "${ERR_DESCRIBE_TABLE:-}" ]; then fail AccessDeniedException "$cmd"; fi
    need_table; cat "$S/table" ;;
  "dynamodb create-table")
    printf 'ACTIVE\tTrue\tPAY_PER_REQUEST\tpk\tHASH\n' > "$S/table"; after; echo ACTIVE ;;
  "dynamodb wait") exit 0 ;;
  "dynamodb describe-time-to-live")
    need_table; if [ -f "$S/ttl" ]; then cat "$S/ttl"; else printf 'DISABLED\tNone\n'; fi ;;
  "dynamodb update-time-to-live")
    need_table; printf 'ENABLED\texpiresAt\n' > "$S/ttl"; after; echo '{}' ;;
  "dynamodb get-item")
    need_table; if [ -f "$S/kill" ]; then cat "$S/kill"; else echo None; fi ;;
  "dynamodb put-item")
    need_table; if [ -f "$S/kill" ]; then fail ConditionalCheckFailedException "$cmd"; fi
    echo True > "$S/kill"; after ;;
  "iam get-role")
    [ -f "$S/role-trust" ] || fail NoSuchEntity "$cmd"; cat "$S/role-trust" ;;
  "iam create-role")
    [ -f "$S/role-trust" ] && fail EntityAlreadyExists "$cmd"
    f=$(getarg --assume-role-policy-document "$@"); cp "${f#file://}" "$S/role-trust"; after; echo gitghost-smoke-runtime ;;
  "iam get-role-policy")
    if [ -n "${ERR_GET_ROLE_POLICY:-}" ]; then fail AccessDeniedException "$cmd"; fi
    [ -f "$S/role-policy" ] || fail NoSuchEntity "$cmd"; cat "$S/role-policy" ;;
  "accessanalyzer validate-policy") echo "${AA_FINDINGS:-0}" ;;
  "iam put-role-policy")
    [ -f "$S/role-trust" ] || fail NoSuchEntity "$cmd"
    f=$(getarg --policy-document "$@"); cp "${f#file://}" "$S/role-policy"; after ;;
  "budgets describe-subscribers-for-notification")
    if [ "$(getarg --budget-name "$@")" = "GitGhost Budget" ]; then echo "$ORIG_EMAIL"; else
      [ -f "$S/budget" ] || fail NotFoundException "$cmd"; printf 'EMAIL\t%s\n' "$(cat "$S/budget-email")"; fi ;;
  "budgets describe-budget")
    [ -f "$S/budget" ] || fail NotFoundException "$cmd"; cat "$S/budget" ;;
  "budgets describe-notifications-for-budget")
    [ -f "$S/budget" ] || fail NotFoundException "$cmd"; cat "$S/budget-notif" ;;
  "budgets create-budget")
    [ -f "$S/budget" ] && fail DuplicateRecordException "$cmd"
    n=$(getarg --notifications-with-subscribers "$@")
    python3 -c "import json,sys; print(json.load(open(sys.argv[1]))[0]['Subscribers'][0]['Address'])" "${n#file://}" > "$S/budget-email"
    printf 'DAILY\t0.05\tCOST\n' > "$S/budget"; printf 'ACTUAL\tGREATER_THAN\t100.0\tNone\n' > "$S/budget-notif"; after ;;
  *) echo "stub: unexpected command: $all" >&2; exit 99 ;;
esac
