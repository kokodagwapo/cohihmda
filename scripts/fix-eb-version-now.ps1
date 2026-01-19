# Quick fix for Elastic Beanstalk version mismatch (PowerShell version)
# This script deploys the expected version to sync the environment

param(
    [string]$EBAppName = "",
    [string]$EBEnvName = "",
    [string]$AWSRegion = "us-east-1"
)

$ErrorActionPreference = "Stop"

# Colors for output
function Write-ColorOutput($ForegroundColor) {
    $fc = $host.UI.RawUI.ForegroundColor
    $host.UI.RawUI.ForegroundColor = $ForegroundColor
    if ($args) {
        Write-Output $args
    }
    $host.UI.RawUI.ForegroundColor = $fc
}

Write-ColorOutput Cyan "========================================"
Write-ColorOutput Cyan "Fix Elastic Beanstalk Version Mismatch"
Write-ColorOutput Cyan "========================================"
Write-Output ""

# Check if AWS CLI is installed
try {
    $null = aws --version 2>&1
} catch {
    Write-ColorOutput Red "✗ AWS CLI is not installed or not in PATH"
    Write-Output "Please install AWS CLI: https://aws.amazon.com/cli/"
    exit 1
}

# Get environment details if not provided
if ([string]::IsNullOrEmpty($EBAppName)) {
    $EBAppName = Read-Host "Enter Elastic Beanstalk Application Name"
}

if ([string]::IsNullOrEmpty($EBEnvName)) {
    $EBEnvName = Read-Host "Enter Elastic Beanstalk Environment Name"
}

$ExpectedVersion = "ci-dev-6d59572-20260111-234606"  # Deployment 24

Write-Output ""
Write-ColorOutput Yellow "[1/3] Checking environment status..."

# Get environment info
$envInfoJson = aws elasticbeanstalk describe-environments `
    --environment-names $EBEnvName `
    --region $AWSRegion `
    --query 'Environments[0]' `
    --output json 2>&1

if ($LASTEXITCODE -ne 0) {
    Write-ColorOutput Red "✗ Failed to get environment information"
    Write-Output $envInfoJson
    exit 1
}

$envInfo = $envInfoJson | ConvertFrom-Json

if ($null -eq $envInfo.Status) {
    Write-ColorOutput Red "✗ Environment '$EBEnvName' not found!"
    exit 1
}

$envStatus = $envInfo.Status
$currentVersion = if ($envInfo.VersionLabel) { $envInfo.VersionLabel } else { "None" }

Write-Output "  Status: $envStatus"
Write-Output "  Current Version: $currentVersion"
Write-Output "  Expected Version: $ExpectedVersion"
Write-Output ""

Write-ColorOutput Yellow "[2/3] Verifying expected version exists..."

# Check if expected version exists
$versionCheck = aws elasticbeanstalk describe-application-versions `
    --application-name $EBAppName `
    --version-labels $ExpectedVersion `
    --region $AWSRegion `
    --query 'ApplicationVersions[0].VersionLabel' `
    --output text 2>&1

if ($versionCheck -ne $ExpectedVersion) {
    Write-ColorOutput Red "✗ Expected version '$ExpectedVersion' does not exist!"
    Write-Output ""
    Write-Output "Available versions:"
    aws elasticbeanstalk describe-application-versions `
        --application-name $EBAppName `
        --region $AWSRegion `
        --max-items 10 `
        --query 'ApplicationVersions[*].[VersionLabel,DateCreated]' `
        --output table
    exit 1
}

Write-ColorOutput Green "✓ Expected version exists"
Write-Output ""

Write-ColorOutput Yellow "[3/3] Deploying expected version to sync environment..."

# Deploy the expected version
$deployResult = aws elasticbeanstalk update-environment `
    --environment-name $EBEnvName `
    --version-label $ExpectedVersion `
    --region $AWSRegion 2>&1

if ($LASTEXITCODE -eq 0) {
    Write-Output ""
    Write-ColorOutput Green "✓ Deployment initiated successfully"
    Write-Output ""
    Write-ColorOutput Cyan "Monitoring deployment progress..."
    Write-Output "  This may take 5-15 minutes"
    Write-Output ""
    
    # Monitor deployment
    $timeout = 900  # 15 minutes
    $elapsed = 0
    
    while ($elapsed -lt $timeout) {
        Start-Sleep -Seconds 15
        $elapsed += 15
        
        $status = aws elasticbeanstalk describe-environments `
            --environment-names $EBEnvName `
            --region $AWSRegion `
            --query 'Environments[0].Status' `
            --output text
        
        $health = aws elasticbeanstalk describe-environments `
            --environment-names $EBEnvName `
            --region $AWSRegion `
            --query 'Environments[0].Health' `
            --output text
        
        $version = aws elasticbeanstalk describe-environments `
            --environment-names $EBEnvName `
            --region $AWSRegion `
            --query 'Environments[0].VersionLabel' `
            --output text
        
        Write-Output "  [$elapsed`s] Status: $status | Health: $health | Version: $version"
        
        if ($status -eq "Ready" -and $version -eq $ExpectedVersion -and $health -eq "Ok") {
            Write-Output ""
            Write-ColorOutput Green "✓ Deployment completed successfully!"
            Write-ColorOutput Green "✓ Environment is healthy and synced to expected version"
            exit 0
        }
        
        if ($status -eq "Ready" -and $version -eq $ExpectedVersion) {
            Write-Output ""
            Write-ColorOutput Yellow "⚠ Environment is Ready with correct version, but health is: $health"
            Write-Output "  Check the environment logs for any issues"
            break
        }
    }
    
    if ($elapsed -ge $timeout) {
        Write-Output ""
        Write-ColorOutput Yellow "⚠ Timeout reached. Check deployment status in AWS Console"
        Write-Output "  https://console.aws.amazon.com/elasticbeanstalk/home?region=$AWSRegion#/environments"
    }
} else {
    Write-ColorOutput Red "✗ Failed to initiate deployment"
    Write-Output $deployResult
    exit 1
}

Write-Output ""
Write-ColorOutput Cyan "========================================"
Write-ColorOutput Cyan "Script completed"
Write-ColorOutput Cyan "========================================"
