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
- [`coheus_aurora_cluster_stack.yaml`](../../infrastructure/cloudformation/coheus_aurora_cluster_stack.yaml) GlobalCluster is deployed for the cluster under test (today: **prod + management** only in the template).
- [`coheus_aurora_secondary_stack.yaml`](../../infrastructure/cloudformation/coheus_aurora_secondary_stack.yaml) is deployed in the DR region.
- Optional: [`coheus_ecs_fargate_stack.yaml`](../../infrastructure/cloudformation/coheus_ecs_fargate_stack.yaml) podcast CRR parameters and [`coheus_waf_cloudfront_stack.yaml`](../../infrastructure/cloudformation/coheus_waf_cloudfront_stack.yaml) `DRSecondaryBackendOriginDomain` for API failover.

Extended tests cover what was previously listed as “out of scope” without IaC:

| Former gap | Now covered by |
| ---------- | -------------- |
| Cross-region failover | §9.2 CloudFront origin-group behavior; §8 tabletop for DNS and ECS |
| Aurora Global Database promotion | §9.1 Replication health; §9.3 promotion **sandbox only** (read AWS docs before running) |
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
  --engine                       aurora-postgresql `
  --region $rg --profile $prof
```

### 3.3 Create a serverless instance on the restored cluster

```powershell
aws rds create-db-cluster-instance `
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
| 2026-05-12 | Test 1 — Aurora PITR (baseline) | *pending operator* | *TBD* | Pending | *TBD* | CLI smoke test recommended before full drill ([`DR_DEPLOY_CHECKLIST.md`](./DR_DEPLOY_CHECKLIST.md) Phase 0). |
| *Post Phase 1* | Test 1 — Aurora PITR | | | Pending | | Re-run after reader + backup stack ([`DR_BACKLOG.md`](./DR_BACKLOG.md) COHI-DR-009). |
| *Post Phase 1* | Test 2 — ECS rollback | | | Pending | | |
| *Post Phase 1* | Test 3 — Frontend rebuild | | | Pending | | |

---

## 7. Cadence

Recommended minimum cadence (until a formal DR policy supersedes this):

| Test | Cadence |
| ---- | ------- |
| Test 1 — Aurora PITR | Quarterly |
| Test 2 — ECS rollback | Quarterly (or after every change to deployment config) |
| Test 3 — Frontend rebuild | Twice per year |
| Tabletop region-loss exercise | Annual — engineering + product (see §8) |
| Phase 2+ suite (§9.1, §9.2, §9.4; §9.3 sandbox only; §9.5 process review) | Quarterly once DR region is live; after each DR-templating change |

---

## 8. Region-loss tabletop (Phase 2)

Run after cross-region building blocks are documented and stakeholders are available (no AWS changes required).

### 8.1 Participants

- Incident commander (facilitator)
- Primary on-call engineer
- Product or customer success representative

### 8.2 Scenario

Assume **primary region (`us-east-2`) is unavailable** for 4+ hours. AWS status indicates a regional impairment; your data plane in the secondary region is deployed per [`DR_DEPLOY_CHECKLIST.md`](./DR_DEPLOY_CHECKLIST.md).

### 8.3 Discussion prompts (60–90 minutes)

1. Who declares a disaster vs. a transient outage? What evidence is required?
2. What is the exact order of operations to **promote** the Aurora secondary cluster (if using Global Database) and point the application at it?
3. How do customers reach the app if DNS still points to primary CloudFront / ALB?
4. Which secrets and certificates must be valid in the secondary region?
5. What do we communicate, and when, using [`DR_POLICY.md`](./DR_POLICY.md) §5?
6. What did we **not** automate (e.g. warm secondary ECS), and what is the time cost?

### 8.4 Record

Capture: date, attendees, top 5 gaps, owner per gap, and target dates. Store with incident readiness materials or link from [`DR_BACKLOG.md`](./DR_BACKLOG.md) story COHI-DR-015.

---

## 9. Phase 2+ technical tests (extended scope)

Run only after **§1.2** preconditions are met. Prefer a **dedicated DR rehearsal** account or strictly time-boxed windows; several steps are unsafe on production without executive approval.

### 9.1 Aurora Global Database — replication health

**Goal:** Prove the secondary cluster is attached and replicating.

1. `aws rds describe-db-clusters --region <primary> --db-cluster-identifier <management-cluster>` — note `GlobalWriteForwardingStatus` / membership as applicable.
2. `aws rds describe-db-clusters --region <dr-region> --db-cluster-identifier <secondary-cluster-id>` — status `available`.
3. CloudWatch: `AuroraGlobalDBReplicationLag` (or equivalent) below your policy threshold for 24h after any major deploy.

**Pass:** Secondary cluster `available`; lag metric within threshold. **Log row in §6.**

### 9.2 CloudFront API origin-group failover

**Goal:** Prove viewers fail over when the **primary** custom origin returns 5xx (matches origin-group status codes in [`coheus_waf_cloudfront_stack.yaml`](../../infrastructure/cloudformation/coheus_waf_cloudfront_stack.yaml)).

**Preconditions:** `DRSecondaryBackendOriginDomain` set; secondary ALB (or TLS hostname) healthy in DR region.

**Procedure (outline):**

1. From a machine outside the VPC, `curl -sI https://<cloudfront-domain>/health` — expect `200` from primary.
2. In a **controlled** way, make the primary origin return `503` (temporary rule on primary ALB listener, or scale primary service to `0` in **dev** only).
3. Repeat `curl`; within TTL for that path (should be none — caching disabled for `/health`), confirm traffic succeeds if secondary is healthy.
4. Restore primary; confirm CloudFront returns to primary behavior.

**Pass:** Failover observed without manual DNS edits; primary restored cleanly. **Log row in §6.**

### 9.3 Aurora secondary promotion (sandbox / game-day only)

**Goal:** Exercise **removing the secondary from the global cluster and promoting it** to a standalone writer for RTO measurement.

**Warning:** Wrong ordering can strand writes or split-brain. Do **not** run against prod until a written runbook is reviewed by a second DBA. Use AWS’s current documentation for `remove-from-global-cluster` / `failover-global-cluster` APIs.

**Sandbox pass criteria:** promoted cluster accepts writes; application (or psql smoke test) connects using credentials rotated for that rehearsal; teardown restores global topology or destroys the sandbox stack.

**Log in §6** with “sandbox promotion drill” and measured minutes end-to-end.

### 9.4 S3 cross-region replication (podcast bucket)

**Goal:** Objects written to `coheus-<env>-podcast-audio-<account>` in the primary region appear in the replica bucket from [`coheus_aurora_secondary_stack.yaml`](../../infrastructure/cloudformation/coheus_aurora_secondary_stack.yaml) (or equivalent), per [`DR_DEPLOY_CHECKLIST.md`](./DR_DEPLOY_CHECKLIST.md) Appendix A.

**Procedure:**

1. Upload a uniquely named small object to the primary podcast bucket.
2. Within **15 minutes** (RTC rule), `aws s3api head-object --bucket <replica> --key <same-key> --region <dr-region>` succeeds.

**Pass:** Object exists in replica with expected size/etag. **Log row in §6.**

### 9.5 KMS CMK loss / break-glass (no live destructive test)

**Goal:** Validate **process**, not AWS behavior (CMK deletion is irreversible and must not be drilled in a shared account).

Use instead:

- Tabletop **§8** item covering “KMS unavailable” and who holds break-glass access.
- Verify [`DEPLOYMENT_RUNBOOK.md`](./DEPLOYMENT_RUNBOOK.md) Secrets section + IAM policies reference the correct CMK ARNs after any key rotation.

**Pass:** Documented decision in tabletop notes; no CMK `ScheduleKeyDeletion` in any drill.

---

## 10. Safety rules

1. **Never run any of these tests against prod identifiers** without an explicit, written change request and a second operator on the call. **§9.3** (Aurora promotion) is **sandbox or game-day only** until a signed prod runbook exists.
2. **Always run §3.5, §4.4, §5.5 cleanups** — these tests create billable resources or leave a service on an unwanted task definition. **§9** drills must restore primary ALB / ECS scale / global topology (or destroy rehearsal stacks) the same day.
3. **If any pass criterion fails**, stop and capture: AWS console screenshots, the failing command output, and the time. File a follow-up in the team tracker before re-running.
4. **Do not run more than one test concurrently** in the same dev environment.

---

## 11. References

- [`DISASTER_RECOVERY.md`](./DISASTER_RECOVERY.md) — current state and recommendations
- [`DEPLOYMENT_RUNBOOK.md`](./DEPLOYMENT_RUNBOOK.md) — general deploy/operations runbook
- [`../architecture/AURORA_CLUSTERS.md`](../architecture/AURORA_CLUSTERS.md) — Aurora architecture and target DR design
- `infrastructure/cloudformation/coheus_aurora_cluster_stack.yaml`
- `infrastructure/cloudformation/coheus_ecs_fargate_stack.yaml`
- `infrastructure/cloudformation/coheus_frontend_cloud_front_s3_stack.yaml`
- `infrastructure/cloudformation/coheus_waf_cloudfront_stack.yaml`
- `infrastructure/cloudformation/coheus_aurora_secondary_stack.yaml`
- [`DR_DEPLOY_CHECKLIST.md`](./DR_DEPLOY_CHECKLIST.md)
