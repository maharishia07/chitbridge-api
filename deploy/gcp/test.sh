#!/usr/bin/env bash
# deploy/gcp/test.sh — the spin's test (HX2): deploy/spin-test.sh against the Google Cloud spin recorded in deploy/.spin/gcp.env. PLAN=1 prints it.
. "$(dirname "$0")/../spin-lib.sh"
. "$(dirname "$0")/../spin-test.sh"
spin_load gcp
spin_test
