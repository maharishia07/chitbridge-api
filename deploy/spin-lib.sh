#!/usr/bin/env bash
# deploy/spin-lib.sh — WHAT EVERY PLATFORM'S spin.sh / test.sh / teardown.sh SHARES (HX2). Sourced, never run.
#   · one spin = one id (`CB_SPIN_ID`, s + 7 hex) · every resource is named cbspin-<id>… and tagged/labelled cb-spin=<id>
#   · the state of a spin (its URLs and secrets) lives in deploy/.spin/<platform>.env (git-ignored, mode 600) — test and teardown read it
#   · the api's environment is written ONCE, here (spin_api_env), from docs/HOSTING.md's names — tests/spin-scripts.test.cjs holds that
#   · three modes for every cloud command (`run` / `out`):
#       default   run it
#       PLAN=1    print it (secrets masked) and run nothing — the plan a reviewer reads
#       PARSE=1   run it with an EMPTY credential config: aws/az/gcloud parse every flag before they look for credentials, so
#                 "no credentials" = the command is well-formed, anything else = a broken command. Nothing can reach an account.
set -euo pipefail
SPIN_API_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SPIN_WEB_DIR=${CB_WEB_DIR:-$(cd "$SPIN_API_DIR/.." && pwd)/chitbridge-web}
SPIN_STATE_DIR="$SPIN_API_DIR/deploy/.spin"
SPIN_SECRETS=(POSTGRES_PASSWORD CB_APP_PASSWORD JWT_SECRET MAIL_TOKEN CTP_PRIVATE_KEY S3_SECRET_ACCESS_KEY)
SPIN_PARSE_LOG=$(mktemp)   # parse failures are counted in a file: `out` runs commands inside $( ), where a variable would be lost
trap 'rm -f "$SPIN_PARSE_LOG"' EXIT

say() { printf '· %s\n' "$*"; }
die() { printf '✗ %s\n' "$*" >&2; exit 1; }
dry() { [ -n "${PLAN:-}${PARSE:-}" ]; }

# mask every secret value of this spin in a line
mask() {
  local s="$*" v n; for n in "${SPIN_SECRETS[@]}"; do v="${!n:-}"; [ ${#v} -ge 8 ] && s="${s//"$v"/***}"; done
  printf '%s' "$s" | sed -E 's/-----BEGIN PRIVATE KEY-----[^-]*-----END PRIVATE KEY-----/***/g'   # the PEM however it was escaped
}

# run <cmd…> — see the modes above
run() {
  if [ -n "${PLAN:-}" ]; then printf '  $ %s\n' "$(mask "$*")"; return 0; fi
  if [ -n "${PARSE:-}" ]; then spin_parse "$@"; return 0; fi
  "$@"
}
# out <placeholder> <cmd…> — run and print its stdout (a URL, an id); in PLAN/PARSE the placeholder stands in
out() { local ph=$1; shift; if dry; then run "$@" >&2; printf '%s' "$ph"; else "$@"; fi; }

spin_parse() {
  # only a cloud CLI's call is parsed; anything else (docker, node, a local login helper) is NOT run in this mode
  case "$1 ${2:-} ${3:-}" in
    "gcloud auth configure-docker") printf '  skip %s (local: writes the docker config)\n' "$*"; return 0 ;;
    aws\ *|az\ *|gcloud\ *) ;;
    *) printf '  skip %s (not a cloud CLI: nothing to parse)\n' "$1"; return 0 ;;
  esac
  local t o; t=$(mktemp -d)
  o=$(env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u AWS_SESSION_TOKEN -u AWS_PROFILE AWS_SHARED_CREDENTIALS_FILE="$t/none" \
      AWS_CONFIG_FILE="$t/none" AWS_EC2_METADATA_DISABLED=true AZURE_CONFIG_DIR="$t/az" CLOUDSDK_CONFIG="$t/gcloud" \
      CLOUDSDK_CORE_DISABLE_PROMPTS=1 timeout 120 "$@" 2>&1 </dev/null || true)
  rm -rf "$t"
  if printf '%s' "$o" | grep -qE "Unable to locate credentials|NoCredentials|Please run 'az login'|az login|You do not currently have an active account|gcloud auth login|gcloud config set account|NoActiveAccountException"; then
    printf '  ok   %s\n' "$(mask "${*:1:4}")"
  else
    echo x >> "$SPIN_PARSE_LOG"; printf '  FAIL %s\n%s\n' "$(mask "$*")" "$(printf '%s' "$o" | tail -4 | sed 's/^/       /')"
  fi
}
spin_parse_done() {
  [ -z "${PARSE:-}" ] && return 0; local n; n=$(wc -l < "$SPIN_PARSE_LOG")
  if [ "$n" = 0 ]; then say "parse: every command well-formed"; else die "parse: $n command(s) rejected by the CLI"; fi
}

# ── a spin's identity and state ─────────────────────────────────────────────────────────────────────────────────
spin_state_file() { printf '%s/%s.env' "$SPIN_STATE_DIR" "$1"; }
# spin_new <platform> — a fresh id and fresh secrets; refuses when a spin of this platform is still recorded
spin_new() {
  local f; f=$(spin_state_file "$1")
  [ -f "$f" ] && ! dry && die "a $1 spin is still recorded in $f — run deploy/$1/teardown.sh first"
  CB_SPIN_ID=${CB_SPIN_ID:-s$(openssl rand -hex 4 | cut -c1-7)}
  [[ "$CB_SPIN_ID" =~ ^[a-z][a-z0-9]{5,15}$ ]] || die "CB_SPIN_ID must be a lowercase letter then 5-15 letters/digits"
  POSTGRES_PASSWORD=$(openssl rand -hex 24); CB_APP_PASSWORD=$(openssl rand -hex 24); JWT_SECRET=$(openssl rand -hex 32)
  MAIL_TOKEN=re_spin$(openssl rand -hex 20)
  CTP_PRIVATE_KEY=$(openssl genpkey -algorithm ed25519 2>/dev/null | awk 'BEGIN{ORS="\\n"} {print}')
  SPIN_DB="cbspin_$CB_SPIN_ID"; SPIN_AT=$(date -u +%s)
  SPIN_COMMIT=$(git -C "$SPIN_API_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)
  say "spin $CB_SPIN_ID ($1) — every resource is named cbspin-$CB_SPIN_ID… and tagged cb-spin=$CB_SPIN_ID"
}
# spin_save <platform> NAME… — write those variables (and the identity) into the state file
spin_save() {
  local p=$1 f n; shift; dry && return 0
  f=$(spin_state_file "$p"); mkdir -p "$SPIN_STATE_DIR"; umask 077
  { for n in CB_SPIN_ID SPIN_AT SPIN_DB SPIN_COMMIT POSTGRES_PASSWORD CB_APP_PASSWORD JWT_SECRET MAIL_TOKEN CTP_PRIVATE_KEY "$@"; do
      printf '%s=%q\n' "$n" "${!n:-}"; done; } > "$f"
}
spin_load() {
  local f; f=$(spin_state_file "$1")
  if [ -f "$f" ]; then # shellcheck disable=SC1090
    . "$f"; elif dry; then CB_SPIN_ID=${CB_SPIN_ID:-splan00}; SPIN_AT=$(date -u +%s); SPIN_DB="cbspin_$CB_SPIN_ID"; MAIL_TOKEN=re_spinplan
    CB_APP_PASSWORD=plan-pw; OWNER_URL="postgres://owner:***@db.plan:5432/$SPIN_DB?sslmode=no-verify"; API_URL=https://api.plan WEB_URL=https://web.plan MAIL_URL=https://mail.plan
  elif [ -z "${CB_SPIN_ID:-}" ]; then die "no $1 spin recorded ($f) — set CB_SPIN_ID to the spin to act on"; fi
}
spin_forget() { dry || rm -f "$(spin_state_file "$1")"; }

# runner_ip — the address the cloud sees this runner as (the database firewall lets ONLY it in from outside the platform)
runner_ip() { if dry; then printf '203.0.113.7'; else curl -fsS https://checkip.amazonaws.com | tr -d '[:space:]'; fi; }

# ── the api's environment: ONE list, from docs/HOSTING.md (needs DATABASE_URL API_URL WEB_URL MAIL_URL, S3_* when a store exists) ──
spin_api_env() {
  printf '%s\n' "NODE_ENV=production" "DATABASE_URL=$DATABASE_URL" "JWT_SECRET=$JWT_SECRET" "OTP_EMAIL_ENABLED=true" \
    "RESEND_API_KEY=$MAIL_TOKEN" "RESEND_BASE_URL=$MAIL_URL" "FROM_EMAIL=noreply@$CB_SPIN_ID.spin.example" \
    "ALLOWED_ORIGINS=$WEB_URL" "PUBLIC_WEB_BASE=$WEB_URL" "PUBLIC_API_BASE=$API_URL" \
    "INSTALLATION_KEY=cbspin-$CB_SPIN_ID" "CTP_PRIVATE_KEY=$CTP_PRIVATE_KEY" "SOURCE_COMMIT=$SPIN_COMMIT"
  if [ -n "${S3_ENDPOINT:-}" ]; then
    printf '%s\n' "STORAGE_ADAPTER=object" "S3_ENDPOINT=$S3_ENDPOINT" "S3_BUCKET=$S3_BUCKET" "S3_REGION=$S3_REGION" \
      "S3_PATH_STYLE=${S3_PATH_STYLE:-true}" "S3_ACCESS_KEY_ID=$S3_ACCESS_KEY_ID" "S3_SECRET_ACCESS_KEY=$S3_SECRET_ACCESS_KEY"
  else printf '%s\n' "STORAGE_ADAPTER=db"; fi
}
# the mail sink's own environment (deploy/mail-sink.cjs): it answers only to this spin's token
spin_sink_env() { printf '%s\n' "MAIL_SINK_TOKEN=$MAIL_TOKEN"; }

# ── images (built here, pushed by the platform script) ───────────────────────────────────────────────────────────
spin_build_images() {
  run docker build -q --target api -t chitbridge-api "$SPIN_API_DIR"
  run docker build -q --target migrate -t chitbridge-migrate "$SPIN_API_DIR"
  run docker build -q -t chitbridge-web "$SPIN_WEB_DIR"
  # the sink's context is its two files only (never deploy/.env): a tar on stdin
  if dry; then run docker build -q -t chitbridge-mailsink -f mail-sink.Dockerfile -
  else tar -C "$SPIN_API_DIR/deploy" -c mail-sink.cjs mail-sink.Dockerfile | docker build -q -t chitbridge-mailsink -f mail-sink.Dockerfile -; fi
}
# spin_push <registry/prefix> — tag and push the three run-time images as <prefix>-api / -web / -mailsink:<id>
spin_push() { local i; for i in api web mailsink; do run docker tag "chitbridge-$i" "$1-$i:$CB_SPIN_ID"; run docker push -q "$1-$i:$CB_SPIN_ID"; done; }

# spin_migrate <owner url> — the ledger chain (tools/migrate.cjs in the migrate image), then cb_app's password: the same two steps as
# deploy/compose.yml's migrate job. Run twice, the second run does nothing (the ledger) — test.sh shows it.
spin_migrate() {
  dry || docker image inspect chitbridge-migrate >/dev/null 2>&1 || docker build -q --target migrate -t chitbridge-migrate "$SPIN_API_DIR" >/dev/null
  run docker run --rm -e DATABASE_URL="$1" -e CB_APP_PASSWORD="$CB_APP_PASSWORD" --entrypoint sh chitbridge-migrate -c \
    'node tools/migrate.cjs --db "$DATABASE_URL" && echo "ALTER ROLE cb_app PASSWORD :'"'"'pw'"'"';" | psql -X -q -v ON_ERROR_STOP=1 -v pw="$CB_APP_PASSWORD" -d "$DATABASE_URL" && echo "migrate: cb_app can sign in"'
}

# spin_wait_http <url> <what> — until it answers at all (any HTTP status: the sink says 401 without its token), 10 min
spin_wait_http() {
  dry && return 0; local i c
  for i in $(seq 1 120); do c=$(curl -sS -o /dev/null -w '%{http_code}' "$1" 2>/dev/null || true); [ "${c:-000}" != 000 ] && { say "$2 answers ($c)"; return 0; }; sleep 5; done
  die "$2 did not answer at $1"
}

# spin_cost <platform> <usd per hour> <what it covers> — the estimate teardown prints (list prices, approximate)
spin_cost() {
  local h; h=$(awk -v a="${SPIN_AT:-0}" -v b="$(date -u +%s)" 'BEGIN{printf "%.2f", (b-a)/3600}')
  awk -v h="$h" -v r="$2" -v p="$1" -v w="$3" 'BEGIN{printf "· cost: %s spin up %.2f h × ~$%.3f/h ≈ $%.2f (%s; list prices, approximate — the bill is the truth)\n", p, h, r, h*r, w}'
}
