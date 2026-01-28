#!/bin/bash

# Fix CORS Error and Optimize Admin Page Loading
# This script updates FRONTEND_URL on Elastic Beanstalk

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Fix CORS Error - AWS Elastic Beanstalk${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Configuration
CLOUDFRONT_URL="https://d2wvs4i87rs881.cloudfront.net"
EB_ENV_NAME="${EB_ENV_NAME:-Cohi-backend-production}"
AWS_REGION="${AWS_REGION:-us-east-1}"

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo -e "${RED}✗ AWS CLI is not installed${NC}"
    echo "Install it from: https://aws.amazon.com/cli/"
    exit 1
fi

# Check AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
    echo -e "${RED}✗ AWS credentials not configured${NC}"
    echo "Run: aws configure"
    exit 1
fi

echo -e "${YELLOW}[1/3] Getting current environment variables...${NC}"

# Get current environment variables
CURRENT_ENV=$(aws elasticbeanstalk describe-configuration-settings \
  --application-name "${EB_ENV_NAME}" \
  --environment-name "${EB_ENV_NAME}" \
  --region "${AWS_REGION}" \
  --query 'ConfigurationSettings[0].OptionSettings' \
  --output json 2>/dev/null || echo "[]")

# Extract current FRONTEND_URL
CURRENT_FRONTEND_URL=$(echo "$CURRENT_ENV" | \
  jq -r '.[] | select(.Namespace == "aws:elasticbeanstalk:application:environment" and .OptionName == "FRONTEND_URL") | .Value' 2>/dev/null || echo "")

echo -e "  Current FRONTEND_URL: ${CURRENT_FRONTEND_URL:-'(not set)'}"
echo ""

# Build new FRONTEND_URL
if [ -z "$CURRENT_FRONTEND_URL" ]; then
  NEW_FRONTEND_URL="${CLOUDFRONT_URL}"
else
  # Check if CloudFront URL is already included
  if echo "$CURRENT_FRONTEND_URL" | grep -q "$CLOUDFRONT_URL"; then
    echo -e "${GREEN}✓ CloudFront URL already in FRONTEND_URL${NC}"
    echo -e "${YELLOW}Restarting backend to apply changes...${NC}"
    aws elasticbeanstalk restart-app-server \
      --environment-name "${EB_ENV_NAME}" \
      --region "${AWS_REGION}" \
      > /dev/null
    echo -e "${GREEN}✓ Backend restart initiated${NC}"
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${GREEN}✓ CORS Configuration Complete!${NC}"
    echo -e "${BLUE}========================================${NC}"
    exit 0
  else
    NEW_FRONTEND_URL="${CURRENT_FRONTEND_URL},${CLOUDFRONT_URL}"
  fi
fi

echo -e "${YELLOW}[2/3] Updating FRONTEND_URL environment variable...${NC}"
echo -e "  New FRONTEND_URL: ${NEW_FRONTEND_URL}"
echo ""

# Update environment variable
aws elasticbeanstalk update-environment \
  --environment-name "${EB_ENV_NAME}" \
  --option-settings \
    Namespace=aws:elasticbeanstalk:application:environment,OptionName=FRONTEND_URL,Value="${NEW_FRONTEND_URL}" \
  --region "${AWS_REGION}" \
  > /dev/null

if [ $? -eq 0 ]; then
  echo -e "${GREEN}✓ Environment variable updated successfully${NC}"
else
  echo -e "${RED}✗ Failed to update environment variable${NC}"
  exit 1
fi

echo ""
echo -e "${YELLOW}[3/3] Waiting for environment to update (2-5 minutes)...${NC}"
echo -e "${BLUE}This may take a few minutes. You can check status in AWS Console.${NC}"
echo ""

# Wait for environment to update (with timeout)
aws elasticbeanstalk wait environment-updated \
  --environment-names "${EB_ENV_NAME}" \
  --region "${AWS_REGION}" \
  --max-attempts 60 \
  --delay 5 \
  2>/dev/null || echo -e "${YELLOW}⚠ Update is in progress. Check status manually.${NC}"

echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}✓ CORS Configuration Updated!${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "The backend should now accept requests from:"
echo -e "  ${GREEN}${CLOUDFRONT_URL}${NC}"
echo ""
echo -e "Next steps:"
echo -e "  1. Wait 2-5 minutes for the update to complete"
echo -e "  2. Test the admin page: ${CLOUDFRONT_URL}/admin"
echo ""
