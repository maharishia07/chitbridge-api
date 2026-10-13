#!/usr/bin/env bash
# deploy/railway/spin.sh — ONE ISOLATED CHITBRIDGE ON RAILWAY, the reference platform (HX2). Plain bash + the railway CLI (v4).
#   ONE new project cbspin-<id> (its name is the tag: teardown deletes only a project of that name): Postgres (Railway's template) ·
#   api (this repo's Dockerfile) · web (the web repo's Dockerfile) · mail sink — each on https://<name>.up.railway.app (TLS by Railway).
#   Object store: none native — attachments stay in Postgres (STORAGE_ADAPTER=db) unless S3_* name an S3-compatible store.
#   ⚠️ Railway has no India region (nearest: asia-southeast1, Singapore) and the CLI cannot choose one: the project takes the
#   workspace's default region — this spin is the non-resident REFERENCE, not a place for Indian shops' data.
#   bash deploy/railway/spin.sh        PLAN=1 … (print every command; PARSE=1 = PLAN here — the railway CLI has no offline parse)
# Needs: RAILWAY_API_TOKEN (an account token — README), the railway CLI, docker (psql for the database), node, openssl.
. "$(dirname "$0")/../spin-lib.sh"
[ -n "${PARSE:-}" ] && { PLAN=1; PARSE=; }
[ -n "${RAILWAY_API_TOKEN:-}" ] || dry || die "set RAILWAY_API_TOKEN (an account token: railway.com › Account › Tokens)"
SPIN_SECRETS+=(RAILWAY_API_TOKEN)
spin_new railway
N="cbspin-$CB_SPIN_ID"
RW=$(mktemp -d)   # the project is linked to this empty folder, never to a checkout
rw() { (cd "$RW" && run railway "$@"); }
rwo() { local ph=$1; shift; (cd "$RW" && out "$ph" railway "$@"); }

rw init --name "$N" ${RAILWAY_WORKSPACE:+--workspace "$RAILWAY_WORKSPACE"}
RAILWAY_PROJECT_ID=$(rwo plan-project-id status --json | node -e 'let s="";process.stdin.on("data",(c)=>s+=c).on("end",()=>{try{console.log(JSON.parse(s).id)}catch(_){console.log(s.trim())}})')
spin_save railway RAILWAY_PROJECT_ID    # recorded first: a spin that fails half-way is still found by teardown

say "database: Railway Postgres; the spin's own database in it"
rw add --database postgres
dry || sleep 20
PUBLIC_URL=$(rwo "DATABASE_PUBLIC_URL=postgresql://postgres:plan@plan.proxy.rlwy.net:12345/railway" variables --service Postgres --kv | sed -n 's/^DATABASE_PUBLIC_URL=//p')
run docker run --rm postgres:16-alpine psql "$PUBLIC_URL?sslmode=require" -X -q -c "CREATE DATABASE $SPIN_DB"
OWNER_URL="${PUBLIC_URL%/*}/$SPIN_DB?sslmode=no-verify"
PW_OF_URL=${PUBLIC_URL#*://postgres:}; PW_OF_URL=${PW_OF_URL%%@*}; SPIN_SECRETS+=(PW_OF_URL)
# the api reaches Postgres over Railway's private network
DATABASE_URL="postgres://cb_app:$CB_APP_PASSWORD@postgres.railway.internal:5432/$SPIN_DB?sslmode=disable"
say "schema (the ledger chain, then cb_app's password)"; spin_migrate "$OWNER_URL"

say "services: mail sink → api → web (each built by Railway from its Dockerfile), then the api learns the web's address"
# service <name> <port> <source dir> — env on stdin; prints its https URL
service() {
  local env=() kv=(); mapfile -t env; local e; for e in "${env[@]}" "PORT=$2"; do kv+=(--set "$e"); done
  rw add --service "$1" >&2
  rw variables --service "$1" --skip-deploys "${kv[@]}" >&2
  rw up "$3" --service "$1" --detach >&2
  rwo "https://$N-$1.up.railway.app" domain --service "$1" | grep -oE 'https://[^ ]+' | head -1
}
SINK=$(mktemp -d); cp "$SPIN_API_DIR/deploy/mail-sink.cjs" "$SINK/"; cp "$SPIN_API_DIR/deploy/mail-sink.Dockerfile" "$SINK/Dockerfile"
MAIL_URL=$(spin_sink_env | service mailsink 8025 "$SINK")
WEB_URL=""; API_URL=""   # the api starts before the web exists: its origin is set below
API_URL=$(spin_api_env | service api 3000 "$SPIN_API_DIR")
WEB_URL=$(printf 'CB_API_BASE=%s\n' "$API_URL" | service web 8080 "$SPIN_WEB_DIR")
spin_save railway RAILWAY_PROJECT_ID OWNER_URL DATABASE_URL API_URL WEB_URL MAIL_URL
rw variables --service api --set "ALLOWED_ORIGINS=$WEB_URL" --set "PUBLIC_WEB_BASE=$WEB_URL" --set "PUBLIC_API_BASE=$API_URL"
spin_wait_http "$API_URL/health" "api"; spin_wait_http "$WEB_URL/" "web"; spin_wait_http "$MAIL_URL/last" "mail sink"
rm -rf "$SINK"
say "up: web $WEB_URL · api $API_URL · state deploy/.spin/railway.env — next: bash deploy/railway/test.sh"
