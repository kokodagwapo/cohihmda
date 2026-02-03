#!/bin/bash
# =============================================================================
# Coheus Local Database Initialization Script (Bash)
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
#   ./scripts/init-local-db.sh
#   ./scripts/init-local-db.sh --skip-seed   # Skip seeding test data
#   ./scripts/init-local-db.sh --reset       # Drop and recreate databases
#
# =============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration (can be overridden by environment variables)
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-postgres}"
DB_PASSWORD="${DB_PASSWORD:-postgres}"

# Database names
MANAGEMENT_DB="coheus_management"
TEST_TENANT_DB="tenant_acme_mortgage"

# Parse arguments
SKIP_SEED=false
RESET=false

for arg in "$@"; do
    case $arg in
        --skip-seed)
            SKIP_SEED=true
            shift
            ;;
        --reset)
            RESET=true
            shift
            ;;
        --help|-h)
            echo ""
            echo "Coheus Local Database Initialization Script"
            echo ""
            echo "USAGE:"
            echo "    ./scripts/init-local-db.sh [OPTIONS]"
            echo ""
            echo "OPTIONS:"
            echo "    --skip-seed    Skip seeding test data (only run migrations)"
            echo "    --reset        Drop and recreate all databases (WARNING: destroys data!)"
            echo "    --help, -h     Show this help message"
            echo ""
            echo "ENVIRONMENT VARIABLES:"
            echo "    DB_HOST      PostgreSQL host (default: localhost)"
            echo "    DB_PORT      PostgreSQL port (default: 5432)"
            echo "    DB_USER      PostgreSQL user (default: postgres)"
            echo "    DB_PASSWORD  PostgreSQL password (default: postgres)"
            echo ""
            echo "WHAT THIS SCRIPT DOES:"
            echo "    1. Creates coheus_management database"
            echo "    2. Creates test tenant database (tenant_acme_mortgage)"
            echo "    3. Runs all management database migrations"
            echo "    4. Runs all tenant database migrations"
            echo "    5. Seeds test accounts (unless --skip-seed is used):"
            echo "       - Super Admin: superadmin / super123"
            echo "       - Tenant Admin: admin@acme.local / admin123"
            echo "       - Loan Officer: user@acme.local / user123"
            echo ""
            echo "PREREQUISITES:"
            echo "    1. Docker running: docker compose up -d postgres"
            echo "    2. Dependencies installed: cd server && npm install"
            echo ""
            exit 0
            ;;
        *)
            ;;
    esac
done

echo ""
echo -e "${BLUE}============================================================${NC}"
echo -e "${BLUE}  Coheus Local Database Initialization${NC}"
echo -e "${BLUE}============================================================${NC}"
echo ""

echo -e "${CYAN}Database Configuration:${NC}"
echo "  Host:     $DB_HOST"
echo "  Port:     $DB_PORT"
echo "  User:     $DB_USER"
echo ""

# Export password for psql
export PGPASSWORD="$DB_PASSWORD"

# Check if PostgreSQL is accessible
echo -e "${CYAN}Checking PostgreSQL connection...${NC}"

if ! psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -c "SELECT 1" > /dev/null 2>&1; then
    echo -e "${RED}Cannot connect to PostgreSQL at ${DB_HOST}:${DB_PORT}${NC}"
    echo ""
    echo -e "${YELLOW}Make sure PostgreSQL is running:${NC}"
    echo "  docker compose -f docker/dev/docker-compose.dev.yml up -d postgres"
    echo "  # OR"
    echo "  docker compose up -d postgres"
    exit 1
fi

echo -e "${GREEN}✓ PostgreSQL is accessible${NC}"

# Reset databases if requested
if [ "$RESET" = true ]; then
    echo -e "${YELLOW}⚠️  RESETTING databases (all data will be lost)...${NC}"
    
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -c "DROP DATABASE IF EXISTS \"$MANAGEMENT_DB\"" 2>/dev/null || true
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -c "DROP DATABASE IF EXISTS \"$TEST_TENANT_DB\"" 2>/dev/null || true
    
    echo -e "${GREEN}✓ Databases dropped${NC}"
fi

# Step 1: Create databases
echo ""
echo -e "${CYAN}Step 1: Creating databases...${NC}"

# Check if management DB exists
MGMT_EXISTS=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$MANAGEMENT_DB'" 2>/dev/null || echo "")

if [ "$MGMT_EXISTS" = "1" ]; then
    echo "  Database $MANAGEMENT_DB already exists"
else
    echo "  Creating database: $MANAGEMENT_DB"
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -c "CREATE DATABASE \"$MANAGEMENT_DB\""
fi

# Check if tenant DB exists
TENANT_EXISTS=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$TEST_TENANT_DB'" 2>/dev/null || echo "")

if [ "$TENANT_EXISTS" = "1" ]; then
    echo "  Database $TEST_TENANT_DB already exists"
else
    echo "  Creating database: $TEST_TENANT_DB"
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -c "CREATE DATABASE \"$TEST_TENANT_DB\""
fi

echo -e "${GREEN}✓ Databases ready${NC}"

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$SCRIPT_DIR/../server"

# Step 2: Run management migrations
echo ""
echo -e "${CYAN}Step 2: Running management database migrations...${NC}"

cd "$SERVER_DIR"

export DB_HOST
export DB_PORT
export DB_USER
export DB_PASSWORD
export MANAGEMENT_DB_NAME="$MANAGEMENT_DB"

npx tsx src/migrations/cli.ts up

echo -e "${GREEN}✓ Management migrations complete${NC}"

# Step 3: Register test tenant in management DB
echo ""
echo -e "${CYAN}Step 3: Registering test tenant...${NC}"

psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$MANAGEMENT_DB" << EOF
INSERT INTO coheus_tenants (name, slug, database_name, database_host, database_port, database_user, database_password_encrypted, deployment_type, status)
VALUES ('Acme Mortgage', 'acme-mortgage', '$TEST_TENANT_DB', '$DB_HOST', $DB_PORT, '$DB_USER', 'local_dev_not_encrypted', 'cloud', 'active')
ON CONFLICT (slug) DO UPDATE SET
    database_host = EXCLUDED.database_host,
    database_port = EXCLUDED.database_port,
    updated_at = NOW();
EOF

echo -e "${GREEN}✓ Test tenant registered${NC}"

# Step 4: Run tenant migrations
echo ""
echo -e "${CYAN}Step 4: Running tenant database migrations...${NC}"

npx tsx src/migrations/cli.ts tenant --all

echo -e "${GREEN}✓ Tenant migrations complete${NC}"

# Step 5: Seed test data
if [ "$SKIP_SEED" = false ]; then
    echo ""
    echo -e "${CYAN}Step 5: Seeding test data...${NC}"
    
    export SEED_SUPER_ADMIN_EMAIL="superadmin"
    export SEED_SUPER_ADMIN_PASSWORD="super123"
    export SEED_SUPER_ADMIN_NAME="Super Admin"
    
    npx tsx scripts/seed-local-dev.ts || echo -e "${YELLOW}⚠️  Seeding had issues but continuing...${NC}"
fi

# Done!
echo ""
echo -e "${GREEN}============================================================${NC}"
echo -e "${GREEN}  Database initialization complete!${NC}"
echo -e "${GREEN}============================================================${NC}"
echo ""

if [ "$SKIP_SEED" = false ]; then
    echo "Test Accounts:"
    echo "------------------------------------------------------------"
    echo "SUPER ADMIN (Platform Level)"
    echo "  Email:    superadmin"
    echo "  Password: super123"
    echo ""
    echo "TENANT ADMIN (Acme Mortgage)"
    echo "  Email:    admin@acme.local"
    echo "  Password: admin123"
    echo ""
    echo "LOAN OFFICER (Acme Mortgage)"
    echo "  Email:    user@acme.local"
    echo "  Password: user123"
    echo "------------------------------------------------------------"
fi

echo ""
echo "Next steps:"
echo "  1. Start the backend:  cd server && npm run dev"
echo "  2. Start the frontend: npm run dev"
echo ""
