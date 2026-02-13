# ============================================================================
# Deploy WAF + CloudFront + Frontend Stack
# ============================================================================
# All resources defined in CloudFormation:
# - S3 bucket for frontend assets
# - WAF Web ACL with security rules
# - CloudFront distribution
#
# REGION: This stack deploys in us-east-1 only. AWS requires WAF (when used
# with CloudFront) to be in us-east-1. Your VPC/ALB/ECS can stay in us-east-2;
# CloudFront is global and the origin is just the ALB URL (e.g. ALB in us-east-2).
# ============================================================================

param(
    [switch]$SkipBuild,
    [switch]$SkipUpload
)

# Load configuration
. "$PSScriptRoot/config.ps1"

# WAF/CloudFront must be in us-east-1
$CF_REGION = "us-east-1"

Write-Status "Starting WAF + CloudFront + Frontend Deployment" "Magenta"
Write-Status "Note: Deploying to us-east-1 (required for CloudFront WAF)" "Yellow"

# Backend origin: custom API domain (HTTPS) or ALB DNS (HTTP)
$ALB_DNS = Get-StackOutput $STACK_BACKEND "ALBDNSName"
if (-not $ALB_DNS) {
    Write-Status "ERROR: Backend stack not found. Deploy backend first!" "Red"
    exit 1
}
$BackendOriginDomain = if ($BACKEND_ORIGIN_DOMAIN) { $BACKEND_ORIGIN_DOMAIN } else { $ALB_DNS }
Write-Status "Backend origin: $BackendOriginDomain" $(if ($BACKEND_ORIGIN_DOMAIN) { "Green" } else { "Cyan" })

# ============================================================================
# PHASE 1: Deploy CloudFormation Stack (creates S3 bucket, CloudFront, WAF)
# ============================================================================
Write-Status "Phase 1: Deploying CloudFormation stack..."

$params = @(
    "ParameterKey=ProjectName,ParameterValue=$PROJECT_NAME"
    "ParameterKey=Environment,ParameterValue=$ENVIRONMENT"
    "ParameterKey=S3BucketName,ParameterValue=$FRONTEND_BUCKET"
    "ParameterKey=BackendOriginDomain,ParameterValue=$BackendOriginDomain"
    "ParameterKey=EnableBackendOrigin,ParameterValue=true"
)

# Add optional parameters
if ($DOMAIN_NAME) {
    $params += "ParameterKey=DomainName,ParameterValue=$DOMAIN_NAME"
}
if ($CERTIFICATE_ARN) {
    $params += "ParameterKey=CertificateArn,ParameterValue=$CERTIFICATE_ARN"
}
if ($BACKEND_ORIGIN_PROTOCOL) {
    $params += "ParameterKey=BackendOriginProtocol,ParameterValue=$BACKEND_ORIGIN_PROTOCOL"
}

# Helper function for us-east-1 region stack operations
function Test-StackExistsCF {
    param([string]$StackName)
    $result = aws cloudformation describe-stacks --stack-name $StackName --profile $env:AWS_PROFILE --region $CF_REGION 2>$null
    return $LASTEXITCODE -eq 0
}

function Wait-ForStackCF {
    param(
        [string]$StackName,
        [string]$WaitType = "stack-create-complete"
    )
    Write-Status "Waiting for $StackName ($WaitType) in us-east-1..."
    aws cloudformation wait $WaitType --stack-name $StackName --profile $env:AWS_PROFILE --region $CF_REGION
    if ($LASTEXITCODE -eq 0) {
        Write-Status "$StackName completed successfully!" "Green"
    } else {
        Write-Status "$StackName failed! Showing recent stack events:" "Red"
        aws cloudformation describe-stack-events --stack-name $StackName --profile $env:AWS_PROFILE --region $CF_REGION `
            --query "StackEvents[?ResourceStatus=='CREATE_FAILED' || ResourceStatus=='ROLLBACK_IN_PROGRESS'].[LogicalResourceId,ResourceStatusReason]" `
            --output table
        Write-Status "Full details: AWS Console > CloudFormation (region us-east-1) > $StackName > Events" "Yellow"
        exit 1
    }
}

if (Test-StackExistsCF $STACK_WAF_CLOUDFRONT) {
    Write-Status "Stack exists, updating..."
    aws cloudformation update-stack `
        --stack-name $STACK_WAF_CLOUDFRONT `
        --template-body "file://$TEMPLATE_WAF" `
        --parameters $params `
        --capabilities CAPABILITY_NAMED_IAM `
        --profile $env:AWS_PROFILE `
        --region $CF_REGION 2>$null
    
    if ($LASTEXITCODE -eq 0) {
        Wait-ForStackCF $STACK_WAF_CLOUDFRONT "stack-update-complete"
    } else {
        Write-Status "No updates needed or update in progress" "Yellow"
    }
} else {
    Write-Status "Creating new stack..."
    aws cloudformation create-stack `
        --stack-name $STACK_WAF_CLOUDFRONT `
        --template-body "file://$TEMPLATE_WAF" `
        --parameters $params `
        --capabilities CAPABILITY_NAMED_IAM `
        --tags Key=Project,Value=$PROJECT_NAME Key=Environment,Value=$ENVIRONMENT `
        --profile $env:AWS_PROFILE `
        --region $CF_REGION
    
    Wait-ForStackCF $STACK_WAF_CLOUDFRONT "stack-create-complete"
}

# Get CloudFront distribution ID for cache invalidation
$CF_DISTRIBUTION_ID = aws cloudformation describe-stacks `
    --stack-name $STACK_WAF_CLOUDFRONT `
    --profile $env:AWS_PROFILE `
    --region $CF_REGION `
    --query "Stacks[0].Outputs[?OutputKey=='CloudFrontDistributionId'].OutputValue" `
    --output text

$CF_DOMAIN = aws cloudformation describe-stacks `
    --stack-name $STACK_WAF_CLOUDFRONT `
    --profile $env:AWS_PROFILE `
    --region $CF_REGION `
    --query "Stacks[0].Outputs[?OutputKey=='CloudFrontDomainName'].OutputValue" `
    --output text

# ============================================================================
# PHASE 2: Build Frontend
# ============================================================================
if (-not $SkipBuild) {
    Write-Status "Phase 2: Building frontend..."
    
    Push-Location "$REPO_ROOT"
    
    # Install dependencies if needed
    if (-not (Test-Path "node_modules")) {
        Write-Status "Installing dependencies..."
        npm install
    }
    
    # Build the frontend
    Write-Status "Running npm build..."
    
    # Set the API URL to empty (CloudFront will proxy /api/* to backend)
    $env:VITE_API_URL = ""
    
    npm run build
    
    if ($LASTEXITCODE -ne 0) {
        Write-Status "ERROR: Frontend build failed" "Red"
        Pop-Location
        exit 1
    }
    
    Pop-Location
    Write-Status "Frontend build complete!" "Green"
} else {
    Write-Status "Skipping frontend build (--SkipBuild)" "Yellow"
}

# ============================================================================
# PHASE 3: Upload to S3
# ============================================================================
if (-not $SkipUpload) {
    Write-Status "Phase 3: Uploading frontend to S3..."
    
    # Upload build output to S3
    # Note: Vite builds to 'dist/' folder based on vite.config.ts
    aws s3 sync "$REPO_ROOT/dist/" "s3://$FRONTEND_BUCKET/" `
        --delete `
        --profile $env:AWS_PROFILE `
        --region $CF_REGION
    
    if ($LASTEXITCODE -ne 0) {
        Write-Status "ERROR: S3 upload failed" "Red"
        exit 1
    }
    
    Write-Status "Frontend uploaded to S3!" "Green"
    
    # Invalidate CloudFront cache
    Write-Status "Invalidating CloudFront cache..."
    aws cloudfront create-invalidation `
        --distribution-id $CF_DISTRIBUTION_ID `
        --paths "/*" `
        --profile $env:AWS_PROFILE
    
    Write-Status "CloudFront cache invalidated!" "Green"
} else {
    Write-Status "Skipping S3 upload (--SkipUpload)" "Yellow"
}

# ============================================================================
# Display outputs
# ============================================================================
Write-Status "Stack Outputs:" "Green"
aws cloudformation describe-stacks `
    --stack-name $STACK_WAF_CLOUDFRONT `
    --profile $env:AWS_PROFILE `
    --region $CF_REGION `
    --query 'Stacks[0].Outputs[*].[OutputKey,OutputValue]' `
    --output table

Write-Status "Deployment Complete!" "Green"
Write-Host ""
Write-Host "Frontend URL: https://$CF_DOMAIN" -ForegroundColor Cyan
Write-Host "S3 Bucket:    $FRONTEND_BUCKET" -ForegroundColor Cyan
Write-Host "Backend API:  https://$CF_DOMAIN/api/*" -ForegroundColor Cyan
Write-Host ""
if ($DOMAIN_NAME) {
    Write-Host "Custom Domain Setup:" -ForegroundColor Yellow
    Write-Host "  Create Route 53 CNAME: $DOMAIN_NAME -> $CF_DOMAIN"
}
