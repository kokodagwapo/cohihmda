#!/bin/bash
# ============================================================================
# DR Stack Deployment Script for Bitbucket Pipelines (Manual Trigger)
# ============================================================================
# Deploys CloudFormation stacks that are NOT part of the regular dev pipeline:
#   1. Aurora cluster stack(s) — retention, reader instance (no Global Database)
#   2. AWS Backup stack — vault, plan, tag-based selection, optional cross-region copy
#   3. DR landing zone (us-east-1) — VPC, backup copy vault, KMS, optional S3 replica (opt-in)
#
# Required Environment Variables:
#   - AWS_ROLE_ARN              - IAM role ARN for OIDC
#   - AWS_REGION                - Primary region (default: us-east-2)
#   - CF_STACK_AURORA_MGMT      - Aurora management stack name
#                                 (default: coheus-${ENV}-aurora-management)
#
# Optional:
#   - CF_STACK_BACKUP           - Backup stack name
#                                 (default: coheus-${ENV}-backup)
#   - CF_STACK_DR_LANDING       - DR landing stack name in DR_SECONDARY_REGION
#                                 (default: coheus-${ENV}-aurora-secondary)
#   - DR_SECONDARY_REGION       - DR region (default: us-east-1)
#   - SKIP_AURORA               - Set to "true" to skip Aurora deploy
#   - SKIP_BACKUP               - Set to "true" to skip Backup deploy
#   - DEPLOY_DR_LANDING         - Set to "true" to deploy/update DR landing stack
#                                 (VPC + DR backup vault for snapshot copies)
#
# OIDC Environment (set by pipeline setup-oidc script):
#   - AWS_WEB_IDENTITY_TOKEN_FILE
#   - AWS_ROLE_SESSION_NAME
# ============================================================================

set -euo pipefail

echo "========================================="
echo "DR Stack Deployment (Manual Trigger)"
echo "========================================="
echo ""
echo "Environment: ${BITBUCKET_DEPLOYMENT_ENVIRONMENT:-unknown}"
echo "Commit: ${BITBUCKET_COMMIT:-unknown}"
echo "Branch: ${BITBUCKET_BRANCH:-unknown}"
echo ""

export AWS_DEFAULT_REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-2}}"
ENV="${BITBUCKET_DEPLOYMENT_ENVIRONMENT:-dev}"

# ============================================================================
# Install AWS CLI (reuse pattern from deploy-infrastructure.sh)
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
# Get existing stack parameters (only keys present in the template)
# ============================================================================
get_stack_parameters_for_template() {
    local stack_name=$1
    local template_file=$2
    local region="${3:-$AWS_DEFAULT_REGION}"

    echo "Getting parameters from stack $stack_name (only keys present in template)..." >&2

    local template_keys
    template_keys=$(aws cloudformation get-template-summary \
        --template-body "file://$template_file" \
        --region "$region" \
        --query 'Parameters[*].ParameterKey' \
        --output text 2>/dev/null) || { echo "[]"; return; }

    local stack_keys
    stack_keys=$(aws cloudformation describe-stacks \
        --stack-name "$stack_name" \
        --region "$region" \
        --query 'Stacks[0].Parameters[*].ParameterKey' \
        --output text 2>/dev/null) || { echo "[]"; return; }

    local result="["
    local first=true
    for key in $template_keys; do
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
# Generic update-or-skip via change set (single region)
# ============================================================================
deploy_stack() {
    local stack_name=$1
    local template_file=$2
    local region=$3
    local label=$4
    local param_overrides="${5:-}"

    echo ""
    echo "========================================="
    echo "Deploying $label"
    echo "========================================="
    echo "Stack name: $stack_name"
    echo "Template: $template_file"
    echo "Region: $region"
    if [ -n "$param_overrides" ]; then
        echo "Parameter overrides: $param_overrides"
    fi
    echo ""

    local params_flag=""
    if [ -n "$param_overrides" ]; then
        params_flag="--parameters $param_overrides"
    fi

    if ! aws cloudformation describe-stacks --stack-name "$stack_name" --region "$region" > /dev/null 2>&1; then
        echo "Stack does not exist — creating..."
        aws cloudformation create-stack \
            --stack-name "$stack_name" \
            --template-body "file://$template_file" \
            --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
            --region "$region" \
            $params_flag \
            --output json > /dev/null

        echo "Waiting for stack creation to complete..."
        if aws cloudformation wait stack-create-complete --stack-name "$stack_name" --region "$region"; then
            echo "✓ Stack created successfully!"
        else
            echo "ERROR: Stack creation failed."
            aws cloudformation describe-stack-events \
                --stack-name "$stack_name" --region "$region" \
                --query 'StackEvents[0:10].{Time:Timestamp,Status:ResourceStatus,Resource:LogicalResourceId,Reason:ResourceStatusReason}' \
                --output table
            exit 1
        fi
        return 0
    fi

    STACK_STATUS=$(aws cloudformation describe-stacks \
        --stack-name "$stack_name" --region "$region" \
        --query 'Stacks[0].StackStatus' --output text)

    echo "Current stack status: $STACK_STATUS"

    if [[ ! "$STACK_STATUS" =~ ^(CREATE_COMPLETE|UPDATE_COMPLETE|UPDATE_ROLLBACK_COMPLETE)$ ]]; then
        echo "ERROR: Stack is not in a stable state. Cannot update."
        exit 1
    fi

    CHANGE_SET_NAME="pipeline-dr-$(date +%Y%m%d%H%M%S)"
    echo "Creating change set: $CHANGE_SET_NAME"

    local merged_params
    merged_params=$(get_stack_parameters_for_template "$stack_name" "$template_file" "$region")

    if [ -n "$param_overrides" ]; then
        for override in $param_overrides; do
            local override_key
            override_key=$(echo "$override" | sed 's/ParameterKey=\([^,]*\),.*/\1/')
            merged_params=$(echo "$merged_params" | sed "s/{\"ParameterKey\":\"$override_key\",\"UsePreviousValue\":true}/{\"ParameterKey\":\"$override_key\",\"ParameterValue\":\"$(echo "$override" | sed 's/.*ParameterValue=\(.*\)/\1/')\"}/" )
        done
    fi

    aws cloudformation create-change-set \
        --stack-name "$stack_name" \
        --change-set-name "$CHANGE_SET_NAME" \
        --template-body "file://$template_file" \
        --no-use-previous-template \
        --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
        --parameters "$merged_params" \
        --region "$region" \
        --output json > /dev/null

    echo "Waiting for change set to be created..."
    aws cloudformation wait change-set-create-complete \
        --stack-name "$stack_name" \
        --change-set-name "$CHANGE_SET_NAME" \
        --region "$region" 2>/dev/null || true

    CHANGE_SET_STATUS=$(aws cloudformation describe-change-set \
        --stack-name "$stack_name" \
        --change-set-name "$CHANGE_SET_NAME" \
        --region "$region" \
        --query 'Status' --output text)

    echo "Change set status: $CHANGE_SET_STATUS"

    if [ "$CHANGE_SET_STATUS" == "FAILED" ]; then
        CHANGE_SET_REASON=$(aws cloudformation describe-change-set \
            --stack-name "$stack_name" \
            --change-set-name "$CHANGE_SET_NAME" \
            --region "$region" \
            --query 'StatusReason' --output text)

        if [[ "$CHANGE_SET_REASON" == *"didn't contain changes"* ]] || [[ "$CHANGE_SET_REASON" == *"No updates"* ]]; then
            echo "No changes detected — stack is up to date."
            aws cloudformation delete-change-set \
                --stack-name "$stack_name" \
                --change-set-name "$CHANGE_SET_NAME" \
                --region "$region" || true
            return 0
        else
            echo "ERROR: Change set creation failed: $CHANGE_SET_REASON"
            exit 1
        fi
    fi

    echo ""
    echo "Changes to be applied:"
    aws cloudformation describe-change-set \
        --stack-name "$stack_name" \
        --change-set-name "$CHANGE_SET_NAME" \
        --region "$region" \
        --query 'Changes[*].{Action:ResourceChange.Action,Resource:ResourceChange.LogicalResourceId,Type:ResourceChange.ResourceType}' \
        --output table
    echo ""

    echo "Executing change set..."
    aws cloudformation execute-change-set \
        --stack-name "$stack_name" \
        --change-set-name "$CHANGE_SET_NAME" \
        --region "$region"

    echo "Waiting for stack update to complete..."
    if aws cloudformation wait stack-update-complete --stack-name "$stack_name" --region "$region"; then
        echo ""
        echo "✓ $label update completed successfully!"
    else
        echo ""
        echo "ERROR: $label update failed or timed out."
        aws cloudformation describe-stack-events \
            --stack-name "$stack_name" --region "$region" \
            --query 'StackEvents[0:10].{Time:Timestamp,Status:ResourceStatus,Resource:LogicalResourceId,Reason:ResourceStatusReason}' \
            --output table
        exit 1
    fi
}

# ============================================================================
# Main
# ============================================================================
main() {
    install_aws_cli
    verify_aws_credentials

    # --- Aurora management cluster ---
    if [ "${SKIP_AURORA:-false}" != "true" ]; then
        local aurora_stack="${CF_STACK_AURORA_MGMT:-coheus-${ENV}-aurora-management}"
        local aurora_template="infrastructure/cloudformation/coheus_aurora_cluster_stack.yaml"

        echo ""
        echo "Validating $aurora_template..."
        aws cloudformation validate-template \
            --template-body "file://$aurora_template" \
            --region "$AWS_DEFAULT_REGION" > /dev/null
        echo "✓ Template valid"

        deploy_stack "$aurora_stack" "$aurora_template" "$AWS_DEFAULT_REGION" "Aurora Management Cluster" ""
    else
        echo "Skipping Aurora deploy (SKIP_AURORA=true)"
    fi

    # --- AWS Backup stack ---
    if [ "${SKIP_BACKUP:-false}" != "true" ]; then
        local backup_stack="${CF_STACK_BACKUP:-coheus-${ENV}-backup}"
        local backup_template="infrastructure/cloudformation/coheus_backup_stack.yaml"

        echo ""
        echo "Validating $backup_template..."
        aws cloudformation validate-template \
            --template-body "file://$backup_template" \
            --region "$AWS_DEFAULT_REGION" > /dev/null
        echo "✓ Template valid"

        deploy_stack "$backup_stack" "$backup_template" "$AWS_DEFAULT_REGION" "AWS Backup (Cohi)"
    else
        echo "Skipping Backup deploy (SKIP_BACKUP=true)"
    fi

    # --- DR landing zone (VPC + DR backup vault + optional S3 replica) ---
    if [ "${DEPLOY_DR_LANDING:-false}" == "true" ]; then
        local secondary_region="${DR_SECONDARY_REGION:-us-east-1}"
        local dr_stack="${CF_STACK_DR_LANDING:-coheus-${ENV}-aurora-secondary}"
        local dr_template="infrastructure/cloudformation/coheus_aurora_secondary_stack.yaml"

        echo ""
        echo "Validating $dr_template..."
        aws cloudformation validate-template \
            --template-body "file://$dr_template" \
            --region "$secondary_region" > /dev/null
        echo "✓ Template valid"

        echo ""
        echo "NOTE: DR landing stack deploys to region $secondary_region."
        echo "Ensure Org SCP allows Cohi resources in this region before proceeding."
        echo ""

        local dr_params="ParameterKey=ProjectName,ParameterValue=coheus ParameterKey=Environment,ParameterValue=${ENV}"

        if ! aws cloudformation describe-stacks --stack-name "$dr_stack" --region "$secondary_region" > /dev/null 2>&1; then
            echo "========================================="
            echo "Creating DR Landing Stack ($secondary_region)"
            echo "========================================="
            aws cloudformation create-stack \
                --stack-name "$dr_stack" \
                --template-body "file://$dr_template" \
                --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
                --region "$secondary_region" \
                --parameters $dr_params \
                --output json > /dev/null

            echo "Waiting for stack creation to complete (this may take several minutes)..."
            if aws cloudformation wait stack-create-complete --stack-name "$dr_stack" --region "$secondary_region"; then
                echo "✓ DR landing stack created successfully!"
            else
                echo "ERROR: DR landing stack creation failed."
                aws cloudformation describe-stack-events \
                    --stack-name "$dr_stack" --region "$secondary_region" \
                    --query 'StackEvents[0:10].{Time:Timestamp,Status:ResourceStatus,Resource:LogicalResourceId,Reason:ResourceStatusReason}' \
                    --output table
                exit 1
            fi
        else
            deploy_stack "$dr_stack" "$dr_template" "$secondary_region" "DR Landing Zone ($secondary_region)" ""
        fi
    else
        echo ""
        echo "Skipping DR landing stack (DEPLOY_DR_LANDING != true)"
        echo "  Set DEPLOY_DR_LANDING=true to deploy the us-east-1 VPC + DR backup copy vault."
    fi

    echo ""
    echo "========================================="
    echo "DR Stack Deployment Complete!"
    echo "========================================="
    echo ""
    echo "Next steps:"
    echo "  - Verify Aurora reader instance(s) in RDS console"
    echo "  - Verify first backup job in AWS Backup console (within 24h)"
    echo "  - After DR landing stack exists: confirm cross-region copy jobs (if enabled) in AWS Backup"
    echo "  - Cold restore playbook: scripts/dr/restore-from-snapshot.sh"
    echo "  - docs/deployment/DR_DEPLOY_CHECKLIST.md"
    echo ""
}

main "$@"
