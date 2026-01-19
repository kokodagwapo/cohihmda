#!/bin/bash
# ============================================================================
# Create Default Admin User Script
# ============================================================================

cd "$(dirname "$0")/../server" || exit 1

echo "🔐 Creating default admin user..."
echo ""

# Check if Node.js is available
if ! command -v node &> /dev/null; then
    echo "❌ Error: Node.js is not installed"
    exit 1
fi

# Run the script
node ../scripts/create-admin-user.js

