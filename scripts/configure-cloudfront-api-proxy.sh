#!/bin/bash

# CloudFront API Proxy Configuration Script
# This script adds a backend origin and /api/* cache behavior to CloudFront

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DISTRIBUTION_ID="E2X6I83M2HKMVB"
BACKEND_ORIGIN_DOMAIN="awseb-e-c-AWSEBLoa-1WULU3BR4EZJV-923689480.us-east-1.elb.amazonaws.com"
BACKEND_ORIGIN_ID="Cohi-backend-alb"
REGION="us-east-1"

echo -e "${BLUE}🔧 Configuring CloudFront API Proxy${NC}"
echo -e "${BLUE}Distribution ID: ${DISTRIBUTION_ID}${NC}"
echo -e "${BLUE}Backend Origin: ${BACKEND_ORIGIN_DOMAIN}${NC}"
echo ""

# Step 1: Get current distribution config
echo -e "${YELLOW}📥 Fetching current distribution configuration...${NC}"
DIST_CONFIG=$(aws cloudfront get-distribution-config \
  --id "$DISTRIBUTION_ID" \
  --region "$REGION" 2>&1)

if [ $? -ne 0 ]; then
  echo -e "${RED}❌ Error fetching distribution config:${NC}"
  echo "$DIST_CONFIG"
  exit 1
fi

# Extract ETag (required for update)
ETAG=$(echo "$DIST_CONFIG" | jq -r '.ETag')
echo -e "${GREEN}✓ Got ETag: ${ETAG}${NC}"

# Extract current config
CURRENT_CONFIG=$(echo "$DIST_CONFIG" | jq '.DistributionConfig')

# Check if backend origin already exists
EXISTING_ORIGIN=$(echo "$CURRENT_CONFIG" | jq ".Origins.Items[] | select(.Id == \"$BACKEND_ORIGIN_ID\")")

if [ -n "$EXISTING_ORIGIN" ]; then
  echo -e "${YELLOW}⚠️  Backend origin '${BACKEND_ORIGIN_ID}' already exists${NC}"
else
  echo -e "${YELLOW}➕ Adding backend origin...${NC}"
  
  # Get existing origins
  ORIGINS=$(echo "$CURRENT_CONFIG" | jq '.Origins')
  ORIGIN_COUNT=$(echo "$ORIGINS" | jq '.Quantity')
  
  # Add new origin
  NEW_ORIGIN=$(cat <<EOF
{
  "Id": "$BACKEND_ORIGIN_ID",
  "DomainName": "$BACKEND_ORIGIN_DOMAIN",
  "CustomOriginConfig": {
    "HTTPPort": 80,
    "HTTPSPort": 443,
    "OriginProtocolPolicy": "http-only",
    "OriginSslProtocols": {
      "Quantity": 1,
      "Items": ["TLSv1.2"]
    },
    "OriginReadTimeout": 30,
    "OriginKeepaliveTimeout": 5
  }
}
EOF
)
  
  # Merge new origin with existing origins
  UPDATED_ORIGINS=$(echo "$ORIGINS" | jq --argjson new_origin "$NEW_ORIGIN" \
    '.Items += [$new_origin] | .Quantity += 1')
  
  # Update config with new origins
  CURRENT_CONFIG=$(echo "$CURRENT_CONFIG" | jq --argjson origins "$UPDATED_ORIGINS" '.Origins = $origins')
  
  echo -e "${GREEN}✓ Backend origin added${NC}"
fi

# Check if /api/* behavior already exists
EXISTING_BEHAVIOR=$(echo "$CURRENT_CONFIG" | jq ".CacheBehaviors.Items[]? | select(.PathPattern == \"/api/*\")")

if [ -n "$EXISTING_BEHAVIOR" ]; then
  echo -e "${YELLOW}⚠️  Cache behavior '/api/*' already exists${NC}"
else
  echo -e "${YELLOW}➕ Adding /api/* cache behavior...${NC}"
  
  # Get existing cache behaviors (if any)
  CACHE_BEHAVIORS=$(echo "$CURRENT_CONFIG" | jq '.CacheBehaviors // {"Quantity": 0, "Items": []}')
  BEHAVIOR_COUNT=$(echo "$CACHE_BEHAVIORS" | jq '.Quantity // 0')
  
  # Create new behavior
  NEW_BEHAVIOR=$(cat <<EOF
{
  "PathPattern": "/api/*",
  "TargetOriginId": "$BACKEND_ORIGIN_ID",
  "ViewerProtocolPolicy": "redirect-to-https",
  "AllowedMethods": {
    "Quantity": 7,
    "Items": ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"],
    "CachedMethods": {
      "Quantity": 2,
      "Items": ["GET", "HEAD"]
    }
  },
  "ForwardedValues": {
    "QueryString": true,
    "Cookies": {
      "Forward": "all"
    },
    "Headers": {
      "Quantity": 0,
      "Items": []
    }
  },
  "MinTTL": 0,
  "DefaultTTL": 0,
  "MaxTTL": 0,
  "Compress": true,
  "TrustedSigners": {
    "Enabled": false,
    "Quantity": 0
  }
}
EOF
)
  
  # Merge new behavior with existing behaviors
  UPDATED_BEHAVIORS=$(echo "$CACHE_BEHAVIORS" | jq --argjson new_behavior "$NEW_BEHAVIOR" \
    '.Items = [$new_behavior] + .Items | .Quantity = (.Items | length)')
  
  # Update config with new behaviors
  CURRENT_CONFIG=$(echo "$CURRENT_CONFIG" | jq --argjson behaviors "$UPDATED_BEHAVIORS" '.CacheBehaviors = $behaviors')
  
  echo -e "${GREEN}✓ Cache behavior '/api/*' added${NC}"
fi

# Step 3: Update distribution
echo -e "${YELLOW}📤 Updating CloudFront distribution...${NC}"

# Save config to temp file
TEMP_CONFIG=$(mktemp)
echo "$CURRENT_CONFIG" > "$TEMP_CONFIG"

# Update distribution
UPDATE_RESULT=$(aws cloudfront update-distribution \
  --id "$DISTRIBUTION_ID" \
  --distribution-config "file://$TEMP_CONFIG" \
  --if-match "$ETAG" \
  --region "$REGION" 2>&1)

# Clean up temp file
rm "$TEMP_CONFIG"

if [ $? -ne 0 ]; then
  echo -e "${RED}❌ Error updating distribution:${NC}"
  echo "$UPDATE_RESULT"
  exit 1
fi

echo -e "${GREEN}✓ Distribution update initiated${NC}"
echo ""
echo -e "${BLUE}📊 Update Status:${NC}"
echo "$UPDATE_RESULT" | jq -r '.Distribution.Status'
echo ""
echo -e "${YELLOW}⏳ CloudFront deployment in progress...${NC}"
echo -e "${YELLOW}   This typically takes 5-15 minutes${NC}"
echo ""
echo -e "${GREEN}✅ Configuration complete!${NC}"
echo ""
echo -e "${BLUE}🔍 To check status:${NC}"
echo "   aws cloudfront get-distribution --id $DISTRIBUTION_ID --region $REGION | jq -r '.Distribution.Status'"
echo ""
echo -e "${BLUE}🧪 To test after deployment:${NC}"
echo "   curl https://d2wvs4i87rs881.cloudfront.net/api/health"
