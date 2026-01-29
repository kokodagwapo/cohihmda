# Cohi AWS Deployment Runbook

This runbook provides step-by-step instructions for deploying Cohi to AWS. It covers both Multi-Tenant SaaS and Self-Hosted deployment modes.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Deployment Architecture Overview](#deployment-architecture-overview)
- [Multi-Tenant SaaS Deployment](#multi-tenant-saas-deployment)
- [Self-Hosted Deployment](#self-hosted-deployment)
- [Post-Deployment Configuration](#post-deployment-configuration)
- [Monitoring and Maintenance](#monitoring-and-maintenance)
- [Troubleshooting](#troubleshooting)
- [Rollback Procedures](#rollback-procedures)

---

## Prerequisites

### AWS Account Requirements

- [ ] AWS Account with administrative access
- [ ] AWS CLI installed and configured (`aws configure`)
- [ ] IAM permissions for CloudFormation, EC2, RDS, ECS, S3, CloudFront, KMS, Secrets Manager

### Tools Required

```bash
# Install AWS CLI (if not already installed)
# macOS
brew install awscli

# Windows (PowerShell)
msiexec.exe /i https://awscli.amazonaws.com/AWSCLIV2.msi

# Verify installation
aws --version
```

### DNS and SSL (Optional but Recommended)

- [ ] Domain name configured in Route 53 (or external DNS)
- [ ] ACM certificate in us-east-1 (required for CloudFront)
- [ ] ACM certificate in your deployment region (for ALB)

### Environment Variables

Create a file `deployment-vars.env` with your configuration:

```bash
# Common settings
export AWS_REGION=us-east-1
export PROJECT_NAME=coheus
export ENVIRONMENT=prod  # dev, staging, or prod

# Database settings
export DB_INSTANCE_CLASS=db.t3.small
export DB_PASSWORD="YourSecurePassword123!"  # Min 12 chars

# Application settings
export JWT_SECRET="your-32-character-minimum-secret-key-here"
export ADMIN_EMAIL="admin@yourcompany.com"

# Optional: Custom domain
export DOMAIN_NAME="app.yourcompany.com"
export CERTIFICATE_ARN="arn:aws:acm:us-east-1:xxx:certificate/xxx"
```

---

## Deployment Architecture Overview

### Multi-Tenant SaaS Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         MULTI-TENANT SaaS ARCHITECTURE                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   Internet                                                                   │
│       │                                                                      │
│       ▼                                                                      │
│   ┌─────────────┐                                                           │
│   │ CloudFront  │◄── WAF Rules                                              │
│   │   + WAF     │                                                           │
│   └──────┬──────┘                                                           │
│          │                                                                   │
│          ├─────────────── /api/* ──────────────┐                            │
│          │                                      │                            │
│          ▼                                      ▼                            │
│   ┌─────────────┐                       ┌─────────────┐                     │
│   │     S3      │                       │     ALB     │                     │
│   │  Frontend   │                       └──────┬──────┘                     │
│   └─────────────┘                              │                            │
│                                                ▼                            │
│                                         ┌─────────────┐                     │
│                                         │ ECS Fargate │                     │
│                                         │  (Backend)  │                     │
│                                         └──────┬──────┘                     │
│                                                │                            │
│                    ┌───────────────────────────┼───────────────────────┐    │
│                    │                           │                       │    │
│                    ▼                           ▼                       ▼    │
│             ┌─────────────┐            ┌─────────────┐         ┌───────────┐│
│             │  Management │            │   Tenant    │         │   Tenant  ││
│             │   Aurora    │            │  Aurora #1  │   ...   │  Aurora N ││
│             │  Cluster    │            │  Cluster    │         │  Cluster  ││
│             └─────────────┘            └─────────────┘         └───────────┘│
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Self-Hosted Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SELF-HOSTED ARCHITECTURE                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   Internet                                                                   │
│       │                                                                      │
│       ▼                                                                      │
│   ┌─────────────┐                                                           │
│   │ CloudFront  │                                                           │
│   └──────┬──────┘                                                           │
│          │                                                                   │
│          ├─────────────── /api/* ──────────────┐                            │
│          │                                      │                            │
│          ▼                                      ▼                            │
│   ┌─────────────┐                       ┌─────────────┐                     │
│   │     S3      │                       │     ALB     │                     │
│   │  Frontend   │                       └──────┬──────┘                     │
│   └─────────────┘                              │                            │
│                                                ▼                            │
│                                         ┌─────────────┐                     │
│                                         │ ECS Fargate │                     │
│                                         │  (Backend)  │                     │
│                                         └──────┬──────┘                     │
│                                                │                            │
│                                                ▼                            │
│                                         ┌─────────────┐                     │
│                                         │    RDS      │                     │
│                                         │ PostgreSQL  │                     │
│                                         └─────────────┘                     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Multi-Tenant SaaS Deployment

### Step 1: Deploy ECS Fargate Backend Infrastructure

```bash
# Load environment variables
source deployment-vars.env

# First, create an ECR repository and push your Docker image
aws ecr create-repository --repository-name ${PROJECT_NAME}-backend --region ${AWS_REGION}

# Login to ECR
aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com

# Build and push the Docker image
docker build -t ${PROJECT_NAME}-backend -f Dockerfile.backend .
docker tag ${PROJECT_NAME}-backend:latest ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${PROJECT_NAME}-backend:latest
docker push ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${PROJECT_NAME}-backend:latest

# Validate the ECS Fargate stack template
aws cloudformation validate-template \
  --template-body file://infrastructure/cloudformation/coheus_ecs_fargate_stack.yaml

# Deploy the ECS Fargate backend stack (creates VPC, RDS, ECS, ALB)
aws cloudformation create-stack \
  --stack-name ${PROJECT_NAME}-${ENVIRONMENT}-backend \
  --template-body file://infrastructure/cloudformation/coheus_ecs_fargate_stack.yaml \
  --parameters \
    ParameterKey=ProjectName,ParameterValue=${PROJECT_NAME} \
    ParameterKey=Environment,ParameterValue=${ENVIRONMENT} \
    ParameterKey=ContainerImage,ParameterValue=${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${PROJECT_NAME}-backend:latest \
    ParameterKey=ContainerCpu,ParameterValue=512 \
    ParameterKey=ContainerMemory,ParameterValue=1024 \
    ParameterKey=DesiredCount,ParameterValue=2 \
    ParameterKey=DatabaseInstanceClass,ParameterValue=${DB_INSTANCE_CLASS} \
    ParameterKey=JwtSecret,ParameterValue=${JWT_SECRET} \
    ParameterKey=FrontendUrl,ParameterValue=https://${DOMAIN_NAME} \
    ParameterKey=CertificateArn,ParameterValue=${CERTIFICATE_ARN} \
    ParameterKey=AlertEmail,ParameterValue=${ADMIN_EMAIL} \
  --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
  --tags Key=Project,Value=${PROJECT_NAME} Key=Environment,Value=${ENVIRONMENT}

# Wait for stack creation (15-20 minutes)
aws cloudformation wait stack-create-complete \
  --stack-name ${PROJECT_NAME}-${ENVIRONMENT}-backend

# Get stack outputs
aws cloudformation describe-stacks \
  --stack-name ${PROJECT_NAME}-${ENVIRONMENT}-backend \
  --query 'Stacks[0].Outputs' --output table
```

### Step 2: Deploy Aurora Serverless v2 Management Cluster

```bash
# Get VPC and subnet IDs from the backend stack
VPC_ID=$(aws cloudformation describe-stacks \
  --stack-name ${PROJECT_NAME}-${ENVIRONMENT}-backend \
  --query 'Stacks[0].Outputs[?OutputKey==`VPCId`].OutputValue' --output text)

PRIVATE_SUBNET_1=$(aws cloudformation describe-stacks \
  --stack-name ${PROJECT_NAME}-${ENVIRONMENT}-backend \
  --query 'Stacks[0].Outputs[?OutputKey==`SubnetId1`].OutputValue' --output text)

PRIVATE_SUBNET_2=$(aws cloudformation describe-stacks \
  --stack-name ${PROJECT_NAME}-${ENVIRONMENT}-backend \
  --query 'Stacks[0].Outputs[?OutputKey==`SubnetId2`].OutputValue' --output text)

BACKEND_SG=$(aws cloudformation describe-stacks \
  --stack-name ${PROJECT_NAME}-${ENVIRONMENT}-backend \
  --query 'Stacks[0].Outputs[?OutputKey==`SecurityGroupId`].OutputValue' --output text)

# Deploy Management Aurora Cluster
aws cloudformation create-stack \
  --stack-name ${PROJECT_NAME}-${ENVIRONMENT}-aurora-management \
  --template-body file://infrastructure/cloudformation/coheus_aurora_cluster_stack.yaml \
  --parameters \
    ParameterKey=ProjectName,ParameterValue=${PROJECT_NAME} \
    ParameterKey=Environment,ParameterValue=${ENVIRONMENT} \
    ParameterKey=ClusterType,ParameterValue=management \
    ParameterKey=VPCId,ParameterValue=${VPC_ID} \
    ParameterKey=PrivateSubnet1,ParameterValue=${PRIVATE_SUBNET_1} \
    ParameterKey=PrivateSubnet2,ParameterValue=${PRIVATE_SUBNET_2} \
    ParameterKey=AllowedSecurityGroupId,ParameterValue=${BACKEND_SG} \
    ParameterKey=MinACU,ParameterValue=0.5 \
    ParameterKey=MaxACU,ParameterValue=4 \
  --capabilities CAPABILITY_IAM

# Wait for completion (10-15 minutes)
aws cloudformation wait stack-create-complete \
  --stack-name ${PROJECT_NAME}-${ENVIRONMENT}-aurora-management
```

### Step 3: Deploy First Tenant Aurora Cluster

```bash
# Deploy Tenant Cluster 001
aws cloudformation create-stack \
  --stack-name ${PROJECT_NAME}-${ENVIRONMENT}-aurora-tenant-001 \
  --template-body file://infrastructure/cloudformation/coheus_aurora_cluster_stack.yaml \
  --parameters \
    ParameterKey=ProjectName,ParameterValue=${PROJECT_NAME} \
    ParameterKey=Environment,ParameterValue=${ENVIRONMENT} \
    ParameterKey=ClusterType,ParameterValue=tenant \
    ParameterKey=ClusterIdentifier,ParameterValue=001 \
    ParameterKey=VPCId,ParameterValue=${VPC_ID} \
    ParameterKey=PrivateSubnet1,ParameterValue=${PRIVATE_SUBNET_1} \
    ParameterKey=PrivateSubnet2,ParameterValue=${PRIVATE_SUBNET_2} \
    ParameterKey=AllowedSecurityGroupId,ParameterValue=${BACKEND_SG} \
    ParameterKey=MinACU,ParameterValue=0.5 \
    ParameterKey=MaxACU,ParameterValue=8 \
  --capabilities CAPABILITY_IAM
```

### Step 4: Deploy WAF and CloudFront

```bash
# Create S3 bucket for frontend (if not using existing)
aws s3 mb s3://${PROJECT_NAME}-frontend-${AWS_ACCOUNT_ID} --region ${AWS_REGION}

# Deploy WAF + CloudFront stack (must be in us-east-1 for CloudFront)
aws cloudformation create-stack \
  --stack-name ${PROJECT_NAME}-${ENVIRONMENT}-waf-cloudfront \
  --template-body file://infrastructure/cloudformation/coheus_waf_cloudfront_stack.yaml \
  --parameters \
    ParameterKey=ProjectName,ParameterValue=${PROJECT_NAME} \
    ParameterKey=Environment,ParameterValue=${ENVIRONMENT} \
    ParameterKey=S3BucketName,ParameterValue=${PROJECT_NAME}-frontend-${AWS_ACCOUNT_ID} \
    ParameterKey=S3BucketRegionalDomainName,ParameterValue=${PROJECT_NAME}-frontend-${AWS_ACCOUNT_ID}.s3.${AWS_REGION}.amazonaws.com \
    ParameterKey=BackendOriginDomain,ParameterValue=${BACKEND_ENDPOINT} \
    ParameterKey=DomainName,ParameterValue=${DOMAIN_NAME} \
    ParameterKey=CertificateArn,ParameterValue=${CERTIFICATE_ARN} \
  --region us-east-1
```

### Step 5: Deploy Monitoring Stack

```bash
# Get RDS instance ID from backend stack
RDS_INSTANCE=$(aws cloudformation describe-stacks \
  --stack-name ${PROJECT_NAME}-${ENVIRONMENT}-backend \
  --query 'Stacks[0].Outputs[?OutputKey==`DatabaseEndpoint`].OutputValue' --output text | cut -d'.' -f1)

EB_ENVIRONMENT=$(aws cloudformation describe-stacks \
  --stack-name ${PROJECT_NAME}-${ENVIRONMENT}-backend \
  --query 'Stacks[0].Outputs[?OutputKey==`BackendEnvironmentName`].OutputValue' --output text)

# Deploy monitoring stack
aws cloudformation create-stack \
  --stack-name ${PROJECT_NAME}-${ENVIRONMENT}-monitoring \
  --template-body file://infrastructure/cloudformation/coheus_monitoring_stack.yaml \
  --parameters \
    ParameterKey=ProjectName,ParameterValue=${PROJECT_NAME} \
    ParameterKey=Environment,ParameterValue=${ENVIRONMENT} \
    ParameterKey=EBEnvironmentName,ParameterValue=${EB_ENVIRONMENT} \
    ParameterKey=RDSInstanceIdentifier,ParameterValue=${RDS_INSTANCE} \
    ParameterKey=AlertEmail,ParameterValue=${ADMIN_EMAIL}
```

### Step 6: Deploy Tenant Provisioning Stack

```bash
# Get management DB details
MGMT_SECRET_ARN=$(aws cloudformation describe-stacks \
  --stack-name ${PROJECT_NAME}-${ENVIRONMENT}-aurora-management \
  --query 'Stacks[0].Outputs[?OutputKey==`SecretArn`].OutputValue' --output text)

MGMT_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name ${PROJECT_NAME}-${ENVIRONMENT}-aurora-management \
  --query 'Stacks[0].Outputs[?OutputKey==`ClusterEndpoint`].OutputValue' --output text)

MGMT_SG=$(aws cloudformation describe-stacks \
  --stack-name ${PROJECT_NAME}-${ENVIRONMENT}-aurora-management \
  --query 'Stacks[0].Outputs[?OutputKey==`SecurityGroupId`].OutputValue' --output text)

KMS_KEY_ARN=$(aws cloudformation describe-stacks \
  --stack-name ${PROJECT_NAME}-${ENVIRONMENT}-aurora-management \
  --query 'Stacks[0].Outputs[?OutputKey==`KMSKeyArn`].OutputValue' --output text)

# Deploy tenant provisioning stack
aws cloudformation create-stack \
  --stack-name ${PROJECT_NAME}-${ENVIRONMENT}-tenant-provisioning \
  --template-body file://infrastructure/cloudformation/coheus_tenant_provisioning_stack.yaml \
  --parameters \
    ParameterKey=ProjectName,ParameterValue=${PROJECT_NAME} \
    ParameterKey=Environment,ParameterValue=${ENVIRONMENT} \
    ParameterKey=VPCId,ParameterValue=${VPC_ID} \
    ParameterKey=PrivateSubnet1,ParameterValue=${PRIVATE_SUBNET_1} \
    ParameterKey=PrivateSubnet2,ParameterValue=${PRIVATE_SUBNET_2} \
    ParameterKey=ManagementDBSecretArn,ParameterValue=${MGMT_SECRET_ARN} \
    ParameterKey=ManagementDBEndpoint,ParameterValue=${MGMT_ENDPOINT} \
    ParameterKey=ManagementDBSecurityGroupId,ParameterValue=${MGMT_SG} \
    ParameterKey=KMSKeyArn,ParameterValue=${KMS_KEY_ARN} \
  --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM
```

### Step 7: Build and Deploy Application

```bash
# Build frontend
cd /path/to/cohi
npm install
npm run build

# Upload frontend to S3
aws s3 sync docs/ s3://${PROJECT_NAME}-frontend-${AWS_ACCOUNT_ID}/ \
  --delete \
  --cache-control "max-age=31536000,public" \
  --exclude "index.html"

aws s3 cp docs/index.html s3://${PROJECT_NAME}-frontend-${AWS_ACCOUNT_ID}/index.html \
  --cache-control "no-cache,no-store,must-revalidate"

# Invalidate CloudFront cache
CF_DISTRIBUTION_ID=$(aws cloudformation describe-stacks \
  --stack-name ${PROJECT_NAME}-${ENVIRONMENT}-waf-cloudfront \
  --query 'Stacks[0].Outputs[?OutputKey==`CloudFrontDistributionId`].OutputValue' --output text \
  --region us-east-1)

aws cloudfront create-invalidation \
  --distribution-id ${CF_DISTRIBUTION_ID} \
  --paths "/*"

# Deploy backend (via CI/CD or manual)
# For Elastic Beanstalk, create and deploy application version
cd server
zip -r ../backend.zip . -x "node_modules/*" -x ".git/*"
cd ..

aws s3 cp backend.zip s3://${PROJECT_NAME}-deployments-${AWS_ACCOUNT_ID}/

aws elasticbeanstalk create-application-version \
  --application-name ${PROJECT_NAME}-backend \
  --version-label v$(date +%Y%m%d%H%M%S) \
  --source-bundle S3Bucket=${PROJECT_NAME}-deployments-${AWS_ACCOUNT_ID},S3Key=backend.zip

aws elasticbeanstalk update-environment \
  --environment-name ${PROJECT_NAME}-${ENVIRONMENT} \
  --version-label v$(date +%Y%m%d%H%M%S)
```

---

## Self-Hosted Deployment

### One-Command Deployment

```bash
# Load environment variables
source deployment-vars.env

# Deploy complete self-hosted stack
aws cloudformation create-stack \
  --stack-name cohi-self-hosted \
  --template-body file://infrastructure/cloudformation/marketplace/coheus-self-hosted.yaml \
  --parameters \
    ParameterKey=AdminEmail,ParameterValue=${ADMIN_EMAIL} \
    ParameterKey=AdminPassword,ParameterValue="YourSecureAdminPassword123!" \
    ParameterKey=CompanyName,ParameterValue="Your Company" \
    ParameterKey=AvailabilityZone1,ParameterValue=${AWS_REGION}a \
    ParameterKey=AvailabilityZone2,ParameterValue=${AWS_REGION}b \
    ParameterKey=DatabaseInstanceClass,ParameterValue=db.t3.small \
    ParameterKey=ContainerCpu,ParameterValue=512 \
    ParameterKey=ContainerMemory,ParameterValue=1024 \
    ParameterKey=DomainName,ParameterValue=${DOMAIN_NAME} \
    ParameterKey=CertificateArn,ParameterValue=${CERTIFICATE_ARN} \
  --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
  --tags Key=Project,Value=cohi Key=Environment,Value=self-hosted

# Wait for completion (20-30 minutes)
aws cloudformation wait stack-create-complete --stack-name cohi-self-hosted

# Get outputs
aws cloudformation describe-stacks \
  --stack-name cohi-self-hosted \
  --query 'Stacks[0].Outputs' --output table
```

---

## Post-Deployment Configuration

### 1. Verify Deployment Health

```bash
# Check stack status
aws cloudformation describe-stacks \
  --stack-name ${PROJECT_NAME}-${ENVIRONMENT}-backend \
  --query 'Stacks[0].StackStatus'

# Test health endpoint
curl https://${DOMAIN_NAME}/health

# Check CloudWatch logs
aws logs tail /aws/elasticbeanstalk/${PROJECT_NAME}-${ENVIRONMENT}/app --follow
```

### 2. Create Initial Admin User

The admin user is created automatically during deployment. Verify access:

1. Navigate to `https://${DOMAIN_NAME}`
2. Login with the admin email and password provided
3. Complete the initial setup wizard

### 3. Configure LOS Connection

1. Go to **Admin** > **LOS Settings**
2. Click **Add Connection**
3. Select your LOS type (Encompass, MeridianLink, etc.)
4. Enter credentials and test the connection
5. Configure sync schedule

### 4. Subscribe to Alerts

```bash
# Get SNS topic ARN
ALERTS_TOPIC=$(aws cloudformation describe-stacks \
  --stack-name ${PROJECT_NAME}-${ENVIRONMENT}-monitoring \
  --query 'Stacks[0].Outputs[?OutputKey==`CriticalAlertsTopicArn`].OutputValue' --output text)

# Subscribe email
aws sns subscribe \
  --topic-arn ${ALERTS_TOPIC} \
  --protocol email \
  --notification-endpoint your-ops-team@company.com

# Subscribe Slack webhook (optional)
# aws sns subscribe \
#   --topic-arn ${ALERTS_TOPIC} \
#   --protocol https \
#   --notification-endpoint https://hooks.slack.com/services/xxx
```

---

## Monitoring and Maintenance

### CloudWatch Dashboard

Access the monitoring dashboard:

```
https://${AWS_REGION}.console.aws.amazon.com/cloudwatch/home?region=${AWS_REGION}#dashboards:name=${PROJECT_NAME}-${ENVIRONMENT}-dashboard
```

### Key Metrics to Monitor

| Metric | Warning Threshold | Critical Threshold |
|--------|-------------------|-------------------|
| CPU Utilization | > 70% | > 90% |
| Memory Utilization | > 75% | > 90% |
| Database Connections | > 70% of max | > 90% of max |
| API Response Time (P99) | > 2s | > 5s |
| 5xx Error Rate | > 1% | > 5% |
| Database Storage | < 20% free | < 10% free |

### Backup Verification

```bash
# List RDS snapshots
aws rds describe-db-snapshots \
  --db-instance-identifier ${PROJECT_NAME}-${ENVIRONMENT}-db \
  --query 'DBSnapshots[*].[DBSnapshotIdentifier,SnapshotCreateTime,Status]' \
  --output table

# Create manual snapshot
aws rds create-db-snapshot \
  --db-instance-identifier ${PROJECT_NAME}-${ENVIRONMENT}-db \
  --db-snapshot-identifier ${PROJECT_NAME}-manual-$(date +%Y%m%d)
```

### Scaling

```bash
# Scale ECS service
aws ecs update-service \
  --cluster ${PROJECT_NAME}-${ENVIRONMENT} \
  --service ${PROJECT_NAME}-backend \
  --desired-count 3

# Scale database (requires modification)
aws rds modify-db-instance \
  --db-instance-identifier ${PROJECT_NAME}-${ENVIRONMENT}-db \
  --db-instance-class db.t3.medium \
  --apply-immediately
```

---

## Troubleshooting

### Common Issues

#### 1. Health Check Failing

```bash
# Check ECS task status
aws ecs describe-tasks \
  --cluster ${PROJECT_NAME}-${ENVIRONMENT} \
  --tasks $(aws ecs list-tasks --cluster ${PROJECT_NAME}-${ENVIRONMENT} --query 'taskArns[0]' --output text)

# Check container logs
aws logs tail /ecs/${PROJECT_NAME}-${ENVIRONMENT} --follow
```

#### 2. Database Connection Issues

```bash
# Check security group rules
aws ec2 describe-security-groups \
  --group-ids ${DB_SECURITY_GROUP} \
  --query 'SecurityGroups[0].IpPermissionsIngress'

# Test connectivity from bastion (if available)
psql -h ${DB_ENDPOINT} -U coheusadmin -d coheus -c "SELECT 1"
```

#### 3. CloudFront 403 Errors

```bash
# Check S3 bucket policy
aws s3api get-bucket-policy --bucket ${FRONTEND_BUCKET}

# Check OAC configuration
aws cloudfront get-distribution \
  --id ${CF_DISTRIBUTION_ID} \
  --query 'Distribution.DistributionConfig.Origins.Items[0].OriginAccessControlId'
```

#### 4. SSL Certificate Issues

```bash
# Check certificate status
aws acm describe-certificate \
  --certificate-arn ${CERTIFICATE_ARN} \
  --query 'Certificate.[Status,DomainValidationOptions[*].ValidationStatus]'
```

---

## Rollback Procedures

### Rollback Application Version

```bash
# List application versions
aws elasticbeanstalk describe-application-versions \
  --application-name ${PROJECT_NAME}-backend \
  --query 'ApplicationVersions[*].[VersionLabel,DateCreated]' \
  --output table

# Rollback to previous version
aws elasticbeanstalk update-environment \
  --environment-name ${PROJECT_NAME}-${ENVIRONMENT} \
  --version-label v20260128120000  # Previous version
```

### Rollback CloudFormation Stack

```bash
# View stack events
aws cloudformation describe-stack-events \
  --stack-name ${PROJECT_NAME}-${ENVIRONMENT}-backend \
  --query 'StackEvents[*].[Timestamp,LogicalResourceId,ResourceStatus,ResourceStatusReason]' \
  --output table

# Rollback to previous state (if update failed)
aws cloudformation cancel-update-stack \
  --stack-name ${PROJECT_NAME}-${ENVIRONMENT}-backend
```

### Database Point-in-Time Recovery

```bash
# Restore to specific point in time
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier ${PROJECT_NAME}-${ENVIRONMENT}-db \
  --target-db-instance-identifier ${PROJECT_NAME}-${ENVIRONMENT}-db-restored \
  --restore-time 2026-01-29T10:00:00Z

# After verification, rename databases
aws rds modify-db-instance \
  --db-instance-identifier ${PROJECT_NAME}-${ENVIRONMENT}-db \
  --new-db-instance-identifier ${PROJECT_NAME}-${ENVIRONMENT}-db-old

aws rds modify-db-instance \
  --db-instance-identifier ${PROJECT_NAME}-${ENVIRONMENT}-db-restored \
  --new-db-instance-identifier ${PROJECT_NAME}-${ENVIRONMENT}-db
```

---

## Stack Dependencies

Deploy stacks in this order:

1. `coheus_backend_elastic_beanstalk_stack.yaml` - Core infrastructure
2. `coheus_aurora_cluster_stack.yaml` (management) - Management database
3. `coheus_aurora_cluster_stack.yaml` (tenant) - Tenant database clusters
4. `coheus_waf_cloudfront_stack.yaml` - WAF and CDN
5. `coheus_monitoring_stack.yaml` - Monitoring and alarms
6. `coheus_tenant_provisioning_stack.yaml` - Automation

---

## Quick Reference

### Stack Names

| Stack | Name Pattern |
|-------|--------------|
| Backend | `${PROJECT_NAME}-${ENVIRONMENT}-backend` |
| Aurora Management | `${PROJECT_NAME}-${ENVIRONMENT}-aurora-management` |
| Aurora Tenant | `${PROJECT_NAME}-${ENVIRONMENT}-aurora-tenant-{NNN}` |
| WAF/CloudFront | `${PROJECT_NAME}-${ENVIRONMENT}-waf-cloudfront` |
| Monitoring | `${PROJECT_NAME}-${ENVIRONMENT}-monitoring` |
| Tenant Provisioning | `${PROJECT_NAME}-${ENVIRONMENT}-tenant-provisioning` |

### Important Outputs

```bash
# Get all outputs from a stack
aws cloudformation describe-stacks \
  --stack-name ${STACK_NAME} \
  --query 'Stacks[0].Outputs' --output table
```

### Useful AWS Console Links

- CloudFormation: `https://${AWS_REGION}.console.aws.amazon.com/cloudformation`
- ECS: `https://${AWS_REGION}.console.aws.amazon.com/ecs`
- RDS: `https://${AWS_REGION}.console.aws.amazon.com/rds`
- CloudWatch: `https://${AWS_REGION}.console.aws.amazon.com/cloudwatch`
- S3: `https://s3.console.aws.amazon.com/s3`

---

## Support

For deployment issues:
- Documentation: https://docs.cohi.io
- Support: support@cohi.io
- GitHub Issues: https://github.com/cohi/cohi/issues
