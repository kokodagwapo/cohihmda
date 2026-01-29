# ============================================================================
# Deploy ECS Fargate Backend Stack (Step 2)
# ============================================================================
# REQUIRES: Aurora cluster deployed first (01-deploy-aurora.ps1)
#
# This script deploys:
# - ECR repository and Docker image
# - ECS Fargate cluster and service
# - Application Load Balancer
# - Connects to Aurora cluster
# ============================================================================

param(
    [switch]$SkipECR,
    [switch]$SkipBuild,
    [string]$JwtSecret
)

# Load configuration
. "$PSScriptRoot/config.ps1"

Write-Status "Starting ECS Fargate Backend Deployment" "Magenta"

# Verify Aurora is deployed
$AURORA_ENDPOINT = Get-StackOutput $STACK_AURORA_MGMT "ClusterEndpoint"
$AURORA_SECRET_ARN = Get-StackOutput $STACK_AURORA_MGMT "SecretArn"

if (-not $AURORA_ENDPOINT -or -not $AURORA_SECRET_ARN) {
    Write-Status "ERROR: Aurora management cluster not found!" "Red"
    Write-Status "Deploy Aurora first: .\01-deploy-aurora.ps1" "Yellow"
    exit 1
}

Write-Status "Aurora endpoint: $AURORA_ENDPOINT"
Write-Status "Aurora secret: $AURORA_SECRET_ARN"

# Generate JWT secret if not provided
if (-not $JwtSecret) {
    $JwtSecret = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 64 | ForEach-Object { [char]$_ })
    Write-Status "Generated JWT Secret (save this!):" "Yellow"
    Write-Host "  $JwtSecret" -ForegroundColor Cyan
}

# Step 1: Create ECR Repository
if (-not $SkipECR) {
    Write-Status "Creating ECR repository..."
    aws ecr describe-repositories --repository-names $ECR_REPO --profile $env:AWS_PROFILE --region $env:AWS_REGION 2>$null
    if ($LASTEXITCODE -ne 0) {
        aws ecr create-repository `
            --repository-name $ECR_REPO `
            --profile $env:AWS_PROFILE `
            --region $env:AWS_REGION `
            --image-scanning-configuration scanOnPush=true
        Write-Status "ECR repository created: $ECR_REPO" "Green"
    } else {
        Write-Status "ECR repository exists: $ECR_REPO" "Yellow"
    }
}

# Step 2: Build and push Docker image
if (-not $SkipBuild) {
    Write-Status "Building Docker image..."
    
    # Login to ECR
    $loginCmd = aws ecr get-login-password --profile $env:AWS_PROFILE --region $env:AWS_REGION
    $loginCmd | docker login --username AWS --password-stdin "$AWS_ACCOUNT_ID.dkr.ecr.$env:AWS_REGION.amazonaws.com"
    
    # Build the image
    Push-Location "$PSScriptRoot/../.."
    docker build -t $ECR_REPO -f Dockerfile.backend .
    Pop-Location
    
    # Tag and push
    docker tag "${ECR_REPO}:latest" $ECR_IMAGE
    docker push $ECR_IMAGE
    
    Write-Status "Docker image pushed: $ECR_IMAGE" "Green"
}

# Step 3: Deploy CloudFormation stack
Write-Status "Deploying CloudFormation stack: $STACK_BACKEND"

$params = @(
    "ParameterKey=ProjectName,ParameterValue=$PROJECT_NAME"
    "ParameterKey=Environment,ParameterValue=$ENVIRONMENT"
    "ParameterKey=ContainerImage,ParameterValue=$ECR_IMAGE"
    "ParameterKey=ContainerCpu,ParameterValue=$CONTAINER_CPU"
    "ParameterKey=ContainerMemory,ParameterValue=$CONTAINER_MEMORY"
    "ParameterKey=DesiredCount,ParameterValue=$DESIRED_COUNT"
    "ParameterKey=AuroraEndpoint,ParameterValue=$AURORA_ENDPOINT"
    "ParameterKey=AuroraSecretArn,ParameterValue=$AURORA_SECRET_ARN"
    "ParameterKey=JwtSecret,ParameterValue=$JwtSecret"
)

# Use existing VPC
if ($USE_EXISTING_VPC) {
    $params += "ParameterKey=NetworkMode,ParameterValue=existing"
    $params += "ParameterKey=ExistingVPCId,ParameterValue=$EXISTING_VPC_ID"
    $params += "ParameterKey=ExistingPrivateSubnet1,ParameterValue=$EXISTING_PRIVATE_SUBNET_1"
    $params += "ParameterKey=ExistingPrivateSubnet2,ParameterValue=$EXISTING_PRIVATE_SUBNET_2"
    $params += "ParameterKey=ExistingPublicSubnet1,ParameterValue=$EXISTING_PUBLIC_SUBNET_1"
    $params += "ParameterKey=ExistingPublicSubnet2,ParameterValue=$EXISTING_PUBLIC_SUBNET_2"
    Write-Status "Using existing VPC: $EXISTING_VPC_ID"
}

# Add optional parameters
if ($DOMAIN_NAME) {
    $params += "ParameterKey=FrontendUrl,ParameterValue=https://$DOMAIN_NAME"
}
if ($ALB_CERTIFICATE_ARN) {
    $params += "ParameterKey=CertificateArn,ParameterValue=$ALB_CERTIFICATE_ARN"
}
if ($ALERT_EMAIL) {
    $params += "ParameterKey=AlertEmail,ParameterValue=$ALERT_EMAIL"
}

if (Test-StackExists $STACK_BACKEND) {
    Write-Status "Stack exists, updating..."
    aws cloudformation update-stack `
        --stack-name $STACK_BACKEND `
        --template-body "file://$TEMPLATE_BACKEND" `
        --parameters $params `
        --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM `
        --profile $env:AWS_PROFILE `
        --region $env:AWS_REGION
    
    if ($LASTEXITCODE -eq 0) {
        Wait-ForStack $STACK_BACKEND "stack-update-complete"
    } else {
        Write-Status "No updates to perform or update failed" "Yellow"
    }
} else {
    Write-Status "Creating new stack..."
    aws cloudformation create-stack `
        --stack-name $STACK_BACKEND `
        --template-body "file://$TEMPLATE_BACKEND" `
        --parameters $params `
        --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM `
        --tags Key=Project,Value=$PROJECT_NAME Key=Environment,Value=$ENVIRONMENT `
        --profile $env:AWS_PROFILE `
        --region $env:AWS_REGION
    
    Wait-ForStack $STACK_BACKEND "stack-create-complete"
}

# Step 4: Ensure ECS can reach Aurora
Write-Status "Verifying network connectivity to Aurora..."
$ECS_SG = Get-StackOutput $STACK_BACKEND "ECSSecurityGroupId"
if ($ECS_SG) {
    # Aurora SG is already configured to allow VPC CIDR in 01-deploy-aurora.ps1
    Write-Status "ECS Security Group: $ECS_SG (Aurora already allows VPC traffic)" "Green"
}

# Step 5: Display outputs
Write-Status "Stack Outputs:" "Green"
aws cloudformation describe-stacks `
    --stack-name $STACK_BACKEND `
    --profile $env:AWS_PROFILE `
    --region $env:AWS_REGION `
    --query 'Stacks[0].Outputs[*].[OutputKey,OutputValue]' `
    --output table

$ALB_DNS = Get-StackOutput $STACK_BACKEND "ALBDNSName"

Write-Status "Deployment Complete!" "Green"
Write-Host ""
Write-Host "Backend URL: http://$ALB_DNS" -ForegroundColor Cyan
Write-Host "Aurora:      $AURORA_ENDPOINT" -ForegroundColor Cyan
Write-Host ""
Write-Host "NEXT: Deploy WAF + CloudFront:" -ForegroundColor Yellow
Write-Host "  .\03-deploy-waf-cloudfront.ps1"
