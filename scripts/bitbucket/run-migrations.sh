#!/bin/bash
# ============================================================================
# Run Database Migrations via ECS Exec
# ============================================================================
# Runs migrations inside an existing ECS task using ECS Exec.
# The task is already in the VPC and can reach Aurora directly.
#
# Required environment variables:
#   AWS_REGION          - AWS region
#   ECS_CLUSTER         - ECS cluster name (e.g., coheus-dev-cluster)
#   ECS_SERVICE         - ECS service name (e.g., coheus-dev-service)
#
# Optional:
#   DRY_RUN             - Set to "true" for dry run mode
# ============================================================================

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# ============================================================================
# Validate Environment
# ============================================================================
validate_env() {
    log_info "Validating environment variables..."
    
    local missing=()
    
    [[ -z "${AWS_REGION:-}" ]] && missing+=("AWS_REGION")
    [[ -z "${ECS_CLUSTER:-}" ]] && missing+=("ECS_CLUSTER")
    [[ -z "${ECS_SERVICE:-}" ]] && missing+=("ECS_SERVICE")
    
    if [[ ${#missing[@]} -gt 0 ]]; then
        log_error "Missing required environment variables: ${missing[*]}"
        exit 1
    fi
    
    log_success "Environment validated"
}

# ============================================================================
# Install Session Manager Plugin (required for ECS Exec)
# ============================================================================
install_session_manager_plugin() {
    if command -v session-manager-plugin &> /dev/null; then
        log_info "Session Manager plugin already installed"
        return 0
    fi
    
    log_info "Installing AWS Session Manager plugin..."
    
    curl -s "https://s3.amazonaws.com/session-manager-downloads/plugin/latest/ubuntu_64bit/session-manager-plugin.deb" -o "session-manager-plugin.deb"
    dpkg -i session-manager-plugin.deb || apt-get install -f -y
    rm -f session-manager-plugin.deb
    
    log_success "Session Manager plugin installed"
}

# ============================================================================
# Check if ECS Exec is enabled
# ============================================================================
check_ecs_exec_enabled() {
    log_info "Checking if ECS Exec is enabled..."
    
    local exec_enabled
    exec_enabled=$(aws ecs describe-services \
        --cluster "$ECS_CLUSTER" \
        --services "$ECS_SERVICE" \
        --region "$AWS_REGION" \
        --query 'services[0].enableExecuteCommand' \
        --output text)
    
    if [[ "$exec_enabled" != "True" ]]; then
        log_error "ECS Exec is not enabled on service: $ECS_SERVICE"
        log_warning "Enable it manually with:"
        echo "  aws ecs update-service --cluster $ECS_CLUSTER --service $ECS_SERVICE --enable-execute-command --force-new-deployment"
        exit 1
    fi
    
    log_success "ECS Exec is enabled"
}

# ============================================================================
# Get Running Task ARN
# ============================================================================
get_running_task() {
    log_info "Finding running task in cluster: $ECS_CLUSTER"
    
    TASK_ARN=$(aws ecs list-tasks \
        --cluster "$ECS_CLUSTER" \
        --service-name "$ECS_SERVICE" \
        --desired-status RUNNING \
        --region "$AWS_REGION" \
        --query 'taskArns[0]' \
        --output text)
    
    if [[ -z "$TASK_ARN" || "$TASK_ARN" == "None" ]]; then
        log_error "No running tasks found. Is the service running?"
        exit 1
    fi
    
    TASK_ID="${TASK_ARN##*/}"
    log_success "Found task: $TASK_ID"
}

# ============================================================================
# Run Migrations
# ============================================================================
run_migrations() {
    local container_name="coheus-backend"
    # Use compiled JS in production container (no src/ directory)
    # Use 'all' command to run both management AND tenant migrations
    local migration_cmd="cd /app/server && node dist/migrations/cli.js all --verbose"
    
    if [[ "${DRY_RUN:-false}" == "true" ]]; then
        migration_cmd="cd /app/server && node dist/migrations/cli.js all --dry-run --verbose"
        log_warning "DRY RUN MODE - No changes will be made"
    fi
    
    log_info "Running migrations inside ECS task..."
    echo "  Cluster: $ECS_CLUSTER"
    echo "  Service: $ECS_SERVICE"
    echo "  Task: $TASK_ID"
    echo "  Command: $migration_cmd"
    echo ""
    
    # Run command via ECS Exec
    # Note: Using /bin/sh -c to run the command non-interactively
    aws ecs execute-command \
        --cluster "$ECS_CLUSTER" \
        --task "$TASK_ARN" \
        --container "$container_name" \
        --command "/bin/sh -c '$migration_cmd'" \
        --interactive \
        --region "$AWS_REGION"
    
    local exit_code=$?
    
    if [[ $exit_code -ne 0 ]]; then
        log_error "Migration command exited with code: $exit_code"
        exit $exit_code
    fi
    
    log_success "Migrations completed successfully"
}

# ============================================================================
# Main
# ============================================================================
run_unified_chat_backfill_if_dev() {
    if [[ "${UNIFIED_CHAT_LEGACY_BACKFILL_ENABLED:-true}" == "false" ]]; then
        log_warning "Skipping unified chat backfill (UNIFIED_CHAT_LEGACY_BACKFILL_ENABLED=false)"
        return 0
    fi
    if [[ "${BITBUCKET_DEPLOYMENT_ENVIRONMENT:-}" != "dev" ]]; then
        log_info "Skipping unified chat backfill (deployment is not dev)"
        return 0
    fi

    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    log_info "Running unified chat legacy backfill (dev)..."
    chmod +x "${script_dir}/run-unified-chat-backfill.sh"
    "${script_dir}/run-unified-chat-backfill.sh"
}

main() {
    echo "=============================================="
    echo "  Database Migration Runner (ECS Exec)"
    echo "=============================================="
    echo ""
    
    validate_env
    install_session_manager_plugin
    check_ecs_exec_enabled
    get_running_task
    run_migrations
    run_unified_chat_backfill_if_dev
    
    echo ""
    log_success "Done!"
}

main "$@"
