# Cohi Agent + Metrics + SQL Architecture Report

## Executive Summary

The current system is a **hybrid architecture**:

- some flows use centralized metric definitions (`METRICS_CATALOG`, `canonicalMetrics`)
- some flows use LLM-generated freeform SQL (with safety controls)
- some flows still have service-level embedded SQL logic

This means behavior can drift unless more paths are migrated to deterministic metric composition.

---

## Direct Answers To Key Questions

### Why was only pull-through centralized first?

That was a tactical first migration to fix a regression path quickly. It is not the final target architecture.

### Should agents see the full metric catalog and choose metrics from it?

Yes. That should be the default strategy: intent -> metric selection -> deterministic SQL composition.

### Is `canonicalMetrics` the only SQL source used by insights and chat?

No. It is one major canonical source, but many paths still generate or embed SQL outside it.

### Can agents still generate freeform SQL?

Yes. Multiple flows still generate SQL dynamically via LLM loops, though execution is guarded.

---

## End-to-End Flow Breakdown

## 1) Cohi Chat
Path: `server/src/services/ai/cohiChatService.ts`

### Flow

1. Optional deterministic navigation/help response path.
2. Main path gathers context in parallel:
   - LLM query generation (`generateQuery`)
   - RAG context retrieval
   - optional insight metrics for open-ended prompts
3. Executes SQL if generated.
4. Runs LLM response synthesis with available data/context.

### SQL behavior

- Primary: LLM-generated SQL
- Fallback: heuristic SQL path
- Recent change: segmented pull-through fallback now uses shared canonical builder from `canonicalMetrics`

### LLM-only behavior

- Navigation/help responses
- Final narrative synthesis
- Some KB-only responses

---

## 2) Workbench Chat
Path: `server/src/routes/cohiWorkbench.ts`

### Flow

1. Builds large system prompt with schema, widget catalog, canvas state, and verified metric formulas.
2. LLM returns structured actions (`create_widget`, `query_data`, `modify_widget`, `generate_report`, etc.).
3. Server validates/fixes SQL where needed.
4. For `query_data` actions, executes SQL then performs second LLM pass with actual results.

### SQL behavior

- LLM-generated freeform SQL for many actions
- Guardrails:
  - SELECT-only
  - EXPLAIN validation
  - pull-through semantic checks
  - optional SQL auto-fix loop

### LLM-only behavior

- Action planning
- Narrative/report writing
- Can answer directly from visible canvas data without query

---

## 3) Agentic Insights Pipeline
Path: `server/src/services/insights/agents/insightOrchestrator.ts`

### Flow

1. Planner agent generates investigation questions.
2. Investigator agents run iterative loops (think -> SQL -> execute -> analyze).
3. Evaluator agent scores and categorizes insights.
4. Persist insights and detail evidence.

### SQL behavior

- Investigators generate freeform SQL via LLM
- SQL executes via shared safe executor (`research/tools`)
- Metric definitions are provided to LLM as context but SQL remains model-authored

### LLM-only behavior

- Planning
- Evaluation / ranking / categorization
- Headline and narrative output

---

## 4) Legacy 3-pass Insights Pipeline
Path: `server/src/services/insights/llmInsightGenerator.ts`

### Flow

1. Metrics payload aggregation (`insightMetricsCollector`)
2. Multi-pass LLM generation/judging/curation
3. Evidence hydration and persistence

### SQL behavior

- Mix of deterministic collector SQL + evidence SQL + generated SQL components
- Not purely canonical-composer driven

### LLM-only behavior

- Candidate insight generation
- Judge/curator reasoning and text shaping

---

## 5) Research Analyst Agent
Path: `server/src/services/research/agents/dataAnalystAgent.ts`

### Flow

- Iterative research loop (think -> query -> observe -> follow-up -> final finding)
- Supports steering and pause controls

### SQL behavior

- LLM-generated freeform SQL
- Executed through safe read-only SQL utilities in `server/src/services/research/tools.ts`

### LLM-only behavior

- Reasoning, interpretation, finding synthesis

---

## Central Metric Layers (Current State)

## A) `METRICS_CATALOG`
Path: `server/src/services/metrics/metricsService.ts`

- Central metric registry with IDs, categories, formula descriptions, SQL snippets, date-field defaults, and dependencies.
- Current catalog size: 60 metrics.

## B) `canonicalMetrics`
Path: `server/src/services/metrics/canonicalMetrics.ts`

- Canonical cross-system period snapshots
- Pull-through/fallout consistency logic
- Verified SQL block injection for Workbench prompt context
- Shared segmented pull-through query builder and canonical predicates/count expressions

## C) Embedded/duplicated SQL in other services

Still present in service-level implementations (especially in analytics and insight collection paths).

---

## What Was Recently Centralized

1. Added shared canonical pull-through query generation and expressions in `canonicalMetrics`.
2. Updated `cohiChatService` fallback pull-through path to call canonical builder.
3. Updated parts of `insightDeepDive` to reference canonical pull-through predicates/expressions.
4. Generalized phrase-specific prompt instruction for segmented pull-through requests.

---

## Known Duplication Hotspots (Priority Migration Targets)

Highest priority executable SQL duplication:

- `server/src/services/dashboard/analyticsService.ts`
- `server/src/services/insights/insightMetricsCollector.ts`
- `server/src/services/workbench/insightDeepDive.ts` (partially migrated)
- `server/src/services/research/tools.ts` consumers relying on freeform metric SQL behavior
- `server/src/services/dashboard/loanComplexityDashboardService.ts`

Prompt/policy formula duplication (non-executable but drift-prone):

- `server/src/config/defaultPromptConfigs.ts`
- `server/src/routes/cohiWorkbench.ts`
- `server/src/services/insights/llmInsightGenerator.ts`

---

## Recommended Target Architecture

To eliminate drift and improve consistency:

1. **Intent planning (LLM)**  
   Map user request to metric IDs + dimensions + window + comparison.

2. **Deterministic SQL composition (code)**  
   Build SQL from shared registry/composer templates (not ad hoc LLM SQL by default).

3. **Safe execution + validation (code)**  
   Keep current SELECT-only + timeout + EXPLAIN/guardrail checks.

4. **Narrative generation (LLM)**  
   Use LLM for explanation and communication over already-executed results.

Freeform SQL should remain a fallback for unsupported analytical requests, not the primary path.

---

## Current Conclusion

The platform has a strong foundation for centralization (`METRICS_CATALOG` + `canonicalMetrics`) but remains partially hybrid.  
Further migration of analytics/insights collectors to a shared deterministic metric query composer is required to fully align agent outputs across chat, workbench, insights, and research.
