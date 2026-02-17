# Cohi Insights System — Vision vs. Implementation Gap Analysis

> **Date:** February 16, 2026  
> **Scope:** Comparison of the strategic vision document (`chatgptthoughts.md`) against the current implementation, including the full prediction service.

---

## Table of Contents

1. [Alignment Summary](#1-alignment-summary)
2. [Detailed Alignment — Where We Match](#2-detailed-alignment--where-we-match)
3. [Detailed Gaps — Where We Don't](#3-detailed-gaps--where-we-dont)
4. [Prediction System Deep Analysis](#4-prediction-system-deep-analysis)
5. [Scorecard](#5-scorecard)
6. [Priority Gap Ranking](#6-priority-gap-ranking)

---

## 1. Alignment Summary

The vision document describes Cohi as a **strategic decision engine** built on six pillars:

1. Clean LOS data layer
2. 36-month historical pattern engine
3. Agency logic engine
4. Predictive ML layer
5. Executive narrative engine
6. Continuous feedback learning

**Current state:** We have strong implementations of pillars 1, 5, and 6. Pillar 4 (predictive) is substantially built but has structural gaps vs. the vision. Pillars 2 and 3 are the largest misses.

---

## 2. Detailed Alignment — Where We Match

### 2.1 Data Architecture (Vision Section 1) — Strong

The vision calls for a "Cohi Intelligence Layer" ingesting core LOS data. Our system covers:

| Data Bucket | Status | Implementation |
|-------------|--------|----------------|
| Loan lifecycle timestamps | **Covered** | `application_date`, `closing_date`, `funding_date`, `ctc_date`, `closing_disclosure_sent_date`, `approval_date`, `conditional_approval_date`, `submitted_to_processing_date`, `submitted_to_underwriting_date` |
| Status history | **Covered** | `current_loan_status` with ILIKE pattern matching for all variants (withdrawn, denied, cancelled, etc.) |
| Borrower attributes | **Covered** | FICO, DTI, LTV, CLTV, self-employed flag — all bucketed in the prediction service with 1–6 signal scales |
| Product type | **Covered** | `loan_type` with categorical bucketing (Conventional, FHA, VA, HELOC, Construction, etc.) |
| Loan officer / branch / channel | **Covered** | Full personnel tiering with per-actor pull-through, revenue, cycle time; channel-aware column selection |
| Conditions count | **Covered** | `number_of_conditions` tracked, dedicated `condition_backlog` insight source |
| Lock data | **Covered** | Lock date, expiration, lock days; dedicated `lock_expiration` trigger; market delta calculation against lock rate |
| Turn times | **Partial** | Prediction service calculates milestone-to-milestone turn times (app→processing→UW→approval→CTC→close); insight system only uses aggregate cycle time |
| Secondary execution | **Covered** | `net_sell`, `net_buy` for gain-on-sale margin BPS; margin trend in insights |
| Fees / cost per loan | **Not covered** | |
| Exceptions / overlays | **Not covered** | |
| Appraisal metrics | **Not covered** | |

### 2.2 Executive Narrative Engine (Vision Section 4, 11, 12) — Strong

The vision says: *"Convert model output into mortgage-language insights. Eliminate generic AI tone. Speak like a senior secondary or capital markets executive. Quantify everything."*

**Current implementation matches well:**
- 4-bucket system (Working/Attention/Critical/Context) maps to the vision's "Here's what is working. Here's what is leaking margin. Here's what to fix."
- Prompt engineering includes explicit anti-hallucination rules (GOS vs volume, timeframe citation, pre-computed rankings)
- `impact` field on every insight captures `estimated_dollars` and `units_affected`
- Few-shot training examples from admin feedback steer narrative quality
- The vision's example — *"FHA denial rate increased from 16.4% to 21.1% driven primarily by DTI > 50% in credit band 580–620"* — requires product-level segmentation we don't yet feed to the LLM, but the narrative engine could produce this if given the data

### 2.3 Prompt Intelligence Framework (Vision Section 6) — Strong

The vision describes a rule-based trigger system: *"If denial bucket increases > 8% MoM → compare against baseline → identify drivers → quantify revenue → generate executive brief."*

**Our system implements this pattern:**
- Period snapshots with current-vs-prior for 5 time windows detect MoM changes
- Multi-window trend analysis (30D/60D/90D) identifies acceleration/deceleration
- The LLM prompt includes baselines and delta values
- Each insight outputs severity score, impact dollars, evidence metrics

**The gap:** Our triggers are implicit (the LLM decides what's notable from the full metrics payload) rather than explicit rule-based thresholds that fire independently. The vision suggests deterministic triggers; we rely on LLM judgment.

### 2.4 Feedback Loops (Vision Section 7) — Good

The vision calls for: "Insight helpful?" (Yes/No), "Action taken?" (Dropdown), "Missed something?" (Text box) feeding into pattern weighting, alert sensitivity, and narrative calibration.

**We have:**
- Thumbs up/down with tags (`inaccurate`, `not_useful`, `misleading_number`, `already_knew`)
- Free-text comment field
- Admin review dashboard across tenants
- Training example creation (positive/negative) → few-shot injection into future prompts
- A/B experiment system for controlled prompt iteration

**We don't have:**
- "Action taken?" tracking — no closed-loop outcome measurement
- Feedback feeding into pattern weighting or alert sensitivity thresholds
- Per-tenant sensitivity tuning

### 2.5 Comparative Intelligence (Vision Section 10) — Partial

The vision wants: current vs 3-year average, branch vs company, company vs industry, overlay vs agency, expected vs actual margin.

**We have:**
- 10 period snapshots with current-vs-prior (YTD, 90D, 60D, 30D, MTD)
- Multi-window trend detection across officers (accelerating/sustained/decelerating/blip)
- MoM/YoY volume, cycle time, and pull-through comparisons
- Margin current month vs prior month

**We don't have:**
- 3-year historical baseline (max lookback is ~12 months in comparison queries)
- Branch vs company average as an explicit comparison
- Company vs industry benchmarks
- Overlay vs agency baseline

### 2.6 Compliance Signals (Vision Section 9) — Partial

| Signal | Status |
|--------|--------|
| TRID timing violations | **Implemented** — G1 trigger: loans closing ≤5 days without CD sent |
| QM threshold drift | **Not implemented** |
| Overlay creep | **Not implemented** |
| Fair lending pattern flags | **Not implemented** |
| Missing HMDA fields | **Not implemented** |
| Inconsistent DTI calculations | **Not implemented** |
| AUS mismatch flags | **Not implemented** |

---

## 3. Detailed Gaps — Where We Don't

### 3.1 36-Month Historical Pattern Engine (Vision Section 2) — Major Gap

The vision's core thesis: *"What historically caused risk, delay, cost, or margin compression?"* with multi-dimensional aggregation across product, LTV range, credit band, DTI band, property type, occupancy, lock timing, turn times, pricing spread, branch, conditions count, income type.

**The prediction service has historical pattern learning** (via `getOrCreatePatternLearnings` which sends historical loan buckets to GPT for pattern extraction, and `compareToHistoricalFallouts` which matches active loans to similar historical loans). But the **insight generation system** doesn't use any of this.

The metrics collector (`insightMetricsCollector.ts`) works entirely on current/rolling aggregates. It never asks: *"FHA loans with credit 580–620 and DTI > 47% — what was their 36-month denial rate?"* The LLM sees flat numbers (e.g., "Denied Loans: 42 YTD") without multi-dimensional breakdowns.

**What the prediction service has that insights don't use:**
- Historical bucket risk profiles (FICO × DTI × LTV × loan type risk matrices)
- Per-bucket fallout rates from historical data
- Dynamic credit thresholds calibrated to each tenant's actual outcomes
- Historical turn time averages (milestone → funding)

### 3.2 Agency Intelligence Engine (Vision Section 3) — Not Implemented

The vision wants Cohi to understand Fannie Mae, Freddie Mac, FHA, VA, USDA guidelines and compare lender overlays against agency baselines.

No agency guideline data exists anywhere in the system. No overlay tracking. No insight like *"Your 660 minimum credit overlay on FHA eliminated 22% of otherwise approvable loans."*

### 3.3 Product-Level Segmentation — Not in the Insight Pipeline

The prediction service buckets loans by product type, occupancy, channel, purpose — but the insight metrics collector aggregates everything into a single pool. The LLM never sees:
- Denial rate by product type
- Pull-through by product type
- Credit distribution by product type
- Performance breakdown by product × credit band

This prevents insights like the vision's example: *"FHA denial rate increased from 16.4% to 21.1% driven primarily by DTI > 50% in credit band 580–620."*

### 3.4 Intelligence Tiers (Vision Section 8)

| Tier | Vision | Current System |
|------|--------|---------------|
| **Tier 1 — Descriptive** ("What happened?") | Core requirement | **Strong** — pipeline counts, funnel metrics, volume/revenue, comparisons |
| **Tier 2 — Diagnostic** ("Why did it happen?") | Core requirement | **Partial** — tiering identifies who, period changes identify when, but no multi-dimensional root cause analysis (why FHA denials increased, what changed in the credit mix) |
| **Tier 3 — Predictive** ("What will likely happen?") | Core requirement | **Partial** — fallout predictions exist but aren't deeply integrated with insights. Close-late predictions exist in prediction service but aren't surfaced. No cost or margin compression predictions |
| **Tier 4 — Prescriptive** ("What should we do?") | "Cohi must operate at Tier 4" | **Weak** — LLM can generate recommendations but they're based on surface metrics, not backed by historical evidence of what actions worked |

### 3.5 Cost Per Loan Model (Vision Section 5.3) — Not Implemented

No cost modeling exists. The vision calls for: turn time impact, conditions impact, rework rate, manual touchpoints.

### 3.6 Loan Complexity Score (Vision Section 5.2) — Not Implemented as Composite

The prediction service has individual signal buckets (FICO, LTV, DTI, loan type, purpose, occupancy, channel, self-employed) but no single **composite complexity score** that combines credit layering, income type, condition count, property complexity, and guideline edge cases into one number.

The `creditMetricsSignalStrength` and `loanCharacteristicsSignalStrength` are partial composites, but they don't include conditions, property complexity, or guideline edge cases.

### 3.7 Data Quality Intelligence (Vision Section 9) — Not Implemented

Missing HMDA fields, inconsistent DTI calculations, AUS mismatch flags — none of this exists.

---

## 4. Prediction System Deep Analysis

The `predictionService.ts` (~4,600 lines) is the most complex service in the codebase. Here's how it maps to the vision's "4 core predictive engines":

### 4.1 Fallout Prediction Model — Substantially Implemented

**Vision asks for:** Denied probability, Withdrawn probability, Close late probability using historical 36-month pattern training, Gradient boosting / XGBoost, time-based cross validation.

**What we have:**

| Feature | Implementation | Notes |
|---------|---------------|-------|
| Deny prediction | **Yes** — `creditRiskScore` from FICO, DTI, LTV, UW pull-through buckets | Rule-based scoring, not ML |
| Withdraw prediction | **Yes** — `processRiskScore` from time-in-motion, LO/closer/processor pull-through, interest lock vs market, team composition risk | Rule-based scoring, not ML |
| Close-late prediction | **Yes** — `predictClosingLate()` using pipeline stage, historical turn time averages, ECD comparison | Probability-based using historical milestone-to-close averages |
| Historical pattern learning | **Yes** — `getOrCreatePatternLearnings()` sends bucketed historical loans to GPT-5-mini for pattern extraction; `compareToHistoricalFallouts()` compares active loans to similar historical loans | AI-augmented, not traditional ML |
| Historical calibration | **Yes** — `getCalibratedThreshold()` scores all historical loans with the same method, finds the percentile that matches actual fallout rate | Ensures predicted fallout % ≈ actual fallout % |
| Historical bucket risk profiles | **Yes** — `computeHistoricalBucketFalloutStats()` computes per-bucket-combination fallout rates from historical outcomes | Used for binary scoring when available |
| Dynamic thresholds | **Yes** — `calculateAndCacheAllThresholds()` computes FICO/LTV/DTI bucket boundaries from actual historical distribution by loan type (Government vs Conventional) | Tenant-specific, adaptive |
| RAG-based prediction | **Yes** — `loanRag/` module with embedding-based similarity search against historical loans | Uses embeddings + GPT inference; available but not primary path |

**Key differences from vision:**
- **No traditional ML (XGBoost/Gradient Boosting)** — the system uses a hybrid of rule-based signal bucketing (1–6 scale), historical calibration, and LLM-based pattern recognition
- **No time-based cross-validation** — calibration uses all historical loans, not train/test splits
- The approach is arguably more pragmatic (works with any data volume, no model training required) but less statistically rigorous than the vision's ML approach

### 4.2 Signal Strength Architecture

The prediction service implements a sophisticated 8-signal bucketing system (1 = low risk, 6 = high risk):

| Signal | Inputs | Risk Dimension |
|--------|--------|----------------|
| `creditMetricsSignalStrength` | FICO + LTV + DTI composite | Denial risk |
| `loanCharacteristicsSignalStrength` | Loan type + purpose + occupancy + channel composite | Denial risk |
| `timeInMotionSignalStrength` | Days since application, milestone progression | Withdrawal risk |
| `mloAeFalloutProneSignalStrength` | LO historical pull-through rate | Withdrawal risk |
| `uwPullthroughSignalStrength` | Underwriter historical pull-through | Denial risk |
| `closerPullthroughSignalStrength` | Closer historical pull-through | Withdrawal risk |
| `processorPullthroughSignalStrength` | Processor historical pull-through | Withdrawal risk |
| `interestLockVsMarketSignalStrength` | Lock rate vs current market (FRED data) | Withdrawal risk |

Plus individual feature buckets: `ficoScoreSignal`, `ltvSignal`, `dtiSignal`, `cltvSignal`, `loanAmountSignal`, `loanTypeSignal`, `loanPurposeSignal`, `occupancyTypeSignal`, `channelSignal`, `selfEmployedSignal`.

**This is more granular than the vision anticipated.** The vision describes signals in general terms; the implementation has 18+ distinct signal dimensions with dynamic tenant-specific thresholds.

### 4.3 Close-Late Prediction — Implemented

The prediction service includes a full close-late prediction system that the vision calls for:

- `determinePipelineStage()` — maps milestone dates to a 1–7 readiness score
- `calculateHistoricalTurnTimeAverages()` — computes avg days from each milestone to funding using historical originated loans
- `projectClosingDate()` — estimates when a loan will close based on current stage + historical averages
- `predictClosingLate()` — compares projected close date to ECD
- `calculateCloseOnTimeProbability()` — statistical probability using stage-to-close percentiles
- `computeHistoricalOnTimeStats()` — P25/P50/P75/P90 percentiles for stage-to-close days

**Gap:** This is available per-loan but isn't aggregated into the insight metrics payload. The insight system has a simpler `closingRisk` trigger (loans closing ≤10 days without CTC) that doesn't use any of this sophisticated milestone-based prediction.

### 4.4 Margin Compression Risk (Vision Section 5.4) — Partially Implemented

**We have:**
- Market delta calculation (`calculateMarketDelta`) comparing lock rate to current market rate (via FRED API data)
- `interestLockVsMarketSignalStrength` signal bucket
- Margin BPS tracking (current vs prior month) in insights

**We don't have:**
- Lock extension likelihood prediction
- Repricing probability prediction
- Secondary spread variance analysis

### 4.5 Loan Complexity Score (Vision Section 5.2) — Not a Single Score

The prediction service has the building blocks — individual buckets for credit layering, income type (self-employed), conditions, loan characteristics — but doesn't combine them into a single "Loan Complexity Score" as the vision describes. The closest equivalents are `creditMetricsSignalStrength` and `loanCharacteristicsSignalStrength`, which are partial composites.

### 4.6 Cost Per Loan (Vision Section 5.3) — Not Implemented

No cost modeling anywhere in the system.

---

## 5. Scorecard

| Vision Area | Alignment | Current Implementation |
|-------------|-----------|----------------------|
| **1. LOS Data Layer** | **Strong** | 80% of data buckets covered. Missing: appraisal, fees/cost, exceptions/overlays |
| **2. Historical Pattern Engine** | **Partial** | Prediction service has historical patterns, calibration, bucket risk profiles — but none of this flows into the insight LLM pipeline |
| **3. Agency Intelligence** | **Not implemented** | No guideline data, no overlay tracking |
| **4. Executive Narrative** | **Strong** | 4-bucket LLM system, anti-hallucination prompt engineering, quantified impacts |
| **5a. Fallout Prediction** | **Strong** | Rule-based + historically calibrated + RAG pipeline, 18+ signal dimensions. Not XGBoost but arguably more adaptive |
| **5b. Loan Complexity Score** | **Partial** | Individual signals exist, no unified composite |
| **5c. Cost Per Loan** | **Not implemented** | No cost modeling |
| **5d. Margin Compression Risk** | **Partial** | Market delta + BPS tracking, no lock extension or repricing prediction |
| **6. Prompt Intelligence** | **Strong** | Configurable prompts per bucket, experiment system, training examples |
| **7. Feedback Loops** | **Good** | Thumbs up/down + tags + training examples. Missing: action tracking, threshold tuning |
| **8. Intelligence Tiers** | **Tiers 1–2 strong, 3 partial, 4 weak** | Descriptive and some diagnostic. Predictive exists but disconnected. Prescriptive is LLM-improvised |
| **9. Insight Categories** | | |
| — Business & Strategic | **Good** | Volume trends, LO performance, branch tiering |
| — Credit Overview | **Partial** | WA FICO/LTV/DTI and high-risk counts, but no layered risk analysis by product/credit band |
| — Data Quality | **Not implemented** | |
| — Compliance | **Partial** | TRID only |
| **10. Comparative Intelligence** | **Partial** | Period-over-period yes. Industry/agency benchmarks no |
| **11. AI Narrative** | **Strong** | LLM layer with mortgage-domain prompt engineering |
| **12. Example Insight Quality** | **Achievable** | The narrative engine could produce the vision's example insights if given richer data inputs |

---

## 6. Priority Gap Ranking

Based on impact and feasibility, here are the gaps ranked by what would move us closest to the vision:

### Tier 1 — High Impact, Achievable Now (use existing data + code)

| # | Gap | Why It Matters | Effort |
|---|-----|----------------|--------|
| 1 | **Bridge prediction service data into insight metrics** | The prediction service already computes per-loan signal strengths, close-late predictions, historical bucket risk profiles, and milestone turn times. The insight metrics collector ignores all of this. Piping even summary-level prediction data (e.g., "42 loans with closeLateRisk, avg closeOnTimeProbability: 38%") into the LLM would immediately upgrade insights from Tier 1→2 to Tier 2→3. | Medium |
| 2 | **Add product-level segmentation to metrics collector** | The data already has `loan_type`. Adding a GROUP BY product_type to the lost opportunity, credit risk, and funnel queries would let the LLM produce insights like the vision's FHA denial example. | Medium |
| 3 | **Extend historical lookback to 36 months** | Currently maxes out at 12 months. The data exists in the DB — it's just the query date ranges that limit it. Extending comparisons and snapshots to 3 years enables the "36-month pattern engine" the vision describes. | Low |
| 4 | **Surface close-late predictions in insights** | `predictClosingLate()` and `calculateCloseOnTimeProbability()` are fully implemented but not in the insight pipeline. The current `closingRisk` trigger is a simple "closing ≤10 days without CTC" check. Replacing or augmenting it with the prediction service's probabilistic model would be a significant upgrade. | Low–Medium |

### Tier 2 — High Impact, Moderate Effort

| # | Gap | Why It Matters | Effort |
|---|-----|----------------|--------|
| 5 | **Multi-dimensional root cause analysis** | Instead of "Denied loans: 42 YTD", produce "Denied loans by product × credit band × DTI range" so the LLM can identify specific risk pockets. Uses the prediction service's bucket dimensions as the framework. | Medium–High |
| 6 | **Action tracking on insights** | Add "Action taken?" to feedback. This closes the loop and eventually enables prescriptive insights: "Last time we saw this pattern, you adjusted overlays and denial rate dropped 8%." | Medium |
| 7 | **Branch vs company comparison** | The tiering system already has per-branch and per-officer data. Computing the company average and expressing each branch as a delta would be straightforward. | Low–Medium |
| 8 | **Loan Complexity Score** | Combine existing signal buckets into a single composite score. The prediction service already has `creditRiskScore` and `processRiskScore` — wrapping these into a single 1–100 "Loan Complexity Score" and exposing it in insights would match the vision. | Low |

### Tier 3 — High Impact, High Effort (new data/systems needed)

| # | Gap | Why It Matters | Effort |
|---|-----|----------------|--------|
| 9 | **Agency guideline engine** | Requires ingesting Fannie/Freddie/FHA/VA guideline matrices and comparing against lender overlays. High value for strategic insights but requires significant data acquisition. | High |
| 10 | **Industry benchmark data** | Requires external data source for industry averages by product, geography, lender size. Enables "company vs industry" comparisons. | High |
| 11 | **Cost per loan modeling** | Requires fee data, rework tracking, manual touchpoint counting. Data likely doesn't exist in current LOS imports. | High |
| 12 | **Data quality monitoring** | HMDA field completeness, DTI consistency checks, AUS mismatch detection. Requires defining expected schemas and running validation. | Medium–High |
| 13 | **Full compliance suite** | QM threshold monitoring, fair lending pattern flags, overlay creep detection. Requires regulatory knowledge base. | High |

---

*End of analysis.*
