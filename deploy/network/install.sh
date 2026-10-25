#!/bin/sh
# deploy/network/install.sh - runs ON a ready VM (Docker and ports done): installs ONE installation of the network, seeds its root, pins the master and starts its pulls.
# Called by deploy/network/spin.sh over SSH, or by hand for the master's own first install. It reads ~/net/spin.env (written by the caller, mode 600; never in a diff):
#   SPIN_ROLE=member|master   SPIN_KEY=sit-au   SPIN_KIT=in|au|ae|root (the up.sh argument)   SPIN_HANDLE=cbau01-root   SPIN_HOST=129-225-90-80.sslip.io
#   CB_INSTALLER_TOKEN=<one-time>   API_REF=<branch>   GIT_TOKEN=<read-only>   SPIN_PROJECT=cbnet
#   member: CB_MASTER_DOMAIN  CB_MASTER_INSTALLATION  CB_MASTER_KEY (PEM, newlines as backslash-n)  SPIN_MASTER_FINGERPRINT (optional: refuse a different key)
#   master: nothing more (it makes its own CB_NETWORK_ROOT_KEY on first run; the key never leaves this VM's .env)
# What it does, in order: refuse a master key that does not match the fingerprint it was given -> put any OLD stack aside (stopped, volumes kept, listed in ~/net/KEPT.txt)
# -> clone the repos -> write .env (the pin, the installer token) -> deploy/sit/up.sh (the existing kit: Postgres, migrations, the stack) -> mark the installation member/master
# and pin the master as a peer -> make the root entity THROUGH THE REGISTER DOOR (tools/network-seed-root.cjs) -> PLATFORM_ROOT_ENTITY, token removed, api recreated -> cron for the pulls.
# Safe to run again. Prints one last line: SPIN_RESULT {json} (no secret).
set -eu

NET=$HOME/net
SPIN_ENV=$NET/spin.env
[ -f "$SPIN_ENV" ] || { echo "install.sh: $SPIN_ENV is missing" >&2; exit 1; }
set -a; . "$SPIN_ENV"; set +a
PROJECT=${SPIN_PROJECT:-cbnet}
say() { printf '\n== %s\n' "$*"; }
die() { echo "install.sh: $*" >&2; exit 1; }

DOCKER=docker
docker info >/dev/null 2>&1 || DOCKER="sudo docker"

# ---- 1. the master key must be the one the operator was told (the Grundfos case: "they run our script") -----------------------------------------
fingerprint_of() { printf '%s' "$(printf '%s' "$1" | sed 's/\\n/\n/g')" | sha256sum | cut -d' ' -f1; }
if [ "$SPIN_ROLE" = member ]; then
  GOT=$(fingerprint_of "$CB_MASTER_KEY")
  echo "master key fingerprint: $GOT"
  if [ -n "${SPIN_MASTER_FINGERPRINT:-}" ] && [ "$SPIN_MASTER_FINGERPRINT" != "$GOT" ]; then
    die "the master key does not match the fingerprint you were given ($SPIN_MASTER_FINGERPRINT). Nothing was installed."
  fi
fi

# ---- 2. an OLD stack on this VM is put aside, never deleted ------------------------------------------------------------------------------------
mkdir -p "$NET"
# any running compose project that is not the one being installed (chitbridge from the SIT kit, or an earlier spin under another name)
OLDP=$($DOCKER ps --format '{{.Label "com.docker.compose.project"}}' | sort -u | grep -vx "$PROJECT" | grep . || true)
for p in $OLDP; do
  say "stopping the old stack (project $p): containers and volumes are KEPT"
  # shellcheck disable=SC2046
  $DOCKER stop $($DOCKER ps -q --filter "label=com.docker.compose.project=$p") >/dev/null
done
{ echo "kept aside on $(date -u +%FT%TZ) (this script never removes a volume):"; $DOCKER volume ls --format '{{.Name}}' | grep -v "^${PROJECT}_" || true; ls -d "$HOME/sit" "$HOME"/net-*-kept 2>/dev/null || true; } >> "$NET/KEPT.txt"

# ---- 3. the api repo (the kit and this tooling live in it) ------------------------------------------------------------------------------------
API_DIR=$NET/chitbridge-api
git_auth() {
  if [ -n "${GIT_TOKEN:-}" ]; then
    auth=$(printf 'x-access-token:%s' "$GIT_TOKEN" | base64 | tr -d '\n')
    git -c "http.https://github.com/.extraheader=Authorization: Basic $auth" "$@"
  else
    git "$@"
  fi
}
REF=${API_REF:-main}
if [ -d "$API_DIR/.git" ]; then
  git_auth -C "$API_DIR" fetch -q origin "$REF"
  git -C "$API_DIR" checkout -q -B "$REF" "origin/$REF"
elif [ -n "${SPIN_SEED:-}" ] && [ -f "$SPIN_SEED" ]; then
  # a SIT-only branch (the kit + the rail fixes + this tooling) travels as a git bundle from the master, so it needs no branch on GitHub
  git clone -q --branch "$REF" "$SPIN_SEED" "$API_DIR"
else
  git_auth clone -q --branch "$REF" https://github.com/maharishia07/chitbridge-api.git "$API_DIR"
fi
SIT=$API_DIR/deploy/sit
ENVF=$SIT/.env
[ -f "$ENVF" ] || { cp "$SIT/.env.example" "$ENVF"; chmod 600 "$ENVF"; }
set_kv() { KV_K="$1" KV_V="$2" awk 'BEGIN{FS=OFS="="; k=ENVIRON["KV_K"]; v=ENVIRON["KV_V"]} $1==k{print k "=" v; f=1; next} {print} END{if(!f) print k "=" v}' "$ENVF" > "$ENVF.tmp"; mv "$ENVF.tmp" "$ENVF"; chmod 600 "$ENVF"; }
get_kv() { sed -n "s/^$1=//p" "$ENVF" | head -n 1; }

# ---- 4. .env: the pin, the installer token, the compose project (values are written as given; none is printed) -----------------------------------
say ".env for $SPIN_KEY ($SPIN_ROLE)"
set_kv SIT_PROJECT "$PROJECT"
set_kv GIT_TOKEN "${GIT_TOKEN:-}"
set_kv API_REF "$REF"
set_kv CB_INSTALLER_HANDLE "$SPIN_HANDLE"
[ -n "$(get_kv CB_INSTALLER_TOKEN)" ] || set_kv CB_INSTALLER_TOKEN "$CB_INSTALLER_TOKEN"
set_kv CB_ROOT_EMAIL "${SPIN_HANDLE}@example.org"
if [ "$SPIN_ROLE" = member ]; then
  set_kv CB_MASTER_DOMAIN "$CB_MASTER_DOMAIN"
  set_kv CB_MASTER_INSTALLATION "$CB_MASTER_INSTALLATION"
  set_kv CB_MASTER_KEY "$CB_MASTER_KEY"
else
  [ -n "$(get_kv CB_NETWORK_ROOT_KEY)" ] || set_kv CB_NETWORK_ROOT_KEY "$(openssl genpkey -algorithm ed25519 | awk 'NR>1{printf "\\n"} {printf "%s", $0}')"
fi

# ---- 5. the existing kit brings the stack up -----------------------------------------------------------------------------------------------
say "up.sh $SPIN_KIT (the existing SIT kit)"
export SIT_ROOT=$NET SIT_HOST_AS=$SPIN_HOST API_REF=$REF GIT_TOKEN="${GIT_TOKEN:-}"
sh "$SIT/up.sh" "$SPIN_KIT"
DC="$DOCKER compose -p $PROJECT -f ../compose.yml -f docker-compose.yml --env-file .env"
cd "$SIT"

# ---- 6. mark the installation (the role is DATA) and pin the master as a peer, BEFORE the root exists so the root is mirrored ---------------------
say "role: $SPIN_ROLE"
$DC exec -T db psql -X -q -U postgres -d chitbridge -v ON_ERROR_STOP=1 -v k="$SPIN_KEY" -v r="$SPIN_ROLE" -f - <<'SQL'
UPDATE installation SET network_role = :'r' WHERE installation_key = :'k' AND hosted_locally;
SQL
if [ "$SPIN_ROLE" = member ]; then
  $DC exec -T db psql -X -q -U postgres -d chitbridge -v ON_ERROR_STOP=1 -v k="$CB_MASTER_INSTALLATION" -v d="$CB_MASTER_DOMAIN" -v ep="https://$CB_MASTER_DOMAIN/api/ctp/deliver" -f - <<'SQL'
INSERT INTO installation (installation_key, label, purpose, cloud_provider, domain, vertical_key, hosted_locally, ctp_endpoint)
VALUES (:'k', 'network master', 'network-master', 'oracle', :'d', 'base', false, :'ep')
ON CONFLICT (installation_key) DO UPDATE SET domain = EXCLUDED.domain, ctp_endpoint = EXCLUDED.ctp_endpoint, hosted_locally = false, active = true;
SQL
fi
$DC restart api >/dev/null
i=0; until $DC exec -T api node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" >/dev/null 2>&1; do i=$((i+1)); [ "$i" -lt 40 ] || die "api did not come back"; sleep 3; done

# ---- 7. the root entity, through the ONE register door ------------------------------------------------------------------------------------------
say "root entity $SPIN_HANDLE"
RESULT=$($DC exec -T api node tools/network-seed-root.cjs | tail -n 1)
echo "$RESULT"
UUID=$(printf '%s' "$RESULT" | sed -n 's/.*"identity_id":"\([^"]*\)".*/\1/p')
BRIDGE=$(printf '%s' "$RESULT" | sed -n 's/.*"bridge_id":"\([^"]*\)".*/\1/p')
[ -n "$UUID" ] || die "the root was not made"
set_kv PLATFORM_ROOT_ENTITY "$UUID"
set_kv CB_INSTALLER_TOKEN ""      # the token is spent: out of .env too
set_kv CB_INSTALLER_HANDLE ""
sh "$SIT/up.sh" "$SPIN_KIT" >/dev/null

# ---- 8. the pulls (cron, every minute): a member fetches its certificate and the directory; the master reads its members ---------------------------
say "cron: network-sync every minute"
LINE="* * * * * cd $SIT && $DC exec -T api node tools/network-sync.cjs >> $NET/sync.log 2>&1"
( crontab -l 2>/dev/null | grep -v 'network-sync.cjs' || true; echo "$LINE" ) | crontab -
echo "SPIN_RESULT {\"installation_key\":\"$SPIN_KEY\",\"role\":\"$SPIN_ROLE\",\"root_handle\":\"$SPIN_HANDLE\",\"root_uuid\":\"$UUID\",\"root_bridge_id\":\"$BRIDGE\",\"host\":\"$SPIN_HOST\"}"
