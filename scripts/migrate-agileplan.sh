#!/bin/bash

# AgilePlan Database Migration Script
# Runs the AgilePlan migration on Docker PostgreSQL

set -e

echo "🚀 Starting AgilePlan database migration..."

# Check if PostgreSQL is running
if ! docker ps | grep -q coheus-postgres; then
  echo "❌ PostgreSQL container is not running. Please start it with: docker-compose up -d postgres"
  exit 1
fi

# Get the migration file path
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MIGRATION_FILE="$PROJECT_ROOT/supabase/migrations/20251211000000_agileplan.sql"

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
docker exec -i coheus-postgres psql -U postgres -d coheus -c "\dt public.kanban*"

echo ""
echo "✨ Done! AgilePlan tables are ready."
