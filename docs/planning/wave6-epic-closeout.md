# Wave 6 — epic COHI-386 closeout

## Epic acceptance criteria

| # | Criterion | Evidence |
| - | --------- | -------- |
| 1 | Child story ACs met or PM-deferred | [wave6-ac-verification-checklist.md](./wave6-ac-verification-checklist.md); E2E `e2e/unified-chat-*.spec.ts` |
| 2 | Meeting spec §1–§11 | Traceability in Wave 6 plan; gaps only with PM sign-off |
| 3 | Legacy routes shim-only | [unified-chat-rollout.md](./unified-chat-rollout.md) Wave 6 legacy table |
| 4 | Big-bang readiness | Replay ≥95%, `@critical` E2E green, rollback drill logged |

## COHI-397 / COHI-398 deliverables

- **COHI-397:** Playwright suite + `npm run replay:unified-chat` + rollout replay threshold
- **COHI-398:** Production cutover checklist, monitoring, rollback drill template in rollout doc

## Deferred: COHI-389 AC3 (platform tenant)

Cross-tenant `platformTenantId` is **not** wired in v1 handlers until the request schema defines it. PM may accept deferral for GA; see [wave4-jira-implementation-status.md](./wave4-jira-implementation-status.md).

## COHI-397 Jira AC — [CATEGORY] draft (paste to Jira)

1. **[ROUTE]** Playwright `e2e/unified-chat-*.spec.ts` includes `@critical @COHI-386` tags discoverable by QA pipeline.
2. **[ROUTE]** `/data-chat` with unified flag: `POST /api/chat/v1/messages` returns blocks envelope (E2E: `unified-chat-cohi386.spec.ts` AC2).
3. **[ASSERTION]** Golden replay `npm run replay:unified-chat` meets agreed pass rate on staging (default ≥95%); documented in rollout runbook.
4. **[ASSERTION]** Hub resume, workbench actions, research-in-chat smoke, legacy Research redirects covered by `unified-chat-surfaces.spec.ts`, `unified-chat-research.spec.ts`, `unified-chat-history.spec.ts` AC4.
