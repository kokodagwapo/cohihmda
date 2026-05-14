# Aurora Serverless v2 Cluster Strategy

This document details the Aurora Serverless v2 architecture for Cohi multi-tenant SaaS deployment, including cluster management, scaling, and cost optimization strategies.

> **Naming Convention:**
> - **Cohi** - The new executive intelligence platform (this product)
> - **Coheus** - The legacy Qlik Sense-based product

## Table of Contents

- [Overview](#overview)
- [Why Aurora Serverless v2](#why-aurora-serverless-v2)
- [Cluster Architecture](#cluster-architecture)
- [Tenant Assignment](#tenant-assignment)
- [Scaling Configuration](#scaling-configuration)
- [Cost Analysis](#cost-analysis)
- [Operations](#operations)
- [Monitoring](#monitoring)
- [Disaster Recovery](#disaster-recovery)

---

## Overview

Cohi uses Aurora Serverless v2 with a **tenant clustering strategy** to balance database isolation with cost efficiency. Instead of one database cluster per tenant (expensive) or one database for all tenants (poor isolation), we group multiple tenant databases into shared Aurora clusters.

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Database-per-tenant | Maximum data isolation, compliance requirements |
| Tenant clustering | Cost efficiency - shared Aurora compute and storage |
| Aurora Serverless v2 | Auto-scaling for bursty mortgage industry workloads |
| 25 tenants per cluster | Balance between isolation and cost |

---

## Why Aurora Serverless v2

### Comparison: Aurora Serverless v2 vs Provisioned RDS

| Feature | Aurora Serverless v2 | Provisioned RDS |
|---------|---------------------|-----------------|
| Scaling | Automatic (seconds) | Manual (minutes) |
| Minimum Cost | 0.5 ACU (~$43/mo) | Instance cost (always on) |
| Bursty Workloads | Excellent | Requires over-provisioning |
| High Availability | Built-in | Requires Multi-AZ setup |
| Storage Scaling | Automatic | Manual |
| Management | Minimal | More overhead |

### Aurora Serverless v2 for Mortgage Industry

Mortgage lenders have **bursty workloads**:
- Heavy usage during business hours (9 AM - 6 PM)
- Minimal usage nights and weekends
- Month-end and quarter-end spikes

Aurora Serverless v2 advantages:
```
Business Hours: Scale up to 8 ACU (handle 100s of concurrent queries)
                ↓
Off Hours:      Scale down to 0.5 ACU (minimal cost)
                ↓
Month End:      Scale up to 16 ACU (handle reporting spike)
```

---

## Cluster Architecture

### Tenant Clustering Model

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        AURORA CLUSTER ARCHITECTURE                           │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                         MANAGEMENT CLUSTER                                   │
│                     (Aurora Serverless v2: 0.5-4 ACU)                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   cohi_management database:                                                │
│   ├── cohi_tenants (tenant registry)                                        │
│   ├── tenant_clusters (cluster assignments)                                  │
│   ├── user_tenant_mappings                                                  │
│   └── tenant_api_keys                                                       │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                         TENANT CLUSTER 1                                     │
│                     (Aurora Serverless v2: 0.5-8 ACU)                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│   │  tenant_001 │  │  tenant_002 │  │  tenant_003 │  │    ...      │       │
│   │  database   │  │  database   │  │  database   │  │             │       │
│   │             │  │             │  │             │  │             │       │
│   │  • loans    │  │  • loans    │  │  • loans    │  │             │       │
│   │  • configs  │  │  • configs  │  │  • configs  │  │             │       │
│   │             │  │             │  │             │  │             │       │
│   └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘       │
│                                                                              │
│                         (Up to 25 tenants per cluster)                       │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                         TENANT CLUSTER 2                                     │
│                     (Aurora Serverless v2: 0.5-8 ACU)                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│   │  tenant_026 │  │  tenant_027 │  │  tenant_028 │  │    ...      │       │
│   │  database   │  │  database   │  │  database   │  │             │       │
│   └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘       │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

                              ... Cluster N ...
```

### Cluster Types

| Cluster Type | Purpose | ACU Range | Tenants |
|--------------|---------|-----------|---------|
| Management | Tenant registry, user mappings | 0.5 - 4 | N/A |
| Tenant | Tenant loan data | 0.5 - 8 | 25 |
| High-Volume | Large enterprise tenants | 2 - 32 | 1-5 |

---

## Tenant Assignment

### Cluster Assignment Algorithm

When a new tenant is provisioned:

```python
def assign_tenant_to_cluster(tenant_name: str) -> Cluster:
    # 1. Find cluster with capacity
    available_cluster = find_cluster_with_capacity()
    
    if available_cluster:
        # 2. Create database in existing cluster
        create_tenant_database(available_cluster, tenant_name)
        return available_cluster
    else:
        # 3. Provision new cluster
        new_cluster = create_aurora_cluster()
        create_tenant_database(new_cluster, tenant_name)
        return new_cluster

def find_cluster_with_capacity() -> Cluster | None:
    return db.query("""
        SELECT * FROM tenant_clusters 
        WHERE current_tenant_count < max_tenants 
        AND status = 'active'
        ORDER BY current_tenant_count DESC  -- Fill existing clusters first
        LIMIT 1
    """)
```

### Database Schema for Cluster Management

```sql
-- Cluster Registry
CREATE TABLE tenant_clusters (
    id TEXT PRIMARY KEY,                    -- e.g., 'cluster-001'
    name TEXT NOT NULL,                     -- e.g., 'Tenant Cluster US-East-1a'
    
    -- Aurora Endpoints
    writer_endpoint TEXT NOT NULL,          -- cluster writer endpoint
    reader_endpoint TEXT,                   -- cluster reader endpoint (optional)
    
    -- Capacity Management
    current_tenant_count INTEGER DEFAULT 0,
    max_tenants INTEGER DEFAULT 25,
    
    -- Scaling Configuration
    min_acu DECIMAL DEFAULT 0.5,
    max_acu DECIMAL DEFAULT 8,
    
    -- Status
    status TEXT DEFAULT 'active',           -- active, provisioning, maintenance, retired
    region TEXT NOT NULL,                   -- AWS region
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tenant-Cluster Mapping (in coheus_tenants table)
ALTER TABLE coheus_tenants ADD COLUMN cluster_id TEXT REFERENCES tenant_clusters(id);
ALTER TABLE coheus_tenants ADD COLUMN cluster_endpoint TEXT;
```

### Connection Routing

The `TenantDatabaseManager` routes connections based on cluster assignment:

```typescript
class TenantDatabaseManager {
  async getTenantPool(tenantId: string): Promise<pg.Pool> {
    // 1. Get tenant config including cluster endpoint
    const tenant = await this.managementPool.query(`
      SELECT t.*, c.writer_endpoint as cluster_endpoint
      FROM coheus_tenants t
      JOIN tenant_clusters c ON t.cluster_id = c.id
      WHERE t.id = $1 AND t.status = 'active'
    `, [tenantId]);
    
    // 2. Create/retrieve connection pool for this cluster+database
    const poolKey = `${tenant.cluster_id}:${tenant.database_name}`;
    
    if (!this.poolCache.has(poolKey)) {
      const pool = new pg.Pool({
        host: tenant.cluster_endpoint,
        port: 5432,
        database: tenant.database_name,
        user: decrypt(tenant.database_user),
        password: decrypt(tenant.database_password_encrypted),
        ssl: { rejectUnauthorized: false },
        max: 10,
      });
      this.poolCache.set(poolKey, pool);
    }
    
    return this.poolCache.get(poolKey);
  }
}
```

---

## Scaling Configuration

### Aurora Serverless v2 Capacity Units (ACUs)

| ACU | vCPU | Memory | Use Case |
|-----|------|--------|----------|
| 0.5 | 1 | 1 GB | Idle/minimal usage |
| 1 | 2 | 2 GB | Light workloads |
| 2 | 4 | 4 GB | Moderate workloads |
| 4 | 8 | 8 GB | Business hours |
| 8 | 16 | 16 GB | Peak usage |
| 16 | 32 | 32 GB | Month-end reporting |

### Recommended Configuration by Cluster Type

```hcl
# Terraform configuration

# Management Cluster - Small, always available
resource "aws_rds_cluster" "management" {
  cluster_identifier = "coheus-management"
  engine_mode        = "provisioned"  # Aurora Serverless v2
  
  serverlessv2_scaling_configuration {
    min_capacity = 0.5
    max_capacity = 4
  }
}

# Standard Tenant Cluster - Auto-scaling for typical lenders
resource "aws_rds_cluster" "tenant_standard" {
  cluster_identifier = "coheus-tenant-001"
  
  serverlessv2_scaling_configuration {
    min_capacity = 0.5   # Scale to near-zero when idle
    max_capacity = 8     # Handle business hours load
  }
}

# High-Volume Tenant Cluster - For large enterprise lenders
resource "aws_rds_cluster" "tenant_enterprise" {
  cluster_identifier = "coheus-tenant-enterprise-001"
  
  serverlessv2_scaling_configuration {
    min_capacity = 2     # Always maintain baseline
    max_capacity = 32    # Handle massive reporting jobs
  }
}
```

### Scaling Behavior

```
         ┌─────────────────────────────────────────────────────────────┐
     8   │                    ████████                                 │
         │                  ██        ██                               │
  A  6   │                ██            ██                             │
  C      │              ██                ██                           │
  U  4   │            ██                    ██                         │
         │          ██                        ██                       │
     2   │        ██                            ██                     │
         │      ██                                ██                   │
   0.5   │██████                                    ██████████████████│
         └─────────────────────────────────────────────────────────────┘
          12am  3am  6am  9am  12pm  3pm  6pm  9pm  12am
          
                     Typical Daily ACU Pattern
```

---

## Cost Analysis

### Cost Breakdown by Tenant Count

| Tenants | Clusters Needed | ACU Hours/Month | Storage | Total/Month |
|---------|-----------------|-----------------|---------|-------------|
| 10 | 1 | ~400 hrs @ avg 1.5 ACU | 100 GB | ~$86 |
| 25 | 1 | ~500 hrs @ avg 2 ACU | 250 GB | ~$130 |
| 50 | 2 | ~900 hrs @ avg 2 ACU | 500 GB | ~$260 |
| 100 | 4 | ~1600 hrs @ avg 2 ACU | 1 TB | ~$430 |
| 200 | 8 | ~3200 hrs @ avg 2 ACU | 2 TB | ~$860 |

### Cost Comparison: Aurora vs Individual RDS

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     COST COMPARISON (100 Tenants)                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   Individual RDS (db.t3.micro):                                             │
│   ├── 100 instances × $15/month = $1,500/month                              │
│   ├── Storage: 100 × 20GB = $230/month                                      │
│   ├── IOPS: ~$200/month                                                     │
│   └── TOTAL: ~$1,930/month                                                  │
│                                                                              │
│   Aurora Serverless v2 (Clustered):                                         │
│   ├── 4 clusters × avg $80/month = $320/month                               │
│   ├── Storage: 1TB shared = $100/month                                      │
│   ├── I/O: ~$10/month (included in ACU)                                     │
│   └── TOTAL: ~$430/month                                                    │
│                                                                              │
│   SAVINGS: $1,500/month (78% reduction)                                     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Cost Optimization Tips

1. **Right-size max ACU**: Start with 8, increase only if hitting ceiling
2. **Monitor idle time**: If clusters idle > 50% time, reduce max ACU
3. **Consolidate small tenants**: Move low-usage tenants to shared clusters
4. **Reserved capacity**: Consider Aurora Reserved Instances for predictable baseline

---

## Operations

### Provisioning a New Cluster

```bash
# Using AWS CLI
aws rds create-db-cluster \
  --db-cluster-identifier coheus-tenant-002 \
  --engine aurora-postgresql \
  --engine-version 15.4 \
  --serverless-v2-scaling-configuration MinCapacity=0.5,MaxCapacity=8 \
  --master-username coheusadmin \
  --master-user-password ${DB_PASSWORD} \
  --vpc-security-group-ids ${SECURITY_GROUP} \
  --db-subnet-group-name coheus-db-subnet-group \
  --storage-encrypted \
  --kms-key-id ${KMS_KEY_ARN}

# Create instance in cluster
aws rds create-db-instance \
  --db-instance-identifier coheus-tenant-002-instance \
  --db-cluster-identifier coheus-tenant-002 \
  --db-instance-class db.serverless \
  --engine aurora-postgresql
```

### Creating a Tenant Database

```sql
-- Connect to cluster as admin
-- Create new database for tenant
CREATE DATABASE tenant_acme_mortgage;

-- Create tenant user with limited privileges
CREATE USER tenant_acme WITH PASSWORD '${ENCRYPTED_PASSWORD}';
GRANT CONNECT ON DATABASE tenant_acme_mortgage TO tenant_acme;
GRANT USAGE ON SCHEMA public TO tenant_acme;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tenant_acme;

-- Switch to tenant database and run migrations
\c tenant_acme_mortgage
-- Run migration scripts...
```

### Cluster Maintenance

```bash
# Apply minor version upgrade (automatic with maintenance window)
aws rds modify-db-cluster \
  --db-cluster-identifier coheus-tenant-001 \
  --engine-version 15.5 \
  --apply-immediately

# Failover to test HA
aws rds failover-db-cluster \
  --db-cluster-identifier coheus-tenant-001
```

---

## Monitoring

### Key Metrics to Monitor

| Metric | Threshold | Action |
|--------|-----------|--------|
| ACUUtilization | > 90% sustained | Increase max ACU |
| ServerlessDatabaseCapacity | Hitting max | Scale max ACU |
| CPUUtilization | > 80% | Check for slow queries |
| DatabaseConnections | > 80% of max | Increase connection pool |
| FreeableMemory | < 1 GB | Increase min ACU |

### CloudWatch Dashboard

```json
{
  "widgets": [
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["AWS/RDS", "ACUUtilization", "DBClusterIdentifier", "coheus-tenant-001"],
          ["AWS/RDS", "ACUUtilization", "DBClusterIdentifier", "coheus-tenant-002"]
        ],
        "title": "ACU Utilization by Cluster"
      }
    },
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["AWS/RDS", "DatabaseConnections", "DBClusterIdentifier", "coheus-tenant-001"]
        ],
        "title": "Database Connections"
      }
    }
  ]
}
```

### Alerts Configuration

```hcl
# Terraform CloudWatch Alarms

resource "aws_cloudwatch_metric_alarm" "aurora_high_cpu" {
  alarm_name          = "coheus-aurora-high-cpu"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_actions       = [aws_sns_topic.alerts.arn]
  
  dimensions = {
    DBClusterIdentifier = aws_rds_cluster.tenant.id
  }
}

resource "aws_cloudwatch_metric_alarm" "aurora_max_acu" {
  alarm_name          = "coheus-aurora-hitting-max-acu"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 2
  metric_name         = "ServerlessDatabaseCapacity"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Maximum"
  threshold           = 7.5  # 93% of 8 ACU max
  alarm_actions       = [aws_sns_topic.alerts.arn]
}
```

---

## Disaster Recovery

### Backup Strategy

| Backup Type | Frequency | Retention | Purpose |
|-------------|-----------|-----------|---------|
| Automated PITR | Continuous | **35 days** | Point-in-time recovery (in-region) |
| AWS Backup (daily) | Daily (02:00–06:00 UTC) | 35 days | Centralized backup with cross-region copy |
| AWS Backup (monthly) | 1st of month | 365 days | Long-term retention |
| Cross-region copy | Daily (via AWS Backup `CopyActions`) | 35 days (DR vault) | Cold DR — restore in `us-east-1` from snapshot |

**RTO / RPO:** In-region restore ~4 hours; cross-region cold restore 8–24 hours. RPO up to 24 hours for cross-region (last daily backup). Cohi is not critical financial infrastructure — these targets reflect a practical cost/downtime balance.

### Point-in-Time Recovery

```bash
# Restore cluster to specific point in time
aws rds restore-db-cluster-to-point-in-time \
  --source-db-cluster-identifier coheus-tenant-001 \
  --db-cluster-identifier coheus-tenant-001-restored \
  --restore-to-time 2024-01-15T10:00:00Z \
  --vpc-security-group-ids ${SECURITY_GROUP} \
  --db-subnet-group-name coheus-db-subnet-group
```

### Cross-Region DR (Cold Snapshot)

> **Production Cohi default (2026-05):** cross-region DR is **cold** — AWS Backup `CopyActions` copy daily cluster snapshots to vault `coheus-<env>-cohi-dr-copy` in `us-east-1`, plus a DR landing VPC from `coheus_aurora_secondary_stack.yaml`. Restore runbook: [`scripts/dr/restore-from-snapshot.sh`](../../scripts/dr/restore-from-snapshot.sh).

Aurora Global Database is **not used**. The `EnableGlobalDatabaseParam` parameter in `coheus_aurora_cluster_stack.yaml` remains for legacy compatibility but defaults to `false`.

### Cross-Region Restore Procedure

1. **Detect**: CloudWatch alarm / manual assessment indicates primary region (`us-east-2`) is unavailable
2. **Assess**: Determine if cross-region failover is necessary (expected to be hours, not minutes)
3. **Restore**: Run `scripts/dr/restore-from-snapshot.sh` to create a new Aurora cluster in `us-east-1` from the latest DR vault recovery point
4. **Cutover**: Update Secrets Manager, ECS task definitions, and DNS/CloudFront to point at the new cluster endpoint
5. **Regenerate**: Trigger podcast audio regeneration from restored tenant data (podcasts are not backed up)
6. **Validate**: Confirm application health before directing production traffic
7. **Notify**: Alert customers of the incident and recovery

---

## Related Documentation

### Architecture
- [MULTI_TENANT.md](./MULTI_TENANT.md) - Multi-tenant architecture overview
- [OVERVIEW.md](./OVERVIEW.md) - System architecture
- [INTERNAL_ADMIN_REQUIREMENTS.md](./INTERNAL_ADMIN_REQUIREMENTS.md) - Tenant management features

### Deployment
- [TERRAFORM_MODULES.md](../deployment/TERRAFORM_MODULES.md) - Infrastructure as code
- [AWS_MARKETPLACE.md](../deployment/AWS_MARKETPLACE.md) - AWS Marketplace publishing
