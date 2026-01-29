# ============================================================================
# Deploy WAF + CloudFront Stack
# ============================================================================
# This script deploys:
# - S3 bucket for frontend assets
# - WAF Web ACL with security rules
# - CloudFront distribution
# 
# NOTE: Must be deployed in us-east-1 for CloudFront WAF association
# ============================================================================

param(
    [switch]$SkipS3Create
)

# Load configuration
. "$PSScriptRoot/config.ps1"

# WAF/CloudFront must be in us-east-1
$CF_REGION = "us-east-1"

Write-Status "Starting WAF + CloudFront Deployment" "Magenta"
Write-Status "Note: Deploying to us-east-1 (required for CloudFront WAF)" "Yellow"

# Get backend ALB DNS
$ALB_DNS = Get-StackOutput $STACK_BACKEND "ALBDNSName"
if (-not $ALB_DNS) {
    Write-Status "ERROR: Backend stack not found. Deploy backend first!" "Red"
    exit 1
}
Write-Status "Backend ALB: $ALB_DNS"

# Step 1: Create S3 bucket for frontend
if (-not $SkipS3Create) {
    Write-Status "Creating S3 bucket for frontend..."
    
    # Check if bucket exists
    aws s3api head-bucket --bucket $FRONTEND_BUCKET --profile $env:AWS_PROFILE 2>$null
    if ($LASTEXITCODE -ne 0) {
        # Create bucket
        if ($env:AWS_REGION -eq "us-east-1") {
            aws s3api create-bucket `
                --bucket $FRONTEND_BUCKET `
                --profile $env:AWS_PROFILE `
                --region $env:AWS_REGION
        } else {
            aws s3api create-bucket `
                --bucket $FRONTEND_BUCKET `
                --profile $env:AWS_PROFILE `
                --region $env:AWS_REGION `
                --create-bucket-configuration LocationConstraint=$env:AWS_REGION
        }
        
        # Enable versioning
        aws s3api put-bucket-versioning `
            --bucket $FRONTEND_BUCKET `
            --versioning-configuration Status=Enabled `
            --profile $env:AWS_PROFILE
        
        # Block public access
        aws s3api put-public-access-block `
            --bucket $FRONTEND_BUCKET `
            --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true" `
            --profile $env:AWS_PROFILE
        
        Write-Status "S3 bucket created: $FRONTEND_BUCKET" "Green"
    } else {
        Write-Status "S3 bucket already exists: $FRONTEND_BUCKET" "Yellow"
    }
}

# Get S3 bucket regional domain
$S3_DOMAIN = "$FRONTEND_BUCKET.s3.$env:AWS_REGION.amazonaws.com"

# Step 2: Deploy WAF + CloudFront stack
Write-Status "Deploying WAF + CloudFront stack..."

$params = @(
    "ParameterKey=ProjectName,ParameterValue=$PROJECT_NAME"
    "ParameterKey=Environment,ParameterValue=$ENVIRONMENT"
    "ParameterKey=S3BucketName,ParameterValue=$FRONTEND_BUCKET"
    "ParameterKey=S3BucketRegionalDomainName,ParameterValue=$S3_DOMAIN"
    "ParameterKey=BackendOriginDomain,ParameterValue=$ALB_DNS"
    "ParameterKey=EnableBackendOrigin,ParameterValue=true"
)

# Add optional parameters
if ($DOMAIN_NAME) {
    $params += "ParameterKey=DomainName,ParameterValue=$DOMAIN_NAME"
}
if ($CERTIFICATE_ARN) {
    $params += "ParameterKey=CertificateArn,ParameterValue=$CERTIFICATE_ARN"
}

if (Test-StackExists $STACK_WAF_CLOUDFRONT) {
    Write-Status "Stack exists, updating..."
    aws cloudformation update-stack `
        --stack-name $STACK_WAF_CLOUDFRONT `
        --template-body "file://$TEMPLATE_WAF" `
        --parameters $params `
        --profile $env:AWS_PROFILE `
        --region $CF_REGION
    
    if ($LASTEXITCODE -eq 0) {
        Wait-ForStack $STACK_WAF_CLOUDFRONT "stack-update-complete"
    }
} else {
    Write-Status "Creating new stack..."
    aws cloudformation create-stack `
        --stack-name $STACK_WAF_CLOUDFRONT `
        --template-body "file://$TEMPLATE_WAF" `
        --parameters $params `
        --tags Key=Project,Value=$PROJECT_NAME Key=Environment,Value=$ENVIRONMENT `
        --profile $env:AWS_PROFILE `
        --region $CF_REGION
    
    Wait-ForStack $STACK_WAF_CLOUDFRONT "stack-create-complete"
}

# Display outputs
Write-Status "Stack Outputs:" "Green"
aws cloudformation describe-stacks `
    --stack-name $STACK_WAF_CLOUDFRONT `
    --profile $env:AWS_PROFILE `
    --region $CF_REGION `
    --query 'Stacks[0].Outputs[*].[OutputKey,OutputValue]' `
    --output table

$CF_DOMAIN = aws cloudformation describe-stacks `
    --stack-name $STACK_WAF_CLOUDFRONT `
    --profile $env:AWS_PROFILE `
    --region $CF_REGION `
    --query "Stacks[0].Outputs[?OutputKey=='CloudFrontDomainName'].OutputValue" `
    --output text

Write-Status "Deployment Complete!" "Green"
Write-Host ""
Write-Host "CloudFront Domain: https://$CF_DOMAIN" -ForegroundColor Cyan
Write-Host "S3 Bucket: $FRONTEND_BUCKET" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host "  1. Build frontend: npm run build"
Write-Host "  2. Deploy frontend: aws s3 sync docs/ s3://$FRONTEND_BUCKET/ --profile $env:AWS_PROFILE"
Write-Host "  3. Invalidate cache: aws cloudfront create-invalidation --distribution-id <ID> --paths '/*'"
if ($DOMAIN_NAME) {
    Write-Host "  4. Create Route 53 CNAME: $DOMAIN_NAME -> $CF_DOMAIN"
}
