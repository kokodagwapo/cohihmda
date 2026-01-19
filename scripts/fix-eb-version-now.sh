#!/bin/bash

# Quick fix for Elastic Beanstalk version mismatch
# This script deploys the expected version to sync the environment

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Fix Elastic Beanstalk Version Mismatch${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Get environment details
read -p "Enter Elastic Beanstalk Application Name: " EB_APP_NAME
read -p "Enter Elastic Beanstalk Environment Name: " EB_ENV_NAME
read -p "Enter AWS Region (default: us-east-1): " AWS_REGION
AWS_REGION=${AWS_REGION:-us-east-1}

EXPECTED_VERSION="ci-dev-6d59572-20260111-234606"  # Deployment 24

echo ""
echo -e "${YELLOW}[1/3] Checking environment status...${NC}"

# Get environment info
ENV_INFO=$(aws elasticbeanstalk describe-environments \
  --environment-names "${EB_ENV_NAME}" \
  --region "${AWS_REGION}" \
  --query 'Environments[0]' \
  --output json)

if [ "$(echo "${ENV_INFO}" | jq -r '.Status // "null"')" == "null" ]; then
    echo -e "${RED}✗ Environment '${EB_ENV_NAME}' not found!${NC}"
    exit 1
fi

ENV_STATUS=$(echo "${ENV_INFO}" | jq -r '.Status')
CURRENT_VERSION=$(echo "${ENV_INFO}" | jq -r '.VersionLabel // "None"')

echo "  Status: ${ENV_STATUS}"
echo "  Current Version: ${CURRENT_VERSION}"
echo "  Expected Version: ${EXPECTED_VERSION}"
echo ""

echo -e "${YELLOW}[2/3] Verifying expected version exists...${NC}"

# Check if expected version exists
VERSION_EXISTS=$(aws elasticbeanstalk describe-application-versions \
  --application-name "${EB_APP_NAME}" \
  --version-labels "${EXPECTED_VERSION}" \
  --region "${AWS_REGION}" \
  --query 'ApplicationVersions[0].VersionLabel' \
  --output text 2>/dev/null || echo "None")

if [ "${VERSION_EXISTS}" != "${EXPECTED_VERSION}" ]; then
    echo -e "${RED}✗ Expected version '${EXPECTED_VERSION}' does not exist!${NC}"
    echo ""
    echo "Available versions:"
    aws elasticbeanstalk describe-application-versions \
      --application-name "${EB_APP_NAME}" \
      --region "${AWS_REGION}" \
      --max-items 10 \
      --query 'ApplicationVersions[*].[VersionLabel,DateCreated]' \
      --output table
    exit 1
fi

echo -e "${GREEN}✓ Expected version exists${NC}"
echo ""

echo -e "${YELLOW}[3/3] Deploying expected version to sync environment...${NC}"

# Deploy the expected version
if aws elasticbeanstalk update-environment \
  --environment-name "${EB_ENV_NAME}" \
  --version-label "${EXPECTED_VERSION}" \
  --region "${AWS_REGION}"; then
    echo ""
    echo -e "${GREEN}✓ Deployment initiated successfully${NC}"
    echo ""
    echo -e "${BLUE}Monitoring deployment progress...${NC}"
    echo "  This may take 5-15 minutes"
    echo ""
    
    # Monitor deployment
    TIMEOUT=900  # 15 minutes
    ELAPSED=0
    while [ $ELAPSED -lt $TIMEOUT ]; do
        sleep 15
        ELAPSED=$((ELAPSED + 15))
        
        STATUS=$(aws elasticbeanstalk describe-environments \
          --environment-names "${EB_ENV_NAME}" \
          --region "${AWS_REGION}" \
          --query 'Environments[0].Status' \
          --output text)
        
        HEALTH=$(aws elasticbeanstalk describe-environments \
          --environment-names "${EB_ENV_NAME}" \
          --region "${AWS_REGION}" \
          --query 'Environments[0].Health' \
          --output text)
        
        VERSION=$(aws elasticbeanstalk describe-environments \
          --environment-names "${EB_ENV_NAME}" \
          --region "${AWS_REGION}" \
          --query 'Environments[0].VersionLabel' \
          --output text)
        
        echo "  [${ELAPSED}s] Status: ${STATUS} | Health: ${HEALTH} | Version: ${VERSION}"
        
        if [ "${STATUS}" == "Ready" ] && [ "${VERSION}" == "${EXPECTED_VERSION}" ] && [ "${HEALTH}" == "Ok" ]; then
            echo ""
            echo -e "${GREEN}✓ Deployment completed successfully!${NC}"
            echo -e "${GREEN}✓ Environment is healthy and synced to expected version${NC}"
            exit 0
        fi
        
        if [ "${STATUS}" == "Ready" ] && [ "${VERSION}" == "${EXPECTED_VERSION}" ]; then
            echo ""
            echo -e "${YELLOW}⚠ Environment is Ready with correct version, but health is: ${HEALTH}${NC}"
            echo "  Check the environment logs for any issues"
            break
        fi
    done
    
    if [ $ELAPSED -ge $TIMEOUT ]; then
        echo ""
        echo -e "${YELLOW}⚠ Timeout reached. Check deployment status in AWS Console${NC}"
        echo "  https://console.aws.amazon.com/elasticbeanstalk/home?region=${AWS_REGION}#/environments"
    fi
else
    echo -e "${RED}✗ Failed to initiate deployment${NC}"
    exit 1
fi

echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Script completed${NC}"
echo -e "${BLUE}========================================${NC}"
