#!/usr/bin/env bash
# Offline test of stage1-apply.sh against a simulated AWS (aws-stub.sh) and a throwaway HOME.
# It cannot reach AWS: PATH is pointed at the stub and every call is logged and asserted.
#   bash infra/history/2c2/test/test-apply.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
APPLY="$HERE/../stage1-apply.sh"
PASS=0
FAIL=0
check() { if [ "$2" = "0" ]; then echo "  PASS  $1"; PASS=$((PASS+1)); else echo "  FAIL  $1"; FAIL=$((FAIL+1)); fi; }

new_sandbox() {
  SB=$(mktemp -d /tmp/gitghost-apply-test.XXXXXX)
  mkdir -p "$SB/bin" "$SB/home/.aws" "$SB/state" "$SB/out"
  cp "$HERE/aws-stub.sh" "$SB/bin/aws"; chmod +x "$SB/bin/aws"
  printf '[default]\nregion = us-east-2\n\n[profile staging]\nregion = us-west-2\n' > "$SB/home/.aws/config"
  chmod 600 "$SB/home/.aws/config"
  : > "$SB/state/calls.log"
}
# run_apply [--apply]  (env FAIL_ON etc. are passed through)
run_apply() {
  HOME="$SB/home" PATH="$SB/bin:$PATH" STUB_STATE="$SB/state" GITGHOST_2C2_OUT="$SB/out" ORIG_EMAIL="owner@example.test" bash "$APPLY" "$@" > "$SB/last.out" 2>&1
  RC=$?
}
state_hash() { (cd "$SB/state" && find . -type f ! -name calls.log | sort | xargs cat 2>/dev/null; cat "$SB/home/.aws/config") | shasum | cut -d' ' -f1; }
mutating_calls() { grep -Ec '^(dynamodb (create-table|update-time-to-live|put-item)|iam (create-role|put-role-policy)|budgets create-budget) ' "$SB/state/calls.log" || true; }
backups() { ls "$SB/home/.aws" | grep -c 'config.bak-2c2' || true; }
profile_blocks() { grep -c '^\[profile gitghost-smoke\]' "$SB/home/.aws/config" || true; }
complete() { [ -f "$SB/state/table" ] && [ -f "$SB/state/ttl" ] && [ "$(cat "$SB/state/kill" 2>/dev/null)" = "True" ] && [ -f "$SB/state/role-trust" ] && [ -f "$SB/state/role-policy" ] && [ -f "$SB/state/budget" ] && [ "$(profile_blocks)" = "1" ]; }

echo "== 1. dry run changes nothing and uses only the stub"
new_sandbox; H0=$(state_hash); run_apply
check "dry run exits 0" "$RC"
check "dry run made zero mutating calls" "$([ "$(mutating_calls)" = 0 ]; echo $?)"
check "state and config unchanged" "$([ "$(state_hash)" = "$H0" ]; echo $?)"
check "the stub was used (calls were logged)" "$([ -s "$SB/state/calls.log" ]; echo $?)"
check "plan says create for everything" "$([ "$(grep -Ec ': +(create|put|enable|append)$' "$SB/last.out")" = 7 ]; echo $?)"
check "no 12-digit number is printed" "$(! grep -Eq '(^|[^0-9])[0-9]{12}([^0-9]|$)' "$SB/last.out"; echo $?)"
check "the recipient address is never printed" "$(! grep -q 'owner@example.test' "$SB/last.out"; echo $?)"

echo "== 2. full apply on an empty account"
new_sandbox; ORIG=$(cat "$SB/home/.aws/config"); run_apply --apply
check "apply exits 0" "$RC"
check "all resources exist" "$(complete; echo $?)"
check "exactly one backup of the config" "$([ "$(backups)" = 1 ]; echo $?)"
check "old config content preserved as an exact prefix" "$([ "$(head -c "${#ORIG}" "$SB/home/.aws/config")" = "$ORIG" ]; echo $?)"
check "backup equals the original config" "$(cmp -s "$SB/home/.aws/config.bak-2c2-"* <(printf '%s\n' "$ORIG"); echo $?)"
check "config permissions stay 600" "$([ "$(stat -f %Lp "$SB/home/.aws/config" 2>/dev/null || stat -c %a "$SB/home/.aws/config")" = 600 ]; echo $?)"
check "kill switch ON" "$([ "$(cat "$SB/state/kill")" = True ]; echo $?)"
check "budget recipient copied from the existing budget" "$([ "$(cat "$SB/state/budget-email")" = "owner@example.test" ]; echo $?)"
check "output never contains the recipient or a 12-digit number" "$(! grep -Eq 'owner@example.test|(^|[^0-9])[0-9]{12}([^0-9]|$)' "$SB/last.out"; echo $?)"

echo "== 3. running it again is a no-op"
H1=$(state_hash); M1=$(mutating_calls); B1=$(backups); run_apply --apply
check "second apply exits 0" "$RC"
check "no new mutating calls" "$([ "$(mutating_calls)" = "$M1" ]; echo $?)"
check "no second backup, no second profile block" "$([ "$(backups)" = "$B1" ] && [ "$(profile_blocks)" = 1 ]; echo $?)"
check "state unchanged" "$([ "$(state_hash)" = "$H1" ]; echo $?)"

echo "== 4. a failure at each create step, then a clean resume"
for step in "dynamodb create-table" "dynamodb update-time-to-live" "dynamodb put-item" "iam create-role" "iam put-role-policy" "budgets create-budget"; do
  for mode in before after; do
    new_sandbox
    if [ "$mode" = after ]; then export APPLY_THEN_FAIL=1; else unset APPLY_THEN_FAIL; fi
    export FAIL_ON="$step"; run_apply --apply; FIRST=$RC; unset FAIL_ON APPLY_THEN_FAIL
    check "[$step / fails $mode effect] first run stops with an error and reports progress" "$([ "$FIRST" != 0 ] && grep -q 'STOPPED during' "$SB/last.out"; echo $?)"
    run_apply --apply
    check "[$step / $mode] rerun succeeds" "$RC"
    check "[$step / $mode] everything exists afterwards" "$(complete; echo $?)"
    check "[$step / $mode] at most one backup and one profile block" "$([ "$(backups)" -le 1 ] && [ "$(profile_blocks)" = 1 ]; echo $?)"
    check "[$step / $mode] each create ran at most once successfully (no duplicate side effects)" "$([ "$(grep -c '^iam create-role ' "$SB/state/calls.log")" -le 2 ] && [ "$(grep -c '^dynamodb put-item ' "$SB/state/calls.log")" -le 2 ]; echo $?)"
  done
done

echo "== 5. conflicts abort BEFORE any change"
conflict_case() { # name, setup-command
  new_sandbox; run_apply --apply >/dev/null 2>&1   # build the full, correct state first
  eval "$2"
  H=$(state_hash); M=$(mutating_calls); run_apply --apply
  check "[$1] exits 3 (conflict)" "$([ "$RC" = 3 ]; echo $?)"
  check "[$1] says CONFLICT" "$(grep -q CONFLICT "$SB/last.out"; echo $?)"
  check "[$1] nothing was changed" "$([ "$(state_hash)" = "$H" ] && [ "$(mutating_calls)" = "$M" ]; echo $?)"
}
conflict_case "table has a different design" 'printf "ACTIVE\tFalse\tPROVISIONED\tpk\tHASH\n" > "$SB/state/table"'
conflict_case "ttl on another attribute" 'printf "ENABLED\tsomethingElse\n" > "$SB/state/ttl"'
conflict_case "kill switch exists but is OFF" 'echo False > "$SB/state/kill"'
conflict_case "role has a different trust policy" 'echo "{\"Version\":\"2012-10-17\",\"Statement\":[]}" > "$SB/state/role-trust"'
conflict_case "role has a different inline policy" 'echo "{\"Version\":\"2012-10-17\",\"Statement\":[]}" > "$SB/state/role-policy"'
conflict_case "profile exists with other settings" 'sed -i.orig "s/source_profile = default/source_profile = staging/" "$SB/home/.aws/config"'
conflict_case "budget has a different amount" 'printf "DAILY\t5.0\tCOST\n" > "$SB/state/budget"'
conflict_case "budget has a different recipient" 'echo "someone@else.test" > "$SB/state/budget-email"'

echo "== 6. cannot tell the state: stop, do not guess"
new_sandbox; H=$(state_hash); ERR_DESCRIBE_TABLE=1 run_apply --apply
check "an AccessDenied while probing stops the run (exit 2)" "$([ "$RC" = 2 ]; echo $?)"
check "nothing was created" "$([ "$(mutating_calls)" = 0 ] && [ "$(state_hash)" = "$H" ]; echo $?)"

echo "== 7. wrong caller identity is refused"
new_sandbox; sed -i.orig 's#user/kiroween-dev#user/someone-else#' "$SB/bin/aws"
run_apply --apply
check "refuses to run as another identity, no changes" "$([ "$RC" != 0 ] && [ "$(mutating_calls)" = 0 ]; echo $?)"

echo
echo "passed=$PASS failed=$FAIL"
[ "$FAIL" = 0 ]
