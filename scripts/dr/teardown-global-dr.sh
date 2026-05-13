#!/usr/bin/env bash
# =============================================================================
# Tear down Aurora Global Database + secondary region DR stack (cold DR pivot)
# =============================================================================
# Run AFTER: aws sso login (or valid AWS credentials).
#
# Environment (override as needed):
#   AWS_PROFILE              e.g. DevEnvPerms-339712788893
#   PRIMARY_REGION           default: us-east-2
#   DR_REGION                default: us-east-1
#   ENV                      default: dev  (stack suffix)
#   GLOBAL_CLUSTER_ID        default: coheus-${ENV}-global
#   CF_STACK_SECONDARY       default: coheus-${ENV}-aurora-secondary
#   PRIMARY_CLUSTER_ID       default: coheus-${ENV}-management
#   SECONDARY_CLUSTER_ID     default: coheus-${ENV}-dr-secondary
#
# Order of operations matches AWS requirements:
#   1) Remove secondary cluster from global DB
#   2) Delete DR CloudFormation stack (removes secondary DB, VPC, etc.)
#   3) Remove primary cluster from global DB
#   4) Disable deletion protection on global cluster, delete global cluster
#   5) Print reminder to set EnableGlobalDatabaseParam=false on primary Aurora stack
# =============================================================================
set -euo pipefail

PRIMARY_REGION="${PRIMARY_REGION:-us-east-2}"
DR_REGION="${DR_REGION:-us-east-1}"
ENV="${ENV:-dev}"
GLOBAL_CLUSTER_ID="${GLOBAL_CLUSTER_ID:-coheus-${ENV}-global}"
CF_STACK_SECONDARY="${CF_STACK_SECONDARY:-coheus-${ENV}-aurora-secondary}"
PRIMARY_CLUSTER_ID="${PRIMARY_CLUSTER_ID:-coheus-${ENV}-management}"
SECONDARY_CLUSTER_ID="${SECONDARY_CLUSTER_ID:-coheus-${ENV}-dr-secondary}"

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
SECONDARY_ARN="arn:aws:rds:${DR_REGION}:${ACCOUNT}:cluster:${SECONDARY_CLUSTER_ID}"
PRIMARY_ARN="arn:aws:rds:${PRIMARY_REGION}:${ACCOUNT}:cluster:${PRIMARY_CLUSTER_ID}"

echo "Account: ${ACCOUNT}"
echo "Global cluster: ${GLOBAL_CLUSTER_ID}"
echo "Secondary cluster ARN: ${SECONDARY_ARN}"
echo "Primary cluster ARN: ${PRIMARY_ARN}"
echo ""

echo ">>> [1/5] Removing secondary cluster from global database..."
aws rds remove-from-global-cluster \
  --global-cluster-identifier "${GLOBAL_CLUSTER_ID}" \
  --db-cluster-identifier "${SECONDARY_ARN}" \
  --region "${DR_REGION}" 2>/dev/null || echo "(skip) Secondary already detached or cluster does not exist."

echo ">>> Waiting for secondary to leave global membership (poll)..."
for _ in $(seq 1 60); do
  if ! MEMBERS="$(aws rds describe-global-clusters \
    --global-cluster-identifier "${GLOBAL_CLUSTER_ID}" \
    --region "${PRIMARY_REGION}" \
    --query 'GlobalClusters[0].GlobalClusterMembers[].DBClusterArn' \
    --output text 2>/dev/null)"; then
    echo "Global cluster no longer exists or cannot be described — continuing."
    break
  fi
  if ! echo "${MEMBERS}" | grep -q "${SECONDARY_ARN}"; then
    echo "Secondary detached."
    break
  fi
  echo "... still waiting (${MEMBERS})"
  sleep 10
done

echo ">>> [2/5] Deleting CloudFormation stack ${CF_STACK_SECONDARY} in ${DR_REGION}..."
if aws cloudformation describe-stacks --stack-name "${CF_STACK_SECONDARY}" --region "${DR_REGION}" >/dev/null 2>&1; then
  aws cloudformation delete-stack --stack-name "${CF_STACK_SECONDARY}" --region "${DR_REGION}"
  echo "Waiting for stack delete..."
  aws cloudformation wait stack-delete-complete --stack-name "${CF_STACK_SECONDARY}" --region "${DR_REGION}"
  echo "DR stack deleted."
else
  echo "Stack ${CF_STACK_SECONDARY} not found (already deleted)."
fi

echo ">>> [3/5] Removing primary cluster from global database..."
aws rds remove-from-global-cluster \
  --global-cluster-identifier "${GLOBAL_CLUSTER_ID}" \
  --db-cluster-identifier "${PRIMARY_ARN}" \
  --region "${PRIMARY_REGION}" || true

echo ">>> [4/5] Deleting global cluster ${GLOBAL_CLUSTER_ID}..."
aws rds modify-global-cluster \
  --global-cluster-identifier "${GLOBAL_CLUSTER_ID}" \
  --no-deletion-protection \
  --region "${PRIMARY_REGION}" || true

aws rds delete-global-cluster \
  --global-cluster-identifier "${GLOBAL_CLUSTER_ID}" \
  --region "${PRIMARY_REGION}" || true

echo ">>> [5/5] Done with RDS global teardown."
echo ""
echo "NEXT (manual CloudFormation):"
echo "  1) Update primary Aurora management stack with EnableGlobalDatabaseParam=false"
echo "     (removes GlobalCluster resource from template; if stack retained an orphaned global resource,"
echo "      it may already be deleted by step 4)."
echo "  2) Deploy coheus_aurora_secondary_stack.yaml to ${DR_REGION} (landing zone + DR backup vault)."
echo "  3) Update coheus_backup_stack in ${PRIMARY_REGION} so daily backups copy to the DR vault."
echo "  4) Run: bash scripts/dr/restore-from-snapshot.sh --help  (break-glass restore drill)"
echo ""
