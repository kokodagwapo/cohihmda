# ============================================================================
# Coheus CloudFormation Deployment Configuration
# ============================================================================

# AWS Configuration
$env:AWS_PROFILE = "DevEnvPerms-339712788893"
$env:AWS_REGION = "us-east-2"

# Project Configuration
$PROJECT_NAME = "coheus"
$ENVIRONMENT = "dev"  # Change to 'staging' or 'prod' as needed

# ============================================================================
# EXISTING VPC CONFIGURATION
# Using existing VPC to communicate with other backend services (JWT auth, etc.)
# ============================================================================
$USE_EXISTING_VPC = $true
$EXISTING_VPC_ID = "vpc-0f200c8590d1757fa"  # 3vue-qlik-VPC

# Subnet IDs - will be auto-discovered if not specified
$EXISTING_PRIVATE_SUBNET_1 = ""  # Auto-discover
$EXISTING_PRIVATE_SUBNET_2 = ""  # Auto-discover
$EXISTING_PUBLIC_SUBNET_1 = ""   # Auto-discover
$EXISTING_PUBLIC_SUBNET_2 = ""   # Auto-discover

# Get AWS Account ID
$AWS_ACCOUNT_ID = (aws sts get-caller-identity --profile $env:AWS_PROFILE --query 'Account' --output text)

# Stack Names
$STACK_BACKEND = "$PROJECT_NAME-$ENVIRONMENT-backend"
$STACK_AURORA_MGMT = "$PROJECT_NAME-$ENVIRONMENT-aurora-management"
$STACK_AURORA_TENANT = "$PROJECT_NAME-$ENVIRONMENT-aurora-tenant-001"
$STACK_WAF_CLOUDFRONT = "$PROJECT_NAME-$ENVIRONMENT-waf-cloudfront"
$STACK_MONITORING = "$PROJECT_NAME-$ENVIRONMENT-monitoring"
$STACK_TENANT_PROVISIONING = "$PROJECT_NAME-$ENVIRONMENT-tenant-provisioning"

# ECR Repository
$ECR_REPO = "$PROJECT_NAME-backend"
$ECR_IMAGE = "$AWS_ACCOUNT_ID.dkr.ecr.$env:AWS_REGION.amazonaws.com/${ECR_REPO}:latest"

# Database Configuration
$DB_INSTANCE_CLASS = "db.t3.small"

# ECS Configuration
$CONTAINER_CPU = 512
$CONTAINER_MEMORY = 1024
$DESIRED_COUNT = 2

# Domain Configuration (coheus1.com subdomains)
# See docs/deployment/HTTPS_AND_CERTIFICATES.md and COHEUS1_DOMAIN_SETUP.md.
# Dev:  cohi-dev.coheus1.com (frontend), cohi-dev-api.coheus1.com (API/ALB)
# Prod: cohi.coheus1.com (frontend), cohi-api.coheus1.com (API/ALB)
$DOMAIN_NAME = "cohi-dev.coheus1.com"
$CERTIFICATE_ARN = "arn:aws:acm:us-east-1:339712788893:certificate/93d8a90f-bf38-4e8b-80b4-4027d6fcaa63"  # CloudFront (us-east-1); must cover $DOMAIN_NAME
$ALB_CERTIFICATE_ARN = "arn:aws:acm:us-east-2:339712788893:certificate/ed3ea4da-effe-47ba-a974-a61964930484"  # ALB (us-east-2); catch-all for *.coheus1.com
$BACKEND_ORIGIN_DOMAIN = "cohi-dev-api.coheus1.com"  # Custom API domain; CloudFront uses this with HTTPS. Leave empty to use ALB DNS (HTTP only).
$BACKEND_ORIGIN_PROTOCOL = "https-only"  # Use "https-only" when ALB has cert and BACKEND_ORIGIN_DOMAIN is set.

# Alert Configuration
$ALERT_EMAIL = "mpetrovic@teraverde.com"  # e.g., "alerts@yourcompany.com"

# Frontend S3 Bucket
$FRONTEND_BUCKET = "$PROJECT_NAME-frontend-$AWS_ACCOUNT_ID"

# CloudFormation Template Paths (relative to repo root)
$REPO_ROOT = (Get-Item "$PSScriptRoot/../..").FullName
$CF_PATH = "$REPO_ROOT/infrastructure/cloudformation"
$TEMPLATE_AURORA = "$CF_PATH/coheus_aurora_cluster_stack.yaml"
$TEMPLATE_BACKEND = "$CF_PATH/coheus_ecs_fargate_stack.yaml"
$TEMPLATE_WAF = "$CF_PATH/coheus_waf_cloudfront_stack.yaml"
$TEMPLATE_MONITORING = "$CF_PATH/coheus_monitoring_stack.yaml"
$TEMPLATE_PROVISIONING = "$CF_PATH/coheus_tenant_provisioning_stack.yaml"

# Helper Functions
function Write-Status {
    param([string]$Message, [string]$Color = "Cyan")
    Write-Host "`n[$([DateTime]::Now.ToString('HH:mm:ss'))] $Message" -ForegroundColor $Color
}

# Auto-discover subnets from existing VPC
function Get-VPCSubnets {
    if (-not $USE_EXISTING_VPC) { return }
    
    Write-Status "Discovering subnets in VPC $EXISTING_VPC_ID..."
    
    # Get all subnets in the VPC
    $subnets = aws ec2 describe-subnets `
        --filters "Name=vpc-id,Values=$EXISTING_VPC_ID" `
        --profile $env:AWS_PROFILE `
        --region $env:AWS_REGION `
        --query 'Subnets[*].[SubnetId,AvailabilityZone,CidrBlock,MapPublicIpOnLaunch,Tags[?Key==`Name`].Value|[0]]' `
        --output json | ConvertFrom-Json
    
    if (-not $subnets -or $subnets.Count -eq 0) {
        Write-Status "ERROR: No subnets found in VPC $EXISTING_VPC_ID" "Red"
        exit 1
    }
    
    Write-Status "Found $($subnets.Count) subnets:" "Green"
    foreach ($subnet in $subnets) {
        $name = $subnet[4]
        # Detect type by name (more reliable than MapPublicIpOnLaunch)
        $type = if ($name -match "public") { "public" } elseif ($name -match "private") { "private" } elseif ($subnet[3]) { "public" } else { "private" }
        Write-Host "  - $($subnet[0]) ($($subnet[1])) [$type] $name"
    }
    
    # Separate into public and private based on name
    $privateSubnets = $subnets | Where-Object { $_[4] -match "private" }
    $publicSubnets = $subnets | Where-Object { $_[4] -match "public" }
    
    # Fallback to MapPublicIpOnLaunch if names don't work
    if ($privateSubnets.Count -eq 0) {
        $privateSubnets = $subnets | Where-Object { -not $_[3] }
    }
    if ($publicSubnets.Count -eq 0) {
        $publicSubnets = $subnets | Where-Object { $_[3] }
    }
    
    # Set globals if not already specified
    if (-not $script:EXISTING_PRIVATE_SUBNET_1 -and $privateSubnets.Count -ge 1) {
        $script:EXISTING_PRIVATE_SUBNET_1 = $privateSubnets[0][0]
    }
    if (-not $script:EXISTING_PRIVATE_SUBNET_2 -and $privateSubnets.Count -ge 2) {
        $script:EXISTING_PRIVATE_SUBNET_2 = $privateSubnets[1][0]
    }
    if (-not $script:EXISTING_PUBLIC_SUBNET_1 -and $publicSubnets.Count -ge 1) {
        $script:EXISTING_PUBLIC_SUBNET_1 = $publicSubnets[0][0]
    }
    if (-not $script:EXISTING_PUBLIC_SUBNET_2 -and $publicSubnets.Count -ge 2) {
        $script:EXISTING_PUBLIC_SUBNET_2 = $publicSubnets[1][0]
    }
    
    Write-Status "Selected subnets:"
    Write-Host "  Private: $script:EXISTING_PRIVATE_SUBNET_1, $script:EXISTING_PRIVATE_SUBNET_2"
    Write-Host "  Public:  $script:EXISTING_PUBLIC_SUBNET_1, $script:EXISTING_PUBLIC_SUBNET_2"
}

function Wait-ForStack {
    param(
        [string]$StackName,
        [string]$WaitType = "stack-create-complete"
    )
    Write-Status "Waiting for $StackName ($WaitType)..."
    aws cloudformation wait $WaitType --stack-name $StackName --profile $env:AWS_PROFILE --region $env:AWS_REGION
    if ($LASTEXITCODE -eq 0) {
        Write-Status "$StackName completed successfully!" "Green"
    } else {
        Write-Status "$StackName failed! Check CloudFormation console for details." "Red"
        exit 1
    }
}

function Get-StackOutput {
    param(
        [string]$StackName,
        [string]$OutputKey
    )
    $result = aws cloudformation describe-stacks `
        --stack-name $StackName `
        --profile $env:AWS_PROFILE `
        --region $env:AWS_REGION `
        --query "Stacks[0].Outputs[?OutputKey=='$OutputKey'].OutputValue" `
        --output text
    return $result
}

function Test-StackExists {
    param([string]$StackName)
    $result = aws cloudformation describe-stacks --stack-name $StackName --profile $env:AWS_PROFILE --region $env:AWS_REGION 2>$null
    return $LASTEXITCODE -eq 0
}

# Discover subnets if using existing VPC
if ($USE_EXISTING_VPC) {
    Get-VPCSubnets
}

# Export variables
Write-Status "Configuration loaded for: $PROJECT_NAME-$ENVIRONMENT" "Yellow"
Write-Status "AWS Account: $AWS_ACCOUNT_ID" "Yellow"
Write-Status "AWS Region: $env:AWS_REGION" "Yellow"
if ($USE_EXISTING_VPC) {
    Write-Status "Using existing VPC: $EXISTING_VPC_ID" "Yellow"
}
