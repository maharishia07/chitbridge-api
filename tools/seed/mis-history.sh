#!/bin/sh
# MIS showcase: add back-dated demo history to NEW AU demo shops, one sim-load run per shop (ADD ONLY; --fresh is refused).
# usage (inside an api container that reaches the database): SIM_DB=postgres://... sh tools/seed/mis-history.sh "harbourdemoau:Harbour Demo Retail:grocer" "bondidemoau:Bondi Demo Cafe:cafe"
#   each argument is shopid:Shop name[:profile]  (profiles: tools/seed/mis-profiles.json; default grocer). The shop id is 8-20 letters or digits, no hyphens (the api refuses shorter ids).
#   DRY=1 prints the plan and the expected months and stops. MONTHS=84 and HISTORY=tools/seed/mis-history-84.json by default (7 years; MONTHS=26 HISTORY=tools/seed/mis-history.json for the short file).
#   Never on sit-au, sit-root, sit-in or sit-grund unless the coordinator says so.
set -eu
for item in "$@"; do
  id="${item%%:*}"; rest="${item#*:}"; name="${rest%%:*}"; profile="${rest#*:}"
  [ "$profile" = "$rest" ] && profile=grocer
  node tools/sim-load.cjs --months "${MONTHS:-84}" --history "${HISTORY:-tools/seed/mis-history-84.json}" --country AU --shop "$id" --name "$name" --profile "$profile" ${DRY:+--dry}
done
