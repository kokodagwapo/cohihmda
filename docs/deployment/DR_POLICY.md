# Cohi Disaster Recovery Policy

**Status: DRAFT — pending product and engineering sign-off.**  
Do not treat this document as binding until the **Ratification checklist** (section 8 below) is completed and the DRAFT banner is removed.

Related runbooks: [`DISASTER_RECOVERY.md`](./DISASTER_RECOVERY.md), [`DR_TEST_PLAN.md`](./DR_TEST_PLAN.md), [`DR_ROLLOUT_PLAN.md`](./DR_ROLLOUT_PLAN.md), [`DR_DEPLOY_CHECKLIST.md`](./DR_DEPLOY_CHECKLIST.md), [`DR_BACKLOG.md`](./DR_BACKLOG.md).

---

## 1. Scope

This policy applies to the Cohi multi-tenant SaaS deployment defined in `infrastructure/cloudformation/` (Aurora Serverless v2, ECS Fargate, ALB, S3, CloudFront, KMS, Secrets Manager).

---

## 2. Objectives

| Objective | Description |
| --------- | ----------- |
| Data durability | Protect tenant and platform data against accidental deletion, corruption, and regional loss within agreed RPO. |
| Service recovery | Restore API and frontend availability within agreed RTO after an incident. |
| Evidence | Maintain records of DR tests and measured RTO/RPO for audits (e.g. SOC 2 CC7). |

---

## 3. Tiered RTO / RPO targets (proposed)

These numbers are **targets** until ratified. Replace placeholders in §6 with values measured during drills in [`DR_TEST_PLAN.md`](./DR_TEST_PLAN.md).

| Tier | Component | RPO (max acceptable data loss) | RTO (max acceptable outage) | Primary controls |
| ---- | --------- | ------------------------------ | ---------------------------- | ------------------ |
| T1 | Aurora PostgreSQL (management + tenant clusters) | 1 minute (async replication lag when Global DB enabled); otherwise last automated backup / PITR | 30 minutes (in-region); 4 hours (full region rebuild without warm secondary ECS) | PITR, snapshots, optional Global Database, second reader |
| T2 | API / worker (ECS Fargate) | Stateless — none | 30 minutes | Redeploy task definition, ECR images retained |
| T3 | Frontend (S3 + CloudFront) | None if rebuilt from CI | 1 hour | CI redeploy, optional S3 versioning |
| T4 | Ephemeral files (QA artifacts, podcast audio per lifecycle) | Per bucket lifecycle (14–30 days) | Best effort | S3 Retain, optional cross-region replication |

---

## 4. Roles and escalation

| Role | Responsibility |
| ---- | -------------- |
| **Incident commander** | Owns timeline, comms, and go/no-go for failover or restore. Default: on-call engineering lead. |
| **Engineering** | Executes CloudFormation / AWS CLI procedures, validates health, coordinates rollbacks. |
| **Product / customer success** | Customer-facing status and impact assessment. |
| **Org platform team** | SCP changes, cross-account networking, and org-wide AWS Backup policies. |

**Escalation path (draft):**

1. Pager / on-call engineer (0–15 min) — triage, severity, begin runbook.  
2. Engineering lead (15–30 min) — resource allocation, customer comms decision.  
3. Executive sponsor (30+ min for SEV-1 / multi-tenant data risk) — external comms approval.

---

## 5. Customer communications template (draft)

Use after internal severity is confirmed. Replace bracketed fields.

> **Subject:** [Cohi] Service incident — [brief description]  
> **Body:**  
> We are investigating [elevated errors / partial outage / full outage] affecting Cohi.  
> **Impact:** [describe — e.g. API unavailable, read-only, specific tenants].  
> **Status:** Our team is actively working on this. Next update in [60] minutes or sooner if material change.  
> **Reference:** [internal incident ID]

---

## 6. Measured RTO / RPO (fill after drills)

| Drill date | Test | RTO observed | RPO observed | Notes |
| ---------- | ---- | ------------ | ------------ | ----- |
| _TBD_ | Aurora PITR (dev) | | | From [`DR_TEST_PLAN.md`](./DR_TEST_PLAN.md) §6 |
| _TBD_ | ECS rollback (dev) | | | |
| _TBD_ | Frontend rebuild (dev) | | | |
| _TBD_ | Region-loss tabletop | | | N/A for RPO; documents decisions |

---

## 7. Test cadence

| Activity | Cadence | Owner |
| -------- | ------- | ----- |
| Aurora PITR drill (dev) | Quarterly | Engineering |
| ECS rollback drill (dev) | Quarterly | Engineering |
| Frontend rebuild drill (dev) | Twice per year | Engineering |
| Region-loss tabletop | Annual | Engineering + product |

---

## 8. Ratification checklist

Complete **before** removing the DRAFT status at the top of this document:

- [ ] Product owner has approved the RTO/RPO targets in §3 (or revised them in writing).  
- [ ] Engineering lead has confirmed the controls in [`DISASTER_RECOVERY.md`](./DISASTER_RECOVERY.md) match production.  
- [ ] At least one successful Aurora PITR drill is recorded in [`DR_TEST_PLAN.md`](./DR_TEST_PLAN.md) §6.  
- [ ] §6 in this document is filled with measured numbers from drills (or explicitly waived with rationale).  
- [ ] Escalation contacts and customer template (§4–5) are approved by leadership.

**After sign-off:** Remove the **Status: DRAFT** line and this ratification checklist (or move checklist to an appendix with sign-off names and dates).

---

## 9. References

- [`DISASTER_RECOVERY.md`](./DISASTER_RECOVERY.md)  
- [`DR_TEST_PLAN.md`](./DR_TEST_PLAN.md)  
- [`DR_ROLLOUT_PLAN.md`](./DR_ROLLOUT_PLAN.md)  
- [`DR_DEPLOY_CHECKLIST.md`](./DR_DEPLOY_CHECKLIST.md)  
- [`DR_BACKLOG.md`](./DR_BACKLOG.md)  
- `infrastructure/cloudformation/coheus_aurora_cluster_stack.yaml`  
- `infrastructure/cloudformation/coheus_ecs_fargate_stack.yaml`

---

## 10. Implementation status (engineering)

Infrastructure-as-code and runbooks for DR phases 0–2 were added in-repo on **2026-05-12**. **Ratification** (§8 checklist, removal of the DRAFT banner, and filling §6 with measured numbers) remains with product and engineering leadership after live drills are executed.
