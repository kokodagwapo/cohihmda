#!/bin/bash
# ============================================================================
# Add IAM Permissions for Serverless Framework Deployment
# ============================================================================
# This script creates and attaches a custom IAM policy that grants all
# necessary permissions for Serverless Framework to deploy Lambda functions,
# including the ability to create IAM roles and manage CloudFormation stacks.

set -e

IAM_USER_NAME="${1:-Cohi}"
AWS_REGION="${AWS_REGION:-us-east-1}"
POLICY_NAME="ServerlessFrameworkDeploymentPolicy"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
POLICY_FILE="${SCRIPT_DIR}/serverless-deployment-iam-policy.json"

echo "========================================="
echo "Adding IAM Permissions for Serverless Framework"
echo "========================================="
echo "IAM User: ${IAM_USER_NAME}"
echo "Policy Name: ${POLICY_NAME}"
echo "Region: ${AWS_REGION}"
echo ""

# Check if policy file exists
if [ ! -f "${POLICY_FILE}" ]; then
  echo "::error::Policy file not found: ${POLICY_FILE}"
  exit 1
fi

# Get AWS Account ID
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
if [ -z "${ACCOUNT_ID}" ]; then
  echo "::error::Failed to get AWS Account ID"
  exit 1
fi

POLICY_ARN="arn:aws:iam::${ACCOUNT_ID}:policy/${POLICY_NAME}"

echo "Step 1: Creating/Updating IAM Policy..."
echo "  Policy ARN: ${POLICY_ARN}"
echo ""

# Check if policy already exists
if aws iam get-policy --policy-arn "${POLICY_ARN}" >/dev/null 2>&1; then
  echo "  Policy already exists. Creating new version..."
  
  # Create new policy version
  aws iam create-policy-version \
    --policy-arn "${POLICY_ARN}" \
    --policy-document "file://${POLICY_FILE}" \
    --set-as-default >/dev/null
  
  echo "  ✓ Policy version updated"
else
  echo "  Creating new policy..."
  
  # Create new policy
  aws iam create-policy \
    --policy-name "${POLICY_NAME}" \
    --policy-document "file://${POLICY_FILE}" \
    --description "Permissions required for Serverless Framework Lambda deployment" >/dev/null
  
  echo "  ✓ Policy created"
fi

echo ""
echo "Step 2: Attaching policy to IAM user..."
echo "  User: ${IAM_USER_NAME}"
echo ""

# Attach policy to user
if aws iam attach-user-policy \
  --user-name "${IAM_USER_NAME}" \
  --policy-arn "${POLICY_ARN}" 2>/dev/null; then
  echo "  ✓ Policy attached successfully"
else
  # Check if already attached
  if aws iam list-attached-user-policies \
    --user-name "${IAM_USER_NAME}" \
    --query "AttachedPolicies[?PolicyArn=='${POLICY_ARN}'].PolicyArn" \
    --output text | grep -q "${POLICY_ARN}"; then
    echo "  ⚠ Policy already attached"
  else
    echo "  ✗ Failed to attach policy"
    exit 1
  fi
fi

echo ""
echo "========================================="
echo "✓ Permissions added successfully!"
echo "========================================="
echo ""
echo "The IAM user '${IAM_USER_NAME}' now has permissions for:"
echo "  ✓ IAM role creation and management (for Lambda execution roles)"
echo "  ✓ CloudFormation stack management"
echo "  ✓ Lambda function deployment"
echo "  ✓ API Gateway management"
echo "  ✓ DynamoDB table management"
echo "  ✓ CloudWatch Logs"
echo "  ✓ S3 bucket access (for deployment artifacts)"
echo ""
echo "You can now retry the Lambda deployment with:"
echo "  cd lambda"
echo "  serverless deploy --stage dev"
echo ""

