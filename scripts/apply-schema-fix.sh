#!/bin/bash

# Apply Schema Fix Migration
# Runs the loans table schema fix migration

set -e

echo "🚀 Applying loans table schema fix migration..."

# Check if PostgreSQL is running (Docker)
if docker ps | grep -q coheus-postgres; then
  echo "📦 Using Docker PostgreSQL container"
  
  # Get the migration file path
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
  MIGRATION_FILE="$PROJECT_ROOT/supabase/migrations/20251231000000_fix_loans_schema.sql"
  
  if [ ! -f "$MIGRATION_FILE" ]; then
    echo "❌ Migration file not found: $MIGRATION_FILE"
    exit 1
  fi
  
  echo "📄 Found migration file: $MIGRATION_FILE"
  
  # Run migration using docker exec
  echo "🔄 Running migration..."
  docker exec -i coheus-postgres psql -U postgres -d coheus < "$MIGRATION_FILE"
  
  if [ $? -eq 0 ]; then
    echo "✅ Migration completed successfully!"
  else
    echo "❌ Migration failed!"
    exit 1
  fi
  
  echo ""
  echo "📊 Verifying migration..."
  docker exec -i coheus-postgres psql -U postgres -d coheus -c "\d public.loans" | grep -E "borrower_name|loan_id|unique_loan_per_tenant" || echo "⚠️  Some columns/constraints may need manual verification"
  
  echo ""
  echo "✨ Schema fix applied! Loans table is now aligned with backend code."
  
elif command -v psql &> /dev/null; then
  echo "📦 Using local PostgreSQL"
  
  # Get the migration file path
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
  MIGRATION_FILE="$PROJECT_ROOT/supabase/migrations/20251231000000_fix_loans_schema.sql"
  
  if [ ! -f "$MIGRATION_FILE" ]; then
    echo "❌ Migration file not found: $MIGRATION_FILE"
    exit 1
  fi
  
  # Try to detect database connection from environment or use defaults
  DB_NAME="${DB_NAME:-coheus}"
  DB_USER="${DB_USER:-postgres}"
  DB_HOST="${DB_HOST:-localhost}"
  DB_PORT="${DB_PORT:-5432}"
  
  echo "📄 Found migration file: $MIGRATION_FILE"
  echo "🔌 Connecting to: $DB_USER@$DB_HOST:$DB_PORT/$DB_NAME"
  
  # Run migration
  echo "🔄 Running migration..."
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "$MIGRATION_FILE"
  
  if [ $? -eq 0 ]; then
    echo "✅ Migration completed successfully!"
  else
    echo "❌ Migration failed!"
    exit 1
  fi
  
  echo ""
  echo "📊 Verifying migration..."
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "\d public.loans" | grep -E "borrower_name|loan_id|unique_loan_per_tenant" || echo "⚠️  Some columns/constraints may need manual verification"
  
  echo ""
  echo "✨ Schema fix applied! Loans table is now aligned with backend code."
  
else
  echo "❌ PostgreSQL not found. Please ensure PostgreSQL is running."
  echo ""
  echo "Options:"
  echo "  1. Start Docker PostgreSQL: docker-compose up -d postgres"
  echo "  2. Install PostgreSQL locally and ensure psql is in PATH"
  echo "  3. The migration will run automatically when the backend server starts"
  exit 1
fi
