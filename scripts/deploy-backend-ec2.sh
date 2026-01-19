#!/bin/bash
# ============================================================================
# Deploy Backend to EC2
# ============================================================================
# This script builds and deploys the backend to EC2 instance

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration - Use environment variables for security
EC2_HOST="${EC2_HOST}"
EC2_USER="${EC2_USER:-ec2-user}"
SSH_KEY="${EC2_SSH_KEY:-${HOME}/.ssh/id_rsa}"
REMOTE_DIR="${EC2_REMOTE_DIR:-~/ailethia}"

# Validate required environment variables
if [ -z "$EC2_HOST" ]; then
    echo -e "${RED}❌ Error: EC2_HOST environment variable is required${NC}"
    echo -e "   Please set: export EC2_HOST=your-ec2-ip-or-hostname"
    exit 1
fi

echo -e "${GREEN}🚀 Deploying Backend to EC2${NC}"
echo ""

# Check SSH key
if [ ! -f "$SSH_KEY" ]; then
    echo -e "${YELLOW}⚠️  SSH key not found at ${SSH_KEY}${NC}"
    read -p "Enter path to SSH key (or press Enter to use default): " CUSTOM_KEY
    if [ -n "$CUSTOM_KEY" ] && [ -f "$CUSTOM_KEY" ]; then
        SSH_KEY="$CUSTOM_KEY"
    else
        echo -e "${RED}❌ SSH key is required${NC}"
        exit 1
    fi
fi

# Prepare backend (skip TypeScript build, use tsx in production)
echo -e "${GREEN}📦 Preparing backend...${NC}"
cd server
npm install
cd ..

# Create deployment package
echo -e "${GREEN}📦 Creating deployment package...${NC}"
TEMP_DIR=$(mktemp -d)
DEPLOY_PACKAGE="${TEMP_DIR}/backend-deploy.tar.gz"

# Copy necessary files (source files for tsx runtime)
mkdir -p "${TEMP_DIR}/backend"
cp -r server/src "${TEMP_DIR}/backend/"
cp -r server/package.json "${TEMP_DIR}/backend/"
cp -r server/package-lock.json "${TEMP_DIR}/backend/"
cp -r server/tsconfig.json "${TEMP_DIR}/backend/"

# Create tar
tar -czf "${DEPLOY_PACKAGE}" -C "${TEMP_DIR}" backend

# Deploy to EC2
echo -e "${GREEN}☁️  Deploying to EC2...${NC}"

# Create remote directory if it doesn't exist
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "${EC2_USER}@${EC2_HOST}" "mkdir -p ~/ailethia"

scp -i "$SSH_KEY" -o StrictHostKeyChecking=no "${DEPLOY_PACKAGE}" "${EC2_USER}@${EC2_HOST}:${REMOTE_DIR}/backend-deploy.tar.gz"

# SSH and extract
ssh -i "$SSH_KEY" "${EC2_USER}@${EC2_HOST}" << 'ENDSSH'
cd ~/ailethia
echo "Extracting deployment package..."
tar -xzf backend-deploy.tar.gz
echo "Installing dependencies..."
cd backend
npm install
echo "Restarting backend service..."
# Use pm2 if available, otherwise try systemd
if command -v pm2 &> /dev/null; then
    pm2 restart ailethia-backend || pm2 start "npx tsx src/index.ts" --name ailethia-backend
else
    sudo systemctl restart ailethia-backend || echo "⚠️  Please restart backend service manually"
fi
echo "✅ Backend deployed and restarted"
ENDSSH

# Cleanup
rm -rf "${TEMP_DIR}"

echo ""
echo -e "${GREEN}✅ Backend deployed successfully!${NC}"
echo ""
echo -e "Backend URL: ${GREEN}http://${EC2_HOST}:3001${NC}"
