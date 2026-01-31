#!/bin/sh
set -e

echo "🚀 Starting Coheus Backend..."

# Start the application
# Note: Migrations should be run via ECS Exec before deployment, not on startup.
# See server/migrations/README.md for instructions.
exec "$@"
