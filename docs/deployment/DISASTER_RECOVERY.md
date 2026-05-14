# Cohi Disaster Recovery — Current State

Scope: Cohi (CoHi/coheus SaaS) resources defined in `infrastructure/` and verified in AWS account `339712788893` (`us-east-2`). Marketplace self-hosted, internal lender platform, and DynamoDB-backed peripheral stacks are intentionally excluded.

Date of review: 2026-05-12.

**Related:** [`DR_POLICY.md`](./DR_POLICY.md) · [`DR_TEST_PLAN.md`](./DR_TEST_PLAN.md) · [`DR_ROLLOUT_PLAN.md`](./DR_ROLLOUT_PLAN.md) · [`DR_DEPLOY_CHECKLIST.md`](./DR_DEPLOY_CHECKLIST.md) · [`DR_BACKLOG.md`](./DR_BACKLOG.md)

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
| Automated backups (PITR) | Yes — **35 days** default (configurable 1–35) | `BackupRetentionPeriod: !Ref BackupRetentionDays` (`Default: 35`) |
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
- `aws rds describe-global-clusters` → typically **empty** (`EnableGlobalDatabaseParam` defaults to **false**). Cross-region database durability is via **AWS Backup copy** to vault `coheus-<env>-cohi-dr-copy` in `us-east-1` when [`coheus_backup_stack.yaml`](../infrastructure/cloudformation/coheus_backup_stack.yaml) and the DR landing stack are deployed.

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

| Bucket | DeletionPolicy | Versioning | Encryption | Lifecycle | Backed up? |
| ------ | -------------- | ---------- | ---------- | --------- | ---------- |
| `${ProjectName}-${Environment}-qa-artifacts-${AWS::AccountId}` | Retain | No | KMS (CMK) | Expire after 30 days | No — ephemeral |
| `${ProjectName}-${Environment}-podcast-audio-${AWS::AccountId}` | Retain | Enabled | KMS (CMK) | Expire after 14 days | **No** — regenerable from source data on demand |

Both buckets block public access and use the stack's CMK. **Neither bucket is included in AWS Backup or cross-region replication** — QA artifacts are ephemeral and podcast audio is generated from tenant data stored in Aurora (which *is* backed up).

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

The following gaps remain **until deployed and ratified** (templates and runbooks may already exist in `infrastructure/cloudformation/` and `docs/deployment/`):

1. **DR policy not ratified.** [`DR_POLICY.md`](./DR_POLICY.md) is a **draft** until the checklist there is completed.
2. **Cross-region Aurora is cold DR.** Hot standby in DR is **not** deployed by default. [`coheus_aurora_secondary_stack.yaml`](../infrastructure/cloudformation/coheus_aurora_secondary_stack.yaml) defines the **landing zone** (VPC, public/private networking, conditional NAT for ECS drills, DR backup vault, KMS, optional S3 replica). Restore runbook: [`scripts/dr/restore-from-snapshot.sh`](../../scripts/dr/restore-from-snapshot.sh); ECS-in-DR scripts: [`scripts/dr/README.md`](../../scripts/dr/README.md). Blocked on Org SCP for the DR region until approved.
3. **Automated cross-region snapshot copy** requires the DR backup vault + `CopyActions` on the primary-region backup plan (see template); verify **Copy jobs** in AWS Backup after deploy.
4. **Second DB instance must be rolled out.** The template now defines a **reader** instance; existing environments need a stack update to materialize it.
5. **AWS Backup stack must be deployed and verified.** [`coheus_backup_stack.yaml`](../infrastructure/cloudformation/coheus_backup_stack.yaml) is new — confirm `BACKUP_JOB_COMPLETED` in console.
6. **Recurring DR drills are procedural** — use [`DR_TEST_PLAN.md`](./DR_TEST_PLAN.md) and [`DR_DEPLOY_CHECKLIST.md`](./DR_DEPLOY_CHECKLIST.md); calendar ownership is still required.
7. **Org SCP** (`p-ud42m49v`) still restricts which regions SSO/API may use; align secondary region with Org platform team.

---

## 4. Recovery scenarios and current capability

| Scenario | Currently recoverable? | How |
| -------- | ---------------------- | --- |
| Accidental DROP / corruption inside the PITR window (default **35 days**) | Yes | Aurora PITR via `restore-db-cluster-to-point-in-time` |
| CloudFormation stack deletion of Aurora | Yes | Final snapshot created via `DeletionPolicy: Snapshot`; restore from snapshot |
| Loss of ECS service / tasks | Yes | ECS service redeploys from task definition; image still in ECR (`Retain`) |
| ALB/SG/IAM deletion | Yes | Redeploy `coheus_ecs_fargate_stack.yaml` |
| Frontend bucket wipe | Yes | Redeploy frontend from CI; CloudFront + OAC reattach |
| Loss of secrets in Secrets Manager | Partial | Secrets are KMS-encrypted but no documented re-seed procedure; manual rotation required |
| Loss of KMS CMK | No | Key deletion is irreversible after the pending window; nothing in IaC enforces multi-key strategy |
| Data loss older than PITR window (35 days) plus no AWS Backup recovery | No | Enable and verify [`coheus_backup_stack.yaml`](../infrastructure/cloudformation/coheus_backup_stack.yaml) jobs; extend vault retention as needed |
| Full `us-east-2` regional outage | Partial (data) | AWS Backup copies / snapshots in `us-east-1` can be restored to a new Aurora cluster; **RTO 8–24 hours** without pre-built ECS in DR. See [`DR_POLICY.md`](./DR_POLICY.md) T1. Podcast audio is regenerable post-restore. |

---

## 5. Recommendations (prioritized, IaC-aligned)

Each recommendation maps to a concrete change in `infrastructure/` so the policy is reflected in code, not just a document. A full **rollout plan with engineering effort, dependencies, and AWS cost estimates** for these items is in [`DR_ROLLOUT_PLAN.md`](./DR_ROLLOUT_PLAN.md).

### 5.1 P0 — close obvious gaps without architectural change

1. **Confirm prod backup retention** is **35 days** (default in `coheus_aurora_cluster_stack.yaml`) after stack update; adjust parameter only if policy requires a different value (max 35 for Aurora PITR).
2. **Deploy [`coheus_backup_stack.yaml`](../infrastructure/cloudformation/coheus_backup_stack.yaml)** per [`DR_DEPLOY_CHECKLIST.md`](./DR_DEPLOY_CHECKLIST.md); confirm backup jobs complete for tagged resources.
3. **Optional:** extend AWS Backup with **cross-region copy** once Org SCP allows a backup vault in the DR region (see [`DR_ROLLOUT_PLAN.md`](./DR_ROLLOUT_PLAN.md)); **defaults are now enabled in `coheus_backup_stack.yaml`** after the DR vault stack exists.
4. **Secrets re-seed** — completed in [`DEPLOYMENT_RUNBOOK.md`](./DEPLOYMENT_RUNBOOK.md) (Secrets Manager section).

### 5.2 P1 — improve in-region resilience

1. **Roll out the second Aurora instance** (`AuroraReaderInstance` in `coheus_aurora_cluster_stack.yaml`) to all environments via stack update.
2. **Frontend versioning** — enabled in `coheus_frontend_cloud_front_s3_stack.yaml` (standalone) and in `coheus_waf_cloudfront_stack.yaml`; confirm which stack prod uses.
3. **KMS Retain** — applied to `EncryptionKey` in `coheus_ecs_fargate_stack.yaml`; deploy stack update.

### 5.3 P2 — multi-region (requires Org SCP review first)

1. **Deploy `coheus_aurora_secondary_stack.yaml` + enable backup `CopyActions`** in an SCP-approved region (see [`DR_DEPLOY_CHECKLIST.md`](./DR_DEPLOY_CHECKLIST.md)). One-time teardown of any legacy Global Database: [`scripts/dr/teardown-global-dr.sh`](../../scripts/dr/teardown-global-dr.sh).
2. **CloudFront origin failover** — set `DRSecondaryBackendOriginDomain` on `coheus_waf_cloudfront_stack.yaml` when a secondary ALB exists.

S3 cross-region replication for the podcast audio bucket is **not required** — podcast audio is generated from source data in Aurora and can be regenerated after a restore.

### 5.4 P3 — policy and process

1. **Ratify** [`DR_POLICY.md`](./DR_POLICY.md) after drills fill measured RTO/RPO.
2. **Calendar** — schedule quarterly drills using [`DR_TEST_PLAN.md`](./DR_TEST_PLAN.md) §7 and [`DR_BACKLOG.md`](./DR_BACKLOG.md).

---

## 6. Suggested test plan

Executable procedures, pass criteria, cadence, and a result log are documented in [`DR_TEST_PLAN.md`](./DR_TEST_PLAN.md). The three runnable tests today are:

| Test | Target | Summary |
| ---- | ------ | ------- |
| Aurora PITR drill | `coheus-dev-management` | Restore the dev cluster to a recent point in time, connect, and verify data freshness |
| ECS rollout / rollback | `coheus-dev-service` | Push a deliberately broken task definition and confirm the deployment circuit-breaker rolls back automatically |
| Frontend bucket wipe | Dev frontend S3 bucket | Empty the bucket, rebuild via CI, invalidate CloudFront, and measure recovery time |

The remaining scenarios in §4 (KMS loss, region-wide outage, long-retention restore) cannot be fully automated-tested today; use the tabletop in [`DR_TEST_PLAN.md`](./DR_TEST_PLAN.md) §8 after Phase 2 deploy, and the **Phase 2+** procedures in §9 where architecture supports them.

---

## 7. References

- [`DR_POLICY.md`](./DR_POLICY.md)
- [`DR_TEST_PLAN.md`](./DR_TEST_PLAN.md)
- [`DR_ROLLOUT_PLAN.md`](./DR_ROLLOUT_PLAN.md)
- [`DR_DEPLOY_CHECKLIST.md`](./DR_DEPLOY_CHECKLIST.md)
- [`DR_BACKLOG.md`](./DR_BACKLOG.md)
- `infrastructure/cloudformation/coheus_aurora_cluster_stack.yaml`
- `infrastructure/cloudformation/coheus_aurora_secondary_stack.yaml`
- `infrastructure/cloudformation/coheus_backup_stack.yaml`
- `infrastructure/cloudformation/coheus_ecs_fargate_stack.yaml`
- `infrastructure/cloudformation/coheus_ecs_fargate_stack.yaml`
- `infrastructure/cloudformation/coheus_frontend_cloud_front_s3_stack.yaml`
- `infrastructure/cloudformation/coheus_waf_cloudfront_stack.yaml`
- `infrastructure/cloudformation/coheus_monitoring_stack.yaml`
- `docs/architecture/AURORA_CLUSTERS.md` (existing target-state DR section)
- `docs/deployment/DEPLOYMENT_RUNBOOK.md` (snapshot CLI examples)
