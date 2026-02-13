#!/bin/bash
# ============================================================================
# Frontend Deployment Script for Bitbucket Pipelines
# ============================================================================
# Deploys frontend build artifacts to S3 and invalidates CloudFront cache
#
# Authentication: Uses AWS OIDC (credentials set up by pipeline before this script)
#
# Required Environment Variables (set in Bitbucket Deployment Variables):
#   - AWS_ROLE_ARN             - IAM role ARN for OIDC (repository variable)
#   - AWS_REGION               - AWS region (repository variable, e.g., us-east-2)
#   - S3_BUCKET                - S3 bucket name for frontend assets
#   - CLOUDFRONT_DISTRIBUTION_ID - CloudFront distribution ID for cache invalidation
#   - VITE_API_URL             - (optional) Backend API URL, used during build
#
# OIDC Environment (set by pipeline setup-oidc script):
#   - AWS_WEB_IDENTITY_TOKEN_FILE - Path to OIDC token
#   - AWS_ROLE_SESSION_NAME    - Session name for assume role
# ============================================================================

set -euo pipefail

echo "========================================="
echo "Frontend Deployment Script"
echo "========================================="
echo ""

# ============================================================================
# Validate Required Environment Variables
# ============================================================================
validate_env_vars() {
    local missing_vars=()
    
    # Check for OIDC authentication
    if [ -z "${AWS_WEB_IDENTITY_TOKEN_FILE:-}" ] && [ -z "${AWS_ACCESS_KEY_ID:-}" ]; then
        echo "ERROR: No AWS credentials found."
        echo "Ensure OIDC is configured (AWS_WEB_IDENTITY_TOKEN_FILE) or static credentials (AWS_ACCESS_KEY_ID)."
        exit 1
    fi
    
    if [ -z "${AWS_ROLE_ARN:-}" ] && [ -z "${AWS_ACCESS_KEY_ID:-}" ]; then
        missing_vars+=("AWS_ROLE_ARN")
    fi
    
    if [ -z "${S3_BUCKET:-}" ]; then
        missing_vars+=("S3_BUCKET")
    fi
    
    if [ ${#missing_vars[@]} -gt 0 ]; then
        echo "ERROR: Missing required environment variables:"
        for var in "${missing_vars[@]}"; do
            echo "  - $var"
        done
        echo ""
        echo "Please configure these in Bitbucket Repository/Deployment Variables."
        exit 1
    fi
    
    echo "Environment variables validated."
    if [ -n "${AWS_WEB_IDENTITY_TOKEN_FILE:-}" ]; then
        echo "Authentication: OIDC"
    else
        echo "Authentication: Static credentials"
    fi
}

# ============================================================================
# Install AWS CLI
# ============================================================================
install_aws_cli() {
    if command -v aws &> /dev/null; then
        echo "AWS CLI already installed: $(aws --version)"
        return
    fi
    
    echo "Installing AWS CLI..."
    apt-get update -qq
    apt-get install -y -qq unzip curl > /dev/null
    
    curl -sS "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
    unzip -qq awscliv2.zip
    ./aws/install --update
    rm -rf awscliv2.zip aws/
    
    echo "AWS CLI installed: $(aws --version)"
}

# ============================================================================
# Verify AWS Credentials
# ============================================================================
verify_aws_credentials() {
    echo ""
    echo "Verifying AWS credentials..."
    
    if ! AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text 2>&1); then
        echo "ERROR: Failed to authenticate with AWS."
        echo "Please check your AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY."
        echo "Error: $AWS_ACCOUNT"
        exit 1
    fi
    
    echo "Authenticated to AWS Account: $AWS_ACCOUNT"
}

# ============================================================================
# Verify S3 Bucket Exists
# ============================================================================
verify_s3_bucket() {
    echo ""
    echo "Verifying S3 bucket: $S3_BUCKET"
    
    if ! aws s3api head-bucket --bucket "$S3_BUCKET" 2>/dev/null; then
        echo "ERROR: S3 bucket '$S3_BUCKET' does not exist or is not accessible."
        echo "Please create the bucket or check permissions."
        exit 1
    fi
    
    echo "S3 bucket verified."
}

# ============================================================================
# Deploy to S3
# ============================================================================
deploy_to_s3() {
    echo ""
    echo "========================================="
    echo "Deploying frontend to S3..."
    echo "========================================="
    echo "Bucket: $S3_BUCKET"
    echo "Source: dist/"
    echo ""
    
    # Verify dist directory exists
    if [ ! -d "dist" ]; then
        echo "ERROR: dist/ directory not found."
        echo "Frontend build may have failed."
        exit 1
    fi
    
    # Verify index.html exists
    if [ ! -f "dist/index.html" ]; then
        echo "ERROR: dist/index.html not found."
        echo "Frontend build may have failed."
        exit 1
    fi
    
    echo "Syncing static assets (with long cache)..."
    # Sync static assets with long cache headers (1 year)
    aws s3 sync dist/ "s3://$S3_BUCKET" \
        --delete \
        --exclude ".DS_Store" \
        --exclude "*.map" \
        --exclude "index.html" \
        --exclude "404.html" \
        --cache-control "public, max-age=31536000, immutable"
    
    echo "Uploading index.html (no cache)..."
    # Upload index.html with no-cache headers
    aws s3 cp dist/index.html "s3://$S3_BUCKET/index.html" \
        --content-type "text/html" \
        --cache-control "no-cache, no-store, must-revalidate"
    
    # Upload 404.html if it exists
    if [ -f "dist/404.html" ]; then
        echo "Uploading 404.html (no cache)..."
        aws s3 cp dist/404.html "s3://$S3_BUCKET/404.html" \
            --content-type "text/html" \
            --cache-control "no-cache, no-store, must-revalidate"
    fi
    
    echo ""
    echo "S3 deployment completed."
}

# ============================================================================
# Invalidate CloudFront Cache
# ============================================================================
invalidate_cloudfront() {
    if [ -z "${CLOUDFRONT_DISTRIBUTION_ID:-}" ]; then
        echo ""
        echo "CLOUDFRONT_DISTRIBUTION_ID not set, skipping cache invalidation."
        return
    fi
    
    echo ""
    echo "========================================="
    echo "Invalidating CloudFront cache..."
    echo "========================================="
    echo "Distribution ID: $CLOUDFRONT_DISTRIBUTION_ID"
    
    # Validate distribution ID format (13 alphanumeric characters)
    if [[ ! "$CLOUDFRONT_DISTRIBUTION_ID" =~ ^[A-Z0-9]{13,14}$ ]]; then
        echo "WARNING: CloudFront distribution ID format looks unusual: $CLOUDFRONT_DISTRIBUTION_ID"
        echo "Expected format: 13-14 uppercase alphanumeric characters (e.g., E1234567890ABC)"
    fi
    
    # Create invalidation (using us-east-1 as CloudFront is global)
    INVALIDATION_OUTPUT=$(aws cloudfront create-invalidation \
        --distribution-id "$CLOUDFRONT_DISTRIBUTION_ID" \
        --paths "/*" \
        --region us-east-1 \
        2>&1)
    
    if [ $? -eq 0 ]; then
        INVALIDATION_ID=$(echo "$INVALIDATION_OUTPUT" | grep -o '"Id": "[^"]*"' | head -1 | cut -d'"' -f4)
        echo "CloudFront cache invalidation created: $INVALIDATION_ID"
        echo "Note: Invalidation may take a few minutes to propagate globally."
    else
        echo "WARNING: Failed to create CloudFront invalidation."
        echo "Error: $INVALIDATION_OUTPUT"
        echo "Deployment to S3 was successful, but cache may serve old content."
    fi
}

# ============================================================================
# Main Execution
# ============================================================================
main() {
    echo "Deployment Environment: ${BITBUCKET_DEPLOYMENT_ENVIRONMENT:-unknown}"
    echo "Commit: ${BITBUCKET_COMMIT:-unknown}"
    echo "Branch: ${BITBUCKET_BRANCH:-unknown}"
    echo ""
    
    validate_env_vars
    install_aws_cli
    verify_aws_credentials
    verify_s3_bucket
    deploy_to_s3
    invalidate_cloudfront
    
    echo ""
    echo "========================================="
    echo "Frontend Deployment Complete!"
    echo "========================================="
    echo "S3 Bucket: $S3_BUCKET"
    if [ -n "${CLOUDFRONT_DISTRIBUTION_ID:-}" ]; then
        echo "CloudFront: $CLOUDFRONT_DISTRIBUTION_ID"
    fi
    echo ""
}

main "$@"
