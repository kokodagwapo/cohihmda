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

Cohi is **not** critical financial infrastructure — there is no real-time payment processing, regulatory uptime SLA, or time-sensitive transaction flow. Targets reflect a practical balance between cost and acceptable downtime.

| Tier | Component | RPO (max acceptable data loss) | RTO (max acceptable outage) | Primary controls |
| ---- | --------- | ------------------------------ | ---------------------------- | ------------------ |
| T1 | Aurora PostgreSQL (management + tenant clusters) | **Near-zero** for in-region incidents (Aurora PITR — restore to any second within the last 35 days); **up to 24 hours** for regional loss (last successful daily AWS Backup copy to DR vault) | **4 hours** (in-region restore); **8–24 hours** (cold cross-region restore from DR snapshot + full app cutover) | PITR, snapshots, second reader, AWS Backup daily/monthly, **cross-region backup copy** |
| T2 | API / worker (ECS Fargate) | Stateless — none | **4 hours** | Redeploy task definition, ECR images retained |
| T3 | Frontend (S3 + CloudFront) | None if rebuilt from CI | **4 hours** | CI redeploy, optional S3 versioning |
| T4 | QA artifacts | Per bucket lifecycle (30 days) | Best effort | S3 Retain |
| — | Podcast audio | **N/A** — regenerable from source data | **N/A** — regenerate, do not restore | Not backed up; 14-day S3 lifecycle |

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
| 2026-05-12 | Aurora PITR (dev) | ~12 min (infra only) | ≤30 min (restore target offset) | Full SQL verify pending; see [`DR_TEST_REPORT_2026-05-12.md`](./DR_TEST_REPORT_2026-05-12.md). |
| 2026-05-12 | ECS rollback (dev) | ~12 min (auto-rollback) | N/A (stateless) | Pass. Circuit breaker tripped at `failedTasks=4`, auto-rolled back to known-good. |
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
