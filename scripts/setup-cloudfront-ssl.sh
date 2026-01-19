#!/bin/bash
# ============================================================================
# CloudFront SSL Setup Script for Ailethia
# ============================================================================
# This script sets up CloudFront distribution with SSL certificate for S3 bucket
# Prerequisites:
#   - AWS CLI configured with appropriate permissions
#   - Domain name (optional, can use CloudFront domain)
#   - SSL certificate in AWS Certificate Manager (ACM) in us-east-1

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
S3_BUCKET="ailethia-frontend-1767135651"
REGION="us-east-1"
DOMAIN_NAME="${1:-}"  # Optional: pass domain as first argument
CERTIFICATE_ARN="${2:-}"  # Optional: pass certificate ARN as second argument

echo -e "${GREEN}🌐 Setting up CloudFront with SSL for Ailethia${NC}"
echo -e "S3 Bucket: ${YELLOW}${S3_BUCKET}${NC}"
echo -e "Region: ${YELLOW}${REGION}${NC}"

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo -e "${RED}❌ Error: AWS CLI is not installed${NC}"
    echo -e "Install it from: https://aws.amazon.com/cli/"
    exit 1
fi

# Check if bucket exists
if ! aws s3 ls "s3://${S3_BUCKET}" &> /dev/null; then
    echo -e "${RED}❌ Error: S3 bucket ${S3_BUCKET} does not exist${NC}"
    exit 1
fi

# Get S3 website endpoint
S3_WEBSITE_ENDPOINT="${S3_BUCKET}.s3-website-${REGION}.amazonaws.com"
echo -e "${BLUE}📦 S3 Website Endpoint: ${S3_WEBSITE_ENDPOINT}${NC}"

# Create CloudFront Origin Access Control (OAC) - recommended over OAI
echo -e "${GREEN}🔐 Creating Origin Access Control...${NC}"
OAC_NAME="ailethia-s3-oac"
OAC_CONFIG=$(aws cloudfront create-origin-access-control \
    --origin-access-control-config Name="${OAC_NAME}",OriginAccessControlOriginType=s3,SigningBehavior=always,SigningProtocol=sigv4 \
    --region ${REGION} 2>/dev/null || echo "")

if [ -z "$OAC_CONFIG" ]; then
    # Try to get existing OAC
    OAC_ID=$(aws cloudfront list-origin-access-controls --query "OriginAccessControlList.Items[?Name=='${OAC_NAME}'].Id" --output text --region ${REGION} 2>/dev/null || echo "")
    if [ -z "$OAC_ID" ]; then
        echo -e "${RED}❌ Failed to create or find Origin Access Control${NC}"
        exit 1
    fi
    echo -e "${YELLOW}⚠️  Using existing OAC: ${OAC_ID}${NC}"
else
    OAC_ID=$(echo "$OAC_CONFIG" | jq -r '.OriginAccessControl.Id')
    echo -e "${GREEN}✅ Created OAC: ${OAC_ID}${NC}"
fi

# Update S3 bucket policy to allow CloudFront OAC access
echo -e "${GREEN}📝 Updating S3 bucket policy...${NC}"
BUCKET_POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCloudFrontServicePrincipal",
      "Effect": "Allow",
      "Principal": {
        "Service": "cloudfront.amazonaws.com"
      },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::${S3_BUCKET}/*",
      "Condition": {
        "StringEquals": {
          "AWS:SourceArn": "arn:aws:cloudfront::$(aws sts get-caller-identity --query Account --output text):distribution/*"
        }
      }
    }
  ]
}
EOF
)

# Note: This is a simplified policy. In production, you should restrict to specific distribution ARN
aws s3api put-bucket-policy --bucket "${S3_BUCKET}" --policy "${BUCKET_POLICY}" || echo -e "${YELLOW}⚠️  Could not update bucket policy (may need manual update)${NC}"

# Create CloudFront distribution configuration
echo -e "${GREEN}☁️  Creating CloudFront distribution...${NC}"

# Default aliases (empty if no domain provided)
ALIASES="[]"
if [ -n "$DOMAIN_NAME" ]; then
    ALIASES="[\"${DOMAIN_NAME}\"]"
    echo -e "${BLUE}🌍 Using domain: ${DOMAIN_NAME}${NC}"
fi

# Default viewer certificate (CloudFront default if no cert provided)
VIEWER_CERT=""
if [ -n "$CERTIFICATE_ARN" ]; then
    VIEWER_CERT=",\"AcmCertificateArn\":\"${CERTIFICATE_ARN}\",\"SslSupportMethod\":\"sni-only\",\"MinimumProtocolVersion\":\"TLSv1.2_2021\""
    echo -e "${BLUE}🔒 Using certificate: ${CERTIFICATE_ARN}${NC}"
fi

DISTRIBUTION_CONFIG=$(cat <<EOF
{
  "CallerReference": "ailethia-$(date +%s)",
  "Comment": "Ailethia Frontend Distribution",
  "DefaultRootObject": "index.html",
  "Origins": {
    "Quantity": 1,
    "Items": [
      {
        "Id": "S3-${S3_BUCKET}",
        "DomainName": "${S3_WEBSITE_ENDPOINT}",
        "CustomOriginConfig": {
          "HTTPPort": 80,
          "HTTPSPort": 443,
          "OriginProtocolPolicy": "http-only",
          "OriginSslProtocols": {
            "Quantity": 1,
            "Items": ["TLSv1.2"]
          }
        },
        "OriginAccessControlId": "${OAC_ID}"
      }
    ]
  },
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
      "QueryString": true,
      "Cookies": {
        "Forward": "none"
      },
      "Headers": {
        "Quantity": 0
      }
    },
    "MinTTL": 0,
    "DefaultTTL": 86400,
    "MaxTTL": 31536000,
    "Compress": true
  },
  "CustomErrorResponses": {
    "Quantity": 1,
    "Items": [
      {
        "ErrorCode": 404,
        "ResponsePagePath": "/404.html",
        "ResponseCode": "200",
        "ErrorCachingMinTTL": 300
      },
      {
        "ErrorCode": 403,
        "ResponsePagePath": "/404.html",
        "ResponseCode": "200",
        "ErrorCachingMinTTL": 300
      }
    ]
  },
  "Enabled": true,
  "Aliases": {
    "Quantity": $(echo "$ALIASES" | jq 'length'),
    "Items": $(echo "$ALIASES" | jq -c '.')
  },
  "ViewerCertificate": {
    "CloudFrontDefaultCertificate": $(if [ -z "$CERTIFICATE_ARN" ]; then echo "true"; else echo "false"; fi)${VIEWER_CERT}
  },
  "PriceClass": "PriceClass_100"
}
EOF
)

# Create distribution
DISTRIBUTION_OUTPUT=$(aws cloudfront create-distribution \
    --distribution-config "$DISTRIBUTION_CONFIG" \
    --region ${REGION} 2>&1)

if [ $? -eq 0 ]; then
    DISTRIBUTION_ID=$(echo "$DISTRIBUTION_OUTPUT" | jq -r '.Distribution.Id')
    DISTRIBUTION_DOMAIN=$(echo "$DISTRIBUTION_OUTPUT" | jq -r '.Distribution.DomainName')
    echo -e "${GREEN}✅ CloudFront distribution created!${NC}"
    echo -e "${BLUE}📋 Distribution ID: ${DISTRIBUTION_ID}${NC}"
    echo -e "${BLUE}🌐 Distribution Domain: ${DISTRIBUTION_DOMAIN}${NC}"
    echo ""
    echo -e "${YELLOW}⏳ Distribution is deploying (this takes 15-20 minutes)...${NC}"
    echo -e "${YELLOW}   You can check status with:${NC}"
    echo -e "   ${BLUE}aws cloudfront get-distribution --id ${DISTRIBUTION_ID}${NC}"
    echo ""
    echo -e "${GREEN}📝 Next Steps:${NC}"
    echo -e "1. Add this to GitHub Secrets:"
    echo -e "   ${BLUE}CLOUDFRONT_DISTRIBUTION_ID=${DISTRIBUTION_ID}${NC}"
    echo ""
    if [ -z "$DOMAIN_NAME" ]; then
        echo -e "2. Access your site at:"
        echo -e "   ${GREEN}https://${DISTRIBUTION_DOMAIN}${NC}"
        echo ""
        echo -e "3. (Optional) To use a custom domain:"
        echo -e "   - Request SSL certificate in ACM (us-east-1)"
        echo -e "   - Run this script again with domain and certificate ARN"
    else
        echo -e "2. Update DNS to point ${DOMAIN_NAME} to:"
        echo -e "   ${BLUE}${DISTRIBUTION_DOMAIN}${NC}"
        echo ""
        echo -e "3. Access your site at:"
        echo -e "   ${GREEN}https://${DOMAIN_NAME}${NC}"
    fi
else
    echo -e "${RED}❌ Failed to create CloudFront distribution${NC}"
    echo "$DISTRIBUTION_OUTPUT"
    exit 1
fi
