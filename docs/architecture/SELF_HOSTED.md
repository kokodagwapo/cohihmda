# Self-Hosted Deployment Guide

This document provides comprehensive guidance for deploying Cohi in self-hosted mode, where the application runs entirely within a customer's AWS account.

> **Naming Convention:**
> - **Cohi** - The new executive intelligence platform (this product)
> - **Coheus** - The legacy Qlik Sense-based product

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Deployment Options](#deployment-options)
- [Configuration](#configuration)
- [Installation Steps](#installation-steps)
- [Post-Deployment](#post-deployment)
- [Maintenance](#maintenance)
- [Troubleshooting](#troubleshooting)

---

## Overview

Self-hosted mode allows organizations to run Cohi entirely within their own AWS infrastructure. This deployment model provides:

- **Complete Data Control** - All data stays in your AWS account
- **Custom Configuration** - Full control over infrastructure settings
- **Compliance** - Meet data residency and regulatory requirements
- **Isolation** - No shared infrastructure with other organizations

### Self-Hosted vs SaaS Comparison

| Aspect | Self-Hosted | SaaS |
|--------|-------------|------|
| Data Location | Your AWS account | Coheus AWS account |
| Infrastructure | Customer-managed | Coheus-managed |
| Updates | Manual or scheduled | Automatic |
| Support | Documentation + support tickets | Full managed support |
| Cost | AWS costs + license | Subscription fee |
| Setup Time | 30-60 minutes | Immediate |

---

## Architecture

### Infrastructure Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     CUSTOMER'S AWS ACCOUNT                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                           VPC                                        │   │
│   │                                                                      │   │
│   │   ┌─────────────────────────────────────────────────────────────┐   │   │
│   │   │                    Public Subnets                            │   │   │
│   │   │                                                              │   │   │
│   │   │   ┌─────────────┐          ┌─────────────┐                  │   │   │
│   │   │   │     ALB     │          │  NAT Gateway │                  │   │   │
│   │   │   │  (HTTPS)    │          │             │                  │   │   │
│   │   │   └──────┬──────┘          └─────────────┘                  │   │   │
│   │   │          │                                                   │   │   │
│   │   └──────────┼───────────────────────────────────────────────────┘   │   │
│   │              │                                                       │   │
│   │   ┌──────────▼───────────────────────────────────────────────────┐   │   │
│   │   │                    Private Subnets                            │   │   │
│   │   │                                                              │   │   │
│   │   │   ┌─────────────┐          ┌─────────────┐                  │   │   │
│   │   │   │   EC2/ECS   │          │     RDS     │                  │   │   │
│   │   │   │  (Backend)  │ ────────►│ PostgreSQL  │                  │   │   │
│   │   │   │             │          │             │                  │   │   │
│   │   │   └─────────────┘          └─────────────┘                  │   │   │
│   │   │                                                              │   │   │
│   │   │   ┌─────────────┐          ┌─────────────┐                  │   │   │
│   │   │   │     S3      │          │   Secrets   │                  │   │   │
│   │   │   │  (Storage)  │          │   Manager   │                  │   │   │
│   │   │   │             │          │             │                  │   │   │
│   │   │   └─────────────┘          └─────────────┘                  │   │   │
│   │   │                                                              │   │   │
│   │   └──────────────────────────────────────────────────────────────┘   │   │
│   │                                                                      │   │
│   └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Component Overview

| Component | Service | Purpose |
|-----------|---------|---------|
| Load Balancer | Application Load Balancer | HTTPS termination, routing |
| Compute | EC2 (t3.medium) or ECS | Application server |
| Database | RDS PostgreSQL (db.t3.small) | Data storage |
| Storage | S3 | Document storage, backups |
| Secrets | Secrets Manager | Credential management |
| DNS | Route 53 (optional) | Custom domain |

### Estimated Monthly Costs

| Component | Instance Type | Estimated Cost |
|-----------|---------------|----------------|
| EC2 | t3.medium | ~$30/mo |
| RDS | db.t3.small | ~$25/mo |
| ALB | - | ~$20/mo |
| S3 | 50GB | ~$2/mo |
| NAT Gateway | - | ~$35/mo |
| **Total** | | **~$112/mo** |

*Note: Costs vary by region and usage patterns*

---

## Prerequisites

### AWS Account Requirements

- [ ] AWS Account with administrative access
- [ ] VPC with at least 2 availability zones
- [ ] IAM permissions to create EC2, RDS, ALB, S3, Secrets Manager resources
- [ ] SSL certificate in ACM (for HTTPS)

### Technical Requirements

- [ ] AWS CLI installed and configured
- [ ] Domain name (optional, but recommended)
- [ ] SSH key pair for EC2 access

### Network Requirements

| Port | Protocol | Source | Purpose |
|------|----------|--------|---------|
| 443 | HTTPS | 0.0.0.0/0 | Web traffic |
| 22 | SSH | Admin IP | Server access |
| 5432 | PostgreSQL | VPC CIDR | Database |

---

## Deployment Options

### Option 1: AWS Marketplace (Recommended)

Deploy via AWS Marketplace CloudFormation template:

1. Navigate to AWS Marketplace
2. Search for "Cohi"
3. Click "Continue to Subscribe"
4. Click "Continue to Configuration"
5. Select region and CloudFormation deployment
6. Fill in parameters and deploy

### Option 2: Manual CloudFormation

Deploy using the provided CloudFormation template:

```bash
aws cloudformation create-stack \
  --stack-name coheus-self-hosted \
  --template-body file://infrastructure/cloudformation/marketplace/coheus-self-hosted.yaml \
  --parameters \
    ParameterKey=InstanceType,ParameterValue=t3.medium \
    ParameterKey=DatabasePassword,ParameterValue=YourSecurePassword123! \
    ParameterKey=JwtSecret,ParameterValue=your-32-character-minimum-secret \
    ParameterKey=AdminEmail,ParameterValue=admin@yourcompany.com \
  --capabilities CAPABILITY_IAM
```

### Option 3: Terraform

Deploy using Terraform modules:

```hcl
module "coheus_self_hosted" {
  source = "github.com/coheus/terraform-aws-coheus//modules/self-hosted"
  
  environment      = "production"
  instance_type    = "t3.medium"
  db_instance_type = "db.t3.small"
  
  admin_email = "admin@yourcompany.com"
  domain_name = "coheus.yourcompany.com"  # Optional
}
```

---

## Configuration

### Environment Variables

The self-hosted deployment uses these environment variables:

```env
# Deployment Mode
DEPLOYMENT_MODE=self_hosted
MULTI_TENANT_ENABLED=false

# Database (set automatically from Secrets Manager)
DB_HOST=coheus-db.xxx.us-east-1.rds.amazonaws.com
DB_PORT=5432
DB_NAME=coheus
DB_USER=coheusadmin
DB_PASSWORD=<from-secrets-manager>
DB_SSL=true

# Authentication
JWT_SECRET=<from-secrets-manager>

# Application
NODE_ENV=production
PORT=3001
FRONTEND_URL=https://coheus.yourcompany.com

# Optional: AI Features
OPENAI_API_KEY=<optional>
GEMINI_API_KEY=<optional>

# Optional: Document Storage
S3_BUCKET=coheus-documents-xxx
AWS_REGION=us-east-1
```

### CloudFormation Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `InstanceType` | No | t3.medium | EC2 instance type |
| `DatabaseInstanceClass` | No | db.t3.small | RDS instance class |
| `DatabasePassword` | Yes | - | Database password |
| `JwtSecret` | Yes | - | JWT signing secret (32+ chars) |
| `AdminEmail` | Yes | - | Initial admin email |
| `VpcId` | No | New VPC | Existing VPC ID |
| `DomainName` | No | - | Custom domain name |
| `CertificateArn` | No | - | ACM certificate ARN |

---

## Installation Steps

### Step 1: Prepare AWS Account

```bash
# Verify AWS CLI is configured
aws sts get-caller-identity

# Create S3 bucket for CloudFormation templates (if needed)
aws s3 mb s3://coheus-deployment-${AWS_ACCOUNT_ID}
```

### Step 2: Deploy Stack

```bash
# Download CloudFormation template
curl -O https://coheus-releases.s3.amazonaws.com/cloudformation/coheus-self-hosted.yaml

# Validate template
aws cloudformation validate-template \
  --template-body file://coheus-self-hosted.yaml

# Create stack
aws cloudformation create-stack \
  --stack-name coheus-production \
  --template-body file://coheus-self-hosted.yaml \
  --parameters file://parameters.json \
  --capabilities CAPABILITY_IAM \
  --tags Key=Environment,Value=production

# Wait for completion
aws cloudformation wait stack-create-complete \
  --stack-name coheus-production

# Get outputs
aws cloudformation describe-stacks \
  --stack-name coheus-production \
  --query 'Stacks[0].Outputs'
```

### Step 3: Verify Deployment

```bash
# Get ALB DNS name from outputs
ALB_DNS=$(aws cloudformation describe-stacks \
  --stack-name coheus-production \
  --query 'Stacks[0].Outputs[?OutputKey==`LoadBalancerDNS`].OutputValue' \
  --output text)

# Check health endpoint
curl -k https://${ALB_DNS}/health

# Expected response:
# {"status":"healthy","timestamp":"..."}
```

### Step 4: Initial Setup

1. Navigate to `https://${ALB_DNS}` (or your custom domain)
2. Login with the admin email provided during setup
3. Set a secure password on first login
4. Configure SSO (optional) - see [SSO_AUTHENTICATION.md](../security/SSO_AUTHENTICATION.md)
5. Configure LOS connections in Admin panel
6. Import initial loan data

---

## Post-Deployment

### Configure Custom Domain

1. Create Route 53 hosted zone or use existing DNS
2. Add CNAME record pointing to ALB DNS
3. Update CloudFormation stack with domain name

```bash
aws cloudformation update-stack \
  --stack-name coheus-production \
  --use-previous-template \
  --parameters \
    ParameterKey=DomainName,ParameterValue=coheus.yourcompany.com \
    ParameterKey=CertificateArn,ParameterValue=arn:aws:acm:us-east-1:xxx:certificate/xxx
```

### Enable Backups

RDS automated backups are enabled by default with 7-day retention. For additional protection:

```bash
# Manual snapshot
aws rds create-db-snapshot \
  --db-instance-identifier coheus-production-db \
  --db-snapshot-identifier coheus-backup-$(date +%Y%m%d)
```

### Set Up Monitoring

CloudWatch alarms are created automatically. Configure notifications:

```bash
# Create SNS topic for alerts
aws sns create-topic --name coheus-alerts

# Subscribe email
aws sns subscribe \
  --topic-arn arn:aws:sns:us-east-1:xxx:coheus-alerts \
  --protocol email \
  --notification-endpoint alerts@yourcompany.com
```

---

## Maintenance

### Updating the Application

1. Download new CloudFormation template version
2. Review release notes for breaking changes
3. Update stack:

```bash
aws cloudformation update-stack \
  --stack-name coheus-production \
  --template-body file://coheus-self-hosted-v2.yaml \
  --parameters file://parameters.json \
  --capabilities CAPABILITY_IAM
```

### Database Maintenance

```bash
# Connect to RDS instance
psql -h ${DB_HOST} -U coheusadmin -d coheus

# Run maintenance queries
VACUUM ANALYZE;
REINDEX DATABASE coheus;
```

### Log Management

Logs are stored in CloudWatch Logs:

```bash
# View recent logs
aws logs tail /aws/ec2/coheus-production --follow

# Export logs to S3
aws logs create-export-task \
  --log-group-name /aws/ec2/coheus-production \
  --from $(date -d '7 days ago' +%s)000 \
  --to $(date +%s)000 \
  --destination coheus-logs-archive
```

---

## Troubleshooting

### Application Not Starting

```bash
# SSH to EC2 instance
ssh -i your-key.pem ec2-user@${EC2_IP}

# Check application logs
sudo journalctl -u coheus -f

# Check environment variables
sudo cat /opt/coheus/.env

# Restart application
sudo systemctl restart coheus
```

### Database Connection Issues

```bash
# Test database connectivity
psql -h ${DB_HOST} -U coheusadmin -d coheus -c "SELECT 1"

# Check security group rules
aws ec2 describe-security-groups \
  --group-ids ${DB_SECURITY_GROUP}
```

### ALB Health Check Failures

```bash
# Check target group health
aws elbv2 describe-target-health \
  --target-group-arn ${TARGET_GROUP_ARN}

# Check application is listening
curl localhost:3001/health
```

### Common Error Messages

| Error | Cause | Solution |
|-------|-------|----------|
| `ECONNREFUSED` | Database not reachable | Check security groups |
| `JWT_SECRET missing` | Environment not set | Verify Secrets Manager |
| `CORS error` | Frontend URL mismatch | Update FRONTEND_URL |
| `503 Service Unavailable` | Application crashed | Check EC2 logs |

---

## Security Recommendations

### Network Security

- [ ] Use private subnets for EC2 and RDS
- [ ] Enable VPC flow logs
- [ ] Use security groups with least privilege
- [ ] Enable AWS WAF (optional)

### Data Security

- [ ] Enable RDS encryption at rest
- [ ] Enable S3 bucket encryption
- [ ] Use Secrets Manager for all credentials
- [ ] Enable CloudTrail for audit logging

### Access Control

- [ ] Use IAM roles instead of access keys
- [ ] Enable MFA for AWS console access
- [ ] Review and rotate credentials regularly
- [ ] Implement least privilege IAM policies

---

## Support

### Self-Service Resources

- Documentation: https://docs.cohi.io
- Release Notes: https://docs.cohi.io/releases
- FAQ: https://docs.cohi.io/faq

### Contact Support

- Email: support@cohi.io
- Support Portal: https://support.cohi.io

---

## Related Documentation

### Architecture
- [OVERVIEW.md](./OVERVIEW.md) - System architecture overview
- [ADMIN_PANEL.md](./ADMIN_PANEL.md) - Admin panel architecture
- [CLIENT_ADMIN_REQUIREMENTS.md](./CLIENT_ADMIN_REQUIREMENTS.md) - Client admin features

### Security
- [SSO_AUTHENTICATION.md](../security/SSO_AUTHENTICATION.md) - SSO configuration (self-hosted options)
- [ROW_LEVEL_SECURITY.md](../security/ROW_LEVEL_SECURITY.md) - Custom field-based access control

### Deployment
- [AWS_MARKETPLACE.md](../deployment/AWS_MARKETPLACE.md) - Marketplace publishing details
- [TERRAFORM_MODULES.md](../deployment/TERRAFORM_MODULES.md) - Terraform deployment
