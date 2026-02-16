# ============================================================================
# Cleanup Management Database via ECS Exec
# ============================================================================
# Drops orphan tenant tables and legacy auth schema from coheus_management.
# These tables were incorrectly created by the legacy runMigrations() and
# are no longer referenced by any management-level code.
#
# Prerequisites:
# - Backend deployed with ECS Exec enabled
# - Code changes from database schema cleanup already deployed
#
# Options:
# -DryRun       Preview what will be dropped without actually dropping
# -Prod         Run against prod (default is dev)
# ============================================================================

param(
    [switch]$DryRun,
    [switch]$Prod
)

# Load configuration
. "$PSScriptRoot/config.ps1"

if ($Prod) {
    $ENVIRONMENT = "prod"
    $STACK_BACKEND = "$PROJECT_NAME-prod-backend"
    Write-Status "*** PRODUCTION MODE ***" "Red"
    Write-Host ""
    $confirm = Read-Host "Are you sure you want to run cleanup on PRODUCTION? (type 'yes' to confirm)"
    if ($confirm -ne "yes") {
        Write-Status "Aborted." "Yellow"
        exit 0
    }
}

Write-Status "Management DB Cleanup (via ECS Exec) - Environment: $ENVIRONMENT" "Magenta"

# ============================================================================
# Get ECS Task Info
# ============================================================================
$ECS_CLUSTER = Get-StackOutput $STACK_BACKEND "ECSClusterName"
$ECS_SERVICE = Get-StackOutput $STACK_BACKEND "ECSServiceName"

if (-not $ECS_CLUSTER) {
    Write-Status "ERROR: Backend stack '$STACK_BACKEND' not found. Deploy backend first!" "Red"
    exit 1
}

Write-Status "Cluster: $ECS_CLUSTER"
Write-Status "Service: $ECS_SERVICE"

# ============================================================================
# Find Running Task
# ============================================================================
Write-Status "Finding running task..."

$TASK_ARN = aws ecs list-tasks `
    --cluster $ECS_CLUSTER `
    --service-name $ECS_SERVICE `
    --desired-status RUNNING `
    --profile $env:AWS_PROFILE `
    --region $env:AWS_REGION `
    --query 'taskArns[0]' `
    --output text

if (-not $TASK_ARN -or $TASK_ARN -eq "None") {
    Write-Status "ERROR: No running tasks found. Is the service running?" "Red"
    exit 1
}

$TASK_ID = $TASK_ARN.Split('/')[-1]
Write-Status "Task: $TASK_ID" "Green"

# ============================================================================
# Build SQL
# ============================================================================
$CONTAINER_NAME = "coheus-backend"

# The SQL to execute (mirrors scripts/cleanup-management-db.sql)
$SQL = @"
-- Tenant tables that were misplaced in management DB
DROP TABLE IF EXISTS public.call_sessions CASCADE;
DROP TABLE IF EXISTS public.contacts CASCADE;
DROP TABLE IF EXISTS public.documents CASCADE;
DROP TABLE IF EXISTS public.loans CASCADE;
DROP TABLE IF EXISTS public.los_connections CASCADE;
DROP TABLE IF EXISTS public.los_sync_logs CASCADE;
DROP TABLE IF EXISTS public.vendor_connections CASCADE;
DROP TABLE IF EXISTS public.vendor_sync_logs CASCADE;
DROP TABLE IF EXISTS public.tenant_field_mappings CASCADE;
DROP TABLE IF EXISTS public.encompass_field_swaps CASCADE;
DROP TABLE IF EXISTS public.encompass_token_cache CASCADE;
DROP TABLE IF EXISTS public.encompass_concurrency_metrics CASCADE;
DROP TABLE IF EXISTS public.rag_settings CASCADE;
DROP TABLE IF EXISTS public.rag_document_sources CASCADE;
DROP TABLE IF EXISTS public.rag_documents CASCADE;
DROP TABLE IF EXISTS public.user_sessions CASCADE;
DROP TABLE IF EXISTS public.failed_login_attempts CASCADE;
DROP TABLE IF EXISTS public.data_access_logs CASCADE;
DROP TABLE IF EXISTS public.audit_logs CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;
DROP TABLE IF EXISTS public.users CASCADE;
DROP TABLE IF EXISTS public.tenants CASCADE;
DROP TABLE IF EXISTS public.deployment_instances CASCADE;
DROP TABLE IF EXISTS public.aws_deployments CASCADE;
DROP TABLE IF EXISTS public.aws_billing_history CASCADE;
DROP SCHEMA IF EXISTS auth CASCADE;
SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;
"@

if ($DryRun) {
    # In dry-run mode, just list the tables that WOULD be dropped
    Write-Status "DRY RUN - Checking which tables exist (no changes will be made)" "Yellow"
    $SQL = @"
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN (
  'call_sessions','contacts','documents','loans','los_connections','los_sync_logs',
  'vendor_connections','vendor_sync_logs','tenant_field_mappings','encompass_field_swaps',
  'encompass_token_cache','encompass_concurrency_metrics','rag_settings','rag_document_sources',
  'rag_documents','user_sessions','failed_login_attempts','data_access_logs','audit_logs',
  'profiles','users','tenants','deployment_instances','aws_deployments','aws_billing_history'
)
ORDER BY table_name;
SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'auth';
"@
}

# ============================================================================
# Execute via psql inside ECS container
# ============================================================================
# Escape single quotes in SQL for shell passthrough
$escapedSQL = $SQL -replace "'", "'\''"

$psqlCmd = "psql -h `$DB_HOST -U `$DB_USER -d coheus_management -c '$escapedSQL'"
$shellCmd = "/bin/sh -c `"PGPASSWORD=`$DB_PASSWORD $psqlCmd`""

if ($DryRun) {
    Write-Status "Tables that would be dropped:" "Cyan"
} else {
    Write-Status "Dropping orphan tables from coheus_management..." "Yellow"
}

Write-Host ""

aws ecs execute-command `
    --cluster $ECS_CLUSTER `
    --task $TASK_ARN `
    --container $CONTAINER_NAME `
    --interactive `
    --command $shellCmd `
    --profile $env:AWS_PROFILE `
    --region $env:AWS_REGION

if ($LASTEXITCODE -ne 0) {
    Write-Status "Command may have failed. Check output above." "Yellow"
    exit 1
}

Write-Host ""
if ($DryRun) {
    Write-Status "Dry run complete. Run without -DryRun to apply changes." "Cyan"
} else {
    Write-Status "Cleanup complete! Remaining tables listed above." "Green"
}
