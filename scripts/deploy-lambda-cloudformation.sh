#!/bin/bash
# ============================================================================
# Deploy Lambda Functions using CloudFormation
# ============================================================================
# This script packages and deploys Lambda functions using CloudFormation
# instead of Serverless Framework for better visibility and debugging

set -e

STAGE="${1:-dev}"
AWS_REGION="${AWS_REGION:-us-east-1}"
STACK_NAME="coheus-lambda-functions-${STAGE}"

echo "========================================="
echo "Deploying Lambda Functions with CloudFormation"
echo "========================================="
echo "Stage: ${STAGE}"
echo "Stack Name: ${STACK_NAME}"
echo "Region: ${AWS_REGION}"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Function to get value from SSM Parameter Store or environment variable
get_parameter_value() {
  local PARAM_NAME="$1"
  local ENV_VAR="$2"
  local SSM_PATH="/coheus/${PARAM_NAME}"
  
  # First try environment variable
  if [ -n "${!ENV_VAR}" ]; then
    echo "${!ENV_VAR}"
    return
  fi
  
  # Then try SSM Parameter Store
  if aws ssm get-parameter --name "${SSM_PATH}" --region "${AWS_REGION}" --query 'Parameter.Value' --output text 2>/dev/null; then
    return
  fi
  
  # If neither exists, return empty
  echo ""
}

# Get parameter values (from env vars or SSM)
echo "Resolving parameters..."
DB_HOST=$(get_parameter_value "db-host" "DB_HOST")
DB_NAME=$(get_parameter_value "db-name" "DB_NAME")
DB_USER=$(get_parameter_value "db-user" "DB_USER")
DB_PASSWORD=$(get_parameter_value "db-password" "DB_PASSWORD")
SECURITY_GROUP_ID=$(get_parameter_value "security-group-id" "SECURITY_GROUP_ID")
SUBNET_ID_1=$(get_parameter_value "subnet-id-1" "SUBNET_ID_1")
SUBNET_ID_2=$(get_parameter_value "subnet-id-2" "SUBNET_ID_2")

# Validate required parameters
REQUIRED_PARAMS=("DB_HOST:db-host" "DB_NAME:db-name" "DB_USER:db-user" "DB_PASSWORD:db-password" "SECURITY_GROUP_ID:security-group-id" "SUBNET_ID_1:subnet-id-1" "SUBNET_ID_2:subnet-id-2")
MISSING_PARAMS=()

for PARAM_PAIR in "${REQUIRED_PARAMS[@]}"; do
  PARAM_VAR="${PARAM_PAIR%%:*}"
  PARAM_NAME="${PARAM_PAIR##*:}"
  PARAM_VALUE=$(get_parameter_value "${PARAM_NAME}" "${PARAM_VAR}")
  
  if [ -z "${PARAM_VALUE}" ]; then
    MISSING_PARAMS+=("${PARAM_VAR} (or SSM: /coheus/${PARAM_NAME})")
  fi
done

if [ ${#MISSING_PARAMS[@]} -ne 0 ]; then
  echo -e "${RED}❌ Missing required parameters:${NC}"
  for PARAM in "${MISSING_PARAMS[@]}"; do
    echo "  - ${PARAM}"
  done
  echo ""
  echo "Either set environment variables or create SSM parameters:"
  echo "  aws ssm put-parameter --name /coheus/db-host --value 'your-db-host' --type String"
  echo "  aws ssm put-parameter --name /coheus/db-name --value 'your-db-name' --type String"
  echo "  aws ssm put-parameter --name /coheus/db-user --value 'your-db-user' --type String"
  echo "  aws ssm put-parameter --name /coheus/db-password --value 'your-db-password' --type SecureString"
  echo "  aws ssm put-parameter --name /coheus/security-group-id --value 'sg-xxxxx' --type String"
  echo "  aws ssm put-parameter --name /coheus/subnet-id-1 --value 'subnet-xxxxx' --type String"
  echo "  aws ssm put-parameter --name /coheus/subnet-id-2 --value 'subnet-xxxxx' --type String"
  exit 1
fi

echo -e "${GREEN}✓ All parameters resolved${NC}"
echo ""

# Get deployment bucket name from stack (or create if doesn't exist)
echo "Checking for deployment bucket..."
DEPLOYMENT_BUCKET="coheus-lambda-deployments-$(aws sts get-caller-identity --query Account --output text)-${STAGE}"

if ! aws s3api head-bucket --bucket "${DEPLOYMENT_BUCKET}" 2>/dev/null; then
  echo "Creating deployment bucket: ${DEPLOYMENT_BUCKET}"
  aws s3 mb "s3://${DEPLOYMENT_BUCKET}" --region "${AWS_REGION}"
  aws s3api put-bucket-versioning \
    --bucket "${DEPLOYMENT_BUCKET}" \
    --versioning-configuration Status=Enabled
fi

echo -e "${GREEN}✓ Deployment bucket ready: ${DEPLOYMENT_BUCKET}${NC}"
echo ""

# Package Lambda functions
echo "========================================="
echo "Packaging Lambda Functions"
echo "========================================="

LAMBDA_DIRS=(
  "ailethia-briefing"
  "stripe-checkout"
  "stripe-webhook"
  "seed-demo-data"
  "gemini-tts"
  "gemini-live-voice"
  "aletheia-realtime"
  "maylin-realtime"
)

cd lambda

for LAMBDA_DIR in "${LAMBDA_DIRS[@]}"; do
  echo "Packaging ${LAMBDA_DIR}..."
  
  if [ ! -d "${LAMBDA_DIR}" ]; then
    echo -e "${RED}❌ Directory not found: ${LAMBDA_DIR}${NC}"
    exit 1
  fi
  
  # Install dependencies
  if [ -f "${LAMBDA_DIR}/package.json" ]; then
    echo "  Installing dependencies..."
    (cd "${LAMBDA_DIR}" && npm install --production 2>/dev/null || npm install)
  fi
  
  # Compile TypeScript if needed
  if [ -f "${LAMBDA_DIR}/tsconfig.json" ]; then
    echo "  Compiling TypeScript..."
    (cd "${LAMBDA_DIR}" && npx tsc || echo "  Warning: TypeScript compilation may have issues")
  fi
  
  # Create zip file
  ZIP_FILE="${LAMBDA_DIR}-${STAGE}.zip"
  echo "  Creating ${ZIP_FILE}..."
  
  # Include handler and shared files
  (cd "${LAMBDA_DIR}" && \
    zip -r "../${ZIP_FILE}" . \
      -x "*.ts" \
      -x "tsconfig.json" \
      -x "node_modules/@types/*" \
      -x "*.map" \
      -x ".DS_Store" 2>/dev/null || \
    (cd .. && zip -r "${ZIP_FILE}" "${LAMBDA_DIR}" \
      -x "*.ts" \
      -x "tsconfig.json" \
      -x "node_modules/@types/*" \
      -x "*.map" \
      -x ".DS_Store"))
  
  # Add shared directory
  if [ -d "shared" ]; then
    echo "  Adding shared files..."
    (cd shared && zip -r "../${ZIP_FILE}" . 2>/dev/null || true)
  fi
  
  # Upload to S3
  echo "  Uploading to S3..."
  aws s3 cp "${ZIP_FILE}" "s3://${DEPLOYMENT_BUCKET}/lambda/${ZIP_FILE}" --region "${AWS_REGION}"
  
  echo -e "${GREEN}  ✓ ${LAMBDA_DIR} packaged and uploaded${NC}"
  echo ""
done

cd ..

# Deploy CloudFormation stack
echo "========================================="
echo "Deploying CloudFormation Stack"
echo "========================================="

TEMPLATE_FILE="infrastructure/cloudformation/coheus_lambda_functions_stack.yaml"

if [ ! -f "${TEMPLATE_FILE}" ]; then
  echo -e "${RED}❌ Template file not found: ${TEMPLATE_FILE}${NC}"
  exit 1
fi

# Check if stack exists
STACK_EXISTS=$(aws cloudformation describe-stacks \
  --stack-name "${STACK_NAME}" \
  --region "${AWS_REGION}" \
  --query 'Stacks[0].StackStatus' \
  --output text 2>/dev/null || echo "NOT_FOUND")

if [[ "${STACK_EXISTS}" == "NOT_FOUND" ]]; then
  echo "Creating new stack..."
  aws cloudformation create-stack \
    --stack-name "${STACK_NAME}" \
    --template-body file://"${TEMPLATE_FILE}" \
    --parameters \
      ParameterKey=Stage,ParameterValue="${STAGE}" \
      ParameterKey=DBHost,ParameterValue="${DB_HOST}" \
      ParameterKey=DBName,ParameterValue="${DB_NAME}" \
      ParameterKey=DBUser,ParameterValue="${DB_USER}" \
      ParameterKey=DBPassword,ParameterValue="${DB_PASSWORD}" \
      ParameterKey=DBPort,ParameterValue=5432 \
      ParameterKey=SecurityGroupId,ParameterValue="${SECURITY_GROUP_ID}" \
      ParameterKey=SubnetId1,ParameterValue="${SUBNET_ID_1}" \
      ParameterKey=SubnetId2,ParameterValue="${SUBNET_ID_2}" \
      ParameterKey=KMSKeyId,ParameterValue="alias/coheus-encryption" \
    --capabilities CAPABILITY_NAMED_IAM \
    --region "${AWS_REGION}"
  
  echo "Waiting for stack creation..."
  aws cloudformation wait stack-create-complete \
    --stack-name "${STACK_NAME}" \
    --region "${AWS_REGION}"
else
  echo "Updating existing stack..."
  aws cloudformation update-stack \
    --stack-name "${STACK_NAME}" \
    --template-body file://"${TEMPLATE_FILE}" \
    --parameters \
      ParameterKey=Stage,ParameterValue="${STAGE}" \
      ParameterKey=DBHost,ParameterValue="${DB_HOST}" \
      ParameterKey=DBName,ParameterValue="${DB_NAME}" \
      ParameterKey=DBUser,ParameterValue="${DB_USER}" \
      ParameterKey=DBPassword,ParameterValue="${DB_PASSWORD}" \
      ParameterKey=DBPort,ParameterValue=5432 \
      ParameterKey=SecurityGroupId,ParameterValue="${SECURITY_GROUP_ID}" \
      ParameterKey=SubnetId1,ParameterValue="${SUBNET_ID_1}" \
      ParameterKey=SubnetId2,ParameterValue="${SUBNET_ID_2}" \
      ParameterKey=KMSKeyId,ParameterValue="alias/coheus-encryption" \
    --capabilities CAPABILITY_NAMED_IAM \
    --region "${AWS_REGION}" 2>&1 | tee /tmp/update-stack.log || {
      if grep -q "No updates are to be performed" /tmp/update-stack.log; then
        echo -e "${YELLOW}⚠ No updates needed${NC}"
      else
        echo -e "${RED}❌ Stack update failed${NC}"
        exit 1
      fi
    }
  
  if ! grep -q "No updates are to be performed" /tmp/update-stack.log; then
    echo "Waiting for stack update..."
    aws cloudformation wait stack-update-complete \
      --stack-name "${STACK_NAME}" \
      --region "${AWS_REGION}"
  fi
fi

echo ""
echo "========================================="
echo -e "${GREEN}✓ Deployment Complete!${NC}"
echo "========================================="

# Get stack outputs
echo ""
echo "Stack Outputs:"
aws cloudformation describe-stacks \
  --stack-name "${STACK_NAME}" \
  --region "${AWS_REGION}" \
  --query 'Stacks[0].Outputs' \
  --output table

