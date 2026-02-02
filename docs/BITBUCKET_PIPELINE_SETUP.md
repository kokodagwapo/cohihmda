# Bitbucket Pipelines Setup Guide

This guide explains how to configure Bitbucket Pipelines for automated deployments to AWS.

## Overview

The pipeline supports two deployment environments:

- **dev** - Deployed automatically when code is merged to the `dev` branch
- **production** - Deployed when code is merged to the `main` branch (requires manual approval)

### Conditional Execution

The pipeline only runs steps for components that have changed:

| Component          | Triggers When Changed                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------- |
| **Frontend**       | `src/**`, `public/**`, `index.html`, `package.json`, `vite.config.ts`, `tailwind.config.ts` |
| **Backend**        | `server/**`, `Dockerfile.backend`, `Dockerfile.backend.prod`                                |
| **Infrastructure** | `infrastructure/cloudformation/**`                                                          |

This saves build minutes and speeds up deployments by only building/deploying what's necessary.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Bitbucket Pipelines                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   dev branch merge                        main branch merge                  │
│         │                                        │                           │
│         ▼                                        ▼                           │
│   ┌───────────┐                           ┌───────────┐                     │
│   │  Build    │                           │  Build    │                     │
│   │ Frontend  │                           │ Frontend  │                     │
│   │ Backend   │                           │ Backend   │                     │
│   └─────┬─────┘                           └─────┬─────┘                     │
│         │                                       │                           │
│         ▼                                       ▼                           │
│   ┌───────────────────┐                  ┌───────────────────┐             │
│   │  Deploy to Dev    │                  │ Deploy to Prod    │             │
│   │  (automatic)      │                  │ (manual approval) │             │
│   └───────────────────┘                  └───────────────────┘             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

                              AWS Infrastructure
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│   Frontend:                              Backend:                            │
│   ┌─────────────┐                       ┌─────────────┐                     │
│   │     S3      │ ◄── static assets     │     ECR     │ ◄── Docker image   │
│   └──────┬──────┘                       └──────┬──────┘                     │
│          │                                      │                            │
│          ▼                                      ▼                            │
│   ┌─────────────┐                       ┌─────────────┐                     │
│   │ CloudFront  │ ◄── CDN + HTTPS       │ ECS Fargate │ ◄── container      │
│   └─────────────┘                       └─────────────┘                     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Prerequisites

Before configuring the pipeline, ensure you have:

1. An AWS account with the following resources deployed:

   - S3 bucket for frontend hosting (per environment)
   - CloudFront distribution (per environment)
   - ECR repository for backend images
   - ECS cluster and service (per environment)

2. An IAM user or role with the following permissions:
   - S3: `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket`
   - CloudFront: `cloudfront:CreateInvalidation`
   - ECR: `ecr:GetAuthorizationToken`, `ecr:BatchCheckLayerAvailability`, `ecr:GetDownloadUrlForLayer`, `ecr:BatchGetImage`, `ecr:PutImage`, `ecr:InitiateLayerUpload`, `ecr:UploadLayerPart`, `ecr:CompleteLayerUpload`
   - ECS: `ecs:UpdateService`, `ecs:DescribeServices`, `ecs:DescribeClusters`
   - STS: `sts:GetCallerIdentity`

## Configuration Steps

### Step 1: Enable Pipelines

1. Go to your Bitbucket repository
2. Navigate to **Repository settings** → **Pipelines** → **Settings**
3. Enable Pipelines

### Step 2: Configure Repository Variables

Go to **Repository settings** → **Pipelines** → **Repository variables**

Add the following **secured** variables (these are shared across all environments):

| Variable                | Description            | Example     |
| ----------------------- | ---------------------- | ----------- |
| `AWS_ACCESS_KEY_ID`     | AWS IAM access key     | `AKIA...`   |
| `AWS_SECRET_ACCESS_KEY` | AWS IAM secret key     | `wJalr...`  |
| `AWS_DEFAULT_REGION`    | AWS region for ECS/ECR | `us-east-2` |

### Step 3: Configure Deployment Environments

Go to **Repository settings** → **Pipelines** → **Deployments**

#### Create "dev" Environment

1. Click **Add environment** or edit the existing "Test" environment
2. Rename to `dev`
3. Add the following deployment variables:

| Variable                     | Description                          | Example                                                    |
| ---------------------------- | ------------------------------------ | ---------------------------------------------------------- |
| `S3_BUCKET`                  | Frontend S3 bucket                   | `coheus-frontend-dev-123456789`                            |
| `CLOUDFRONT_DISTRIBUTION_ID` | CloudFront distribution ID           | `E1A2B3C4D5E6F7`                                           |
| `ECR_REPOSITORY_URI`         | Full ECR repository URI              | `123456789.dkr.ecr.us-east-2.amazonaws.com/coheus-backend` |
| `ECS_CLUSTER`                | ECS cluster name                     | `coheus-dev-cluster`                                       |
| `ECS_SERVICE`                | ECS service name                     | `coheus-dev-backend`                                       |
| `VITE_API_URL`               | Backend API URL (for frontend build) | `https://api-dev.coheus1.com`                              |

#### Create "production" Environment

1. Click **Add environment**
2. Name it `production`
3. **Important**: Enable **Required reviewers** for production deployments
4. Add the same variables as dev, but with production values:

| Variable                     | Description                          | Example                                                    |
| ---------------------------- | ------------------------------------ | ---------------------------------------------------------- |
| `S3_BUCKET`                  | Frontend S3 bucket                   | `coheus-frontend-prod-123456789`                           |
| `CLOUDFRONT_DISTRIBUTION_ID` | CloudFront distribution ID           | `E7F8G9H0I1J2K3`                                           |
| `ECR_REPOSITORY_URI`         | Full ECR repository URI              | `123456789.dkr.ecr.us-east-2.amazonaws.com/coheus-backend` |
| `ECS_CLUSTER`                | ECS cluster name                     | `coheus-prod-cluster`                                      |
| `ECS_SERVICE`                | ECS service name                     | `coheus-prod-backend`                                      |
| `VITE_API_URL`               | Backend API URL (for frontend build) | `https://api.coheus1.com`                                  |

### Step 4: Getting Your AWS Resource Values

#### S3 Bucket Name

```bash
# List all S3 buckets
aws s3 ls

# Look for buckets like: coheus-frontend-*
```

#### CloudFront Distribution ID

```bash
# List all CloudFront distributions
aws cloudfront list-distributions --query 'DistributionList.Items[*].[Id,DomainName,Origins.Items[0].DomainName]' --output table
```

#### ECR Repository URI

```bash
# List ECR repositories
aws ecr describe-repositories --query 'repositories[*].[repositoryUri,repositoryName]' --output table
```

#### ECS Cluster and Service Names

```bash
# List ECS clusters
aws ecs list-clusters

# List services in a cluster
aws ecs list-services --cluster YOUR_CLUSTER_NAME
```

## Pipeline Behavior

### Automatic Deployments

| Branch | Environment | Approval                 |
| ------ | ----------- | ------------------------ |
| `dev`  | dev         | Automatic                |
| `main` | production  | Manual approval required |

### Pull Requests

Pull requests to any branch will trigger a build (but not deploy), allowing you to verify the code compiles successfully.

### Custom Pipelines

You can manually trigger deployments using custom pipelines (these ignore the conditional execution rules):

1. Go to **Pipelines** → **Run pipeline**
2. Select the branch
3. Choose a custom pipeline:

| Pipeline              | Description                                             |
| --------------------- | ------------------------------------------------------- |
| `deploy-all-dev`      | Force full deployment to dev (frontend + backend)       |
| `deploy-all-prod`     | Force full deployment to production                     |
| `frontend-only-dev`   | Deploy only frontend to dev                             |
| `frontend-only-prod`  | Deploy only frontend to production                      |
| `backend-only-dev`    | Deploy only backend to dev                              |
| `backend-only-prod`   | Deploy only backend to production                       |
| `infrastructure-dev`  | Validate and notify about infrastructure changes (dev)  |
| `infrastructure-prod` | Validate and notify about infrastructure changes (prod) |

**Note**: Infrastructure deployments are intentionally manual. The pipeline validates CloudFormation templates and provides deployment instructions, but does not automatically apply changes.

## Troubleshooting

### Common Issues

#### 1. "S3 bucket does not exist"

**Error**: `S3 bucket 'xxx' does not exist or is not accessible`

**Solution**:

- Verify the `S3_BUCKET` variable is set correctly in deployment environment
- Check that the IAM user has `s3:ListBucket` permission on the bucket
- Ensure the bucket exists in the correct AWS account

#### 2. "Failed to authenticate with AWS"

**Error**: `Failed to authenticate with AWS`

**Solution**:

- Verify `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are set in repository variables
- Ensure the credentials are active and not expired
- Check that the IAM user has the required permissions

#### 3. "ECS cluster/service not found"

**Error**: `ECS cluster 'xxx' not found`

**Solution**:

- Verify the `ECS_CLUSTER` and `ECS_SERVICE` variables match your AWS resource names
- Ensure the `AWS_DEFAULT_REGION` matches where your ECS resources are deployed
- Check that the IAM user has `ecs:DescribeClusters` permission

#### 4. "Docker build failed"

**Error**: Build step fails during Docker image creation

**Solution**:

- Check that `Dockerfile.backend.prod` exists in the repository root
- Review the build logs for specific compilation errors
- Ensure the server's `package.json` has a valid `build` script

#### 5. "CloudFront invalidation failed"

**Error**: `Failed to create CloudFront invalidation`

**Solution**:

- Verify the `CLOUDFRONT_DISTRIBUTION_ID` is correct (13-14 alphanumeric characters)
- Check that the IAM user has `cloudfront:CreateInvalidation` permission
- Note: CloudFront operations always use `us-east-1` region

### Viewing Logs

1. Go to **Pipelines** in your repository
2. Click on the failed pipeline run
3. Expand the failed step to view detailed logs
4. Look for lines starting with `ERROR:` or `WARNING:`

### Manual Deployment Commands

If you need to deploy manually (outside of Bitbucket):

```bash
# Frontend deployment
export S3_BUCKET="your-bucket-name"
export CLOUDFRONT_DISTRIBUTION_ID="your-distribution-id"
export AWS_DEFAULT_REGION="us-east-2"
./scripts/bitbucket/deploy-frontend.sh

# Backend deployment
export ECR_REPOSITORY_URI="your-ecr-uri"
export ECS_CLUSTER="your-cluster"
export ECS_SERVICE="your-service"
export AWS_DEFAULT_REGION="us-east-2"
./scripts/bitbucket/deploy-backend-ecs.sh
```

## IAM Policy Example

Here's a minimal IAM policy for the deployment user:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "S3FrontendDeployment",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::coheus-frontend-*",
        "arn:aws:s3:::coheus-frontend-*/*"
      ]
    },
    {
      "Sid": "CloudFrontInvalidation",
      "Effect": "Allow",
      "Action": [
        "cloudfront:CreateInvalidation",
        "cloudfront:GetInvalidation",
        "cloudfront:ListInvalidations"
      ],
      "Resource": "*"
    },
    {
      "Sid": "ECRAccess",
      "Effect": "Allow",
      "Action": ["ecr:GetAuthorizationToken"],
      "Resource": "*"
    },
    {
      "Sid": "ECRRepositoryAccess",
      "Effect": "Allow",
      "Action": [
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "ecr:PutImage",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload"
      ],
      "Resource": "arn:aws:ecr:*:*:repository/coheus-*"
    },
    {
      "Sid": "ECSDeployment",
      "Effect": "Allow",
      "Action": [
        "ecs:UpdateService",
        "ecs:DescribeServices",
        "ecs:DescribeClusters",
        "ecs:ListServices"
      ],
      "Resource": "*"
    },
    {
      "Sid": "STSIdentity",
      "Effect": "Allow",
      "Action": ["sts:GetCallerIdentity"],
      "Resource": "*"
    }
  ]
}
```

## Security Best Practices

1. **Use secured variables** for all sensitive values (AWS credentials)
2. **Enable required reviewers** for production deployments
3. **Rotate AWS credentials** regularly
4. **Use least-privilege IAM policies** - only grant permissions needed for deployment
5. **Enable branch restrictions** to prevent direct pushes to `main`

## Monitoring Deployments

After a deployment:

1. **Frontend**: Visit your CloudFront URL to verify the new version
2. **Backend**: Check ECS service in AWS Console:
   - Go to ECS → Clusters → Your Cluster → Services → Your Service
   - Verify "Running count" matches "Desired count"
   - Check "Events" tab for deployment progress
3. **Health checks**: Verify the backend `/health` endpoint returns 200

## Related Documentation

- [AWS ECS Documentation](https://docs.aws.amazon.com/ecs/)
- [Bitbucket Pipelines Documentation](https://support.atlassian.com/bitbucket-cloud/docs/bitbucket-pipelines-configuration-reference/)
- [CloudFront Invalidation](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Invalidation.html)
