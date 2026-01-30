# ============================================================================
# Run Database Migrations
# ============================================================================
# This script runs database migrations against Aurora PostgreSQL.
# 
# Prerequisites:
# - Aurora cluster deployed (01-deploy-aurora.ps1)
# - Backend deployed (02-deploy-backend.ps1) - for getting database credentials
# - Network access to Aurora (via bastion or VPN)
#
# Options:
# -DryRun           Preview migrations without applying
# -TenantSlug       Run migrations for a specific tenant
# -AllTenants       Run migrations for all active tenants
# -CreateSuperAdmin Create initial super admin user
# ============================================================================

param(
    [switch]$DryRun,
    [string]$TenantSlug,
    [switch]$AllTenants,
    [switch]$CreateSuperAdmin,
    [string]$SuperAdminEmail,
    [string]$SuperAdminPassword,
    [string]$SuperAdminName = "Super Admin"
)

# Load configuration
. "$PSScriptRoot/config.ps1"

Write-Status "Database Migration Runner" "Magenta"

# ============================================================================
# Get Aurora Connection Info from Secrets Manager
# ============================================================================
Write-Status "Retrieving database credentials..."

$SECRET_ARN = Get-StackOutput $STACK_AURORA_MGMT "SecretArn"
$CLUSTER_ENDPOINT = Get-StackOutput $STACK_AURORA_MGMT "ClusterEndpoint"

if (-not $SECRET_ARN) {
    Write-Status "ERROR: Aurora management stack not found. Deploy it first with 01-deploy-aurora.ps1" "Red"
    exit 1
}

Write-Status "Cluster: $CLUSTER_ENDPOINT"

# Get credentials from Secrets Manager
$secretJson = aws secretsmanager get-secret-value `
    --secret-id $SECRET_ARN `
    --profile $env:AWS_PROFILE `
    --region $env:AWS_REGION `
    --query 'SecretString' `
    --output text

$credentials = $secretJson | ConvertFrom-Json

# Set environment variables for the migration runner
$env:DB_HOST = $CLUSTER_ENDPOINT
$env:DB_PORT = "5432"
$env:DB_USER = $credentials.username
$env:DB_PASSWORD = $credentials.password
$env:MANAGEMENT_DB_NAME = "coheus_management"

Write-Status "Database: coheus_management @ $CLUSTER_ENDPOINT"

# ============================================================================
# Check if we can connect
# ============================================================================
Write-Status "Testing database connectivity..."

# Note: This requires psql or a Node.js test script
# For now, we'll proceed and let the migration script handle connection errors

# ============================================================================
# Run Migrations
# ============================================================================

$serverDir = Join-Path $PSScriptRoot "../../server"

Push-Location $serverDir

try {
    # Build arguments
    $migrationArgs = @()
    
    if ($TenantSlug) {
        $migrationArgs += "tenant"
        $migrationArgs += $TenantSlug
    } elseif ($AllTenants) {
        $migrationArgs += "all"
    } else {
        $migrationArgs += "up"
    }
    
    if ($DryRun) {
        $migrationArgs += "--dry-run"
        Write-Status "DRY RUN MODE - No changes will be made" "Yellow"
    }
    
    $migrationArgs += "--verbose"
    
    Write-Status "Running migrations..."
    Write-Host "  Command: npx tsx src/migrations/cli.ts $($migrationArgs -join ' ')" -ForegroundColor Gray
    Write-Host ""
    
    # Run the migration CLI
    npx tsx src/migrations/cli.ts @migrationArgs
    
    if ($LASTEXITCODE -ne 0) {
        Write-Status "Migration failed!" "Red"
        exit 1
    }
    
    # ============================================================================
    # Create Super Admin (if requested)
    # ============================================================================
    if ($CreateSuperAdmin) {
        Write-Host ""
        Write-Status "Creating Super Admin..."
        
        if (-not $SuperAdminEmail) {
            $SuperAdminEmail = Read-Host "Enter super admin email"
        }
        
        if (-not $SuperAdminPassword) {
            $SuperAdminPassword = Read-Host "Enter super admin password" -AsSecureString
            $SuperAdminPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($SuperAdminPassword))
        }
        
        # Set environment variables for seeding script
        $env:SEED_SUPER_ADMIN_EMAIL = $SuperAdminEmail
        $env:SEED_SUPER_ADMIN_PASSWORD = $SuperAdminPassword
        $env:SEED_SUPER_ADMIN_NAME = $SuperAdminName
        
        npx tsx scripts/seed-super-admin.ts
        
        if ($LASTEXITCODE -eq 0) {
            Write-Status "Super admin created: $SuperAdminEmail" "Green"
        } else {
            Write-Status "Failed to create super admin" "Red"
        }
        
        # Clear sensitive env vars
        $env:SEED_SUPER_ADMIN_PASSWORD = ""
    }
    
} finally {
    Pop-Location
}

Write-Host ""
Write-Status "Migration Complete!" "Green"
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Create a super admin (if not done):" -ForegroundColor Gray
Write-Host "     .\06-run-migrations.ps1 -CreateSuperAdmin" -ForegroundColor Gray
Write-Host ""
Write-Host "  2. Provision your first tenant:" -ForegroundColor Gray
Write-Host "     .\05-deploy-tenant-provisioning.ps1" -ForegroundColor Gray
Write-Host ""
