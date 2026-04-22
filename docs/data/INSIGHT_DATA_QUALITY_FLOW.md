# Insight Data Quality Flow

This document explains how data quality (DQ) is attached to **insights** in Cohi.
It is intentionally practical and not deeply implementation-heavy.

## What this is

When an insight is generated, the system can attach a `data_quality` block that tells users:

- whether a data issue affects trust in that insight,
- which canonical DQ checks are most relevant,
- how many loans are affected in that insight's cohort,
- and sample rows to help validate the issue quickly.

The canonical source of DQ checks is `DATA_QUALITY_TESTS` in:

- `server/src/services/dataQuality/dataQualityTests.ts`

---

## End-to-end flow

DQ tagging for insights follows a staged pipeline:

1. **Agentic prefilter (high recall)**
2. **Cohort-scoped SQL verification (truth gate)**
3. **Final relevance/ranking (precision gate)**

Only checks that survive all stages are persisted as final `review_test_ids`.

---

## Stage 1: Agentic prefilter (broad candidate nomination)

The evaluator LLM proposes a broad set of DQ candidate tests for each flagged insight.

### Inputs used

- insight headline/summary/evidence context
- compact DQ catalog metadata:
  - `id`
  - `name`
  - `description`
  - `requiredColumns`

### How it behaves

- High recall by design (prefer trying more checks over missing a relevant one).
- Emphasizes overlap with `requiredColumns` first.
- Uses `name`/`description` as semantic support.

### Output fields (inside `data_quality`)

- `prefilter_candidate_test_ids`
- `prefilter_basis`
- `prefilter_notes` (optional)

If agentic prefilter candidates are absent/malformed, the pipeline can fallback to `review_test_ids` from evaluator output.

---

## Stage 2: Cohort-scoped SQL verification (authoritative)

Each candidate test is executed against the **insight cohort**.

### Cohort source preference

1. `headlineMetricSignature.sql`
2. `metricSignature.sql`
3. deterministic fallback cohort

The cohort extractor lives in:

- `server/src/services/insights/insightCohortExtractor.ts`

### Verification rule

Candidate test survives only if:

- `COUNT(*) > 0` for that test condition inside the cohort

### Additional output

For surviving checks, the system captures sample rows (up to 20) and includes required columns for that test:

- `dq_samples_by_test_id`
- `dq_sample_columns_by_test_id`

---

## Stage 3: Final relevance/ranking (post-SQL precision)

From SQL-verified tests, a final relevance pass keeps the most contextually correct checks.

### Goals

- drop true-but-irrelevant checks,
- apply contradiction-aware filtering,
- keep top relevant checks (typically a small set).

### Final persisted IDs

The final user-facing check list is:

- `data_quality.review_test_ids`

So the final IDs are **not** raw LLM output and **not** raw SQL output alone; they are post-SQL relevance-ranked.

---

## What users see in the UI

In the Insight Detail modal:

- DQ summary (`issue_summary`, trust and coverage),
- final DQ check IDs and groups,
- sample table(s) with `loan_id`, `loan_number`, and test-required columns,
- deep link to the Data Quality dashboard warning.

Frontend parsing/rendering touchpoints:

- `src/lib/insightDataQuality.ts`
- `src/components/dashboard/DataQualityImpactBlock.tsx`

---

## Observability (runtime logs)

During generation runs, orchestrator logs include:

- insight being analyzed,
- candidate test IDs,
- per-test verification attempts,
- final selected test IDs,
- candidate breadth metrics.

These are emitted during DQ verification in:

- `server/src/services/insights/agents/insightOrchestrator.ts`

---

## Scope note: pipeline vs dashboard insights

Current DQ insight pipeline is attached to agent/pipeline insights persisted in `generated_insights`.

`dashboard_generated_insights` uses a separate flow and does not currently run this DQ verification pipeline by default.

