#!/bin/bash
# ============================================================================
# Fix Stuck CloudFormation Stack
# ============================================================================
# This script helps fix a CloudFormation stack that's stuck in rollback

set -e

STACK_NAME="${1:-coheus-lambda-functions-dev}"
AWS_REGION="${AWS_REGION:-us-east-1}"

echo "========================================="
echo "Fixing Stuck CloudFormation Stack"
echo "========================================="
echo "Stack Name: ${STACK_NAME}"
echo "Region: ${AWS_REGION}"
echo ""

# Check stack status
echo "Checking stack status..."
STACK_STATUS=$(aws cloudformation describe-stacks \
  --stack-name "${STACK_NAME}" \
  --region "${AWS_REGION}" \
  --query 'Stacks[0].StackStatus' \
  --output text 2>/dev/null || echo "NOT_FOUND")

if [[ "${STACK_STATUS}" == "NOT_FOUND" ]]; then
  echo "✓ Stack does not exist. Nothing to fix."
  exit 0
fi

echo "Current stack status: ${STACK_STATUS}"
echo ""

# Check if stack is in rollback state
if [[ "${STACK_STATUS}" == *"ROLLBACK"* ]] || [[ "${STACK_STATUS}" == *"CLEANUP"* ]]; then
  echo "Stack is in rollback/cleanup state."
  echo ""
  echo "Attempting to continue rollback..."
  
  if aws cloudformation continue-update-rollback \
    --stack-name "${STACK_NAME}" \
    --region "${AWS_REGION}"; then
    echo "✓ Rollback continuation initiated."
    echo ""
    echo "Waiting for rollback to complete (checking every 10 seconds)..."
    
    MAX_WAIT=600  # 10 minutes
    ELAPSED=0
    
    while [[ $ELAPSED -lt $MAX_WAIT ]]; do
      CURRENT_STATUS=$(aws cloudformation describe-stacks \
        --stack-name "${STACK_NAME}" \
        --region "${AWS_REGION}" \
        --query 'Stacks[0].StackStatus' \
        --output text 2>/dev/null || echo "NOT_FOUND")
      
      echo "  Status: ${CURRENT_STATUS} (${ELAPSED}s elapsed)"
      
      if [[ "${CURRENT_STATUS}" == "ROLLBACK_COMPLETE" ]] || \
         [[ "${CURRENT_STATUS}" == "UPDATE_ROLLBACK_COMPLETE" ]] || \
         [[ "${CURRENT_STATUS}" == "UPDATE_COMPLETE" ]]; then
        echo ""
        echo "✓ Rollback completed! Stack status: ${CURRENT_STATUS}"
        exit 0
      fi
      
      if [[ "${CURRENT_STATUS}" != *"ROLLBACK"* ]] && \
         [[ "${CURRENT_STATUS}" != *"CLEANUP"* ]] && \
         [[ "${CURRENT_STATUS}" != "NOT_FOUND" ]]; then
        echo ""
        echo "✓ Stack is now in state: ${CURRENT_STATUS}"
        exit 0
      fi
      
      sleep 10
      ELAPSED=$((ELAPSED + 10))
    done
    
    echo ""
    echo "⚠ Rollback is taking longer than expected."
    echo "Please check the stack manually in AWS Console:"
    echo "https://console.aws.amazon.com/cloudformation/home?region=${AWS_REGION}#/stacks"
  else
    echo "✗ Could not continue rollback. Stack may be stuck on a resource."
    echo ""
    echo "Checking for failed resources..."
    
    # List failed resources
    FAILED_RESOURCES=$(aws cloudformation describe-stack-events \
      --stack-name "${STACK_NAME}" \
      --region "${AWS_REGION}" \
      --query 'StackEvents[?ResourceStatus==`CREATE_FAILED` || ResourceStatus==`UPDATE_FAILED` || ResourceStatus==`DELETE_FAILED`].[LogicalResourceId,ResourceStatus,ResourceStatusReason]' \
      --output table 2>/dev/null || echo "")
    
    if [[ -n "${FAILED_RESOURCES}" ]]; then
      echo "Failed resources:"
      echo "${FAILED_RESOURCES}"
      echo ""
    fi
    
    echo "Options:"
    echo "1. Wait for rollback to complete manually"
    echo "2. Delete the stack and recreate:"
    echo "   aws cloudformation delete-stack --stack-name ${STACK_NAME} --region ${AWS_REGION}"
    echo "3. Fix the failed resource manually, then continue rollback"
    exit 1
  fi
else
  echo "Stack is not in rollback state. Current status: ${STACK_STATUS}"
  echo ""
  
  if [[ "${STACK_STATUS}" == "CREATE_COMPLETE" ]] || \
     [[ "${STACK_STATUS}" == "UPDATE_COMPLETE" ]]; then
    echo "✓ Stack is in a healthy state. No action needed."
  else
    echo "Stack status: ${STACK_STATUS}"
    echo "Please check the stack in AWS Console for details."
  fi
fi

