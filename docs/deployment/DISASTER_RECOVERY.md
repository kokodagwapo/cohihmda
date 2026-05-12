# Cohi Disaster Recovery — Current State

Scope: Cohi (CoHi/coheus SaaS) resources defined in `infrastructure/` and verified in AWS account `339712788893` (`us-east-2`). Marketplace self-hosted, internal lender platform, and DynamoDB-backed peripheral stacks are intentionally excluded.

Date of review: 2026-05-12.

---

## 1. In-scope resources

Only the following stacks are considered "Cohi core":

| Layer | IaC source | Stateful? |
| ----- | ---------- | --------- |
| Aurora Serverless v2 PostgreSQL (management + tenant clusters) | `infrastructure/cloudformation/coheus_aurora_cluster_stack.yaml` | Yes — primary system of record |
| ECS Fargate backend (API + worker), ALB, ECR, KMS, Secrets Manager, application S3 buckets | `infrastructure/cloudformation/coheus_ecs_fargate_stack.yaml` | Stateless compute; S3 buckets stateful |
| Frontend S3 + CloudFront | `infrastructure/cloudformation/coheus_frontend_cloud_front_s3_stack.yaml` | Rebuildable from CI |
| WAF + alternate CloudFront/frontend | `infrastructure/cloudformation/coheus_waf_cloudfront_stack.yaml` | Rebuildable |
| VPC / networking | `infrastructure/cloudformation/coheus_ecs_fargate_stack.yaml` | Rebuildable |
| Monitoring / alarms / SNS | `infrastructure/cloudformation/coheus_monitoring_stack.yaml` | Detection only |

---

## 2. What is in place today

### 2.1 Aurora Serverless v2 (PostgreSQL)

Defined in `infrastructure/cloudformation/coheus_aurora_cluster_stack.yaml`.

| Control | Configured? | Source / Evidence |
| ------- | ----------- | ----------------- |
| Encryption at rest (KMS) | Yes | `StorageEncrypted: true`, `KmsKeyId: !If [CreateKMSKey, ...]` |
| Automated backups (PITR) | Yes — 7 days default (configurable 1–35) | `BackupRetentionPeriod: !Ref BackupRetentionDays` (`Default: 7`) |
| Preferred backup window | Yes | `03:00-04:00` |
| Final snapshot on stack delete | Yes | `DeletionPolicy: Snapshot`, `UpdateReplacePolicy: Snapshot` |
| Deletion protection | Yes (prod only) | `DeletionProtection: !If [IsProdEnvironment, true, false]` |
| Tags copied to snapshots | Yes | `CopyTagsToSnapshot: true` |
| CloudWatch logs export | Yes | `EnableCloudwatchLogsExports: [postgresql]` |
| Performance Insights | Optional (default on) | `EnablePerformanceInsights` parameter |

Live verification (`aws rds describe-db-clusters --region us-east-2`):

- `coheus-prod-management` — Encrypted **true**, Retention **7**, DeletionProtection **true**, `MultiAZ: False`.
- `coheus-dev-management` — Encrypted **true**, Retention **7**, DeletionProtection **false**.
- Most recent automated snapshot observed for prod: `rds:coheus-prod-management-2026-05-06-03-05`.
- `aws rds describe-global-clusters` → empty (no Aurora Global Database).

### 2.2 ECS Fargate backend

Defined in `infrastructure/cloudformation/coheus_ecs_fargate_stack.yaml`.

- Stateless workload — recovery means redeploying the task definition and image.
- Auto-scaling between `MinCount: 2` and `MaxCount: 10`; separate worker service.
- Health checks on `/health` via ALB target group.
- Container images stored in **ECR repo with `DeletionPolicy: Retain`** and `UpdateReplacePolicy: Retain`; lifecycle policy keeps last 10 images.
- Secrets pulled from **AWS Secrets Manager** at runtime, KMS-encrypted (CMK provisioned in the same stack).
- ALB is internet-facing; rebuilds from CloudFormation if destroyed.

Live verification: ECS cluster `coheus-prod-cluster` in `us-east-2` contains `coheus-prod-service` and `coheus-prod-worker-service`.

### 2.3 Application S3 buckets (created inside ECS stack)

| Bucket | DeletionPolicy | Versioning | Encryption | Lifecycle |
| ------ | -------------- | ---------- | ---------- | --------- |
| `${ProjectName}-${Environment}-qa-artifacts-${AWS::AccountId}` | Retain | No | KMS (CMK) | Expire after 30 days |
| `${ProjectName}-${Environment}-podcast-audio-${AWS::AccountId}` | Retain | Enabled | KMS (CMK) | Expire after 14 days |

Both buckets block public access and use the stack's CMK.

### 2.4 Frontend S3 + CloudFront

Two variants exist in `infrastructure/cloudformation/`:

| File | Bucket policy | Versioning | DeletionPolicy |
| ---- | ------------- | ---------- | -------------- |
| `coheus_frontend_cloud_front_s3_stack.yaml` | OAC + private | Not enabled | Retain |
| `coheus_waf_cloudfront_stack.yaml` (frontend bucket inside WAF stack) | OAC + private | Enabled | (default — not Retain) |

Frontend assets are **rebuildable from CI**, so versioning is a convenience, not a hard dependency.

### 2.5 KMS, Secrets Manager, IAM

- A customer-managed KMS key is provisioned by the ECS stack with rotation handled by AWS (default policy applied).
- Secrets Manager entries hold DB credentials, JWT secrets, Cognito client secrets, QA-runner credentials, Jira webhook secret. All are referenced via `KmsKeyId: !Ref EncryptionKey`.
- IAM roles are stack-scoped and recreated by CloudFormation on redeploy.

### 2.6 Monitoring (detection only — not recovery)

From `infrastructure/cloudformation/coheus_monitoring_stack.yaml`:

- CloudWatch dashboard for ECS, ALB, RDS/Aurora.
- Alarms on CPU, ServerlessDatabaseCapacity (ACU), Connections, FreeableMemory, ALB 5xx, ECS error logs.
- SNS topics (`critical`, `warning`, `info`) with optional email + Teams webhook.
- Optional Route 53 health check.

These shorten **detection time** but do not perform any recovery action.

---

## 3. What is NOT in place

The following are explicitly absent from `infrastructure/`, AWS, or both:

1. **No written DR policy.** No RTO/RPO targets, owner, escalation path, or customer-comms plan in the repo.
2. **No cross-region replication for Aurora.** `aws rds describe-global-clusters` returned empty. The Aurora Global Database example in `docs/architecture/AURORA_CLUSTERS.md` is a target, not deployed.
3. **No cross-region snapshot copy** configured in the CloudFormation templates.
4. **No Aurora reader instance.** The CloudFormation template defines a single `AuroraInstance` (writer). Aurora storage is multi-AZ replicated and AWS will auto-replace the writer, but there is no hot reader to fail over to. Live API reports `MultiAZ: False`.
5. **No AWS Backup selection inside Cohi IaC.** Backup plans exist at the account/org level (`teraverde_*`, `tvma_*`); no `AWS::Backup::BackupSelection` resource in the Cohi stacks proves coverage of `coheus-*` resources.
6. **No recurring DR test / game-day** is encoded anywhere in the repo (no scripts, no runbooks calling for restore drills).
7. **No region diversity allowed by SCP.** Cohi runs in `us-east-2`; the active org SCP (`p-ud42m49v`) explicitly denies `ecs:ListClusters` / `rds:DescribeDBClusters` in `us-west-2` and `eu-west-1` for the dev SSO role. Any multi-region DR plan must clear SCP first.

---

## 4. Recovery scenarios and current capability

| Scenario | Currently recoverable? | How |
| -------- | ---------------------- | --- |
| Accidental DROP / corruption inside the last 7 days | Yes | Aurora PITR via `restore-db-cluster-to-point-in-time` |
| CloudFormation stack deletion of Aurora | Yes | Final snapshot created via `DeletionPolicy: Snapshot`; restore from snapshot |
| Loss of ECS service / tasks | Yes | ECS service redeploys from task definition; image still in ECR (`Retain`) |
| ALB/SG/IAM deletion | Yes | Redeploy `coheus_ecs_fargate_stack.yaml` |
| Frontend bucket wipe | Yes | Redeploy frontend from CI; CloudFront + OAC reattach |
| Loss of secrets in Secrets Manager | Partial | Secrets are KMS-encrypted but no documented re-seed procedure; manual rotation required |
| Loss of KMS CMK | No | Key deletion is irreversible after the pending window; nothing in IaC enforces multi-key strategy |
| Data loss older than 7 days | No | No long-retention snapshots or AWS Backup vault wired into Cohi IaC |
| Full `us-east-2` regional outage | No | No cross-region cluster, no replicated S3, no DNS failover plan |

---

## 5. Recommendations (prioritized, IaC-aligned)

Each recommendation maps to a concrete change in `infrastructure/` so the policy is reflected in code, not just a document. A full **rollout plan with engineering effort, dependencies, and AWS cost estimates** for these items is in [`DR_ROLLOUT_PLAN.md`](./DR_ROLLOUT_PLAN.md).

### 5.1 P0 — close obvious gaps without architectural change

1. **Raise prod backup retention** from 7 days to a policy-driven number (e.g., 14 or 35) by updating `BackupRetentionDays` in `coheus_aurora_cluster_stack.yaml`.
2. **Add an `AWS::Backup::BackupSelection`** to a new Cohi-owned stack that explicitly selects Cohi Aurora clusters and the Retain'd S3 buckets, with a vault retention longer than RDS PITR.
3. **Provision an `AWS::Backup::BackupVault`** dedicated to Cohi (separate from the org-wide `tvma_*` plans), with copy actions ready to enable to a secondary region once SCP allows.
4. **Document a Secrets Manager re-seed runbook** under `docs/deployment/` referencing the secret names already in `coheus_ecs_fargate_stack.yaml`.

### 5.2 P1 — improve in-region resilience

1. Add a **second Aurora reader instance** in another AZ for prod (a second `AWS::RDS::DBInstance` referencing the same cluster in `coheus_aurora_cluster_stack.yaml`). This is an Aurora-supported change and gives a hot failover target.
2. Enable **versioning on the prod frontend bucket** in `coheus_frontend_cloud_front_s3_stack.yaml` (the WAF-stack variant already does this).
3. Add **`UpdateReplacePolicy: Retain` and `DeletionPolicy: Retain` to KMS keys** in `coheus_ecs_fargate_stack.yaml` to prevent accidental key destruction.

### 5.3 P2 — multi-region (requires Org SCP review first)

1. Add an **`AWS::RDS::GlobalCluster`** wrapping the prod Aurora cluster and provision a minimal-capacity secondary cluster in an SCP-approved region.
2. Enable **CloudFront origin failover** or Route 53 health-checked routing to the secondary backend ALB.
3. Add **S3 cross-region replication** for application buckets that hold persistent data (`*-podcast-audio` if retained beyond 14 days, any future audit bucket).

### 5.4 P3 — policy and process

1. Publish a single-page **DR Policy** in `docs/deployment/` (RTO/RPO per tier, ownership, escalation, comms).
2. Define a quarterly **DR test calendar** with at least one PITR restore drill per quarter and an annual full game-day; record results in `docs/deployment/`.

---

## 6. Suggested test plan

Executable procedures, pass criteria, cadence, and a result log are documented in [`DR_TEST_PLAN.md`](./DR_TEST_PLAN.md). The three runnable tests today are:

| Test | Target | Summary |
| ---- | ------ | ------- |
| Aurora PITR drill | `coheus-dev-management` | Restore the dev cluster to a recent point in time, connect, and verify data freshness |
| ECS rollout / rollback | `coheus-dev-service` | Push a deliberately broken task definition and confirm the deployment circuit-breaker rolls back automatically |
| Frontend bucket wipe | Dev frontend S3 bucket | Empty the bucket, rebuild via CI, invalidate CloudFront, and measure recovery time |

The remaining scenarios in §4 (KMS loss, region-wide outage, long-retention restore) cannot be tested with current infrastructure and are blocked on the recommendations in §5.

---

## 7. References

- `infrastructure/cloudformation/coheus_aurora_cluster_stack.yaml`
- `infrastructure/cloudformation/coheus_ecs_fargate_stack.yaml`
- `infrastructure/cloudformation/coheus_frontend_cloud_front_s3_stack.yaml`
- `infrastructure/cloudformation/coheus_waf_cloudfront_stack.yaml`
- `infrastructure/cloudformation/coheus_monitoring_stack.yaml`
- `docs/architecture/AURORA_CLUSTERS.md` (existing target-state DR section)
- `docs/deployment/DEPLOYMENT_RUNBOOK.md` (snapshot CLI examples)
