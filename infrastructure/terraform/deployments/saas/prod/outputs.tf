# SaaS Production Deployment Outputs

output "vpc_id" {
  description = "VPC ID"
  value       = module.vpc.vpc_id
}

output "public_subnet_ids" {
  description = "Public subnet IDs"
  value       = module.vpc.public_subnet_ids
}

output "private_subnet_ids" {
  description = "Private subnet IDs"
  value       = module.vpc.private_subnet_ids
}

output "alb_dns_name" {
  description = "ALB DNS name"
  value       = aws_lb.main.dns_name
}

output "alb_zone_id" {
  description = "ALB hosted zone ID (for Route 53)"
  value       = aws_lb.main.zone_id
}

output "management_cluster_endpoint" {
  description = "Management Aurora cluster endpoint"
  value       = module.aurora_management.cluster_endpoint
}

output "management_cluster_secret_arn" {
  description = "Management cluster secret ARN"
  value       = module.aurora_management.secret_arn
}

output "tenant_001_cluster_endpoint" {
  description = "Tenant 001 Aurora cluster endpoint"
  value       = module.aurora_tenant_001.cluster_endpoint
}

output "tenant_001_cluster_secret_arn" {
  description = "Tenant 001 cluster secret ARN"
  value       = module.aurora_tenant_001.secret_arn
}

output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = module.ecs.cluster_name
}

output "ecs_service_name" {
  description = "ECS service name"
  value       = module.ecs.service_name
}

output "frontend_bucket_name" {
  description = "Frontend S3 bucket name"
  value       = aws_s3_bucket.frontend.id
}

output "alerts_topic_arn" {
  description = "SNS alerts topic ARN"
  value       = aws_sns_topic.alerts.arn
}

output "kms_key_arn" {
  description = "KMS key ARN"
  value       = module.aurora_management.kms_key_arn
}
