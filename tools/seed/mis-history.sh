#!/bin/sh
# MIS showcase step 1: add 26 months of back-dated demo history to NEW AU demo shops on a SIT box, one sim-load run per shop (ADD ONLY; --fresh is refused).
# usage (on the box, inside an api container that reaches the database): SIM_DB=postgres://... sh tools/seed/mis-history.sh "harbour-demo-au:Harbour Demo Retail" "bondi-demo-au:Bondi Demo Retail"
#   DRY=1 prints the plan and the expected months and stops. MONTHS=26 by default. Never on sit-au, sit-root, sit-in or sit-grund unless the coordinator says so.
set -eu
for pair in "$@"; do
  node tools/sim-load.cjs --months "${MONTHS:-26}" --country AU --shop "${pair%%:*}" --name "${pair#*:}" ${DRY:+--dry}
done
