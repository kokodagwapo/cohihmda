# ============================================================================
# Destroy All Coheus Stacks
# ============================================================================
# WARNING: This will delete all resources and data!
# ============================================================================

param(
    [switch]$Force,
    [switch]$KeepDatabase
)

# Load configuration
. "$PSScriptRoot/config.ps1"

Write-Host ""
Write-Host "============================================================" -ForegroundColor Red
Write-Host "        WARNING: STACK DESTRUCTION" -ForegroundColor Red
Write-Host "============================================================" -ForegroundColor Red
Write-Host ""
Write-Host "  This will DELETE the following stacks:" -ForegroundColor Yellow
Write-Host "    - $STACK_TENANT_PROVISIONING"
Write-Host "    - $STACK_MONITORING"
Write-Host "    - $STACK_WAF_CLOUDFRONT"
Write-Host "    - $STACK_AURORA_MGMT"
Write-Host "    - $PROJECT_NAME-$ENVIRONMENT-aurora-tenant-001"
if (-not $KeepDatabase) {
    Write-Host "    - $STACK_BACKEND (including DATABASE!)" -ForegroundColor Red
} else {
    Write-Host "    - $STACK_BACKEND (keeping database snapshot)"
}
Write-Host ""
Write-Host "  ALL DATA WILL BE LOST!" -ForegroundColor Red
Write-Host ""

if (-not $Force) {
    $confirm = Read-Host "Type 'DELETE' to confirm"
    if ($confirm -ne "DELETE") {
        Write-Host "Destruction cancelled." -ForegroundColor Yellow
        exit 0
    }
}

function Delete-Stack {
    param([string]$StackName, [string]$Region = $env:AWS_REGION)
    
    Write-Status "Deleting stack: $StackName"
    
    # Check if stack exists
    $exists = aws cloudformation describe-stacks --stack-name $StackName --profile $env:AWS_PROFILE --region $Region 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Status "Stack does not exist: $StackName" "Yellow"
        return
    }
    
    # Delete the stack
    aws cloudformation delete-stack --stack-name $StackName --profile $env:AWS_PROFILE --region $Region
    
    # Wait for deletion
    Write-Status "Waiting for deletion..."
    aws cloudformation wait stack-delete-complete --stack-name $StackName --profile $env:AWS_PROFILE --region $Region
    
    if ($LASTEXITCODE -eq 0) {
        Write-Status "Deleted: $StackName" "Green"
    } else {
        Write-Status "Failed to delete: $StackName (may have resources that need manual deletion)" "Red"
    }
}

# Delete in reverse order of dependencies
Delete-Stack $STACK_TENANT_PROVISIONING
Delete-Stack $STACK_MONITORING
Delete-Stack $STACK_WAF_CLOUDFRONT "us-east-1"
Delete-Stack "$PROJECT_NAME-$ENVIRONMENT-aurora-tenant-001"
Delete-Stack $STACK_AURORA_MGMT
Delete-Stack $STACK_BACKEND

# Clean up ECR repository
Write-Status "Cleaning up ECR repository..."
aws ecr delete-repository --repository-name $ECR_REPO --force --profile $env:AWS_PROFILE --region $env:AWS_REGION 2>$null

# Clean up S3 bucket
Write-Status "Cleaning up S3 bucket..."
aws s3 rb s3://$FRONTEND_BUCKET --force --profile $env:AWS_PROFILE 2>$null

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "        DESTRUCTION COMPLETE" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
