# Cohi Disaster Recovery — Rollout Plan and Cost Estimate

Companion to [`DISASTER_RECOVERY.md`](./DISASTER_RECOVERY.md). This document turns the gaps in §3 and §5 of that doc into a concrete, phased rollout: what to build, what to change in `infrastructure/cloudformation/`, the engineering effort, the recurring AWS cost, and the dependencies.

Date created: 2026-05-12.

---

## 1. Baseline assumptions

Cost estimates use **`us-east-2` on-demand list pricing as of 2026-05** and the **observed size of the production environment**, captured during the review:

| Measurement | Value | Source |
| ----------- | ----- | ------ |
| `coheus-prod-management` storage in use | ~1.19 GB | `AWS/RDS VolumeBytesUsed`, 2026-05-12 |
| `coheus-dev-management` storage in use | ~1.17 GB | `AWS/RDS VolumeBytesUsed`, 2026-05-12 |
| Prod cluster Aurora capacity, 24h avg | ~0.55 ACU (peaks 4.0) | `AWS/RDS ServerlessDatabaseCapacity`, 24h |
| Frontend S3 bucket size | < 1 GB (typical SPA build) | Assumed; verify with `aws s3 ls --summarize --recursive` |

Because the dataset is small, **backup and replication storage costs are dominated by per-cluster minimums, not per-GB pricing.** Re-evaluate this plan if the prod cluster grows past ~50 GB.

Tax, support uplift, and savings plans are not modeled. All prices are USD.

---

## 2. Cost summary

| Phase | What you get | Engineering effort | Recurring monthly cost (prod only) |
| ----- | ------------ | ------------------ | ---------------------------------- |
| **Phase 0** — policy + safe IaC tweaks | Documented RTO/RPO, longer PITR, KMS protected from accidental delete, versioned prod frontend, Secrets re-seed runbook | 1–2 dev days | **~$1–3** |
| **Phase 1** — in-region resilience and AWS Backup | Hot Aurora reader in second AZ, AWS Backup vault with 90-day retention, formal DR test cadence | 3–5 dev days | **~$55–90** |
| **Phase 2** — cross-region (only after Org SCP review) | DR landing zone (VPC + DR backup vault), **daily AWS Backup copy** to DR, CloudFront origin failover | 3–6 dev days, plus Org SCP change | **~$1–5** additional (tiny backup copy storage; **no** hot Aurora in DR, no S3 CRR needed) |
| **Total at full coverage** | — | ~8–13 dev days end-to-end | **~$58–100 / month** |

For context, the existing prod Aurora cluster runs around $50–80/month at observed ACU; Phase 1 adds a reader; **Phase 2 cold DR** adds only storage-level cross-region costs unless you later stand up warm ECS in DR.

---

## 3. Phase 0 — Policy and safe IaC tweaks

Low-risk changes you can ship in a single PR. None of these affect runtime behavior.

### 3.1 Write the DR policy

| Item | Detail |
| ---- | ------ |
| Deliverable | One-page policy in `docs/deployment/DR_POLICY.md` defining RTO/RPO per tier (API, DB, frontend, files), incident owner, escalation path, comms template |
| Effort | 0.5 day |
| Cost | $0 |
| Dependency | Product owner sign-off on RTO/RPO targets |

### 3.2 Raise Aurora backup retention to 35 days

| Item | Detail |
| ---- | ------ |
| Change | `BackupRetentionDays: 35` (parameter default) in `infrastructure/cloudformation/coheus_aurora_cluster_stack.yaml` |
| Effort | 0.25 day (parameter change + stack update during a maintenance window) |
| AWS cost | Aurora backup storage above cluster size is **$0.021/GB-month**. With ~1.2 GB of data and modest write volume, retained backup storage will be < 30 GB → **< $1/month**. |
| Risk | Stack update is non-disruptive; AWS extends retention on the live cluster |

### 3.3 Add `DeletionPolicy: Retain` to KMS keys

| Item | Detail |
| ---- | ------ |
| Change | Add `DeletionPolicy: Retain` and `UpdateReplacePolicy: Retain` to the `EncryptionKey` resource in `coheus_ecs_fargate_stack.yaml` |
| Effort | 0.25 day |
| AWS cost | $0 |
| Risk | None — only changes what happens on stack deletion |

### 3.4 Enable versioning on the prod frontend bucket

| Item | Detail |
| ---- | ------ |
| Change | Add `VersioningConfiguration: { Status: Enabled }` and a lifecycle rule to expire `NoncurrentVersions` after 30 days, in `coheus_frontend_cloud_front_s3_stack.yaml` |
| Effort | 0.25 day |
| AWS cost | S3 standard storage at $0.023/GB-month for old versions. SPA build < 1 GB; 30-day window → **pennies/month** |
| Risk | None |

### 3.5 Document the Secrets Manager re-seed runbook

| Item | Detail |
| ---- | ------ |
| Deliverable | New section in `docs/deployment/DEPLOYMENT_RUNBOOK.md` covering: list of `coheus/{env}/...` secrets created in `coheus_ecs_fargate_stack.yaml`, how to rotate each, what triggers an ECS task restart |
| Effort | 0.5 day |
| Cost | $0 |
| Dependency | None |

**Phase 0 totals:** ~1.75 dev days, **~$1–3/month**.

---

## 4. Phase 1 — In-region resilience and AWS Backup

These changes give you a real HA story inside `us-east-2` and long-retention backups separate from Aurora's automated PITR.

### 4.1 Add a second Aurora reader instance

| Item | Detail |
| ---- | ------ |
| Change | Add a second `AWS::RDS::DBInstance` resource in `coheus_aurora_cluster_stack.yaml`, referencing the same cluster (`DBClusterIdentifier: !Ref AuroraCluster`), `DBInstanceClass: db.serverless`, in a different AZ |
| Effort | 1 day (template change + dev validation + prod rollout in a maintenance window) |
| AWS cost | Aurora Serverless v2 pricing: **$0.12/ACU-hour**. A reader sized like prod (averages ~0.55 ACU) costs ~$0.55 × $0.12 × 730 = **~$48/month**. Worst case at 1.0 ACU avg = **~$88/month**. |
| Benefit | Eliminates the single-instance writer risk; gives a hot endpoint for sub-minute failover. Live API currently reports `MultiAZ: False`. |
| Risk | Adds one rolling failover during deployment; otherwise transparent to the app |

### 4.2 Create a Cohi-owned AWS Backup vault and selection

| Item | Detail |
| ---- | ------ |
| Change | New stack `coheus_backup_stack.yaml` containing: `AWS::Backup::BackupVault` (with KMS), `AWS::Backup::BackupPlan` (daily + monthly rules, 90-day retention), `AWS::Backup::BackupSelection` referencing the Aurora clusters and Retain'd S3 buckets by tag |
| Effort | 1.5 days |
| AWS cost | AWS Backup warm storage **$0.05/GB-month**. At ~1.2 GB primary × 90 retained snapshots, allow 50 GB worst case → **~$2.50/month**. AWS Backup billing is per-protected-resource also; ~$0/month for in-region. |
| Benefit | Long-retention coverage beyond Aurora's 35-day PITR window, separate from the existing org-level `tvma_*` plans (whose Cohi coverage is currently unverified) |
| Risk | None — read-only against source resources |

### 4.3 Formalize DR test cadence

| Item | Detail |
| ---- | ------ |
| Deliverable | Calendar entries (or Jira recurring tickets) for the tests in `DR_TEST_PLAN.md`; quarterly PITR drill, ECS rollback drill, and twice-yearly frontend rebuild |
| Effort | 0.5 day to set up, then ~2 hours per drill |
| Cost | Aurora PITR drill: temporary cluster runs for < 1 hour at min ACU → **~$0.10 per drill**. ECS and frontend drills are free. |
| Dependency | Phase 0 complete so RTO/RPO targets exist to test against |

**Phase 1 totals:** ~3 dev days + ongoing drill time, **~$50–90/month** (driven by the reader instance).

---

## 5. Phase 2 — Cross-region (requires Org SCP review)

These are the only items in scope for surviving a full `us-east-2` outage. They cannot start until the **Org SCP** (`p-ud42m49v`) is changed to allow Cohi resources in a chosen secondary region. Today that SCP explicitly denies `ecs:ListClusters` / `rds:DescribeDBClusters` in `us-west-2` and `eu-west-1` for the dev SSO role.

### 5.1 Org SCP change (prerequisite)

| Item | Detail |
| ---- | ------ |
| Action | Coordinate with the Org admin (account `452829726524`) to permit Cohi resources in **one** approved secondary region (`us-east-1` is the simplest choice; same continent, lowest latency for CloudFront) |
| Effort | 1 day of cross-team coordination |
| AWS cost | $0 |
| Risk | None technical; policy decision only |

### 5.2 DR landing zone + AWS Backup cross-region copy

| Item | Detail |
| ---- | ------ |
| Change | Deploy [`coheus_aurora_secondary_stack.yaml`](../../infrastructure/cloudformation/coheus_aurora_secondary_stack.yaml) to the DR region (VPC, DB subnet group, SG, KMS, **DR backup vault**, optional replica S3). Update [`coheus_backup_stack.yaml`](../../infrastructure/cloudformation/coheus_backup_stack.yaml) in the primary region so the **DailySnapshots** rule includes `CopyActions` to that vault (template defaults `EnableCrossRegionBackupCopy=true`). |
| Effort | 2 days (template + pipeline + runbook for [`scripts/dr/restore-from-snapshot.sh`](../../scripts/dr/restore-from-snapshot.sh)) |
| AWS cost | DR VPC endpoints/nat-free private subnets: **$0** baseline. Backup copy warm storage at tiny dataset size → **pennies/month**. |
| RPO / RTO | RPO **up to 24h** (daily backup + copy); cross-region RTO **8–24 hours** (DB restore + ECS rebuild + app cutover + validation). |
| Risk | Copy jobs fail loudly if DR vault missing — deploy landing stack **before** enabling copy. |

### 5.3 S3 cross-region replication — NOT REQUIRED

Podcast audio is **regenerable** from source data stored in Aurora (which is backed up). QA artifacts are ephemeral (30-day lifecycle). Neither bucket requires cross-region replication. If a future audit-log bucket is introduced that holds non-regenerable data, revisit this decision.

### 5.4 CloudFront origin failover or Route 53 health-based routing

| Item | Detail |
| ---- | ------ |
| Change | Either (a) add a secondary `Origin` to the CloudFront distribution in `coheus_waf_cloudfront_stack.yaml` with an `OriginGroup` and failover criteria, or (b) front the API ALBs with a Route 53 record that has health checks on both regions |
| Effort | 1 day |
| AWS cost | CloudFront origin failover: $0 extra at the CloudFront layer. Route 53 health checks: **$0.50/month per check**, plus **$0.75/month** if HTTPS endpoint checks. Allow **~$2/month**. |
| Dependency | A working secondary ECS service in DR is **out of scope** for the minimum Phase 2. To fully use CloudFront failover you need a stood-up secondary backend, which is **additional** ECS cost not included above. |

> **Note on a secondary ECS deployment.** The numbers in §5.4 do **not** include running a warm secondary ECS service. Doing so would add roughly the current ECS Fargate cost (a few hundred dollars/month) for the secondary region. The minimum viable Phase 2 is **data-layer only** (**AWS Backup cross-region copy** + S3 CRR) plus a documented "build ECS from CloudFormation on failover" runbook — that keeps cost low but lengthens full-stack RTO.

**Phase 2 totals:** ~3 dev days, **~$1–5/month** for the data-layer-only minimum (excludes optional warm ECS in DR). S3 CRR is not needed — podcast audio is regenerable from source data.

---

## 6. Suggested sequencing and timeline

Assuming a single engineer working on this part-time:

| Week | Work |
| ---- | ---- |
| Week 1 | Phase 0 PR (policy, retention, KMS Retain, versioning, Secrets runbook). Run Test 1 (PITR) on the dev cluster the same week using `DR_TEST_PLAN.md`. |
| Weeks 2–3 | Phase 1 PR (second Aurora reader, AWS Backup stack). Maintenance-window deploy. Run all three tests in `DR_TEST_PLAN.md` against dev. |
| Weeks 4–5 | Phase 2 prerequisites — Org SCP change. Once approved, deploy DR landing + backup copy in dev; run snapshot restore sandbox per `DR_TEST_PLAN.md` §9.3. |
| Week 6 | Phase 2 completion (CRR + CloudFront failover). Tabletop region-loss exercise. Finalize updated DR policy with measured RTO/RPO. |

---

## 7. Cost rollup at full coverage

Recurring monthly costs at the end of Phase 2 (prod only, list price, observed usage):

| Line item | Monthly |
| --------- | ------- |
| Aurora reader, 2nd AZ (Phase 1) | $48 |
| AWS Backup vault, 35-day retention + DR copy (Phase 1–2) | $3 |
| DR landing VPC + backup copy storage (Phase 2) | < $0.50 |
| Route 53 health checks (Phase 2) | $2 |
| Extended Aurora PITR storage (Phase 0) | $1 |
| Frontend bucket versioning (Phase 0) | $0.10 |
| **Total** | **~$54/month** |

S3 cross-region replication is **not included** — podcast audio is regenerable from source data, QA artifacts are ephemeral.

Engineering effort to reach full coverage: **~7 dev days** spread over **~6 weeks**, plus the Org SCP coordination.

Excluded from this number:

- A warm secondary ECS service (would add ~current ECS spend if deployed)
- Any data-egress costs if the dataset grows materially
- Support uplift / EDP discounts (will lower actual cost)

---

## 8. What this plan does NOT cover

Out of scope here (note them for future planning):

- **Application-layer DR**: tenant-specific failover messaging, partial-functionality mode, queue draining
- **Customer comms tooling** (statuspage / scheduled-incident process)
- **Backup encryption-key escrow** (separating KMS material for compliance audits)
- **Long-term archival** (Glacier Deep Archive) for compliance-driven retention beyond 90 days
- **Self-hosted / Marketplace deployments** in `infrastructure/cloudformation/marketplace/` — explicitly excluded from this rollout

---

## 9. References

- [`DISASTER_RECOVERY.md`](./DISASTER_RECOVERY.md) — current state and gap list
- [`DR_TEST_PLAN.md`](./DR_TEST_PLAN.md) — executable test procedures
- `infrastructure/cloudformation/coheus_aurora_cluster_stack.yaml`
- `infrastructure/cloudformation/coheus_ecs_fargate_stack.yaml`
- `infrastructure/cloudformation/coheus_frontend_cloud_front_s3_stack.yaml`
- `infrastructure/cloudformation/coheus_waf_cloudfront_stack.yaml`
- [AWS RDS pricing — Aurora Serverless v2](https://aws.amazon.com/rds/aurora/pricing/)
- [AWS Backup pricing](https://aws.amazon.com/backup/pricing/)
