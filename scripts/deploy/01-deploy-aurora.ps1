# ============================================================================
# Deploy Aurora Serverless v2 Clusters (Step 1)
# ============================================================================
# MUST BE DEPLOYED FIRST - ECS Backend depends on Aurora endpoints
#
# This script deploys:
# - Management Aurora cluster (tenant registry)
# - First tenant Aurora cluster
# ============================================================================

param(
    [ValidateSet("management", "tenant")]
    [string]$ClusterType = "management",
    [string]$TenantClusterId = "001"
)

# Load configuration
. "$PSScriptRoot/config.ps1"

Write-Status "Starting Aurora Cluster Deployment" "Magenta"

# Use existing VPC from config
if ($USE_EXISTING_VPC) {
    $VPC_ID = $EXISTING_VPC_ID
    $PRIVATE_SUBNET_1 = $EXISTING_PRIVATE_SUBNET_1
    $PRIVATE_SUBNET_2 = $EXISTING_PRIVATE_SUBNET_2
    Write-Status "Using existing VPC: $VPC_ID"
} else {
    Write-Status "ERROR: USE_EXISTING_VPC must be enabled. Edit config.ps1" "Red"
    exit 1
}

if (-not $PRIVATE_SUBNET_1 -or -not $PRIVATE_SUBNET_2) {
    Write-Status "ERROR: Private subnets not found in VPC $VPC_ID" "Red"
    Write-Status "Ensure VPC has at least 2 private subnets (MapPublicIpOnLaunch=false)" "Yellow"
    exit 1
}

Write-Status "VPC: $VPC_ID"
Write-Status "Private Subnets: $PRIVATE_SUBNET_1, $PRIVATE_SUBNET_2"

# Create or find Aurora security group
$AURORA_SG_NAME = "$PROJECT_NAME-$ENVIRONMENT-aurora-sg"
$AURORA_SG = aws ec2 describe-security-groups `
    --filters "Name=vpc-id,Values=$VPC_ID" "Name=group-name,Values=$AURORA_SG_NAME" `
    --profile $env:AWS_PROFILE `
    --region $env:AWS_REGION `
    --query 'SecurityGroups[0].GroupId' `
    --output text 2>$null

if (-not $AURORA_SG -or $AURORA_SG -eq "None") {
    Write-Status "Creating Aurora security group..."
    $AURORA_SG = aws ec2 create-security-group `
        --group-name $AURORA_SG_NAME `
        --description "Security group for Aurora Serverless v2 clusters" `
        --vpc-id $VPC_ID `
        --profile $env:AWS_PROFILE `
        --region $env:AWS_REGION `
        --query 'GroupId' `
        --output text
    
    # Allow PostgreSQL from within VPC
    $VPC_CIDR = aws ec2 describe-vpcs --vpc-ids $VPC_ID --profile $env:AWS_PROFILE --region $env:AWS_REGION --query 'Vpcs[0].CidrBlock' --output text
    aws ec2 authorize-security-group-ingress `
        --group-id $AURORA_SG `
        --protocol tcp `
        --port 5432 `
        --cidr $VPC_CIDR `
        --profile $env:AWS_PROFILE `
        --region $env:AWS_REGION
    
    Write-Status "Created Aurora SG: $AURORA_SG" "Green"
} else {
    Write-Status "Using existing Aurora SG: $AURORA_SG"
}

# Function to deploy Aurora cluster
function Deploy-AuroraCluster {
    param(
        [string]$StackName,
        [string]$Type,
        [string]$ClusterId = ""
    )
    
    Write-Status "Deploying Aurora cluster: $StackName ($Type)"
    
    $params = @(
        "ParameterKey=ProjectName,ParameterValue=$PROJECT_NAME"
        "ParameterKey=Environment,ParameterValue=$ENVIRONMENT"
        "ParameterKey=ClusterType,ParameterValue=$Type"
        "ParameterKey=VPCId,ParameterValue=$VPC_ID"
        "ParameterKey=PrivateSubnet1,ParameterValue=$PRIVATE_SUBNET_1"
        "ParameterKey=PrivateSubnet2,ParameterValue=$PRIVATE_SUBNET_2"
        "ParameterKey=AllowedSecurityGroupId,ParameterValue=$AURORA_SG"
    )
    
    if ($Type -eq "management") {
        $params += "ParameterKey=MinACU,ParameterValue=0.5"
        $params += "ParameterKey=MaxACU,ParameterValue=4"
    } else {
        $params += "ParameterKey=ClusterIdentifier,ParameterValue=$ClusterId"
        $params += "ParameterKey=MinACU,ParameterValue=0.5"
        $params += "ParameterKey=MaxACU,ParameterValue=8"
    }
    
    if (Test-StackExists $StackName) {
        Write-Status "Stack exists, updating..."
        aws cloudformation update-stack `
            --stack-name $StackName `
            --template-body "file://$TEMPLATE_AURORA" `
            --parameters $params `
            --capabilities CAPABILITY_IAM `
            --profile $env:AWS_PROFILE `
            --region $env:AWS_REGION
        
        if ($LASTEXITCODE -eq 0) {
            Wait-ForStack $StackName "stack-update-complete"
        }
    } else {
        Write-Status "Creating new stack..."
        aws cloudformation create-stack `
            --stack-name $StackName `
            --template-body "file://$TEMPLATE_AURORA" `
            --parameters $params `
            --capabilities CAPABILITY_IAM `
            --tags Key=Project,Value=$PROJECT_NAME Key=Environment,Value=$ENVIRONMENT Key=ClusterType,Value=$Type `
            --profile $env:AWS_PROFILE `
            --region $env:AWS_REGION
        
        Wait-ForStack $StackName "stack-create-complete"
    }
    
    # Display outputs
    Write-Status "Cluster outputs:"
    aws cloudformation describe-stacks `
        --stack-name $StackName `
        --profile $env:AWS_PROFILE `
        --region $env:AWS_REGION `
        --query 'Stacks[0].Outputs[*].[OutputKey,OutputValue]' `
        --output table
}

# Deploy the cluster
if ($ClusterType -eq "management") {
    Deploy-AuroraCluster -StackName $STACK_AURORA_MGMT -Type "management"
} elseif ($ClusterType -eq "tenant") {
    # Only use this for dedicated tenant clusters (premium/enterprise clients)
    $tenantStackName = "$PROJECT_NAME-$ENVIRONMENT-aurora-tenant-$TenantClusterId"
    Deploy-AuroraCluster -StackName $tenantStackName -Type "tenant" -ClusterId $TenantClusterId
}

Write-Status "Aurora Deployment Complete!" "Green"
Write-Host ""
Write-Host "Management Cluster Endpoint:" -ForegroundColor Cyan
$mgmtEndpoint = Get-StackOutput $STACK_AURORA_MGMT "ClusterEndpoint"
$mgmtSecretArn = Get-StackOutput $STACK_AURORA_MGMT "SecretArn"
Write-Host "  Endpoint: $mgmtEndpoint"
Write-Host "  Secret ARN: $mgmtSecretArn"
Write-Host ""
Write-Host "NEXT: Deploy ECS Fargate backend with:" -ForegroundColor Yellow
Write-Host "  .\02-deploy-backend.ps1"
