#!/usr/bin/env bash
# deploy/azure/spin.sh — ONE ISOLATED CHITBRIDGE ON AZURE, Central India (Pune) by default (HX2). Plain bash + the az CLI.
#   everything in ONE resource group cbspin-<id> (tagged cb-spin=<id>): Postgres Flexible Server 16 (Burstable B1ms; firewall = Azure
#   services + this runner) · Container Registry (Basic) · a Container Apps environment (+ its Log Analytics workspace) with api (:3000),
#   web (the nginx image, :8080), mail sink (:8025) — each on https://<app>.<env>.centralindia.azurecontainerapps.io (TLS by Azure).
#   Object store: none native — Azure Blob does not speak the S3 API (docs/HOSTING-COUPLING.md); attachments stay in Postgres
#   (STORAGE_ADAPTER=db) unless S3_ENDPOINT/S3_BUCKET/S3_REGION/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY name an S3-compatible store (e.g. R2).
#   bash deploy/azure/spin.sh        PLAN=1 … (print every command)   PARSE=1 … (the CLI checks every command, no account)
# Needs: `az login` done (README: a service principal), docker, node, openssl. Then: deploy/azure/test.sh · deploy/azure/teardown.sh.
. "$(dirname "$0")/../spin-lib.sh"
AZURE_LOCATION=${AZURE_LOCATION:-centralindia}
spin_new azure
N="cbspin-$CB_SPIN_ID"; G="$N"; ACR="cbspin$CB_SPIN_ID"; TAG="cb-spin=$CB_SPIN_ID"
spin_save azure AZURE_LOCATION    # recorded first: a spin that fails half-way is still found by teardown

run az group create -n "$G" -l "$AZURE_LOCATION" --tags "$TAG" --query properties.provisioningState -o tsv

say "images → Container Registry"
spin_build_images
run az acr create -g "$G" -n "$ACR" --sku Basic --admin-enabled true --tags "$TAG" --query loginServer -o tsv
run az acr login -n "$ACR"
REG="$ACR.azurecr.io"; spin_push "$REG/cb"
ACR_PASSWORD=$(out plan-acr-pw az acr credential show -g "$G" -n "$ACR" --query 'passwords[0].value' -o tsv)
SPIN_SECRETS+=(ACR_PASSWORD)

say "database: Postgres Flexible Server 16 (TLS required; Azure services + this runner only)"
run az postgres flexible-server create -g "$G" -n "$N" -l "$AZURE_LOCATION" --tier Burstable --sku-name Standard_B1ms --storage-size 32 \
  --version 16 --admin-user cbowner --admin-password "$POSTGRES_PASSWORD" --public-access 0.0.0.0 \
  --backup-retention 7 --tags "$TAG" --yes --query host -o tsv
run az postgres flexible-server db create -g "$G" --server-name "$N" --name "$SPIN_DB"
run az postgres flexible-server firewall-rule create -g "$G" --server-name "$N" --name runner --start-ip-address "$(runner_ip)" --end-ip-address "$(runner_ip)"
# the extensions the schema creates (000_baseline: pgcrypto, ltree; b121: pg_trgm) must be allow-listed on Azure first
run az postgres flexible-server parameter set -g "$G" --server-name "$N" --name azure.extensions --value PGCRYPTO,LTREE,PG_TRGM
HOST="$N.postgres.database.azure.com"
OWNER_URL="postgres://cbowner:$POSTGRES_PASSWORD@$HOST:5432/$SPIN_DB?sslmode=no-verify"
DATABASE_URL="postgres://cb_app:$CB_APP_PASSWORD@$HOST:5432/$SPIN_DB?sslmode=no-verify"
say "schema (the ledger chain, then cb_app's password)"; spin_migrate "$OWNER_URL"

say "Container Apps: mail sink → api → web, then the api learns the web's address"
run az containerapp env create -g "$G" -n "$N" -l "$AZURE_LOCATION" --tags "$TAG" --query properties.provisioningState -o tsv
# app <name> <port> <cpu> <memory> — creates the app (one replica: the sink keeps its mail in memory), prints its https URL (env on stdin)
app() {
  local env=(); mapfile -t env
  printf 'https://%s' "$(out "$N-$1.plan.$AZURE_LOCATION.azurecontainerapps.io" az containerapp create -g "$G" -n "$N-$1" --environment "$N" \
    --image "$REG/cb-$1:$CB_SPIN_ID" --registry-server "$REG" --registry-username "$ACR" --registry-password "$ACR_PASSWORD" \
    --target-port "$2" --ingress external --cpu "$3" --memory "$4" --min-replicas 1 --max-replicas 1 --env-vars "${env[@]}" --tags "$TAG" \
    --query properties.configuration.ingress.fqdn -o tsv)"
}
MAIL_URL=$(spin_sink_env | app mailsink 8025 0.25 0.5Gi)
WEB_URL=""; API_URL=""   # the api starts before the web exists: its origin is set by the update below
API_URL=$(spin_api_env | app api 3000 0.5 1Gi)
WEB_URL=$(printf 'CB_API_BASE=%s\n' "$API_URL" | app web 8080 0.25 0.5Gi)
spin_save azure AZURE_LOCATION OWNER_URL DATABASE_URL API_URL WEB_URL MAIL_URL S3_BUCKET S3_ENDPOINT S3_REGION S3_PATH_STYLE S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY
run az containerapp update -g "$G" -n "$N-api" --set-env-vars "ALLOWED_ORIGINS=$WEB_URL" "PUBLIC_WEB_BASE=$WEB_URL" "PUBLIC_API_BASE=$API_URL" --query properties.provisioningState -o tsv
spin_wait_http "$API_URL/health" "api"; spin_wait_http "$WEB_URL/" "web"; spin_wait_http "$MAIL_URL/last" "mail sink"
spin_parse_done
say "up: web $WEB_URL · api $API_URL · state deploy/.spin/azure.env — next: bash deploy/azure/test.sh"
