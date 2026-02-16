# ============================================================================
# Deploy ECS Fargate Backend Stack (Step 2)
# ============================================================================
# REQUIRES: Aurora cluster deployed first (01-deploy-aurora.ps1)
#
# All resources defined in CloudFormation:
# - ECR repository
# - ECS cluster, service, task definition
# - Application Load Balancer
# - Security groups, IAM roles
#
# Deployment process:
# 1. Deploy CloudFormation with DesiredCount=0 (creates ECR, no tasks yet)
# 2. Build and push Docker image to ECR
# 3. Update CloudFormation with DesiredCount=2 (starts tasks)
# ============================================================================

param(
    [switch]$SkipBuild,
    [string]$JwtSecret,
    [string]$ImageTag = "latest"
)

# Load configuration
. "$PSScriptRoot/config.ps1"

Write-Status "Starting ECS Fargate Backend Deployment" "Magenta"

# Verify Aurora is deployed
$AURORA_ENDPOINT = Get-StackOutput $STACK_AURORA_MGMT "ClusterEndpoint"
$AURORA_SECRET_ARN = Get-StackOutput $STACK_AURORA_MGMT "SecretArn"
$AURORA_KMS_KEY_ARN = Get-StackOutput $STACK_AURORA_MGMT "KMSKeyArn"

if (-not $AURORA_ENDPOINT -or -not $AURORA_SECRET_ARN) {
    Write-Status "ERROR: Aurora management cluster not found!" "Red"
    Write-Status "Deploy Aurora first: .\01-deploy-aurora.ps1" "Yellow"
    exit 1
}
if (-not $AURORA_KMS_KEY_ARN) {
    Write-Status "ERROR: Aurora stack missing KMSKeyArn output. ECS needs it to decrypt the DB secret." "Red"
    exit 1
}

Write-Status "Aurora endpoint: $AURORA_ENDPOINT"
Write-Status "Aurora secret: $AURORA_SECRET_ARN"
Write-Status "Aurora KMS key: $AURORA_KMS_KEY_ARN"

# Generate JWT secret if not provided
if (-not $JwtSecret) {
    $JwtSecret = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 64 | ForEach-Object { [char]$_ })
    Write-Status "Generated JWT Secret (save this!):" "Yellow"
    Write-Host "  $JwtSecret" -ForegroundColor Cyan
}

# Build CloudFormation parameters
$params = @(
    "ParameterKey=ProjectName,ParameterValue=$PROJECT_NAME"
    "ParameterKey=Environment,ParameterValue=$ENVIRONMENT"
    "ParameterKey=ContainerImageTag,ParameterValue=$ImageTag"
    "ParameterKey=ContainerCpu,ParameterValue=$CONTAINER_CPU"
    "ParameterKey=ContainerMemory,ParameterValue=$CONTAINER_MEMORY"
    "ParameterKey=AuroraEndpoint,ParameterValue=$AURORA_ENDPOINT"
    "ParameterKey=AuroraSecretArn,ParameterValue=$AURORA_SECRET_ARN"
    "ParameterKey=AuroraKmsKeyArn,ParameterValue=$AURORA_KMS_KEY_ARN"
    "ParameterKey=JwtSecret,ParameterValue=$JwtSecret"
    "ParameterKey=NetworkMode,ParameterValue=existing"
    "ParameterKey=ExistingVPCId,ParameterValue=$EXISTING_VPC_ID"
    "ParameterKey=ExistingPrivateSubnet1,ParameterValue=$EXISTING_PRIVATE_SUBNET_1"
    "ParameterKey=ExistingPrivateSubnet2,ParameterValue=$EXISTING_PRIVATE_SUBNET_2"
    "ParameterKey=ExistingPublicSubnet1,ParameterValue=$EXISTING_PUBLIC_SUBNET_1"
    "ParameterKey=ExistingPublicSubnet2,ParameterValue=$EXISTING_PUBLIC_SUBNET_2"
)

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

# Cognito SSO parameters (optional - SSO disabled if not provided)
if ($COGNITO_USER_POOL_ID) {
    Write-Status "Cognito SSO enabled for $ENVIRONMENT environment"
    $params += "ParameterKey=CognitoUserPoolId,ParameterValue=$COGNITO_USER_POOL_ID"
    $params += "ParameterKey=CognitoClientId,ParameterValue=$COGNITO_CLIENT_ID"
    $params += "ParameterKey=CognitoClientSecret,ParameterValue=$COGNITO_CLIENT_SECRET"
    $params += "ParameterKey=CognitoDomain,ParameterValue=$COGNITO_DOMAIN"
} else {
    Write-Status "Cognito SSO not configured for $ENVIRONMENT - skipping" "Yellow"
}

# FRED API key (optional - market rate sync disabled if not provided)
if ($FRED_API_KEY) {
    Write-Status "FRED API key configured"
    $params += "ParameterKey=FredApiKey,ParameterValue=$FRED_API_KEY"
} else {
    Write-Status "FRED API key not configured - market rate sync will be disabled" "Yellow"
}

# ============================================================================
# PHASE 1: Deploy CloudFormation with DesiredCount=0 (creates ECR, no tasks)
# ============================================================================
Write-Status "Phase 1: Deploying infrastructure (ECR, ALB, ECS cluster)..."

# First deployment with 0 tasks (so we can push image first)
$phase1Params = $params + @(
    "ParameterKey=DesiredCount,ParameterValue=0"
    "ParameterKey=MinCount,ParameterValue=0"
)

if (Test-StackExists $STACK_BACKEND) {
    Write-Status "Stack exists, updating..."
    aws cloudformation update-stack `
        --stack-name $STACK_BACKEND `
        --template-body "file://$TEMPLATE_BACKEND" `
        --parameters $phase1Params `
        --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM `
        --profile $env:AWS_PROFILE `
        --region $env:AWS_REGION 2>$null
    
    if ($LASTEXITCODE -eq 0) {
        Wait-ForStack $STACK_BACKEND "stack-update-complete"
    } else {
        Write-Status "No updates needed or stack in progress" "Yellow"
    }
} else {
    Write-Status "Creating new stack..."
    aws cloudformation create-stack `
        --stack-name $STACK_BACKEND `
        --template-body "file://$TEMPLATE_BACKEND" `
        --parameters $phase1Params `
        --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM `
        --tags Key=Project,Value=$PROJECT_NAME Key=Environment,Value=$ENVIRONMENT `
        --profile $env:AWS_PROFILE `
        --region $env:AWS_REGION
    
    Wait-ForStack $STACK_BACKEND "stack-create-complete"
}

# ============================================================================
# PHASE 2: Build and push Docker image
# ============================================================================
if (-not $SkipBuild) {
    Write-Status "Phase 2: Building and pushing Docker image..."
    
    # Get ECR URI from stack outputs
    $ECR_URI = Get-StackOutput $STACK_BACKEND "ECRRepositoryUri"
    
    if (-not $ECR_URI) {
        Write-Status "ERROR: Could not get ECR URI from stack outputs" "Red"
        exit 1
    }
    
    Write-Status "ECR Repository: $ECR_URI"
    
    # Login to ECR
    Write-Status "Logging into ECR..."
    $loginCmd = aws ecr get-login-password --profile $env:AWS_PROFILE --region $env:AWS_REGION
    $loginCmd | docker login --username AWS --password-stdin "$AWS_ACCOUNT_ID.dkr.ecr.$env:AWS_REGION.amazonaws.com"
    
    # Build the image
    Write-Status "Building Docker image..."
    Push-Location "$REPO_ROOT"
    docker build -t "${PROJECT_NAME}-backend" -f Dockerfile.backend.prod .
    
    if ($LASTEXITCODE -ne 0) {
        Write-Status "ERROR: Docker build failed" "Red"
        Pop-Location
        exit 1
    }
    
    # Tag and push
    Write-Status "Pushing image to ECR..."
    docker tag "${PROJECT_NAME}-backend:latest" "${ECR_URI}:${ImageTag}"
    docker push "${ECR_URI}:${ImageTag}"
    
    if ($LASTEXITCODE -ne 0) {
        Write-Status "ERROR: Docker push failed" "Red"
        Pop-Location
        exit 1
    }
    
    Pop-Location
    Write-Status "Docker image pushed: ${ECR_URI}:${ImageTag}" "Green"
} else {
    Write-Status "Skipping Docker build (--SkipBuild)" "Yellow"
}

# ============================================================================
# PHASE 3: Update stack to start ECS tasks
# ============================================================================
Write-Status "Phase 3: Starting ECS tasks (DesiredCount=$DESIRED_COUNT)..."

$phase3Params = $params + @(
    "ParameterKey=DesiredCount,ParameterValue=$DESIRED_COUNT"
    "ParameterKey=MinCount,ParameterValue=2"
)

aws cloudformation update-stack `
    --stack-name $STACK_BACKEND `
    --template-body "file://$TEMPLATE_BACKEND" `
    --parameters $phase3Params `
    --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM `
    --profile $env:AWS_PROFILE `
    --region $env:AWS_REGION

if ($LASTEXITCODE -eq 0) {
    Wait-ForStack $STACK_BACKEND "stack-update-complete"
} else {
    Write-Status "Warning: Stack update may have failed. Check CloudFormation console." "Yellow"
}

# ============================================================================
# PHASE 4: Allow ECS -> Aurora (update Aurora SG to allow ECS task SG)
# ============================================================================
$ECS_SG = Get-StackOutput $STACK_BACKEND "ECSSecurityGroupId"
if ($ECS_SG -and (Test-StackExists $STACK_AURORA_MGMT)) {
    Write-Status "Phase 4: Allowing ECS tasks to reach Aurora (ECSSecurityGroupId=$ECS_SG)..." "Magenta"
    
    # Use UsePreviousValue for all existing params; only change ECSSecurityGroupId
    $auroraParams = @(
        "ParameterKey=ProjectName,UsePreviousValue=true"
        "ParameterKey=Environment,UsePreviousValue=true"
        "ParameterKey=ClusterType,UsePreviousValue=true"
        "ParameterKey=ClusterIdentifier,UsePreviousValue=true"
        "ParameterKey=VPCId,UsePreviousValue=true"
        "ParameterKey=PrivateSubnet1,UsePreviousValue=true"
        "ParameterKey=PrivateSubnet2,UsePreviousValue=true"
        "ParameterKey=AllowedCIDR,UsePreviousValue=true"
        "ParameterKey=MinACU,UsePreviousValue=true"
        "ParameterKey=MaxACU,UsePreviousValue=true"
        "ParameterKey=DatabaseName,UsePreviousValue=true"
        "ParameterKey=MasterUsername,UsePreviousValue=true"
        "ParameterKey=MasterPassword,UsePreviousValue=true"
        "ParameterKey=BackupRetentionDays,UsePreviousValue=true"
        "ParameterKey=EnablePerformanceInsights,UsePreviousValue=true"
        "ParameterKey=KMSKeyArn,UsePreviousValue=true"
        "ParameterKey=AlertsTopicArn,UsePreviousValue=true"
        "ParameterKey=ECSSecurityGroupId,ParameterValue=$ECS_SG"
    )
    
    $phase4Err = aws cloudformation update-stack `
        --stack-name $STACK_AURORA_MGMT `
        --template-body "file://$TEMPLATE_AURORA" `
        --parameters $auroraParams `
        --capabilities CAPABILITY_IAM `
        --profile $env:AWS_PROFILE `
        --region $env:AWS_REGION 2>&1
    if ($LASTEXITCODE -eq 0) {
        Wait-ForStack $STACK_AURORA_MGMT "stack-update-complete"
        Write-Status "Aurora security group updated: ECS tasks can now connect." "Green"
    } elseif ($phase4Err -match "No updates are to be performed") {
        Write-Status "Aurora already allows ECS (no change needed)." "Green"
    } else {
        Write-Status "Aurora update failed: $phase4Err" "Red"
        Write-Status "You may need to manually add ECS SG ($ECS_SG) to Aurora SG for port 5432." "Yellow"
    }
}

# ============================================================================
# PHASE 5: Update Cognito SSO callback URLs for this environment
# ============================================================================
if ($COGNITO_USER_POOL_ID -and $COGNITO_CLIENT_ID) {
    Write-Status "Phase 5: Updating Cognito SSO callback URLs..." "Magenta"
    Update-CognitoCallbackUrls
} else {
    Write-Status "Phase 5: Skipping Cognito (not configured)" "Yellow"
}

# ============================================================================
# Display outputs
# ============================================================================
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
