# ============================================================================
# Deploy Tenant Provisioning Stack
# ============================================================================
# This script deploys:
# - Lambda functions for tenant provisioning
# - Step Functions state machine
# - DynamoDB table for tracking
# - API Gateway endpoint
# ============================================================================

# Load configuration
. "$PSScriptRoot/config.ps1"

Write-Status "Starting Tenant Provisioning Stack Deployment" "Magenta"

# Get required info from other stacks
$VPC_ID = Get-StackOutput $STACK_BACKEND "VPCId"
$PRIVATE_SUBNET_1 = Get-StackOutput $STACK_BACKEND "PrivateSubnet1"
$PRIVATE_SUBNET_2 = Get-StackOutput $STACK_BACKEND "PrivateSubnet2"
$KMS_KEY = Get-StackOutput $STACK_BACKEND "KMSKeyArn"

# Get Aurora management cluster info
$MGMT_SECRET = Get-StackOutput $STACK_AURORA_MGMT "SecretArn"
$MGMT_ENDPOINT = Get-StackOutput $STACK_AURORA_MGMT "ClusterEndpoint"
$MGMT_SG = Get-StackOutput $STACK_AURORA_MGMT "SecurityGroupId"

if (-not $VPC_ID) {
    Write-Status "ERROR: Backend stack not found. Deploy backend first!" "Red"
    exit 1
}

if (-not $MGMT_SECRET) {
    Write-Status "ERROR: Aurora management stack not found. Deploy Aurora first!" "Red"
    exit 1
}

Write-Status "VPC: $VPC_ID"
Write-Status "Management DB: $MGMT_ENDPOINT"

# Deploy tenant provisioning stack
Write-Status "Deploying tenant provisioning stack..."

$params = @(
    "ParameterKey=ProjectName,ParameterValue=$PROJECT_NAME"
    "ParameterKey=Environment,ParameterValue=$ENVIRONMENT"
    "ParameterKey=VPCId,ParameterValue=$VPC_ID"
    "ParameterKey=PrivateSubnet1,ParameterValue=$PRIVATE_SUBNET_1"
    "ParameterKey=PrivateSubnet2,ParameterValue=$PRIVATE_SUBNET_2"
    "ParameterKey=ManagementDBSecretArn,ParameterValue=$MGMT_SECRET"
    "ParameterKey=ManagementDBEndpoint,ParameterValue=$MGMT_ENDPOINT"
    "ParameterKey=ManagementDBSecurityGroupId,ParameterValue=$MGMT_SG"
    "ParameterKey=KMSKeyArn,ParameterValue=$KMS_KEY"
)

if (Test-StackExists $STACK_TENANT_PROVISIONING) {
    Write-Status "Stack exists, updating..."
    aws cloudformation update-stack `
        --stack-name $STACK_TENANT_PROVISIONING `
        --template-body "file://$TEMPLATE_PROVISIONING" `
        --parameters $params `
        --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM `
        --profile $env:AWS_PROFILE `
        --region $env:AWS_REGION
    
    if ($LASTEXITCODE -eq 0) {
        Wait-ForStack $STACK_TENANT_PROVISIONING "stack-update-complete"
    }
} else {
    Write-Status "Creating new stack..."
    aws cloudformation create-stack `
        --stack-name $STACK_TENANT_PROVISIONING `
        --template-body "file://$TEMPLATE_PROVISIONING" `
        --parameters $params `
        --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM `
        --tags Key=Project,Value=$PROJECT_NAME Key=Environment,Value=$ENVIRONMENT `
        --profile $env:AWS_PROFILE `
        --region $env:AWS_REGION
    
    Wait-ForStack $STACK_TENANT_PROVISIONING "stack-create-complete"
}

# Display outputs
Write-Status "Stack Outputs:" "Green"
aws cloudformation describe-stacks `
    --stack-name $STACK_TENANT_PROVISIONING `
    --profile $env:AWS_PROFILE `
    --region $env:AWS_REGION `
    --query 'Stacks[0].Outputs[*].[OutputKey,OutputValue]' `
    --output table

$API_ENDPOINT = Get-StackOutput $STACK_TENANT_PROVISIONING "ProvisioningAPIEndpoint"

Write-Status "Deployment Complete!" "Green"
Write-Host ""
Write-Host "Provisioning API: $API_ENDPOINT" -ForegroundColor Cyan
Write-Host ""
Write-Host "To provision a new tenant, send POST to:" -ForegroundColor Yellow
Write-Host "  $API_ENDPOINT"
Write-Host ""
Write-Host "Request body:" -ForegroundColor Yellow
Write-Host @"
{
  "tenantId": "uuid",
  "tenantName": "Acme Corp",
  "tenantSlug": "acme-corp",
  "clusterId": "tenant-001",
  "clusterEndpoint": "<tenant-cluster-endpoint>",
  "adminEmail": "admin@acme.com"
}
"@
