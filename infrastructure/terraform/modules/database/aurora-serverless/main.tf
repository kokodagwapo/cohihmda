# Coheus Aurora Serverless v2 Module
# Creates an Aurora Serverless v2 PostgreSQL cluster for multi-tenant SaaS

# KMS Key for encryption
resource "aws_kms_key" "aurora" {
  count                   = var.create_kms_key ? 1 : 0
  description             = "KMS key for ${var.project_name} Aurora cluster encryption"
  deletion_window_in_days = 7
  enable_key_rotation     = true

  tags = merge(var.tags, {
    Name = "${var.project_name}-${var.environment}-aurora-key"
  })
}

resource "aws_kms_alias" "aurora" {
  count         = var.create_kms_key ? 1 : 0
  name          = "alias/${var.project_name}-${var.environment}-aurora"
  target_key_id = aws_kms_key.aurora[0].key_id
}

# Security Group
resource "aws_security_group" "aurora" {
  name        = "${var.project_name}-${var.environment}-${var.cluster_name}-sg"
  description = "Security group for Aurora cluster"
  vpc_id      = var.vpc_id

  ingress {
    description     = "PostgreSQL from allowed security groups"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = var.allowed_security_group_ids
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, {
    Name = "${var.project_name}-${var.environment}-${var.cluster_name}-sg"
  })
}

# DB Subnet Group
resource "aws_db_subnet_group" "aurora" {
  name       = "${var.project_name}-${var.environment}-${var.cluster_name}-subnet-group"
  subnet_ids = var.subnet_ids

  tags = merge(var.tags, {
    Name = "${var.project_name}-${var.environment}-${var.cluster_name}-subnet-group"
  })
}

# Cluster Parameter Group
resource "aws_rds_cluster_parameter_group" "aurora" {
  name   = "${var.project_name}-${var.environment}-${var.cluster_name}-params"
  family = "aurora-postgresql15"

  parameter {
    name  = "shared_preload_libraries"
    value = "pg_stat_statements"
  }

  parameter {
    name  = "log_statement"
    value = "ddl"
  }

  parameter {
    name  = "log_min_duration_statement"
    value = "1000"
  }

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  tags = var.tags
}

# Secrets Manager Secret for credentials
resource "aws_secretsmanager_secret" "aurora" {
  name        = "${var.project_name}/${var.environment}/aurora/${var.cluster_name}"
  description = "Aurora cluster credentials for ${var.project_name}"
  kms_key_id  = var.create_kms_key ? aws_kms_key.aurora[0].arn : var.kms_key_arn

  tags = var.tags
}

resource "aws_secretsmanager_secret_version" "aurora" {
  secret_id = aws_secretsmanager_secret.aurora.id
  secret_string = jsonencode({
    username = var.master_username
    password = var.master_password != "" ? var.master_password : random_password.master[0].result
    host     = aws_rds_cluster.aurora.endpoint
    port     = 5432
    database = var.database_name
  })
}

resource "random_password" "master" {
  count   = var.master_password == "" ? 1 : 0
  length  = 32
  special = false
}

# Aurora Serverless v2 Cluster
resource "aws_rds_cluster" "aurora" {
  cluster_identifier     = "${var.project_name}-${var.environment}-${var.cluster_name}"
  engine                 = "aurora-postgresql"
  engine_mode            = "provisioned"
  engine_version         = var.engine_version
  database_name          = var.database_name
  master_username        = var.master_username
  master_password        = var.master_password != "" ? var.master_password : random_password.master[0].result
  
  db_subnet_group_name   = aws_db_subnet_group.aurora.name
  vpc_security_group_ids = [aws_security_group.aurora.id]
  db_cluster_parameter_group_name = aws_rds_cluster_parameter_group.aurora.name
  
  storage_encrypted = true
  kms_key_id        = var.create_kms_key ? aws_kms_key.aurora[0].arn : var.kms_key_arn
  
  backup_retention_period      = var.backup_retention_days
  preferred_backup_window      = "03:00-04:00"
  preferred_maintenance_window = "sun:04:00-sun:05:00"
  
  enabled_cloudwatch_logs_exports = ["postgresql"]
  
  deletion_protection = var.deletion_protection
  skip_final_snapshot = var.environment != "prod"
  final_snapshot_identifier = var.environment == "prod" ? "${var.project_name}-${var.cluster_name}-final" : null
  
  copy_tags_to_snapshot = true

  serverlessv2_scaling_configuration {
    min_capacity = var.min_acu
    max_capacity = var.max_acu
  }

  tags = merge(var.tags, {
    Name        = "${var.project_name}-${var.environment}-${var.cluster_name}"
    ClusterType = var.cluster_type
  })

  lifecycle {
    ignore_changes = [master_password]
  }
}

# Aurora Serverless v2 Instance
resource "aws_rds_cluster_instance" "aurora" {
  count              = var.instance_count
  identifier         = "${var.project_name}-${var.environment}-${var.cluster_name}-${count.index + 1}"
  cluster_identifier = aws_rds_cluster.aurora.id
  instance_class     = "db.serverless"
  engine             = aws_rds_cluster.aurora.engine
  engine_version     = aws_rds_cluster.aurora.engine_version
  
  publicly_accessible = false
  
  performance_insights_enabled    = var.enable_performance_insights
  performance_insights_kms_key_id = var.enable_performance_insights ? (var.create_kms_key ? aws_kms_key.aurora[0].arn : var.kms_key_arn) : null
  performance_insights_retention_period = var.enable_performance_insights ? 7 : null

  tags = merge(var.tags, {
    Name = "${var.project_name}-${var.environment}-${var.cluster_name}-instance-${count.index + 1}"
  })
}

# CloudWatch Alarms
resource "aws_cloudwatch_metric_alarm" "cpu_high" {
  count               = var.create_alarms ? 1 : 0
  alarm_name          = "${var.project_name}-${var.environment}-${var.cluster_name}-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "Aurora cluster CPU utilization is high"
  alarm_actions       = var.alarm_actions
  ok_actions          = var.alarm_actions
  treat_missing_data  = "notBreaching"

  dimensions = {
    DBClusterIdentifier = aws_rds_cluster.aurora.id
  }

  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "acu_high" {
  count               = var.create_alarms ? 1 : 0
  alarm_name          = "${var.project_name}-${var.environment}-${var.cluster_name}-acu-high"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 3
  metric_name         = "ServerlessDatabaseCapacity"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Maximum"
  threshold           = var.max_acu
  alarm_description   = "Aurora cluster approaching maximum ACU"
  alarm_actions       = var.alarm_actions
  treat_missing_data  = "notBreaching"

  dimensions = {
    DBClusterIdentifier = aws_rds_cluster.aurora.id
  }

  tags = var.tags
}
