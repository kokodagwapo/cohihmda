#!/bin/bash
# ============================================================================
# Backend Deployment Script for Bitbucket Pipelines
# ============================================================================
# Builds Docker image, pushes to ECR, and updates backend CloudFormation stack
# with an immutable image tag (ContainerImageTag), so task definitions are
# always managed by IaC and environment drift is avoided.
#
# Authentication: Uses AWS OIDC (credentials set up by pipeline before this script)
#
# Required Environment Variables (set in Bitbucket Deployment Variables):
#   - AWS_ROLE_ARN             - IAM role ARN for OIDC (repository variable)
#   - AWS_REGION               - AWS region (repository variable, e.g., us-east-2)
#   - ECR_REPOSITORY_URI       - Full ECR repository URI (e.g., 123456789.dkr.ecr.us-east-2.amazonaws.com/repo)
#   - CF_STACK_BACKEND         - CloudFormation stack name (e.g., coheus-dev-backend)
#   - COGNITO_PASSWORD_AUTH    - Must be "true" (enforces Cognito-only password auth)
#
# OIDC Environment (set by pipeline setup-oidc script):
#   - AWS_WEB_IDENTITY_TOKEN_FILE - Path to OIDC token
#   - AWS_ROLE_SESSION_NAME    - Session name for assume role
# ============================================================================

set -euo pipefail

echo "========================================="
echo "Backend Deployment Script (CloudFormation-managed ECS)"
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
    
    if [ -z "${CF_STACK_BACKEND:-}" ]; then
        missing_vars+=("CF_STACK_BACKEND")
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
# Enforce Cognito-only Password Auth Policy
# ============================================================================
validate_auth_configuration() {
    local auth_mode="${COGNITO_PASSWORD_AUTH:-}"
    if [ -z "$auth_mode" ]; then
        echo "ERROR: COGNITO_PASSWORD_AUTH deployment variable is not set."
        echo "Set it to 'true' for all deployed environments."
        exit 1
    fi
    if [ "$auth_mode" != "true" ]; then
        echo "ERROR: COGNITO_PASSWORD_AUTH must be 'true'. Current value: '$auth_mode'"
        echo "Refusing deploy because local DB password fallback is disallowed."
        exit 1
    fi
    echo "Auth policy validated: COGNITO_PASSWORD_AUTH=true"
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

    # Build a CI commit payload for release-note draft generation in deployed environments.
    # Format per line: <commit_iso_date>|<sha>|<subject>
    # This avoids requiring .git history at runtime in ECS containers.
    RELEASE_NOTES_COMMITS_B64=""
    if command -v git >/dev/null 2>&1; then
        RELEASE_NOTES_COMMITS_B64="$(git log --no-merges -n 400 --pretty=format:'%cI|%h|%s' 2>/dev/null | base64 | tr -d '\n' || true)"
    fi
    if [ -n "$RELEASE_NOTES_COMMITS_B64" ]; then
        echo "Release-notes commit payload generated from CI history."
    else
        echo "Release-notes commit payload unavailable; runtime fallback will apply."
    fi
    echo ""
    
    # Build the image with git info as build args
    docker build \
        --build-arg GIT_COMMIT="$GIT_COMMIT" \
        --build-arg GIT_BRANCH="$GIT_BRANCH" \
        --build-arg BUILD_ENV="$BUILD_ENV" \
        --build-arg RELEASE_NOTES_COMMITS_B64="$RELEASE_NOTES_COMMITS_B64" \
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
# Verify Backend Stack Exists
# ============================================================================
verify_backend_stack() {
    echo ""
    echo "Verifying backend CloudFormation stack..."

    if ! aws cloudformation describe-stacks \
        --stack-name "$CF_STACK_BACKEND" \
        --region "$AWS_DEFAULT_REGION" > /dev/null 2>&1; then
        echo "ERROR: Backend stack '$CF_STACK_BACKEND' not found."
        exit 1
    fi

    STACK_STATUS=$(aws cloudformation describe-stacks \
        --stack-name "$CF_STACK_BACKEND" \
        --region "$AWS_DEFAULT_REGION" \
        --query 'Stacks[0].StackStatus' \
        --output text)

    if [[ ! "$STACK_STATUS" =~ ^(CREATE_COMPLETE|UPDATE_COMPLETE|UPDATE_ROLLBACK_COMPLETE)$ ]]; then
        echo "ERROR: Backend stack '$CF_STACK_BACKEND' is not in a stable state: $STACK_STATUS"
        exit 1
    fi
    echo "Backend stack '$CF_STACK_BACKEND' found (status: $STACK_STATUS)"
}

# ============================================================================
# Build parameter list from existing stack values
# ============================================================================
get_stack_parameters() {
    local stack_name=$1

    local param_keys
    param_keys=$(aws cloudformation describe-stacks \
        --stack-name "$stack_name" \
        --region "$AWS_DEFAULT_REGION" \
        --query 'Stacks[0].Parameters[*].ParameterKey' \
        --output text 2>/dev/null) || { echo "[]"; return; }

    local result="["
    local first=true
    for key in $param_keys; do
        if [ "$first" = true ]; then
            first=false
        else
            result+=","
        fi
        result+="{\"ParameterKey\":\"$key\",\"UsePreviousValue\":true}"
    done

    # Immutable image tag override - this is the key deploy input.
    if [ "$first" = true ]; then
        first=false
    else
        result+=","
    fi
    result+="{\"ParameterKey\":\"ContainerImageTag\",\"ParameterValue\":\"${IMAGE_TAG}\"}"

    # Auth policy override (defense in depth)
    result+=",{\"ParameterKey\":\"CognitoPasswordAuth\",\"ParameterValue\":\"${COGNITO_PASSWORD_AUTH}\"}"

    # Optional explicit parameter override
    if [ -n "${OPENAI_API_KEY_SECRET_ARN:-}" ]; then
        result+=",{\"ParameterKey\":\"OpenAIApiKeySecretArn\",\"ParameterValue\":\"${OPENAI_API_KEY_SECRET_ARN}\"}"
    fi

    result+="]"
    echo "$result"
}

# ============================================================================
# Deploy backend stack with immutable image tag
# ============================================================================
deploy_backend_stack() {
    echo ""
    echo "========================================="
    echo "Deploying backend stack with image tag"
    echo "========================================="
    echo "Stack: $CF_STACK_BACKEND"
    echo "ContainerImageTag: $IMAGE_TAG"
    echo ""

    local change_set_name="backend-image-${BITBUCKET_BUILD_NUMBER:-manual}-$(date +%Y%m%d%H%M%S)"

    aws cloudformation create-change-set \
        --stack-name "$CF_STACK_BACKEND" \
        --change-set-name "$change_set_name" \
        --template-body file://infrastructure/cloudformation/coheus_ecs_fargate_stack.yaml \
        --no-use-previous-template \
        --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
        --parameters "$(get_stack_parameters "$CF_STACK_BACKEND")" \
        --region "$AWS_DEFAULT_REGION" \
        --output json > /dev/null

    aws cloudformation wait change-set-create-complete \
        --stack-name "$CF_STACK_BACKEND" \
        --change-set-name "$change_set_name" \
        --region "$AWS_DEFAULT_REGION" 2>/dev/null || true

    CHANGE_SET_STATUS=$(aws cloudformation describe-change-set \
        --stack-name "$CF_STACK_BACKEND" \
        --change-set-name "$change_set_name" \
        --region "$AWS_DEFAULT_REGION" \
        --query 'Status' \
        --output text)

    if [ "$CHANGE_SET_STATUS" == "FAILED" ]; then
        CHANGE_SET_REASON=$(aws cloudformation describe-change-set \
            --stack-name "$CF_STACK_BACKEND" \
            --change-set-name "$change_set_name" \
            --region "$AWS_DEFAULT_REGION" \
            --query 'StatusReason' \
            --output text)
        if [[ "$CHANGE_SET_REASON" == *"didn't contain changes"* ]] || [[ "$CHANGE_SET_REASON" == *"No updates"* ]]; then
            echo "No backend stack changes detected."
            aws cloudformation delete-change-set \
                --stack-name "$CF_STACK_BACKEND" \
                --change-set-name "$change_set_name" \
                --region "$AWS_DEFAULT_REGION" || true
            return 0
        fi
        echo "ERROR: Failed to create change set: $CHANGE_SET_REASON"
        exit 1
    fi

    aws cloudformation execute-change-set \
        --stack-name "$CF_STACK_BACKEND" \
        --change-set-name "$change_set_name" \
        --region "$AWS_DEFAULT_REGION"

    if aws cloudformation wait stack-update-complete \
        --stack-name "$CF_STACK_BACKEND" \
        --region "$AWS_DEFAULT_REGION"; then
        echo "Backend stack update completed."
    else
        echo "ERROR: Backend stack update failed."
        aws cloudformation describe-stack-events \
            --stack-name "$CF_STACK_BACKEND" \
            --region "$AWS_DEFAULT_REGION" \
            --query 'StackEvents[0:12].{Time:Timestamp,Status:ResourceStatus,Resource:LogicalResourceId,Reason:ResourceStatusReason}' \
            --output table
        exit 1
    fi
}

# ============================================================================
# Post-deploy runtime verification (fail closed)
# ============================================================================
verify_runtime_configuration() {
    echo ""
    echo "========================================="
    echo "Post-deploy Runtime Verification"
    echo "========================================="

    local cluster_name
    local service_name
    cluster_name=$(aws cloudformation describe-stacks \
        --stack-name "$CF_STACK_BACKEND" \
        --region "$AWS_DEFAULT_REGION" \
        --query "Stacks[0].Outputs[?OutputKey=='ECSClusterName'].OutputValue | [0]" \
        --output text)
    service_name=$(aws cloudformation describe-stacks \
        --stack-name "$CF_STACK_BACKEND" \
        --region "$AWS_DEFAULT_REGION" \
        --query "Stacks[0].Outputs[?OutputKey=='ECSServiceName'].OutputValue | [0]" \
        --output text)

    if [ -z "$cluster_name" ] || [ "$cluster_name" = "None" ] || [ -z "$service_name" ] || [ "$service_name" = "None" ]; then
        echo "ERROR: Unable to resolve ECS cluster/service outputs from stack."
        exit 1
    fi

    local service_task_def desired_count running_count primary_rollout
    service_task_def=$(aws ecs describe-services \
        --cluster "$cluster_name" \
        --services "$service_name" \
        --region "$AWS_DEFAULT_REGION" \
        --query "services[0].taskDefinition" \
        --output text)
    desired_count=$(aws ecs describe-services \
        --cluster "$cluster_name" \
        --services "$service_name" \
        --region "$AWS_DEFAULT_REGION" \
        --query "services[0].desiredCount" \
        --output text)
    running_count=$(aws ecs describe-services \
        --cluster "$cluster_name" \
        --services "$service_name" \
        --region "$AWS_DEFAULT_REGION" \
        --query "services[0].runningCount" \
        --output text)
    primary_rollout=$(aws ecs describe-services \
        --cluster "$cluster_name" \
        --services "$service_name" \
        --region "$AWS_DEFAULT_REGION" \
        --query "services[0].deployments[?status=='PRIMARY'].rolloutState | [0]" \
        --output text)

    if [ "$primary_rollout" != "COMPLETED" ]; then
        echo "ERROR: ECS primary deployment rollout state is '$primary_rollout' (expected COMPLETED)."
        exit 1
    fi
    if [ "$desired_count" != "$running_count" ]; then
        echo "ERROR: ECS running count ($running_count) does not match desired count ($desired_count)."
        exit 1
    fi

    local expected_task_def
    expected_task_def=$(aws cloudformation describe-stack-resource \
        --stack-name "$CF_STACK_BACKEND" \
        --logical-resource-id ECSTaskDefinition \
        --region "$AWS_DEFAULT_REGION" \
        --query "StackResourceDetail.PhysicalResourceId" \
        --output text)

    if [ -n "$expected_task_def" ] && [ "$expected_task_def" != "None" ] && [ "$service_task_def" != "$expected_task_def" ]; then
        echo "ERROR: Service task definition does not match stack task definition."
        echo "Expected: $expected_task_def"
        echo "Actual:   $service_task_def"
        exit 1
    fi

    local deployed_image auth_mode
    deployed_image=$(aws ecs describe-task-definition \
        --task-definition "$service_task_def" \
        --region "$AWS_DEFAULT_REGION" \
        --query "taskDefinition.containerDefinitions[0].image" \
        --output text)
    auth_mode=$(aws ecs describe-task-definition \
        --task-definition "$service_task_def" \
        --region "$AWS_DEFAULT_REGION" \
        --query "taskDefinition.containerDefinitions[0].environment[?name=='COGNITO_PASSWORD_AUTH'].value | [0]" \
        --output text)

    if [[ "$deployed_image" != *":$IMAGE_TAG" ]]; then
        echo "ERROR: Deployed task definition image tag does not match expected IMAGE_TAG."
        echo "Expected suffix: :$IMAGE_TAG"
        echo "Actual image:    $deployed_image"
        exit 1
    fi

    if [ "$auth_mode" != "true" ]; then
        echo "ERROR: COGNITO_PASSWORD_AUTH in deployed task definition is '$auth_mode' (expected true)."
        exit 1
    fi

    echo "Runtime verification passed:"
    echo "  - Service: $cluster_name / $service_name"
    echo "  - Task definition: $service_task_def"
    echo "  - Image tag: $IMAGE_TAG"
    echo "  - COGNITO_PASSWORD_AUTH=true"
}

# ============================================================================
# Display Deployment Summary
# ============================================================================
display_summary() {
    echo ""
    echo "========================================="
echo "Backend Deployment Complete (CloudFormation-managed)"
    echo "========================================="
    echo ""
    echo "Image: $ECR_REPOSITORY_URI:$IMAGE_TAG"
echo "Backend stack: $CF_STACK_BACKEND"
    echo "Region: $AWS_DEFAULT_REGION"
    echo ""
    echo "Deployment Environment: ${BITBUCKET_DEPLOYMENT_ENVIRONMENT:-unknown}"
    echo "Commit: ${BITBUCKET_COMMIT:-unknown}"
    echo "Branch: ${BITBUCKET_BRANCH:-unknown}"
    echo ""
    
    echo "Current backend stack status:"
    aws cloudformation describe-stacks \
        --stack-name "$CF_STACK_BACKEND" \
        --region "$AWS_DEFAULT_REGION" \
        --query 'Stacks[0].{Status:StackStatus,LastUpdated:LastUpdatedTime}' \
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
    validate_auth_configuration
    install_aws_cli
    verify_aws_credentials
    verify_backend_stack
    login_to_ecr
    build_docker_image
    push_to_ecr
    deploy_backend_stack
    verify_runtime_configuration
    display_summary
}

main "$@"
