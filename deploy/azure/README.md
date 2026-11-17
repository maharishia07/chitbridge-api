# Azure — spin · test · teardown (HX2)

`bash deploy/azure/spin.sh` → `bash deploy/azure/test.sh` → `bash deploy/azure/teardown.sh`, or the CI job `spin-test.yml` (platform `azure`).
Region **centralindia (Pune)** by default (`AZURE_LOCATION`). Everything lives in ONE resource group `cbspin-<id>` tagged `cb-spin=<id>`:
Postgres Flexible Server 16 · Container Registry (Basic) · Container Apps environment (+ the Log Analytics workspace Azure makes for it)
with api / web / mail sink. Teardown deletes that group, only when its tag names the spin.

## What the owner provides (GitHub › chitbridge-api › Settings › Secrets and variables › Actions)
| Secret | What |
|---|---|
| `AZURE_CREDENTIALS` | a service principal as JSON (`az ad sp create-for-rbac --name cb-spins --role Contributor --scopes /subscriptions/<sub> --json-auth`), in a subscription used for spins only |
| `AZURE_SUBSCRIPTION_ID` | that subscription |
| `AZURE_LOCATION` (variable, optional) | default `centralindia` |
The subscription must have the providers registered once: `Microsoft.App`, `Microsoft.OperationalInsights`, `Microsoft.ContainerRegistry`,
`Microsoft.DBforPostgreSQL` (`az provider register -n <ns>`), and quota for Burstable B1ms in Central India.

## Cost of a test spin
≈ **$0.14 / hour ≈ $3.4 / day** (list prices, approximate): Postgres B1ms + 32 GB ≈ $0.03/h · Container Apps 1 vCPU / 2 GiB in all, always on
≈ $0.10/h · ACR Basic ≈ $0.007/h. A CI run ≈ 40–60 min ⇒ **≈ $0.15**. Server creation takes 5–10 min.

## Limits (a TEST spin)
- **No object store**: Azure Blob does not speak the S3 API that `lib/storage-object.js` signs — attachments stay in Postgres
  (`STORAGE_ADAPTER=db`). Set `S3_*` (e.g. Cloudflare R2) before `spin.sh` to use an external one. Native Blob = a new transport (debt).
- Postgres firewall: "Azure services" (every Azure tenant's addresses, not only ours) + the runner's IP; TLS required. Production: VNet integration + private access.
- The schema's extensions must be allow-listed (`azure.extensions=PGCRYPTO,LTREE,PG_TRGM`, set by spin.sh). The admin (`cbowner`) is not a superuser:
  a migration that needs one is listed by the migrate job (not recorded) — read its output.
- TLS + DNS = `*.azurecontainerapps.io`. A custom domain + managed certificate is not scripted (CTP needs one, HX4).
