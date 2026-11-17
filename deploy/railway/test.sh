#!/usr/bin/env bash
# deploy/railway/test.sh — the spin's test (HX2): deploy/spin-test.sh against the Railway spin recorded in deploy/.spin/railway.env. PLAN=1 prints it.
. "$(dirname "$0")/../spin-lib.sh"
. "$(dirname "$0")/../spin-test.sh"
spin_load railway
spin_test
