#!/bin/sh
# deploy/sso/sso-box-setup.sh <box name from PM/SIT-SERVERS.json, e.g. sit-in> - SEC-112 P0: put provider sign-in on ONE SIT box, from the PC, in one run. DRY=1 by default (prints every step and remote command, changes nothing).
#   DRY=0 sh deploy/sso/sso-box-setup.sh sit-in
# Pattern: C:/dev/shots/l16-integ2/sitbox-deploy-box.sh (same gates, same rollback tags, same "DRY first"). Written 17 Nov 2026, NOT RUN: Athi or the coordinator runs it.
# It WIDENS the box's existing stack (deploy/compose.yml + deploy/sit/docker-compose.yml + deploy/sso/docker-compose.sso.yml); it never edits deploy/sit/Caddyfile, deploy/sit/.env or another lane's folder.
# Two ways to reach the stand-in provider, chosen by SSO_MODE:
#   front  (default) Keycloak sits behind the box's own Caddy on 443 under /kc (deploy/sso/kc.caddy, imported once by the Caddyfile: step 0, an operator action, the script says so and stops when it is missing). Its own port is never published.
#   port   a shared box: Keycloak and the api run on LOOPBACK ports of their own (SSO_KC_PORT, SSO_API_PORT) in ~/ssop0; nothing of the box's ingress or Caddy is touched; the PC reaches them through `ssh -L`. For lanes that must not disturb each other.
# SECRETS: with a real provider the script reads each of the four values with `read -rs` on THIS PC and pipes it over ssh standard input into the box's env file (mode 600). Never an argument, never a PC file, never echoed.
#          With the stand-in only (no real provider yet) it asks for NOTHING: it sets SIGNIN_STANDIN=1 and the stand-in issuers, and the realm files carry test fixtures, not secrets.
# Moving boxes (about 20 Nov) = the same script with the new box name.
set -eu
NAME=${1:?usage: sso-box-setup.sh <box name in PM/SIT-SERVERS.json>}; DRY=${DRY:-1}; DEV=${DEV:-C:/dev}; KEY=${KEY:-$HOME/.ssh/sit_oracle}
MODE=${SSO_MODE:-front}; REAL=${SSO_REAL:-0}; REMOTE_DIR=${SSO_DIR:-ssop0}; KC_PORT=${SSO_KC_PORT:-18080}; API_PORT=${SSO_API_PORT:-13000}
HERE=$(cd "$(dirname "$0")" && pwd); API_DIR=$(cd "$HERE/../.." && pwd)
say() { printf '== %s\n' "$*"; }
run() { if [ "$DRY" = 1 ]; then echo "DRY> $*"; else echo "RUN> $*"; "$@"; fi; }
die() { echo "STOP: $*" >&2; exit 1; }

# 1. resolve the box from the one list: no address or host name lives in this script
say "1 resolve $NAME from PM/SIT-SERVERS.json"
LINE=$(node -e '
  const fs=require("fs");const L=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const boxes=L.servers||L.boxes||L;
  const b=(Array.isArray(boxes)?boxes:Object.values(boxes)).find(x=>x.name===process.argv[2]);
  if(!b||!b.ip||!b.api_base||!b.web_base){console.error("no such box, or no ip/api_base/web_base");process.exit(2)}
  console.log([b.ip,b.api_base,b.web_base].join(" "))' "$DEV/PM/SIT-SERVERS.json" "$NAME") || die "cannot resolve $NAME"
set -- $LINE; HOST=$1; API_BASE=$2; WEB_BASE=$3
SSH="ssh -o ConnectTimeout=15 -i $KEY ubuntu@$HOST"
echo "   box $NAME · api $API_BASE · web $WEB_BASE"
case "$MODE" in front) ISSUER_BASE="$API_BASE/kc/realms" ;; port) ISSUER_BASE="http://localhost:$KC_PORT/realms" ;; *) die "SSO_MODE is front or port" ;; esac
[ "$MODE" = port ] && PUBLIC_API="http://localhost:$API_PORT" || PUBLIC_API=$API_BASE

# 2. gates: stop at the first failure and say which
say "2 gates (free disk, free memory >= 1.5 GB before Keycloak, no gate lock, ingress, no fixed or tester code mode, level with the batch)"
FREE=$($SSH "df -BG --output=avail / | tail -1 | tr -dc 0-9"); echo "   free disk ${FREE} GB"; [ "$FREE" -ge 6 ] || die "only ${FREE} GB free disk on $NAME (clean first: docker image prune -f, builder prune -f, own run dirs)"
MEM=$($SSH "free -m | awk '/^Mem:/{print \$7}'"); echo "   available memory ${MEM} MB"
KC_OK=1; [ "$MEM" -ge 1536 ] || { KC_OK=0; echo "   MEMORY BELOW 1.5 GB: everything starts EXCEPT Keycloak (a starting figure from the design, cb-platform measures it)"; }
$SSH "test -d ~/net/gate.lock" && die "a gate holds $NAME"
if [ "$MODE" = front ]; then
  curl -s -m 8 -o /dev/null -w '   443 from this PC: %{http_code}\n' "$API_BASE/health" || die "443 is not reachable from this PC: open ingress (step 0), or use SSO_MODE=port"
  $SSH "grep -q 'import sso/' ~/net/chitbridge-api/deploy/sit/Caddyfile" || die "the box's Caddyfile does not import deploy/sso/kc.caddy yet: add the line 'import sso/*.caddy' inside the site block ONCE (step 0, an operator action; this script never edits the shared Caddyfile), or use SSO_MODE=port"
fi
$SSH "grep -Eq '^(TESTER_ALL_UNTIL|DEV_OTP)=.' ~/net/chitbridge-api/deploy/sit/.env 2>/dev/null" && echo "   NOTE: the box carries a tester or fixed code mode; the stand-in gives no way around it and no lane here depends on it (C7 is judged by cb-health: provider sign-in must not be on a box where a fixed code opens every account)"
echo "   batch level: the box's /health commit must equal the api head this script ships ($(git -C "$API_DIR" rev-parse --short HEAD)); a mismatch is said, not fatal, for a box that runs an older batch"

# 3. rollback point and files
say "3 tag the running images as the rollback point, ship deploy/sso over ssh into ~/$REMOTE_DIR"
TAG=sso-$(date +%Y%m%d-%H%M)
run $SSH "mkdir -p ~/$REMOTE_DIR && for s in api web; do docker image inspect chitbridge-\$s >/dev/null 2>&1 && docker tag chitbridge-\$s chitbridge-\$s:pre-$TAG || true; done"
if [ "$DRY" = 1 ]; then echo "DRY> tar -C $API_DIR/deploy sso | $SSH 'tar -x -C ~/$REMOTE_DIR'"; else tar -C "$API_DIR/deploy" -c sso | $SSH "tar -x -C ~/$REMOTE_DIR"; fi

# 4. secrets: real provider values over stdin only; the stand-in asks for nothing
say "4 environment (names only are printed)"
ENVFILE="~/$REMOTE_DIR/sso/.sso.env"
if [ "$REAL" = 1 ]; then
  for NAMEV in GOOGLE_OIDC_CLIENT_ID GOOGLE_OIDC_CLIENT_SECRET MICROSOFT_OIDC_CLIENT_ID MICROSOFT_OIDC_CLIENT_SECRET; do
    if [ "$DRY" = 1 ]; then echo "DRY> read -rs $NAMEV  (typed here, piped over ssh stdin into $ENVFILE, mode 600, never echoed)"; else
      printf '   %s: ' "$NAMEV" >&2; stty -echo 2>/dev/null || true; IFS= read -r VAL; stty echo 2>/dev/null || true; printf '\n' >&2
      printf '%s=%s\n' "$NAMEV" "$VAL" | $SSH "umask 077; cat >> $ENVFILE"; VAL=; fi
  done
  PROV="google,microsoft"
else
  echo "   stand-in only: no secret is asked for. SIGNIN_STANDIN=1 and the two stand-in issuers are written; the client ids and secrets are the realm files' test fixtures."
  PROV="google,microsoft"
  STAND="SIGNIN_STANDIN=1
SIGNIN_STANDIN_GOOGLE_ISSUER=$ISSUER_BASE/google
SIGNIN_STANDIN_MICROSOFT_ISSUER=$ISSUER_BASE/microsoft
GOOGLE_OIDC_CLIENT_ID=cb-google-test
GOOGLE_OIDC_CLIENT_SECRET=cb-google-test-fixture-secret
MICROSOFT_OIDC_CLIENT_ID=cb-microsoft-test
MICROSOFT_OIDC_CLIENT_SECRET=cb-microsoft-test-fixture-secret"
fi
BASE_ENV="SIGNIN_PROVIDERS=$PROV
PUBLIC_API_BASE=$PUBLIC_API
PUBLIC_WEB_BASE=$WEB_BASE
SSO_KC_PORT=$KC_PORT
SSO_API_PORT=$API_PORT"
if [ "$DRY" = 1 ]; then echo "DRY> write $ENVFILE (mode 600): $(printf '%s\n%s\n' "$BASE_ENV" "${STAND:-}" | sed 's/=.*//' | tr '\n' ' ')"; else printf '%s\n%s\n' "$BASE_ENV" "${STAND:-}" | $SSH "umask 077; cat >> $ENVFILE"; fi
echo "   variable NAMES the box env file will hold: SIGNIN_PROVIDERS PUBLIC_API_BASE PUBLIC_WEB_BASE GOOGLE_OIDC_CLIENT_ID GOOGLE_OIDC_CLIENT_SECRET MICROSOFT_OIDC_CLIENT_ID MICROSOFT_OIDC_CLIENT_SECRET$( [ "$REAL" = 1 ] || echo ' SIGNIN_STANDIN SIGNIN_STANDIN_GOOGLE_ISSUER SIGNIN_STANDIN_MICROSOFT_ISSUER')"
echo "   NODE_ENV on the box must be a named non-sealed word for the stand-in to switch on (an absent or sealed NODE_ENV switches it OFF: lib/signin-provider standinActive)"

# 5. migrate: the reviewed files, SIT only (the box deploy's own migrate job applies migrations/ in order)
say "5 migrate b878 b879 b880 on the SIT database the way a box deploy does (SIT only; production SQL is Athi's hands)"
run $SSH "cd ~/net/chitbridge-api/deploy && docker compose -p chitbridge -f compose.yml -f sit/docker-compose.yml --env-file sit/.env run --rm migrate"

# 6. start and check
say "6 start (api widened with deploy/sso overlay; Keycloak only under profile test and only if memory allowed)"
PROFILE=""; [ "$KC_OK" = 1 ] && PROFILE="--profile test"
run $SSH "cd ~/net/chitbridge-api/deploy && docker compose -p chitbridge -f compose.yml -f sit/docker-compose.yml -f ~/$REMOTE_DIR/sso/docker-compose.sso.yml --env-file sit/.env --env-file ~/$REMOTE_DIR/sso/.sso.env $PROFILE up -d"
say "6 health: /health over https with a valid certificate; GET /api/signin/providers lists what was configured; each start URL answers a 302 whose redirect_uri is the registered callback; the discovery documents answer from the box"
for CHECK in "curl -fsS $API_BASE/health" "curl -fsS $API_BASE/api/signin/providers" "curl -s -o /dev/null -D - '$API_BASE/api/signin/provider/google/start?device_id=sso-check-0001' | grep -i '^location:.*redirect_uri=.*callback'" "curl -fsS $ISSUER_BASE/google/.well-known/openid-configuration"; do
  if [ "$DRY" = 1 ]; then echo "DRY> $CHECK"; else sh -c "$CHECK" >/dev/null || { echo "FAILED CHECK: $CHECK : rolling back to the tagged images"; $SSH "cd ~/net/chitbridge-api/deploy && for s in api web; do docker tag chitbridge-\$s:pre-$TAG chitbridge-\$s 2>/dev/null; done; docker compose -p chitbridge -f compose.yml -f sit/docker-compose.yml --env-file sit/.env up -d"; exit 1; }; fi
done

# 7. print the callback URLs to register, and nothing secret
say "7 callback URLs to register at the provider (real run) - nothing secret printed"
echo "   $PUBLIC_API/api/signin/provider/google/callback"
echo "   $PUBLIC_API/api/signin/provider/microsoft/callback"
[ "$MODE" = port ] && echo "   port mode: ssh -N -i $KEY -L $KC_PORT:127.0.0.1:$KC_PORT -L $API_PORT:127.0.0.1:$API_PORT ubuntu@$HOST   (then open http://localhost:$API_PORT)"
[ "$DRY" = 1 ] && echo "(DRY=1: nothing changed. DRY=0 sh $0 $NAME to run it.)"
exit 0
