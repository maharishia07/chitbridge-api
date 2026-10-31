#!/bin/sh
# deploy/network/spin.sh - run ON THE MASTER's VM: spin one installation onto a READY VM (Docker and ports 80/443 done), seed its root, join it to the network and mirror it.
#   sh spin.sh <ssh-target> <installation_key> <scope> <up.sh-kit> <host> [--country AU] [--minutes 10] [--master-fingerprint <hex>]
#   e.g.  sh spin.sh ubuntu@140.245.252.156 sit-ae ae ae 140-245-252-156.sslip.io --country AE
# What it does (the master is a job here, not a screen; the Add form comes later):
#   1. the master allocates the next root handle for the scope (cb<scope><nn>-root; 00 is the master's own) and a one-time installer token
#   2. it sends the target the master's PUBLIC key (the pin) and the token, and runs deploy/network/install.sh there (ssh, key from SPIN_SSH_KEY or ~/.ssh/spin_ed25519)
#   3. the target installs, seeds the root through the register door, pins the master and starts its pulls
#   4. the master registers the installation (ids only), issues its first certificate and reads it once (the mirror)
# Prints no secret. The master's private network key never leaves the master's .env.
# Needs on the master host: Docker, ssh, and the master stack running (project SPIN_MASTER_PROJECT, default cbnet, in $MASTER_DIR).
set -eu

TARGET=${1:?usage: spin.sh <ssh-target> <installation_key> <scope> <kit> <host> [--country XX] [--minutes N] [--master-fingerprint HEX]}
KEY=${2:?installation_key}; SCOPE=${3:?scope}; KIT=${4:?kit}; HOST=${5:?host}
shift 5
COUNTRY=; MINUTES=; WANT_FP=
while [ $# -gt 0 ]; do
  case "$1" in
    --country) COUNTRY=$2; shift 2 ;;
    --minutes) MINUTES=$2; shift 2 ;;
    --master-fingerprint) WANT_FP=$2; shift 2 ;;
    *) echo "spin.sh: unknown option $1" >&2; exit 2 ;;
  esac
done

HERE=$(cd "$(dirname "$0")" && pwd)
MASTER_DIR=${MASTER_DIR:-$HERE/../sit}
PROJECT=${SPIN_MASTER_PROJECT:-cbnet}
TARGET_PROJECT=${SPIN_TARGET_PROJECT:-$PROJECT}   # a new name when the target VM already ran another installation, so its volumes are never reused
SSH_KEY=${SPIN_SSH_KEY:-$HOME/.ssh/spin_ed25519}
SEED_BUNDLE=${SPIN_SEED_BUNDLE:-$HOME/net/seed.bundle}   # set on a master whose SIT branch is a bundle, not a GitHub branch
SSH="ssh -i $SSH_KEY -o StrictHostKeyChecking=accept-new -o BatchMode=yes -o ConnectTimeout=15 $TARGET"
DOCKER=docker; docker info >/dev/null 2>&1 || DOCKER="sudo docker"
MC="$DOCKER compose -p $PROJECT -f ../compose.yml -f docker-compose.yml --env-file .env exec -T api node tools/network-cert.cjs"
say() { printf '\n== %s\n' "$*"; }
die() { echo "spin.sh: $*" >&2; exit 1; }
json() { sed -n "s/.*\"$1\": *\"\([^\"]*\)\".*/\1/p" | head -n 1; }

cd "$MASTER_DIR"
[ -f .env ] || die "no master stack here ($MASTER_DIR/.env)"

say "the master"
ME=$($MC show)
printf '%s\n' "$ME" | grep -q '"role": "master"' || die "this installation is not a network master (role/key)"
MASTER_KEY_ID=$(printf '%s\n' "$ME" | json installation_key)
MASTER_HOST=$(sed -n 's/^SIT_HOST=//p' .env | head -n 1)
FP=$($MC fingerprint)
FINGERPRINT=$(printf '%s\n' "$FP" | json fingerprint)
[ -z "$WANT_FP" ] || [ "$WANT_FP" = "$FINGERPRINT" ] || die "the master's key fingerprint is $FINGERPRINT, not the $WANT_FP you were given"
PIN=$(printf '%s\n' "$FP" | json public_key)
HANDLE=$($MC next-handle "$SCOPE" | json handle)
[ -n "$HANDLE" ] || die "no root handle could be allocated for scope $SCOPE"
TOKEN=$(openssl rand -hex 24)
echo "master $MASTER_KEY_ID at $MASTER_HOST, key fingerprint $FINGERPRINT"
echo "new installation $KEY: root $HANDLE"

say "the target $TARGET"
$SSH 'mkdir -p ~/net && chmod 700 ~/net'
{
  echo "SPIN_ROLE='member'"
  echo "SPIN_KEY='$KEY'"
  echo "SPIN_KIT='$KIT'"
  echo "SPIN_HANDLE='$HANDLE'"
  echo "SPIN_HOST='$HOST'"
  echo "SPIN_PROJECT='$TARGET_PROJECT'"
  [ ! -f "$SEED_BUNDLE" ] || echo 'SPIN_SEED=$HOME/net/seed.bundle'
  echo "CB_INSTALLER_TOKEN='$TOKEN'"
  echo "API_REF='${SPIN_API_REF:-$(sed -n 's/^API_REF=//p' .env | head -n 1)}'"
  echo "GIT_TOKEN='$(sed -n 's/^GIT_TOKEN=//p' .env | head -n 1)'"
  echo "CB_MASTER_DOMAIN='$MASTER_HOST'"
  echo "CB_MASTER_INSTALLATION='$MASTER_KEY_ID'"
  printf "CB_MASTER_KEY='%s'\n" "$PIN"   # printf, not echo: dash's echo turns the PEM's literal \n into real newlines and breaks the .env
  echo "SPIN_MASTER_FINGERPRINT='$FINGERPRINT'"
} | $SSH 'umask 077; cat > ~/net/spin.env'
[ ! -f "$SEED_BUNDLE" ] || scp -q -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new -o BatchMode=yes "$SEED_BUNDLE" "$TARGET:net/seed.bundle"
$SSH 'cat > ~/net/install.sh' < "$HERE/install.sh"   # copied, then run with its own stdin: a command inside must not swallow the script
OUT=$($SSH 'sh ~/net/install.sh' < /dev/null | tee /dev/stderr | sed -n 's/^SPIN_RESULT //p' | tail -n 1)
[ -n "$OUT" ] || die "the target did not report a result"
ROOT_BRIDGE=$(printf '%s\n' "$OUT" | sed -n 's/.*"root_bridge_id":"\([^"]*\)".*/\1/p')

say "the master registers $KEY and issues its certificate"
$MC register "$KEY" "$HOST" ${COUNTRY:+--country "$COUNTRY"} --root-handle "$HANDLE" --root-bridge "$ROOT_BRIDGE" >/dev/null
$MC issue "$KEY" ${MINUTES:+--minutes "$MINUTES"}
$DOCKER compose -p "$PROJECT" -f ../compose.yml -f docker-compose.yml --env-file .env exec -T api node tools/network-sync.cjs master || true
$SSH "cd ~/net/chitbridge-api/deploy/sit && $DOCKER compose -p $TARGET_PROJECT -f ../compose.yml -f docker-compose.yml --env-file .env exec -T api node tools/network-sync.cjs member" || true
echo "SPIN_DONE $OUT"
