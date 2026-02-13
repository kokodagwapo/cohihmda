#!/bin/bash
# ============================================================================
# Deploy Frontend to AWS S3
# ============================================================================
# This script builds and deploys the frontend to S3 bucket

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

S3_BUCKET="Cohi-frontend-1767135651"
REGION="us-east-1"

echo -e "${GREEN}🚀 Deploying Frontend to S3${NC}"
echo ""

# Check AWS CLI
if ! command -v aws &> /dev/null; then
    echo -e "${RED}❌ AWS CLI not found${NC}"
    exit 1
fi

# Check AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
    echo -e "${RED}❌ AWS credentials not configured${NC}"
    exit 1
fi

# Check if bucket exists
if ! aws s3 ls "s3://${S3_BUCKET}" &> /dev/null; then
    echo -e "${YELLOW}⚠️  Bucket ${S3_BUCKET} not found or not accessible${NC}"
    exit 1
fi

# Build frontend
echo -e "${GREEN}📦 Building frontend...${NC}"
npm install
npm run build

if [ ! -d "dist" ]; then
    echo -e "${RED}❌ Build directory 'dist' not found${NC}"
    exit 1
fi

# Sync to S3
echo -e "${GREEN}☁️  Uploading to S3...${NC}"
aws s3 sync dist/ "s3://${S3_BUCKET}" \
    --region "${REGION}" \
    --delete \
    --exclude ".DS_Store" \
    --exclude "*.map" \
    --cache-control "public, max-age=31536000, immutable" \
    --exclude "index.html" \
    --exclude "404.html"

# Upload index.html and 404.html with no cache
echo -e "${GREEN}📄 Uploading index.html and 404.html...${NC}"
aws s3 cp dist/index.html "s3://${S3_BUCKET}/index.html" \
    --region "${REGION}" \
    --content-type "text/html" \
    --cache-control "no-cache, no-store, must-revalidate"

aws s3 cp dist/404.html "s3://${S3_BUCKET}/404.html" \
    --region "${REGION}" \
    --content-type "text/html" \
    --cache-control "no-cache, no-store, must-revalidate"

# Set bucket website configuration
echo -e "${GREEN}⚙️  Configuring S3 website...${NC}"
aws s3 website "s3://${S3_BUCKET}" \
    --index-document index.html \
    --error-document 404.html \
    --region "${REGION}"

echo ""
echo -e "${GREEN}✅ Frontend deployed successfully!${NC}"
echo ""
echo -e "Frontend URL: ${GREEN}http://${S3_BUCKET}.s3-website-${REGION}.amazonaws.com${NC}"
echo ""
echo -e "If CloudFront is configured, use your custom domain instead."
