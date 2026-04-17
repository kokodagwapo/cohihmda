#!/bin/bash
# ============================================================================
# QA Pipeline Runner — Pipeline Entry Point
# ============================================================================
# Validates required environment variables, then delegates to the TypeScript
# runner via tsx from the server/ workspace (which has tsx in devDependencies).
#
# Required (validated below):
#   E2E_BASE_URL, E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD, E2E_ADMIN_TOTP_SECRET
#
# Required from Bitbucket deployment/repo config:
#   QA_SUITE                  - Suite tag to run (default: critical)
#   CF_STACK_BACKEND          - Backend CloudFormation stack to query for QA resources
#   AWS_REGION / AWS_DEFAULT_REGION
#
# Optional (graceful degradation if missing):
#   QA_COMMIT_RANGE           - Explicit git range to inspect for Jira keys
#   QA_COMMIT_LOOKBACK        - Fallback commit lookback when range is not set
#   QA_ENABLE_AC_VALIDATOR    - Set to "true" to enable Jira AC validation
#   ATLASSIAN_EMAIL
#   ATLASSIAN_SITE_URL
#   CONFLUENCE_QA_PARENT_PAGE_ID - Parent page for per-issue Confluence QA pages
#   QA_JIRA_PROJECT_KEY
#   QA_CREATE_BUGS_IN_PROD    - Set to "true" to enable Jira bug creation in prod
# ============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $1"; }

install_aws_cli() {
  if command -v aws >/dev/null 2>&1; then
    return
  fi

  log_info "Installing AWS CLI..."

  if ! command -v curl >/dev/null 2>&1 || ! command -v unzip >/dev/null 2>&1; then
    log_info "Installing apt prerequisites (curl, unzip)..."
    local attempts=0
    local max_attempts=3
    # Tolerate transient Ubuntu mirror sync failures: retry with apt's built-in
    # retries, then fall back to cached indexes if the mirror is still flaky.
    until apt-get update -qq -o Acquire::Retries=3; do
      attempts=$((attempts + 1))
      if [ "$attempts" -ge "$max_attempts" ]; then
        log_warn "apt-get update failed ${max_attempts}x — continuing with cached indexes"
        break
      fi
      log_warn "apt-get update failed (attempt ${attempts}/${max_attempts}) — retrying in 5s"
      sleep 5
    done
    if ! apt-get install -y -qq --no-install-recommends unzip curl >/dev/null; then
      log_error "Failed to install curl/unzip via apt"
      exit 1
    fi
  fi

  curl -sSfL --retry 5 --retry-delay 2 \
    "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
  unzip -qq awscliv2.zip
  ./aws/install --update >/dev/null
  rm -rf awscliv2.zip aws/
}

require_aws_context() {
  if [ -z "${CF_STACK_BACKEND:-}" ]; then
    log_error "CF_STACK_BACKEND is required so the QA runner can fetch AWS-managed QA resources"
    exit 1
  fi

  if [ -z "${AWS_WEB_IDENTITY_TOKEN_FILE:-}" ] && [ -z "${AWS_ACCESS_KEY_ID:-}" ]; then
    log_error "AWS credentials are not available. Run setup-oidc before this script."
    exit 1
  fi

  export AWS_DEFAULT_REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-2}}"
}

get_stack_output() {
  local output_key="$1"
  aws cloudformation describe-stacks \
    --stack-name "$CF_STACK_BACKEND" \
    --region "$AWS_DEFAULT_REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='${output_key}'].OutputValue | [0]" \
    --output text
}

load_aws_managed_qa_config() {
  log_info "Loading QA pipeline AWS resources from CloudFormation stack..."

  export AI_ARTIFACTS_BUCKET
  AI_ARTIFACTS_BUCKET="$(get_stack_output "QaArtifactsBucketName")"
  local api_key_secret_arn
  local hmac_secret_arn
  local atlassian_token_secret_arn
  local openai_secret_arn
  local evidence_signing_secret_arn
  api_key_secret_arn="$(get_stack_output "QaRunnerApiKeySecretArn")"
  hmac_secret_arn="$(get_stack_output "QaRunnerHmacSecretArn")"
  atlassian_token_secret_arn="$(get_stack_output "QaAtlassianApiTokenSecretArn")"
  openai_secret_arn="$(get_stack_output "QaAiOpenAiKeySecretArn")"
  evidence_signing_secret_arn="$(get_stack_output "QaEvidenceSigningSecretArn")"

  if [ -z "$AI_ARTIFACTS_BUCKET" ] || [ "$AI_ARTIFACTS_BUCKET" = "None" ]; then
    log_error "QaArtifactsBucketName output not found on stack $CF_STACK_BACKEND"
    exit 1
  fi

  if [ -z "$api_key_secret_arn" ] || [ "$api_key_secret_arn" = "None" ]; then
    log_error "QaRunnerApiKeySecretArn output not found on stack $CF_STACK_BACKEND"
    exit 1
  fi

  if [ -z "$hmac_secret_arn" ] || [ "$hmac_secret_arn" = "None" ]; then
    log_error "QaRunnerHmacSecretArn output not found on stack $CF_STACK_BACKEND"
    exit 1
  fi

  export QA_RUNNER_API_KEY
  export QA_RUNNER_HMAC_SECRET
  QA_RUNNER_API_KEY="$(aws secretsmanager get-secret-value --secret-id "$api_key_secret_arn" --region "$AWS_DEFAULT_REGION" --query SecretString --output text)"
  QA_RUNNER_HMAC_SECRET="$(aws secretsmanager get-secret-value --secret-id "$hmac_secret_arn" --region "$AWS_DEFAULT_REGION" --query SecretString --output text)"

  if [ -z "$QA_RUNNER_API_KEY" ] || [ "$QA_RUNNER_API_KEY" = "None" ]; then
    log_error "Failed to load QA_RUNNER_API_KEY from Secrets Manager"
    exit 1
  fi

  if [ -n "$evidence_signing_secret_arn" ] && [ "$evidence_signing_secret_arn" != "None" ]; then
    export QA_EVIDENCE_SIGNING_SECRET
    QA_EVIDENCE_SIGNING_SECRET="$(aws secretsmanager get-secret-value --secret-id "$evidence_signing_secret_arn" --region "$AWS_DEFAULT_REGION" --query SecretString --output text)"
  fi

  if [ -z "$QA_RUNNER_HMAC_SECRET" ] || [ "$QA_RUNNER_HMAC_SECRET" = "None" ]; then
    log_error "Failed to load QA_RUNNER_HMAC_SECRET from Secrets Manager"
    exit 1
  fi

  if [ -n "$atlassian_token_secret_arn" ] && [ "$atlassian_token_secret_arn" != "None" ]; then
    export ATLASSIAN_API_TOKEN
    ATLASSIAN_API_TOKEN="$(aws secretsmanager get-secret-value --secret-id "$atlassian_token_secret_arn" --region "$AWS_DEFAULT_REGION" --query SecretString --output text)"
    if [ "$ATLASSIAN_API_TOKEN" = "__SET_ATLASSIAN_API_TOKEN__" ]; then
      unset ATLASSIAN_API_TOKEN
      log_warn "Atlassian API token secret still has placeholder value — Jira/Confluence reporting will be skipped"
    fi
  else
    log_warn "QaAtlassianApiTokenSecretArn output not found on stack $CF_STACK_BACKEND — Jira/Confluence reporting will be skipped"
  fi

  if [ "${QA_ENABLE_AC_VALIDATOR:-false}" = "true" ]; then
    if [ -z "$openai_secret_arn" ] || [ "$openai_secret_arn" = "None" ]; then
      log_error "QaAiOpenAiKeySecretArn output not found on stack $CF_STACK_BACKEND but QA_ENABLE_AC_VALIDATOR=true"
      exit 1
    fi

    export OPENAI_API_KEY
    OPENAI_API_KEY="$(aws secretsmanager get-secret-value --secret-id "$openai_secret_arn" --region "$AWS_DEFAULT_REGION" --query SecretString --output text)"
    if [ -z "$OPENAI_API_KEY" ] || [ "$OPENAI_API_KEY" = "None" ] || [ "$OPENAI_API_KEY" = "__SET_OPENAI_API_KEY__" ]; then
      log_error "Failed to load a usable OPENAI_API_KEY from Secrets Manager while QA_ENABLE_AC_VALIDATOR=true"
      exit 1
    fi
  fi

  log_success "Loaded AWS-managed QA secrets and artifact bucket"
}

# ---- Required env validation ------------------------------------------------
log_info "Validating required environment variables..."

REQUIRED_VARS="E2E_BASE_URL E2E_ADMIN_EMAIL E2E_ADMIN_PASSWORD E2E_ADMIN_TOTP_SECRET"
for var in $REQUIRED_VARS; do
  value="${!var:-}"
  if [ -z "$value" ]; then
    log_error "Required variable $var is not set"
    exit 1
  fi
  case "$value" in
    \$*) log_error "Variable $var appears to be an unresolved placeholder: $value"; exit 1 ;;
  esac
done

log_success "Environment validated"

if printf '%s' "${E2E_BASE_URL:-}" | tr '[:upper:]' '[:lower:]' | grep -Eq 'prod|production'; then
  log_error "run-ai-qa.sh refuses to target production URLs. Use the dedicated manual prod smoke pipeline instead."
  exit 1
fi

# ---- AWS-managed QA config --------------------------------------------------
require_aws_context
install_aws_cli
load_aws_managed_qa_config

# ---- Optional variable warnings ---------------------------------------------
OPTIONAL_VARS="ATLASSIAN_EMAIL ATLASSIAN_SITE_URL CONFLUENCE_QA_PARENT_PAGE_ID QA_JIRA_PROJECT_KEY"
for var in $OPTIONAL_VARS; do
  if [ -z "${!var:-}" ]; then
    log_warn "$var not set — related reporting step will be skipped"
  fi
done

# ---- Resolve args -----------------------------------------------------------
SUITE="${QA_SUITE:-critical}"
BUILD="${BITBUCKET_BUILD_NUMBER:-local}"
COMMIT="${BITBUCKET_COMMIT:-$(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')}"
export QA_ENABLE_AC_VALIDATOR="${QA_ENABLE_AC_VALIDATOR:-false}"
export QA_AC_DRY_RUN="${QA_AC_DRY_RUN:-false}"

# The AC validator runs the fail-closed audit-ledger registration
# (aiAgentOrchestrator.startAction). That module expects a direct pg
# connection which does not exist inside the Bitbucket runner, so we route
# its writes through the deployed backend's HMAC-signed proxy endpoint
# (/api/internal/ai-ledger) instead.
export QA_LEDGER_BACKEND_URL="${QA_LEDGER_BACKEND_URL:-$E2E_BASE_URL}"

log_info "Suite:       $SUITE"
log_info "Build:       #$BUILD"
log_info "Commit:      $COMMIT"
log_info "Base URL:    $E2E_BASE_URL"
log_info "Backend CF:  $CF_STACK_BACKEND"
log_info "QA bucket:   $AI_ARTIFACTS_BUCKET"
log_info "AC Validator:$QA_ENABLE_AC_VALIDATOR"
log_info "AC Dry Run:  $QA_AC_DRY_RUN"
log_info "Ledger URL:  $QA_LEDGER_BACKEND_URL"

# ---- Install server deps if needed ------------------------------------------
if [ ! -d "server/node_modules" ]; then
  log_info "Installing server dependencies..."
  cd server && npm ci --prefer-offline && cd ..
fi

# ---- Run the TypeScript runner from server/ ---------------------------------
log_info "Starting QA pipeline runner..."

cd server
npx tsx scripts/qa/aiQaRunner.ts \
  --suite="$SUITE" \
  --base-url="$E2E_BASE_URL" \
  --build-number="$BUILD" \
  --commit-hash="$COMMIT"

# Exit code from tsx propagates automatically (set -e)
