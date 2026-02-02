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

if (-not $ECS_CLUSTER) {
    Write-Status "ERROR: Backend stack not found. Deploy backend first!" "Red"
    exit 1
}

# Get Aurora instance identifier (for CloudWatch metrics)
# Aurora Serverless v2 creates instances named {cluster}-instance
$AURORA_CLUSTER_ID = "$PROJECT_NAME-$ENVIRONMENT-management"
$AURORA_INSTANCE_ID = "$AURORA_CLUSTER_ID-instance"

Write-Status "ECS Cluster: $ECS_CLUSTER"
Write-Status "ECS Service: $ECS_SERVICE"
Write-Status "Aurora Instance: $AURORA_INSTANCE_ID"

# Deploy monitoring stack
Write-Status "Deploying monitoring stack..."

$params = @(
    "ParameterKey=ProjectName,ParameterValue=$PROJECT_NAME"
    "ParameterKey=Environment,ParameterValue=$ENVIRONMENT"
    "ParameterKey=EBEnvironmentName,ParameterValue=$ECS_SERVICE"
    "ParameterKey=RDSInstanceIdentifier,ParameterValue=$AURORA_INSTANCE_ID"
)

if ($ALERT_EMAIL) {
    $params += "ParameterKey=AlertEmail,ParameterValue=$ALERT_EMAIL"
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
Write-Host "  2. Add Slack webhook to SNS topic (optional)"
Write-Host "  3. Review and customize alarm thresholds"
