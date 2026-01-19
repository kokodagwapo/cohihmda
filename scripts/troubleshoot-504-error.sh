#!/bin/bash

# Troubleshoot 504 Gateway Timeout Error
# This script helps diagnose why CloudFront is returning 504 errors

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔍 Troubleshooting 504 Gateway Timeout Error${NC}"
echo ""

# Get parameters
if [ -z "$1" ]; then
  echo -e "${YELLOW}Usage: $0 <CLOUDFRONT_DOMAIN> [EB_ENDPOINT]${NC}"
  echo "Example: $0 d3md5i2axhc2fr.cloudfront.net"
  exit 1
fi

CLOUDFRONT_DOMAIN=$1
EB_ENDPOINT=${2:-""}

echo -e "${BLUE}CloudFront Domain: ${CLOUDFRONT_DOMAIN}${NC}"
if [ -n "$EB_ENDPOINT" ]; then
  echo -e "${BLUE}EB Endpoint: ${EB_ENDPOINT}${NC}"
fi
echo ""

# Step 1: Test CloudFront health endpoint
echo -e "${YELLOW}1. Testing CloudFront /api/health endpoint...${NC}"
HEALTH_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "https://${CLOUDFRONT_DOMAIN}/api/health" || echo "000")
if [ "$HEALTH_RESPONSE" = "200" ] || [ "$HEALTH_RESPONSE" = "503" ]; then
  echo -e "${GREEN}✓ CloudFront /api/health returned: ${HEALTH_RESPONSE}${NC}"
else
  echo -e "${RED}✗ CloudFront /api/health returned: ${HEALTH_RESPONSE}${NC}"
fi
echo ""

# Step 2: Test CloudFront funnel endpoint
echo -e "${YELLOW}2. Testing CloudFront /api/loans/funnel endpoint...${NC}"
FUNNEL_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 60 "https://${CLOUDFRONT_DOMAIN}/api/loans/funnel" || echo "000")
if [ "$FUNNEL_RESPONSE" = "200" ]; then
  echo -e "${GREEN}✓ CloudFront /api/loans/funnel returned: ${FUNNEL_RESPONSE}${NC}"
elif [ "$FUNNEL_RESPONSE" = "504" ]; then
  echo -e "${RED}✗ CloudFront /api/loans/funnel returned: 504 Gateway Timeout${NC}"
  echo -e "${YELLOW}  This indicates the backend is not responding within CloudFront's timeout (30-60 seconds)${NC}"
else
  echo -e "${YELLOW}⚠ CloudFront /api/loans/funnel returned: ${FUNNEL_RESPONSE}${NC}"
fi
echo ""

# Step 3: Test backend directly (if endpoint provided)
if [ -n "$EB_ENDPOINT" ]; then
  echo -e "${YELLOW}3. Testing backend directly (bypassing CloudFront)...${NC}"
  
  # Remove http:// or https:// if present
  EB_ENDPOINT_CLEAN=$(echo "$EB_ENDPOINT" | sed 's|^https\?://||')
  
  # Test health
  EB_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "http://${EB_ENDPOINT_CLEAN}/health" || echo "000")
  if [ "$EB_HEALTH" = "200" ] || [ "$EB_HEALTH" = "503" ]; then
    echo -e "${GREEN}✓ Backend /health returned: ${EB_HEALTH}${NC}"
  else
    echo -e "${RED}✗ Backend /health returned: ${EB_HEALTH}${NC}"
    echo -e "${YELLOW}  Backend may be down or not accessible${NC}"
  fi
  
  # Test funnel endpoint
  EB_FUNNEL=$(curl -s -o /dev/null -w "%{http_code}" --max-time 60 "http://${EB_ENDPOINT_CLEAN}/api/loans/funnel" || echo "000")
  if [ "$EB_FUNNEL" = "200" ]; then
    echo -e "${GREEN}✓ Backend /api/loans/funnel returned: ${EB_FUNNEL}${NC}"
  elif [ "$EB_FUNNEL" = "000" ]; then
    echo -e "${RED}✗ Backend /api/loans/funnel timed out or connection refused${NC}"
    echo -e "${YELLOW}  Backend is not responding - check Elastic Beanstalk environment status${NC}"
  else
    echo -e "${YELLOW}⚠ Backend /api/loans/funnel returned: ${EB_FUNNEL}${NC}"
  fi
  echo ""
fi

# Step 4: Recommendations
echo -e "${BLUE}📋 Recommendations:${NC}"
echo ""

if [ "$FUNNEL_RESPONSE" = "504" ]; then
  echo -e "${YELLOW}If CloudFront returns 504 but backend works directly:${NC}"
  echo "  1. Check CloudFront origin configuration"
  echo "  2. Verify CloudFront origin points to correct backend endpoint"
  echo "  3. Check CloudFront origin timeout settings (should be 60+ seconds)"
  echo "  4. Wait 10-15 minutes for CloudFront changes to propagate"
  echo ""
  
  if [ -n "$EB_ENDPOINT" ] && [ "$EB_FUNNEL" != "200" ]; then
    echo -e "${YELLOW}If backend also times out:${NC}"
    echo "  1. Check Elastic Beanstalk environment health in AWS Console"
    echo "  2. Check application logs: aws elasticbeanstalk retrieve-environment-info"
    echo "  3. Verify database connection is working"
    echo "  4. Check if database queries are taking too long"
    echo ""
  fi
fi

echo -e "${BLUE}To get your backend endpoint:${NC}"
echo "  aws cloudformation describe-stacks \\"
echo "    --stack-name [YOUR_STACK_NAME] \\"
echo "    --query 'Stacks[0].Outputs[?OutputKey==\`BackendEndpoint\`].OutputValue' \\"
echo "    --output text"
echo ""
