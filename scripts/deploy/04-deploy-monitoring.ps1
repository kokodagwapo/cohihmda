# ============================================================================
# Deploy Monitoring Stack
# ============================================================================
# This script deploys:
# - CloudWatch Dashboard
# - Critical and Warning alarms
# - SNS topics for alerts
# ============================================================================

# Load configuration
. "$PSScriptRoot/config.ps1"

Write-Status "Starting Monitoring Stack Deployment" "Magenta"

# Get required info from backend stack
$ECS_CLUSTER = Get-StackOutput $STACK_BACKEND "ECSClusterName"
$ECS_SERVICE = Get-StackOutput $STACK_BACKEND "ECSServiceName"
$ALB_FULL_NAME = Get-StackOutput $STACK_BACKEND "ALBFullName"
$TG_FULL_NAME = Get-StackOutput $STACK_BACKEND "TargetGroupFullName"

if (-not $ECS_CLUSTER) {
    Write-Status "ERROR: Backend stack not found. Deploy backend first!" "Red"
    exit 1
}

if (-not $ALB_FULL_NAME -or -not $TG_FULL_NAME) {
    Write-Status "WARNING: ALB/TargetGroup full names not found. Redeploy backend stack to add these outputs." "Yellow"
    Write-Status "Monitoring alarms for ALB metrics will not work until these are available." "Yellow"
}

# Get Aurora instance identifier (for CloudWatch metrics)
# Aurora Serverless v2 creates instances named {cluster}-instance
$AURORA_CLUSTER_ID = "$PROJECT_NAME-$ENVIRONMENT-management"
$AURORA_INSTANCE_ID = "$AURORA_CLUSTER_ID-instance"

# ECS log group (same name as in coheus_ecs_fargate_stack.yaml)
$ECS_LOG_GROUP = "/ecs/$PROJECT_NAME-$ENVIRONMENT"

Write-Status "ECS Cluster: $ECS_CLUSTER"
Write-Status "ECS Service: $ECS_SERVICE"
Write-Status "ALB Full Name: $ALB_FULL_NAME"
Write-Status "Target Group Full Name: $TG_FULL_NAME"
Write-Status "Aurora Instance: $AURORA_INSTANCE_ID"
Write-Status "ECS Log Group: $ECS_LOG_GROUP"

# Deploy monitoring stack
Write-Status "Deploying monitoring stack..."

$params = @(
    "ParameterKey=ProjectName,ParameterValue=$PROJECT_NAME"
    "ParameterKey=Environment,ParameterValue=$ENVIRONMENT"
    "ParameterKey=ECSClusterName,ParameterValue=$ECS_CLUSTER"
    "ParameterKey=ECSServiceName,ParameterValue=$ECS_SERVICE"
    "ParameterKey=RDSInstanceIdentifier,ParameterValue=$AURORA_INSTANCE_ID"
    "ParameterKey=ECSLogGroupName,ParameterValue=$ECS_LOG_GROUP"
)

if ($ALB_FULL_NAME -and $TG_FULL_NAME) {
    $params += "ParameterKey=ALBFullName,ParameterValue=$ALB_FULL_NAME"
    $params += "ParameterKey=TargetGroupFullName,ParameterValue=$TG_FULL_NAME"
} else {
    Write-Status "Skipping ALB/TargetGroup params (not yet available). ALB alarms will be disabled." "Yellow"
}

if ($ALERT_EMAIL) {
    $params += "ParameterKey=AlertEmail,ParameterValue=$ALERT_EMAIL"
}

if ($BACKEND_ORIGIN_DOMAIN) {
    $params += "ParameterKey=HealthCheckDomain,ParameterValue=$BACKEND_ORIGIN_DOMAIN"
} else {
    Write-Status "Skipping HealthCheckDomain (BACKEND_ORIGIN_DOMAIN not set). Route 53 uptime check will be disabled." "Yellow"
}

$params += "ParameterKey=RDSClusterIdentifier,ParameterValue=$AURORA_CLUSTER_ID"

if ($env:TEAMS_WEBHOOK_URL) {
    $params += "ParameterKey=TeamsWebhookUrl,ParameterValue=$env:TEAMS_WEBHOOK_URL"
}

if (Test-StackExists $STACK_MONITORING) {
    Write-Status "Stack exists, updating..."
    aws cloudformation update-stack `
        --stack-name $STACK_MONITORING `
        --template-body "file://$TEMPLATE_MONITORING" `
        --parameters $params `
        --profile $env:AWS_PROFILE `
        --region $env:AWS_REGION
    
    if ($LASTEXITCODE -eq 0) {
        Wait-ForStack $STACK_MONITORING "stack-update-complete"
    }
} else {
    Write-Status "Creating new stack..."
    aws cloudformation create-stack `
        --stack-name $STACK_MONITORING `
        --template-body "file://$TEMPLATE_MONITORING" `
        --parameters $params `
        --tags Key=Project,Value=$PROJECT_NAME Key=Environment,Value=$ENVIRONMENT `
        --profile $env:AWS_PROFILE `
        --region $env:AWS_REGION
    
    Wait-ForStack $STACK_MONITORING "stack-create-complete"
}

# Display outputs
Write-Status "Stack Outputs:" "Green"
aws cloudformation describe-stacks `
    --stack-name $STACK_MONITORING `
    --profile $env:AWS_PROFILE `
    --region $env:AWS_REGION `
    --query 'Stacks[0].Outputs[*].[OutputKey,OutputValue]' `
    --output table

$DASHBOARD_URL = Get-StackOutput $STACK_MONITORING "DashboardURL"

Write-Status "Deployment Complete!" "Green"
Write-Host ""
Write-Host "CloudWatch Dashboard: $DASHBOARD_URL" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host "  1. Confirm SNS subscription email"
Write-Host "  2. Set env TEAMS_WEBHOOK_URL and redeploy to enable Microsoft Teams notifications (optional)"
Write-Host "  3. Review and customize alarm thresholds"
