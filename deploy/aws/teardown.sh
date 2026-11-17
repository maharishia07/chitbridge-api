#!/usr/bin/env bash
# deploy/aws/teardown.sh — DELETE EVERYTHING THE AWS SPIN MADE (HX2), found by its tag cb-spin=<id> (the Resource Groups Tagging API) —
# never by a name alone. IAM is not in that API: the user and the role are deleted only when THEIR tag names this spin.
# Prints the cost estimate it ran up. CB_SPIN_ID=<id> to tear down a spin whose state file is gone. PLAN=1 / PARSE=1 as spin.sh.
. "$(dirname "$0")/../spin-lib.sh"
spin_load aws
AWS_REGION=${AWS_REGION:-ap-south-1}; N="cbspin-$CB_SPIN_ID"; R=(--region "$AWS_REGION")
say "teardown of spin $CB_SPIN_ID ($AWS_REGION)"
PLAN_ARNS="arn:aws:apprunner:$AWS_REGION:1:service/$N-api/x arn:aws:rds:$AWS_REGION:1:db:$N arn:aws:ecr:$AWS_REGION:1:repository/$N-api arn:aws:s3:::$N-attach arn:aws:ec2:$AWS_REGION:1:security-group/sg-plan"
ARNS=$(out "$PLAN_ARNS" aws resourcegroupstaggingapi get-resources "${R[@]}" --tag-filters "Key=cb-spin,Values=$CB_SPIN_ID" --query 'ResourceTagMappingList[].ResourceARN' --output text)
SGS=(); DBS=()
for arn in $ARNS; do
  case "$arn" in
    arn:aws:apprunner:*:service/*) run aws apprunner delete-service "${R[@]}" --service-arn "$arn" --query Service.Status --output text ;;
    arn:aws:rds:*:db:*) DBS+=("${arn##*:}"); run aws rds delete-db-instance "${R[@]}" --db-instance-identifier "${arn##*:}" --skip-final-snapshot --delete-automated-backups --query DBInstance.DBInstanceStatus --output text ;;
    arn:aws:ecr:*:repository/*) run aws ecr delete-repository "${R[@]}" --repository-name "${arn##*/}" --force --query repository.repositoryName --output text ;;
    arn:aws:s3:::*) run aws s3 rb "s3://${arn##*:::}" --force "${R[@]}" ;;
    arn:aws:ec2:*:security-group/*) SGS+=("${arn##*/}") ;;
    *) say "left (not a kind this spin makes): $arn" ;;
  esac
done
# the security group goes once the database that uses it is gone
for db in "${DBS[@]}"; do run aws rds wait db-instance-deleted "${R[@]}" --db-instance-identifier "$db"; done
for sg in "${SGS[@]}"; do run aws ec2 delete-security-group "${R[@]}" --group-id "$sg"; done
# IAM — only when its own tag says this spin
tagged() {
  local q=(aws iam "list-$1-tags" "--$1-name" "$2" --query "Tags[?Key=='cb-spin'].Value" --output text)
  if dry; then run "${q[@]}"; return 0; fi; [ "$("${q[@]}" 2>/dev/null)" = "$CB_SPIN_ID" ]
}
if tagged user "$N-api"; then
  for k in $(out AKIAPLANPLANPLAN0000 aws iam list-access-keys --user-name "$N-api" --query 'AccessKeyMetadata[].AccessKeyId' --output text); do run aws iam delete-access-key --user-name "$N-api" --access-key-id "$k"; done
  run aws iam delete-user-policy --user-name "$N-api" --policy-name objects
  run aws iam delete-user --user-name "$N-api"
fi
if tagged role "$N-ecr"; then
  run aws iam detach-role-policy --role-name "$N-ecr" --policy-arn arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess
  run aws iam delete-role --role-name "$N-ecr"
fi
spin_parse_done
# ≈ RDS db.t4g.micro + 20 GB gp3 $0.025 · App Runner api 1 vCPU/2 GB $0.08 · web + sink 0.25 vCPU/0.5 GB $0.04 · ECR/S3 ~0
spin_cost aws 0.15 "RDS t4g.micro · App Runner ×3 · ECR · S3"
spin_forget aws
say "spin $CB_SPIN_ID removed"
