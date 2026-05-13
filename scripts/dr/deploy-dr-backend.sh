#!/usr/bin/env bash
# =============================================================================
# Cold DR: enable NAT on DR landing stack + deploy / update ECS backend in DR
# =============================================================================
# Prerequisites:
#   - DR landing stack (coheus_aurora_secondary_stack) in DR region with outputs
#   - Restored Aurora (or test endpoint) reachable from DR VPC private subnets
#   - ECR image tag present in DR region (replication or manual push)
#   - ACM certificate, Cognito DR pool, JwtSecret (see docs/deployment/DR_DEPLOY_CHECKLIST.md)
#
# Usage:
#   export ENVIRONMENT=dev
#   export PRIMARY_STACK=coheus-dev-backend
#   export PRIMARY_REGION=us-east-2
#   export DR_BACKEND_STACK=coheus-dev-dr-backend
#   export DR_LANDING_STACK=coheus-dev-aurora-secondary   # optional if matches pattern
#   export DR_REGION=us-east-1
#   export DR_AURORA_ENDPOINT=...
#   export DR_AURORA_SECRET_ARN=...
#   export DR_IMAGE_TAG=abc123-20260101120000
#   export DR_JWT_SECRET='...'
#   export DR_CERTIFICATE_ARN=arn:aws:acm:us-east-1:...
#   export DR_COGNITO_USER_POOL_ID=...
#   export DR_COGNITO_CLIENT_ID=...
#   export DR_COGNITO_CLIENT_SECRET='...'
#   export DR_COGNITO_DOMAIN=your-dr-pool.auth.us-east-1.amazoncognito.com
#   export DR_FRONTEND_URL=https://...
#   Optional: DR_COGNITO_REGION=us-east-1  DR_OPENAI_SECRET_ARN=... COGNITO_PASSWORD_AUTH=true
#   ./scripts/dr/deploy-dr-backend.sh [--skip-nat] [--profile prof]
#
# Auth: OIDC (Bitbucket) or standard AWS env / --profile.
# =============================================================================
set -euo pipefail

SKIP_NAT=false
PROFILE_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-nat) SKIP_NAT=true; shift ;;
    --profile) PROFILE_ARGS=(--profile "$2"); shift 2 ;;
    -h|--help) sed -n '5,35p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

AWS=(aws "${PROFILE_ARGS[@]:-}")

# CloudFormation Environment param (dev|staging|prod) — not always equal to Bitbucket's deployment name.
if [[ -z "${ENVIRONMENT:-}" ]]; then
  case "${BITBUCKET_DEPLOYMENT_ENVIRONMENT:-}" in
    production) ENVIRONMENT=prod ;;
    "") ENVIRONMENT=dev ;;
    *) ENVIRONMENT="${BITBUCKET_DEPLOYMENT_ENVIRONMENT}" ;;
  esac
fi

PRIMARY_STACK="${PRIMARY_STACK:-coheus-${ENVIRONMENT}-backend}"
PRIMARY_REGION="${PRIMARY_REGION:-us-east-2}"
DR_BACKEND_STACK="${DR_BACKEND_STACK:-coheus-${ENVIRONMENT}-dr-backend}"
DR_LANDING_STACK="${DR_LANDING_STACK:-coheus-${ENVIRONMENT}-aurora-secondary}"
DR_REGION="${DR_REGION:-us-east-1}"

DR_AURORA_ENDPOINT="${DR_AURORA_ENDPOINT:?Set DR_AURORA_ENDPOINT}"
DR_AURORA_SECRET_ARN="${DR_AURORA_SECRET_ARN:?Set DR_AURORA_SECRET_ARN}"
DR_IMAGE_TAG="${DR_IMAGE_TAG:?Set DR_IMAGE_TAG}"
DR_JWT_SECRET="${DR_JWT_SECRET:?Set DR_JWT_SECRET}"
DR_CERTIFICATE_ARN="${DR_CERTIFICATE_ARN:?Set DR_CERTIFICATE_ARN}"
DR_COGNITO_USER_POOL_ID="${DR_COGNITO_USER_POOL_ID:?Set DR_COGNITO_USER_POOL_ID}"
DR_COGNITO_CLIENT_ID="${DR_COGNITO_CLIENT_ID:?Set DR_COGNITO_CLIENT_ID}"
DR_COGNITO_CLIENT_SECRET="${DR_COGNITO_CLIENT_SECRET:?Set DR_COGNITO_CLIENT_SECRET}"
DR_COGNITO_DOMAIN="${DR_COGNITO_DOMAIN:?Set DR_COGNITO_DOMAIN}"
DR_FRONTEND_URL="${DR_FRONTEND_URL:?Set DR_FRONTEND_URL}"

COGNITO_PASSWORD_AUTH="${COGNITO_PASSWORD_AUTH:-true}"
DR_COGNITO_REGION="${DR_COGNITO_REGION:-}"

TEMPLATE="infrastructure/cloudformation/coheus_ecs_fargate_stack.yaml"
LANDING_TEMPLATE="infrastructure/cloudformation/coheus_aurora_secondary_stack.yaml"

get_primary_param() {
  local key="$1"
  "${AWS[@]}" cloudformation describe-stacks \
    --stack-name "$PRIMARY_STACK" \
    --region "$PRIMARY_REGION" \
    --query "Stacks[0].Parameters[?ParameterKey=='${key}'].ParameterValue | [0]" \
    --output text 2>/dev/null || echo ""
}

get_dr_output() {
  local key="$1"
  "${AWS[@]}" cloudformation describe-stacks \
    --stack-name "$DR_LANDING_STACK" \
    --region "$DR_REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='${key}'].OutputValue | [0]" \
    --output text
}

echo ">>> DR landing outputs (${DR_LANDING_STACK} / ${DR_REGION})"
DR_VPC_ID="${DR_VPC_ID:-$(get_dr_output DRVpcId)}"
DR_PUB1="${DR_PUBLIC_SUBNET_1:-$(get_dr_output DRPublicSubnet1Id)}"
DR_PUB2="${DR_PUBLIC_SUBNET_2:-$(get_dr_output DRPublicSubnet2Id)}"
DR_PRIV1="${DR_PRIVATE_SUBNET_1:-$(get_dr_output DRPrivateSubnet1Id)}"
DR_PRIV2="${DR_PRIVATE_SUBNET_2:-$(get_dr_output DRPrivateSubnet2Id)}"
DR_AURORA_KMS="${DR_AURORA_KMS_KEY_ARN:-$(get_dr_output DRAuroraKmsKeyArn)}"

if [[ -z "$DR_VPC_ID" || "$DR_VPC_ID" == "None" ]]; then
  echo "ERROR: DRVpcId missing. Deploy updated coheus_aurora_secondary_stack (public subnets + outputs) first."
  exit 1
fi
if [[ -z "$DR_PUB1" || "$DR_PUB1" == "None" ]]; then
  echo "ERROR: DRPublicSubnet1Id missing — update DR landing stack template."
  exit 1
fi

enable_nat_on_dr_landing() {
  echo ">>> Setting EnableCompute=true on ${DR_LANDING_STACK}"
  "${AWS[@]}" cloudformation deploy \
    --stack-name "$DR_LANDING_STACK" \
    --template-file "$LANDING_TEMPLATE" \
    --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
    --region "$DR_REGION" \
    --no-fail-on-empty-changeset \
    --parameter-overrides EnableCompute=true
}

if [[ "$SKIP_NAT" != "true" ]]; then
  if ! "${AWS[@]}" cloudformation describe-stacks --stack-name "$DR_LANDING_STACK" --region "$DR_REGION" &>/dev/null; then
    echo "ERROR: DR landing stack $DR_LANDING_STACK not found in $DR_REGION"
    exit 1
  fi
  enable_nat_on_dr_landing
else
  echo ">>> Skipping NAT enable (--skip-nat)"
fi

echo ">>> Building ECS parameter overrides from primary ${PRIMARY_STACK} (${PRIMARY_REGION})"
TEMPLATE_KEYS=$("${AWS[@]}" cloudformation get-template-summary \
  --template-body "file://${TEMPLATE}" \
  --query 'Parameters[].ParameterKey' \
  --output text)

is_optional_empty_ok() {
  case "$1" in
    OpenAIApiKeySecretArn|FredApiKey|AlertEmail|PodcastReplicationDestinationBucketArn|PodcastReplicationServiceRoleArn|CognitoRegion) return 0 ;;
    *) return 1 ;;
  esac
}

OVERRIDE_ARGS=()
while read -r KEY; do
  [[ -z "$KEY" ]] && continue
  VAL=""
  case "$KEY" in
    NetworkMode) VAL="existing" ;;
    ExistingVPCId) VAL="$DR_VPC_ID" ;;
    ExistingPublicSubnet1) VAL="$DR_PUB1" ;;
    ExistingPublicSubnet2) VAL="$DR_PUB2" ;;
    ExistingPrivateSubnet1) VAL="$DR_PRIV1" ;;
    ExistingPrivateSubnet2) VAL="$DR_PRIV2" ;;
    AuroraEndpoint) VAL="$DR_AURORA_ENDPOINT" ;;
    AuroraSecretArn) VAL="$DR_AURORA_SECRET_ARN" ;;
    AuroraKmsKeyArn) VAL="$DR_AURORA_KMS" ;;
    ContainerImageTag) VAL="$DR_IMAGE_TAG" ;;
    CertificateArn) VAL="$DR_CERTIFICATE_ARN" ;;
    CognitoUserPoolId) VAL="$DR_COGNITO_USER_POOL_ID" ;;
    CognitoClientId) VAL="$DR_COGNITO_CLIENT_ID" ;;
    CognitoClientSecret) VAL="$DR_COGNITO_CLIENT_SECRET" ;;
    CognitoDomain) VAL="$DR_COGNITO_DOMAIN" ;;
    CognitoRegion) VAL="${DR_COGNITO_REGION}" ;;
    CognitoPasswordAuth) VAL="$COGNITO_PASSWORD_AUTH" ;;
    FrontendUrl) VAL="$DR_FRONTEND_URL" ;;
    JwtSecret) VAL="$DR_JWT_SECRET" ;;
    OpenAIApiKeySecretArn) VAL="${DR_OPENAI_SECRET_ARN:-$(get_primary_param OpenAIApiKeySecretArn)}" ;;
    *) VAL="$(get_primary_param "$KEY")" ;;
  esac
  if [[ -z "$VAL" || "$VAL" == "None" ]]; then
    if is_optional_empty_ok "$KEY"; then
      continue
    fi
    echo "ERROR: Missing value for required parameter '$KEY' (set env or ensure primary stack exports it)."
    exit 1
  fi
  OVERRIDE_ARGS+=("${KEY}=${VAL}")
done <<< "$(echo "$TEMPLATE_KEYS" | tr '\t' '\n')"

echo ">>> cloudformation deploy ${DR_BACKEND_STACK} (${DR_REGION})"
"${AWS[@]}" cloudformation deploy \
  --stack-name "$DR_BACKEND_STACK" \
  --template-file "$TEMPLATE" \
  --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
  --region "$DR_REGION" \
  --no-fail-on-empty-changeset \
  --parameter-overrides "${OVERRIDE_ARGS[@]}"

ALB="$("${AWS[@]}" cloudformation describe-stacks \
  --stack-name "$DR_BACKEND_STACK" \
  --region "$DR_REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='ALBDNSName'].OutputValue | [0]" \
  --output text 2>/dev/null || true)"

echo ""
echo "========================================="
echo "DR backend deploy finished"
echo "========================================="
echo "ALB DNS: ${ALB:-<see CloudFormation Outputs ALBDNSName>}"
echo "Example: curl -sk \"https://${ALB}/health\""
echo ""
