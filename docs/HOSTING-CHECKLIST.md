# Deployment checklist per provider (PLT-23)

A checklist, not a spin: **nothing here is run and nothing is bought.** The spin scripts exist (`deploy/<platform>/spin.sh`) and are proved offline by `bash deploy/spin-check.sh` and `node tests/spin-scripts.test.cjs`; they run only when the owner's account exists. Sources: `docs/HOSTING.md` (the env contract, "Cloud spins" and "Going sealed" sections) and `docs/HOSTING-COUPLING.md` ("Per platform" table, line 222 on). This page adds the order of work and the count of what each platform asks of us.

## Coupling count per platform (cells of the Per-platform table, 11 concerns)
| Platform | Gap (red) | Platform-flavoured (yellow) | Portable (green) |
|---|---|---|---|
| AWS (ap-south-1, App Runner + RDS + S3) | 1 | 6 | 3 |
| Azure (centralindia, Container Apps + Flexible Server) | 2 | 5 | 3 |
| GCP (asia-south1, Cloud Run + Cloud SQL + GCS) | 1 | 5 | 4 |
| Railway (today; no India region) | 3 | 1 | 5 |

Counted from the table on 2026-10-19 by marks in each cell; a cell with two marks counts twice, so read the table for the reason. The red cells: migrations that need a superuser (AWS, Azure, GCP: listed by `tools/migrate.cjs`, not recorded); no native object store (Azure, Railway); logs not in India and a short window (Railway); backups not in India (Railway).

## The same eleven steps on every provider
1. **Account and region.** India region first (CERT-In logs and Companies Act backups must stay in India). Railway has none; that is the known gap.
2. **Postgres 16.** Note the admin role (not a superuser on RDS, Flexible Server, Cloud SQL) and where extensions are allowed (Azure: `azure.extensions`). Set `DATABASE_URL` (use `?sslmode=disable` only on a private network; `no-verify` for TLS without verification). Nothing in `db/` is Supabase-only after HX1.
3. **Migrations.** `node tools/migrate.cjs` twice. A migration that needs a superuser is listed, not recorded: run it by hand with the admin role, then re-run.
4. **Object store.** AWS: S3 with SigV4, `S3_PATH_STYLE=false`, a static IAM key. GCP: `S3_ENDPOINT=https://storage.googleapis.com`, `S3_REGION=auto`, an HMAC key. Azure and Railway have no S3 API: set `STORAGE_ADAPTER=db` (attachments in Postgres) or point `S3_ENDPOINT` at an outside S3 such as R2.
5. **The two images.** Build the api `Dockerfile` and the web `Dockerfile` once; push to ECR, ACR or Artifact Registry (Railway builds from source).
6. **One instance.** The nightly timers run inside the process (`server.js:479-481`): keep the api at ONE instance (Cloud Run `--min-instances`, App Runner min 1), or move them to the provider's scheduler (debt, not done). The bell (SSE) also lives in process memory.
7. **Secrets.** Every name is in `docs/HOSTING.md`; `JWT_SECRET` at least 32 characters. Plain env on App Runner, Container Apps and Cloud Run; the native secret stores are a later step.
8. **Web config.** One runtime config (`public/config.js`) names the api; no host literal in code. See `docs/HOSTING.md` "web".
9. **Mail.** `RESEND_API_KEY` and `FROM_EMAIL`; the same everywhere. Sealed env needs `OTP_EMAIL_ENABLED` (see "Going sealed").
10. **TLS and DNS.** The provider's own name works at once (`*.awsapprunner.com`, `*.azurecontainerapps.io`, `*.run.app`); a custom domain is not scripted on any of them.
11. **Logs and backups.** Raise log retention to 180 days in India (CloudWatch default never expires; Log Analytics 30 d; Cloud Logging `_Default` 30 d and global, so make a regional bucket). Automated DB backups in region on RDS, Flexible Server and Cloud SQL (turn them on; the test spin turns them off). `deploy/backup.sh` is the encrypted nightly.

## Teardown handle (so a trial can be removed)
AWS tag `cb-spin=<id>` · Azure the tagged resource group · GCP labels and the service account display name · Railway the project name. `teardown.sh` deletes what carries the tag and prints the cost.

## Not proved (needs the owner's accounts, and money)
Quotas and org policies; a migration a non-superuser cannot run; the Railway CLI flags; custom domains; log shipping out of Railway. TB-RAIL-10 reuses this page.
