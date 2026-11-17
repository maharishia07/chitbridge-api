#!/usr/bin/env bash
# deploy/gcp/spin.sh — ONE ISOLATED CHITBRIDGE ON GOOGLE CLOUD, Mumbai (asia-south1) by default (HX2). Plain bash + gcloud.
#   in the owner's project GCP_PROJECT, every resource labelled cb-spin=<id>: Cloud SQL Postgres 16 (db-f1-micro, TLS only; outside
#   access = this runner only — Cloud Run reaches it through its own socket) · a Cloud Storage bucket (private) read through the S3-
#   compatible XML API with an HMAC key of a spin-only service account (SigV4) · Artifact Registry (the three images) · Cloud Run:
#   api (:3000), web (the nginx image, :8080), mail sink (:8025, one instance) — each on https://<service>-<hash>.a.run.app (TLS by Google).
#   GCP_PROJECT=<project> bash deploy/gcp/spin.sh      PLAN=1 … (print every command)   PARSE=1 … (the CLI checks every command, no account)
# Needs: gcloud authenticated (README: a service account key), docker, node, openssl. Then: deploy/gcp/test.sh · deploy/gcp/teardown.sh.
. "$(dirname "$0")/../spin-lib.sh"
GCP_REGION=${GCP_REGION:-asia-south1}
GCP_PROJECT=${GCP_PROJECT:-}; [ -n "$GCP_PROJECT" ] || { dry && GCP_PROJECT=plan-project; } || die "set GCP_PROJECT (the project the spin lives in)"
spin_new gcp
N="cbspin-$CB_SPIN_ID"; P=(--project "$GCP_PROJECT"); LBL="cb-spin=$CB_SPIN_ID"
spin_save gcp GCP_REGION GCP_PROJECT    # recorded first: a spin that fails half-way is still found by teardown

run gcloud services enable run.googleapis.com sqladmin.googleapis.com artifactregistry.googleapis.com storage.googleapis.com iam.googleapis.com "${P[@]}"

say "images → Artifact Registry"
spin_build_images
run gcloud artifacts repositories create "$N" "${P[@]}" --repository-format docker --location "$GCP_REGION" --labels "$LBL"
run gcloud auth configure-docker "$GCP_REGION-docker.pkg.dev" --quiet
REG="$GCP_REGION-docker.pkg.dev/$GCP_PROJECT/$N"; spin_push "$REG/cb"

say "database: Cloud SQL Postgres 16 (TLS only; from outside Google: this runner only)"
# labels on a Cloud SQL instance are a beta flag (the gcloud `beta` component)
run gcloud beta sql instances create "$N" "${P[@]}" --region "$GCP_REGION" --database-version POSTGRES_16 --edition enterprise --tier db-f1-micro \
  --root-password "$POSTGRES_PASSWORD" --authorized-networks "$(runner_ip)/32" --ssl-mode ENCRYPTED_ONLY --no-backup --labels "$LBL"
run gcloud sql databases create "$SPIN_DB" --instance "$N" "${P[@]}"
HOST=$(out 198.51.100.9 gcloud sql instances describe "$N" "${P[@]}" --format 'value(ipAddresses[0].ipAddress)')
CONN="$GCP_PROJECT:$GCP_REGION:$N"
OWNER_URL="postgres://postgres:$POSTGRES_PASSWORD@$HOST:5432/$SPIN_DB?sslmode=no-verify"
# Cloud Run → Cloud SQL over the socket Cloud Run mounts at /cloudsql/<connection> (encrypted by the connector, so no TLS on it)
DATABASE_URL="postgres://cb_app:$CB_APP_PASSWORD@localhost/$SPIN_DB?host=/cloudsql/$CONN&sslmode=disable"
say "schema (the ledger chain, then cb_app's password)"; spin_migrate "$OWNER_URL"

say "object store: a private bucket + a spin-only service account's HMAC key (S3 XML API, SigV4)"
S3_BUCKET="$N-attach"; S3_ENDPOINT="https://storage.googleapis.com"; S3_REGION=auto; S3_PATH_STYLE=true
SA="$N-api@$GCP_PROJECT.iam.gserviceaccount.com"
run gcloud storage buckets create "gs://$S3_BUCKET" "${P[@]}" --location "$GCP_REGION" --uniform-bucket-level-access --public-access-prevention
run gcloud storage buckets update "gs://$S3_BUCKET" "${P[@]}" --update-labels "$LBL"
run gcloud iam service-accounts create "$N-api" "${P[@]}" --display-name "cb-spin $CB_SPIN_ID"
run gcloud storage buckets add-iam-policy-binding "gs://$S3_BUCKET" "${P[@]}" --member "serviceAccount:$SA" --role roles/storage.objectUser
read -r S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY <<<"$(out 'GOOGPLAN plan-secret' gcloud storage hmac create "$SA" "${P[@]}" --format 'value(metadata.accessId,secret)')"

say "Cloud Run: mail sink → api → web, then the api learns the web's address"
# deploy <name> <port> <cpu> <memory> <min> <max> [more flags…] — env on stdin (NAME=VALUE lines → a YAML file, so no value is split)
deploy() {
  local f; f=$(mktemp); chmod 600 "$f"
  node -e 'require("fs").readFileSync(0,"utf8").split("\n").filter(Boolean).forEach((l)=>{const i=l.indexOf("=");console.log(l.slice(0,i)+": "+JSON.stringify(l.slice(i+1)));})' > "$f"
  local n=$1 port=$2 cpu=$3 mem=$4 min=$5 max=$6; shift 6
  out "https://$N-$n-plan.a.run.app" gcloud run deploy "$N-$n" "${P[@]}" --region "$GCP_REGION" --image "$REG/cb-$n:$CB_SPIN_ID" --port "$port" \
    --cpu "$cpu" --memory "$mem" --min-instances "$min" --max-instances "$max" --allow-unauthenticated --env-vars-file "$f" --labels "$LBL" \
    "$@" --quiet --format 'value(status.url)'
  rm -f "$f"
}
MAIL_URL=$(spin_sink_env | deploy mailsink 8025 1 512Mi 1 1 --no-cpu-throttling)
WEB_URL=""; API_URL=""   # the api starts before the web exists: its origin is set by the update below
API_URL=$(spin_api_env | deploy api 3000 1 1Gi 1 2 --add-cloudsql-instances "$CONN")
WEB_URL=$(printf 'CB_API_BASE=%s\n' "$API_URL" | deploy web 8080 1 512Mi 0 2)
spin_save gcp GCP_REGION GCP_PROJECT OWNER_URL DATABASE_URL API_URL WEB_URL MAIL_URL S3_BUCKET S3_ENDPOINT S3_REGION S3_PATH_STYLE S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY
run gcloud run services update "$N-api" "${P[@]}" --region "$GCP_REGION" --update-env-vars "ALLOWED_ORIGINS=$WEB_URL,PUBLIC_WEB_BASE=$WEB_URL,PUBLIC_API_BASE=$API_URL" --quiet
spin_wait_http "$API_URL/health" "api"; spin_wait_http "$WEB_URL/" "web"; spin_wait_http "$MAIL_URL/last" "mail sink"
spin_parse_done
say "up: web $WEB_URL · api $API_URL · state deploy/.spin/gcp.env — next: bash deploy/gcp/test.sh"
