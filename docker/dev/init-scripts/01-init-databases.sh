#!/bin/bash
# =============================================================================
# PostgreSQL Docker Initialization Script
# =============================================================================
# This script runs automatically when the PostgreSQL container starts for the
# first time. It creates the necessary databases for local development.
#
# Note: This script only creates the databases. The actual schema migrations
# are run by the backend service on startup or via manual npm commands.
# =============================================================================

set -e

echo "🔧 Initializing Coheus databases..."

# Create management database
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    -- Create management database if it doesn't exist
    SELECT 'CREATE DATABASE coheus_management'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'coheus_management')\gexec
    
    -- Create test tenant database if it doesn't exist  
    SELECT 'CREATE DATABASE tenant_acme_mortgage'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'tenant_acme_mortgage')\gexec
EOSQL

echo "✅ Databases created:"
echo "   - coheus_management"
echo "   - tenant_acme_mortgage"
echo ""
echo "Note: Run migrations manually after backend starts:"
echo "   cd server && npm run migrate && npm run migrate:all"
