#!/bin/bash
# ============================================================================
# Backend ECS Deployment Script for Bitbucket Pipelines
# ============================================================================
# Builds Docker image, pushes to ECR, and updates ECS service
#
# Authentication: Uses AWS OIDC (credentials set up by pipeline before this script)
#
# Required Environment Variables (set in Bitbucket Deployment Variables):
#   - AWS_ROLE_ARN             - IAM role ARN for OIDC (repository variable)
#   - AWS_REGION               - AWS region (repository variable, e.g., us-east-2)
#   - ECR_REPOSITORY_URI       - Full ECR repository URI (e.g., 123456789.dkr.ecr.us-east-2.amazonaws.com/repo)
#   - ECS_CLUSTER              - ECS cluster name
#   - ECS_SERVICE              - ECS service name
#
# OIDC Environment (set by pipeline setup-oidc script):
#   - AWS_WEB_IDENTITY_TOKEN_FILE - Path to OIDC token
#   - AWS_ROLE_SESSION_NAME    - Session name for assume role
# ============================================================================

set -euo pipefail

echo "========================================="
echo "Backend ECS Deployment Script"
echo "========================================="
echo ""

# Generate unique image tag based on commit and timestamp
IMAGE_TAG="${BITBUCKET_COMMIT:-latest}-$(date +%Y%m%d%H%M%S)"

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
    
    # Use AWS_REGION or AWS_DEFAULT_REGION
    export AWS_DEFAULT_REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-2}}"
    
    if [ -z "${ECR_REPOSITORY_URI:-}" ]; then
        missing_vars+=("ECR_REPOSITORY_URI")
    fi
    
    if [ -z "${ECS_CLUSTER:-}" ]; then
        missing_vars+=("ECS_CLUSTER")
    fi
    
    if [ -z "${ECS_SERVICE:-}" ]; then
        missing_vars+=("ECS_SERVICE")
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
# Extract ECR Registry from Repository URI
# ============================================================================
get_ecr_registry() {
    # ECR_REPOSITORY_URI format: 123456789.dkr.ecr.us-east-2.amazonaws.com/repo-name
    ECR_REGISTRY=$(echo "$ECR_REPOSITORY_URI" | cut -d'/' -f1)
    echo "ECR Registry: $ECR_REGISTRY"
}

# ============================================================================
# Login to ECR
# ============================================================================
login_to_ecr() {
    echo ""
    echo "========================================="
    echo "Logging into Amazon ECR..."
    echo "========================================="
    
    get_ecr_registry
    
    # Get ECR login password and login to Docker
    aws ecr get-login-password --region "$AWS_DEFAULT_REGION" | \
        docker login --username AWS --password-stdin "$ECR_REGISTRY"
    
    if [ $? -eq 0 ]; then
        echo "Successfully logged into ECR."
    else
        echo "ERROR: Failed to login to ECR."
        exit 1
    fi
}

# ============================================================================
# Build Docker Image
# ============================================================================
build_docker_image() {
    echo ""
    echo "========================================="
    echo "Building Docker image..."
    echo "========================================="
    echo "Dockerfile: Dockerfile.backend.prod"
    echo "Image tag: $IMAGE_TAG"
    echo ""
    
    # Verify Dockerfile exists
    if [ ! -f "Dockerfile.backend.prod" ]; then
        echo "ERROR: Dockerfile.backend.prod not found."
        exit 1
    fi
    
    # Get git info for version stamping
    GIT_COMMIT="${BITBUCKET_COMMIT:-$(git rev-parse HEAD 2>/dev/null || echo 'unknown')}"
    GIT_BRANCH="${BITBUCKET_BRANCH:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'unknown')}"
    BUILD_ENV="${BITBUCKET_DEPLOYMENT_ENVIRONMENT:-production}"
    
    echo "Git Commit: $GIT_COMMIT"
    echo "Git Branch: $GIT_BRANCH"
    echo "Build Env: $BUILD_ENV"
    echo ""
    
    # Build the image with git info as build args
    docker build \
        --build-arg GIT_COMMIT="$GIT_COMMIT" \
        --build-arg GIT_BRANCH="$GIT_BRANCH" \
        --build-arg BUILD_ENV="$BUILD_ENV" \
        -t "$ECR_REPOSITORY_URI:$IMAGE_TAG" \
        -t "$ECR_REPOSITORY_URI:latest" \
        -f Dockerfile.backend.prod \
        .
    
    if [ $? -eq 0 ]; then
        echo ""
        echo "Docker image built successfully."
        docker images "$ECR_REPOSITORY_URI" --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}"
    else
        echo "ERROR: Docker build failed."
        exit 1
    fi
}

# ============================================================================
# Push Docker Image to ECR
# ============================================================================
push_to_ecr() {
    echo ""
    echo "========================================="
    echo "Pushing Docker image to ECR..."
    echo "========================================="
    echo "Repository: $ECR_REPOSITORY_URI"
    echo ""
    
    # Push the specific tag
    echo "Pushing tag: $IMAGE_TAG"
    docker push "$ECR_REPOSITORY_URI:$IMAGE_TAG"
    
    # Push the latest tag
    echo "Pushing tag: latest"
    docker push "$ECR_REPOSITORY_URI:latest"
    
    if [ $? -eq 0 ]; then
        echo ""
        echo "Docker image pushed successfully."
    else
        echo "ERROR: Failed to push Docker image to ECR."
        exit 1
    fi
}

# ============================================================================
# Verify ECS Resources Exist
# ============================================================================
verify_ecs_resources() {
    echo ""
    echo "Verifying ECS resources..."
    
    # Check if cluster exists
    CLUSTER_STATUS=$(aws ecs describe-clusters \
        --clusters "$ECS_CLUSTER" \
        --region "$AWS_DEFAULT_REGION" \
        --query 'clusters[0].status' \
        --output text 2>/dev/null || echo "NOT_FOUND")
    
    if [ "$CLUSTER_STATUS" == "NOT_FOUND" ] || [ "$CLUSTER_STATUS" == "None" ]; then
        echo "ERROR: ECS cluster '$ECS_CLUSTER' not found."
        exit 1
    fi
    echo "ECS cluster '$ECS_CLUSTER' found (status: $CLUSTER_STATUS)"
    
    # Check if service exists
    SERVICE_STATUS=$(aws ecs describe-services \
        --cluster "$ECS_CLUSTER" \
        --services "$ECS_SERVICE" \
        --region "$AWS_DEFAULT_REGION" \
        --query 'services[0].status' \
        --output text 2>/dev/null || echo "NOT_FOUND")
    
    if [ "$SERVICE_STATUS" == "NOT_FOUND" ] || [ "$SERVICE_STATUS" == "None" ]; then
        echo "ERROR: ECS service '$ECS_SERVICE' not found in cluster '$ECS_CLUSTER'."
        exit 1
    fi
    echo "ECS service '$ECS_SERVICE' found (status: $SERVICE_STATUS)"
}

# ============================================================================
# Update ECS Service
# ============================================================================
update_ecs_service() {
    echo ""
    echo "========================================="
    echo "Updating ECS service..."
    echo "========================================="
    echo "Cluster: $ECS_CLUSTER"
    echo "Service: $ECS_SERVICE"
    echo ""
    
    # Force new deployment
    aws ecs update-service \
        --cluster "$ECS_CLUSTER" \
        --service "$ECS_SERVICE" \
        --force-new-deployment \
        --region "$AWS_DEFAULT_REGION" \
        --output json > /dev/null
    
    if [ $? -eq 0 ]; then
        echo "ECS service update initiated."
    else
        echo "ERROR: Failed to update ECS service."
        exit 1
    fi
}

# ============================================================================
# Wait for ECS Service Stability (optional)
# ============================================================================
wait_for_service_stability() {
    echo ""
    echo "========================================="
    echo "Waiting for ECS service to stabilize..."
    echo "========================================="
    echo "This may take a few minutes..."
    echo ""
    
    # Wait for service to become stable (max 10 minutes)
    if aws ecs wait services-stable \
        --cluster "$ECS_CLUSTER" \
        --services "$ECS_SERVICE" \
        --region "$AWS_DEFAULT_REGION" 2>/dev/null; then
        echo "ECS service is now stable."
    else
        echo "WARNING: Timed out waiting for service stability."
        echo "The deployment is still in progress. Check AWS Console for status."
        
        # Get current service status
        echo ""
        echo "Current service status:"
        aws ecs describe-services \
            --cluster "$ECS_CLUSTER" \
            --services "$ECS_SERVICE" \
            --region "$AWS_DEFAULT_REGION" \
            --query 'services[0].{Status:status,DesiredCount:desiredCount,RunningCount:runningCount,PendingCount:pendingCount}' \
            --output table
    fi
}

# ============================================================================
# Display Deployment Summary
# ============================================================================
display_summary() {
    echo ""
    echo "========================================="
    echo "Backend Deployment Complete!"
    echo "========================================="
    echo ""
    echo "Image: $ECR_REPOSITORY_URI:$IMAGE_TAG"
    echo "Cluster: $ECS_CLUSTER"
    echo "Service: $ECS_SERVICE"
    echo "Region: $AWS_DEFAULT_REGION"
    echo ""
    echo "Deployment Environment: ${BITBUCKET_DEPLOYMENT_ENVIRONMENT:-unknown}"
    echo "Commit: ${BITBUCKET_COMMIT:-unknown}"
    echo "Branch: ${BITBUCKET_BRANCH:-unknown}"
    echo ""
    
    # Get final service status
    echo "Current Service Status:"
    aws ecs describe-services \
        --cluster "$ECS_CLUSTER" \
        --services "$ECS_SERVICE" \
        --region "$AWS_DEFAULT_REGION" \
        --query 'services[0].{Status:status,DesiredCount:desiredCount,RunningCount:runningCount,PendingCount:pendingCount,Deployments:length(deployments)}' \
        --output table
    echo ""
}

# ============================================================================
# Main Execution
# ============================================================================
main() {
    echo "Deployment Environment: ${BITBUCKET_DEPLOYMENT_ENVIRONMENT:-unknown}"
    echo "Commit: ${BITBUCKET_COMMIT:-unknown}"
    echo "Branch: ${BITBUCKET_BRANCH:-unknown}"
    echo "Image Tag: $IMAGE_TAG"
    echo ""
    
    validate_env_vars
    install_aws_cli
    verify_aws_credentials
    verify_ecs_resources
    login_to_ecr
    build_docker_image
    push_to_ecr
    update_ecs_service
    wait_for_service_stability
    display_summary
}

main "$@"
