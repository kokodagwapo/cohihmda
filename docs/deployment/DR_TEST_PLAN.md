# Cohi Disaster Recovery — Test Plan

Companion runbook to [`DISASTER_RECOVERY.md`](./DISASTER_RECOVERY.md). This document describes how to execute, verify, and record DR tests against the Cohi infrastructure defined in `infrastructure/cloudformation/`.

Date created: 2026-05-12.

---

## 1. Purpose and scope

These tests validate that the recovery capabilities listed in `DISASTER_RECOVERY.md` §4 actually work end-to-end. All tests are designed to run **against the dev environment** (`coheus-dev-*`) in `us-east-2`. None of these tests touch prod data or prod services.

In scope for this plan:

- Aurora Serverless v2 point-in-time recovery (PITR)
- ECS Fargate rollout / rollback
- Frontend S3 + CloudFront rebuild

Out of scope (require architectural changes before they can be tested):

- Cross-region failover
- Aurora Global Database promotion
- KMS CMK loss recovery
- Region-wide outage failover

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
| Backup retention status | Aurora dev cluster `BackupRetentionPeriod >= 7` (already true) |

Before each test, **announce the test in the team channel**, including the test number, expected duration, and resources you will create.

---

## 3. Test 1 — Aurora point-in-time recovery (PITR)

Validates that the 7-day automated-backup window for Aurora is usable.

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

Record each test in this table (append rows; do not overwrite past results). When this grows large, archive it into a quarterly file under `docs/deployment/`.

| Date | Test | Operator | Duration | Outcome | RTO observed | Notes / follow-ups |
| ---- | ---- | -------- | -------- | ------- | ------------ | ------------------ |
|      |      |          |          |         |              |                    |

---

## 7. Cadence

Recommended minimum cadence (until a formal DR policy supersedes this):

| Test | Cadence |
| ---- | ------- |
| Test 1 — Aurora PITR | Quarterly |
| Test 2 — ECS rollback | Quarterly (or after every change to deployment config) |
| Test 3 — Frontend rebuild | Twice per year |
| Tabletop region-loss exercise | Annual (cannot be executed against AWS today — see `DISASTER_RECOVERY.md` §5.3) |

---

## 8. Safety rules

1. **Never run any of these tests against prod identifiers** without an explicit, written change request and a second operator on the call.
2. **Always run §3.5, §4.4, §5.5 cleanups** — these tests create billable resources or leave a service on an unwanted task definition.
3. **If any pass criterion fails**, stop and capture: AWS console screenshots, the failing command output, and the time. File a follow-up in the team tracker before re-running.
4. **Do not run more than one test concurrently** in the same dev environment.

---

## 9. References

- [`DISASTER_RECOVERY.md`](./DISASTER_RECOVERY.md) — current state and recommendations
- [`DEPLOYMENT_RUNBOOK.md`](./DEPLOYMENT_RUNBOOK.md) — general deploy/operations runbook
- [`../architecture/AURORA_CLUSTERS.md`](../architecture/AURORA_CLUSTERS.md) — Aurora architecture and target DR design
- `infrastructure/cloudformation/coheus_aurora_cluster_stack.yaml`
- `infrastructure/cloudformation/coheus_ecs_fargate_stack.yaml`
- `infrastructure/cloudformation/coheus_frontend_cloud_front_s3_stack.yaml`
