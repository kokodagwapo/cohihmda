# Cohi DR / resilience — Jira backlog (draft)

**Do not treat as live Jira tickets until imported.** Each block is copy-paste ready into your tracker. Suggested project: your Cohi engineering project (e.g. `COHI`). Labels: `dr`, `infrastructure`, `cloudformation`, plus phase label.

Epic link field: set parent to the Epic after creation.

---

## Epic: COHI-DR-EPIC — Disaster recovery and resilience rollout

**Description:** Execute [`DR_ROLLOUT_PLAN.md`](./DR_ROLLOUT_PLAN.md): Phase 0–2 CloudFormation, policy, tests, and Org SCP coordination. Outcomes: documented RTO/RPO, longer retention, in-region HA reader, AWS Backup, optional global DB + CRR + CloudFront failover.

**Acceptance criteria**

- [ ] [`DR_POLICY.md`](./DR_POLICY.md) ratified (or explicitly waived) per its checklist  
- [ ] All phase deployments recorded in [`DR_DEPLOY_CHECKLIST.md`](./DR_DEPLOY_CHECKLIST.md)  
- [ ] At least one row per test type in [`DR_TEST_PLAN.md`](./DR_TEST_PLAN.md) §6  

**Estimate:** Epic (no points)  
**Labels:** `dr`, `epic`

---

### Story: COHI-DR-001 — Publish and ratify DR policy

**Description:** Socialize [`DR_POLICY.md`](./DR_POLICY.md); complete ratification checklist; remove DRAFT after sign-off.

**AC**

- [ ] Product + engineering sign-off recorded  
- [ ] §6 measured RTO/RPO filled from drills or waived with rationale  

**Estimate:** 2  
**Depends on:** COHI-DR-007 (baseline PITR) recommended first  
**Labels:** `dr`, `phase-0`, `documentation`

---

### Story: COHI-DR-002 — Secrets re-seed runbook review

**Description:** Verify [`DEPLOYMENT_RUNBOOK.md`](./DEPLOYMENT_RUNBOOK.md) Secrets section matches deployed secrets and IAM; fix any gaps.

**AC**

- [ ] Runbook reviewed by second engineer  
- [ ] JWT/Cognito rotation path matches actual task definition (parameter vs SM)  

**Estimate:** 1  
**Labels:** `dr`, `phase-0`, `documentation`

---

### Story: COHI-DR-003 — Phase 0 CloudFormation (retention, KMS Retain, frontend versioning)

**Description:** Merge template changes: Aurora default retention 35d; `EncryptionKey` Retain policies; frontend bucket versioning + noncurrent lifecycle.

**AC**

- [ ] Templates validated (`cfn-lint` or equivalent)  
- [ ] Dev stack updated without error  
- [ ] Prod stack updated in maintenance window  

**Estimate:** 3  
**Depends on:** none  
**Labels:** `dr`, `phase-0`, `iac`

---

### Story: COHI-DR-004 — Phase 0 production deploy execution

**Description:** Follow [`DR_DEPLOY_CHECKLIST.md`](./DR_DEPLOY_CHECKLIST.md) §Phase 0 for prod.

**AC**

- [ ] Checklist checkboxes completed  
- [ ] Rollback window confirmed  

**Estimate:** 1  
**Depends on:** COHI-DR-003  
**Labels:** `dr`, `phase-0`, `operations`

---

### Story: COHI-DR-005 — Org SCP: allow Cohi DR in `us-east-1`

**Description:** Request change to Org SCP `p-ud42m49v` (management account `452829726524`) to permit Cohi-controlled resources in `us-east-1` (RDS, ECS, S3, VPC, CloudFormation) for secondary region. Attach [`DISASTER_RECOVERY.md`](./DISASTER_RECOVERY.md) §3 and [`DR_ROLLOUT_PLAN.md`](./DR_ROLLOUT_PLAN.md) §5 as justification.

**AC**

- [ ] Ticket opened with Org platform team  
- [ ] Approved region list documented in runbook  
- [ ] SSO / CI roles verified in `us-east-1` after change  

**Estimate:** 3  
**Blocks:** COHI-DR-011 through COHI-DR-014  
**Labels:** `dr`, `phase-2`, `governance`

---

### Story: COHI-DR-006 — Second Aurora reader instance (Phase 1)

**Description:** Deploy `coheus_aurora_cluster_stack.yaml` with second `AWS::RDS::DBInstance` (reader) for management and tenant stacks as applicable.

**AC**

- [ ] Dev management cluster shows two instances in RDS console  
- [ ] Prod rollout in Sunday maintenance window  
- [ ] No sustained connection errors in ECS metrics  

**Estimate:** 5  
**Depends on:** COHI-DR-004  
**Labels:** `dr`, `phase-1`, `iac`

---

### Story: COHI-DR-007 — Baseline Aurora PITR drill (dev)

**Description:** Execute [`DR_TEST_PLAN.md`](./DR_TEST_PLAN.md) §3 against `coheus-dev-management`; record §6 log row.

**AC**

- [ ] Temporary cluster created and deleted  
- [ ] §6 log contains timings and operator name  

**Estimate:** 2  
**Labels:** `dr`, `phase-0`, `testing`

---

### Story: COHI-DR-008 — Deploy `coheus_backup_stack` (Phase 1)

**Description:** Create and deploy [`infrastructure/cloudformation/coheus_backup_stack.yaml`](../infrastructure/cloudformation/coheus_backup_stack.yaml); verify first backup job success in AWS Backup console.

**AC**

- [ ] Tag-based selection matches Aurora + S3 with `Project` + `Environment` tags  
- [ ] At least one successful `BACKUP_JOB_COMPLETED` for RDS within 48h  

**Estimate:** 5  
**Depends on:** COHI-DR-003 (tags on resources)  
**Labels:** `dr`, `phase-1`, `iac`

---

### Story: COHI-DR-009 — Phase 1 full DR test pass (dev)

**Description:** Re-run Tests 1–3 in [`DR_TEST_PLAN.md`](./DR_TEST_PLAN.md) after Phase 1 live; append §6 rows.

**AC**

- [ ] Three test rows logged with outcomes  

**Estimate:** 3  
**Depends on:** COHI-DR-006, COHI-DR-008  
**Labels:** `dr`, `phase-1`, `testing`

---

### Story: COHI-DR-010 — Policy ratification with measured numbers

**Description:** Complete [`DR_POLICY.md`](./DR_POLICY.md) §6 and §8 after COHI-DR-009; remove DRAFT banner when checklist complete.

**AC**

- [ ] DRAFT removed or explicitly extended with new date  

**Estimate:** 1  
**Depends on:** COHI-DR-001, COHI-DR-009  
**Labels:** `dr`, `documentation`

---

### Story: COHI-DR-011 — ~~Aurora Global Cluster~~ CANCELLED

**Status:** Cancelled — Aurora Global Database is **not used**. Cold snapshot DR via AWS Backup cross-region copy is the production default. The `EnableGlobalDatabaseParam` in `coheus_aurora_cluster_stack.yaml` remains for legacy compatibility but defaults to `false`.

---

### Story: COHI-DR-012 — DR landing zone stack (`us-east-1`)

**Description:** Deploy [`coheus_aurora_secondary_stack.yaml`](../infrastructure/cloudformation/coheus_aurora_secondary_stack.yaml) as a **landing zone** (VPC, DB subnet group, SG, KMS, DR backup vault). No always-on Aurora cluster. Enable cross-region backup copy on the primary backup stack.

**AC**

- [ ] Stack `CREATE_COMPLETE` with outputs: `DrBackupVaultArn`, `DRDbSubnetGroupName`, `DRClusterSecurityGroupId`, `DRAuroraKmsKeyArn`  
- [ ] At least one successful copy job to DR vault within 48h  
- [ ] Outputs captured in [`DR_DEPLOY_CHECKLIST.md`](./DR_DEPLOY_CHECKLIST.md)  

**Estimate:** 5  
**Depends on:** COHI-DR-005  
**Labels:** `dr`, `phase-2`, `iac`

---

### Story: COHI-DR-013 — ~~S3 cross-region replication (podcast bucket)~~ CANCELLED

**Status:** Cancelled — podcast audio is **regenerable** from source data stored in Aurora. S3 CRR is not needed for DR. QA artifacts are ephemeral (30-day lifecycle). If a future non-regenerable bucket is introduced, re-open this story.

---

### Story: COHI-DR-014 — CloudFront API origin failover

**Description:** Deploy `coheus_waf_cloudfront_stack.yaml` with `DRSecondaryBackendOriginDomain` set to secondary ALB DNS; verify origin group in distribution.

**AC**

- [ ] Primary ALB failure simulation routes `/health` to secondary (controlled test)  

**Estimate:** 5  
**Depends on:** secondary ALB exists (document whether warm ECS is in scope; default is DNS-only secondary)  
**Labels:** `dr`, `phase-2`, `iac`

---

### Story: COHI-DR-015 — Region-loss tabletop + record

**Description:** Run [`DR_TEST_PLAN.md`](./DR_TEST_PLAN.md) §8 tabletop; store notes in `docs/deployment/` or Confluence.

**AC**

- [ ] Attendees list + top 5 gaps + owners  

**Estimate:** 2  
**Depends on:** COHI-DR-012 (recommended)  
**Labels:** `dr`, `phase-2`, `process`

---

## Import checklist (for whoever creates Jira issues)

1. Create Epic **COHI-DR-EPIC** (or one epic per your naming convention).  
2. Create stories in dependency order: COHI-DR-005 early (parallel), COHI-DR-003 → COHI-DR-004 → COHI-DR-007 → COHI-DR-006 → COHI-DR-008 → COHI-DR-009 → COHI-DR-012 → COHI-DR-014 → COHI-DR-015. **COHI-DR-011 and COHI-DR-013 are cancelled.**  
3. Link Epic as parent for all stories.  
4. Attach links: `DISASTER_RECOVERY.md`, `DR_ROLLOUT_PLAN.md`, `DR_TEST_PLAN.md`, `DR_DEPLOY_CHECKLIST.md`.
