# PowerShell script to create management database
# Create Management Database Script for Windows

param(
    [string]$DB_HOST = "localhost",
    [int]$DB_PORT = 5432,
    [string]$DB_USER = "postgres",
    [string]$DB_PASSWORD = "postgres",
    [string]$DB_NAME = "coheus_management"
)

Write-Host "Creating management database: $DB_NAME" -ForegroundColor Cyan
Write-Host "   Host: $DB_HOST"
Write-Host "   Port: $DB_PORT"
Write-Host "   User: $DB_USER"

# Set password environment variable
$env:PGPASSWORD = $DB_PASSWORD

try {
    # Check if Docker is available and use it, otherwise try psql directly
    $useDocker = $false
    $dockerCheck = docker ps --filter "name=coheus-postgres" --format "{{.Names}}" 2>$null
    if ($dockerCheck -match "coheus-postgres") {
        $useDocker = $true
        Write-Host "Using Docker to connect to PostgreSQL" -ForegroundColor Cyan
    }
    
    if ($useDocker) {
        # Check if database already exists using Docker
        $exists = docker exec coheus-postgres psql -U $DB_USER -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" 2>$null
        
        if ($exists -eq "1") {
            Write-Host "WARNING: Database $DB_NAME already exists" -ForegroundColor Yellow
            Write-Host "Database already exists - schema will initialize on app start" -ForegroundColor Green
            exit 0
        }

        # Create database using Docker
        docker exec coheus-postgres psql -U $DB_USER -d postgres -c "CREATE DATABASE $DB_NAME;" | Out-Null
    } else {
        # Try direct psql connection
        # Check if database already exists
        $exists = psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" 2>$null
        
        if ($exists -eq "1") {
            Write-Host "WARNING: Database $DB_NAME already exists" -ForegroundColor Yellow
            $response = Read-Host "Do you want to continue anyway? (y/N)"
            if ($response -ne "y" -and $response -ne "Y") {
                Write-Host "Aborted." -ForegroundColor Yellow
                exit 0
            }
        }

        # Create database
        $createDb = "CREATE DATABASE $DB_NAME;"
        psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d postgres -c $createDb | Out-Null
    }

    if ($LASTEXITCODE -eq 0 -or $useDocker) {
        Write-Host "SUCCESS: Management database '$DB_NAME' created successfully" -ForegroundColor Green
        Write-Host ""
        Write-Host "Next steps:" -ForegroundColor Cyan
        Write-Host "1. Set MANAGEMENT_DB_NAME=$DB_NAME in your .env file"
        Write-Host "2. Start your server - schema will initialize automatically"
        Write-Host "3. Or run: npm run init:management-schema"
    } else {
        Write-Host "ERROR: Failed to create management database" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "ERROR: $_" -ForegroundColor Red
    exit 1
} finally {
    # Clear password from environment
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}
