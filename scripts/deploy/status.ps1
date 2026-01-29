# ============================================================================
# Check Status of All Coheus Stacks
# ============================================================================

# Load configuration
. "$PSScriptRoot/config.ps1"

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "        COHEUS STACK STATUS" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

$stacks = @(
    @{ Name = $STACK_BACKEND; Region = $env:AWS_REGION; Description = "ECS Fargate Backend" }
    @{ Name = $STACK_AURORA_MGMT; Region = $env:AWS_REGION; Description = "Aurora Management Cluster" }
    @{ Name = "$PROJECT_NAME-$ENVIRONMENT-aurora-tenant-001"; Region = $env:AWS_REGION; Description = "Aurora Tenant Cluster 001" }
    @{ Name = $STACK_WAF_CLOUDFRONT; Region = "us-east-1"; Description = "WAF + CloudFront" }
    @{ Name = $STACK_MONITORING; Region = $env:AWS_REGION; Description = "Monitoring" }
    @{ Name = $STACK_TENANT_PROVISIONING; Region = $env:AWS_REGION; Description = "Tenant Provisioning" }
)

foreach ($stack in $stacks) {
    $status = aws cloudformation describe-stacks `
        --stack-name $stack.Name `
        --profile $env:AWS_PROFILE `
        --region $stack.Region `
        --query 'Stacks[0].StackStatus' `
        --output text 2>$null
    
    if ($LASTEXITCODE -eq 0) {
        $color = switch -Wildcard ($status) {
            "*COMPLETE" { "Green" }
            "*IN_PROGRESS" { "Yellow" }
            "*FAILED*" { "Red" }
            "*ROLLBACK*" { "Red" }
            default { "White" }
        }
        Write-Host ("  [{0,-25}] {1,-20} - {2}" -f $stack.Description, $status, $stack.Name) -ForegroundColor $color
    } else {
        Write-Host ("  [{0,-25}] {1,-20}" -f $stack.Description, "NOT DEPLOYED") -ForegroundColor DarkGray
    }
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# Show key endpoints if backend is deployed
$backendUrl = Get-StackOutput $STACK_BACKEND "ALBDNSName"
if ($backendUrl) {
    Write-Host "  Key Endpoints:" -ForegroundColor Yellow
    Write-Host "    Backend API: http://$backendUrl" -ForegroundColor Cyan
    
    # Health check
    Write-Host ""
    Write-Host "  Health Check:" -ForegroundColor Yellow
    try {
        $response = Invoke-WebRequest -Uri "http://$backendUrl/health" -TimeoutSec 5 -UseBasicParsing
        Write-Host "    Status: $($response.StatusCode) OK" -ForegroundColor Green
    } catch {
        Write-Host "    Status: UNREACHABLE" -ForegroundColor Red
    }
}

Write-Host ""
