# Google Cloud — spin · test · teardown (HX2)

`GCP_PROJECT=<project> bash deploy/gcp/spin.sh` → `test.sh` → `teardown.sh`, or the CI job `spin-test.yml` (platform `gcp`).
Region **asia-south1 (Mumbai)** by default (`GCP_REGION`). In the owner's project, labelled `cb-spin=<id>`: Cloud SQL Postgres 16 ·
a Cloud Storage bucket (read through the S3-compatible XML API with an HMAC key of a spin-only service account) · Artifact Registry ·
Cloud Run api / web / mail sink. The service account is named `cbspin-<id>-api`, display name `cb-spin <id>` (no labels on accounts).

## What the owner provides (GitHub › chitbridge-api › Settings › Secrets and variables › Actions)
| Secret | What |
|---|---|
| `GCP_SA_KEY` | a JSON key of a service account for spins, with roles: Cloud Run Admin, Cloud SQL Admin, Artifact Registry Admin, Storage Admin, Service Account Admin, Service Account User, HMAC Key Admin (`roles/storage.hmacKeyAdmin`), Service Usage Admin |
| `GCP_PROJECT` | a project used for spins only, with billing linked |
| `GCP_REGION` (variable, optional) | default `asia-south1` |
The CI job installs the gcloud `beta` component (labels on a Cloud SQL instance are a beta flag). Cloud Run's default service
account must be allowed to connect to Cloud SQL (it has Editor by default in a new project). An organisation policy that forbids
`allUsers` on Cloud Run (domain-restricted sharing) blocks the spin — use a project outside that policy.

## Cost of a test spin
≈ **$0.07 / hour ≈ $1.7 / day** (list prices, approximate): Cloud SQL db-f1-micro + 10 GB ≈ $0.015/h · Cloud Run api + sink kept at one
instance ≈ $0.05/h · Artifact Registry / Storage cents. A CI run ≈ 40–60 min ⇒ **≈ $0.07**. Instance creation takes 5–10 min.

## Limits (a TEST spin)
- Cloud SQL has a public IP whose authorized network is the runner's address only; Cloud Run reaches it through its own socket
  (`/cloudsql/<connection>`, the URL's `host=` parameter). db-f1-micro is shared-core: fine for a test, not for a shop.
- `postgres` on Cloud SQL is not a superuser (`cloudsqlsuperuser`): a migration that needs one is listed by the migrate job, not recorded.
- TLS + DNS = `*.run.app`. A custom domain (load balancer or domain mapping) is not scripted (CTP needs one, HX4).
