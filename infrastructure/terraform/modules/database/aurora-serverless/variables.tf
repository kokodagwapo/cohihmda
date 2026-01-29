# Aurora Serverless v2 Module Variables

variable "project_name" {
  description = "Project name for resource naming"
  type        = string
}

variable "environment" {
  description = "Environment (dev, staging, prod)"
  type        = string
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

variable "vpc_id" {
  description = "VPC ID for the cluster"
  type        = string
}

variable "subnet_ids" {
  description = "List of subnet IDs for the cluster"
  type        = list(string)
}

variable "allowed_security_group_ids" {
  description = "Security group IDs allowed to connect to the cluster"
  type        = list(string)
}

variable "engine_version" {
  description = "Aurora PostgreSQL engine version"
  type        = string
  default     = "15.4"
}

variable "database_name" {
  description = "Name of the default database"
  type        = string
  default     = "coheus"
}

variable "master_username" {
  description = "Master username for the cluster"
  type        = string
  default     = "coheusadmin"
}

variable "master_password" {
  description = "Master password (leave empty to auto-generate)"
  type        = string
  default     = ""
  sensitive   = true
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
  description = "Number of days to retain backups"
  type        = number
  default     = 7
}

variable "deletion_protection" {
  description = "Enable deletion protection"
  type        = bool
  default     = false
}

variable "enable_performance_insights" {
  description = "Enable Performance Insights"
  type        = bool
  default     = true
}

variable "create_kms_key" {
  description = "Create a new KMS key for encryption"
  type        = bool
  default     = true
}

variable "kms_key_arn" {
  description = "KMS key ARN for encryption (if not creating new)"
  type        = string
  default     = ""
}

variable "create_alarms" {
  description = "Create CloudWatch alarms"
  type        = bool
  default     = true
}

variable "alarm_actions" {
  description = "List of ARNs for alarm actions (e.g., SNS topics)"
  type        = list(string)
  default     = []
}

variable "tags" {
  description = "Additional tags for resources"
  type        = map(string)
  default     = {}
}
