#!/usr/bin/env bash
# deploy/spin-test.sh — THE TEST EVERY CLOUD SPIN RUNS (HX2), sourced by deploy/<platform>/test.sh after it has loaded its state
# (OWNER_URL — the database as its owner, reachable from here · API_URL · WEB_URL · MAIL_URL · MAIL_TOKEN · CB_SPIN_ID).
# The same steps as deploy/proof.sh, against the platform instead of compose:
#   1 migrate (the ledger) — run again after spin.sh's first run: it must run nothing    2 load a sim shop (tools/sim-load.cjs, spin rule)
#   3 /health says production, the web serves Home + the rewrite    4 CTP: the manifest on the api, never the app on the web, /config.js
#   5 the stack walk (web e2e/stack-walk.cjs: sign in with the code the sealed api mailed to the spin's sink)
#   6 CTP with ANOTHER platform's spin when CTP_PEER_API names one — reachability today; the exchange itself is HX4's
# PLAN=1 prints the steps. Needs: docker, node 20+ (npm ci here), the web checkout beside this one with e2e/node_modules + chromium.
spin_test() {
  if dry; then say "test plan for spin $CB_SPIN_ID"; fi
  say "1 migrate (a second run: the ledger says nothing is pending)"; spin_migrate "$OWNER_URL"
  say "2 load a shop (simstores, ${SIM_YEARS:-1} year — round-trip bound from here)"
  run env CB_SPIN_ID="$CB_SPIN_ID" node "$SPIN_API_DIR/tools/sim-load.cjs" --db "$OWNER_URL" --shop simstores --years "${SIM_YEARS:-1}"
  say "3 health and web"; run env API_BASE="$API_URL" WEB_BASE="$WEB_URL" node "$SPIN_API_DIR/deploy/proof-health.cjs"
  say "4 CTP manifest · the web's /config.js"; run env API_BASE="$API_URL" WEB_BASE="$WEB_URL" CB_API_BASE="$API_URL" node "$SPIN_API_DIR/deploy/proof-ctp.cjs"
  say "5 the stack walk"
  run env NODE_PATH="$SPIN_WEB_DIR/e2e/node_modules" STACK_WEB="$WEB_URL" STACK_API="$API_URL" STACK_MAIL="$MAIL_URL" \
    STACK_MAIL_TOKEN="$MAIL_TOKEN" STACK_SHOP=simstores node "$SPIN_WEB_DIR/e2e/stack-walk.cjs"
  if [ -n "${CTP_PEER_API:-}" ]; then
    say "6 CTP peer: $CTP_PEER_API (both manifests answer; the exchange runs in HX4)"
    run env API_BASE="$CTP_PEER_API" node -e "fetch(process.env.API_BASE.replace(/\/+\$/,'')+'/.well-known/ctp.json').then(r=>r.json()).then(j=>{console.log('    peer manifest: '+Object.keys(j).slice(0,5).join(', '));}).catch(e=>{console.error('✗ peer: '+e.message);process.exit(1)})"
  else say "6 CTP peer: none named (CTP_PEER_API) — skipped"; fi
  say "test green: spin $CB_SPIN_ID"
}
