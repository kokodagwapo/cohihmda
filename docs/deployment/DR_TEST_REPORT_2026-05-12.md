# Cohi DR drill report — 2026-05-12 (updated 2026-05-13)

**Environment:** Development (`us-east-2`, account `339712788893`)  
**Operator:** Engineering (AWS CLI, profile `DevEnvPerms-339712788893`)  
**Companion runbooks:** [`DR_TEST_PLAN.md`](./DR_TEST_PLAN.md), [`DR_TEST_PROCEDURES.md`](./DR_TEST_PROCEDURES.md), [`scripts/dr/README.md`](../../scripts/dr/README.md)

---

## 2026-05-13 — DR Full Test Plan implementation (engineering)

The following was **implemented in-repo** (IaC, scripts, Bitbucket custom pipelines, and documentation). **Operator-executed** drills (AWS Backup re-list, cross-region restore, PITR + SQL, full Phase C rehearsal) remain to be run in AWS and logged in [`DR_TEST_PLAN.md`](./DR_TEST_PLAN.md) §6.

| Deliverable | Status |
| ------------- | ------ |
| DR landing template: public subnets, IGW, routes, conditional NAT (`EnableCompute`) | **Done** — [`coheus_aurora_secondary_stack.yaml`](../../infrastructure/cloudformation/coheus_aurora_secondary_stack.yaml) |
| ECS template: optional `CognitoRegion` for cross-region pools | **Done** — [`coheus_ecs_fargate_stack.yaml`](../../infrastructure/cloudformation/coheus_ecs_fargate_stack.yaml) |
| `deploy-dr-backend.sh` / `teardown-dr-compute.sh` / `deploy-dr-frontend.sh` / `setup-secret-replicas.sh` | **Done** — [`scripts/dr/`](../../scripts/dr/) |
| Bitbucket custom pipelines (DR backend, frontend, migrations, teardown) | **Done** — [`bitbucket-pipelines.yml`](../../bitbucket-pipelines.yml) |
| SQL verification docs (Node `pg`, not `psql`) | **Done** — [`DR_TEST_PROCEDURES.md`](./DR_TEST_PROCEDURES.md), [`DR_TEST_PLAN.md`](./DR_TEST_PLAN.md) §9.3 |
| Phase B / C runbooks | **Done** — [`DR_DEPLOY_CHECKLIST.md`](./DR_DEPLOY_CHECKLIST.md) Phase B, [`DR_TEST_PLAN.md`](./DR_TEST_PLAN.md) §9.6 |
| AWS: backup vault re-verification | **Pending operator** — CLI in §6 row “Test 5” |
| AWS: cross-region restore + teardown | **Pending operator** — [`restore-from-snapshot.sh`](../../scripts/dr/restore-from-snapshot.sh) |
| AWS: PITR + Node/pg SQL via ECS Exec | **Pending operator** |
| AWS: Phase C end-to-end (§9.6) | **Pending operator** — after Phase B prereqs |

---

## Summary

| Test | Outcome | Notes |
| ---- | ------- | ----- |
| Test 1 — Aurora PITR | **Pass** | Temporary cluster `coheus-dev-management-drtest` restored, `db.serverless` instance created, endpoint verified; cluster and instance deleted (`DBClusterNotFoundFault` on verify). SQL verification from inside the VPC was not run in this session — complete per §3.4 of the test plan when convenient. |
| Test 2 — ECS rollback | **Pass** | Re-run with health-check-failure method (task definition `coheus-dev-backend:222` with `exit 1` health check). Tasks started, reached `RUNNING`, then failed health checks. `failedTasks` counted up to **4** (threshold **3** for `desiredCount: 2`). PRIMARY deployment transitioned to **`FAILED`** and ECS **automatically rolled back** to `coheus-dev-backend:220`. Two healthy tasks on `:220` remained `RUNNING` throughout. Total time T0 to auto-rollback: **~12 minutes**. Revision `:222` deregistered. |
| Test 3 — Frontend rebuild | **Not run** | Skipped here (bucket wipe + Bitbucket CI + invalidation). Run using [`DR_TEST_PROCEDURES.md`](./DR_TEST_PROCEDURES.md) when a CI operator is available. |
| Test 4 — AWS Backup vault | **Partial** | Vault `coheus-prod-cohi-backup` exists; `NumberOfRecoveryPoints` was **0** and `list-backup-jobs` for `COMPLETED` returned **no jobs** at drill time. Re-check after the first backup window (up to 48h per deploy checklist). |

---

## Test 1 — Aurora PITR (details)

- **Source cluster:** `coheus-dev-management`
- **Temporary cluster:** `coheus-dev-management-drtest`
- **Temporary instance:** `coheus-dev-management-drtest-1` (`db.serverless`, `aurora-postgresql`)
- **Observed behavior:** Cluster reached `available` after several minutes of `creating`; instance reached `available` shortly after create; teardown completed (cluster no longer found).
- **RTO (infrastructure only):** On the order of **~10–15 minutes** from cluster `creating` to instance `available` (not including SQL proof or application cutover).
- **RPO (drill):** Restore target was **30 minutes** before the restore API call (per standard procedure); exact timestamp was recorded in the operator shell at execution time.
- **CLI note:** `aws rds restore-db-cluster-to-point-in-time` must **omit** `--engine` on current AWS CLI v2 — the flag is ambiguous (`--engine-mode` vs `--engine-lifecycle-support`). Engine is inferred from the source cluster. Runbooks were updated accordingly.

---

## Test 2 — ECS rollback (details)

### Attempt 1 (bad image tag — inconclusive)

- **Bad task definition:** `coheus-dev-backend:221` — image tag `...:dr-test-nonexistent-tag-20260512`
- ECS retried image pulls (7 retries per attempt, ~2 min per cycle). After ~15 min observation, PRIMARY was still `IN_PROGRESS` — manually reverted. The circuit-breaker threshold (**3** for `desiredCount: 2`) was likely reached but not yet processed before manual intervention.
- **Lesson:** `CannotPullContainerError` is slow because each attempt goes through internal retries before counting as a failure. Do not use this method for timed drills.

### Attempt 2 (broken health check — full pass)

- **Known-good task definition:** `coheus-dev-backend:220`
- **Bad task definition:** `coheus-dev-backend:222` — health check overridden to `exit 1`
- **Service:** `coheus-dev-service` on `coheus-dev-cluster`
- **Circuit breaker:** `enable: true`, `rollback: true`
- **Timeline:**
  - **T0 16:20:05** — `update-service` to `:222`
  - **16:21:31** — 2 tasks on `:222` reach `RUNNING` (Stage 1 passes)
  - **16:25:23** — first health check failures register; `failed=2`, tasks replaced
  - **16:27:32** — replacement tasks reach `RUNNING`; `failed=2` (second cycle underway)
  - **16:31:40** — `failed=4` (threshold of 3 exceeded)
  - **16:32:04** — PRIMARY on `:222` → **`FAILED`**; ECS auto-creates rollback deployment to `:220` as new PRIMARY; 2 healthy `:220` tasks still `RUNNING`
- **Total time to auto-rollback:** ~12 minutes
- **Cleanup:** `deregister-task-definition` for `:222`; temp files deleted.

---

## Test 4 — AWS Backup (details)

- **Vault:** `coheus-prod-cohi-backup` (present in `us-east-2`).
- **Gap:** No completed backup jobs visible for that vault at drill time — treat as **configuration verification pass**, **operational backup verification pending**.

---

## Follow-up actions

1. Complete **Test 1 §3.4** (Node.js `pg` from ECS Exec per updated [`DR_TEST_PROCEDURES.md`](./DR_TEST_PROCEDURES.md)) on the next quarterly drill.
1. Execute **Test 3** (frontend rebuild) in a scheduled window with CI owner.
1. Re-query **Test 4 / Test 5** (primary + DR backup vaults); confirm recovery points and copy jobs.
1. After DR landing stack update: run **§9.6** Phase C rehearsal when SES/Cognito DR prereqs are ready; record measured RTO in §6.

---

## Record of updates

The authoritative append-only log is [`DR_TEST_PLAN.md`](./DR_TEST_PLAN.md) §6; [`DR_POLICY.md`](./DR_POLICY.md) §6 was updated with the same measured outcomes where applicable.
