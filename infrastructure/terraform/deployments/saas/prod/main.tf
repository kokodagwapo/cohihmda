# Coheus Multi-Tenant SaaS Production Deployment
# This configuration deploys the complete multi-tenant infrastructure

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.5"
    }
  }

  # Uncomment to use S3 backend
  # backend "s3" {
  #   bucket         = "coheus-terraform-state"
  #   key            = "saas/prod/terraform.tfstate"
  #   region         = "us-east-1"
  #   encrypt        = true
  #   dynamodb_table = "coheus-terraform-locks"
  # }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# Provider for CloudFront resources (must be us-east-1)
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# Local values
locals {
  common_tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# VPC Module
module "vpc" {
  source = "../../modules/networking/vpc"

  project_name       = var.project_name
  environment        = var.environment
  vpc_cidr           = var.vpc_cidr
  availability_zones = var.availability_zones
  enable_nat_gateway = true
  enable_flow_logs   = var.enable_flow_logs
  
  tags = local.common_tags
}

# Management Aurora Cluster
module "aurora_management" {
  source = "../../modules/database/aurora-serverless"

  project_name  = var.project_name
  environment   = var.environment
  cluster_name  = "management"
  cluster_type  = "management"
  database_name = "coheus_management"
  
  vpc_id                     = module.vpc.vpc_id
  subnet_ids                 = module.vpc.private_subnet_ids
  allowed_security_group_ids = [module.ecs.security_group_id]
  
  min_acu = var.management_min_acu
  max_acu = var.management_max_acu
  
  deletion_protection         = var.environment == "prod"
  enable_performance_insights = true
  create_alarms               = true
  alarm_actions               = [aws_sns_topic.alerts.arn]
  
  tags = local.common_tags
}

# First Tenant Aurora Cluster
module "aurora_tenant_001" {
  source = "../../modules/database/aurora-serverless"

  project_name  = var.project_name
  environment   = var.environment
  cluster_name  = "tenant-001"
  cluster_type  = "tenant"
  database_name = "coheus"
  
  vpc_id                     = module.vpc.vpc_id
  subnet_ids                 = module.vpc.private_subnet_ids
  allowed_security_group_ids = [module.ecs.security_group_id]
  
  min_acu = var.tenant_min_acu
  max_acu = var.tenant_max_acu
  
  kms_key_arn     = module.aurora_management.kms_key_arn
  create_kms_key  = false
  
  deletion_protection         = var.environment == "prod"
  enable_performance_insights = true
  create_alarms               = true
  alarm_actions               = [aws_sns_topic.alerts.arn]
  
  tags = local.common_tags
}

# Application Load Balancer
resource "aws_lb" "main" {
  name               = "${var.project_name}-${var.environment}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = module.vpc.public_subnet_ids

  enable_deletion_protection = var.environment == "prod"

  tags = local.common_tags
}

resource "aws_security_group" "alb" {
  name        = "${var.project_name}-${var.environment}-alb-sg"
  description = "Security group for ALB"
  vpc_id      = module.vpc.vpc_id

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, {
    Name = "${var.project_name}-${var.environment}-alb-sg"
  })
}

resource "aws_lb_target_group" "backend" {
  name        = "${var.project_name}-${var.environment}-backend-tg"
  port        = 3001
  protocol    = "HTTP"
  vpc_id      = module.vpc.vpc_id
  target_type = "ip"

  health_check {
    enabled             = true
    healthy_threshold   = 2
    unhealthy_threshold = 5
    timeout             = 5
    interval            = 30
    path                = "/health"
    protocol            = "HTTP"
  }

  tags = local.common_tags
}

resource "aws_lb_listener" "https" {
  count             = var.certificate_arn != "" ? 1 : 0
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.backend.arn
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = var.certificate_arn != "" ? "redirect" : "forward"
    
    dynamic "redirect" {
      for_each = var.certificate_arn != "" ? [1] : []
      content {
        port        = "443"
        protocol    = "HTTPS"
        status_code = "HTTP_301"
      }
    }

    target_group_arn = var.certificate_arn == "" ? aws_lb_target_group.backend.arn : null
  }
}

# ECS Fargate
module "ecs" {
  source = "../../modules/compute/ecs-fargate"

  project_name = var.project_name
  environment  = var.environment
  region       = var.region
  
  vpc_id                = module.vpc.vpc_id
  subnet_ids            = module.vpc.private_subnet_ids
  alb_security_group_id = aws_security_group.alb.id
  target_group_arn      = aws_lb_target_group.backend.arn
  
  container_image = var.container_image
  container_port  = 3001
  cpu             = var.ecs_cpu
  memory          = var.ecs_memory
  desired_count   = var.ecs_desired_count
  min_count       = var.ecs_min_count
  max_count       = var.ecs_max_count
  
  enable_autoscaling = true
  cpu_target_value   = 70
  memory_target_value = 80
  
  kms_key_arn = module.aurora_management.kms_key_arn
  secret_arns = [
    module.aurora_management.secret_arn,
    module.aurora_tenant_001.secret_arn,
    aws_secretsmanager_secret.jwt.arn
  ]
  
  environment_variables = [
    { name = "NODE_ENV", value = "production" },
    { name = "PORT", value = "3001" },
    { name = "DEPLOYMENT_MODE", value = "saas" },
    { name = "MULTI_TENANT_ENABLED", value = "true" },
    { name = "MANAGEMENT_DB_HOST", value = module.aurora_management.cluster_endpoint },
    { name = "MANAGEMENT_DB_PORT", value = "5432" },
    { name = "MANAGEMENT_DB_NAME", value = "coheus_management" },
    { name = "AWS_REGION", value = var.region },
    { name = "FRONTEND_URL", value = "https://${var.domain_name}" }
  ]
  
  secrets = [
    { name = "MANAGEMENT_DB_USER", valueFrom = "${module.aurora_management.secret_arn}:username::" },
    { name = "MANAGEMENT_DB_PASSWORD", valueFrom = "${module.aurora_management.secret_arn}:password::" },
    { name = "JWT_SECRET", valueFrom = "${aws_secretsmanager_secret.jwt.arn}:secret::" }
  ]
  
  tags = local.common_tags
}

# JWT Secret
resource "aws_secretsmanager_secret" "jwt" {
  name        = "${var.project_name}/${var.environment}/jwt"
  description = "JWT signing secret"
  kms_key_id  = module.aurora_management.kms_key_arn
}

resource "aws_secretsmanager_secret_version" "jwt" {
  secret_id = aws_secretsmanager_secret.jwt.id
  secret_string = jsonencode({
    secret = random_password.jwt.result
  })
}

resource "random_password" "jwt" {
  length  = 64
  special = false
}

# SNS Topic for Alerts
resource "aws_sns_topic" "alerts" {
  name         = "${var.project_name}-${var.environment}-alerts"
  display_name = "${var.project_name} ${var.environment} Alerts"
  
  tags = local.common_tags
}

resource "aws_sns_topic_subscription" "email" {
  count     = var.alert_email != "" ? 1 : 0
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# Frontend S3 Bucket
resource "aws_s3_bucket" "frontend" {
  bucket = "${var.project_name}-frontend-${data.aws_caller_identity.current.account_id}"

  tags = local.common_tags
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  versioning_configuration {
    status = "Enabled"
  }
}

data "aws_caller_identity" "current" {}
