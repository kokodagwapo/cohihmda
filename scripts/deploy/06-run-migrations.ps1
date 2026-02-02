# ============================================================================
# Run Database Migrations via ECS Exec
# ============================================================================
# This script runs database migrations inside an ECS task using ECS Exec.
# The task is already in the VPC and can reach Aurora directly.
#
# Prerequisites:
# - Backend deployed (02-deploy-backend.ps1)
# - AWS Session Manager plugin installed
#   https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html
#
# Options:
# -DryRun           Preview migrations without applying
# -Interactive      Open interactive shell in container (for manual commands)
# ============================================================================

param(
    [switch]$DryRun,
    [switch]$Interactive,
    [switch]$EnableExec
)

# Load configuration
. "$PSScriptRoot/config.ps1"

Write-Status "Database Migration Runner (via ECS Exec)" "Magenta"

# ============================================================================
# Get ECS Task Info
# ============================================================================
$ECS_CLUSTER = Get-StackOutput $STACK_BACKEND "ECSClusterName"
$ECS_SERVICE = Get-StackOutput $STACK_BACKEND "ECSServiceName"

if (-not $ECS_CLUSTER) {
    Write-Status "ERROR: Backend stack not found. Deploy backend first!" "Red"
    exit 1
}

Write-Status "Cluster: $ECS_CLUSTER"
Write-Status "Service: $ECS_SERVICE"

# ============================================================================
# Enable ECS Exec (if requested or first time)
# ============================================================================
if ($EnableExec) {
    Write-Status "Enabling ECS Exec on service..."
    
    aws ecs update-service `
        --cluster $ECS_CLUSTER `
        --service $ECS_SERVICE `
        --enable-execute-command `
        --profile $env:AWS_PROFILE `
        --region $env:AWS_REGION `
        --output text > $null
    
    Write-Status "Forcing new deployment to apply ECS Exec..."
    aws ecs update-service `
        --cluster $ECS_CLUSTER `
        --service $ECS_SERVICE `
        --force-new-deployment `
        --profile $env:AWS_PROFILE `
        --region $env:AWS_REGION `
        --output text > $null
    
    Write-Status "Waiting for deployment to stabilize (this may take a few minutes)..."
    aws ecs wait services-stable `
        --cluster $ECS_CLUSTER `
        --services $ECS_SERVICE `
        --profile $env:AWS_PROFILE `
        --region $env:AWS_REGION
    
    Write-Status "ECS Exec enabled!" "Green"
}

# ============================================================================
# Check if ECS Exec is enabled
# ============================================================================
$execEnabled = aws ecs describe-services `
    --cluster $ECS_CLUSTER `
    --services $ECS_SERVICE `
    --profile $env:AWS_PROFILE `
    --region $env:AWS_REGION `
    --query 'services[0].enableExecuteCommand' `
    --output text

if ($execEnabled -ne "True") {
    Write-Status "ECS Exec is not enabled on this service." "Yellow"
    Write-Status "Run: .\06-run-migrations.ps1 -EnableExec" "Cyan"
    Write-Status "This will enable ECS Exec and redeploy the service (takes ~2-3 minutes)." "Gray"
    exit 1
}

# ============================================================================
# Get Running Task
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
# Run Migration Command
# ============================================================================
$CONTAINER_NAME = "coheus-backend"

if ($Interactive) {
    Write-Status "Opening interactive shell in container..."
    Write-Host ""
    Write-Host "You're now inside the container. Run migrations with:" -ForegroundColor Cyan
    Write-Host "  cd /app/server && npx tsx src/migrations/cli.ts up --verbose" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Type 'exit' to leave the container." -ForegroundColor Yellow
    Write-Host ""
    
    aws ecs execute-command `
        --cluster $ECS_CLUSTER `
        --task $TASK_ARN `
        --container $CONTAINER_NAME `
        --interactive `
        --command "/bin/sh" `
        --profile $env:AWS_PROFILE `
        --region $env:AWS_REGION
} else {
    # Build migration command
    $migrationCmd = "cd /app/server && npx tsx src/migrations/cli.ts up --verbose"
    
    if ($DryRun) {
        $migrationCmd = "cd /app/server && npx tsx src/migrations/cli.ts up --dry-run --verbose"
        Write-Status "DRY RUN MODE - No changes will be made" "Yellow"
    }
    
    Write-Status "Running migrations inside ECS task..."
    Write-Host "  Command: $migrationCmd" -ForegroundColor Gray
    Write-Host ""
    
    # Use a here-string to avoid PowerShell escaping issues
    $shellCmd = "/bin/sh -c '$migrationCmd'"
    
    aws ecs execute-command `
        --cluster $ECS_CLUSTER `
        --task $TASK_ARN `
        --container $CONTAINER_NAME `
        --interactive `
        --command $shellCmd `
        --profile $env:AWS_PROFILE `
        --region $env:AWS_REGION
    
    if ($LASTEXITCODE -ne 0) {
        Write-Status "Migration may have failed. Check output above." "Yellow"
        exit 1
    }
}

Write-Host ""
Write-Status "Done!" "Green"
