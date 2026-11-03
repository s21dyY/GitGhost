#!/usr/bin/env bash
# Offline test of nova-iam-update.sh against a simulated AWS (aws-stub.sh). It cannot reach AWS.
#   bash infra/history/2c2/test/test-nova-iam.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../nova-iam-update.sh"
PASS=0
FAIL=0
check() { if [ "$2" = "0" ]; then echo "  PASS  $1"; PASS=$((PASS+1)); else echo "  FAIL  $1"; FAIL=$((FAIL+1)); fi; }

new_sandbox() {
  SB=$(mktemp -d /tmp/gitghost-nova-iam-test.XXXXXX)
  mkdir -p "$SB/bin" "$SB/state" "$SB/out"
  cp "$HERE/aws-stub.sh" "$SB/bin/aws"; chmod +x "$SB/bin/aws"
  : > "$SB/state/calls.log"
  echo '{"Version":"2012-10-17","Statement":[]}' > "$SB/state/role-trust"
  sed "s/__ACCOUNT_ID__/123456789012/g" "$HERE/../permissions-policy.json.tmpl" > "$SB/state/role-policy"   # the policy attached today
  sed "s/__ACCOUNT_ID__/123456789012/g" "$HERE/../permissions-policy-nova.json.tmpl" > "$SB/new.json"
  sed "s/__ACCOUNT_ID__/123456789012/g" "$HERE/../permissions-policy.json.tmpl" > "$SB/prev.json"
}
run() { HOME="$SB/home" PATH="$SB/bin:$PATH" STUB_STATE="$SB/state" GITGHOST_2C2_OUT="$SB/out" bash "$SCRIPT" "$@" > "$SB/last.out" 2>&1; RC=$?; }
puts() { grep -c '^iam put-role-policy ' "$SB/state/calls.log" || true; }
same() { python3 - "$1" "$2" <<'PY'
import json, sys
sys.exit(0 if json.load(open(sys.argv[1])) == json.load(open(sys.argv[2])) else 1)
PY
}

echo "== 1. dry run changes nothing"
new_sandbox; run
check "exits 0" "$RC"
check "no put-role-policy call" "$([ "$(puts)" = 0 ]; echo $?)"
check "live policy is still the previous one" "$(same "$SB/state/role-policy" "$SB/prev.json"; echo $?)"
check "reports exactly one added statement" "$(grep -q "added=\['InvokeNovaLiteInRegionOnly'\] changed=\[\] removed=\[\]" "$SB/last.out"; echo $?)"
check "no 12-digit number printed" "$(! grep -Eq '(^|[^0-9])[0-9]{12}([^0-9]|$)' "$SB/last.out"; echo $?)"

echo "== 2. apply"
new_sandbox; run --apply
check "exits 0" "$RC"
check "live policy equals the new policy" "$(same "$SB/state/role-policy" "$SB/new.json"; echo $?)"
check "exactly one put-role-policy" "$([ "$(puts)" = 1 ]; echo $?)"
check "a backup of the previous policy exists" "$(same "$(ls "$SB"/out/policy-before-nova-*.json | head -1)" "$SB/prev.json"; echo $?)"
check "backup file is mode 600" "$([ "$(stat -f %Lp "$(ls "$SB"/out/policy-before-nova-*.json | head -1)" 2>/dev/null || stat -c %a "$(ls "$SB"/out/policy-before-nova-*.json | head -1)")" = 600 ]; echo $?)"
check "only the Nova statement was added" "$(python3 - "$SB/prev.json" "$SB/state/role-policy" <<'PY'
import json, sys
a = {s["Sid"]: s for s in json.load(open(sys.argv[1]))["Statement"]}
b = {s["Sid"]: s for s in json.load(open(sys.argv[2]))["Statement"]}
sys.exit(0 if [k for k in b if k not in a] == ["InvokeNovaLiteInRegionOnly"] and all(a[k] == b[k] for k in a) else 1)
PY
echo $?)"
check "output has no account number" "$(! grep -Eq '(^|[^0-9])[0-9]{12}([^0-9]|$)' "$SB/last.out"; echo $?)"

echo "== 3. apply again is a no-op"
P=$(puts); run --apply
check "exits 0 and says nothing to do" "$([ "$RC" = 0 ] && grep -q 'nothing to do' "$SB/last.out"; echo $?)"
check "no further put-role-policy" "$([ "$(puts)" = "$P" ]; echo $?)"

echo "== 4. rollback"
run --rollback
check "exits 0" "$RC"
check "live policy equals the previous policy again" "$(same "$SB/state/role-policy" "$SB/prev.json"; echo $?)"
P=$(puts); run --rollback
check "rolling back twice is a no-op" "$([ "$RC" = 0 ] && [ "$(puts)" = "$P" ]; echo $?)"

echo "== 5. drift and unreadable state: nothing is written =="
new_sandbox; python3 - "$SB/state/role-policy" <<'PY'
import json, sys
d = json.load(open(sys.argv[1])); d["Statement"].append({"Sid": "Extra", "Effect": "Allow", "Action": ["s3:*"], "Resource": "*"}); json.dump(d, open(sys.argv[1], "w"))
PY
run --apply
check "extra statement in the live policy is a CONFLICT (exit 3)" "$([ "$RC" = 3 ] && grep -q CONFLICT "$SB/last.out"; echo $?)"
check "nothing written" "$([ "$(puts)" = 0 ]; echo $?)"
new_sandbox; echo '{"Version":"2012-10-17","Statement":[]}' > "$SB/state/role-policy"; run --apply
check "a completely different live policy is a CONFLICT" "$([ "$RC" = 3 ]; echo $?)"
new_sandbox; ERR_GET_ROLE_POLICY=1 run --apply
check "AccessDenied while reading the live policy stops with exit 2" "$([ "$RC" = 2 ] && [ "$(puts)" = 0 ]; echo $?)"
new_sandbox; run --rollback >/dev/null 2>&1; run --rollback
check "rollback while the live policy is still the previous one is a no-op" "$([ "$RC" = 0 ] && [ "$(puts)" = 0 ]; echo $?)"
new_sandbox; echo '{"Version":"2012-10-17","Statement":[]}' > "$SB/state/role-policy"; run --rollback
check "rollback refuses when the live policy is neither version" "$([ "$RC" = 3 ] && [ "$(puts)" = 0 ]; echo $?)"

echo "== 6. Access Analyzer finding aborts before any write =="
new_sandbox; AA_FINDINGS=2 run --apply
check "exit 5, no write" "$([ "$RC" = 5 ] && [ "$(puts)" = 0 ]; echo $?)"

echo "== 7. a failed write, then a clean rerun =="
new_sandbox; FAIL_ON="iam put-role-policy" run --apply
check "failure before the write takes effect: exits non-zero, names the step, policy unchanged" "$([ "$RC" != 0 ] && grep -q 'STOPPED during: write' "$SB/last.out" && same "$SB/state/role-policy" "$SB/prev.json"; echo $?)"
run --apply
check "rerun applies cleanly" "$([ "$RC" = 0 ] && same "$SB/state/role-policy" "$SB/new.json"; echo $?)"
new_sandbox; FAIL_ON="iam put-role-policy" APPLY_THEN_FAIL=1 run --apply
check "failure after the write took effect: reports error, policy is the new one" "$([ "$RC" != 0 ] && same "$SB/state/role-policy" "$SB/new.json"; echo $?)"
run --apply
check "rerun recognizes it as done and writes nothing more" "$([ "$RC" = 0 ] && grep -q 'nothing to do' "$SB/last.out"; echo $?)"

echo "== 8. wrong caller =="
new_sandbox; sed -i.orig 's#user/kiroween-dev#user/someone-else#' "$SB/bin/aws"; run --apply
check "refuses to run as another identity" "$([ "$RC" != 0 ] && [ "$(puts)" = 0 ]; echo $?)"

echo
echo "passed=$PASS failed=$FAIL"
[ "$FAIL" = 0 ]
