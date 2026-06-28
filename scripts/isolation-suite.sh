#!/usr/bin/env bash
# isolation-suite.sh (A4) — automated tenant-isolation regression net.
# Spins up Entity A + B (throwaway), gives A its own data, then asserts B can NEVER read or modify A's rows via
# the API. This is the net that would have caught F3/F7 automatically, AND the proof for B1: run it with RLS
# forced — it must stay GREEN. Any FAIL here is a drop-everything P0 cross-tenant leak.
#
# RUN ON DEV after deploy:  API_BASE="https://<dev-api>" ./scripts/isolation-suite.sh
# Requires: bash, curl, jq. Read-only on secrets (tokens come from register/verify). DEV OTP = 123456.
set -uo pipefail

API_BASE="${API_BASE:-http://localhost:3000}"
DEV_OTP="${DEV_OTP:-123456}"
TS="$(date +%s)"
PASS=0; FAIL=0; SKIP=0
BODY_FILE="$(mktemp)"; trap 'rm -f "$BODY_FILE"' EXIT
command -v jq >/dev/null 2>&1 || { echo "FATAL: jq is required"; exit 2; }

api() { # METHOD PATH TOKEN [JSON] -> HTTP_CODE, RESP
  local method="$1" path="$2" token="${3:-}" data="${4:-}"
  local args=(-s -o "$BODY_FILE" -w '%{http_code}' -X "$method" "$API_BASE$path" -H 'Content-Type: application/json')
  [ -n "$token" ] && args+=(-H "Authorization: Bearer $token")
  [ -n "$data" ]  && args+=(-d "$data")
  HTTP_CODE="$(curl "${args[@]}")"; RESP="$(cat "$BODY_FILE")"
}
jget(){ echo "$RESP" | jq -r "$1" 2>/dev/null; }
pass(){ echo "PASS  $1"; PASS=$((PASS+1)); }
fail(){ echo "FAIL  $1  [P0 LEAK]  (http=$HTTP_CODE resp=$(echo "$RESP" | head -c 160))"; FAIL=$((FAIL+1)); }
skip(){ echo "SKIP  $1"; SKIP=$((SKIP+1)); }
# deny: the call MUST be rejected (>=400). Used for B touching A's chit.
deny(){ if [ "${HTTP_CODE:-0}" -ge 400 ] 2>/dev/null; then pass "$1 (denied $HTTP_CODE)"; else fail "$1 (got $HTTP_CODE — expected >=400)"; fi; }
make_entity(){ api POST /api/entities/register "" "{\"email\":\"$2\",\"display_name\":\"$1\"}"; api POST /api/entities/verify "" "{\"email\":\"$2\",\"otp\":\"$DEV_OTP\"}"; jget '.token'; }

echo "== Chit & Bridge — tenant-isolation suite (A4) =="
echo "API_BASE=$API_BASE"

# ── Setup ───────────────────────────────────────────────────────────────────
A_NAME="IsoA$TS"; B_NAME="IsoB$TS"
A_TOKEN="$(make_entity "$A_NAME" "iso-a-$TS@example.com")"
B_TOKEN="$(make_entity "$B_NAME" "iso-b-$TS@example.com")"
[ -n "$A_TOKEN" ] && [ "$A_TOKEN" != "null" ] || { echo "FATAL: entity A setup failed"; exit 1; }
[ -n "$B_TOKEN" ] && [ "$B_TOKEN" != "null" ] || { echo "FATAL: entity B setup failed"; exit 1; }
api GET /api/entities/me "$A_TOKEN"; A_ID="$(jget '.identity_id // .entity.identity_id')"

# A makes a SELF-chit (B is NOT a party to it) — the subject of every isolation probe below.
api POST /api/chits/send "$A_TOKEN" "{\"recipients\":[{\"role\":\"to\",\"self\":true}],\"subject\":\"iso $TS\",\"line_items\":[]}"
A_CHIT="$(jget '.chit_id')"
[ -n "$A_CHIT" ] && [ "$A_CHIT" != "null" ] || { api GET /api/chits/sent "$A_TOKEN"; A_CHIT="$(jget '.chits[0].chit_id // .[0].chit_id // .rows[0].chit_id')"; }
[ -n "$A_CHIT" ] && [ "$A_CHIT" != "null" ] || { echo "FATAL: could not create A's chit"; exit 1; }
# B needs an actor for the assign probe
api POST /api/actors/ "$B_TOKEN" "{\"display_name\":\"IsoActor$TS\",\"actor_key\":\"iso$TS\"}"
B_ACTOR="$(jget '.identity_id // .actor.identity_id // .id // .actor.id')"

# ── Positive control: A CAN see its own chit (proves the probe id + setup are real) ──
api GET "/api/chits/$A_CHIT" "$A_TOKEN"
if [ "$HTTP_CODE" = "200" ]; then pass "control — A sees its own chit (200)"; else fail "control — A cannot see its own chit (http=$HTTP_CODE); setup broken"; fi

# ── Isolation: B must be DENIED every access to A's chit ─────────────────────
api GET  "/api/chits/$A_CHIT" "$B_TOKEN";                                        deny "I1  B read A's chit detail"
api GET  "/api/chits/$A_CHIT/messages" "$B_TOKEN";                               deny "I2  B read A's chit messages"
api PUT  "/api/chits/$A_CHIT/status" "$B_TOKEN" "{\"status\":\"in_progress\"}";  deny "I3  B change A's chit status"
api POST "/api/chits/$A_CHIT/disputes" "$B_TOKEN" "{\"category\":\"quality\",\"reason\":\"x\"}"; deny "I4  B raise dispute on A's chit"
api POST "/api/chits/$A_CHIT/archive" "$B_TOKEN" "{}";                           deny "I5  B archive A's chit"
api PUT  "/api/chits/$A_CHIT/void" "$B_TOKEN" "{\"reason\":\"x\"}";              deny "I6  B void A's chit"
api DELETE "/api/chits/$A_CHIT" "$B_TOKEN";                                      deny "I7  B delete A's chit"

# I8  B bulk-assigns A's chit -> must be SKIPPED (not assigned), assigned count 0
if [ -n "$B_ACTOR" ] && [ "$B_ACTOR" != "null" ]; then
  api POST /api/chits/assign-bulk "$B_TOKEN" "{\"chit_ids\":[\"$A_CHIT\"],\"target_actor_id\":\"$B_ACTOR\"}"
  ASSIGNED="$(jget '.assigned')"
  if [ "${ASSIGNED:-1}" = "0" ]; then pass "I8  B cannot bulk-assign A's chit (assigned=0)"; else fail "I8  B assigned A's chit (assigned=$ASSIGNED)"; fi
else skip "I8  B bulk-assign — could not create B's actor"; fi

# I9  A's chit must NOT appear in B's notifications feed
api GET /api/notifications "$B_TOKEN"
LEAK="$(echo "$RESP" | jq --arg c "$A_CHIT" '[.notifications[]? | select(.chit_id==$c)] | length' 2>/dev/null)"
if [ "${LEAK:-1}" = "0" ]; then pass "I9  A's chit absent from B's notifications"; else fail "I9  A's chit ($LEAK rows) leaked into B's notifications"; fi

# I10 F7 — B reading A's supplier catalogue returns NO items (A has no public schema)
api GET "/api/relationships/suppliers/$A_ID/catalogue" "$B_TOKEN"
ITEMS="$(jget '.items | length')"
if [ "${ITEMS:-1}" = "0" ]; then pass "I10 B cannot read A's supplier catalogue (empty)"; else fail "I10 B read $ITEMS of A's catalogue items"; fi

# I11 A adds a product; it must NOT show in B's product list
api POST /api/products "$A_TOKEN" "{\"item_data\":{\"name\":\"SecretWidget$TS\",\"price\":99}}"
if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
  api GET /api/products "$B_TOKEN"
  SEEN="$(echo "$RESP" | jq --arg n "SecretWidget$TS" '[.items[]? | select((.item_data.name // "")==$n)] | length' 2>/dev/null)"
  if [ "${SEEN:-1}" = "0" ]; then pass "I11 A's product absent from B's catalogue"; else fail "I11 A's product leaked into B's catalogue"; fi
else skip "I11 product probe — A could not add a product (no default schema?) http=$HTTP_CODE"; fi

echo "== summary: PASS=$PASS FAIL=$FAIL SKIP=$SKIP =="
[ "$FAIL" -eq 0 ]
