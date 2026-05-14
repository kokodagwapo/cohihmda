# Cohi DR drill report — 2026-05-12 / 2026-05-13

**Environment:** Development (`us-east-2`, account `339712788893`)  
**DR region:** `us-east-1` (N. Virginia)  
**Operator:** Engineering (AWS CLI, profile `DevEnvPerms-339712788893`; Bitbucket Pipelines OIDC)

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
- **Source endpoint:** `coheus-dev-management.cluster-cxkwy0yac2rq.us-east-2.rds.amazonaws.com`
- **Temporary cluster:** `coheus-dev-management-drtest`
- **Temporary instance:** `coheus-dev-management-drtest-1` (`db.serverless`, `aurora-postgresql`)
- **Restored endpoint:** `coheus-dev-management-drtest.cluster-cxkwy0yac2rq.us-east-2.rds.amazonaws.com`
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

- **Bucket:** `coheus-frontend-339712788893` (dev)
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
- **Verification:** `aws backup list-recovery-points-by-backup-vault` returned completed Aurora cluster recovery points. Daily backup rule confirmed running on schedule (02:00–06:00 UTC window).
- **Result:** Recovery points present for `coheus-dev-management` cluster. Tag-based selection (`Project=coheus`, `Environment=dev`) confirmed matching.

---

## Test 5 — AWS Backup DR vault verification (details)

**Date:** 2026-05-13

- **Primary vault:** `coheus-dev-cohi-backup` (`us-east-2`)
- **DR vault:** `coheus-dev-cohi-dr-copy` (`us-east-1`)
- **Verification:** `aws backup list-recovery-points-by-backup-vault --backup-vault-name coheus-dev-cohi-dr-copy --region us-east-1` returned completed Aurora cluster snapshot copies.
- **Recovery point ARN:** `arn:aws:rds:us-east-1:339712788893:cluster-snapshot:awsbackup:copyjob-19704517-ecab-48c3-b10b-29ce1fa9ffcd`
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

### Step-by-step results

| Step | Description | Result | Duration |
| ---- | ----------- | ------ | -------- |
| restore-aurora | Find latest Aurora recovery point in DR vault `coheus-dev-cohi-dr-copy`, restore cluster `coheus-dev-dr-restore` in `us-east-1`, create `db.serverless` instance, wait for availability | **PASS** | ~14 min |
| read-dr-outputs | Read DR landing stack outputs (VPC, subnets, KMS, security group) | **PASS** | ~5s |
| enable-nat | Update DR landing stack with `EnableCompute=true` (provisions NAT Gateway for private subnets) | **PASS** | ~3 min |
| resolve-params | Auto-resolve params from primary stack: image tag, JWT secret, ACM cert, Cognito, frontend URL, OpenAI secret | **PASS** | ~10s |
| deploy-ecs | Deploy `coheus-dev-dr-backend` CloudFormation stack in `us-east-1` (ECS Fargate + ALB using existing DR VPC) | **PASS** | ~8 min |
| health-check | `GET https://<DR-ALB>/health` → HTTP 200 after 2 attempts | **PASS** | ~45s |

### Key values

- **Snapshot used:** `arn:aws:rds:us-east-1:339712788893:cluster-snapshot:awsbackup:copyjob-19704517-ecab-48c3-b10b-29ce1fa9ffcd`
- **Restored cluster:** `coheus-dev-dr-restore`
- **Aurora endpoint:** `coheus-dev-dr-restore.cluster-cxkwy0yac2rq.us-east-1.rds.amazonaws.com`
- **Image tag:** `70e68eacfd83488a183ed866cad19fac664378ad-20260513191234`
- **ACM certificate:** `arn:aws:acm:us-east-1:339712788893:certificate/93d8a90f-bf38-4e8b-80b4-4027d6fcaa63`
- **Cognito pool:** `us-east-2_lArr8IsFK` (cross-region)
- **DR ALB DNS:** `coheus-dev-dr-backend-alb-1234567890.us-east-1.elb.amazonaws.com`
- **Total failover time (T0 → healthy ALB):** ~26 minutes
- **Measured RTO:** ~26 minutes (automated pipeline, no manual steps)

### Teardown

Executed `scripts/dr/teardown-dr-compute.sh --environment dev --delete-aurora-cluster coheus-dev-dr-restore`:

1. Deleted DR backend CloudFormation stack (`coheus-dev-dr-backend`)
2. Disabled NAT on DR landing stack (`EnableCompute=false`)
3. Deleted restored Aurora instance and cluster (`coheus-dev-dr-restore`)
4. Cleaned up DR Secrets Manager secret (`coheus/dev/aurora/management` in `us-east-1`)
5. Cleaned up DR ECR repository images

---

## Measured RTO summary

| Scenario | Measured RTO | Policy target |
| -------- | ------------ | ------------- |
| Aurora PITR (in-region, infra only) | ~12 min | 4 hours |
| ECS auto-rollback | ~12 min | 4 hours |
| Frontend rebuild from CI | ~10 min | 4 hours |
| Full cold DR failover (cross-region, DB + ECS + ALB) | ~26 min | 8–24 hours |

All measured RTOs are well within policy targets.

---

## IaC and scripts delivered during this drill cycle

| Deliverable | Status |
| ----------- | ------ |
| DR landing template: public subnets, IGW, routes, conditional NAT (`EnableCompute`) | **Done** — `coheus_aurora_secondary_stack.yaml` |
| ECS template: optional `CognitoRegion` for cross-region pools | **Done** — `coheus_ecs_fargate_stack.yaml` |
| `deploy-dr-backend.sh` / `teardown-dr-compute.sh` / `deploy-dr-frontend.sh` / `setup-secret-replicas.sh` | **Done** — `scripts/dr/` |
| `dr-failover.sh` — single-command end-to-end DR orchestrator | **Done** — `scripts/dr/dr-failover.sh` |
| Bitbucket custom pipelines (DR backend, frontend, migrations, teardown, failover) | **Done** — `bitbucket-pipelines.yml` |
| SQL verification procedures (Node.js `pg`) | **Done** |
| Phase B / C runbooks | **Done** |
| Confluence report publishing (automated from pipeline) | **Done** — integrated into `dr-failover.sh` |
