#!/usr/bin/env bash
# smoke-review-fixes.sh — exercises the DB-dependent review fixes (F3 leak + self-chit regression, F5 actor-OTP
# lockout, F6 ambiguous-name + caps, F7 supplier read) against a LIVE dev API. Mirrors MANUAL-TEST-SCRIPT §13.3–13.7.
#
# RUN THIS AFTER THE DEV DEPLOY + MIGRATIONS (see docs/DEV-DEPLOY-CHECKLIST.md). It self-provisions two throwaway
# entities + an actor and uses the dev fixed OTP (123456). It does NOT hardcode secrets — tokens come from the
# register/verify responses. NOTE: the customer-order half of F6 (ambiguous-name / >200 line items) needs a shop
# that already has a PUBLIC catalogue with two same-named items; provide SHOP_BRIDGE (+ SHOP_ITEM_ID, SHOP_ITEM_NAME)
# or that sub-check is SKIPPED. The bulk-assign >200 cap always runs.
#
# Requires: bash, curl, jq.   Usage:  API_BASE="https://<dev-api>" ./scripts/smoke-review-fixes.sh
set -uo pipefail

API_BASE="${API_BASE:-http://localhost:3000}"   # set to the dev Railway API base before running
DEV_OTP="${DEV_OTP:-123456}"                     # dev/UAT fixed OTP
TS="$(date +%s)"
PASS=0; FAIL=0; SKIP=0
BODY_FILE="$(mktemp)"; trap 'rm -f "$BODY_FILE"' EXIT

command -v jq >/dev/null 2>&1 || { echo "FATAL: jq is required"; exit 2; }

# api METHOD PATH TOKEN [JSON]  -> sets HTTP_CODE and RESP (body)
api() {
  local method="$1" path="$2" token="${3:-}" data="${4:-}"
  local args=(-s -o "$BODY_FILE" -w '%{http_code}' -X "$method" "$API_BASE$path" -H 'Content-Type: application/json')
  [ -n "$token" ] && args+=(-H "Authorization: Bearer $token")
  [ -n "$data" ]  && args+=(-d "$data")
  HTTP_CODE="$(curl "${args[@]}")"; RESP="$(cat "$BODY_FILE")"
}
jget(){ echo "$RESP" | jq -r "$1" 2>/dev/null; }
pass(){ echo "PASS  $1"; PASS=$((PASS+1)); }
fail(){ echo "FAIL  $1  (http=$HTTP_CODE resp=$(echo "$RESP" | head -c 160))"; FAIL=$((FAIL+1)); }
skip(){ echo "SKIP  $1"; SKIP=$((SKIP+1)); }

# register+verify an entity -> echoes the bearer token
make_entity(){ # name email
  api POST /api/entities/register "" "{\"email\":\"$2\",\"display_name\":\"$1\"}"
  api POST /api/entities/verify   "" "{\"email\":\"$2\",\"otp\":\"$DEV_OTP\"}"
  jget '.token'
}

echo "== Chit & Bridge — review-fixes smoke =="
echo "API_BASE=$API_BASE"

# ── Setup ───────────────────────────────────────────────────────────────────
A_NAME="SmokeA$TS"; A_EMAIL="smoke-a-$TS@example.com"
B_NAME="SmokeB$TS"; B_EMAIL="smoke-b-$TS@example.com"
A_TOKEN="$(make_entity "$A_NAME" "$A_EMAIL")"
B_TOKEN="$(make_entity "$B_NAME" "$B_EMAIL")"
[ -n "$A_TOKEN" ] && [ "$A_TOKEN" != "null" ] || { echo "FATAL: could not register/verify entity A"; exit 1; }
[ -n "$B_TOKEN" ] && [ "$B_TOKEN" != "null" ] || { echo "FATAL: could not register/verify entity B"; exit 1; }
api GET /api/entities/me "$A_TOKEN"; A_ID="$(jget '.identity_id // .entity.identity_id')"
api GET /api/entities/me "$B_TOKEN"; B_ID="$(jget '.identity_id // .entity.identity_id')"

# A creates an actor + issues its OTP
api POST /api/actors/ "$A_TOKEN" "{\"display_name\":\"SmokeActor$TS\",\"actor_key\":\"smk$TS\"}"
ACTOR_ID="$(jget '.identity_id // .actor.identity_id // .id // .actor.id')"
api POST "/api/actors/$ACTOR_ID/otp" "$A_TOKEN" "{}"   # issues/resets the actor OTP (=DEV_OTP) + resets attempts

# A sends a chit to B, then grab its id from /sent
api POST /api/chits/send "$A_TOKEN" "{\"recipients\":[{\"role\":\"to\",\"display_name\":\"$B_NAME\"}],\"subject\":\"smoke $TS\",\"line_items\":[]}"
CHIT_ID="$(jget '.chit_id')"
[ -n "$CHIT_ID" ] && [ "$CHIT_ID" != "null" ] || { api GET /api/chits/sent "$A_TOKEN"; CHIT_ID="$(jget '.chits[0].chit_id // .[0].chit_id // .rows[0].chit_id')"; }

# ── 13.3  F3: shared-chit internal-action leak ──────────────────────────────
# A performs INTERNAL actions on the shared chit
api GET  "/api/chits/$CHIT_ID" "$A_TOKEN"                      # read (writes 'read')
api POST "/api/chits/$CHIT_ID/archive"   "$A_TOKEN" "{}"       # archive
api POST "/api/chits/$CHIT_ID/unarchive" "$A_TOKEN" "{}"       # unarchive
api POST /api/chits/assign-bulk "$A_TOKEN" "{\"chit_ids\":[\"$CHIT_ID\"],\"target_actor_id\":\"$ACTOR_ID\"}"  # internal assign
# B's feed must contain NONE of A's internal actions for this chit
api GET /api/notifications "$B_TOKEN"
LEAK="$(echo "$RESP" | jq --arg c "$CHIT_ID" '[.notifications[] | select(.chit_id==$c and (.action|test("^(read|archived|deleted|restored|assigned|status_pending)$")))] | length' 2>/dev/null)"
if [ "${LEAK:-1}" = "0" ]; then pass "13.3 F3 — no A-internal action leaked to B"; else fail "13.3 F3 — B sees $LEAK A-internal action(s) [P0]"; fi

# Cross-party still works: A raises a dispute -> B must see dispute_raised
api POST "/api/chits/$CHIT_ID/disputes" "$A_TOKEN" "{\"category\":\"quality\",\"reason\":\"smoke dispute $TS\"}"
api GET /api/notifications "$B_TOKEN"
XPARTY="$(echo "$RESP" | jq --arg c "$CHIT_ID" '[.notifications[] | select(.chit_id==$c and .action=="dispute_raised")] | length' 2>/dev/null)"
if [ "${XPARTY:-0}" -ge 1 ] 2>/dev/null; then pass "13.3 F3 — cross-party dispute still reaches B"; else fail "13.3 F3 — B did NOT see A's dispute (over-filtered)"; fi

# Cross-party status: B changes status -> A must see it
api PUT "/api/chits/$CHIT_ID/status" "$B_TOKEN" "{\"status\":\"in_progress\"}"
api GET /api/notifications "$A_TOKEN"
STAT="$(echo "$RESP" | jq --arg c "$CHIT_ID" '[.notifications[] | select(.chit_id==$c and (.action|test("status|in_progress")))] | length' 2>/dev/null)"
if [ "${STAT:-0}" -ge 1 ] 2>/dev/null; then pass "13.4 F3 — B's status change still reaches A"; else fail "13.4 F3 — A did NOT see B's status change"; fi

# ── 13.4  F3: self-chit dispute regression — exactly 2 notifications ────────
api POST /api/chits/send "$A_TOKEN" "{\"recipients\":[{\"role\":\"to\",\"self\":true}],\"subject\":\"selfsmoke $TS\",\"line_items\":[]}"
SELF_CHIT="$(jget '.chit_id')"
[ -n "$SELF_CHIT" ] && [ "$SELF_CHIT" != "null" ] || { api GET /api/chits/sent "$A_TOKEN"; SELF_CHIT="$(jget '.chits[0].chit_id // .[0].chit_id')"; }
api POST "/api/chits/$SELF_CHIT/disputes" "$A_TOKEN" "{\"category\":\"quality\",\"reason\":\"self dispute $TS\"}"
api GET /api/notifications "$A_TOKEN"
NSELF="$(echo "$RESP" | jq --arg c "$SELF_CHIT" '[.notifications[] | select(.chit_id==$c and .action=="dispute_raised")] | length' 2>/dev/null)"
if [ "${NSELF:-0}" = "2" ]; then pass "13.4 F3 — self-chit dispute = exactly 2 notifications"; else fail "13.4 F3 — self-chit dispute gave ${NSELF:-?} notifications (expected 2)"; fi

# ── 13.5  F7: supplier-catalogue read gated on visibility=public ───────────
# Fresh entity A has no PUBLIC default schema -> B must get empty items (was: A's full catalogue)
api GET "/api/relationships/suppliers/$A_ID/catalogue" "$B_TOKEN"
ITEMS="$(jget '.items | length')"
if [ "${ITEMS:-1}" = "0" ]; then pass "13.5 F7 — supplier catalogue empty without a public schema"; else fail "13.5 F7 — B read $ITEMS item(s) of A's catalogue (leak)"; fi

# ── 13.6  F5: actor-login OTP attempt cap ──────────────────────────────────
for i in 1 2 3 4 5; do
  api POST /api/actors/login "" "{\"entity_name\":\"$A_NAME\",\"actor_key\":\"smk$TS\",\"otp\":\"000000\"}"
done
# now locked: even the CORRECT otp must be rejected (429) until a fresh code is issued
api POST /api/actors/login "" "{\"entity_name\":\"$A_NAME\",\"actor_key\":\"smk$TS\",\"otp\":\"$DEV_OTP\"}"
if [ "$HTTP_CODE" = "429" ]; then pass "13.6 F5 — locked after 5 wrong actor OTPs (429)"; else fail "13.6 F5 — expected 429 after 5 wrong, got $HTTP_CODE"; fi
api POST "/api/actors/$ACTOR_ID/otp" "$A_TOKEN" "{}"   # fresh code resets the counter
api POST /api/actors/login "" "{\"entity_name\":\"$A_NAME\",\"actor_key\":\"smk$TS\",\"otp\":\"$DEV_OTP\"}"
if [ "$HTTP_CODE" = "200" ]; then pass "13.6 F5 — fresh code unlocks actor login"; else fail "13.6 F5 — fresh code did not unlock (http=$HTTP_CODE)"; fi

# ── 13.7  F6: batch caps + ambiguous name ──────────────────────────────────
# (a) bulk-assign > 200 -> 400 (cap runs before the tx; needs no catalogue setup)
BIG_IDS="$(jq -nc '[range(201) | "00000000-0000-0000-0000-" + (1000000000000 + .|tostring)]')"
api POST /api/chits/assign-bulk "$A_TOKEN" "{\"chit_ids\":$BIG_IDS,\"target_actor_id\":\"$ACTOR_ID\"}"
if [ "$HTTP_CODE" = "400" ]; then pass "13.7 F6 — bulk-assign >200 rejected (400)"; else fail "13.7 F6 — bulk-assign >200 expected 400, got $HTTP_CODE"; fi

# (b) customer order: ambiguous name + >200 line items. Needs a PUBLIC shop with two same-named items.
if [ -n "${SHOP_BRIDGE:-}" ] && [ -n "${SHOP_ITEM_NAME:-}" ] && [ -n "${SHOP_ITEM_ID:-}" ]; then
  CUST="cust-$TS@example.com"
  api POST "/api/catalogue/$SHOP_BRIDGE/order/start" "" "{\"identifier\":\"$CUST\"}"
  # ambiguous name-only line -> 422
  api POST "/api/catalogue/$SHOP_BRIDGE/order/confirm" "" "{\"identifier\":\"$CUST\",\"otp\":\"$DEV_OTP\",\"line_items\":[{\"particulars\":\"$SHOP_ITEM_NAME\",\"quantity\":1}]}"
  if [ "$HTTP_CODE" = "422" ]; then pass "13.7 F6 — ambiguous name-only line rejected (422)"; else fail "13.7 F6 — ambiguous name expected 422, got $HTTP_CODE"; fi
  # item_id line -> should price (re-start, OTP consumed above)
  api POST "/api/catalogue/$SHOP_BRIDGE/order/start" "" "{\"identifier\":\"$CUST\"}"
  api POST "/api/catalogue/$SHOP_BRIDGE/order/confirm" "" "{\"identifier\":\"$CUST\",\"otp\":\"$DEV_OTP\",\"line_items\":[{\"item_id\":\"$SHOP_ITEM_ID\",\"quantity\":1}]}"
  if [ "$HTTP_CODE" = "200" ]; then pass "13.7 F6 — item_id line prices correctly"; else fail "13.7 F6 — item_id line expected 200, got $HTTP_CODE"; fi
  # >200 line items -> 422
  MANY="$(jq -nc --arg n "$SHOP_ITEM_NAME" '[range(201) | {particulars:$n, quantity:1}]')"
  api POST "/api/catalogue/$SHOP_BRIDGE/order/start" "" "{\"identifier\":\"$CUST\"}"
  api POST "/api/catalogue/$SHOP_BRIDGE/order/confirm" "" "{\"identifier\":\"$CUST\",\"otp\":\"$DEV_OTP\",\"line_items\":$MANY}"
  if [ "$HTTP_CODE" = "422" ]; then pass "13.7 F6 — >200 line items rejected (422)"; else fail "13.7 F6 — >200 line items expected 422, got $HTTP_CODE"; fi
else
  skip "13.7 F6 customer-order parts — set SHOP_BRIDGE + SHOP_ITEM_NAME (two same-named items) + SHOP_ITEM_ID to run"
fi

echo "== summary: PASS=$PASS FAIL=$FAIL SKIP=$SKIP =="
[ "$FAIL" -eq 0 ]
