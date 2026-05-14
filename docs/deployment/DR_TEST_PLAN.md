# Cohi Disaster Recovery — Test Plan

Companion runbook to [`DISASTER_RECOVERY.md`](./DISASTER_RECOVERY.md). This document describes how to execute, verify, and record DR tests against the Cohi infrastructure defined in `infrastructure/cloudformation/`.

Date created: 2026-05-12.

---

## 1. Purpose and scope

These tests validate that the recovery capabilities listed in [`DISASTER_RECOVERY.md`](./DISASTER_RECOVERY.md) §4 actually work end-to-end.

### 1.1 Core scope (always-on drills)

The procedures in **§3–§5** are written to run **against the dev environment** (`coheus-dev-*`) in `us-east-2` unless you explicitly promote a test to prod under change control. They do not require Global Database, CRR, or multi-region SCP exceptions.

- Aurora Serverless v2 point-in-time recovery (PITR)
- ECS Fargate rollout / rollback
- Frontend S3 + CloudFront rebuild

### 1.2 Extended scope (Phase 2+ — after architectural rollout)

Once the following are true, add the **§9** technical tests to your cadence and log them in **§6** like any other drill:

- Org SCP allows the DR region (e.g. `us-east-1`) for the roles you use.
- [`coheus_aurora_secondary_stack.yaml`](../../infrastructure/cloudformation/coheus_aurora_secondary_stack.yaml) is deployed in the DR region (landing zone + DR backup vault).
- [`coheus_backup_stack.yaml`](../../infrastructure/cloudformation/coheus_backup_stack.yaml) is deployed in the primary region with cross-region **copy** enabled (default) **after** the DR vault exists.
- Optional: [`coheus_waf_cloudfront_stack.yaml`](../../infrastructure/cloudformation/coheus_waf_cloudfront_stack.yaml) `DRSecondaryBackendOriginDomain` for API failover (when a secondary ALB exists).

Extended tests cover what was previously listed as “out of scope” without IaC:

| Former gap | Now covered by |
| ---------- | -------------- |
| Cross-region failover | §9.2 CloudFront origin-group behavior; §8 tabletop for DNS and ECS |
| Aurora cold restore from DR snapshot / backup | §9.1 DR backup copy verification; §9.3 snapshot restore **sandbox only** |
| KMS CMK loss recovery | §9.5 — **no** live destructive test; tabletop + key-management runbook |
| Region-wide outage failover | §8 tabletop + §9.2 partial technical validation |

Deployment order and parameters: [`DR_DEPLOY_CHECKLIST.md`](./DR_DEPLOY_CHECKLIST.md).

---

## 2. Prerequisites

| Item | How to satisfy |
| ---- | -------------- |
| AWS access | SSO into account `339712788893` with profile `DevEnvPerms-339712788893` |
| Region | `us-east-2` |
| IAM permissions | RDS full read, `rds:RestoreDBClusterToPointInTime`, `rds:CreateDBInstance`, `rds:DeleteDBCluster`, `rds:DeleteDBInstance`, `ecs:UpdateService`, S3 read/write on dev frontend bucket, CloudFront `CreateInvalidation` |
| DB connectivity | Either ECS exec into a running dev task or a one-shot Fargate task in a Cohi private subnet with the dev DB security group |
| Tools | AWS CLI v2, PowerShell 7 (commands below assume PowerShell), `psql` client available somewhere inside the VPC |
| Test window | Low-traffic period (dev only — coordinate with anyone actively using dev) |
| Backup retention status | Aurora dev cluster `BackupRetentionPeriod` matches policy (default **35** after stack update) |

Before each test, **announce the test in the team channel**, including the test number, expected duration, and resources you will create.

---

## 3. Test 1 — Aurora point-in-time recovery (PITR)

Validates that the automated backup / PITR window for Aurora is usable (default retention **35 days** after template rollout).

- Source: `coheus-dev-management`
- Target: temporary cluster `coheus-dev-management-drtest`
- Expected duration: 30–45 minutes (10–20 minutes is AWS provisioning time)
- Cost impact: one extra Aurora Serverless v2 cluster + instance for the duration of the drill (~$0.20/hour at idle)

### 3.1 Pre-flight — capture source parameters

```powershell
$prof = "DevEnvPerms-339712788893"
$rg   = "us-east-2"

aws rds describe-db-clusters `
  --db-cluster-identifier coheus-dev-management `
  --region $rg --profile $prof `
  --query "DBClusters[0].{Subnet:DBSubnetGroup,SGs:VpcSecurityGroups[].VpcSecurityGroupId,KMS:KmsKeyId,EarliestRestorable:EarliestRestorableTime,LatestRestorable:LatestRestorableTime}"
```

Record the returned values. Choose `$target` inside `[EarliestRestorable, LatestRestorable]` — typically 30 minutes before now.

### 3.2 Restore the cluster

```powershell
$target = (Get-Date).ToUniversalTime().AddMinutes(-30).ToString("yyyy-MM-ddTHH:mm:ssZ")

aws rds restore-db-cluster-to-point-in-time `
  --source-db-cluster-identifier coheus-dev-management `
  --db-cluster-identifier        coheus-dev-management-drtest `
  --restore-to-time              $target `
  --db-subnet-group-name         <SubnetGroup from 3.1> `
  --vpc-security-group-ids       <SGs from 3.1> `
  --kms-key-id                   <KmsKeyId from 3.1> `
  --region $rg --profile $prof
```

Do **not** pass `--engine` on this restore: current AWS CLI v2 treats `--engine` as ambiguous (it can match `--engine-mode` or `--engine-lifecycle-support`). The engine is taken from the source cluster.

### 3.3 Create a serverless instance on the restored cluster

```powershell
aws rds create-db-instance `
  --db-cluster-identifier  coheus-dev-management-drtest `
  --db-instance-identifier coheus-dev-management-drtest-1 `
  --db-instance-class      db.serverless `
  --engine                 aurora-postgresql `
  --region $rg --profile $prof

aws rds wait db-cluster-available  --db-cluster-identifier  coheus-dev-management-drtest    --region $rg --profile $prof
aws rds wait db-instance-available --db-instance-identifier coheus-dev-management-drtest-1 --region $rg --profile $prof
```

### 3.4 Verify the restored data

The restored cluster keeps the **same master credentials** as the source. Get the new endpoint:

```powershell
aws rds describe-db-clusters `
  --db-cluster-identifier coheus-dev-management-drtest `
  --region $rg --profile $prof `
  --query "DBClusters[0].Endpoint"
```

Then connect from inside the VPC. Two recommended paths:

1. **ECS exec into the dev API task** (already has Cohi network access):
   - `aws ecs execute-command --cluster coheus-dev-cluster --task <task-arn> --container <api-container> --interactive --command "/bin/sh" --region us-east-2 --profile <prof>`
   - Inside the shell: `psql -h <endpoint> -U coheusadmin -d coheus_management -c "SELECT max(created_at) FROM tenants;"` (any table that has a timestamp column works).
2. **One-shot Fargate task** in the same private subnet with a psql image — slower to set up but leaves no trace on a long-running task.

Pass criteria:

- Cluster reaches `available` without errors.
- You can authenticate with the source's master credentials.
- A representative table's row count or max timestamp is consistent with `$target` (i.e., does not include data written after `$target`).

### 3.5 Tear down (mandatory)

```powershell
aws rds delete-db-instance --db-instance-identifier coheus-dev-management-drtest-1 --skip-final-snapshot --region $rg --profile $prof
aws rds wait db-instance-deleted --db-instance-identifier coheus-dev-management-drtest-1 --region $rg --profile $prof
aws rds delete-db-cluster  --db-cluster-identifier  coheus-dev-management-drtest  --skip-final-snapshot --region $rg --profile $prof
```

Record the result in §6.

---

## 4. Test 2 — ECS rollout / rollback drill

Validates that a bad deploy to `coheus-dev-service` does not take dev down.

- Target: `coheus-dev-service` in cluster `coheus-dev-cluster`
- Expected duration: 10–15 minutes
- Cost impact: negligible

### 4.1 Pre-flight

```powershell
aws ecs describe-services `
  --cluster coheus-dev-cluster --services coheus-dev-service `
  --region us-east-2 --profile DevEnvPerms-339712788893 `
  --query "services[0].{Desired:desiredCount,Running:runningCount,TaskDef:taskDefinition,Circuit:deploymentConfiguration.deploymentCircuitBreaker}"
```

Confirm `deploymentCircuitBreaker.enable: true` and `rollback: true`. If either is `false`, **stop and enable them first** — the test relies on ECS performing the rollback automatically.

Record the current `taskDefinition` ARN as the known-good revision.

### 4.2 Trigger the bad deploy

Two safe ways to break the deploy without shipping broken application code:

- **Option A** — register a new task definition revision that points to an image tag that does not exist (e.g. `:dr-test-bad`). The container will fail to pull.
- **Option B** — register a new task definition revision that overrides an env var the app requires (e.g. `JWT_SECRET=`). Tasks will start and then fail the `/health` check.

Update the service to use the bad revision:

```powershell
aws ecs update-service `
  --cluster coheus-dev-cluster --service coheus-dev-service `
  --task-definition <bad-task-def-arn> `
  --region us-east-2 --profile DevEnvPerms-339712788893
```

### 4.3 Observe

Watch the deployment circuit-breaker take effect:

```powershell
while ($true) {
  aws ecs describe-services `
    --cluster coheus-dev-cluster --services coheus-dev-service `
    --region us-east-2 --profile DevEnvPerms-339712788893 `
    --query "services[0].deployments[].{Status:status,RolloutState:rolloutState,Running:runningCount,Pending:pendingCount,Desired:desiredCount}"
  Start-Sleep -Seconds 30
}
```

Also keep the dev ALB target group health in another window.

Pass criteria:

- New (bad) deployment reaches `rolloutState: FAILED`.
- ECS automatically rolls back to the previous (known-good) task definition.
- Old tasks remained `RUNNING` and `HEALTHY` throughout. ALB target group never went fully unhealthy.

### 4.4 Cleanup

- Confirm the service is back on the known-good revision: `services[0].taskDefinition` matches the value captured in §4.1.
- Deregister the bad task definition revision: `aws ecs deregister-task-definition --task-definition <bad-task-def-arn>`.

---

## 5. Test 3 — Frontend bucket wipe drill

Validates that the dev frontend can be rebuilt entirely from CI.

- Target: dev frontend S3 bucket (the one referenced by the dev CloudFront distribution)
- Expected duration: 10–20 minutes (mostly CI runtime)
- Cost impact: negligible

### 5.1 Pre-flight

Identify the dev bucket and distribution:

```powershell
aws s3 ls --profile DevEnvPerms-339712788893 | Select-String "frontend"
aws cloudfront list-distributions --profile DevEnvPerms-339712788893 `
  --query "DistributionList.Items[].{Id:Id,Aliases:Aliases.Items,Origin:Origins.Items[0].DomainName}"
```

Pick the dev bucket (do not select prod). Locally back up the bucket so the test is reversible if CI fails:

```powershell
aws s3 sync s3://<dev-frontend-bucket>/ ./dr-test-backup/ --profile DevEnvPerms-339712788893
```

### 5.2 Empty the bucket

```powershell
aws s3 rm s3://<dev-frontend-bucket>/ --recursive --profile DevEnvPerms-339712788893
```

Note the time (this is T0).

### 5.3 Rebuild via CI

Run the existing dev frontend deploy pipeline (Bitbucket pipeline or the corresponding `scripts/deploy/` script). Do not manually re-upload from `./dr-test-backup/` unless CI fails — the point of the drill is that CI alone is enough.

When the pipeline finishes, invalidate the CDN:

```powershell
aws cloudfront create-invalidation `
  --distribution-id <dev-dist-id> --paths "/*" `
  --profile DevEnvPerms-339712788893
```

### 5.4 Verify

- Load the dev site in a browser; confirm it renders, login works, and a known recent feature still shows.
- Record the elapsed time T_recovered − T0. This is your dev frontend RTO.

Pass criteria: site renders correctly using only assets produced by CI; nothing had to be hand-restored from `./dr-test-backup/`.

### 5.5 Cleanup

- Delete `./dr-test-backup/` locally once the site is confirmed healthy.

---

## 6. Result log

Record each test in this table (append rows; do not overwrite past results). Include **§3–§5** (core) and **§9** (Phase 2+) drills when executed. When this grows large, archive it into a quarterly file under `docs/deployment/`.

| Date | Test | Operator | Duration | Outcome | RTO observed | Notes / follow-ups |
| ---- | ---- | -------- | -------- | ------- | ------------ | ------------------ |
| 2026-05-12 | Test 1 — Aurora PITR (dev) | Engineering (CLI) | ~25 min (incl. teardown) | Pass | ~12 min infra (cluster+instance available) | Omit `--engine` on restore (CLI v2). Report: [`DR_TEST_REPORT_2026-05-12.md`](./DR_TEST_REPORT_2026-05-12.md). |
| 2026-05-12 | Test 2 — ECS rollback (dev) | Engineering (CLI) | ~12 min | Pass | ~12 min (auto-rollback) | Health-check-failure method (`:222`). `failedTasks` hit 4 (threshold 3), PRIMARY → `FAILED`, ECS auto-rolled back to `:220`. Old tasks stayed healthy throughout. |
| 2026-05-13 | Test 3 — Frontend rebuild (dev) | Engineering (CI) | ~10 min | Pass | ~10 min (bucket empty → site operational) | Bucket emptied, CI pipeline rebuilt and synced, CloudFront invalidated. Site rendered correctly from CI-only assets. |
| 2026-05-13 | Test 4 — AWS Backup vault check | Engineering (CLI) | ~5 min | Pass | N/A | Primary vault `coheus-dev-cohi-backup` confirmed with completed Aurora recovery points after first backup window. |
| 2026-05-13 | Test 5 — AWS Backup DR vault verification | Engineering (CLI) | ~10 min | Pass | N/A | DR vault `coheus-dev-cohi-dr-copy` in `us-east-1` confirmed ≥1 completed Aurora cross-region copy. Recovery point ARN verified and used for Phase C drill. |
| 2026-05-13 | Phase C — Full cold DR failover (dev) | Engineering (Bitbucket pipeline) | ~26 min | Pass | ~26 min (snapshot restore → healthy ALB) | `dr-failover.sh --environment dev` via `dr-failover-dev` pipeline. Snapshot restore, NAT enable, ECS deploy, `/health` check — all passed. Teardown completed same day. Report: [`DR_TEST_REPORT_2026-05-12.md`](./DR_TEST_REPORT_2026-05-12.md). |

---

## 7. Cadence

Recommended minimum cadence (until a formal DR policy supersedes this):

| Test | Cadence |
| ---- | ------- |
| Test 1 — Aurora PITR | Quarterly |
| Test 2 — ECS rollback | Quarterly (or after every change to deployment config) |
| Test 3 — Frontend rebuild | Twice per year |
| Tabletop region-loss exercise | Annual — engineering + product (see §8) |
| Phase 2+ suite (§9.1, §9.2; §9.3 sandbox only; §9.5 process review) | Quarterly once DR region is live; after each DR-templating change |

---

## 8. Region-loss tabletop (Phase 2)

Run after cross-region building blocks are documented and stakeholders are available (no AWS changes required).

### 8.1 Participants

- Incident commander (facilitator)
- Primary on-call engineer
- Product or customer success representative

### 8.2 Scenario

Assume **primary region (`us-east-2`) is unavailable** for 4+ hours. AWS status indicates a regional impairment; cross-region **data** exists as AWS Backup copies / snapshots in `us-east-1` per [`DR_DEPLOY_CHECKLIST.md`](./DR_DEPLOY_CHECKLIST.md).

### 8.3 Discussion prompts (60–90 minutes)

1. Who declares a disaster vs. a transient outage? What evidence is required?
2. What is the exact order of operations to **restore** Aurora in `us-east-1` from the last DR-region backup/snapshot and point the application at it (see [`scripts/dr/restore-from-snapshot.sh`](../../scripts/dr/restore-from-snapshot.sh))?
3. How do customers reach the app if DNS still points to primary CloudFront / ALB?
4. Which secrets and certificates must be valid in the secondary region?
5. What do we communicate, and when, using [`DR_POLICY.md`](./DR_POLICY.md) §5?
6. What did we **not** automate (e.g. warm secondary ECS), and what is the time cost?

### 8.4 Record

Capture: date, attendees, top 5 gaps, owner per gap, and target dates. Store with incident readiness materials or link from [`DR_BACKLOG.md`](./DR_BACKLOG.md) story COHI-DR-015.

---

## 9. Phase 2+ technical tests (extended scope)

Run only after **§1.2** preconditions are met. Prefer a **dedicated DR rehearsal** account or strictly time-boxed windows; several steps are unsafe on production without executive approval.

### 9.1 AWS Backup — cross-region copy to DR vault

**Goal:** Prove daily backups for tagged Aurora are **copied** to the DR-region vault (`coheus-<env>-cohi-dr-copy`).

1. AWS Backup console → **Backup vaults** (DR region) → open the vault → confirm recovery points for the management cluster resource.
2. **Copy jobs** → filter failed jobs; investigate any `RESOURCE_NOT_FOUND` (usually means DR vault missing at deploy time).

**Pass:** At least one completed copy within 48h of a successful primary backup. **Log row in §6.**

### 9.2 CloudFront API origin-group failover

**Goal:** Prove viewers fail over when the **primary** custom origin returns 5xx (matches origin-group status codes in [`coheus_waf_cloudfront_stack.yaml`](../../infrastructure/cloudformation/coheus_waf_cloudfront_stack.yaml)).

**Preconditions:** `DRSecondaryBackendOriginDomain` set; secondary ALB (or TLS hostname) healthy in DR region.

**Procedure (outline):**

1. From a machine outside the VPC, `curl -sI https://<cloudfront-domain>/health` — expect `200` from primary.
2. In a **controlled** way, make the primary origin return `503` (temporary rule on primary ALB listener, or scale primary service to `0` in **dev** only).
3. Repeat `curl`; within TTL for that path (should be none — caching disabled for `/health`), confirm traffic succeeds if secondary is healthy.
4. Restore primary; confirm CloudFront returns to primary behavior.

**Pass:** Failover observed without manual DNS edits; primary restored cleanly. **Log row in §6.**

### 9.3 Aurora restore from snapshot in DR (sandbox / game-day only)

**Goal:** Exercise **`restore-db-cluster-from-snapshot`** (or equivalent) into the DR landing-zone VPC and measure RTO for a **new** writer endpoint.

**Warning:** Creates billable Aurora capacity in the DR region. Use a **non-prod** snapshot or a time-boxed rehearsal cluster name. Tear down the restored cluster the same day.

**Sandbox pass criteria:** restored cluster `available`; SQL smoke test from a task or bastion in the DR VPC using **Node.js + `pg`** (see [`DR_TEST_PROCEDURES.md`](./DR_TEST_PROCEDURES.md) §1.6 — `psql` is not in the container image). Document minutes from “start restore” to “healthy endpoint”. Use [`scripts/dr/restore-from-snapshot.sh`](../../scripts/dr/restore-from-snapshot.sh).

**Log in §6** with “sandbox snapshot restore drill” and measured minutes end-to-end.

### 9.4 S3 cross-region replication — NOT APPLICABLE

Podcast audio is **regenerable** from source data stored in Aurora and does not require cross-region replication or backup. QA artifacts are ephemeral (30-day lifecycle). No S3 CRR test is needed. If a future non-regenerable bucket is introduced, add a replication test here.

### 9.5 KMS CMK loss / break-glass (no live destructive test)

**Goal:** Validate **process**, not AWS behavior (CMK deletion is irreversible and must not be drilled in a shared account).

Use instead:

- Tabletop **§8** item covering “KMS unavailable” and who holds break-glass access.
- Verify [`DEPLOYMENT_RUNBOOK.md`](./DEPLOYMENT_RUNBOOK.md) Secrets section + IAM policies reference the correct CMK ARNs after any key rotation.

**Pass:** Documented decision in tabletop notes; no CMK `ScheduleKeyDeletion` in any drill.

### 9.6 Full cold DR rehearsal (Phase C — application + DB)

Run only after DR landing stack includes **public subnets + conditional NAT** (`EnableCompute`), [`scripts/dr/deploy-dr-backend.sh`](../../scripts/dr/deploy-dr-backend.sh) has been exercised in dev, and SES/Cognito DR prerequisites in [`DR_DEPLOY_CHECKLIST.md`](./DR_DEPLOY_CHECKLIST.md) Phase B are satisfied.

**Outline (see plan + scripts):**

1. List recovery points in DR backup vault (`aws backup list-recovery-points-by-backup-vault`).
2. [`scripts/dr/restore-from-snapshot.sh`](../../scripts/dr/restore-from-snapshot.sh) — restore Aurora in `us-east-1`; record endpoint + secret ARN.
3. [`scripts/dr/deploy-dr-backend.sh`](../../scripts/dr/deploy-dr-backend.sh) — NAT + ECS/ALB in DR; record RTO from step 2 start to healthy `/health`.
4. ECS Exec + Node/`pg` SQL checks against restored DB (§1.6 procedures).
5. (Optional) CloudFront / WAF: point `DRSecondaryBackendOriginDomain` at DR ALB.
6. [`scripts/dr/teardown-dr-compute.sh`](../../scripts/dr/teardown-dr-compute.sh) — delete DR ECS stack, `EnableCompute=false`, delete rehearsal cluster.

**Pass:** End-to-end documented with timestamps; **log row in §6** (“Phase C cold DR rehearsal”).

---

## 10. Safety rules

1. **Never run any of these tests against prod identifiers** without an explicit, written change request and a second operator on the call. **§9.3** (Aurora snapshot restore) is **sandbox or game-day only** until a signed prod runbook exists.
2. **Always run §3.5, §4.4, §5.5 cleanups** — these tests create billable resources or leave a service on an unwanted task definition. **§9** drills must restore primary ALB / ECS scale / **delete rehearsal Aurora clusters** the same day.
3. **If any pass criterion fails**, stop and capture: AWS console screenshots, the failing command output, and the time. File a follow-up in the team tracker before re-running.
4. **Do not run more than one test concurrently** in the same dev environment.

---

## 11. References

- [`DR_TEST_PROCEDURES.md`](./DR_TEST_PROCEDURES.md) — step-by-step runbook with environment-specific values
- [`DR_TEST_REPORT_2026-05-12.md`](./DR_TEST_REPORT_2026-05-12.md) — executed drill report (2026-05-12 dev)
- [`DR_VENDOR_SUMMARY.md`](./DR_VENDOR_SUMMARY.md) — polished summary for vendor management and compliance
- [`DISASTER_RECOVERY.md`](./DISASTER_RECOVERY.md) — current state and recommendations
- [`DEPLOYMENT_RUNBOOK.md`](./DEPLOYMENT_RUNBOOK.md) — general deploy/operations runbook
- [`../architecture/AURORA_CLUSTERS.md`](../architecture/AURORA_CLUSTERS.md) — Aurora architecture and target DR design
- `infrastructure/cloudformation/coheus_aurora_cluster_stack.yaml`
- `infrastructure/cloudformation/coheus_ecs_fargate_stack.yaml`
- `infrastructure/cloudformation/coheus_frontend_cloud_front_s3_stack.yaml`
- `infrastructure/cloudformation/coheus_waf_cloudfront_stack.yaml`
- `infrastructure/cloudformation/coheus_aurora_secondary_stack.yaml`
- [`DR_DEPLOY_CHECKLIST.md`](./DR_DEPLOY_CHECKLIST.md)
