#!/usr/bin/env bash
# deploy/proof.sh — SPIN THE STACK UP, PROVE IT, WIND IT OFF (HX0). The same steps any platform script repeats against its own host.
#   1 up (db → migrate → api → web, + the proof mail sink + MinIO)   2 load a shop (tools/sim-load.cjs, 1 year)   3 /health says production
#   4 the web serves Home and the rewrite                      5 one walk (chitbridge-web e2e/stack-walk.cjs)  6 down -v (data removed)
#   HX1 adds: the api's object store IS MinIO (SigV4, tests/storage-s3-live.test.cjs + a put/get from inside the api container), the
#   migrate job run twice records every file once and runs nothing the second time, /.well-known/ctp.json answers on the api and is
#   NEVER index.html on the web, and the web's /config.js names CB_API_BASE.
# Needs: docker compose, node 20+, this repo's node_modules (npm ci), the web checkout beside it with e2e/node_modules + chromium.
# A throwaway deploy/.env is written when none exists (random secrets, the mail sink as Resend) — never use it for a real host.
#   bash deploy/proof.sh            KEEP=1 bash deploy/proof.sh  (leave it running)
set -euo pipefail
cd "$(dirname "$0")/.."
WEB_DIR="${CB_WEB_DIR:-$(cd .. && pwd)/chitbridge-web}"
ENVF=deploy/.env
if [ ! -f "$ENVF" ]; then
  umask 077
  printf 'POSTGRES_PASSWORD=%s\nCB_APP_PASSWORD=%s\nJWT_SECRET=%s\nRESEND_API_KEY=re_proof_not_a_key\nRESEND_BASE_URL=http://mailsink:8025\nFROM_EMAIL=noreply@proof.example\nWEB_ORIGIN=http://localhost:8080\nCB_API_BASE=http://localhost:3000\nS3_ENDPOINT=http://minio:9000\nS3_ACCESS_KEY_ID=cbproof%s\nS3_SECRET_ACCESS_KEY=%s\nSTORAGE_ADAPTER=object\n' \
    "$(openssl rand -hex 16)" "$(openssl rand -hex 16)" "$(openssl rand -hex 32)" "$(openssl rand -hex 4)" "$(openssl rand -hex 20)" > "$ENVF"
  echo "· wrote a throwaway $ENVF"
fi
C="docker compose -f deploy/compose.yml --env-file $ENVF --profile proof"
PW=$(grep '^POSTGRES_PASSWORD=' "$ENVF" | cut -d= -f2-)
down() { [ "${KEEP:-}" = 1 ] && { echo "· KEEP=1 — the stack stays up ($C down -v to remove it)"; return; }; $C down -v --remove-orphans >/dev/null 2>&1 && echo "· 6 down: containers and the data volume removed"; }
trap down EXIT

echo "· 1 up"; CB_WEB_DIR="$WEB_DIR" $C up -d --build --wait db minio mailsink
$C run --rm minio-bucket | sed 's/^/    /'
CB_WEB_DIR="$WEB_DIR" $C up -d --build --wait api web
$C logs migrate | grep -E 'schema: [0-9]|cb_app' | sed 's/^/    /'
envget() { grep "^$1=" "$ENVF" | cut -d= -f2-; }
node -e "require('pg');" 2>/dev/null || { echo 'npm ci first (the loader needs pg)'; exit 1; }
echo "    api signs in as: $(docker exec chitbridge-db-1 psql -U postgres -d chitbridge -Atc "SELECT usename || CASE WHEN r.rolsuper OR r.rolbypassrls THEN ' (BYPASSES row-level security)' ELSE ' (row-level security holds)' END FROM pg_stat_activity a JOIN pg_roles r ON r.rolname = a.usename WHERE a.application_name = '' AND a.usename <> 'postgres' LIMIT 1")"
echo "· 2 load"; node tools/sim-load.cjs --db "postgres://postgres:$PW@127.0.0.1:${DB_PORT:-5432}/chitbridge" --shop simstores --years 1 2>&1 | grep -E '^  (·|✓|✗|  ok|  RED)' | tail -14
echo "· 3+4 health and web"
API_BASE="http://127.0.0.1:${API_PORT:-3000}" WEB_BASE="http://127.0.0.1:${WEB_PORT:-8080}" node deploy/proof-health.cjs
echo "· HX1 the store, the ledger, CTP, the web's config"
S3_ENDPOINT="http://127.0.0.1:${S3_PORT:-9000}" S3_ACCESS_KEY_ID="$(envget S3_ACCESS_KEY_ID)" S3_SECRET_ACCESS_KEY="$(envget S3_SECRET_ACCESS_KEY)" \
  node tests/storage-s3-live.test.cjs | sed 's/^/    /'; test "${PIPESTATUS[0]}" = 0
docker exec -i chitbridge-api-1 node - < deploy/proof-store.cjs | sed 's/^/    /'; test "${PIPESTATUS[0]}" = 0
$C run --rm --no-deps migrate | grep -E 'schema: [0-9]|pending|nothing run' | sed 's/^/    rerun: /'
docker exec chitbridge-db-1 psql -U postgres -d chitbridge -Atc "SELECT '    ledger: ' || count(*) || ' file(s) recorded, ' || count(*) FILTER (WHERE source = 'migrate') || ' by the migrate job' FROM schema_migrations"
API_PORT="${API_PORT:-3000}" WEB_PORT="${WEB_PORT:-8080}" CB_API_BASE="$(envget CB_API_BASE)" node deploy/proof-ctp.cjs | sed 's/^/    /'; test "${PIPESTATUS[0]}" = 0
echo "· 5 walk"; (cd "$WEB_DIR" && NODE_PATH="$WEB_DIR/e2e/node_modules" STACK_WEB="http://localhost:${WEB_PORT:-8080}" STACK_API="http://localhost:${API_PORT:-3000}" node e2e/stack-walk.cjs)
echo "· proof green"
