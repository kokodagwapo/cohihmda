# Coheus CloudFormation Deployment Scripts

PowerShell scripts for deploying Coheus Multi-Tenant SaaS to AWS.

## Architecture

```
Aurora Serverless v2 (database) → ECS Fargate (compute) → WAF/CloudFront (frontend)
```

## Prerequisites

1. **AWS CLI** installed and configured
2. **Docker** installed (for building backend image)
3. **PowerShell** 5.1+ (Windows) or PowerShell Core (cross-platform)

## Regions

- **Aurora, ECS, ALB, VPC** use the region in `config.ps1` (e.g. **us-east-2**).
- **WAF + CloudFront** is deployed in **us-east-1** only. AWS requires WAF (when used with CloudFront) to be in us-east-1. This is normal: CloudFront is global and the origin is your ALB URL, so your backend in us-east-2 works as the origin.

## HTTPS and certificates

- **User → CloudFront:** Always HTTPS (CloudFront default cert or your custom domain cert in us-east-1).
- **CloudFront → ALB:** Default is **HTTP** (port 80) so it works without an ALB certificate. For **full TLS** (CloudFront → ALB over HTTPS), you need an ACM cert on the ALB and a custom API domain; then set `BackendOriginProtocol` to **https-only** in the WAF stack.
- Full explanation: **[docs/deployment/HTTPS_AND_CERTIFICATES.md](../../docs/deployment/HTTPS_AND_CERTIFICATES.md)**.
- **coheus1.com subdomains** (cohi-dev.coheus1.com / cohi.coheus1.com): **[docs/deployment/COHEUS1_DOMAIN_SETUP.md](../../docs/deployment/COHEUS1_DOMAIN_SETUP.md)**.

## Quick Start

### 1. Configure Deployment

Edit `config.ps1` and update:

```powershell
$PROJECT_NAME = "coheus"
$ENVIRONMENT = "dev"           # dev, staging, or prod
$DOMAIN_NAME = ""              # Your custom domain (optional)
$CERTIFICATE_ARN = ""          # ACM certificate ARN (optional)
$ALERT_EMAIL = ""              # Email for alerts (optional)
```

### 2. Deploy Everything

```powershell
cd scripts/deploy
.\deploy-all.ps1
```

This deploys all stacks in order:
1. **Aurora Serverless v2** (database - FIRST)
2. **ECS Fargate** (compute - connects to Aurora)
3. **WAF + CloudFront** (frontend CDN)
4. **Monitoring** (dashboard + alarms)
5. **Tenant Provisioning** (automation)

**Estimated time:** 30-45 minutes

### 3. Check Status

```powershell
.\status.ps1
```

## Individual Stack Deployment

Deploy stacks one at a time (must follow order):

```powershell
# Step 1: Deploy Aurora clusters FIRST
.\01-deploy-aurora.ps1 -ClusterType both

# Step 2: Deploy ECS backend (requires Aurora)
.\02-deploy-backend.ps1

# Step 3: Deploy WAF + CloudFront
.\03-deploy-waf-cloudfront.ps1

# Step 4: Deploy monitoring
.\04-deploy-monitoring.ps1

# Step 5: Deploy tenant provisioning
.\05-deploy-tenant-provisioning.ps1
```

## Script Options

### deploy-all.ps1

```powershell
.\deploy-all.ps1 [options]

Options:
  -SkipAurora         Skip Aurora cluster deployment
  -SkipBackend        Skip backend deployment
  -SkipWAF            Skip WAF/CloudFront deployment
  -SkipMonitoring     Skip monitoring deployment
  -SkipProvisioning   Skip tenant provisioning deployment
  -SkipDockerBuild    Skip Docker image build (use existing)
  -JwtSecret <string> Provide JWT secret (otherwise auto-generated)
```

### 01-deploy-aurora.ps1

```powershell
.\01-deploy-aurora.ps1 [options]

Options:
  -ClusterType <string>    management (default) or tenant
  -TenantClusterId <string> Tenant cluster ID for dedicated clusters (default: 001)
```

**Note:** Single cluster (management) is recommended for most deployments. All tenant databases
live in the same cluster. Use `-ClusterType tenant` only for premium/enterprise clients who
need dedicated infrastructure.

### 02-deploy-backend.ps1

```powershell
.\02-deploy-backend.ps1 [options]

Options:
  -SkipECR            Skip ECR repository creation
  -SkipBuild          Skip Docker build and push
  -JwtSecret <string> Provide JWT secret
```

## Stack Dependencies

```
┌─────────────────────────────────────────┐
│      01-deploy-aurora (Step 1)          │
│  Aurora Serverless v2 (Single Cluster)  │
│  - All tenant databases in one cluster  │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│      02-deploy-backend (Step 2)         │
│  ECS Fargate + ALB                      │
│  - Uses existing VPC (3vue-qlik-VPC)    │
│  - Connects to Aurora                   │
└─────────────────┬───────────────────────┘
                  │
    ┌─────────────┼─────────────┐
    │             │             │
    ▼             ▼             ▼
┌───────────┐ ┌───────────┐ ┌───────────┐
│    WAF/   │ │Monitoring │ │  Tenant   │
│CloudFront │ │           │ │Provisioning│
└───────────┘ └───────────┘ └───────────┘
```

## Environment Variables

The scripts use these environment variables (set in `config.ps1`):

| Variable | Description |
|----------|-------------|
| `AWS_PROFILE` | AWS CLI profile name |
| `AWS_REGION` | AWS region for deployment |
| `PROJECT_NAME` | Project name (default: coheus) |
| `ENVIRONMENT` | Environment (dev/staging/prod) |

## Outputs

After deployment, key outputs are displayed:

- **Backend API URL** - ALB endpoint
- **CloudFront URL** - Frontend CDN
- **Database Endpoint** - RDS connection string
- **Dashboard URL** - CloudWatch dashboard

## Destroy Stacks

To delete all resources:

```powershell
.\destroy.ps1

# Skip confirmation prompt
.\destroy.ps1 -Force

# Keep database snapshot
.\destroy.ps1 -KeepDatabase
```

**Warning:** This deletes all data!

## Troubleshooting

### Stack Creation Failed

1. Check CloudFormation console for error details
2. Look at stack events: 
   ```powershell
   aws cloudformation describe-stack-events --stack-name <stack-name> --profile DevEnvPerms-386503255187
   ```

### Docker Build Failed

1. Ensure Docker is running
2. Check Dockerfile.backend exists
3. Try manual build:
   ```powershell
   docker build -t coheus-backend -f Dockerfile.backend .
   ```

### Frontend shows "server unavailable" or 504 on /api/* or /health

1. **CloudFront → ALB protocol:** The WAF stack’s backend origin is set to **http-only** so CloudFront talks to the ALB on port 80. If your ALB has no HTTPS listener (no certificate), CloudFront must use HTTP to the origin; otherwise you get 504. After changing this in the template, run `.\03-deploy-waf-cloudfront.ps1` to update the stack.

2. **Backend not running:** 504 can also mean the ALB has no healthy targets (ECS tasks down or failing health checks). Check:
   ```powershell
   aws ecs describe-services --cluster coheus-dev-cluster --services coheus-dev-service --profile $env:AWS_PROFILE --region us-east-2 --query 'services[0].{running:runningCount,desired:desiredCount}'
   ```
   If running is 0, start the backend: `.\02-deploy-backend.ps1 -SkipBuild` (or full deploy). Then test the ALB directly: `curl http://<ALB_DNS>/health` (use ALB DNS from backend stack outputs).

### WAF/CloudFront: "S3 bucket already exists" on redeploy

The WAF/CloudFront stack includes a custom resource that **empties the frontend S3 bucket on stack delete**, so you can delete the stack and redeploy without manual steps. If you see "bucket already exists", it usually means the stack was deleted with an older template (before this was added). Empty and delete the bucket once, then redeploy:

```powershell
$Bucket = "coheus-frontend-339712788893"   # or $PROJECT_NAME-frontend-$AWS_ACCOUNT_ID from config
aws s3 rm "s3://$Bucket" --recursive --profile $env:AWS_PROFILE --region us-east-1
aws s3 rb "s3://$Bucket" --profile $env:AWS_PROFILE --region us-east-1
.\03-deploy-waf-cloudfront.ps1
```

### ECS Tasks Not Starting / Stack Update Stuck

When Phase 3 hangs at "Waiting for coheus-dev-backend (stack-update-complete)", CloudFormation is waiting for the ECS service to stabilize (tasks running and passing ALB health checks). If tasks keep failing, the update never completes.

**1. Check ECS service events** (most recent first):
```powershell
aws ecs describe-services --cluster coheus-dev-cluster --services coheus-dev-service --profile $env:AWS_PROFILE --region $env:AWS_REGION --query 'services[0].events[0:10]' --output table
```

**2. List tasks and their status**:
```powershell
aws ecs list-tasks --cluster coheus-dev-cluster --service-name coheus-dev-service --profile $env:AWS_PROFILE --region $env:AWS_REGION
aws ecs describe-tasks --cluster coheus-dev-cluster --tasks <task-arn-from-above> --profile $env:AWS_PROFILE --region $env:AWS_REGION --query 'tasks[0].{lastStatus:lastStatus,stopCode:stopCode,stoppedReason:stoppedReason,containers:containers[0].{exitCode:exitCode,reason:reason}}'
```

**3. Check container logs** (CloudWatch):
```powershell
aws logs tail /ecs/coheus-dev --since 30m --profile $env:AWS_PROFILE --region $env:AWS_REGION
```

**4. If the deployment is stuck**, you can cancel the waiter (Ctrl+C). The stack update will continue in the background. If the deployment circuit breaker triggers, the stack will roll back. After fixing the cause (e.g. JWT secret, health check, or missing env), run the deploy again.

### Permission Denied

Ensure your AWS profile has permissions for:
- CloudFormation
- EC2, ECS, RDS, S3
- IAM (for creating roles)
- Secrets Manager, KMS
- CloudWatch, SNS

## Cost Estimates

| Resource | Estimated Monthly Cost |
|----------|----------------------|
| ECS Fargate (2 tasks) | ~$30-50 |
| RDS PostgreSQL (db.t3.small) | ~$25-35 |
| Aurora Serverless v2 (0.5-4 ACU) | ~$40-100 |
| NAT Gateway | ~$30 |
| ALB | ~$20 |
| CloudFront | ~$10-50 (usage-based) |
| **Total** | **~$150-300/month** |

*Costs vary by region and usage.*
