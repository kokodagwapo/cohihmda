#!/bin/bash
# ============================================================================
# Infrastructure Deployment Script for Bitbucket Pipelines
# ============================================================================
# This script is triggered when CloudFormation templates change.
# 
# IMPORTANT: CloudFormation deployments are intentionally NOT automated
# because infrastructure changes require careful review and planning.
#
# This script will:
# 1. List the changed CloudFormation templates
# 2. Validate the templates
# 3. Output instructions for manual deployment
#
# For automated infrastructure deployment, you would need to add:
#   - AWS CloudFormation deploy commands
#   - Proper parameter handling for each environment
#   - Rollback strategies
# ============================================================================

set -euo pipefail

echo "========================================="
echo "Infrastructure Change Detection"
echo "========================================="
echo ""
echo "Environment: ${BITBUCKET_DEPLOYMENT_ENVIRONMENT:-unknown}"
echo "Commit: ${BITBUCKET_COMMIT:-unknown}"
echo "Branch: ${BITBUCKET_BRANCH:-unknown}"
echo ""

# ============================================================================
# Install AWS CLI (if needed for validation)
# ============================================================================
install_aws_cli() {
    if command -v aws &> /dev/null; then
        echo "AWS CLI already installed: $(aws --version)"
        return
    fi
    
    echo "Installing AWS CLI for template validation..."
    apt-get update -qq
    apt-get install -y -qq unzip curl > /dev/null
    
    curl -sS "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
    unzip -qq awscliv2.zip
    ./aws/install --update
    rm -rf awscliv2.zip aws/
    
    echo "AWS CLI installed: $(aws --version)"
}

# ============================================================================
# List Changed Templates
# ============================================================================
list_templates() {
    echo ""
    echo "========================================="
    echo "CloudFormation Templates"
    echo "========================================="
    echo ""
    
    if [ -d "infrastructure/cloudformation" ]; then
        echo "Templates in infrastructure/cloudformation/:"
        echo ""
        ls -la infrastructure/cloudformation/*.yaml 2>/dev/null || echo "  No .yaml files found"
        echo ""
    else
        echo "WARNING: infrastructure/cloudformation/ directory not found"
    fi
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
    
    if [ -z "${AWS_ACCESS_KEY_ID:-}" ] || [ -z "${AWS_SECRET_ACCESS_KEY:-}" ]; then
        echo "WARNING: AWS credentials not configured - skipping validation"
        return
    fi
    
    VALIDATION_ERRORS=0
    
    for template in infrastructure/cloudformation/*.yaml; do
        if [ -f "$template" ]; then
            echo -n "Validating $(basename "$template")... "
            
            if aws cloudformation validate-template \
                --template-body "file://$template" \
                --region "${AWS_DEFAULT_REGION:-us-east-2}" \
                > /dev/null 2>&1; then
                echo "✓ Valid"
            else
                echo "✗ INVALID"
                VALIDATION_ERRORS=$((VALIDATION_ERRORS + 1))
                
                # Show the actual error
                aws cloudformation validate-template \
                    --template-body "file://$template" \
                    --region "${AWS_DEFAULT_REGION:-us-east-2}" 2>&1 || true
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
# Display Manual Deployment Instructions
# ============================================================================
show_instructions() {
    echo ""
    echo "========================================="
    echo "MANUAL DEPLOYMENT REQUIRED"
    echo "========================================="
    echo ""
    echo "CloudFormation changes have been detected but NOT automatically deployed."
    echo "Infrastructure changes require manual review and deployment."
    echo ""
    echo "To deploy these changes:"
    echo ""
    echo "1. Review the changed templates in infrastructure/cloudformation/"
    echo ""
    echo "2. Use the PowerShell deployment scripts (from Windows):"
    echo "   cd scripts/deploy"
    echo "   .\\deploy-all.ps1"
    echo ""
    echo "   Or deploy individual stacks:"
    echo "   .\\01-deploy-aurora.ps1      # Database"
    echo "   .\\02-deploy-backend.ps1     # ECS Fargate"
    echo "   .\\03-deploy-waf-cloudfront.ps1  # WAF + CDN"
    echo "   .\\04-deploy-monitoring.ps1  # CloudWatch"
    echo "   .\\05-deploy-tenant-provisioning.ps1  # Lambda automation"
    echo ""
    echo "3. Or use AWS CLI directly:"
    echo "   aws cloudformation deploy \\"
    echo "     --template-file infrastructure/cloudformation/TEMPLATE.yaml \\"
    echo "     --stack-name STACK_NAME \\"
    echo "     --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \\"
    echo "     --parameter-overrides Key1=Value1 Key2=Value2"
    echo ""
    echo "4. Or use the AWS Console:"
    echo "   https://console.aws.amazon.com/cloudformation/"
    echo ""
    echo "========================================="
    echo ""
}

# ============================================================================
# Main Execution
# ============================================================================
main() {
    install_aws_cli
    list_templates
    validate_templates
    show_instructions
    
    echo "Infrastructure change detection completed."
    echo ""
}

main "$@"
