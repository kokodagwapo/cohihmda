#!/bin/bash
# Create AWS Secrets Manager secrets for API keys (encrypted with KMS)
# Usage: ./secrets-setup.sh

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Setting up AWS Secrets Manager secrets...${NC}"

# Check if KMS key alias exists
KMS_KEY_ID="${KMS_KEY_ID:-alias/coheus-encryption}"
echo -e "${YELLOW}Using KMS Key: ${KMS_KEY_ID}${NC}"

# Function to create secret
create_secret() {
  local secret_name=$1
  local secret_value=$2
  
  if [ -z "$secret_value" ]; then
    echo -e "${RED}Error: ${secret_name} value is empty. Please set the environment variable.${NC}"
    return 1
  fi
  
  echo -e "${YELLOW}Creating secret: ${secret_name}${NC}"
  
  # Check if secret already exists
  if aws secretsmanager describe-secret --secret-id "$secret_name" &>/dev/null; then
    echo -e "${YELLOW}Secret ${secret_name} already exists. Updating...${NC}"
    aws secretsmanager update-secret \
      --secret-id "$secret_name" \
      --secret-string "$secret_value" \
      --kms-key-id "$KMS_KEY_ID" \
      --region "${AWS_REGION:-us-east-1}"
  else
    aws secretsmanager create-secret \
      --name "$secret_name" \
      --secret-string "$secret_value" \
      --kms-key-id "$KMS_KEY_ID" \
      --region "${AWS_REGION:-us-east-1}"
  fi
  
  echo -e "${GREEN}✓ Secret ${secret_name} created/updated${NC}"
}

# Create secrets
create_secret "coheus/gemini-api-key" "${GEMINI_API_KEY}"
create_secret "coheus/openai-api-key" "${OPENAI_API_KEY}"
create_secret "coheus/ai-gateway-api-key" "${AI_GATEWAY_API_KEY}"
create_secret "coheus/stripe-secret-key" "${STRIPE_SECRET_KEY}"
create_secret "coheus/stripe-webhook-secret" "${STRIPE_WEBHOOK_SECRET}"

echo -e "${GREEN}✓ All secrets created successfully!${NC}"
