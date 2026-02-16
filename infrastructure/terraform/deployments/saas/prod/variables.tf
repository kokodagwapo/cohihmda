# SaaS Production Deployment Variables

variable "project_name" {
  description = "Project name"
  type        = string
  default     = "coheus"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "prod"
}

variable "region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "vpc_cidr" {
  description = "VPC CIDR block"
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "List of availability zones"
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]
}

variable "enable_flow_logs" {
  description = "Enable VPC flow logs"
  type        = bool
  default     = false
}

# Aurora Configuration
variable "management_min_acu" {
  description = "Minimum ACU for management cluster"
  type        = number
  default     = 0.5
}

variable "management_max_acu" {
  description = "Maximum ACU for management cluster"
  type        = number
  default     = 4
}

variable "tenant_min_acu" {
  description = "Minimum ACU for tenant clusters"
  type        = number
  default     = 0.5
}

variable "tenant_max_acu" {
  description = "Maximum ACU for tenant clusters"
  type        = number
  default     = 8
}

# ECS Configuration
variable "container_image" {
  description = "Docker image for the backend"
  type        = string
}

variable "ecs_cpu" {
  description = "ECS task CPU units"
  type        = number
  default     = 512
}

variable "ecs_memory" {
  description = "ECS task memory in MB"
  type        = number
  default     = 4096
}

variable "ecs_desired_count" {
  description = "Desired number of ECS tasks"
  type        = number
  default     = 2
}

variable "ecs_min_count" {
  description = "Minimum number of ECS tasks"
  type        = number
  default     = 2
}

variable "ecs_max_count" {
  description = "Maximum number of ECS tasks"
  type        = number
  default     = 10
}

# Domain and SSL
variable "domain_name" {
  description = "Domain name for the application"
  type        = string
  default     = ""
}

variable "certificate_arn" {
  description = "ACM certificate ARN"
  type        = string
  default     = ""
}

# Alerts
variable "alert_email" {
  description = "Email for alerts"
  type        = string
  default     = ""
}
