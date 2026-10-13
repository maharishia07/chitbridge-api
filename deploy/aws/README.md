# AWS — spin · test · teardown (HX2)

`bash deploy/aws/spin.sh` → `bash deploy/aws/test.sh` → `bash deploy/aws/teardown.sh`, or the CI job `spin-test.yml` (platform `aws`).
Region **ap-south-1 (Mumbai)** by default (`AWS_REGION` to change). What it makes, all named `cbspin-<id>…` and tagged `cb-spin=<id>`:
RDS Postgres 16 · S3 bucket + an IAM user whose key pair the api signs with · ECR ×3 · App Runner api / web / mail sink · an IAM role
for App Runner to pull from ECR · a security group. Config = `deploy/spin-lib.sh` `spin_api_env` (names from `docs/HOSTING.md`).

## What the owner provides (GitHub › chitbridge-api › Settings › Secrets and variables › Actions)
| Secret | What |
|---|---|
| `AWS_ACCESS_KEY_ID` · `AWS_SECRET_ACCESS_KEY` | an IAM user for spins only, in an account (or AWS Organizations member) used for nothing else. Policy: `AmazonRDSFullAccess`, `AmazonS3FullAccess`, `AmazonEC2ContainerRegistryFullAccess`, `AWSAppRunnerFullAccess`, `AmazonEC2FullAccess` (security groups), `IAMFullAccess` (the spin's user/role), `ResourceGroupsandTagEditorReadOnlyAccess` (teardown's tag search). Tighter: limit `iam:*` to `arn:aws:iam::<acct>:user/cbspin-*` and `role/cbspin-*`. |
| `AWS_REGION` (variable, optional) | default `ap-south-1` |
App Runner must be offered in the region (it is in ap-south-1); the account needs a **default VPC** there (new accounts have one).

## Cost of a test spin
≈ **$0.15 / hour ≈ $3.6 / day** (list prices, approximate): RDS db.t4g.micro + 20 GB gp3 ≈ $0.025/h · App Runner api 1 vCPU/2 GB ≈ $0.08/h ·
web + sink 0.25 vCPU/0.5 GB ≈ $0.04/h · ECR/S3 cents. A CI run (spin → test → teardown) is ≈ 40–60 min ⇒ **≈ $0.15**. `teardown.sh` prints
the estimate for the hours it was up. RDS creation alone takes 5–10 min.

## Limits (a TEST spin, not production)
- The database has a **public endpoint** with port 5432 open to the internet (App Runner has no fixed egress address): TLS forced by RDS,
  a 48-hex random password, no backups, deleted at teardown. Production: App Runner VPC connector + a NAT gateway (+≈$1.1/day) and a private RDS.
- The api's object store key is an IAM **user** key pair (`lib/storage-object.js` signs with a static key) — App Runner's instance role
  would be native but the code cannot use it yet (debt: `docs/HOSTING-COUPLING.md` › Per platform).
- TLS + DNS = App Runner's own `*.awsapprunner.com` name. A custom domain (`aws apprunner associate-custom-domain`) is not scripted;
  CTP between installations needs it (HX4).
- The sim shop is loaded from the runner: round trips to Mumbai make `SIM_YEARS=1` (default) take a while.
