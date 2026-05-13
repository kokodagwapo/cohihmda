#!/usr/bin/env bash
# =============================================================================
# Create Secrets Manager read-only replicas in DR region (run from primary)
# =============================================================================
# Usage:
#   ./scripts/dr/setup-secret-replicas.sh --destination-region us-east-1 \
#     --secret-ids "arn:aws:secretsmanager:us-east-2:ACCOUNT:secret:name1,secret/name2" \
#     [--profile p]
#
# Each secret must already exist in the primary region (current AWS_REGION).
# =============================================================================
set -euo pipefail

DEST=""
SECRET_IDS=""
PROFILE_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --destination-region) DEST="$2"; shift 2 ;;
    --secret-ids) SECRET_IDS="$2"; shift 2 ;;
    --profile) PROFILE_ARGS=(--profile "$2"); shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

AWS=(aws "${PROFILE_ARGS[@]:-}")
SRC_REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:?Set AWS_REGION}}"

[[ -n "$DEST" ]] || { echo "ERROR: --destination-region required"; exit 1; }
[[ -n "$SECRET_IDS" ]] || { echo "ERROR: --secret-ids required (comma-separated ARNs or names)"; exit 1; }

IFS=',' read -r -a IDS <<< "$SECRET_IDS"
for raw in "${IDS[@]}"; do
  sid=$(echo "$raw" | xargs)
  [[ -z "$sid" ]] && continue
  echo ">>> Replicating $sid → $DEST"
  "${AWS[@]}" secretsmanager replicate-secret-to-regions \
    --secret-id "$sid" \
    --add-replica-regions "Region=${DEST}" \
    --region "$SRC_REGION" || echo "WARN: replicate failed (already replicated or permission) — $sid"
done

echo "Done."
