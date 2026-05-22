#!/bin/bash
# ============================================================================
# Backfill unified chat legacy research sessions via ECS Exec (dev deploy hook)
# ============================================================================
# Idempotent: links research_sessions → unified_chat_conversations per tenant.
# Runs after migrations when unified chat tables exist.
#
# Required environment variables:
#   AWS_REGION, ECS_CLUSTER, ECS_SERVICE
#
# Optional:
#   UNIFIED_CHAT_LEGACY_BACKFILL_ENABLED=false  — skip backfill
# ============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

validate_env() {
  local missing=()
  [[ -z "${AWS_REGION:-}" ]] && missing+=("AWS_REGION")
  [[ -z "${ECS_CLUSTER:-}" ]] && missing+=("ECS_CLUSTER")
  [[ -z "${ECS_SERVICE:-}" ]] && missing+=("ECS_SERVICE")
  if [[ ${#missing[@]} -gt 0 ]]; then
    log_error "Missing required environment variables: ${missing[*]}"
    exit 1
  fi
}

install_session_manager_plugin() {
  if command -v session-manager-plugin &> /dev/null; then
    return 0
  fi
  log_info "Installing AWS Session Manager plugin..."
  curl -s "https://s3.amazonaws.com/session-manager-downloads/plugin/latest/ubuntu_64bit/session-manager-plugin.deb" -o "session-manager-plugin.deb"
  dpkg -i session-manager-plugin.deb || apt-get install -f -y
  rm -f session-manager-plugin.deb
}

get_running_task() {
  TASK_ARN=$(aws ecs list-tasks \
    --cluster "$ECS_CLUSTER" \
    --service-name "$ECS_SERVICE" \
    --desired-status RUNNING \
    --region "$AWS_REGION" \
    --query 'taskArns[0]' \
    --output text)

  if [[ -z "$TASK_ARN" || "$TASK_ARN" == "None" ]]; then
    log_error "No running tasks found."
    exit 1
  fi

  TASK_ID="${TASK_ARN##*/}"
  log_success "Found task: $TASK_ID"
}

run_backfill() {
  local container_name="coheus-backend"
  local backfill_cmd="cd /app/server && node dist/migrations/backfillUnifiedChatCli.js --all"

  log_info "Running unified chat legacy backfill inside ECS task..."
  echo "  Command: $backfill_cmd"

  aws ecs execute-command \
    --cluster "$ECS_CLUSTER" \
    --task "$TASK_ARN" \
    --container "$container_name" \
    --command "/bin/sh -c '$backfill_cmd'" \
    --interactive \
    --region "$AWS_REGION"

  local exit_code=$?
  if [[ $exit_code -ne 0 ]]; then
    log_error "Backfill command exited with code: $exit_code"
    exit $exit_code
  fi

  log_success "Unified chat legacy backfill completed"
}

main() {
  echo "=============================================="
  echo "  Unified Chat Legacy Backfill (ECS Exec)"
  echo "=============================================="
  echo ""

  if [[ "${UNIFIED_CHAT_LEGACY_BACKFILL_ENABLED:-true}" == "false" ]]; then
    log_warning "Skipping backfill (UNIFIED_CHAT_LEGACY_BACKFILL_ENABLED=false)"
    exit 0
  fi

  validate_env
  install_session_manager_plugin
  get_running_task
  run_backfill
}

main "$@"
