# Cohi DR drill report — 2026-05-12 / 2026-05-13

**Environment:** Development (`us-east-2`)  
**DR region:** `us-east-1` (N. Virginia)  
**Operator:** Engineering (Bitbucket Pipelines OIDC)

---

## Summary

| Test | Outcome | Notes |
| ---- | ------- | ----- |
| Test 1 — Aurora PITR | **Pass** | Temporary cluster `coheus-dev-management-drtest` restored to 30 min prior, `db.serverless` instance created, endpoint verified; cluster and instance deleted. |
| Test 2 — ECS rollback | **Pass** | Health-check-failure method (`:222`). `failedTasks` hit 4 (threshold 3), PRIMARY → `FAILED`, ECS auto-rolled back to `:220`. Old tasks stayed healthy throughout. Total time: ~12 min. |
| Test 3 — Frontend rebuild | **Pass** | Dev frontend bucket emptied, rebuilt via Bitbucket CI pipeline, CloudFront invalidated. Site rendered correctly from CI-produced assets only. |
| Test 4 — AWS Backup vault check | **Pass** | Primary vault `coheus-dev-cohi-backup` confirmed with completed Aurora cluster backup jobs and recovery points. |
| Test 5 — AWS Backup DR vault verification | **Pass** | DR vault `coheus-dev-cohi-dr-copy` in `us-east-1` confirmed with completed Aurora cross-region copy. Recovery point ARN verified. |
| Test 6 — Phase C full DR failover | **Pass** | End-to-end cold DR rehearsal via `dr-failover.sh` (Bitbucket pipeline `dr-failover-dev`): snapshot restore → NAT enable → ECS backend deploy → ALB `/health` check. All steps passed. |

---

## Test 1 — Aurora PITR (details)

**Date:** 2026-05-12

- **Source cluster:** `coheus-dev-management`
- **Source endpoint:** `coheus-dev-management.cluster-xxxx.us-east-2.rds.amazonaws.com`
- **Temporary cluster:** `coheus-dev-management-drtest`
- **Temporary instance:** `coheus-dev-management-drtest-1` (`db.serverless`, `aurora-postgresql`)
- **Restored endpoint:** `coheus-dev-management-drtest.cluster-xxxx.us-east-2.rds.amazonaws.com`
- **Observed behavior:** Cluster reached `available` after several minutes of `creating`; instance reached `available` shortly after. Teardown completed — cluster no longer found on verify.
- **RTO (infrastructure only):** ~12 minutes from cluster `creating` to instance `available`.
- **RPO (drill):** Restore target was 30 minutes before the restore API call.

---

## Test 2 — ECS rollback (details)

**Date:** 2026-05-12

- **Known-good task definition:** `coheus-dev-backend:220`
- **Bad task definition:** `coheus-dev-backend:222` — health check overridden to `exit 1`
- **Service:** `coheus-dev-service` on `coheus-dev-cluster`
- **Circuit breaker:** `enable: true`, `rollback: true`
- **Timeline:**
  - **T0 16:20:05** — `update-service` to `:222`
  - **16:21:31** — 2 tasks on `:222` reach `RUNNING`
  - **16:25:23** — first health check failures register; `failed=2`, tasks replaced
  - **16:27:32** — replacement tasks reach `RUNNING`; `failed=2` (second cycle underway)
  - **16:31:40** — `failed=4` (threshold of 3 exceeded)
  - **16:32:04** — PRIMARY on `:222` → **`FAILED`**; ECS auto-creates rollback deployment to `:220` as new PRIMARY; 2 healthy `:220` tasks still `RUNNING`
- **Total time to auto-rollback:** ~12 minutes
- **Cleanup:** `deregister-task-definition` for `:222`; temp files deleted.

---

## Test 3 — Frontend rebuild (details)

**Date:** 2026-05-13

- **Bucket:** `coheus-frontend-<account-id>` (dev)
- **CloudFront distribution:** dev CloudFront distribution
- **Procedure:**
  1. Backed up bucket contents locally via `aws s3 sync`
  2. Emptied the dev frontend bucket via `aws s3 rm --recursive`
  3. Triggered frontend deploy via Bitbucket CI pipeline (standard dev branch build + deploy)
  4. Invalidated CloudFront cache (`/*`)
- **Observed behavior:** CI pipeline completed build and sync within ~8 minutes. CloudFront invalidation propagated. Dev site loaded correctly — login page rendered, navigation functional, recent features present.
- **RTO (measured):** ~10 minutes (T0 bucket empty → site fully operational)
- **Cleanup:** Local backup directory deleted after verification.

---

## Test 4 — AWS Backup vault check (details)

**Date:** 2026-05-13

- **Vault:** `coheus-dev-cohi-backup` (`us-east-2`)
- **Verification:** Queried primary vault recovery points via AWS CLI. Daily backup rule confirmed running on schedule (02:00–06:00 UTC window).
- **Result:** Recovery points present for `coheus-dev-management` cluster. Tag-based selection (`Project=coheus`, `Environment=dev`) confirmed matching.

---

## Test 5 — AWS Backup DR vault verification (details)

**Date:** 2026-05-13

- **Primary vault:** `coheus-dev-cohi-backup` (`us-east-2`)
- **DR vault:** `coheus-dev-cohi-dr-copy` (`us-east-1`)
- **Verification:** Queried DR vault recovery points via AWS CLI; confirmed completed Aurora cluster snapshot copies.
- **Recovery point ARN:** Confirmed (Aurora cluster snapshot copy job in `us-east-1`)
- **Cross-region copy latency:** Copy job completed within ~2 hours of the primary backup.
- **Result:** Cross-region backup copy pipeline confirmed end-to-end. Snapshot available for restore in DR region.

---

## Test 6 — Phase C full DR failover (details)

**Date:** 2026-05-13

End-to-end cold DR rehearsal executed via Bitbucket pipeline (`dr-failover-dev` custom pipeline) using `scripts/dr/dr-failover.sh`.

### Configuration

- **Pipeline:** `dr-failover-dev` (custom pipeline, manual trigger)
- **Script flags:** `--environment dev`
- **Primary region:** `us-east-2`
- **DR region:** `us-east-1`
- **Primary stack:** `coheus-dev-backend`
- **DR landing stack:** `coheus-dev-aurora-secondary`
- **DR backend stack:** `coheus-dev-dr-backend`
- **ProjectName override:** `coheus-dr` (avoids resource name collisions with ECR replicas, S3 buckets, and SM secrets already present in DR region)

### Step-by-step results

| Step | Description | Result | Duration |
| ---- | ----------- | ------ | -------- |
| restore-aurora | Find latest Aurora recovery point in DR vault `coheus-dev-cohi-dr-copy`, restore cluster `coheus-dev-dr-restore` in `us-east-1`, create `db.serverless` instance, wait for availability | **PASS** | ~14 min |
| read-dr-outputs | Read DR landing stack outputs (VPC, subnets, KMS, security group) | **PASS** | ~5s |
| enable-nat | Update DR landing stack with `EnableCompute=true` (provisions NAT Gateway for private subnets) | **PASS** | ~3 min |
| resolve-params | Auto-resolve params from primary stack: image tag, JWT secret (from SM), Cognito client secret (from IDP API), ACM cert, frontend URL, OpenAI secret ARN. Create Aurora secret in DR region with updated endpoint. | **PASS** | ~10s |
| copy-image | Copy container image from `coheus-backend` ECR to `coheus-dr-backend` ECR in DR region | **PASS** | ~30s |
| deploy-ecs | Deploy `coheus-dev-dr-backend` CloudFormation stack in `us-east-1` via S3 bucket (ECS Fargate + ALB using existing DR VPC) | **PASS** | ~8 min |
| health-check | `GET https://<DR-ALB>/health` → HTTP 200 after 2 attempts | **PASS** | ~45s |

### Key values

- **Snapshot used:** Latest cross-region copy from DR vault `coheus-dev-cohi-dr-copy`
- **Restored cluster:** `coheus-dev-dr-restore` in `us-east-1`
- **Aurora endpoint:** `coheus-dev-dr-restore.cluster-xxxx.us-east-1.rds.amazonaws.com`
- **Aurora secret (DR):** Created in `us-east-1` from primary, host updated to DR endpoint
- **Image tag:** Latest dev build (commit `70e68ea`)
- **ACM certificate:** Auto-detected in `us-east-1`
- **Cognito pool:** Cross-region from `us-east-2` (auth not functional in DR, `/health` only)
- **DR ALB DNS:** `coheus-dr-dev-alb-xxxx.us-east-1.elb.amazonaws.com`
- **Total failover time (T0 → healthy ALB):** ~26 minutes
- **Measured RTO:** ~26 minutes (automated pipeline, no manual steps)

### Health check response

```json
{
  "status": "ok",
  "timestamp": "2026-05-13T21:07:11.745Z",
  "database": "connected",
  "version": { "commit": "70e68ea", "branch": "dev" },
  "databaseInfo": { "connected": true, "database": "coheus_management" }
}
```

### Teardown

Executed `scripts/dr/teardown-dr-compute.sh --environment dev --delete-aurora-cluster coheus-dev-dr-restore`:

1. Deleted DR backend CloudFormation stack (`coheus-dev-dr-backend`)
2. Disabled NAT on DR landing stack (`EnableCompute=false`)
3. Deleted restored Aurora instance and cluster (`coheus-dev-dr-restore`)
4. Cleaned up DR Secrets Manager secret (`coheus/dev/aurora/management` in `us-east-1`)
5. Cleaned up DR ECR repository images (`coheus-dr-backend`)

---

## Measured RTO summary

| Scenario | Measured RTO | Policy target |
| -------- | ------------ | ------------- |
| Aurora PITR (in-region, infra only) | ~12 min | 4 hours |
| ECS auto-rollback | ~12 min | 4 hours |
| Frontend rebuild from CI | ~10 min | 4 hours |
| Full cold DR failover (cross-region, DB + ECS + ALB) | ~26 min | 8–24 hours |

All measured RTOs are well within policy targets.

