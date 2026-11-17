#!/usr/bin/env bash
# deploy/gcp/teardown.sh — DELETE EVERYTHING THE GOOGLE CLOUD SPIN MADE (HX2), found by its label cb-spin=<id> (Cloud Run services,
# the Cloud SQL instance, the Artifact Registry repository, the bucket). A service account has no labels: it is deleted only when its
# display name is "cb-spin <id>" — its HMAC keys first. Prints the cost estimate it ran up. The project and its enabled APIs stay.
# CB_SPIN_ID=<id> (and GCP_PROJECT) to tear down a spin whose state file is gone. PLAN=1 / PARSE=1 as spin.sh.
. "$(dirname "$0")/../spin-lib.sh"
spin_load gcp
GCP_REGION=${GCP_REGION:-asia-south1}; GCP_PROJECT=${GCP_PROJECT:-}; [ -n "$GCP_PROJECT" ] || { dry && GCP_PROJECT=plan-project; } || die "set GCP_PROJECT"
N="cbspin-$CB_SPIN_ID"; P=(--project "$GCP_PROJECT"); F="labels.cb-spin=$CB_SPIN_ID"
say "teardown of spin $CB_SPIN_ID ($GCP_PROJECT, $GCP_REGION)"
for s in $(out "$N-api $N-web $N-mailsink" gcloud run services list "${P[@]}" --region "$GCP_REGION" --filter "metadata.$F" --format 'value(metadata.name)'); do
  run gcloud run services delete "$s" "${P[@]}" --region "$GCP_REGION" --quiet; done
for i in $(out "$N" gcloud sql instances list "${P[@]}" --filter "settings.userLabels.cb-spin=$CB_SPIN_ID" --format 'value(name)'); do
  run gcloud sql instances delete "$i" "${P[@]}" --quiet; done
for r in $(out "$N" gcloud artifacts repositories list "${P[@]}" --location "$GCP_REGION" --filter "$F" --format 'value(name)'); do
  run gcloud artifacts repositories delete "${r##*/}" "${P[@]}" --location "$GCP_REGION" --quiet; done
for b in $(out "$N-attach" gcloud storage buckets list "${P[@]}" --filter "$F" --format 'value(name)'); do
  run gcloud storage rm --recursive "gs://$b" "${P[@]}"; done
SA="$N-api@$GCP_PROJECT.iam.gserviceaccount.com"
if [ "$(out "cb-spin $CB_SPIN_ID" gcloud iam service-accounts describe "$SA" "${P[@]}" --format 'value(displayName)' 2>/dev/null || true)" = "cb-spin $CB_SPIN_ID" ]; then
  for k in $(out GOOGPLAN gcloud storage hmac list "${P[@]}" --service-account "$SA" --format 'value(metadata.accessId)'); do
    run gcloud storage hmac update "$k" "${P[@]}" --deactivate; run gcloud storage hmac delete "$k" "${P[@]}"; done
  run gcloud iam service-accounts delete "$SA" "${P[@]}" --quiet
fi
spin_parse_done
# ≈ Cloud SQL db-f1-micro + 10 GB $0.015 · Cloud Run api min 1 + sink min 1 (idle) $0.05 · Artifact Registry / Storage ~0
spin_cost gcp 0.07 "Cloud SQL f1-micro · Cloud Run ×3 · Artifact Registry · Storage"
spin_forget gcp
say "spin $CB_SPIN_ID removed"
