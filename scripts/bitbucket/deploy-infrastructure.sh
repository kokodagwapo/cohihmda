#!/bin/bash
# ============================================================================
# Infrastructure Deployment Script for Bitbucket Pipelines
# ============================================================================
# This script deploys CloudFormation stack updates when infrastructure files change.
#
# Required Environment Variables:
#   - AWS_ROLE_ARN             - IAM role ARN for OIDC (repository variable)
#   - AWS_REGION               - AWS region (repository variable, e.g., us-east-2)
#   - CF_STACK_BACKEND         - CloudFormation stack name for backend (e.g., coheus-dev-backend)
#
# Optional (defaults shown):
#   - CF_STACK_WAF_CLOUDFRONT  - WAF/CloudFront stack (e.g., coheus-dev-waf-cloudfront)
#   - CF_STACK_MONITORING      - Monitoring stack (e.g., coheus-dev-monitoring)
#
# OIDC Environment (set by pipeline setup-oidc script):
#   - AWS_WEB_IDENTITY_TOKEN_FILE - Path to OIDC token
#   - AWS_ROLE_SESSION_NAME    - Session name for assume role
# ============================================================================

set -euo pipefail

echo "========================================="
echo "Infrastructure Deployment Script"
echo "========================================="
echo ""
echo "Environment: ${BITBUCKET_DEPLOYMENT_ENVIRONMENT:-unknown}"
echo "Commit: ${BITBUCKET_COMMIT:-unknown}"
echo "Branch: ${BITBUCKET_BRANCH:-unknown}"
echo ""

# Use AWS_REGION or AWS_DEFAULT_REGION
export AWS_DEFAULT_REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-2}}"

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
        echo "Error: $AWS_ACCOUNT"
        exit 1
    fi
    
    echo "Authenticated to AWS Account: $AWS_ACCOUNT"
}

# ============================================================================
# Validate Templates
# ============================================================================
validate_templates() {
    echo ""
    echo "========================================="
    echo "Validating CloudFormation Templates"
    echo "========================================="
    echo ""
    
    # Templates to skip validation (legacy/unused templates with known issues)
    SKIP_TEMPLATES="lender-platform-stack.yaml"
    
    VALIDATION_ERRORS=0
    
    for template in infrastructure/cloudformation/*.yaml; do
        if [ -f "$template" ]; then
            TEMPLATE_NAME=$(basename "$template")
            
            # Skip known problematic legacy templates
            if echo "$SKIP_TEMPLATES" | grep -q "$TEMPLATE_NAME"; then
                echo "Skipping $(basename "$template")... (legacy/unused)"
                continue
            fi
            
            echo -n "Validating $(basename "$template")... "
            
            if aws cloudformation validate-template \
                --template-body "file://$template" \
                --region "$AWS_DEFAULT_REGION" \
                > /dev/null 2>&1; then
                echo "✓ Valid"
            else
                echo "✗ INVALID"
                VALIDATION_ERRORS=$((VALIDATION_ERRORS + 1))
                
                # Show the actual error
                aws cloudformation validate-template \
                    --template-body "file://$template" \
                    --region "$AWS_DEFAULT_REGION" 2>&1 || true
                echo ""
            fi
        fi
    done
    
    echo ""
    if [ $VALIDATION_ERRORS -gt 0 ]; then
        echo "ERROR: $VALIDATION_ERRORS template(s) failed validation"
        exit 1
    else
        echo "All templates validated successfully."
    fi
}

# ============================================================================
# Get Existing Stack Parameters
# ============================================================================
get_stack_parameters() {
    local stack_name=$1
    
    echo "Getting existing parameters from stack: $stack_name" >&2
    
    # Get parameter keys and build JSON array with UsePreviousValue: true
    # Uses only AWS CLI + bash (no jq dependency)
    local param_keys
    param_keys=$(aws cloudformation describe-stacks \
        --stack-name "$stack_name" \
        --region "$AWS_DEFAULT_REGION" \
        --query 'Stacks[0].Parameters[*].ParameterKey' \
        --output text 2>/dev/null) || { echo "[]"; return; }
    
    if [ -z "$param_keys" ]; then
        echo "[]"
        return
    fi
    
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
    # Optional explicit parameter overrides from pipeline variables.
    # This ensures newly added parameters can be set without manual stack editing.
    if [ -n "${OPENAI_API_KEY_SECRET_ARN:-}" ]; then
        if [ "$first" = true ]; then
            first=false
        else
            result+=","
        fi
        result+="{\"ParameterKey\":\"OpenAIApiKeySecretArn\",\"ParameterValue\":\"${OPENAI_API_KEY_SECRET_ARN}\"}"
    fi

    result+="]"
    echo "$result"
}

# Get stack parameters but only for keys that exist in the template.
# Use this when the template may have been updated (e.g. parameter renamed)
# so we do not pass obsolete parameter names (e.g. SlackWebhookUrl -> TeamsWebhookUrl).
get_stack_parameters_for_template() {
    local stack_name=$1
    local template_file=$2
    
    echo "Getting parameters from stack $stack_name (only keys present in template)..." >&2
    
    local template_keys
    template_keys=$(aws cloudformation get-template-summary \
        --template-body "file://$template_file" \
        --region "$AWS_DEFAULT_REGION" \
        --query 'Parameters[*].ParameterKey' \
        --output text 2>/dev/null) || { echo "[]"; return; }
    
    local stack_keys
    stack_keys=$(aws cloudformation describe-stacks \
        --stack-name "$stack_name" \
        --region "$AWS_DEFAULT_REGION" \
        --query 'Stacks[0].Parameters[*].ParameterKey' \
        --output text 2>/dev/null) || { echo "[]"; return; }
    
    local result="["
    local first=true
    for key in $template_keys; do
        # Only pass UsePreviousValue for keys that exist in the current stack
        # -w matches whole words, -F treats key as a fixed string (not regex)
        if echo "$stack_keys" | grep -qwF "${key}"; then
            if [ "$first" = true ]; then
                first=false
            else
                result+=","
            fi
            result+="{\"ParameterKey\":\"$key\",\"UsePreviousValue\":true}"
        fi
    done
    result+="]"
    echo "$result"
}

# ============================================================================
# Deploy Backend Stack
# ============================================================================
deploy_backend_stack() {
    echo ""
    echo "========================================="
    echo "Deploying Backend CloudFormation Stack"
    echo "========================================="
    
    local stack_name="${CF_STACK_BACKEND:-coheus-${BITBUCKET_DEPLOYMENT_ENVIRONMENT:-dev}-backend}"
    local template_file="infrastructure/cloudformation/coheus_ecs_fargate_stack.yaml"
    
    echo "Stack name: $stack_name"
    echo "Template: $template_file"
    echo ""
    
    # Check if stack exists
    if ! aws cloudformation describe-stacks --stack-name "$stack_name" --region "$AWS_DEFAULT_REGION" > /dev/null 2>&1; then
        echo "ERROR: Stack '$stack_name' does not exist."
        echo "This script only updates existing stacks. For initial creation, use the PowerShell scripts."
        exit 1
    fi
    
    # Get current stack status
    STACK_STATUS=$(aws cloudformation describe-stacks \
        --stack-name "$stack_name" \
        --region "$AWS_DEFAULT_REGION" \
        --query 'Stacks[0].StackStatus' \
        --output text)
    
    echo "Current stack status: $STACK_STATUS"
    
    # Only proceed if stack is in a stable state
    if [[ ! "$STACK_STATUS" =~ ^(CREATE_COMPLETE|UPDATE_COMPLETE|UPDATE_ROLLBACK_COMPLETE)$ ]]; then
        echo "ERROR: Stack is not in a stable state. Cannot update."
        exit 1
    fi
    
    # Update stack using existing parameter values
    # This preserves all existing parameters (like secrets) while applying template changes
    echo ""
    echo "Updating stack with template changes..."
    echo "(Using existing parameter values)"
    echo ""
    
    # Create a change set first to see what will change
    CHANGE_SET_NAME="pipeline-update-$(date +%Y%m%d%H%M%S)"
    
    echo "Creating change set: $CHANGE_SET_NAME"
    
    aws cloudformation create-change-set \
        --stack-name "$stack_name" \
        --change-set-name "$CHANGE_SET_NAME" \
        --template-body "file://$template_file" \
        --no-use-previous-template \
        --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
        --parameters "$(get_stack_parameters "$stack_name")" \
        --region "$AWS_DEFAULT_REGION" \
        --output json > /dev/null
    
    # Wait for change set to be created
    echo "Waiting for change set to be created..."
    
    aws cloudformation wait change-set-create-complete \
        --stack-name "$stack_name" \
        --change-set-name "$CHANGE_SET_NAME" \
        --region "$AWS_DEFAULT_REGION" 2>/dev/null || true
    
    # Check change set status
    CHANGE_SET_STATUS=$(aws cloudformation describe-change-set \
        --stack-name "$stack_name" \
        --change-set-name "$CHANGE_SET_NAME" \
        --region "$AWS_DEFAULT_REGION" \
        --query 'Status' \
        --output text)
    
    echo "Change set status: $CHANGE_SET_STATUS"
    
    if [ "$CHANGE_SET_STATUS" == "FAILED" ]; then
        # Check if it failed because there are no changes
        CHANGE_SET_REASON=$(aws cloudformation describe-change-set \
            --stack-name "$stack_name" \
            --change-set-name "$CHANGE_SET_NAME" \
            --region "$AWS_DEFAULT_REGION" \
            --query 'StatusReason' \
            --output text)
        
        if [[ "$CHANGE_SET_REASON" == *"didn't contain changes"* ]] || [[ "$CHANGE_SET_REASON" == *"No updates"* ]]; then
            echo ""
            echo "No infrastructure changes detected - stack is up to date."
            
            # Delete the empty change set
            aws cloudformation delete-change-set \
                --stack-name "$stack_name" \
                --change-set-name "$CHANGE_SET_NAME" \
                --region "$AWS_DEFAULT_REGION" || true
            
            return 0
        else
            echo "ERROR: Change set creation failed: $CHANGE_SET_REASON"
            exit 1
        fi
    fi
    
    # Show what changes will be made
    echo ""
    echo "Changes to be applied:"
    aws cloudformation describe-change-set \
        --stack-name "$stack_name" \
        --change-set-name "$CHANGE_SET_NAME" \
        --region "$AWS_DEFAULT_REGION" \
        --query 'Changes[*].{Action:ResourceChange.Action,Resource:ResourceChange.LogicalResourceId,Type:ResourceChange.ResourceType}' \
        --output table
    echo ""
    
    # Execute the change set
    echo "Executing change set..."
    
    aws cloudformation execute-change-set \
        --stack-name "$stack_name" \
        --change-set-name "$CHANGE_SET_NAME" \
        --region "$AWS_DEFAULT_REGION"
    
    # Wait for stack update to complete
    echo "Waiting for stack update to complete..."
    echo "(This may take several minutes)"
    echo ""
    
    if aws cloudformation wait stack-update-complete \
        --stack-name "$stack_name" \
        --region "$AWS_DEFAULT_REGION"; then
        echo ""
        echo "✓ Stack update completed successfully!"
    else
        echo ""
        echo "ERROR: Stack update failed or timed out."
        
        # Get stack events for debugging
        echo ""
        echo "Recent stack events:"
        aws cloudformation describe-stack-events \
            --stack-name "$stack_name" \
            --region "$AWS_DEFAULT_REGION" \
            --query 'StackEvents[0:10].{Time:Timestamp,Status:ResourceStatus,Resource:LogicalResourceId,Reason:ResourceStatusReason}' \
            --output table
        
        exit 1
    fi
}

# ============================================================================
# Deploy WAF/CloudFront Stack (always us-east-1 — CloudFront is global)
# ============================================================================
deploy_waf_cloudfront_stack() {
    echo ""
    echo "========================================="
    echo "Deploying WAF/CloudFront CloudFormation Stack"
    echo "========================================="

    local stack_name="${CF_STACK_WAF_CLOUDFRONT:-coheus-${BITBUCKET_DEPLOYMENT_ENVIRONMENT:-dev}-waf-cloudfront}"
    local template_file="infrastructure/cloudformation/coheus_waf_cloudfront_stack.yaml"
    # CloudFront/WAF stacks MUST be in us-east-1 regardless of backend region
    local cf_region="us-east-1"

    echo "Stack name: $stack_name"
    echo "Template: $template_file"
    echo "Region: $cf_region (CloudFront requires us-east-1)"
    echo ""

    # Check if stack exists
    if ! aws cloudformation describe-stacks --stack-name "$stack_name" --region "$cf_region" > /dev/null 2>&1; then
        echo "WARNING: WAF/CloudFront stack '$stack_name' does not exist in $cf_region."
        echo "Skipping CloudFront deployment. Set CF_STACK_WAF_CLOUDFRONT to your stack name if it differs."
        return 0
    fi

    # Get current stack status
    STACK_STATUS=$(aws cloudformation describe-stacks \
        --stack-name "$stack_name" \
        --region "$cf_region" \
        --query 'Stacks[0].StackStatus' \
        --output text)

    echo "Current stack status: $STACK_STATUS"

    if [[ ! "$STACK_STATUS" =~ ^(CREATE_COMPLETE|UPDATE_COMPLETE|UPDATE_ROLLBACK_COMPLETE)$ ]]; then
        echo "WARNING: CloudFront stack is not in a stable state ($STACK_STATUS). Skipping."
        return 0
    fi

    # Create change set
    CHANGE_SET_NAME="pipeline-cf-update-$(date +%Y%m%d%H%M%S)"
    echo "Creating change set: $CHANGE_SET_NAME"

    # Get existing parameters (use cf_region) - no jq dependency
    local param_keys_cf
    param_keys_cf=$(aws cloudformation describe-stacks \
        --stack-name "$stack_name" \
        --region "$cf_region" \
        --query 'Stacks[0].Parameters[*].ParameterKey' \
        --output text 2>/dev/null) || param_keys_cf=""
    
    local existing_params="["
    local first_cf=true
    for key in $param_keys_cf; do
        if [ "$first_cf" = true ]; then
            first_cf=false
        else
            existing_params+=","
        fi
        existing_params+="{\"ParameterKey\":\"$key\",\"UsePreviousValue\":true}"
    done
    existing_params+="]"

    aws cloudformation create-change-set \
        --stack-name "$stack_name" \
        --change-set-name "$CHANGE_SET_NAME" \
        --template-body "file://$template_file" \
        --no-use-previous-template \
        --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
        --parameters "$existing_params" \
        --region "$cf_region" \
        --output json > /dev/null

    echo "Waiting for change set to be created..."

    aws cloudformation wait change-set-create-complete \
        --stack-name "$stack_name" \
        --change-set-name "$CHANGE_SET_NAME" \
        --region "$cf_region" 2>/dev/null || true

    CHANGE_SET_STATUS=$(aws cloudformation describe-change-set \
        --stack-name "$stack_name" \
        --change-set-name "$CHANGE_SET_NAME" \
        --region "$cf_region" \
        --query 'Status' \
        --output text)

    echo "Change set status: $CHANGE_SET_STATUS"

    if [ "$CHANGE_SET_STATUS" == "FAILED" ]; then
        CHANGE_SET_REASON=$(aws cloudformation describe-change-set \
            --stack-name "$stack_name" \
            --change-set-name "$CHANGE_SET_NAME" \
            --region "$cf_region" \
            --query 'StatusReason' \
            --output text)

        if [[ "$CHANGE_SET_REASON" == *"didn't contain changes"* ]] || [[ "$CHANGE_SET_REASON" == *"No updates"* ]]; then
            echo "No CloudFront/WAF changes detected - stack is up to date."
            aws cloudformation delete-change-set \
                --stack-name "$stack_name" \
                --change-set-name "$CHANGE_SET_NAME" \
                --region "$cf_region" || true
            return 0
        else
            echo "ERROR: CloudFront change set creation failed: $CHANGE_SET_REASON"
            exit 1
        fi
    fi

    echo ""
    echo "Changes to be applied:"
    aws cloudformation describe-change-set \
        --stack-name "$stack_name" \
        --change-set-name "$CHANGE_SET_NAME" \
        --region "$cf_region" \
        --query 'Changes[*].{Action:ResourceChange.Action,Resource:ResourceChange.LogicalResourceId,Type:ResourceChange.ResourceType}' \
        --output table
    echo ""

    echo "Executing change set..."
    aws cloudformation execute-change-set \
        --stack-name "$stack_name" \
        --change-set-name "$CHANGE_SET_NAME" \
        --region "$cf_region"

    echo "Waiting for CloudFront stack update to complete..."
    echo "(CloudFront updates can take 5-15 minutes)"
    echo ""

    if aws cloudformation wait stack-update-complete \
        --stack-name "$stack_name" \
        --region "$cf_region"; then
        echo ""
        echo "✓ CloudFront/WAF stack update completed successfully!"
    else
        echo ""
        echo "ERROR: CloudFront stack update failed or timed out."
        aws cloudformation describe-stack-events \
            --stack-name "$stack_name" \
            --region "$cf_region" \
            --query 'StackEvents[0:10].{Time:Timestamp,Status:ResourceStatus,Resource:LogicalResourceId,Reason:ResourceStatusReason}' \
            --output table
        exit 1
    fi
}

# ============================================================================
# Deploy Monitoring Stack (CloudWatch, alarms, SNS, Teams webhook Lambda)
# ============================================================================
deploy_monitoring_stack() {
    echo ""
    echo "========================================="
    echo "Deploying Monitoring CloudFormation Stack"
    echo "========================================="

    local stack_name="${CF_STACK_MONITORING:-coheus-${BITBUCKET_DEPLOYMENT_ENVIRONMENT:-dev}-monitoring}"
    local template_file="infrastructure/cloudformation/coheus_monitoring_stack.yaml"

    echo "Stack name: $stack_name"
    echo "Template: $template_file"
    echo "Region: $AWS_DEFAULT_REGION"
    echo ""

    if ! aws cloudformation describe-stacks --stack-name "$stack_name" --region "$AWS_DEFAULT_REGION" > /dev/null 2>&1; then
        echo "WARNING: Monitoring stack '$stack_name' does not exist."
        echo "Skipping monitoring deployment. For initial creation, run scripts/deploy/04-deploy-monitoring.ps1"
        return 0
    fi

    STACK_STATUS=$(aws cloudformation describe-stacks \
        --stack-name "$stack_name" \
        --region "$AWS_DEFAULT_REGION" \
        --query 'Stacks[0].StackStatus' \
        --output text)

    echo "Current stack status: $STACK_STATUS"

    if [[ ! "$STACK_STATUS" =~ ^(CREATE_COMPLETE|UPDATE_COMPLETE|UPDATE_ROLLBACK_COMPLETE)$ ]]; then
        echo "WARNING: Monitoring stack is not in a stable state ($STACK_STATUS). Skipping."
        return 0
    fi

    CHANGE_SET_NAME="pipeline-monitoring-$(date +%Y%m%d%H%M%S)"
    echo "Creating change set: $CHANGE_SET_NAME"

    aws cloudformation create-change-set \
        --stack-name "$stack_name" \
        --change-set-name "$CHANGE_SET_NAME" \
        --template-body "file://$template_file" \
        --no-use-previous-template \
        --capabilities CAPABILITY_NAMED_IAM \
        --parameters "$(get_stack_parameters_for_template "$stack_name" "$template_file")" \
        --region "$AWS_DEFAULT_REGION" \
        --output json > /dev/null

    echo "Waiting for change set to be created..."
    aws cloudformation wait change-set-create-complete \
        --stack-name "$stack_name" \
        --change-set-name "$CHANGE_SET_NAME" \
        --region "$AWS_DEFAULT_REGION" 2>/dev/null || true

    CHANGE_SET_STATUS=$(aws cloudformation describe-change-set \
        --stack-name "$stack_name" \
        --change-set-name "$CHANGE_SET_NAME" \
        --region "$AWS_DEFAULT_REGION" \
        --query 'Status' \
        --output text)

    echo "Change set status: $CHANGE_SET_STATUS"

    if [ "$CHANGE_SET_STATUS" == "FAILED" ]; then
        CHANGE_SET_REASON=$(aws cloudformation describe-change-set \
            --stack-name "$stack_name" \
            --change-set-name "$CHANGE_SET_NAME" \
            --region "$AWS_DEFAULT_REGION" \
            --query 'StatusReason' \
            --output text)

        if [[ "$CHANGE_SET_REASON" == *"didn't contain changes"* ]] || [[ "$CHANGE_SET_REASON" == *"No updates"* ]]; then
            echo "No monitoring stack changes detected - stack is up to date."
            aws cloudformation delete-change-set \
                --stack-name "$stack_name" \
                --change-set-name "$CHANGE_SET_NAME" \
                --region "$AWS_DEFAULT_REGION" || true
            return 0
        else
            echo "ERROR: Monitoring change set creation failed: $CHANGE_SET_REASON"
            exit 1
        fi
    fi

    echo ""
    echo "Changes to be applied:"
    aws cloudformation describe-change-set \
        --stack-name "$stack_name" \
        --change-set-name "$CHANGE_SET_NAME" \
        --region "$AWS_DEFAULT_REGION" \
        --query 'Changes[*].{Action:ResourceChange.Action,Resource:ResourceChange.LogicalResourceId,Type:ResourceChange.ResourceType}' \
        --output table
    echo ""

    echo "Executing change set..."
    aws cloudformation execute-change-set \
        --stack-name "$stack_name" \
        --change-set-name "$CHANGE_SET_NAME" \
        --region "$AWS_DEFAULT_REGION"

    echo "Waiting for monitoring stack update to complete..."
    if aws cloudformation wait stack-update-complete \
        --stack-name "$stack_name" \
        --region "$AWS_DEFAULT_REGION"; then
        echo ""
        echo "✓ Monitoring stack update completed successfully!"
    else
        echo ""
        echo "ERROR: Monitoring stack update failed or timed out."
        aws cloudformation describe-stack-events \
            --stack-name "$stack_name" \
            --region "$AWS_DEFAULT_REGION" \
            --query 'StackEvents[0:10].{Time:Timestamp,Status:ResourceStatus,Resource:LogicalResourceId,Reason:ResourceStatusReason}' \
            --output table
        exit 1
    fi
}

# ============================================================================
# Display Summary
# ============================================================================
display_summary() {
    local backend_stack="${CF_STACK_BACKEND:-coheus-${BITBUCKET_DEPLOYMENT_ENVIRONMENT:-dev}-backend}"
    local monitoring_stack="${CF_STACK_MONITORING:-coheus-${BITBUCKET_DEPLOYMENT_ENVIRONMENT:-dev}-monitoring}"
    
    echo ""
    echo "========================================="
    echo "Infrastructure Deployment Complete!"
    echo "========================================="
    echo ""
    
    echo "Backend Stack Status:"
    aws cloudformation describe-stacks \
        --stack-name "$backend_stack" \
        --region "$AWS_DEFAULT_REGION" \
        --query 'Stacks[0].{StackName:StackName,Status:StackStatus,LastUpdated:LastUpdatedTime}' \
        --output table 2>/dev/null || echo "(Stack not found in $AWS_DEFAULT_REGION)"
    
    echo ""
    echo "Monitoring Stack Status:"
    aws cloudformation describe-stacks \
        --stack-name "$monitoring_stack" \
        --region "$AWS_DEFAULT_REGION" \
        --query 'Stacks[0].{StackName:StackName,Status:StackStatus,LastUpdated:LastUpdatedTime}' \
        --output table 2>/dev/null || echo "(Stack not found or not deployed)"
    
    echo ""
    echo "Deployment Environment: ${BITBUCKET_DEPLOYMENT_ENVIRONMENT:-unknown}"
    echo "Backend Region: $AWS_DEFAULT_REGION"
    echo "CloudFront Region: us-east-1 (global)"
    echo ""
}

# ============================================================================
# Main Execution
# ============================================================================
main() {
    install_aws_cli
    verify_aws_credentials
    validate_templates
    deploy_backend_stack
    deploy_waf_cloudfront_stack
    deploy_monitoring_stack
    display_summary
    
    echo "Infrastructure deployment completed."
    echo ""
}

main "$@"
