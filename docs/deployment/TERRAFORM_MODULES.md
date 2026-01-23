# Terraform Module Specifications

This document specifies the Terraform modules for deploying Cohi infrastructure, supporting both multi-tenant SaaS and self-hosted deployment modes.

> **Naming Convention:**
> - **Cohi** - The new executive intelligence platform (this product)
> - **Coheus** - The legacy Qlik Sense-based product

## Table of Contents

- [Overview](#overview)
- [Directory Structure](#directory-structure)
- [Module Specifications](#module-specifications)
- [Deployment Configurations](#deployment-configurations)
- [Variables Reference](#variables-reference)
- [Outputs Reference](#outputs-reference)
- [Usage Examples](#usage-examples)
- [CI/CD Integration](#cicd-integration)

---

## Overview

The Terraform infrastructure is organized into reusable modules that can be composed for different deployment scenarios:

- **Multi-Tenant SaaS**: Full infrastructure with Aurora clusters, ECS, CloudFront
- **Self-Hosted**: Simplified single-tenant deployment
- **Development**: Minimal local-friendly configuration

### Design Principles

1. **Modularity**: Each component is a separate module
2. **Reusability**: Modules work across environments
3. **Flexibility**: Support both deployment modes
4. **Security**: Encryption, IAM least privilege, secrets management
5. **Cost Optimization**: Right-sized resources, auto-scaling

---

## Directory Structure

```
infrastructure/
├── terraform/
│   ├── modules/
│   │   ├── networking/
│   │   │   ├── vpc/
│   │   │   │   ├── main.tf
│   │   │   │   ├── variables.tf
│   │   │   │   ├── outputs.tf
│   │   │   │   └── README.md
│   │   │   ├── security-groups/
│   │   │   │   ├── main.tf
│   │   │   │   ├── variables.tf
│   │   │   │   └── outputs.tf
│   │   │   └── alb/
│   │   │       ├── main.tf
│   │   │       ├── variables.tf
│   │   │       └── outputs.tf
│   │   │
│   │   ├── database/
│   │   │   ├── aurora-serverless/
│   │   │   │   ├── main.tf
│   │   │   │   ├── variables.tf
│   │   │   │   └── outputs.tf
│   │   │   ├── rds-postgresql/
│   │   │   │   ├── main.tf
│   │   │   │   ├── variables.tf
│   │   │   │   └── outputs.tf
│   │   │   └── management-db/
│   │   │       ├── main.tf
│   │   │       ├── variables.tf
│   │   │       └── outputs.tf
│   │   │
│   │   ├── compute/
│   │   │   ├── ecs-fargate/
│   │   │   │   ├── main.tf
│   │   │   │   ├── variables.tf
│   │   │   │   ├── outputs.tf
│   │   │   │   └── task-definition.json.tpl
│   │   │   └── ec2-single/
│   │   │       ├── main.tf
│   │   │       ├── variables.tf
│   │   │       ├── outputs.tf
│   │   │       └── user-data.sh.tpl
│   │   │
│   │   ├── storage/
│   │   │   ├── s3/
│   │   │   │   ├── main.tf
│   │   │   │   ├── variables.tf
│   │   │   │   └── outputs.tf
│   │   │   └── elasticache/
│   │   │       ├── main.tf
│   │   │       ├── variables.tf
│   │   │       └── outputs.tf
│   │   │
│   │   ├── security/
│   │   │   ├── secrets-manager/
│   │   │   │   ├── main.tf
│   │   │   │   ├── variables.tf
│   │   │   │   └── outputs.tf
│   │   │   ├── kms/
│   │   │   │   ├── main.tf
│   │   │   │   ├── variables.tf
│   │   │   │   └── outputs.tf
│   │   │   ├── waf/
│   │   │   │   ├── main.tf
│   │   │   │   ├── variables.tf
│   │   │   │   └── outputs.tf
│   │   │   └── iam/
│   │   │       ├── main.tf
│   │   │       ├── variables.tf
│   │   │       └── outputs.tf
│   │   │
│   │   └── cdn/
│   │       └── cloudfront/
│   │           ├── main.tf
│   │           ├── variables.tf
│   │           └── outputs.tf
│   │
│   ├── deployments/
│   │   ├── saas/
│   │   │   ├── dev/
│   │   │   │   ├── main.tf
│   │   │   │   ├── variables.tf
│   │   │   │   ├── outputs.tf
│   │   │   │   ├── terraform.tfvars
│   │   │   │   └── backend.tf
│   │   │   ├── staging/
│   │   │   │   └── ...
│   │   │   └── prod/
│   │   │       └── ...
│   │   └── marketplace/
│   │       ├── main.tf
│   │       ├── variables.tf
│   │       └── outputs.tf
│   │
│   └── backend.tf.example
│
└── cloudformation/
    ├── marketplace/
    │   └── coheus-self-hosted.yaml
    └── legacy/
        └── (existing templates)
```

---

## Module Specifications

### Module: networking/vpc

Creates a VPC with public and private subnets across multiple availability zones.

```hcl
# modules/networking/vpc/main.tf

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name        = "${var.project_name}-${var.environment}-vpc"
    Environment = var.environment
    Project     = var.project_name
  }
}

resource "aws_subnet" "public" {
  count                   = length(var.availability_zones)
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 4, count.index)
  availability_zone       = var.availability_zones[count.index]
  map_public_ip_on_launch = true

  tags = {
    Name = "${var.project_name}-${var.environment}-public-${count.index + 1}"
    Type = "public"
  }
}

resource "aws_subnet" "private" {
  count             = length(var.availability_zones)
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 4, count.index + length(var.availability_zones))
  availability_zone = var.availability_zones[count.index]

  tags = {
    Name = "${var.project_name}-${var.environment}-private-${count.index + 1}"
    Type = "private"
  }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "${var.project_name}-${var.environment}-igw"
  }
}

resource "aws_nat_gateway" "main" {
  count         = var.enable_nat_gateway ? 1 : 0
  allocation_id = aws_eip.nat[0].id
  subnet_id     = aws_subnet.public[0].id

  tags = {
    Name = "${var.project_name}-${var.environment}-nat"
  }
}

resource "aws_eip" "nat" {
  count  = var.enable_nat_gateway ? 1 : 0
  domain = "vpc"

  tags = {
    Name = "${var.project_name}-${var.environment}-nat-eip"
  }
}
```

**Variables:**
```hcl
# modules/networking/vpc/variables.tf

variable "project_name" {
  description = "Project name for resource naming"
  type        = string
}

variable "environment" {
  description = "Environment (dev, staging, prod)"
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR block for VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "List of availability zones"
  type        = list(string)
}

variable "enable_nat_gateway" {
  description = "Enable NAT gateway for private subnets"
  type        = bool
  default     = true
}
```

**Outputs:**
```hcl
# modules/networking/vpc/outputs.tf

output "vpc_id" {
  description = "VPC ID"
  value       = aws_vpc.main.id
}

output "public_subnet_ids" {
  description = "Public subnet IDs"
  value       = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  description = "Private subnet IDs"
  value       = aws_subnet.private[*].id
}

output "vpc_cidr" {
  description = "VPC CIDR block"
  value       = aws_vpc.main.cidr_block
}
```

---

### Module: database/aurora-serverless

Creates Aurora Serverless v2 cluster for multi-tenant deployment.

```hcl
# modules/database/aurora-serverless/main.tf

resource "aws_rds_cluster" "main" {
  cluster_identifier     = "${var.project_name}-${var.environment}-${var.cluster_name}"
  engine                 = "aurora-postgresql"
  engine_mode            = "provisioned"
  engine_version         = var.engine_version
  database_name          = var.database_name
  master_username        = var.master_username
  master_password        = var.master_password
  
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [var.security_group_id]
  
  storage_encrypted      = true
  kms_key_id            = var.kms_key_arn
  
  backup_retention_period = var.backup_retention_days
  preferred_backup_window = "03:00-04:00"
  
  skip_final_snapshot    = var.environment != "prod"
  final_snapshot_identifier = var.environment == "prod" ? "${var.project_name}-${var.cluster_name}-final" : null

  serverlessv2_scaling_configuration {
    min_capacity = var.min_acu
    max_capacity = var.max_acu
  }

  tags = {
    Name        = "${var.project_name}-${var.environment}-${var.cluster_name}"
    Environment = var.environment
    Project     = var.project_name
    ClusterType = var.cluster_type
  }
}

resource "aws_rds_cluster_instance" "main" {
  count              = var.instance_count
  identifier         = "${var.project_name}-${var.environment}-${var.cluster_name}-${count.index + 1}"
  cluster_identifier = aws_rds_cluster.main.id
  instance_class     = "db.serverless"
  engine             = aws_rds_cluster.main.engine
  engine_version     = aws_rds_cluster.main.engine_version

  tags = {
    Name        = "${var.project_name}-${var.environment}-${var.cluster_name}-instance-${count.index + 1}"
    Environment = var.environment
  }
}

resource "aws_db_subnet_group" "main" {
  name       = "${var.project_name}-${var.environment}-${var.cluster_name}-subnet-group"
  subnet_ids = var.subnet_ids

  tags = {
    Name        = "${var.project_name}-${var.environment}-${var.cluster_name}-subnet-group"
    Environment = var.environment
  }
}
```

**Variables:**
```hcl
# modules/database/aurora-serverless/variables.tf

variable "project_name" {
  type = string
}

variable "environment" {
  type = string
}

variable "cluster_name" {
  description = "Name of the Aurora cluster (e.g., 'management', 'tenant-001')"
  type        = string
}

variable "cluster_type" {
  description = "Type of cluster: 'management' or 'tenant'"
  type        = string
  default     = "tenant"
}

variable "engine_version" {
  description = "Aurora PostgreSQL engine version"
  type        = string
  default     = "15.4"
}

variable "database_name" {
  description = "Name of the default database"
  type        = string
}

variable "master_username" {
  description = "Master username"
  type        = string
}

variable "master_password" {
  description = "Master password"
  type        = string
  sensitive   = true
}

variable "subnet_ids" {
  description = "Subnet IDs for the cluster"
  type        = list(string)
}

variable "security_group_id" {
  description = "Security group ID for the cluster"
  type        = string
}

variable "kms_key_arn" {
  description = "KMS key ARN for encryption"
  type        = string
}

variable "min_acu" {
  description = "Minimum Aurora Capacity Units"
  type        = number
  default     = 0.5
}

variable "max_acu" {
  description = "Maximum Aurora Capacity Units"
  type        = number
  default     = 8
}

variable "instance_count" {
  description = "Number of instances in the cluster"
  type        = number
  default     = 1
}

variable "backup_retention_days" {
  description = "Backup retention period in days"
  type        = number
  default     = 7
}
```

**Outputs:**
```hcl
# modules/database/aurora-serverless/outputs.tf

output "cluster_id" {
  value = aws_rds_cluster.main.id
}

output "cluster_arn" {
  value = aws_rds_cluster.main.arn
}

output "writer_endpoint" {
  value = aws_rds_cluster.main.endpoint
}

output "reader_endpoint" {
  value = aws_rds_cluster.main.reader_endpoint
}

output "port" {
  value = aws_rds_cluster.main.port
}

output "database_name" {
  value = aws_rds_cluster.main.database_name
}
```

---

### Module: compute/ecs-fargate

Creates ECS Fargate service for the backend application.

```hcl
# modules/compute/ecs-fargate/main.tf

resource "aws_ecs_cluster" "main" {
  name = "${var.project_name}-${var.environment}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = {
    Name        = "${var.project_name}-${var.environment}-cluster"
    Environment = var.environment
  }
}

resource "aws_ecs_task_definition" "main" {
  family                   = "${var.project_name}-${var.environment}-backend"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = var.execution_role_arn
  task_role_arn            = var.task_role_arn

  container_definitions = templatefile("${path.module}/task-definition.json.tpl", {
    name           = "${var.project_name}-backend"
    image          = var.container_image
    cpu            = var.cpu
    memory         = var.memory
    port           = var.container_port
    environment    = var.environment_variables
    secrets        = var.secrets
    log_group      = aws_cloudwatch_log_group.main.name
    region         = var.region
  })

  tags = {
    Name        = "${var.project_name}-${var.environment}-task"
    Environment = var.environment
  }
}

resource "aws_ecs_service" "main" {
  name            = "${var.project_name}-${var.environment}-service"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.main.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = [var.security_group_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = var.target_group_arn
    container_name   = "${var.project_name}-backend"
    container_port   = var.container_port
  }

  deployment_configuration {
    maximum_percent         = 200
    minimum_healthy_percent = 100
  }

  tags = {
    Name        = "${var.project_name}-${var.environment}-service"
    Environment = var.environment
  }

  lifecycle {
    ignore_changes = [desired_count]  # Allow auto-scaling to manage
  }
}

# Auto Scaling
resource "aws_appautoscaling_target" "main" {
  max_capacity       = var.max_count
  min_capacity       = var.min_count
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.main.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "cpu" {
  name               = "${var.project_name}-${var.environment}-cpu-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.main.resource_id
  scalable_dimension = aws_appautoscaling_target.main.scalable_dimension
  service_namespace  = aws_appautoscaling_target.main.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = 70
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}

resource "aws_cloudwatch_log_group" "main" {
  name              = "/ecs/${var.project_name}-${var.environment}"
  retention_in_days = var.log_retention_days

  tags = {
    Environment = var.environment
  }
}
```

---

### Module: security/waf

Creates WAF rules for CloudFront.

```hcl
# modules/security/waf/main.tf

resource "aws_wafv2_web_acl" "main" {
  name        = "${var.project_name}-${var.environment}-waf"
  description = "WAF for ${var.project_name} ${var.environment}"
  scope       = "CLOUDFRONT"

  default_action {
    allow {}
  }

  # AWS Managed Rules - Common Rule Set
  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 1

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "AWSManagedRulesCommonRuleSetMetric"
      sampled_requests_enabled   = true
    }
  }

  # AWS Managed Rules - Known Bad Inputs
  rule {
    name     = "AWSManagedRulesKnownBadInputsRuleSet"
    priority = 2

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "AWSManagedRulesKnownBadInputsRuleSetMetric"
      sampled_requests_enabled   = true
    }
  }

  # AWS Managed Rules - SQL Injection
  rule {
    name     = "AWSManagedRulesSQLiRuleSet"
    priority = 3

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesSQLiRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "AWSManagedRulesSQLiRuleSetMetric"
      sampled_requests_enabled   = true
    }
  }

  # Rate Limiting
  rule {
    name     = "RateLimitRule"
    priority = 4

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = var.rate_limit
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "RateLimitRuleMetric"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.project_name}-${var.environment}-waf"
    sampled_requests_enabled   = true
  }

  tags = {
    Name        = "${var.project_name}-${var.environment}-waf"
    Environment = var.environment
  }
}
```

---

## Deployment Configurations

### Multi-Tenant SaaS (Production)

```hcl
# deployments/saas/prod/main.tf

terraform {
  required_version = ">= 1.5.0"
  
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket         = "coheus-terraform-state"
    key            = "saas/prod/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "coheus-terraform-locks"
  }
}

provider "aws" {
  region = var.region
  
  default_tags {
    tags = {
      Project     = "coheus"
      Environment = "prod"
      ManagedBy   = "terraform"
    }
  }
}

# KMS Key for encryption
module "kms" {
  source       = "../../../modules/security/kms"
  project_name = var.project_name
  environment  = var.environment
}

# VPC
module "vpc" {
  source             = "../../../modules/networking/vpc"
  project_name       = var.project_name
  environment        = var.environment
  vpc_cidr           = "10.0.0.0/16"
  availability_zones = ["us-east-1a", "us-east-1b"]
  enable_nat_gateway = true
}

# Security Groups
module "security_groups" {
  source       = "../../../modules/networking/security-groups"
  project_name = var.project_name
  environment  = var.environment
  vpc_id       = module.vpc.vpc_id
  vpc_cidr     = module.vpc.vpc_cidr
}

# Secrets Manager
module "secrets" {
  source       = "../../../modules/security/secrets-manager"
  project_name = var.project_name
  environment  = var.environment
  kms_key_arn  = module.kms.key_arn
  
  secrets = {
    database_password = var.database_password
    jwt_secret        = var.jwt_secret
  }
}

# Management Database (Aurora Serverless v2)
module "management_db" {
  source            = "../../../modules/database/aurora-serverless"
  project_name      = var.project_name
  environment       = var.environment
  cluster_name      = "management"
  cluster_type      = "management"
  database_name     = "coheus_management"
  master_username   = "coheusadmin"
  master_password   = var.database_password
  subnet_ids        = module.vpc.private_subnet_ids
  security_group_id = module.security_groups.database_sg_id
  kms_key_arn       = module.kms.key_arn
  min_acu           = 0.5
  max_acu           = 4
}

# Tenant Cluster 1 (Aurora Serverless v2)
module "tenant_cluster_001" {
  source            = "../../../modules/database/aurora-serverless"
  project_name      = var.project_name
  environment       = var.environment
  cluster_name      = "tenant-001"
  cluster_type      = "tenant"
  database_name     = "coheus"  # Default DB, tenants get their own
  master_username   = "coheusadmin"
  master_password   = var.database_password
  subnet_ids        = module.vpc.private_subnet_ids
  security_group_id = module.security_groups.database_sg_id
  kms_key_arn       = module.kms.key_arn
  min_acu           = 0.5
  max_acu           = 8
}

# ElastiCache (Redis)
module "redis" {
  source            = "../../../modules/storage/elasticache"
  project_name      = var.project_name
  environment       = var.environment
  subnet_ids        = module.vpc.private_subnet_ids
  security_group_id = module.security_groups.redis_sg_id
  node_type         = "cache.t3.small"
}

# S3 Bucket
module "s3" {
  source       = "../../../modules/storage/s3"
  project_name = var.project_name
  environment  = var.environment
  kms_key_arn  = module.kms.key_arn
}

# Application Load Balancer
module "alb" {
  source            = "../../../modules/networking/alb"
  project_name      = var.project_name
  environment       = var.environment
  vpc_id            = module.vpc.vpc_id
  subnet_ids        = module.vpc.public_subnet_ids
  security_group_id = module.security_groups.alb_sg_id
  certificate_arn   = var.certificate_arn
}

# ECS Fargate
module "ecs" {
  source             = "../../../modules/compute/ecs-fargate"
  project_name       = var.project_name
  environment        = var.environment
  region             = var.region
  container_image    = var.container_image
  cpu                = 512
  memory             = 1024
  desired_count      = 2
  min_count          = 2
  max_count          = 10
  container_port     = 3001
  subnet_ids         = module.vpc.private_subnet_ids
  security_group_id  = module.security_groups.ecs_sg_id
  target_group_arn   = module.alb.target_group_arn
  execution_role_arn = module.iam.ecs_execution_role_arn
  task_role_arn      = module.iam.ecs_task_role_arn
  
  environment_variables = [
    { name = "NODE_ENV", value = "production" },
    { name = "DEPLOYMENT_MODE", value = "saas" },
    { name = "MULTI_TENANT_ENABLED", value = "true" },
    { name = "DB_HOST", value = module.management_db.writer_endpoint },
    { name = "DB_NAME", value = "coheus_management" },
    { name = "REDIS_URL", value = module.redis.endpoint },
  ]
  
  secrets = [
    { name = "DB_PASSWORD", valueFrom = module.secrets.database_password_arn },
    { name = "JWT_SECRET", valueFrom = module.secrets.jwt_secret_arn },
  ]
}

# WAF
module "waf" {
  source       = "../../../modules/security/waf"
  project_name = var.project_name
  environment  = var.environment
  rate_limit   = 2000
}

# CloudFront
module "cloudfront" {
  source            = "../../../modules/cdn/cloudfront"
  project_name      = var.project_name
  environment       = var.environment
  s3_bucket_domain  = module.s3.bucket_domain
  alb_domain        = module.alb.dns_name
  waf_acl_arn       = module.waf.acl_arn
  certificate_arn   = var.certificate_arn
  domain_name       = var.domain_name
}

# IAM Roles
module "iam" {
  source       = "../../../modules/security/iam"
  project_name = var.project_name
  environment  = var.environment
  kms_key_arn  = module.kms.key_arn
  s3_bucket_arn = module.s3.bucket_arn
  secrets_arns = module.secrets.secret_arns
}
```

---

### Self-Hosted (Marketplace)

```hcl
# deployments/marketplace/main.tf

# Simplified deployment for self-hosted customers
# This creates a CloudFormation template they can deploy

module "vpc" {
  source             = "../../modules/networking/vpc"
  project_name       = var.project_name
  environment        = "self-hosted"
  vpc_cidr           = var.vpc_cidr
  availability_zones = var.availability_zones
  enable_nat_gateway = true
}

module "security_groups" {
  source       = "../../modules/networking/security-groups"
  project_name = var.project_name
  environment  = "self-hosted"
  vpc_id       = module.vpc.vpc_id
  vpc_cidr     = module.vpc.vpc_cidr
}

# Single RDS instance (not Aurora)
module "database" {
  source            = "../../modules/database/rds-postgresql"
  project_name      = var.project_name
  environment       = "self-hosted"
  instance_class    = var.db_instance_class
  database_name     = "coheus"
  master_username   = "coheusadmin"
  master_password   = var.database_password
  subnet_ids        = module.vpc.private_subnet_ids
  security_group_id = module.security_groups.database_sg_id
  multi_az          = false
}

module "alb" {
  source            = "../../modules/networking/alb"
  project_name      = var.project_name
  environment       = "self-hosted"
  vpc_id            = module.vpc.vpc_id
  subnet_ids        = module.vpc.public_subnet_ids
  security_group_id = module.security_groups.alb_sg_id
  certificate_arn   = var.certificate_arn
}

# Single EC2 instance (simpler than ECS for self-hosted)
module "ec2" {
  source             = "../../modules/compute/ec2-single"
  project_name       = var.project_name
  environment        = "self-hosted"
  instance_type      = var.instance_type
  subnet_id          = module.vpc.private_subnet_ids[0]
  security_group_id  = module.security_groups.ec2_sg_id
  target_group_arn   = module.alb.target_group_arn
  
  environment_variables = {
    NODE_ENV             = "production"
    DEPLOYMENT_MODE      = "self_hosted"
    MULTI_TENANT_ENABLED = "false"
    DB_HOST              = module.database.endpoint
    DB_NAME              = "coheus"
  }
}
```

---

## Usage Examples

### Initialize and Deploy

```bash
# Navigate to deployment directory
cd infrastructure/terraform/deployments/saas/prod

# Initialize Terraform
terraform init

# Review plan
terraform plan -var-file=terraform.tfvars

# Apply changes
terraform apply -var-file=terraform.tfvars
```

### Add New Tenant Cluster

```hcl
# Add to main.tf
module "tenant_cluster_002" {
  source            = "../../../modules/database/aurora-serverless"
  project_name      = var.project_name
  environment       = var.environment
  cluster_name      = "tenant-002"
  cluster_type      = "tenant"
  # ... same configuration as tenant-001
}
```

---

## CI/CD Integration

### GitHub Actions Workflow

```yaml
# .github/workflows/terraform.yml

name: Terraform

on:
  push:
    branches: [main]
    paths:
      - 'infrastructure/terraform/**'
  pull_request:
    branches: [main]
    paths:
      - 'infrastructure/terraform/**'

env:
  TF_VERSION: '1.5.0'

jobs:
  plan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: ${{ env.TF_VERSION }}
      
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1
      
      - name: Terraform Init
        working-directory: infrastructure/terraform/deployments/saas/prod
        run: terraform init
      
      - name: Terraform Plan
        working-directory: infrastructure/terraform/deployments/saas/prod
        run: terraform plan -var-file=terraform.tfvars -out=tfplan
      
      - name: Upload Plan
        uses: actions/upload-artifact@v4
        with:
          name: tfplan
          path: infrastructure/terraform/deployments/saas/prod/tfplan

  apply:
    needs: plan
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: production
    steps:
      # ... apply steps with manual approval
```

---

## Related Documentation

### Architecture
- [OVERVIEW.md](../architecture/OVERVIEW.md) - System architecture
- [AURORA_CLUSTERS.md](../architecture/AURORA_CLUSTERS.md) - Aurora configuration details
- [MULTI_TENANT.md](../architecture/MULTI_TENANT.md) - Multi-tenant architecture
- [SELF_HOSTED.md](../architecture/SELF_HOSTED.md) - Self-hosted deployment

### Deployment
- [AWS_MARKETPLACE.md](./AWS_MARKETPLACE.md) - Marketplace publishing

### Admin & Security
- [INTERNAL_ADMIN_REQUIREMENTS.md](../architecture/INTERNAL_ADMIN_REQUIREMENTS.md) - Infrastructure management features
- [SSO_AUTHENTICATION.md](../security/SSO_AUTHENTICATION.md) - SSO configuration
