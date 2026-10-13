#!/usr/bin/env bash
# deploy/aws/spin.sh — ONE ISOLATED CHITBRIDGE ON AWS, Mumbai (ap-south-1) by default (HX2). Plain bash + the aws CLI.
#   RDS Postgres 16 (db.t4g.micro, TLS forced) · S3 bucket (private) + an IAM user whose key pair the api signs with (SigV4) ·
#   ECR (the three images) · App Runner: api (:3000), web (the nginx image, :8080), mail sink (:8025) — each on its own
#   https://<id>.ap-south-1.awsapprunner.com (TLS by App Runner). Every resource: named cbspin-<id>…, tagged cb-spin=<id>.
#   bash deploy/aws/spin.sh           PLAN=1 … (print every command)   PARSE=1 … (the CLI checks every command, no account)
# Needs: AWS credentials (README), docker, node, openssl. Then: deploy/aws/test.sh · deploy/aws/teardown.sh.
. "$(dirname "$0")/../spin-lib.sh"
AWS_REGION=${AWS_REGION:-ap-south-1}
spin_new aws
N="cbspin-$CB_SPIN_ID"; R=(--region "$AWS_REGION"); TAG="Key=cb-spin,Value=$CB_SPIN_ID"
spin_save aws AWS_REGION    # recorded first: a spin that fails half-way is still found by teardown

ACCT=$(out 123456789012 aws sts get-caller-identity --query Account --output text)
REG="$ACCT.dkr.ecr.$AWS_REGION.amazonaws.com"

say "images → ECR"
spin_build_images
for i in api web mailsink; do run aws ecr create-repository "${R[@]}" --repository-name "$N-$i" --tags "$TAG" --query repository.repositoryUri --output text; done
if dry; then run aws ecr get-login-password "${R[@]}"; else aws ecr get-login-password "${R[@]}" | docker login -u AWS --password-stdin "$REG" >/dev/null; fi
spin_push "$REG/$N"

say "database: RDS Postgres 16 (public endpoint, TLS forced, a 48-hex password — App Runner has no fixed egress address)"
VPC=$(out vpc-plan aws ec2 describe-vpcs "${R[@]}" --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
SG=$(out sg-plan aws ec2 create-security-group "${R[@]}" --group-name "$N-db" --description "ChitBridge spin $CB_SPIN_ID database" --vpc-id "$VPC" \
  --tag-specifications "ResourceType=security-group,Tags=[{Key=cb-spin,Value=$CB_SPIN_ID}]" --query GroupId --output text)
run aws ec2 authorize-security-group-ingress "${R[@]}" --group-id "$SG" --protocol tcp --port 5432 --cidr 0.0.0.0/0
run aws rds create-db-instance "${R[@]}" --db-instance-identifier "$N" --engine postgres --engine-version 16 --db-instance-class db.t4g.micro \
  --allocated-storage 20 --storage-type gp3 --master-username postgres --master-user-password "$POSTGRES_PASSWORD" --db-name "$SPIN_DB" \
  --publicly-accessible --vpc-security-group-ids "$SG" --backup-retention-period 0 --no-multi-az --tags "$TAG" --query DBInstance.DBInstanceStatus --output text
run aws rds wait db-instance-available "${R[@]}" --db-instance-identifier "$N"
HOST=$(out "$N.plan.$AWS_REGION.rds.amazonaws.com" aws rds describe-db-instances "${R[@]}" --db-instance-identifier "$N" --query 'DBInstances[0].Endpoint.Address' --output text)
OWNER_URL="postgres://postgres:$POSTGRES_PASSWORD@$HOST:5432/$SPIN_DB?sslmode=no-verify"
DATABASE_URL="postgres://cb_app:$CB_APP_PASSWORD@$HOST:5432/$SPIN_DB?sslmode=no-verify"
say "schema (the ledger chain, then cb_app's password)"; spin_migrate "$OWNER_URL"

say "object store: S3 (private) + an IAM user that may only read/write/delete its objects"
S3_BUCKET="$N-attach"; S3_ENDPOINT="https://s3.$AWS_REGION.amazonaws.com"; S3_REGION=$AWS_REGION; S3_PATH_STYLE=false
run aws s3api create-bucket "${R[@]}" --bucket "$S3_BUCKET" --create-bucket-configuration "LocationConstraint=$AWS_REGION"
run aws s3api put-public-access-block "${R[@]}" --bucket "$S3_BUCKET" --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
run aws s3api put-bucket-tagging "${R[@]}" --bucket "$S3_BUCKET" --tagging "TagSet=[{Key=cb-spin,Value=$CB_SPIN_ID}]"
run aws iam create-user --user-name "$N-api" --tags "$TAG"
run aws iam put-user-policy --user-name "$N-api" --policy-name objects --policy-document \
  "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"s3:GetObject\",\"s3:PutObject\",\"s3:DeleteObject\"],\"Resource\":\"arn:aws:s3:::$S3_BUCKET/*\"}]}"
read -r S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY <<<"$(out 'AKIAPLAN plan-secret' aws iam create-access-key --user-name "$N-api" --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text)"

say "App Runner: a role to pull from ECR, then mail sink → api → web, then the api learns the web's address"
run aws iam create-role --role-name "$N-ecr" --tags "$TAG" --assume-role-policy-document \
  '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"build.apprunner.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
run aws iam attach-role-policy --role-name "$N-ecr" --policy-arn arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess
dry || sleep 15   # IAM is eventually consistent; App Runner must see the role
ROLE="arn:aws:iam::$ACCT:role/$N-ecr"
# source <image> <port> — App Runner's source configuration, with the environment read from stdin (NAME=VALUE lines)
source_json() { node -e '
  const env = {}; require("fs").readFileSync(0, "utf8").split("\n").filter(Boolean).forEach((l) => { const i = l.indexOf("="); env[l.slice(0, i)] = l.slice(i + 1); });
  console.log(JSON.stringify({ ImageRepository: { ImageIdentifier: process.argv[1], ImageRepositoryType: "ECR", ImageConfiguration: { Port: process.argv[2], RuntimeEnvironmentVariables: env } },
    AutoDeploymentsEnabled: false, AuthenticationConfiguration: { AccessRoleArn: process.argv[3] } }));' "$1" "$2" "$ROLE"; }
# apprunner <name> <port> <cpu> <memory> <health path or ""> — creates the service, prints its https URL (env on stdin)
apprunner() {
  local hc="Protocol=TCP"; [ -n "$5" ] && hc="Protocol=HTTP,Path=$5"
  local src; src=$(source_json "$REG/$N-$1:$CB_SPIN_ID" "$2")
  printf 'https://%s' "$(out "$N-$1.plan.$AWS_REGION.awsapprunner.com" aws apprunner create-service "${R[@]}" --service-name "$N-$1" \
    --source-configuration "$src" --instance-configuration "Cpu=$3,Memory=$4" --health-check-configuration "$hc" --tags "$TAG" \
    --query Service.ServiceUrl --output text)"
}
arn_of() { out "arn:aws:apprunner:$AWS_REGION:$ACCT:service/$N-$1/plan" aws apprunner list-services "${R[@]}" --query "ServiceSummaryList[?ServiceName=='$N-$1'].ServiceArn" --output text; }
MAIL_URL=$(spin_sink_env | apprunner mailsink 8025 256 512 "")
WEB_URL=""; API_URL=""   # the api starts before the web exists: its origin is set by the update below
API_URL=$(spin_api_env | apprunner api 3000 1024 2048 /health)
WEB_URL=$(printf 'CB_API_BASE=%s\n' "$API_URL" | apprunner web 8080 256 512 /healthz)
spin_save aws AWS_REGION ACCT OWNER_URL DATABASE_URL API_URL WEB_URL MAIL_URL S3_BUCKET S3_ENDPOINT S3_REGION S3_PATH_STYLE S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY
spin_wait_http "$API_URL/health" "api"
src=$(spin_api_env | source_json "$REG/$N-api:$CB_SPIN_ID" 3000)
run aws apprunner update-service "${R[@]}" --service-arn "$(arn_of api)" --source-configuration "$src" --query Service.Status --output text
dry || sleep 30
spin_wait_http "$API_URL/health" "api (with the web's origin)"; spin_wait_http "$WEB_URL/" "web"; spin_wait_http "$MAIL_URL/last" "mail sink"
spin_parse_done
say "up: web $WEB_URL · api $API_URL · state deploy/.spin/aws.env — next: bash deploy/aws/test.sh"
