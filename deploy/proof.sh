#!/usr/bin/env bash
# deploy/proof.sh — SPIN THE STACK UP, PROVE IT, WIND IT OFF (HX0). The same steps any platform script repeats against its own host.
#   1 up (db → migrate → api → web, + the proof mail sink)   2 load a shop (tools/sim-load.cjs, 1 year)   3 /health says production
#   4 the web serves Home and the rewrite                      5 one walk (chitbridge-web e2e/stack-walk.cjs)  6 down -v (data removed)
# Needs: docker compose, node 20+, this repo's node_modules (npm ci), the web checkout beside it with e2e/node_modules + chromium.
# A throwaway deploy/.env is written when none exists (random secrets, the mail sink as Resend) — never use it for a real host.
#   bash deploy/proof.sh            KEEP=1 bash deploy/proof.sh  (leave it running)
set -euo pipefail
cd "$(dirname "$0")/.."
WEB_DIR="${CB_WEB_DIR:-$(cd .. && pwd)/chitbridge-web}"
ENVF=deploy/.env
if [ ! -f "$ENVF" ]; then
  umask 077
  printf 'POSTGRES_PASSWORD=%s\nJWT_SECRET=%s\nRESEND_API_KEY=re_proof_not_a_key\nRESEND_BASE_URL=http://mailsink:8025\nFROM_EMAIL=noreply@proof.example\nWEB_ORIGIN=http://localhost:8080\nCB_API_BASE=http://localhost:3000\n' \
    "$(openssl rand -hex 16)" "$(openssl rand -hex 32)" > "$ENVF"
  echo "· wrote a throwaway $ENVF"
fi
C="docker compose -f deploy/compose.yml --env-file $ENVF --profile proof"
PW=$(grep '^POSTGRES_PASSWORD=' "$ENVF" | cut -d= -f2-)
down() { [ "${KEEP:-}" = 1 ] && { echo "· KEEP=1 — the stack stays up ($C down -v to remove it)"; return; }; $C down -v --remove-orphans >/dev/null 2>&1 && echo "· 6 down: containers and the data volume removed"; }
trap down EXIT

echo "· 1 up"; CB_WEB_DIR="$WEB_DIR" $C up -d --build --wait db api web mailsink
$C logs migrate | grep -E 'schema:' | head -4 | sed 's/^/    /'
echo "· 2 load"; node tools/sim-load.cjs --db "postgres://postgres:$PW@127.0.0.1:${DB_PORT:-5432}/chitbridge" --shop simstores --years 1 2>&1 | grep -E '^  (·|✓|✗|  ok|  RED)' | tail -14
echo "· 3+4 health and web"
node -e "
(async () => {
  const h = await (await fetch('http://127.0.0.1:${API_PORT:-3000}/health')).json();
  const w = await fetch('http://127.0.0.1:${WEB_PORT:-8080}/'), rw = await fetch('http://127.0.0.1:${WEB_PORT:-8080}/no/such/page');
  const ok = h.environment === 'production' && h.db === 'ok' && w.status === 200 && rw.status === 200 && (await rw.text()).includes('<title>ChitBridge</title>');
  console.log('    api /health environment=' + h.environment + ' db=' + h.db + ' · web / ' + w.status + ' · rewrite ' + rw.status);
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e.message); process.exit(1); });"
echo "· 5 walk"; (cd "$WEB_DIR" && NODE_PATH="$WEB_DIR/e2e/node_modules" STACK_WEB="http://localhost:${WEB_PORT:-8080}" STACK_API="http://localhost:${API_PORT:-3000}" node e2e/stack-walk.cjs)
echo "· proof green"
