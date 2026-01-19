#!/bin/bash
# ============================================================================
# Create CloudFront Distribution with SSL
# ============================================================================
# This script creates a CloudFront distribution for the S3 frontend with SSL

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

S3_BUCKET="ailethia-frontend-1767135651"
REGION="us-east-1"

echo -e "${GREEN}☁️  Creating CloudFront Distribution${NC}"
echo ""

# Check AWS CLI
if ! command -v aws &> /dev/null; then
    echo -e "${RED}❌ AWS CLI not found${NC}"
    exit 1
fi

# Get inputs
read -p "Enter your domain (e.g., ailethia.com): " DOMAIN
read -p "Enter ACM Certificate ARN (us-east-1): " CERT_ARN

if [ -z "$DOMAIN" ] || [ -z "$CERT_ARN" ]; then
    echo -e "${RED}❌ Domain and Certificate ARN are required${NC}"
    exit 1
fi

# Generate unique caller reference
CALLER_REF="ailethia-$(date +%s)"

# Create CloudFront config
CONFIG_FILE="/tmp/cloudfront-${CALLER_REF}.json"

cat > "$CONFIG_FILE" <<EOF
{
  "CallerReference": "${CALLER_REF}",
  "Comment": "Ailethia Frontend Distribution",
  "DefaultCacheBehavior": {
    "TargetOriginId": "S3-${S3_BUCKET}",
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
      "QueryString": false,
      "Cookies": {
        "Forward": "none"
      },
      "Headers": {
        "Quantity": 1,
        "Items": ["CloudFront-Forwarded-Proto"]
      }
    },
    "TrustedSigners": {
      "Enabled": false,
      "Quantity": 0
    },
    "MinTTL": 0,
    "DefaultTTL": 86400,
    "MaxTTL": 31536000,
    "Compress": true
  },
  "Origins": {
    "Quantity": 1,
    "Items": [
      {
        "Id": "S3-${S3_BUCKET}",
        "DomainName": "${S3_BUCKET}.s3-website-us-east-1.amazonaws.com",
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
    ]
  },
  "Aliases": {
    "Quantity": 1,
    "Items": ["${DOMAIN}"]
  },
  "ViewerCertificate": {
    "ACMCertificateArn": "${CERT_ARN}",
    "SSLSupportMethod": "sni-only",
    "MinimumProtocolVersion": "TLSv1.2_2021"
  },
  "CustomErrorResponses": {
    "Quantity": 2,
    "Items": [
      {
        "ErrorCode": 404,
        "ResponsePagePath": "/index.html",
        "ResponseCode": "200",
        "ErrorCachingMinTTL": 300
      },
      {
        "ErrorCode": 403,
        "ResponsePagePath": "/index.html",
        "ResponseCode": "200",
        "ErrorCachingMinTTL": 300
      }
    ]
  },
  "DefaultRootObject": "index.html",
  "Enabled": true,
  "PriceClass": "PriceClass_100",
  "HttpVersion": "http2",
  "IsIPV6Enabled": true
}
EOF

echo -e "${GREEN}📝 Configuration file created: ${CONFIG_FILE}${NC}"
echo -e "${YELLOW}Review the configuration before proceeding...${NC}"
echo ""
read -p "Press Enter to create CloudFront distribution (Ctrl+C to cancel): "

# Create distribution
echo -e "${GREEN}🚀 Creating CloudFront distribution...${NC}"
OUTPUT=$(aws cloudfront create-distribution --distribution-config "file://${CONFIG_FILE}")

# Extract distribution details
DIST_ID=$(echo "$OUTPUT" | jq -r '.Distribution.Id // .Distribution.Id')
DIST_DOMAIN=$(echo "$OUTPUT" | jq -r '.Distribution.DomainName // .Distribution.DomainName')
DIST_STATUS=$(echo "$OUTPUT" | jq -r '.Distribution.Status // .Distribution.Status')

if [ "$DIST_ID" != "null" ] && [ -n "$DIST_ID" ]; then
    echo ""
    echo -e "${GREEN}✅ CloudFront distribution created!${NC}"
    echo ""
    echo -e "Distribution ID: ${GREEN}${DIST_ID}${NC}"
    echo -e "Distribution Domain: ${GREEN}${DIST_DOMAIN}${NC}"
    echo -e "Status: ${GREEN}${DIST_STATUS}${NC}"
    echo ""
    echo -e "${YELLOW}Next steps:${NC}"
    echo -e "1. Wait 15-20 minutes for deployment"
    echo -e "2. Add DNS CNAME record:"
    echo -e "   ${GREEN}${DOMAIN} → ${DIST_DOMAIN}${NC}"
    echo -e "3. Update S3 bucket policy (see AWS_SSL_SETUP.md)"
    echo ""
    echo -e "To check status:"
    echo -e "  ${YELLOW}aws cloudfront get-distribution --id ${DIST_ID}${NC}"
else
    echo -e "${RED}❌ Failed to create distribution${NC}"
    echo "$OUTPUT"
    exit 1
fi
