#!/bin/bash
# Prepare repository for clean GitHub upload
# Removes temporary files, deployment artifacts, and ensures only production-ready code

set -e

echo "🧹 Preparing repository for GitHub..."

# Remove all deployment zip files (excluding node_modules)
echo "Removing deployment zip files..."
find . -name "*.zip" -type f ! -path "*/node_modules/*" ! -path "*/.git/*" -delete

# Remove backup directories
echo "Removing backup directories..."
find . -type d -name "*_backup*" ! -path "*/node_modules/*" ! -path "*/.git/*" -exec rm -rf {} + 2>/dev/null || true
find . -type d -name "dist_backup*" ! -path "*/node_modules/*" ! -path "*/.git/*" -exec rm -rf {} + 2>/dev/null || true

# Remove temporary markdown files (keep essential ones)
echo "Cleaning up temporary documentation..."
# This is handled by .gitignore, but we can remove them from working directory
find . -name "*DEPLOYMENT*.md" ! -name "README.DEPLOYMENT.md" ! -path "*/node_modules/*" ! -path "*/.git/*" -delete 2>/dev/null || true
find . -name "*FIX*.md" ! -path "*/node_modules/*" ! -path "*/.git/*" -delete 2>/dev/null || true
find . -name "*STATUS*.md" ! -path "*/node_modules/*" ! -path "*/.git/*" -delete 2>/dev/null || true

# Verify .gitignore is in place
if [ ! -f .gitignore ]; then
    echo "❌ Error: .gitignore not found!"
    exit 1
fi

echo "✅ Repository cleanup complete!"
echo ""
echo "📋 Next steps:"
echo "1. Review changes: git status"
echo "2. Stage files: git add ."
echo "3. Commit: git commit -m 'Prepare for production GitHub repository'"
echo "4. Create new GitHub repository and push"
echo ""
echo "⚠️  Note: Make sure to review what will be committed before pushing!"
