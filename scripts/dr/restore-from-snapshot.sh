#!/usr/bin/env bash
# =============================================================================
# Break-glass: restore Aurora PostgreSQL cluster in DR region from a snapshot
# =============================================================================
# Prerequisites:
#   - DR landing stack deployed (coheus_aurora_secondary_stack) in DR_REGION
#   - Cluster snapshot exists in DR_REGION (e.g. cross-region copy in DR backup vault
#     creates recoverable state; for drills use a manual cluster snapshot or latest copy)
#
# Usage:
#   ./scripts/dr/restore-from-snapshot.sh \\
#     --environment dev \\
#     --snapshot-id rds:coheus-dev-management-2026-05-12-03-05 \\
#     --new-cluster-id coheus-dev-management-dr-restore
#
# Or pass full snapshot ARN with --snapshot-arn.
#
# The script reads subnet group, security group, and KMS from the DR stack outputs.
# =============================================================================
set -euo pipefail

ENVIRONMENT="dev"
DR_REGION="${DR_REGION:-us-east-1}"
DR_STACK="${DR_STACK:-}"
SNAPSHOT_ID=""
SNAPSHOT_ARN=""
NEW_CLUSTER_ID=""
INSTANCE_ID=""
PROFILE_FLAG=()

usage() {
  echo "Usage: $0 --environment <dev|staging|prod> --new-cluster-id <id> (--snapshot-id <id> | --snapshot-arn <arn>)"
  echo "       [--dr-region us-east-1] [--dr-stack <cf-stack-name>] [--instance-id <id>] [--profile <profile>]"
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --environment|-e) ENVIRONMENT="$2"; shift 2 ;;
    --dr-region) DR_REGION="$2"; shift 2 ;;
    --dr-stack) DR_STACK="$2"; shift 2 ;;
    --snapshot-id) SNAPSHOT_ID="$2"; shift 2 ;;
    --snapshot-arn) SNAPSHOT_ARN="$2"; shift 2 ;;
    --new-cluster-id) NEW_CLUSTER_ID="$2"; shift 2 ;;
    --instance-id) INSTANCE_ID="$2"; shift 2 ;;
    --profile) PROFILE_FLAG=(--profile "$2"); shift 2 ;;
    -h|--help) usage ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

if [[ -z "${DR_STACK}" ]]; then
  DR_STACK="coheus-${ENVIRONMENT}-aurora-secondary"
fi

if [[ -z "${NEW_CLUSTER_ID}" ]]; then
  echo "ERROR: --new-cluster-id is required (e.g. coheus-dev-management-dr-restore)"
  exit 1
fi

if [[ -z "${INSTANCE_ID}" ]]; then
  INSTANCE_ID="${NEW_CLUSTER_ID}-1"
fi

if [[ -z "${SNAPSHOT_ID}" && -z "${SNAPSHOT_ARN}" ]]; then
  echo "ERROR: provide --snapshot-id or --snapshot-arn"
  exit 1
fi

AWS=(aws "${PROFILE_FLAG[@]:-}")

echo ">>> Reading DR stack outputs: ${DR_STACK} (${DR_REGION})"
SUBNET_GROUP="$("${AWS[@]}" cloudformation describe-stacks \
  --stack-name "${DR_STACK}" \
  --region "${DR_REGION}" \
  --query "Stacks[0].Outputs[?OutputKey=='DRDbSubnetGroupName'].OutputValue" \
  --output text)"
SG="$("${AWS[@]}" cloudformation describe-stacks \
  --stack-name "${DR_STACK}" \
  --region "${DR_REGION}" \
  --query "Stacks[0].Outputs[?OutputKey=='DRClusterSecurityGroupId'].OutputValue" \
  --output text)"
KMS="$("${AWS[@]}" cloudformation describe-stacks \
  --stack-name "${DR_STACK}" \
  --region "${DR_REGION}" \
  --query "Stacks[0].Outputs[?OutputKey=='DRAuroraKmsKeyArn'].OutputValue" \
  --output text)"

if [[ -z "${SUBNET_GROUP}" || "${SUBNET_GROUP}" == "None" ]]; then
  echo "ERROR: Could not read DRDbSubnetGroupName from stack ${DR_STACK}"
  exit 1
fi
echo "    Subnet group: ${SUBNET_GROUP}"
echo "    Security group: ${SG}"
echo "    KMS: ${KMS}"

RESTORE_SOURCE=()
if [[ -n "${SNAPSHOT_ARN}" ]]; then
  RESTORE_SOURCE=(--snapshot-arn "${SNAPSHOT_ARN}")
else
  RESTORE_SOURCE=(--snapshot-identifier "${SNAPSHOT_ID}")
fi

echo ">>> Restoring DB cluster ${NEW_CLUSTER_ID} from snapshot..."
"${AWS[@]}" rds restore-db-cluster-from-snapshot \
  --region "${DR_REGION}" \
  "${RESTORE_SOURCE[@]}" \
  --db-cluster-identifier "${NEW_CLUSTER_ID}" \
  --engine aurora-postgresql \
  --engine-mode provisioned \
  --serverless-v2-scaling-configuration MinCapacity=0.5,MaxCapacity=4 \
  --db-subnet-group-name "${SUBNET_GROUP}" \
  --vpc-security-group-ids "${SG}" \
  --kms-key-id "${KMS}" \
  --copy-tags-to-snapshot \
  --no-deletion-protection

echo ">>> Waiting for cluster to be available..."
"${AWS[@]}" rds wait db-cluster-available \
  --db-cluster-identifier "${NEW_CLUSTER_ID}" \
  --region "${DR_REGION}"

echo ">>> Creating Serverless v2 instance ${INSTANCE_ID}..."
"${AWS[@]}" rds create-db-instance \
  --region "${DR_REGION}" \
  --db-cluster-identifier "${NEW_CLUSTER_ID}" \
  --db-instance-identifier "${INSTANCE_ID}" \
  --db-instance-class db.serverless \
  --engine aurora-postgresql

"${AWS[@]}" rds wait db-instance-available \
  --db-instance-identifier "${INSTANCE_ID}" \
  --region "${DR_REGION}"

ENDPOINT="$("${AWS[@]}" rds describe-db-clusters \
  --db-cluster-identifier "${NEW_CLUSTER_ID}" \
  --region "${DR_REGION}" \
  --query 'DBClusters[0].Endpoint' \
  --output text)"

echo ""
echo "========================================="
echo "Restore complete"
echo "========================================="
echo "Writer endpoint: ${ENDPOINT}"
echo ""
echo "Post-restore checklist:"
echo "  - Rotate / verify Secrets Manager credentials for this cluster (master user from snapshot)."
echo "  - Point ECS task definition DB_HOST (or secret) at ${ENDPOINT} for DR cutover."
echo "  - Update CloudFront / WAF secondary origin if using origin failover."
echo "  - Validate application health before directing production traffic."
echo ""
