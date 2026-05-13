#!/usr/bin/env bash
# =============================================================================
# DR drill: on-demand AWS Backup of Aurora + immediate cross-region copy
# =============================================================================
# On-demand backups do NOT run backup-plan CopyActions; this script runs a
# backup job then start-copy-job to the DR vault (same outcome as daily copy).
#
# Usage (after aws sso login):
#   ENV=dev PRIMARY_REGION=us-east-2 DR_REGION=us-east-1 \
#   ./scripts/dr/start-on-demand-backup-and-copy.sh
#
# Override:
#   CLUSTER_ID   default coheus-${ENV}-management
#   AWS_PROFILE
# =============================================================================
set -euo pipefail

ENV="${ENV:-dev}"
PRIMARY_REGION="${PRIMARY_REGION:-us-east-2}"
DR_REGION="${DR_REGION:-us-east-1}"
CLUSTER_ID="${CLUSTER_ID:-coheus-${ENV}-management}"
PROJECT_NAME="${PROJECT_NAME:-coheus}"
VAULT_PRIMARY="${PROJECT_NAME}-${ENV}-cohi-backup"
VAULT_DR="${PROJECT_NAME}-${ENV}-cohi-dr-copy"

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
RESOURCE_ARN="arn:aws:rds:${PRIMARY_REGION}:${ACCOUNT}:cluster:${CLUSTER_ID}"
ROLE_ARN="arn:aws:iam::${ACCOUNT}:role/coheus-${ENV}-aws-backup-service"
DEST_VAULT_ARN="arn:aws:backup:${DR_REGION}:${ACCOUNT}:backup-vault:${VAULT_DR}"

TOKEN_BACKUP="cohi-ondemand-$(date +%s)"
echo ">>> Starting backup: ${RESOURCE_ARN}"
BACKUP_OUT="$(aws backup start-backup-job \
  --backup-vault-name "${VAULT_PRIMARY}" \
  --resource-arn "${RESOURCE_ARN}" \
  --iam-role-arn "${ROLE_ARN}" \
  --idempotency-token "${TOKEN_BACKUP}" \
  --region "${PRIMARY_REGION}" \
  --output json)"
BACKUP_JOB_ID="$(echo "${BACKUP_OUT}" | jq -r '.BackupJobId')"
echo "    BackupJobId: ${BACKUP_JOB_ID}"

echo ">>> Waiting for backup COMPLETED..."
while true; do
  STATE="$(aws backup describe-backup-job --backup-job-id "${BACKUP_JOB_ID}" --region "${PRIMARY_REGION}" --query 'State' --output text)"
  echo "    ${STATE}"
  [[ "${STATE}" == "COMPLETED" ]] && break
  [[ "${STATE}" == "FAILED" || "${STATE}" == "ABORTED" ]] && { echo "ERROR: backup ${STATE}"; exit 1; }
  sleep 15
done

RP_ARN="$(aws backup describe-backup-job --backup-job-id "${BACKUP_JOB_ID}" --region "${PRIMARY_REGION}" --query 'RecoveryPointArn' --output text)"
echo ">>> Recovery point: ${RP_ARN}"

TOKEN_COPY="cohi-copy-$(date +%s)"
echo ">>> Starting copy to ${DEST_VAULT_ARN}"
COPY_OUT="$(aws backup start-copy-job \
  --recovery-point-arn "${RP_ARN}" \
  --source-backup-vault-name "${VAULT_PRIMARY}" \
  --destination-backup-vault-arn "${DEST_VAULT_ARN}" \
  --iam-role-arn "${ROLE_ARN}" \
  --idempotency-token "${TOKEN_COPY}" \
  --region "${PRIMARY_REGION}" \
  --output json)"
COPY_JOB_ID="$(echo "${COPY_OUT}" | jq -r '.CopyJobId')"
echo "    CopyJobId: ${COPY_JOB_ID}"

echo ">>> Waiting for copy COMPLETED (describe uses CopyJob.State)..."
while true; do
  STATE="$(aws backup describe-copy-job --copy-job-id "${COPY_JOB_ID}" --region "${PRIMARY_REGION}" --query 'CopyJob.State' --output text)"
  echo "    ${STATE}"
  [[ "${STATE}" == "COMPLETED" ]] && break
  [[ "${STATE}" == "FAILED" || "${STATE}" == "ABORTED" ]] && { echo "ERROR: copy ${STATE}"; exit 1; }
  sleep 15
done

echo ""
echo "Done. Verify in console: Backup → Copy jobs (region ${PRIMARY_REGION})"
echo "DR vault recovery points: list-recovery-points-by-backup-vault ${VAULT_DR} (${DR_REGION})"
echo ""
