#!/usr/bin/env bash
# deploy/spin-check.sh — PROVE THE SPIN SCRIPTS WITHOUT ANY CLOUD ACCOUNT (HX2): shellcheck, then every platform's spin + teardown with
# PARSE=1 (aws · az · gcloud check each command's flags and request shapes with an empty credential config — nothing reaches an
# account) and Railway's with PLAN=1 (its CLI has no offline check). ≈ 1–2 min. Exit 0 = every command well-formed.
#   bash deploy/spin-check.sh            needs shellcheck, aws, az, gcloud (+ the gcloud beta component), openssl, node
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
rc=0
echo "· shellcheck"; shellcheck -s bash deploy/spin-lib.sh deploy/spin-test.sh deploy/spin-check.sh deploy/proof.sh deploy/*/spin.sh deploy/*/test.sh deploy/*/teardown.sh && echo "  clean" || rc=1
for p in aws azure gcp railway; do
  for s in spin teardown; do
    echo "· $p $s"
    if [ "$p" = railway ]; then PLAN=1 bash "deploy/$p/$s.sh" >/dev/null 2>&1 && echo "  plan ok (no offline parser for the railway CLI)" || rc=1
    else PARSE=1 GCP_PROJECT=plan-project bash "deploy/$p/$s.sh" 2>&1 | grep -E '^  (FAIL|ok)|^       |parse:' | grep -vE '^  ok' ; [ "${PIPESTATUS[0]}" = 0 ] || rc=1; fi
  done
done
[ "$rc" = 0 ] && echo "✓ spin scripts well-formed" || echo "✗ spin scripts: see above"
exit "$rc"
