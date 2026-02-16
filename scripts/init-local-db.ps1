# =============================================================================
# Coheus Local Database Initialization Script (PowerShell)
# =============================================================================
# This script initializes a fresh local PostgreSQL database for development.
# Run this after starting your Docker PostgreSQL container.
#
# Prerequisites:
#   - Docker running with PostgreSQL container (docker compose up -d postgres)
#   - Node.js 18+ installed
#   - npm packages installed in server/ folder
#
# Usage:
#   .\scripts\init-local-db.ps1
#   .\scripts\init-local-db.ps1 -SkipSeed   # Skip seeding test data
#   .\scripts\init-local-db.ps1 -Reset      # Drop and recreate databases
#
# =============================================================================

param(
    [switch]$SkipSeed,
    [switch]$Reset,
    [switch]$Help
)

$ErrorActionPreference = "Stop"

# Colors
function Write-Success { Write-Host $args[0] -ForegroundColor Green }
function Write-Warning { Write-Host $args[0] -ForegroundColor Yellow }
function Write-Error { Write-Host $args[0] -ForegroundColor Red }
function Write-Info { Write-Host $args[0] -ForegroundColor Cyan }

# Configuration (can be overridden by environment variables)
$DB_HOST = if ($env:DB_HOST) { $env:DB_HOST } else { "localhost" }
$DB_PORT = if ($env:DB_PORT) { $env:DB_PORT } else { "5432" }
$DB_USER = if ($env:DB_USER) { $env:DB_USER } else { "postgres" }
$DB_PASSWORD = if ($env:DB_PASSWORD) { $env:DB_PASSWORD } else { "postgres" }

# Database names
$MANAGEMENT_DB = "coheus_management"
$TEST_TENANT_DB = "tenant_acme_mortgage"

if ($Help) {
    Write-Host @"

Coheus Local Database Initialization Script

USAGE:
    .\scripts\init-local-db.ps1 [OPTIONS]

OPTIONS:
    -SkipSeed    Skip seeding test data (only run migrations)
    -Reset       Drop and recreate all databases (WARNING: destroys data!)
    -Help        Show this help message

ENVIRONMENT VARIABLES:
    DB_HOST      PostgreSQL host (default: localhost)
    DB_PORT      PostgreSQL port (default: 5432)
    DB_USER      PostgreSQL user (default: postgres)
    DB_PASSWORD  PostgreSQL password (default: postgres)

WHAT THIS SCRIPT DOES:
    1. Creates coheus_management database
    2. Creates test tenant database (tenant_acme_mortgage)
    3. Runs all management database migrations
    4. Runs all tenant database migrations
    5. Seeds test accounts (unless -SkipSeed is used):
       - Super Admin: superadmin / super123
       - Tenant Admin: admin@acme.local / admin123
       - Loan Officer: user@acme.local / user123

PREREQUISITES:
    1. Docker running: docker compose up -d postgres
    2. Dependencies installed: cd server && npm install

"@
    exit 0
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Blue
Write-Host "  Coheus Local Database Initialization" -ForegroundColor Blue
Write-Host "============================================================" -ForegroundColor Blue
Write-Host ""

Write-Info "Database Configuration:"
Write-Host "  Host:     $DB_HOST"
Write-Host "  Port:     $DB_PORT"
Write-Host "  User:     $DB_USER"
Write-Host ""

# Check if PostgreSQL is accessible
Write-Info "Checking PostgreSQL connection..."

$env:PGPASSWORD = $DB_PASSWORD
try {
    $result = & psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d postgres -c "SELECT 1" 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Connection failed"
    }
    Write-Success "PostgreSQL is accessible"
} catch {
    Write-Error "Cannot connect to PostgreSQL at ${DB_HOST}:${DB_PORT}"
    Write-Host ""
    Write-Warning "Make sure PostgreSQL is running:"
    Write-Host "  docker compose -f docker/dev/docker-compose.dev.yml up -d postgres"
    Write-Host "  # OR"
    Write-Host "  docker compose up -d postgres"
    exit 1
}

# Reset databases if requested
if ($Reset) {
    Write-Warning "RESETTING databases (all data will be lost)..."
    
    # Drop databases
    & psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d postgres -c "DROP DATABASE IF EXISTS `"$MANAGEMENT_DB`"" 2>$null
    & psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d postgres -c "DROP DATABASE IF EXISTS `"$TEST_TENANT_DB`"" 2>$null
    
    Write-Success "Databases dropped"
}

# Step 1: Create databases
Write-Host ""
Write-Info "Step 1: Creating databases..."

# Check if management DB exists
$mgmtExists = & psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$MANAGEMENT_DB'" 2>$null
if ($mgmtExists -eq "1") {
    Write-Host "  Database $MANAGEMENT_DB already exists"
} else {
    Write-Host "  Creating database: $MANAGEMENT_DB"
    & psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d postgres -c "CREATE DATABASE `"$MANAGEMENT_DB`""
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to create $MANAGEMENT_DB"
        exit 1
    }
}

# Check if tenant DB exists
$tenantExists = & psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$TEST_TENANT_DB'" 2>$null
if ($tenantExists -eq "1") {
    Write-Host "  Database $TEST_TENANT_DB already exists"
} else {
    Write-Host "  Creating database: $TEST_TENANT_DB"
    & psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d postgres -c "CREATE DATABASE `"$TEST_TENANT_DB`""
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to create $TEST_TENANT_DB"
        exit 1
    }
}

Write-Success "Databases ready"

# Step 2: Run management migrations
Write-Host ""
Write-Info "Step 2: Running management database migrations..."

Push-Location "$PSScriptRoot\..\server"

try {
    # Set environment variables for migration
    $env:DB_HOST = $DB_HOST
    $env:DB_PORT = $DB_PORT
    $env:DB_USER = $DB_USER
    $env:DB_PASSWORD = $DB_PASSWORD
    $env:MANAGEMENT_DB_NAME = $MANAGEMENT_DB
    
    & npx tsx src/migrations/cli.ts up
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Management migrations failed"
        exit 1
    }
    Write-Success "Management migrations complete"
} finally {
    Pop-Location
}

# Step 3: Register test tenant in management DB
Write-Host ""
Write-Info "Step 3: Registering test tenant..."

$registerTenantSQL = @"
INSERT INTO coheus_tenants (name, slug, database_name, database_host, database_port, database_user, database_password_encrypted, deployment_type, status)
VALUES ('Acme Mortgage', 'acme-mortgage', '$TEST_TENANT_DB', '$DB_HOST', $DB_PORT, '$DB_USER', 'local_dev_not_encrypted', 'cloud', 'active')
ON CONFLICT (slug) DO UPDATE SET
    database_host = EXCLUDED.database_host,
    database_port = EXCLUDED.database_port,
    updated_at = NOW();
"@

& psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $MANAGEMENT_DB -c $registerTenantSQL 2>$null
Write-Success "Test tenant registered"

# Step 4: Run tenant migrations
Write-Host ""
Write-Info "Step 4: Running tenant database migrations..."

Push-Location "$PSScriptRoot\..\server"

try {
    & npx tsx src/migrations/cli.ts tenant --all
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Tenant migrations failed"
        exit 1
    }
    Write-Success "Tenant migrations complete"
} finally {
    Pop-Location
}

# Step 5: Seed test data
if (-not $SkipSeed) {
    Write-Host ""
    Write-Info "Step 5: Seeding test data..."
    
    Push-Location "$PSScriptRoot\..\server"
    
    try {
        # Set seed environment variables
        $env:SEED_SUPER_ADMIN_EMAIL = "superadmin"
        $env:SEED_SUPER_ADMIN_PASSWORD = "super123"
        $env:SEED_SUPER_ADMIN_NAME = "Super Admin"
        
        & npx tsx scripts/seed-local-dev.ts
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "Seeding had issues but continuing..."
        }
    } finally {
        Pop-Location
    }
}

# Done!
Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  Database initialization complete!" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""

if (-not $SkipSeed) {
    Write-Host "Test Accounts:"
    Write-Host "------------------------------------------------------------"
    Write-Host "SUPER ADMIN (Platform Level)"
    Write-Host "  Email:    superadmin"
    Write-Host "  Password: super123"
    Write-Host ""
    Write-Host "TENANT ADMIN (Acme Mortgage)"
    Write-Host "  Email:    admin@acme.local"
    Write-Host "  Password: admin123"
    Write-Host ""
    Write-Host "LOAN OFFICER (Acme Mortgage)"
    Write-Host "  Email:    user@acme.local"
    Write-Host "  Password: user123"
    Write-Host "------------------------------------------------------------"
}

Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Start the backend:  cd server && npm run dev"
Write-Host "  2. Start the frontend: npm run dev"
Write-Host ""
