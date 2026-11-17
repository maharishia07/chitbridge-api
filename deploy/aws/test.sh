#!/usr/bin/env bash
# deploy/aws/test.sh — the spin's test (HX2): deploy/spin-test.sh against the AWS spin recorded in deploy/.spin/aws.env. PLAN=1 prints it.
. "$(dirname "$0")/../spin-lib.sh"
. "$(dirname "$0")/../spin-test.sh"
spin_load aws
spin_test
