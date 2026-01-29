# Aurora Serverless v2 Module Outputs

output "cluster_id" {
  description = "Aurora cluster identifier"
  value       = aws_rds_cluster.aurora.id
}

output "cluster_arn" {
  description = "Aurora cluster ARN"
  value       = aws_rds_cluster.aurora.arn
}

output "cluster_endpoint" {
  description = "Aurora cluster writer endpoint"
  value       = aws_rds_cluster.aurora.endpoint
}

output "cluster_reader_endpoint" {
  description = "Aurora cluster reader endpoint"
  value       = aws_rds_cluster.aurora.reader_endpoint
}

output "cluster_port" {
  description = "Aurora cluster port"
  value       = aws_rds_cluster.aurora.port
}

output "database_name" {
  description = "Default database name"
  value       = aws_rds_cluster.aurora.database_name
}

output "master_username" {
  description = "Master username"
  value       = aws_rds_cluster.aurora.master_username
}

output "secret_arn" {
  description = "Secrets Manager secret ARN for database credentials"
  value       = aws_secretsmanager_secret.aurora.arn
}

output "security_group_id" {
  description = "Security group ID for the cluster"
  value       = aws_security_group.aurora.id
}

output "kms_key_arn" {
  description = "KMS key ARN used for encryption"
  value       = var.create_kms_key ? aws_kms_key.aurora[0].arn : var.kms_key_arn
}

output "connection_string" {
  description = "PostgreSQL connection string format"
  value       = "postgresql://${aws_rds_cluster.aurora.master_username}:PASSWORD@${aws_rds_cluster.aurora.endpoint}:${aws_rds_cluster.aurora.port}/${aws_rds_cluster.aurora.database_name}?sslmode=require"
  sensitive   = true
}
