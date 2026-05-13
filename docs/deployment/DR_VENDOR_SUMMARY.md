# Cohi — Disaster Recovery and Business Continuity Summary

**Prepared for:** Vendor management, compliance review, and client due diligence  
**Application:** Cohi multi-tenant SaaS platform  
**AWS Account:** `339712788893`  
**Primary region:** `us-east-2` (Ohio)  
**Designated DR region:** `us-east-1` (N. Virginia)  
**Date:** 2026-05-12  
**Document owner:** Engineering  
**Review cadence:** Annually, or after any architectural change to DR controls

---

## 1. Executive summary

Cohi is a multi-tenant SaaS application deployed on AWS using Infrastructure as Code (CloudFormation). The platform's disaster recovery program provides layered protection across three dimensions:

1. **Data durability** — automated database backups with 35-day point-in-time recovery, a centralized AWS Backup vault with daily and monthly retention policies, S3 versioning, and **daily cross-region snapshot copies** to a vault in `us-east-1`.
2. **Service availability** — stateless compute on ECS Fargate with deployment circuit-breakers and automatic rollback, Multi-AZ database topology with a hot reader instance, and CloudFront CDN with origin-group failover.
3. **Process and governance** — a written DR policy with tiered RTO/RPO targets, quarterly test drills with documented results, an annual tabletop exercise, and a defined escalation path.

Cohi is **not** critical financial infrastructure — there is no real-time payment processing or regulatory uptime SLA. Recovery targets are set accordingly (hours, not minutes).

All DR controls are codified in version-controlled CloudFormation templates and deployed through auditable CI/CD pipelines (Bitbucket Pipelines with OIDC authentication).

---

## 2. Architecture overview

| Layer | Technology | Stateful | DR controls |
| ----- | ---------- | -------- | ----------- |
| Database | Aurora Serverless v2 PostgreSQL | Yes | PITR (35 days), automated snapshots, deletion protection (prod), Multi-AZ reader instance, AWS Backup (daily + monthly), **cross-region backup copies** to `us-east-1` (cold DR; restore is manual) |
| Application API | ECS Fargate | No | Deployment circuit-breaker with auto-rollback, ECR image retention, ALB health checks, auto-scaling (2–10 tasks) |
| Frontend | S3 + CloudFront | Rebuildable | S3 versioning with 30-day noncurrent expiry, CI/CD rebuild, CloudFront invalidation |
| File storage | S3 (internal artifacts) | Ephemeral / regenerable | KMS encryption, lifecycle expiry (14–30 days), `DeletionPolicy: Retain`. Not backed up — no customer data |
| Encryption | KMS customer-managed keys | Critical | `DeletionPolicy: Retain`, `UpdateReplacePolicy: Retain` |
| Secrets | AWS Secrets Manager | Critical | KMS-encrypted, documented re-seed runbook |
| CDN / WAF | CloudFront + AWS WAF | Rebuildable | Origin-group failover between primary and secondary backends |
| Monitoring | CloudWatch, SNS | Detection | Alarms on CPU, ACU, connections, memory, ALB 5xx, ECS error logs |

---

## 3. Recovery objectives

Cohi is **not** critical financial infrastructure (no real-time transaction processing, no regulatory SLA on uptime). Recovery targets reflect a practical balance between cost and acceptable downtime.

| Tier | Components | RPO (max data loss) | RTO (max outage) |
| ---- | ---------- | ------------------- | ----------------- |
| T1 — Database | Aurora PostgreSQL (management + tenant clusters) | **Near-zero** for in-region incidents (Aurora PITR — restore to any second within the last 35 days); **up to 24 hours** for regional loss (last successful daily AWS Backup copy to DR vault) | **4 hours** (in-region restore); **8–24 hours** (cold cross-region restore from snapshot + full app cutover) |
| T2 — Application | ECS Fargate API and worker services | None (stateless) | **4 hours** |
| T3 — Frontend | S3 static assets + CloudFront | None (rebuilt from CI) | **4 hours** |

These targets are validated through recurring drills documented in the test evidence section below.

---

## 4. Backup strategy

### 4.1 Aurora PostgreSQL

| Control | Configuration |
| ------- | ------------- |
| Automated PITR | 35-day retention window |
| Backup window | 03:00–04:00 UTC daily |
| Final snapshot on delete | `DeletionPolicy: Snapshot` on all clusters |
| Deletion protection | Enabled for production |
| Snapshots tagged | `CopyTagsToSnapshot: true` |

### 4.2 AWS Backup (centralized)

| Setting | Value |
| ------- | ----- |
| Vault | `coheus-prod-cohi-backup` (KMS-encrypted) |
| Daily rule | Retain 35 days, backup window 02:00–06:00 UTC |
| Monthly rule | Retain 365 days, 1st of each month |
| Resource selection | Tag-based: `Project=coheus` AND `Environment=<env>` |
| Protected resource types | Aurora clusters (tag-based selection; individual DB instances excluded) |

### 4.3 S3 buckets

S3 buckets hold the frontend (rebuilt from CI), internal QA artifacts (30-day lifecycle), and generated podcast audio (14-day lifecycle). None contain irreplaceable customer data. Frontend versioning is enabled for rollback convenience. **No S3 buckets are included in the backup or cross-region replication scope.**

### 4.4 Cross-region backup copy

| Source | Destination | Mechanism | SLA |
| ------ | ----------- | --------- | --- |
| Aurora primary cluster (us-east-2) | DR backup vault + landing VPC (us-east-1) | AWS Backup `CopyActions` on daily rule | **Up to 24h** (daily schedule + copy job latency) |

---

## 5. Failover and recovery procedures

### 5.1 Database recovery (in-region)

**Procedure:** Aurora point-in-time recovery via AWS CLI. A new cluster is restored from the automated backup to any second within the 35-day retention window. A serverless instance is added, and connectivity is verified before application cutover.

**Tested:** Quarterly drill against the development environment. Results logged with date, operator, duration, and observed RTO.

### 5.2 Application recovery

**Procedure:** ECS Fargate services are stateless. Recovery is a task definition redeployment from the existing ECR image. The deployment circuit-breaker automatically rolls back failed deployments without manual intervention.

**Tested:** Quarterly drill — a deliberately broken task definition is deployed and the automatic rollback is observed end-to-end.

### 5.3 Frontend recovery

**Procedure:** The S3 bucket is rebuilt entirely from CI/CD. CloudFront cache is invalidated post-deploy. No manual file restoration is required.

**Tested:** Biannually — the development frontend bucket is emptied, rebuilt from CI, and recovery time is measured.

### 5.4 Cross-region failover

**Procedure:** If the primary region is unavailable, operators **restore a new Aurora cluster** in `us-east-1` from the latest cross-region backup recovery point (or RDS snapshot copy), using the DR landing-zone VPC/subnets/security group/KMS from [`coheus_aurora_secondary_stack.yaml`](../../infrastructure/cloudformation/coheus_aurora_secondary_stack.yaml). Runbook: [`scripts/dr/restore-from-snapshot.sh`](../../scripts/dr/restore-from-snapshot.sh). Application cutover (Secrets Manager, ECS task definitions, optional CloudFront origin) is **manual**. CloudFront origin-group failover can still route to a **secondary backend** once that ALB exists in DR.

**Estimated RTO:** 8–24 hours (DB restore + app cutover + validation).

**Tested:** Annual tabletop exercise with engineering and product stakeholders. Technical validation of backup copy jobs and (in non-prod) snapshot restore drills conducted quarterly where feasible.

---

## 6. Test program

### 6.1 Test cadence

| Test | Frequency | Environment | Method |
| ---- | --------- | ----------- | ------ |
| Aurora PITR drill | Quarterly | Development | Live restore, data verification, teardown |
| ECS rollback drill | Quarterly | Development | Deliberate bad deploy, observe circuit-breaker |
| Frontend rebuild drill | Biannually | Development | Bucket wipe, CI rebuild, measure RTO |
| AWS Backup cross-region copy / DR vault | Quarterly | Production / DR region | Confirm copy jobs complete; spot-check recovery point in DR vault |
| CloudFront origin failover | Quarterly | Development | Simulate primary 5xx, verify failover |
| Region-loss tabletop | Annually | N/A (discussion) | Scenario-based with engineering + product |

### 6.2 Test evidence log

All drill results are recorded in an internal test log with the following fields per entry:

- Date of test
- Test name and section reference
- Operator name
- Duration of drill
- Pass / fail outcome
- Observed RTO
- Notes and follow-up actions

Measured RTO/RPO values from drills are cross-referenced into the formal DR policy.

---

## 7. Incident response and escalation

### 7.1 Escalation path

| Timeframe | Role | Action |
| --------- | ---- | ------ |
| 0–15 min | On-call engineer | Triage, severity assessment, begin runbook |
| 15–30 min | Engineering lead | Resource allocation, customer comms decision |
| 30+ min (SEV-1) | Executive sponsor | External communications approval |

### 7.2 Customer communication

A templated communication process is defined internally, covering:

- Initial incident acknowledgment
- Impact scope and affected services
- Status update cadence (default: every 60 minutes)
- Resolution notification

---

## 8. Infrastructure as Code and change control

All DR controls are defined in version-controlled CloudFormation templates:

| Template | Purpose |
| -------- | ------- |
| `coheus_aurora_cluster_stack.yaml` | Aurora clusters, backup retention, optional Global Database (off by default), reader instance |
| `coheus_ecs_fargate_stack.yaml` | ECS Fargate, ALB, KMS, Secrets Manager, S3 buckets |
| `coheus_frontend_cloud_front_s3_stack.yaml` | Frontend S3 bucket with versioning |
| `coheus_waf_cloudfront_stack.yaml` | WAF, CloudFront, origin-group failover |
| `coheus_backup_stack.yaml` | AWS Backup vault, plan, resource selection, optional cross-region copy to DR vault |
| `coheus_aurora_secondary_stack.yaml` | DR region landing zone: VPC, DB subnet group, SG, KMS, **DR backup vault**, optional replica S3 bucket |
| `coheus_monitoring_stack.yaml` | CloudWatch dashboards, alarms, SNS topics |

Changes to these templates follow the standard development workflow:

1. Code review via pull request (Bitbucket)
2. Template validation (`aws cloudformation validate-template`)
3. Development environment deployment and verification
4. Production deployment during scheduled maintenance window (Sunday 04:00–05:00 UTC)
5. Post-deployment verification

DR-specific stacks (backup vault, Global Database enablement, secondary region) are deployed via a dedicated manual-trigger pipeline (`dr-stacks-dev` / `dr-stacks-prod`) using OIDC-authenticated IAM roles.

---

## 9. Compliance alignment

| Framework control | How Cohi addresses it |
| ----------------- | --------------------- |
| SOC 2 CC7.1 — Detection | CloudWatch alarms, SNS notifications, ALB health checks |
| SOC 2 CC7.2 — Response | Documented escalation path, incident communication template |
| SOC 2 CC7.3 — Recovery | Documented and tested recovery procedures with measured RTO/RPO |
| SOC 2 CC7.4 — Lessons learned | Tabletop exercises with gap tracking; drill follow-ups logged |
| SOC 2 CC7.5 — Restore to normal | Tested restore procedures (PITR, ECS rollback, frontend rebuild) |
| General data protection | Encryption at rest (KMS), encryption in transit (TLS), access via IAM/SSO |

---

## 10. Cost of DR controls

| Component | Monthly cost (prod, estimated) |
| --------- | ------------------------------ |
| Aurora reader instance (Multi-AZ) | $48–88 |
| AWS Backup vault retention | $3 |
| Extended PITR storage | $1 |
| Cross-region backup copy storage (us-east-1 vault) | **~$0.03** (tiny at current DB size) |
| Frontend versioning storage | < $1 |
| **Total** | **~$53–93/month** |


---

## 11. Supporting documentation

The following internal documents are maintained by engineering and are available upon request:

- **DR Policy** — formal policy with RTO/RPO targets, roles, escalation path, and communications template
- **DR Test Plan and Procedures** — executable test procedures with pass criteria, cadence, and an evidence log of all historical drill results
- **Deployment Runbook** — general operations runbook including secrets rotation and re-seed procedures
- **Infrastructure as Code** — all CloudFormation templates referenced in section 8, version-controlled in the application repository

---

## 12. Review and approval

| Role | Name | Date | Signature |
| ---- | ---- | ---- | --------- |
| Engineering lead | | | |
| Product owner | | | |
| Executive sponsor | | | |

This document should be reviewed annually or when significant changes are made to the DR architecture. The next scheduled review is **2027-05-12**.
