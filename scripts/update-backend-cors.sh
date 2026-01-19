#!/bin/bash
# ============================================================================
# Update Backend CORS Configuration for S3 Frontend
# ============================================================================
# This script helps update the FRONTEND_URL environment variable on the backend
# to allow requests from the S3 website domain

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Use environment variables for security
S3_FRONTEND_URL="${S3_FRONTEND_URL:-http://ailethia-frontend-1767135651.s3-website-us-east-1.amazonaws.com}"
BACKEND_IP="${1:-${EC2_HOST}}"
BACKEND_PORT="${2:-3001}"
SSH_KEY="${3:-${EC2_SSH_KEY:-~/.ssh/id_rsa}}"

# Validate required variables
if [ -z "$BACKEND_IP" ]; then
    echo -e "${RED}❌ Error: BACKEND_IP is required${NC}"
    echo -e "   Usage: $0 <backend_ip> [backend_port] [ssh_key_path]"
    echo -e "   Or set: export EC2_HOST=your-ec2-ip"
    exit 1
fi

echo -e "${GREEN}🔧 Updating Backend CORS Configuration${NC}"
echo -e "S3 Frontend URL: ${YELLOW}${S3_FRONTEND_URL}${NC}"
echo -e "Backend: ${YELLOW}${BACKEND_IP}:${BACKEND_PORT}${NC}"
echo ""

# Check if SSH key exists
if [ ! -f "$SSH_KEY" ] && [ "$SSH_KEY" = "~/.ssh/ailethia-key.pem" ]; then
    echo -e "${YELLOW}⚠️  SSH key not found at ${SSH_KEY}${NC}"
    echo -e "Please provide the path to your SSH key:"
    echo -e "  ${BLUE}./scripts/update-backend-cors.sh [backend-ip] [port] [ssh-key-path]${NC}"
    echo ""
    echo -e "${GREEN}Manual Steps:${NC}"
    echo -e "1. SSH into your EC2 instance"
    echo -e "2. Edit your backend .env file or PM2 ecosystem file"
    echo -e "3. Add/update FRONTEND_URL:"
    echo -e "   ${BLUE}FRONTEND_URL=${S3_FRONTEND_URL},http://localhost:8080${NC}"
    echo -e "4. Restart your backend service"
    exit 1
fi

echo -e "${BLUE}📝 Instructions for updating backend CORS:${NC}"
echo ""
echo -e "1. ${GREEN}SSH into your EC2 instance:${NC}"
echo -e "   ${BLUE}ssh -i ${SSH_KEY} ec2-user@${BACKEND_IP}${NC}"
echo ""
echo -e "2. ${GREEN}Find your backend configuration:${NC}"
echo -e "   ${BLUE}# If using PM2:${NC}"
echo -e "   ${BLUE}pm2 env 0 | grep FRONTEND_URL${NC}"
echo -e "   ${BLUE}pm2 ecosystem${NC}"
echo ""
echo -e "   ${BLUE}# If using .env file:${NC}"
echo -e "   ${BLUE}cd /path/to/your/server${NC}"
echo -e "   ${BLUE}nano .env${NC}"
echo ""
echo -e "3. ${GREEN}Update FRONTEND_URL:${NC}"
echo -e "   ${BLUE}FRONTEND_URL=${S3_FRONTEND_URL},http://localhost:8080${NC}"
echo ""
echo -e "4. ${GREEN}Restart backend:${NC}"
echo -e "   ${BLUE}# PM2:${NC}"
echo -e "   ${BLUE}pm2 restart all${NC}"
echo -e ""
echo -e "   ${BLUE}# systemd:${NC}"
echo -e "   ${BLUE}sudo systemctl restart your-backend-service${NC}"
echo ""
echo -e "5. ${GREEN}Verify:${NC}"
echo -e "   ${BLUE}curl http://${BACKEND_IP}:${BACKEND_PORT}/health${NC}"
echo -e "   ${BLUE}pm2 logs | grep 'Frontend URL'${NC}"
echo ""
echo -e "${YELLOW}⚠️  Note: The backend will automatically add HTTPS versions of HTTP origins.${NC}"
echo -e "${YELLOW}   When you set up CloudFront, add the CloudFront domain to FRONTEND_URL.${NC}"
echo ""

# Try to test backend connection
echo -e "${BLUE}Testing backend connection...${NC}"
if curl -s -f -m 5 "http://${BACKEND_IP}:${BACKEND_PORT}/health" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Backend is reachable${NC}"
else
    echo -e "${RED}❌ Backend is not reachable at http://${BACKEND_IP}:${BACKEND_PORT}${NC}"
    echo -e "${YELLOW}   Please check if the backend is running and accessible.${NC}"
fi

echo ""
echo -e "${GREEN}After updating, test the login at:${NC}"
echo -e "${BLUE}http://ailethia-frontend-1767135651.s3-website-us-east-1.amazonaws.com/admin${NC}"
