#!/bin/bash

# Deploy Backend with CORS Fix to Elastic Beanstalk
# This script builds the backend with latest CORS fixes and deploys it

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Deploy Backend with CORS Fix${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Configuration
EB_APP_NAME="${EB_APP_NAME:-ailethia-backend}"
EB_ENV_NAME="${EB_ENV_NAME:-ailethia-backend-production}"
AWS_REGION="${AWS_REGION:-us-east-1}"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
PACKAGE_NAME="ailethia-backend-cors-fix-${TIMESTAMP}.zip"

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo -e "${RED}✗ AWS CLI is not installed${NC}"
    exit 1
fi

# Check AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
    echo -e "${RED}✗ AWS credentials not configured${NC}"
    exit 1
fi

echo -e "${YELLOW}[1/6] Building backend...${NC}"
cd server

# Install dependencies
echo "Installing dependencies..."
npm install

# Build TypeScript
echo "Building TypeScript..."
npm run build

if [ ! -d "dist" ]; then
    echo -e "${RED}✗ Build directory 'dist' not found${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Backend built successfully${NC}"
echo ""

echo -e "${YELLOW}[2/6] Creating deployment package...${NC}"

# Create deployment package from server directory (so files are at root when extracted)
# We're already in server/ directory from step 1
zip -r "../${PACKAGE_NAME}" \
  dist/ \
  node_modules/ \
  package.json \
  package-lock.json \
  Procfile \
  .ebignore \
  .ebextensions/ \
  .platform/ \
  -x "*.log" "*.md" ".git/*" "*.zip" ".env*" "tsconfig.json" "src/**/*.ts" "!src/**/*.js"
cd ..

if [ ! -f "${PACKAGE_NAME}" ]; then
    echo -e "${RED}✗ Package creation failed${NC}"
    exit 1
fi

PACKAGE_SIZE=$(du -h "${PACKAGE_NAME}" | cut -f1)
echo -e "${GREEN}✓ Package created: ${PACKAGE_NAME} (${PACKAGE_SIZE})${NC}"
echo ""

echo -e "${YELLOW}[3/6] Uploading to S3...${NC}"

# Get S3 bucket for Elastic Beanstalk
S3_BUCKET="elasticbeanstalk-${AWS_REGION}-$(aws sts get-caller-identity --query Account --output text)"
S3_KEY="${EB_APP_NAME}/${PACKAGE_NAME}"

# Create bucket if it doesn't exist
if ! aws s3 ls "s3://${S3_BUCKET}" &> /dev/null; then
    echo "Creating S3 bucket: ${S3_BUCKET}"
    aws s3 mb "s3://${S3_BUCKET}" --region "${AWS_REGION}"
fi

# Upload package
aws s3 cp "${PACKAGE_NAME}" "s3://${S3_BUCKET}/${S3_KEY}" --region "${AWS_REGION}"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Package uploaded to S3${NC}"
else
    echo -e "${RED}✗ S3 upload failed${NC}"
    exit 1
fi
echo ""

echo -e "${YELLOW}[4/6] Creating application version...${NC}"

VERSION_LABEL="cors-fix-${TIMESTAMP}"

aws elasticbeanstalk create-application-version \
    --application-name "${EB_APP_NAME}" \
    --version-label "${VERSION_LABEL}" \
    --source-bundle "S3Bucket=${S3_BUCKET},S3Key=${S3_KEY}" \
    --region "${AWS_REGION}" \
    --description "Backend deployment with CORS fix for CloudFront" \
    > /dev/null

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Application version created: ${VERSION_LABEL}${NC}"
else
    echo -e "${RED}✗ Application version creation failed${NC}"
    exit 1
fi
echo ""

echo -e "${YELLOW}[5/6] Verifying environment variables...${NC}"

# Check if FRONTEND_URL is set
CURRENT_ENV=$(aws elasticbeanstalk describe-configuration-settings \
  --application-name "${EB_APP_NAME}" \
  --environment-name "${EB_ENV_NAME}" \
  --region "${AWS_REGION}" \
  --query 'ConfigurationSettings[0].OptionSettings' \
  --output json 2>/dev/null || echo "[]")

CURRENT_FRONTEND_URL=$(echo "$CURRENT_ENV" | \
  jq -r '.[] | select(.Namespace == "aws:elasticbeanstalk:application:environment" and .OptionName == "FRONTEND_URL") | .Value' 2>/dev/null || echo "")

if [ -z "$CURRENT_FRONTEND_URL" ] || ! echo "$CURRENT_FRONTEND_URL" | grep -q "d2wvs4i87rs881.cloudfront.net"; then
    echo -e "${YELLOW}⚠️  FRONTEND_URL not set or missing CloudFront URL${NC}"
    echo -e "${YELLOW}   Updating FRONTEND_URL environment variable...${NC}"
    
    if [ -z "$CURRENT_FRONTEND_URL" ]; then
        NEW_FRONTEND_URL="https://d2wvs4i87rs881.cloudfront.net"
    else
        NEW_FRONTEND_URL="${CURRENT_FRONTEND_URL},https://d2wvs4i87rs881.cloudfront.net"
    fi
    
    aws elasticbeanstalk update-environment \
      --environment-name "${EB_ENV_NAME}" \
      --option-settings \
        Namespace=aws:elasticbeanstalk:application:environment,OptionName=FRONTEND_URL,Value="${NEW_FRONTEND_URL}" \
      --region "${AWS_REGION}" \
      > /dev/null
    
    echo -e "${GREEN}✓ FRONTEND_URL updated${NC}"
    echo -e "${YELLOW}   Waiting for environment update to complete...${NC}"
    aws elasticbeanstalk wait environment-updated \
      --environment-names "${EB_ENV_NAME}" \
      --region "${AWS_REGION}" \
      --max-attempts 60 \
      --delay 5 \
      2>/dev/null || echo -e "${YELLOW}⚠️  Environment update in progress${NC}"
else
    echo -e "${GREEN}✓ FRONTEND_URL already configured${NC}"
fi
echo ""

echo -e "${YELLOW}[6/6] Deploying to environment...${NC}"

aws elasticbeanstalk update-environment \
    --environment-name "${EB_ENV_NAME}" \
    --version-label "${VERSION_LABEL}" \
    --region "${AWS_REGION}" \
    > /dev/null

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Deployment initiated${NC}"
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${GREEN}✅ Deployment Started!${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""
    echo -e "Deployment Status:"
    echo -e "  Application: ${EB_APP_NAME}"
    echo -e "  Environment: ${EB_ENV_NAME}"
    echo -e "  Version: ${VERSION_LABEL}"
    echo -e "  Package: ${PACKAGE_NAME} (${PACKAGE_SIZE})"
    echo ""
    echo -e "${YELLOW}⏳ This will take 5-10 minutes to complete.${NC}"
    echo ""
    echo -e "Monitor deployment:"
    echo -e "  ${BLUE}aws elasticbeanstalk describe-environments --environment-names ${EB_ENV_NAME} --region ${AWS_REGION} --query 'Environments[0].Status'${NC}"
    echo ""
    echo -e "Or check in AWS Console:"
    echo -e "  ${BLUE}https://console.aws.amazon.com/elasticbeanstalk/home?region=${AWS_REGION}#/environment/dashboard?applicationName=${EB_APP_NAME}&environmentId=${EB_ENV_NAME}${NC}"
    echo ""
    echo -e "After deployment completes, test:"
    echo -e "  ${GREEN}https://d2wvs4i87rs881.cloudfront.net/admin${NC}"
else
    echo -e "${RED}✗ Deployment failed${NC}"
    exit 1
fi
