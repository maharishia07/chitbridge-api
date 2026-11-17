#!/usr/bin/env bash
# deploy/azure/test.sh — the spin's test (HX2): deploy/spin-test.sh against the Azure spin recorded in deploy/.spin/azure.env. PLAN=1 prints it.
. "$(dirname "$0")/../spin-lib.sh"
. "$(dirname "$0")/../spin-test.sh"
spin_load azure
spin_test
