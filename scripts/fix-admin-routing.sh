#!/bin/bash
# ============================================================================
# Quick Fix for Admin Page Routing on S3/CloudFront
# ============================================================================
# This script ensures proper routing configuration for React Router

set -e

S3_BUCKET="Cohi-frontend-1767135651"
REGION="us-east-1"

echo "🔧 Fixing admin page routing..."

# Ensure 404.html exists and is properly configured
if [ ! -f "docs/404.html" ]; then
    echo "❌ Error: docs/404.html not found"
    exit 1
fi

# Upload 404.html with proper headers
aws s3 cp docs/404.html "s3://${S3_BUCKET}/404.html" \
    --region ${REGION} \
    --content-type "text/html; charset=utf-8" \
    --cache-control "no-cache, no-store, must-revalidate" \
    --metadata-directive REPLACE

# Reconfigure S3 website
aws s3 website "s3://${S3_BUCKET}" \
    --index-document index.html \
    --error-document 404.html \
    --region ${REGION}

echo "✅ 404.html updated and S3 website reconfigured"

# If CloudFront is configured, update error responses
if [ -n "$CLOUDFRONT_DISTRIBUTION_ID" ]; then
    echo "☁️  Updating CloudFront error responses..."
    
    # Get current distribution config
    DIST_CONFIG=$(aws cloudfront get-distribution-config \
        --id "$CLOUDFRONT_DISTRIBUTION_ID" \
        --region ${REGION})
    
    ETAG=$(echo "$DIST_CONFIG" | jq -r '.ETag')
    CONFIG=$(echo "$DIST_CONFIG" | jq '.DistributionConfig')
    
    # Update custom error responses
    UPDATED_CONFIG=$(echo "$CONFIG" | jq '
        .CustomErrorResponses = {
            "Quantity": 2,
            "Items": [
                {
                    "ErrorCode": 404,
                    "ResponsePagePath": "/404.html",
                    "ResponseCode": "200",
                    "ErrorCachingMinTTL": 0
                },
                {
                    "ErrorCode": 403,
                    "ResponsePagePath": "/404.html",
                    "ResponseCode": "200",
                    "ErrorCachingMinTTL": 0
                }
            ]
        }
    ')
    
    # Update distribution
    aws cloudfront update-distribution \
        --id "$CLOUDFRONT_DISTRIBUTION_ID" \
        --distribution-config "$UPDATED_CONFIG" \
        --if-match "$ETAG" \
        --region ${REGION} > /dev/null
    
    echo "✅ CloudFront error responses updated"
    echo "⏳ Changes will take 15-20 minutes to deploy"
    
    # Invalidate cache
    aws cloudfront create-invalidation \
        --distribution-id "$CLOUDFRONT_DISTRIBUTION_ID" \
        --paths "/404.html" "/admin" "/admin/*" \
        --region ${REGION} > /dev/null
    
    echo "✅ Cache invalidated for admin routes"
else
    echo "ℹ️  Set CLOUDFRONT_DISTRIBUTION_ID environment variable to update CloudFront"
fi

echo ""
echo "✅ Admin routing fix complete!"
echo ""
echo "Test the admin page:"
if [ -n "$CLOUDFRONT_DISTRIBUTION_ID" ]; then
    DIST_DOMAIN=$(aws cloudfront get-distribution \
        --id "$CLOUDFRONT_DISTRIBUTION_ID" \
        --query 'Distribution.DomainName' \
        --output text \
        --region ${REGION})
    echo "   https://${DIST_DOMAIN}/admin"
else
    echo "   http://${S3_BUCKET}.s3-website-${REGION}.amazonaws.com/admin"
    echo ""
    echo "⚠️  For HTTPS, set up CloudFront:"
    echo "   ./scripts/setup-cloudfront-ssl.sh"
fi
