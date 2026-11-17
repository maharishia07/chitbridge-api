#!/bin/sh
# deploy/sit/up.sh <in|au> - bring a SIT installation up (or update it) on a fresh Ubuntu 24.04 VM. Safe to run again: it only changes what changed.
#   in  sit-in.ondcpro.com   India pack, INR, tester-code day = Asia/Kolkata
#   au  sit-au.ondcpro.com   Australia pack, AUD, tester-code day = Australia/Sydney
# What it does, in order: Docker (if missing) -> open ports 80/443 -> write .env (first run: generated secrets) -> clone or pull the two repos ->
# the database and its migrations (an empty database gets the baseline + every migration; later runs only the new ones) -> this installation's own
# `installation` row (the country pack) -> the stack -> health of web and api, and the commit each one runs. It seeds NOTHING: a shop
# is made by registering, as on the live site. It is the existing deploy/compose.yml widened by deploy/sit/docker-compose.yml; nothing is copied.
# Env you may pass:  GIT_TOKEN (read-only, while the repos are private) · API_REF / WEB_REF (branches, default main) · SIT_ROOT (default: the folder above this repo)
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
API_DIR=$(cd "$HERE/../.." && pwd)
SIT_ROOT=${SIT_ROOT:-$(dirname "$API_DIR")}
WEB_DIR=$SIT_ROOT/chitbridge-web
ENVF=$HERE/.env
APIENV=$HERE/.api.env

say() { printf '\n== %s\n' "$*"; }
die() { echo "up.sh: $*" >&2; exit 1; }

# ---- 0. which installation --------------------------------------------------------------------------------------------------
case "${1:-}" in
  in) SIT_HOST=sit-in.ondcpro.com; COUNTRY=IN; CURRENCY=INR; TZNAME=Asia/Kolkata;     KEY=sit-in ;;
  au) SIT_HOST=sit-au.ondcpro.com; COUNTRY=AU; CURRENCY=AUD; TZNAME=Australia/Sydney; KEY=sit-au ;;
  ae) SIT_HOST=sit-ae.ondcpro.com; COUNTRY=AE; CURRENCY=AED; TZNAME=Asia/Dubai;       KEY=sit-ae ;;
  root) SIT_HOST=sit-root.ondcpro.com; COUNTRY=; CURRENCY=; TZNAME=Asia/Kolkata;      KEY=sit-root ;;  # the network master: it states no country (Grundfos style)
  grund) SIT_HOST=sit-grund.ondcpro.com; COUNTRY=; CURRENCY=; TZNAME=;          KEY=sit-grund ;;  # a private global installation (Grundfos): no country, no money, no zone; each business brings its own
  *) die "usage: ./up.sh in|au|ae|root|grund" ;;
esac
# before DNS: SIT_HOST_AS=129-225-85-65.sslip.io (a public name that resolves to the VM's IP) stands in for the ondcpro.com name
SIT_HOST=${SIT_HOST_AS:-$SIT_HOST}
cd "$HERE"

# ---- helpers for .env -------------------------------------------------------------------------------------------------------
get_kv() { sed -n "s/^$1=//p" "$ENVF" | head -n 1; }
# set_kv NAME VALUE: replace the line NAME=..., or add it. Values are written as given (no shell or sed pattern reads them)
set_kv() {
  # the name and value go in through ENVIRON, not awk -v: -v turns a backslash-n in a value (the CTP key's PEM is stored on one line with them) into a real newline
  KV_K="$1" KV_V="$2" awk 'BEGIN{FS=OFS="="; k=ENVIRON["KV_K"]; v=ENVIRON["KV_V"]} $1==k{print k "=" v; f=1; next} {print} END{if(!f) print k "=" v}' "$ENVF" > "$ENVF.tmp"
  mv "$ENVF.tmp" "$ENVF"
  chmod 600 "$ENVF"
}
fill_secret() { [ -n "$(get_kv "$1")" ] || set_kv "$1" "$(openssl rand -hex 32)"; }

# ---- 1. Docker ---------------------------------------------------------------------------------------------------------------
install_docker() {
  command -v docker >/dev/null 2>&1 && return 0
  say "installing Docker (get.docker.com)"
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER" || true
}
install_docker
DOCKER=docker
docker info >/dev/null 2>&1 || DOCKER="sudo docker"
$DOCKER compose version >/dev/null 2>&1 || { sudo apt-get update -qq && sudo apt-get install -y -qq docker-compose-plugin; }

# ---- 2. the Ubuntu image on Oracle ships iptables rules that REJECT everything but SSH; the Oracle security list is a separate door (README) ----
allow_port() { sudo iptables -C INPUT -p "$1" --dport "$2" -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 1 -p "$1" --dport "$2" -j ACCEPT; }
open_ports() {
  command -v iptables >/dev/null 2>&1 || return 0
  allow_port tcp 80
  allow_port tcp 443
  allow_port udp 443
  if command -v netfilter-persistent >/dev/null 2>&1; then sudo netfilter-persistent save >/dev/null 2>&1 || true; fi
}
open_ports

# ---- 3. .env: first run copies the example and generates every secret; every run sets the installation's own lines ---------------
FIRST=0
if [ ! -f "$ENVF" ]; then
  cp "$HERE/.env.example" "$ENVF"
  chmod 600 "$ENVF"
  FIRST=1
fi
for name in POSTGRES_PASSWORD CB_APP_PASSWORD JWT_SECRET CB_ADMIN_KEY VAULT_ENC_KEY; do fill_secret "$name"; done
# this installation's CTP identity: its own Ed25519 key, made once on this VM and never printed (PEM on one line, newlines written as backslash-n: lib/ctpkeys.js reads that form)
[ -n "$(get_kv CTP_PRIVATE_KEY)" ] || set_kv CTP_PRIVATE_KEY "$(openssl genpkey -algorithm ed25519 | awk 'NR>1{printf "\\n"} {printf "%s", $0}')"
[ -n "$(get_kv TESTER_CODE)" ] || set_kv TESTER_CODE "$(openssl rand -hex 4){yymmdd}"
set_kv SIT_HOST "$SIT_HOST"
set_kv SIT_COUNTRY "$COUNTRY"
set_kv INSTALLATION_KEY "$KEY"
set_kv WEB_ORIGIN "https://$SIT_HOST"
set_kv CB_API_BASE "https://$SIT_HOST"
set_kv PUBLIC_API_BASE "https://$SIT_HOST"
set_kv TESTER_CODE_TZ "${TZNAME:-UTC}"   # the tester code needs a clock; an installation that states no zone uses UTC for it
# the api's own env file: the same file without what only this script, compose or the database owner needs (the owner's password stays out of the api)
grep -E '^[A-Z][A-Z0-9_]*=.' "$ENVF" \
  | grep -vE '^(POSTGRES_PASSWORD|CB_APP_PASSWORD|GIT_TOKEN|API_REF|WEB_REF|SIT_ROOT|SIT_HOST|SIT_COUNTRY|WEB_ORIGIN|CB_API_BASE|DB_PORT|ASK_CUSTOM_HOSTS|SIT_PEERS|SIT_PROJECT)=' \
  > "$APIENV" || true
chmod 600 "$APIENV"

# ---- 4. the two repos, side by side (compose.yml expects the web at ../../chitbridge-web from deploy/) -------------------------
GIT_TOKEN=${GIT_TOKEN:-$(get_kv GIT_TOKEN)}
git_auth() {
  if [ -n "$GIT_TOKEN" ]; then
    auth=$(printf 'x-access-token:%s' "$GIT_TOKEN" | base64 | tr -d '\n')
    git -c "http.https://github.com/.extraheader=Authorization: Basic $auth" "$@"
  else
    git "$@"
  fi
}
# sync_repo <dir> <url> <ref>: clone if absent, else fast-forward only (a local change is never overwritten)
sync_repo() {
  if [ -d "$1/.git" ]; then
    git_auth -C "$1" fetch -q origin "$3"
    git -C "$1" checkout -q "$3" 2>/dev/null || git -C "$1" checkout -q -B "$3" "origin/$3"
    git -C "$1" merge -q --ff-only "origin/$3"
  else
    git_auth clone -q --branch "$3" "$2" "$1"
  fi
}
say "repos under $SIT_ROOT"
API_REF=${API_REF:-$(get_kv API_REF)}; API_REF=${API_REF:-main}
WEB_REF=${WEB_REF:-$(get_kv WEB_REF)}; WEB_REF=${WEB_REF:-main}
BEFORE=$(cksum < "$HERE/up.sh")
sync_repo "$API_DIR" https://github.com/maharishia07/chitbridge-api.git "$API_REF"
sync_repo "$WEB_DIR" https://github.com/maharishia07/chitbridge-web.git "$WEB_REF"
# the pull may have changed this very script: run the new one (once)
if [ "$BEFORE" != "$(cksum < "$HERE/up.sh")" ] && [ -z "${SIT_REEXEC:-}" ]; then
  echo "up.sh changed in the pull - running the new copy"
  SIT_REEXEC=1 exec sh "$HERE/up.sh" "$@"
fi
SOURCE_COMMIT=$(git -C "$API_DIR" rev-parse HEAD)
WEB_COMMIT=$(git -C "$WEB_DIR" rev-parse HEAD)
export SOURCE_COMMIT CB_WEB_DIR="$WEB_DIR"

# the compose project name: chitbridge, or SIT_PROJECT, so a second stack on the same VM never reuses the first one's volumes (the network spin keeps the old data aside this way)
PROJECT=${SIT_PROJECT:-$(get_kv SIT_PROJECT)}; PROJECT=${PROJECT:-chitbridge}
DC="$DOCKER compose -p $PROJECT -f ../compose.yml -f docker-compose.yml --env-file .env"

# ---- 5. database + migrations (tools/migrate.cjs: empty = baseline + every bNNN; later = only the new files; also sets cb_app's password) ----
say "database and migrations"
$DC up -d db
$DC run --rm -T migrate

# ---- 6. the country pack: this installation's own row (same INSERT as deploy/spin-lib.sh spin_installation, widened with currency and zone) ----
say "installation $KEY: $COUNTRY / $CURRENCY / $TZNAME"
$DC exec -T db psql -X -q -U postgres -d chitbridge -v ON_ERROR_STOP=1 \
  -v k="$KEY" -v c="$COUNTRY" -v d="$SIT_HOST" -v cur="$CURRENCY" -v tz="$TZNAME" -v ep="https://$SIT_HOST/api/ctp/deliver" -f - <<'SQL'
INSERT INTO installation (installation_key, label, purpose, cloud_provider, region, zone, domain, currency, timezone, vertical_key, country, ctp_endpoint)
VALUES (:'k', :'k', 'sit', 'oracle', NULLIF(:'c', ''), 'always-free', :'d', NULLIF(:'cur', ''), NULLIF(:'tz', ''), 'base', NULLIF(:'c', ''), :'ep')
ON CONFLICT (installation_key) DO UPDATE
  SET country = EXCLUDED.country, region = EXCLUDED.region, domain = EXCLUDED.domain, currency = EXCLUDED.currency, timezone = EXCLUDED.timezone,
      ctp_endpoint = EXCLUDED.ctp_endpoint, active = true;
SQL

# ---- 6a. CTP peers: the OTHER installations this one trades with (SIT_PEERS="sit-au=129-225-90-80.sslip.io,..." in the env or .env) -------------
# A peer is an `installation` row marked REMOTE (hosted_locally = false) with its domain and the endpoint that takes envelopes. The peer's PUBLIC KEY is
# never stored here: the door fetches it from https://<domain>/.well-known/ctp.json on every check (lib/ctpdirectory.js). Ours is published the same way.
# It needs CTP_PRIVATE_KEY on BOTH sides (step 3) and each side's endpoint over public https (the sslip.io names satisfy lib/safe-url.js).
SIT_PEERS=${SIT_PEERS:-$(get_kv SIT_PEERS)}
if [ -n "$SIT_PEERS" ]; then
  set_kv SIT_PEERS "$SIT_PEERS"
  say "CTP peers: $SIT_PEERS"
  for pair in $(echo "$SIT_PEERS" | tr ',' ' '); do
    pkey=${pair%%=*}; phost=${pair#*=}
    { [ -n "$pkey" ] && [ -n "$phost" ] && [ "$pkey" != "$pair" ] && [ "$pkey" != "$KEY" ]; } || die "SIT_PEERS entry '$pair': expected <installation_key>=<host>, and not this installation"
    $DC exec -T db psql -X -q -U postgres -d chitbridge -v ON_ERROR_STOP=1 -v k="$pkey" -v d="$phost" -v ep="https://$phost/api/ctp/deliver" -f - <<'SQL'
INSERT INTO installation (installation_key, label, purpose, cloud_provider, domain, vertical_key, hosted_locally, ctp_endpoint)
VALUES (:'k', :'k', 'sit-peer', 'oracle', :'d', 'base', false, :'ep')
ON CONFLICT (installation_key) DO UPDATE
  SET domain = EXCLUDED.domain, ctp_endpoint = EXCLUDED.ctp_endpoint, hosted_locally = false, active = true;
SQL
  done
fi

# ---- 6b. a country-neutral base (SET-42, Athi 2026-10-24: "not bound but inherited") -------------------------------------------
# SIT only, as DATA: the live base row drops its allowed lists and its India defaults, so nothing at the top binds a country,
# currency, time zone or language; the installation (step 6) states its own, or none. Production waits for the SET-42 migration.
say "base constitution: country-neutral (SIT data)"
$DC exec -T db psql -X -q -U postgres -d chitbridge -v ON_ERROR_STOP=1 -f - <<'SQL'
UPDATE constitution SET governance = governance - 'allowed' - 'defaults' - 'open'
 WHERE constitution_key = 'base' AND active AND (governance ? 'allowed' OR governance ? 'defaults' OR governance ? 'open');
SQL

# ---- 7. the stack ------------------------------------------------------------------------------------------------------------
say "starting the stack (the first build on 2 OCPU takes a few minutes)"
$DC up -d --build

# ---- 8. health ---------------------------------------------------------------------------------------------------------------
say "waiting for api and web"
API_JS="fetch('http://127.0.0.1:3000/health').then(r=>r.text()).then(t=>{console.log(t.slice(0,300));process.exit(0)},()=>process.exit(1))"
API_OUT=; WEB_OUT=; ok_api=0; ok_web=0; i=0
while [ "$i" -lt 40 ] && { [ "$ok_api" = 0 ] || [ "$ok_web" = 0 ]; }; do
  i=$((i + 1))
  if [ "$ok_api" = 0 ]; then API_OUT=$($DC exec -T api node -e "$API_JS" 2>/dev/null) && ok_api=1; fi
  if [ "$ok_web" = 0 ]; then WEB_OUT=$($DC exec -T web wget -qO- http://127.0.0.1:8080/healthz 2>/dev/null) && ok_web=1; fi
  [ "$ok_api" = 1 ] && [ "$ok_web" = 1 ] || sleep 3
done
echo "api  : $([ "$ok_api" = 1 ] && echo UP || echo NOT UP)  $API_OUT" 2>/dev/null || true
echo "web  : $([ "$ok_web" = 1 ] && echo UP || echo NOT UP)  $WEB_OUT" 2>/dev/null || true
echo "api commit : $SOURCE_COMMIT  ($API_REF)  $(git -C "$API_DIR" log -1 --format=%s)"
echo "web commit : $WEB_COMMIT  ($WEB_REF)  $(git -C "$WEB_DIR" log -1 --format=%s)"
say "CTP manifest"
# read inside the api container: the VM itself has no node
CTP_JS="fetch('http://127.0.0.1:3000/.well-known/ctp.json').then(r=>r.json()).then(m=>{console.log('ctp  : '+m.installation_key+' endpoint='+m.endpoint+' can_sign='+m.can_sign+' accepts='+JSON.stringify(m.accepts_populations)+(m.note?' ('+m.note+')':''));process.exit(0)},()=>{console.log('ctp  : manifest not readable yet');process.exit(0)})"
$DC exec -T api node -e "$CTP_JS" 2>/dev/null || echo "ctp  : manifest not readable yet"
if curl -fsS --max-time 15 "https://$SIT_HOST/health" >/dev/null 2>&1; then
  echo "public     : https://$SIT_HOST/health answers (certificate issued)"
else
  echo "public     : https://$SIT_HOST/health does not answer yet - DNS or the Oracle security list (README steps 1-2); Caddy retries by itself"
fi
$DC ps --format 'table {{.Service}}\t{{.Status}}'

if [ "$FIRST" = 1 ]; then
  say "first run: tester sign-in"
  FIXED=$(get_kv TESTER_CODE | sed 's/{yymmdd}$//')
  echo "Today's code (in ${TZNAME:-UTC}): ${FIXED}$(TZ=${TZNAME:-UTC} date +%y%m%d). The fixed part is in $ENVF (TESTER_CODE); keep that file private."
  echo "Sign in with a name that matches TESTER_NAMES ($(get_kv TESTER_NAMES))."
fi
[ "$ok_api" = 1 ] && [ "$ok_web" = 1 ] || die "api or web did not come up: $DC logs --tail 80 api web"
