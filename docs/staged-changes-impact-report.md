# Cohi Staged Changes Impact Report

## Scope

This report summarizes the currently staged changes and what they mean for Cohi product behavior, architecture, security, and rollout risk.

- **Files changed:** 38
- **Net diff:** +3164 / -461
- **Primary theme:** move from hybrid LLM-authored SQL toward deterministic, catalog-backed metric composition with shared safety and access enforcement.

---

## Executive Summary

These staged changes are a major platform hardening step, not a cosmetic update.

Before this branch, Cohi already had metric stores (`METRICS_CATALOG`, `canonicalMetrics`), but many critical surfaces still relied on freeform model-authored SQL as a primary execution path. That created drift risk (same question, different surface, different logic).

This branch introduces and wires a **MetricSpec -> SQL Composer -> Safe Executor** path across Chat, Workbench, Insights, and Research (with flags and fallback). In practical terms:

1. Metric stores become closer to execution truth, not just prompt context.
2. Access control and SQL safety are centralized and stronger.
3. Chat guidance/navigation behavior is more deterministic and less hallucination-prone.
4. Operational controls (feature flags, trace schema) are in place for staged rollout.

---

## What Changed By Area

## 1) Deterministic Metric Composition Layer

### New core modules

- `server/src/services/metrics/metricSpec.ts`
- `server/src/services/metrics/metricPlanner.ts`
- `server/src/services/metrics/metricQueryComposer.ts`
- `server/src/services/metrics/intentRouter.ts`
- `server/src/services/metrics/metricComposerFlags.ts`
- `server/src/services/metrics/confidenceScorer.ts`
- `server/src/services/metrics/metricRunTracer.ts`
- `server/src/services/metrics/metricSpec.test.ts`

### Functional effect

- Introduces a validated `MetricSpec` contract as a normalized planning output.
- Adds planner-based metric selection and deterministic SQL composition.
- Reduces dependence on unconstrained freeform SQL for standard KPI prompts.
- Adds feature-gated cutover controls per surface.

### What it means

- Better metric consistency across product surfaces.
- Easier to debug and reason about results.
- Safer future extension of KPI definitions.

---

## 2) SQL Safety, Access Enforcement, and Runtime Guardrails

### New/shared enforcement modules

- `server/src/services/metrics/safeSqlExecutor.ts`
- `server/src/services/metrics/accessEnforcer.ts`

### Key safety capabilities

- Read-only SQL validation.
- Statement timeout.
- Per-tenant concurrency cap.
- Circuit breaker on repeated failures.
- Correct placeholder shifting when merging access predicates with parameterized SQL.

### What it means

- Lower risk of expensive or unsafe SQL behavior from AI paths.
- Correct row-level filtering even for parameterized SQL.
- Better resilience under failure bursts.

---

## 3) Chat System and Navigation Experience

### Backend changes

- `server/src/services/ai/cohiChatService.ts`
- `server/src/services/chat/cohiNavigationCatalog.ts` (new)
- `server/src/services/chat/navigationTargetCatalog.ts` (new)
- `server/src/services/chat/cohiNavigationCatalog.test.ts` (new)
- `server/src/services/chat/unifiedChatMappers.ts`
- `server/src/services/chat/unifiedChatPolicy.ts`
- `server/src/routes/cohiChat.ts`

### Behavioral changes

- Chat can run composer-first metric execution (flagged) before legacy path.
- Access filters are correctly propagated through execution.
- Navigation intent handling is deterministic and typo-tolerant.
- Dashboard suggestions are grounded in canonical route catalog.
- Research Lab and Insights hints are prioritized to remain visible in hint caps.
- Source attribution text is removed/sanitized in response messages.
- New API endpoint exposes canonical navigation targets:
  - `GET /api/cohi-chat/navigation-targets`

### What it means

- Fewer hallucinated dashboard references.
- More consistent in-chat "next step" navigation.
- Cleaner response text for end users.
- Better alignment between backend route knowledge and frontend search/navigation.

---

## 4) Workbench and Research Integration

### Workbench

- `server/src/routes/cohiWorkbench.ts`
- `server/src/services/workbench/insightDeepDive.ts`

Changes:
- `query_data` actions can now accept `metricSpec` (preferred) or raw SQL.
- Access-aware composition for metricSpec path.
- Reuse canonical pull-through expressions in deep-dive SQL generation.

### Research

- `server/src/services/research/tools.ts`
- `server/src/services/research/agents/dataAnalystAgent.ts`
- `server/src/services/research/orchestrator.ts`
- `server/src/routes/research.ts`

Changes:
- Research SQL execution delegates to shared safe executor.
- Access-filter merge support added for freeform and composed SQL paths.
- Session creation route is now rate-limited.

### What it means

- Better parity between exploratory and production KPI logic.
- Safer long-running research workflows.
- Reduced SQL semantics drift in analyst loops.

---

## 5) Insights Pipeline Evolution

- `server/src/services/insights/agents/insightInvestigatorAgent.ts`
- `server/src/services/insights/agents/insightEvaluatorAgent.ts`
- `server/src/services/insights/headlineMetricSignatureValidation.ts`

Changes:
- `headlineMetricSignature` can use either `sql` or `metricSpec`.
- Validation composes SQL from `metricSpec` when provided, then validates execution.

What it means:
- Insight signatures become less brittle and more catalog-aligned.
- Better path toward deterministic tracked-insight comparisons.

---

## 6) Frontend Wiring and Unified Envelope

- `src/components/dashboard/CohiChatPanel.tsx`
- `src/hooks/useCohiChat.ts`
- `src/lib/unifiedChatEnvelope.ts`
- `src/lib/unifiedChatEnvelope.test.ts`
- `src/components/layout/Navigation.tsx`
- `src/data/sidebarSearchTargets.ts`

Changes:
- Chat bubbles now render navigation hint buttons.
- Unified envelope parser carries `navigationHints`.
- Header/sidebar route search targets now come from backend canonical endpoint instead of static frontend list.

What it means:
- Unified UX for "answer + where to go next".
- Less frontend/backend catalog drift.
- Better maintainability of app navigation surfaces.

---

## 7) Operational Rollout and Observability

- `server/migrations/tenant/123_metric_query_traces.sql`
- `docs/metric-composer-rollout-status.md`
- `docs/cohi-agent-metrics-sql-architecture-report.md`
- `server/src/config/defaultPromptConfigs.ts`

Changes:
- Adds `metric_query_traces` table for governance telemetry.
- Documents rollout controls and follow-up tasks.
- Prompt configs updated to reflect composer-aware behavior.

What it means:
- Better auditability and release-control posture.
- Clearer transition plan from hybrid to deterministic architecture.

---

## Was Cohi Using Metric Stores Before?

Yes, but only partially as execution truth.

Before:
- Metric stores existed and were used in several places.
- Many high-impact flows still relied on LLM-authored SQL directly.

Now:
- A dedicated deterministic path has been added and wired more broadly.
- Metric stores are being promoted from reference/context to primary execution path (flagged rollout).

---

## Risks and Gaps To Track

1. **Hybrid state remains**
   - Freeform SQL fallback still exists (intentional), so full determinism is not complete yet.

2. **Trace persistence is optional in practice**
   - Trace schema/helper exists; ensure all intended paths actually persist traces.

3. **Navigation target endpoint depends on tenant/auth context**
   - Missing tenant selection can produce frontend fetch failures.

4. **Coverage is improving but still targeted**
   - Existing tests cover key pieces, but full multi-surface integration coverage should expand.

---

## Recommended Next Steps (Release-Readiness)

1. **Enable staged rollout flags per surface**
   - Start with chat/workbench subsets, then insights/research.

2. **Wire metric trace persistence on all composer executions**
   - Ensure complete observability during rollout.

3. **Add integration tests**
   - Composer + access merge + query execution parity across Chat/Workbench/Research/Insights.

4. **Add runtime dashboards**
   - Composer usage rate, fallback rate, query failure classes, and no-row rates.

5. **Validate tenant-selection UX**
   - Prevent silent nav-target fetch failures in frontend.

---

## Bottom Line

These staged changes materially improve Cohi's architectural direction:

- More deterministic KPI execution,
- stronger safety/access controls,
- better cross-surface consistency,
- improved chat navigation UX,
- and clearer rollout governance.

The platform is moving from a partially hybrid AI-SQL model toward a governed, catalog-backed metric execution model with controlled fallbacks.

