#!/bin/sh
# Create local homestead tenant DB for development (runs on first postgres init only).
# If postgres_data already exists, run: docker exec coheus-postgres psql -U postgres -c "CREATE DATABASE coheus_tenant_homestead;"
set -e
psql -v ON_ERROR_STOP=0 --username "$POSTGRES_USER" -d postgres -c "CREATE DATABASE coheus_tenant_homestead;" || true
