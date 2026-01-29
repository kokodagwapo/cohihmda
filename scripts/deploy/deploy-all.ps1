# ============================================================================
# Coheus Full Stack Deployment
# ============================================================================
# Deployment order:
# 1. Aurora Serverless v2 (database - must be first)
# 2. ECS Fargate (compute - connects to Aurora)
# 3. WAF + CloudFront (frontend CDN)
# 4. Monitoring (dashboard + alarms)
# 5. Tenant Provisioning (automation)
# ============================================================================

param(
    [switch]$SkipAurora,
    [switch]$SkipBackend,
    [switch]$SkipWAF,
    [switch]$SkipMonitoring,
    [switch]$SkipProvisioning,
    [switch]$SkipDockerBuild,
    [string]$JwtSecret
)

$ErrorActionPreference = "Stop"

# Load configuration
. "$PSScriptRoot/config.ps1"

Write-Host ""
Write-Host "============================================================" -ForegroundColor Magenta
Write-Host "        COHEUS CLOUDFORMATION DEPLOYMENT" -ForegroundColor Magenta
Write-Host "============================================================" -ForegroundColor Magenta
Write-Host ""
Write-Host "  Project:     $PROJECT_NAME" -ForegroundColor White
Write-Host "  Environment: $ENVIRONMENT" -ForegroundColor White
Write-Host "  AWS Account: $AWS_ACCOUNT_ID" -ForegroundColor White
Write-Host "  AWS Region:  $env:AWS_REGION" -ForegroundColor White
Write-Host "  Profile:     $env:AWS_PROFILE" -ForegroundColor White
Write-Host ""
Write-Host "  Stack Order:" -ForegroundColor Yellow
Write-Host "    1. Aurora Serverless v2 (database)" -ForegroundColor White
Write-Host "    2. ECS Fargate (compute)" -ForegroundColor White
Write-Host "    3. WAF + CloudFront (frontend)" -ForegroundColor White
Write-Host "    4. Monitoring (observability)" -ForegroundColor White
Write-Host "    5. Tenant Provisioning (automation)" -ForegroundColor White
Write-Host ""
Write-Host "============================================================" -ForegroundColor Magenta
Write-Host ""

$confirm = Read-Host "Proceed with deployment? (y/n)"
if ($confirm -ne "y") {
    Write-Host "Deployment cancelled." -ForegroundColor Yellow
    exit 0
}

$startTime = Get-Date
$deployedStacks = @()

try {
    # ========================================================================
    # Step 1: Deploy Aurora Clusters (MUST BE FIRST)
    # ========================================================================
    if (-not $SkipAurora) {
        Write-Host ""
        Write-Host "============================================================" -ForegroundColor Cyan
        Write-Host "  STEP 1/5: Deploying Aurora Serverless v2 Clusters" -ForegroundColor Cyan
        Write-Host "============================================================" -ForegroundColor Cyan
        
        & "$PSScriptRoot/01-deploy-aurora.ps1"
        $deployedStacks += "Aurora"
    } else {
        Write-Status "Skipping Aurora deployment" "Yellow"
    }

    # ========================================================================
    # Step 2: Deploy ECS Fargate Backend
    # ========================================================================
    if (-not $SkipBackend) {
        Write-Host ""
        Write-Host "============================================================" -ForegroundColor Cyan
        Write-Host "  STEP 2/5: Deploying ECS Fargate Backend" -ForegroundColor Cyan
        Write-Host "============================================================" -ForegroundColor Cyan
        
        $backendArgs = @()
        if ($SkipDockerBuild) { $backendArgs += "-SkipBuild" }
        if ($JwtSecret) { $backendArgs += "-JwtSecret"; $backendArgs += $JwtSecret }
        
        & "$PSScriptRoot/02-deploy-backend.ps1" @backendArgs
        $deployedStacks += "Backend"
    } else {
        Write-Status "Skipping Backend deployment" "Yellow"
    }

    # ========================================================================
    # Step 3: Deploy WAF + CloudFront
    # ========================================================================
    if (-not $SkipWAF) {
        Write-Host ""
        Write-Host "============================================================" -ForegroundColor Cyan
        Write-Host "  STEP 3/5: Deploying WAF + CloudFront" -ForegroundColor Cyan
        Write-Host "============================================================" -ForegroundColor Cyan
        
        & "$PSScriptRoot/03-deploy-waf-cloudfront.ps1"
        $deployedStacks += "WAF/CloudFront"
    } else {
        Write-Status "Skipping WAF/CloudFront deployment" "Yellow"
    }

    # ========================================================================
    # Step 4: Deploy Monitoring
    # ========================================================================
    if (-not $SkipMonitoring) {
        Write-Host ""
        Write-Host "============================================================" -ForegroundColor Cyan
        Write-Host "  STEP 4/5: Deploying Monitoring Stack" -ForegroundColor Cyan
        Write-Host "============================================================" -ForegroundColor Cyan
        
        & "$PSScriptRoot/04-deploy-monitoring.ps1"
        $deployedStacks += "Monitoring"
    } else {
        Write-Status "Skipping Monitoring deployment" "Yellow"
    }

    # ========================================================================
    # Step 5: Deploy Tenant Provisioning
    # ========================================================================
    if (-not $SkipProvisioning) {
        Write-Host ""
        Write-Host "============================================================" -ForegroundColor Cyan
        Write-Host "  STEP 5/5: Deploying Tenant Provisioning" -ForegroundColor Cyan
        Write-Host "============================================================" -ForegroundColor Cyan
        
        & "$PSScriptRoot/05-deploy-tenant-provisioning.ps1"
        $deployedStacks += "Tenant Provisioning"
    } else {
        Write-Status "Skipping Tenant Provisioning deployment" "Yellow"
    }

    # ========================================================================
    # Deployment Summary
    # ========================================================================
    $endTime = Get-Date
    $duration = $endTime - $startTime

    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host "        DEPLOYMENT COMPLETE!" -ForegroundColor Green
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Duration: $($duration.ToString('hh\:mm\:ss'))" -ForegroundColor White
    Write-Host "  Stacks deployed: $($deployedStacks -join ', ')" -ForegroundColor White
    Write-Host ""

    # Display endpoints
    Write-Host "  ENDPOINTS:" -ForegroundColor Yellow
    
    $backendUrl = Get-StackOutput $STACK_BACKEND "ALBDNSName"
    if ($backendUrl) {
        Write-Host "    Backend API:  http://$backendUrl" -ForegroundColor Cyan
    }
    
    $cfDomain = aws cloudformation describe-stacks `
        --stack-name $STACK_WAF_CLOUDFRONT `
        --profile $env:AWS_PROFILE `
        --region "us-east-1" `
        --query "Stacks[0].Outputs[?OutputKey=='CloudFrontDomainName'].OutputValue" `
        --output text 2>$null
    if ($cfDomain -and $cfDomain -ne "None") {
        Write-Host "    Frontend:     https://$cfDomain" -ForegroundColor Cyan
    }
    
    $auroraEndpoint = Get-StackOutput $STACK_AURORA_MGMT "ClusterEndpoint"
    if ($auroraEndpoint) {
        Write-Host "    Aurora:       $auroraEndpoint" -ForegroundColor Cyan
    }

    Write-Host ""
    Write-Host "  NEXT STEPS:" -ForegroundColor Yellow
    Write-Host "    1. Build and deploy frontend:"
    Write-Host "       npm run build"
    Write-Host "       aws s3 sync docs/ s3://$FRONTEND_BUCKET/ --profile $env:AWS_PROFILE"
    Write-Host ""
    Write-Host "    2. Run database migrations"
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Green

} catch {
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Red
    Write-Host "        DEPLOYMENT FAILED!" -ForegroundColor Red
    Write-Host "============================================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "  Error: $_" -ForegroundColor Red
    Write-Host ""
    exit 1
}
