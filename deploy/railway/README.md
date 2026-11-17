# Railway — spin · test · teardown (HX2) — the reference platform

`bash deploy/railway/spin.sh` → `test.sh` → `teardown.sh`, or the CI job `spin-test.yml` (platform `railway`). Production's api runs on
Railway today; this makes a SEPARATE project `cbspin-<id>` (a Railway project has no tags: its name is the tag) with Railway Postgres,
api, web and the mail sink, each built by Railway from its Dockerfile, each on `*.up.railway.app`. Teardown deletes the project only
when Railway says it is named `cbspin-<id>` (GraphQL API — the CLI's delete is interactive).

## What the owner provides (GitHub › chitbridge-api › Settings › Secrets and variables › Actions)
| Secret | What |
|---|---|
| `RAILWAY_API_TOKEN` | an **account** token (railway.com › Account Settings › Tokens) — a project token cannot create projects |
| `RAILWAY_WORKSPACE` (variable, optional) | the workspace (team) the spin goes into; default = the token's personal one |
The CI job installs the CLI with `npm i -g @railway/cli` (v4).

## Cost of a test spin
Usage pricing: ≈ **$0.02 / hour ≈ $0.5 / day** for four small idle services (≈1 GB RAM + a little CPU in all), on top of the plan's monthly
fee. A CI run ≈ **$0.02**.

## Limits
- ⚠️ **No India region** — Railway's nearest is asia-southeast1 (Singapore), and the CLI cannot choose a region: the project takes the
  workspace default. Indian shops' data (CERT-In logs, Companies Act backups) must not live on this spin.
- **No object store**: attachments stay in Postgres (`STORAGE_ADAPTER=db`) unless `S3_*` name an S3-compatible store.
- The database is reached by the runner through Railway's public TCP proxy (TLS, not verified); the api uses the private network
  (`postgres.railway.internal`). Railway's CLI has no offline check: this platform is proved by `PLAN=1` + shellcheck only.
