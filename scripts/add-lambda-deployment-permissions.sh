#!/bin/bash
# ============================================================================
# Add Required IAM Permissions for Lambda Deployment
# ============================================================================
# This script adds all required managed policies to the IAM user for
# Serverless Framework Lambda deployment

set -e

IAM_USER_NAME="${1:-Cohi}"
AWS_REGION="${AWS_REGION:-us-east-1}"

echo "========================================="
echo "Adding IAM Permissions for Lambda Deployment"
echo "========================================="
echo "IAM User: ${IAM_USER_NAME}"
echo "Region: ${AWS_REGION}"
echo ""

# Required managed policies
POLICIES=(
  "arn:aws:iam::aws:policy/AWSCloudFormationFullAccess"
  "arn:aws:iam::aws:policy/AmazonAPIGatewayAdministrator"
  "arn:aws:iam::aws:policy/AmazonDynamoDBFullAccess"
  "arn:aws:iam::aws:policy/AWSLambda_FullAccess"
  "arn:aws:iam::aws:policy/CloudWatchLogsFullAccess"
  "arn:aws:iam::aws:policy/IAMFullAccess"
)

echo "Attaching managed policies..."
for POLICY_ARN in "${POLICIES[@]}"; do
  POLICY_NAME=$(echo "${POLICY_ARN}" | awk -F'/' '{print $NF}')
  echo "  - Attaching ${POLICY_NAME}..."
  
  if aws iam attach-user-policy \
    --user-name "${IAM_USER_NAME}" \
    --policy-arn "${POLICY_ARN}" 2>/dev/null; then
    echo "    ✓ ${POLICY_NAME} attached successfully"
  else
    # Check if already attached
    if aws iam list-attached-user-policies \
      --user-name "${IAM_USER_NAME}" \
      --query "AttachedPolicies[?PolicyArn=='${POLICY_ARN}'].PolicyArn" \
      --output text | grep -q "${POLICY_ARN}"; then
      echo "    ⚠ ${POLICY_NAME} already attached"
    else
      echo "    ✗ Failed to attach ${POLICY_NAME}"
      exit 1
    fi
  fi
done

echo ""
echo "========================================="
echo "Verifying attached policies..."
echo "========================================="

ATTACHED_POLICIES=$(aws iam list-attached-user-policies \
  --user-name "${IAM_USER_NAME}" \
  --query "AttachedPolicies[].PolicyName" \
  --output text)

echo "Attached policies:"
for POLICY in ${ATTACHED_POLICIES}; do
  echo "  ✓ ${POLICY}"
done

echo ""
echo "========================================="
echo "✓ Permissions added successfully!"
echo "========================================="
echo ""
echo "The IAM user '${IAM_USER_NAME}' now has the following permissions:"
echo "  - CloudFormation (stack management)"
echo "  - API Gateway (REST/WebSocket APIs)"
echo "  - DynamoDB (tables for WebSocket connections)"
echo "  - Lambda (function deployment)"
echo ""
echo "You can now retry the Lambda deployment."

