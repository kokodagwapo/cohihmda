# ============================================================================
# Deploy Aurora Serverless v2 Cluster (Step 1)
# ============================================================================
# All resources defined in CloudFormation - no CLI resource creation
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
if (-not $USE_EXISTING_VPC) {
    Write-Status "ERROR: USE_EXISTING_VPC must be enabled. Edit config.ps1" "Red"
    exit 1
}

if (-not $EXISTING_PRIVATE_SUBNET_1 -or -not $EXISTING_PRIVATE_SUBNET_2) {
    Write-Status "ERROR: Private subnets not found in VPC $EXISTING_VPC_ID" "Red"
    exit 1
}

# Get VPC CIDR for security group
$VPC_CIDR = aws ec2 describe-vpcs `
    --vpc-ids $EXISTING_VPC_ID `
    --profile $env:AWS_PROFILE `
    --region $env:AWS_REGION `
    --query 'Vpcs[0].CidrBlock' `
    --output text

Write-Status "VPC: $EXISTING_VPC_ID (CIDR: $VPC_CIDR)"
Write-Status "Private Subnets: $EXISTING_PRIVATE_SUBNET_1, $EXISTING_PRIVATE_SUBNET_2"

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
        "ParameterKey=VPCId,ParameterValue=$EXISTING_VPC_ID"
        "ParameterKey=PrivateSubnet1,ParameterValue=$EXISTING_PRIVATE_SUBNET_1"
        "ParameterKey=PrivateSubnet2,ParameterValue=$EXISTING_PRIVATE_SUBNET_2"
        "ParameterKey=AllowedCIDR,ParameterValue=$VPC_CIDR"
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
        } else {
            Write-Status "No updates to perform" "Yellow"
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
Write-Host "Cluster Endpoint:" -ForegroundColor Cyan
$mgmtEndpoint = Get-StackOutput $STACK_AURORA_MGMT "ClusterEndpoint"
$mgmtSecretArn = Get-StackOutput $STACK_AURORA_MGMT "SecretArn"
Write-Host "  Endpoint:   $mgmtEndpoint"
Write-Host "  Secret ARN: $mgmtSecretArn"
Write-Host ""
Write-Host "NEXT: Deploy ECS Fargate backend with:" -ForegroundColor Yellow
Write-Host "  .\02-deploy-backend.ps1"
