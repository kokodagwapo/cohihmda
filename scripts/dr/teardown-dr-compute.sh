#!/usr/bin/env bash
# =============================================================================
# DR: tear down cold ECS stack and disable NAT on DR landing zone
# =============================================================================
# Usage:
#   export ENVIRONMENT=dev
#   export DR_BACKEND_STACK=coheus-dev-dr-backend
#   export DR_LANDING_STACK=coheus-dev-aurora-secondary   # optional
#   export DR_REGION=us-east-1
#   ./scripts/dr/teardown-dr-compute.sh [--delete-aurora-cluster ID] [--profile p]
# =============================================================================
set -euo pipefail

DELETE_CLUSTER=""
PROFILE_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --delete-aurora-cluster) DELETE_CLUSTER="$2"; shift 2 ;;
    --profile) PROFILE_ARGS=(--profile "$2"); shift 2 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

AWS=(aws "${PROFILE_ARGS[@]:-}")
if [[ -z "${ENVIRONMENT:-}" ]]; then
  case "${BITBUCKET_DEPLOYMENT_ENVIRONMENT:-}" in
    production) ENVIRONMENT=prod ;;
    *) ENVIRONMENT="${BITBUCKET_DEPLOYMENT_ENVIRONMENT:-dev}" ;;
  esac
fi
DR_BACKEND_STACK="${DR_BACKEND_STACK:-coheus-${ENVIRONMENT}-dr-backend}"
DR_LANDING_STACK="${DR_LANDING_STACK:-coheus-${ENVIRONMENT}-aurora-secondary}"
DR_REGION="${DR_REGION:-us-east-1}"

if [[ -n "$DELETE_CLUSTER" ]]; then
  echo ">>> Listing instances for cluster $DELETE_CLUSTER"
  INSTANCES=$("${AWS[@]}" rds describe-db-clusters \
    --db-cluster-identifier "$DELETE_CLUSTER" \
    --region "$DR_REGION" \
    --query 'DBClusters[0].DBClusterMembers[*].DBInstanceIdentifier' \
    --output text 2>/dev/null || true)
  for inst in $INSTANCES; do
    [[ -z "$inst" || "$inst" == "None" ]] && continue
    echo ">>> Deleting instance $inst"
    "${AWS[@]}" rds delete-db-instance --db-instance-identifier "$inst" \
      --skip-final-snapshot --region "$DR_REGION" || true
  done
  for inst in $INSTANCES; do
    [[ -z "$inst" || "$inst" == "None" ]] && continue
    "${AWS[@]}" rds wait db-instance-deleted --db-instance-identifier "$inst" --region "$DR_REGION" || true
  done
  echo ">>> Deleting cluster $DELETE_CLUSTER"
  "${AWS[@]}" rds delete-db-cluster --db-cluster-identifier "$DELETE_CLUSTER" \
    --skip-final-snapshot --region "$DR_REGION" || true
fi

if "${AWS[@]}" cloudformation describe-stacks --stack-name "$DR_BACKEND_STACK" --region "$DR_REGION" &>/dev/null; then
  echo ">>> Deleting CloudFormation stack $DR_BACKEND_STACK"
  "${AWS[@]}" cloudformation delete-stack --stack-name "$DR_BACKEND_STACK" --region "$DR_REGION"
  echo ">>> Waiting for stack delete..."
  "${AWS[@]}" cloudformation wait stack-delete-complete --stack-name "$DR_BACKEND_STACK" --region "$DR_REGION"
else
  echo ">>> Backend stack $DR_BACKEND_STACK not present — skip"
fi

echo ">>> Setting EnableCompute=false on $DR_LANDING_STACK"
"${AWS[@]}" cloudformation deploy \
  --stack-name "$DR_LANDING_STACK" \
  --template-file "infrastructure/cloudformation/coheus_aurora_secondary_stack.yaml" \
  --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
  --region "$DR_REGION" \
  --no-fail-on-empty-changeset \
  --parameter-overrides EnableCompute=false

echo ">>> DR compute teardown complete."
