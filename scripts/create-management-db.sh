#!/bin/bash
# Create Management Database Script
# Creates the coheus_management database for tenant metadata

set -e

# Configuration (can be overridden by environment variables)
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-postgres}"
DB_PASSWORD="${DB_PASSWORD:-postgres}"
DB_NAME="coheus_management"

echo "🔧 Creating management database: $DB_NAME"
echo "   Host: $DB_HOST"
echo "   Port: $DB_PORT"
echo "   User: $DB_USER"

# Export password for psql
export PGPASSWORD="$DB_PASSWORD"

# Check if database already exists
EXISTS=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" 2>/dev/null || echo "")

if [ "$EXISTS" = "1" ]; then
  echo "⚠️  Database $DB_NAME already exists"
  read -p "Do you want to continue anyway? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
  fi
fi

# Create database
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres <<EOF
CREATE DATABASE $DB_NAME;
\q
EOF

if [ $? -eq 0 ]; then
  echo "✅ Management database '$DB_NAME' created successfully"
  echo ""
  echo "Next steps:"
  echo "1. Set MANAGEMENT_DB_NAME=$DB_NAME in your .env file"
  echo "2. Start your server - schema will initialize automatically"
  echo "3. Or run: npm run init:management-schema"
else
  echo "❌ Failed to create management database"
  exit 1
fi
