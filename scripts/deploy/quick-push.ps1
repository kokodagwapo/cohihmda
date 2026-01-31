# Quick Push Script - Build, push, and deploy Docker image
# Usage: .\quick-push.ps1

param(
    [switch]$SkipBuild,
    [switch]$NoDeploy
)

$ErrorActionPreference = "Stop"

# Configuration
$account = "339712788893"
$region = "us-east-2"
$profile = "DevEnvPerms-339712788893"
$cluster = "coheus-dev-cluster"
$service = "coheus-dev-service"
$repo = "coheus-backend"
$repoRoot = (Get-Item $PSScriptRoot).Parent.Parent.FullName

Write-Host "`n[$(Get-Date -Format 'HH:mm:ss')] Quick Push to ECS" -ForegroundColor Cyan

# Build
if (-not $SkipBuild) {
    Write-Host "`n[$(Get-Date -Format 'HH:mm:ss')] Building Docker image..." -ForegroundColor Yellow
    Push-Location $repoRoot
    docker build -f Dockerfile.backend -t "${repo}:latest" .
    if ($LASTEXITCODE -ne 0) { throw "Docker build failed" }
    Pop-Location
} else {
    Write-Host "`n[$(Get-Date -Format 'HH:mm:ss')] Skipping build" -ForegroundColor Gray
}

# Login to ECR
Write-Host "`n[$(Get-Date -Format 'HH:mm:ss')] Logging into ECR..." -ForegroundColor Yellow
$password = aws ecr get-login-password --region $region --profile $profile
$password | docker login --username AWS --password-stdin "$account.dkr.ecr.$region.amazonaws.com"
if ($LASTEXITCODE -ne 0) { throw "ECR login failed" }

# Tag and push
Write-Host "`n[$(Get-Date -Format 'HH:mm:ss')] Pushing to ECR..." -ForegroundColor Yellow
docker tag "${repo}:latest" "$account.dkr.ecr.$region.amazonaws.com/${repo}:latest"
docker push "$account.dkr.ecr.$region.amazonaws.com/${repo}:latest"
if ($LASTEXITCODE -ne 0) { throw "Docker push failed" }

# Force new deployment
if (-not $NoDeploy) {
    Write-Host "`n[$(Get-Date -Format 'HH:mm:ss')] Forcing ECS deployment..." -ForegroundColor Yellow
    aws ecs update-service `
        --cluster $cluster `
        --service $service `
        --force-new-deployment `
        --profile $profile `
        --region $region `
        --output text | Out-Null
    
    Write-Host "`n[$(Get-Date -Format 'HH:mm:ss')] Deployment triggered!" -ForegroundColor Green
    Write-Host "  Monitor: https://$region.console.aws.amazon.com/ecs/home?region=$region#/clusters/$cluster/services/$service/events"
} else {
    Write-Host "`n[$(Get-Date -Format 'HH:mm:ss')] Skipping deployment" -ForegroundColor Gray
}

Write-Host "`n[$(Get-Date -Format 'HH:mm:ss')] Done!" -ForegroundColor Green
Write-Host "`nTo connect via ECS Exec:"
Write-Host @"
  `$taskArn = aws ecs list-tasks --cluster $cluster --service-name $service --profile $profile --region $region --query 'taskArns[0]' --output text
  aws ecs execute-command --cluster $cluster --task `$taskArn --container coheus-backend --interactive --command "/bin/sh" --profile $profile --region $region
"@ -ForegroundColor Cyan
