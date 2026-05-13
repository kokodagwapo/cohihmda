#!/usr/bin/env bash
# =============================================================================
# Deploy frontend build to DR-region S3 + invalidate CloudFront
# =============================================================================
# Required:
#   DR_AWS_REGION (default us-east-1)
#   DR_S3_FRONTEND_BUCKET
#   CLOUDFRONT_DISTRIBUTION_ID  (same global distribution as primary)
#   VITE_API_URL                (DR ALB / API URL for the build)
#
# Optional: AWS_ROLE_ARN + OIDC (Bitbucket) or AWS profile via --profile
#
# Note: Switching the CloudFront *origin* to this bucket is a separate console
# or IaC change (see docs/deployment/DR_DEPLOY_CHECKLIST.md). This script only
# publishes artifacts and invalidates cache.
# =============================================================================
set -euo pipefail

PROFILE_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE_ARGS=(--profile "$2"); shift 2 ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

AWS=(aws "${PROFILE_ARGS[@]:-}")
export AWS_DEFAULT_REGION="${DR_AWS_REGION:-us-east-1}"

DR_S3_FRONTEND_BUCKET="${DR_S3_FRONTEND_BUCKET:?Set DR_S3_FRONTEND_BUCKET}"
CLOUDFRONT_DISTRIBUTION_ID="${CLOUDFRONT_DISTRIBUTION_ID:?Set CLOUDFRONT_DISTRIBUTION_ID}"

echo "========================================="
echo "DR Frontend deploy → s3://${DR_S3_FRONTEND_BUCKET} (${AWS_DEFAULT_REGION})"
echo "========================================="

if [[ ! -d "dist" ]]; then
  echo ">>> npm ci && npm run build"
  npm ci
  npm run build
fi

echo ">>> aws s3 sync"
"${AWS[@]}" s3 sync ./dist/ "s3://${DR_S3_FRONTEND_BUCKET}/" --delete

echo ">>> CloudFront invalidation ${CLOUDFRONT_DISTRIBUTION_ID}"
"${AWS[@]}" cloudfront create-invalidation \
  --distribution-id "$CLOUDFRONT_DISTRIBUTION_ID" \
  --paths "/*"

echo "Done."
