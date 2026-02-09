# Fallout Prediction System — Complete Technical Documentation

> **Last updated:** February 2026
>
> This document provides a thorough, end-to-end explanation of how the Closing Fallout Forecast feature works — from raw loan data ingestion through risk scoring, calibration, close-late prediction, database persistence, API delivery, and frontend display.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [End-to-End Data Flow](#2-end-to-end-data-flow)
3. [Data Preparation](#3-data-preparation)
4. [Signal Bucket System](#4-signal-bucket-system)
5. [Risk Score Calculation](#5-risk-score-calculation)
6. [Per-Tenant Calibration](#6-per-tenant-calibration)
7. [Predicted Outcome Determination](#7-predicted-outcome-determination)
8. [Close-Late Prediction](#8-close-late-prediction)
9. [Database Persistence](#9-database-persistence)
10. [Caching System](#10-caching-system)
11. [API Endpoints](#11-api-endpoints)
12. [Frontend Display](#12-frontend-display)
13. [Design Decisions](#13-design-decisions)

---

## 1. Architecture Overview

The fallout prediction system estimates which active mortgage loans in a lender's pipeline are likely to **originate** (close successfully), **withdraw** (borrower cancels), or be **denied** (lender rejects). It also estimates which loans are likely to **close late** (miss their estimated closing date).

### Key Principle

> **`riskScore` (1–100) is the single source of truth** for risk level, bucket assignment, AND predicted outcome. Higher score = higher risk = more likely to fall out.

### System Components

| Component | Location | Role |
|-----------|----------|------|
| **Prediction Service** | `server/src/services/dashboard/predictionService.ts` | Core engine: data prep, bucketing, scoring, calibration, close-late analysis |
| **Predictions Route** | `server/src/routes/predictions/index.ts` | API layer: fetches loans from DB, triggers prediction, formats responses |
| **Frontend Component** | `src/components/dashboard/ClosingFalloutForecast.tsx` | Dashboard UI: triggers predictions, displays KPIs, tables, modals |
| **Database** | `public.loan_predictions` table | Stores predicted outcomes, risk scores, and full loan data as JSONB |
| **Historical Bucket Cache** | `public.historical_loan_bucket_cache` table | Caches signal buckets for finalized loans to avoid recomputation |

### Multi-Tenant Design

Each **tenant is a lender**. All calibration, thresholds, and predictions are computed **per-tenant** using that tenant's own historical loan data. There are no shared or global thresholds.

---

## 2. End-to-End Data Flow

### Prediction Trigger (POST `/api/predictions`)

```
User clicks "Run Prediction" button
        │
        ▼
Frontend POST /api/predictions
        │
        ▼
Predictions Route queries tenant DB
  ├── Active loans: current_loan_status = 'Active Loan', has application_date
  └── Historical loans: all non-active loans (for calibration)
        │
        ▼
predictionService.runPredictFlow()
  1.  prepareLoanData()           → normalize fields, parse dates/numerics
  2.  filterHistoricalLoans()     → separate finalized loans with known outcomes
  3.  Market rate sync            → fetch current rates from FRED (async)
  4.  Historical bucket cache     → load or rebuild cached signal buckets
  5.  addActualOutcomeToHistorical() → tag each historical loan as originate/withdraw/deny
  6.  Compute pullthrough rates   → per loan officer, underwriter, closer, processor
  7.  computeHistoricalOnTimeStats() → on-time closing statistics
  8.  getCalibratedThreshold()    → find risk score threshold from historical distribution
  9.  bucketLoanData()            → compute all signal buckets for active loans
  10. generateRuleBasedSummary()  → compute riskScore, bucket, predictedOutcome per loan
  11. calculateCloseOnTimeProbability() → compute close-late risk per loan
  12. savePredictionsToDatabase() → upsert to loan_predictions table
  13. Return response             → bucketed loans, outcome counts, summary
        │
        ▼
Frontend receives response
  ├── Updates bucketedLoans state
  ├── Updates prediction counts
  └── Recomputes KPI metrics
```

### Loading Saved Predictions (GET `/api/predictions`)

```
Frontend fetches GET /api/predictions?period=rolling_3_months
        │
        ▼
Predictions Route queries loan_predictions table
  ├── DISTINCT ON (loan_id) — latest prediction per loan
  ├── Joins with public.loans for fresh field values
  ├── Optionally filters by period (application_date range)
  └── Reconstructs loanData from stored JSONB + fresh DB values
        │
        ▼
Frontend receives stored predictions
  └── Same data flow as POST response
```

---

## 3. Data Preparation

**Function:** `prepareLoanData(loans)` in `predictionService.ts`

Before any analysis, raw loan records from the database are normalized into a consistent format.

### Fields Extracted

| Category | Fields | Parsing |
|----------|--------|---------|
| **Identifiers** | `loan_id`, `loan_number`, `guid` | Direct copy |
| **Dates** | `application_date`, `lock_date`, `lock_expiration_date`, `closing_date`, `estimated_closing_date`, `fund_date`, `uw_denied_date` | `parseDate()` — validates and converts to Date objects |
| **Milestone Dates** | `ctc_date`, `approval_date`, `uw_final_approval_date`, `cond_approval_date`, `conditional_approval_date`, `submitted_to_processing_date`, `submitted_to_underwriting_date` | `parseDate()` |
| **Credit Metrics** | `fico_score`, `be_dti_ratio`, `ltv_ratio`, `cltv` | `parseNumeric()` — handles strings, nulls, NaN |
| **Loan Details** | `loan_amount`, `interest_rate`, `loan_type`, `loan_purpose`, `channel`, `occupancy_type`, `property_type` | String normalization |
| **Personnel** | `loan_officer`, `underwriter`, `closer`, `processor` | Direct copy |
| **Other** | `branch`, `current_loan_status`, `current_milestone`, `commission_assumption`, `lender_credit_amount` | Various |

### Field Name Resolution

The system checks multiple possible field names for each value to handle different LOS (Loan Origination System) exports:

```
FICO: fico_score → fico → Fields.VASUMM.X23 → Fields.ULDD.X101 → credit_score
LTV:  ltv → ltv_ratio → Fields.353
DTI:  be_dti_ratio (primary) → dti → dti_ratio → Fields.1125
```

`be_dti_ratio` is the primary DTI source — it's a structured database column (not from `raw_data`, which has been removed).

---

## 4. Signal Bucket System

Every loan is analyzed across multiple dimensions, each producing a **signal bucket** on a 1–6 scale:

- **1–2**: Low risk (favorable)
- **3–4**: Medium risk (moderate concern)
- **5–6**: High risk (elevated concern)

### Credit & Financial Signals

#### FICO Score (`ficoScoreSignal`)

| Bucket | FICO Range | Risk Level |
|--------|-----------|------------|
| 1 | ≥ 770 | Excellent |
| 2 | 730–769 | Good |
| 3 | 700–729 | Moderate |
| 4 | 660–699 | Below average |
| 5 | 620–659 | Poor |
| 6 | < 620 | Very poor |

#### LTV Ratio (`ltvSignal`)

| Bucket | LTV Range | Risk Level |
|--------|----------|------------|
| 1 | ≤ 60% | Very low leverage |
| 2 | 61–70% | Low leverage |
| 3 | 71–80% | Standard |
| 4 | 81–85% | Elevated |
| 5 | 86–90% | High leverage |
| 6 | > 90% | Very high leverage |

#### DTI Ratio (`dtiSignal`)

| Bucket | DTI Range | Risk Level |
|--------|----------|------------|
| 1 | ≤ 30% | Comfortable |
| 2 | 31–36% | Good |
| 3 | 37–43% | Moderate |
| 4 | 44–49% | Stretched |
| 5 | 50–56% | High burden |
| 6 | > 56% | Very high burden |

### Loan Characteristic Signals

#### Loan Type

| Bucket | Types |
|--------|-------|
| 1 | Conventional |
| 2 | VA |
| 3 | HELOC |
| 4 | Rural |
| 5 | FHA, FarmersHomeAdministrative |
| 6 | Other, Construction |

#### Loan Purpose

| Bucket | Purposes |
|--------|---------|
| 1 | Refinance No Cash-Out |
| 2 | Refinance Cash-Out |
| 3 | Purchase |
| 4 | Construction to Permanent |

#### Occupancy Type

| Bucket | Type |
|--------|------|
| 1 | Primary Residence |
| 2 | Second Home |
| 3 | Investor |

#### Channel

| Bucket | Channel |
|--------|---------|
| 1 | Banked – Retail |
| 2 | Banked – Wholesale |
| 3 | Brokered |
| 4 | Other |

#### Loan Amount

| Bucket | Range |
|--------|-------|
| 1 | < $200K |
| 2 | $200K–$299K |
| 3 | $300K–$399K |
| 4 | $400K–$599K |
| 5 | $600K–$899K |
| 6 | ≥ $900K |

### Process & Timeline Signals

#### Time in Motion / Active Days (`timeInMotionSignalStrength`)

| Bucket | Days Active | Risk |
|--------|------------|------|
| 1 | 1–10 | Fresh, moving fast |
| 2 | 11–20 | On track |
| 3 | 21–30 | Standard |
| 4 | 31–45 | Getting long |
| 5 | 46–74 | Stale |
| 6 | ≥ 75 | Very stale |

#### Market Change Delta (`interestLockVsMarketSignalStrength`)

Calculated as: `lockMarketRate - closeMarketRate` (rate at lock vs. current market rate).

| Bucket | Delta Range | Meaning |
|--------|-----------|---------|
| 1 | ≤ -0.3% | Very favorable (rates rose, lock saves money) |
| 2 | -0.299% to -0.1% | Favorable |
| 3 | -0.099% to +0.05% | Neutral |
| 4 | +0.051% to +0.2% | Slightly unfavorable |
| 5 | +0.201% to +0.5% | Unfavorable (borrower may shop) |
| 6 | > +0.5% | Very unfavorable |

#### Time to Approval

| Bucket | Days |
|--------|------|
| 1 | 0–25 |
| 2 | 26–40 |
| 3 | 41–60 |
| 4 | 61–90 |
| 5 | 91–150 |
| 6 | > 150 |

### Personnel Pull-Through Signals

Each personnel role (loan officer, underwriter, closer, processor) gets a pull-through signal based on their historical success rate:

| Bucket | Pull-Through Rate | Risk |
|--------|-------------------|------|
| 1 | ≥ 85% | Excellent |
| 2 | 78–84.999% | Good |
| 3 | 70–77.999% | Average |
| 4 | 60–69.999% | Below average |
| 5 | 50–59.999% | Poor |
| 6 | < 50% | Very poor |

Pull-through rates are computed from historical data: `originated / (originated + withdrawn + denied)` for each person.

Signals:
- `mloAeFalloutProneSignalStrength` — Loan Officer pull-through
- `uwPullthroughSignalStrength` — Underwriter pull-through
- `closerPullthroughSignalStrength` — Closer pull-through
- `processorPullthroughSignalStrength` — Processor pull-through

### Composite Signals

Two composite signals are computed from averages of their component buckets:

- **Credit Metrics Signal** (`creditMetricsSignalStrength`): Average of FICO + LTV + DTI buckets, rounded
- **Loan Characteristics Signal** (`loanCharacteristicsSignalStrength`): Average of Loan Type + Loan Purpose + Channel + Occupancy buckets, rounded

---

## 5. Risk Score Calculation

**Function:** `generateRuleBasedSummary(loan, options)` in `predictionService.ts`

### Two Risk Dimensions

Signal buckets are split into two groups representing different types of fallout risk:

#### Process Risk (Withdrawal Risk)

Measures the likelihood that the **borrower cancels** due to process delays, market conditions, or shopping behavior.

**Buckets used:**
- `timeInMotionSignalStrength` (1–6) — how long the loan has been active
- `mloAeFalloutProneSignalStrength` (1–6) — loan officer's track record
- `closerPullthroughSignalStrength` (1–6) — closer's track record
- `processorPullthroughSignalStrength` (1–6) — processor's track record
- `interestLockVsMarketSignalStrength` (1–6) — market rate comparison
- **Inverse FICO**: `7 - ficoScoreSignal` (1–6)

> **Why inverse FICO for process risk?** Borrowers with excellent credit (FICO bucket 1) have more options and are more likely to shop around and withdraw. So FICO 1 → process risk 6 (high withdrawal risk), FICO 6 → process risk 1 (they have fewer alternatives).

**Calculation:** `processRiskAvg = average of all available process risk buckets` (range: 1.0–6.0)

#### Credit Risk (Denial Risk)

Measures the likelihood that the **lender rejects** the loan due to credit or underwriting issues.

**Buckets used:**
- `ficoScoreSignal` (1–6) — borrower credit score
- `dtiSignal` (1–6) — debt-to-income ratio
- `ltvSignal` (1–6) — loan-to-value ratio
- `loanCharacteristicsSignalStrength` (1–6) — loan type/purpose complexity
- `uwPullthroughSignalStrength` (1–6) — underwriter's approval track record

**Calculation:** `creditRiskAvg = average of all available credit risk buckets` (range: 1.0–6.0)

### Scaling to 1–100

Each dimension average (1.0–6.0) is scaled to a 1–100 score:

```
scaleToHundred(avg) = Math.round(((avg - 1) / 5) * 99 + 1)
```

| Dimension Average | Score (1–100) |
|-------------------|---------------|
| 1.0 | 1 |
| 2.0 | 21 |
| 3.0 | 41 |
| 3.5 | 51 |
| 4.0 | 61 |
| 5.0 | 80 |
| 6.0 | 100 |

### Final Risk Score

```
riskScore = Math.max(processRiskScore, creditRiskScore)
```

The **maximum** of both dimensions is used so that a single critical dimension drives the score. A loan with excellent credit but terrible process risk still shows as high risk — problems aren't hidden by averaging.

**Fallback:** If no signal buckets are available, `riskScore = 50`.

### Risk Bucket Assignment

```
if (riskScore >= 75) → bucket = 'high'
if (riskScore >= 50) → bucket = 'medium'
if (riskScore < 50)  → bucket = 'low'
```

| Bucket | Risk Score | Description |
|--------|-----------|-------------|
| **high** | 75–100 | Elevated risk, likely to fall out |
| **medium** | 50–74 | Moderate risk, requires attention |
| **low** | 1–49 | Low risk, likely to originate |

### Optional Risk Add-Ons

Three optional adjustments can increase the risk score when additional context is available:

| Add-On | Condition | Effect |
|--------|-----------|--------|
| **Pattern** | Historical loans with similar FICO/DTI/MLO had >50% fallout | +2 to process risk average |
| **Trend** | Personnel's recent pull-through is >10 pts below their overall average | Up to +2 to process risk |
| **Stage** | Loan has been in pipeline longer than the historical average for its stage | Increases process risk |

These only activate when the necessary historical data is provided in the options object. Importantly, they are applied **identically** to both historical and active loans during calibration (see Section 6).

---

## 6. Per-Tenant Calibration

Calibration ensures that the **predicted fallout rate matches the tenant's historical fallout rate**. Without calibration, a fixed threshold might predict too many or too few fallouts.

### How It Works

1. **Compute historical fallout rate:**
   ```
   historicalFalloutRate = (withdraw + deny) / total historical loans
   ```
   For example: 220 fell out / 470 total = 46.8% fallout rate.

2. **Score all historical loans** using `generateRuleBasedSummary()` with the **same options** as active loans (including pattern, trend, and stage add-ons). This is critical — see Section 6.2.

3. **Sort historical risk scores** in ascending order.

4. **Find the threshold** at the `(1 - historicalFalloutRate)` percentile.
   - Example: 46.8% fallout → threshold at the 53.2nd percentile of historical scores.
   - If that percentile corresponds to `riskScore = 62`, then 62 is the threshold.

5. **Apply to active loans:** Any active loan with `riskScore >= 62` is predicted to fall out. Since the score distribution should be similar, roughly 46.8% of active loans will fall above the threshold.

### Why Same Options for Calibration

**The Bug (fixed):** Originally, historical loans were scored **without** the optional add-ons (pattern, trend, stage) during calibration, but active loans were scored **with** them. This made active loan scores higher, so far more exceeded the threshold → 131/154 predicted fallout instead of ~54%.

**The Fix:** Both historical and active loans are now scored with identical options during calibration, ensuring the threshold comes from the same score distribution.

### Uncalibrated Fallback

When no historical data is available (new tenant, insufficient data), a **fixed threshold of 65** is used. This is conservative to avoid over-predicting fallout.

---

## 7. Predicted Outcome Determination

### Outcome Logic

```typescript
if (riskScore >= calibratedThreshold) {
  // Loan is predicted to fall out
  if (creditRiskAvg >= processRiskAvg) {
    predictedOutcome = 'deny'     // Credit dimension dominates → lender rejects
  } else {
    predictedOutcome = 'withdraw'  // Process dimension dominates → borrower cancels
  }
} else {
  predictedOutcome = 'originate'   // Below threshold → likely to close
}
```

### Confidence Score

Confidence (55–95) increases with distance from the threshold:

- **Fallout:** `confidence = min(95, 55 + (riskScore - threshold) × 0.8)`
- **Originate:** `confidence = min(95, 60 + (threshold - riskScore) × 0.5)`

A loan barely above the threshold has ~55% confidence; one far above has ~95%.

### Outcome Types

| Outcome | Condition | Description |
|---------|-----------|-------------|
| `originate` | `riskScore < threshold` | Loan is likely to successfully close |
| `withdraw` | `riskScore >= threshold` AND process risk dominates | Borrower will likely cancel (process/market issues) |
| `deny` | `riskScore >= threshold` AND credit risk dominates | Lender will likely reject (credit/underwriting issues) |

### Risk Reason Codes

In addition to the numeric score, human-readable explanations are generated:

**Risk factors** (when signals are elevated, bucket ≥ 4):
- "Credit metrics indicate elevated risk (low FICO, high DTI, or high LTV)"
- "Loan officer has below-average historical pullthrough rate"
- "Interest rate lock is unfavorable compared to current market"
- "Similar historical loans had high fallout rate"
- "One or more personnel have declining recent pull-through"
- "Loan has been in pipeline longer than typical for its stage"

**Positives** (when signals are favorable, bucket ≤ 2):
- "Strong credit profile (high FICO, low DTI)"
- "Loan is progressing on schedule"
- "Loan officer has excellent historical pullthrough rate"
- "Favorable market conditions (rate lock is better than current market)"

These are informational — they don't affect the score or outcome.

---

## 8. Close-Late Prediction

The system also predicts which active loans are likely to miss their estimated closing date. This is separate from fallout prediction and uses different logic.

### Pipeline Stage Determination

**Function:** `determinePipelineStage(loan)`

Maps milestone dates to a pipeline stage and readiness score:

| Stage | Readiness | Condition |
|-------|-----------|-----------|
| CTC (Clear to Close) | 7 | Has `ctcDate` |
| Approved | 6 | Has `approvalDate` or `uwFinalApprovalDate` |
| Conditional Approval | 5 | Has `condApprovalDate` or `conditionalApprovalDate` |
| Locked | 4 | Has `lockDate` |
| Submitted to UW | 3 | Has `submittedToUwDate` |
| In Processing | 2 | Has `submittedToProcessingDate` |
| Not Yet In Processing | 1 | None of the above |

Higher readiness = closer to closing = more likely to close on time.

### Historical On-Time Statistics

**Function:** `computeHistoricalOnTimeStats(historicalLoans)`

Analyzes historical loans that have both `estimated_closing_date` and `closing_date`:

1. **Overall on-time rate:** % of historical loans that closed on or before their estimated closing date
2. **Rate by readiness level:** On-time rate broken down by pipeline stage (readiness 1–7)
3. **Cycle time percentiles:** p25, p50, p75, p90 of application → closing duration

### Stage-to-Close Time Analysis

**Computed in:** `computeHistoricalOnTimeStats()`

For each pipeline stage, the system computes **how many days it historically takes from reaching that stage to closing**. This is the primary signal for close-late prediction.

For every historical loan with a `closing_date`, we examine each milestone date it has (e.g., `lock_date`, `approval_date`, `ctc_date`) and compute:

```
days = closing_date - milestone_date
```

These are collected per readiness level and turned into percentiles (p25, p50, p75, p90).

**Example output:**

| Stage | p25 | p50 (median) | p75 | p90 | Samples |
|-------|-----|-------------|-----|-----|---------|
| App → Close (1) | 28d | 38d | 52d | 72d | 420 |
| Processing → Close (2) | 22d | 32d | 44d | 60d | 350 |
| UW → Close (3) | 18d | 26d | 36d | 50d | 310 |
| Lock → Close (4) | 14d | 22d | 30d | 42d | 380 |
| Cond. Approval → Close (5) | 10d | 16d | 24d | 35d | 290 |
| Approved → Close (6) | 6d | 10d | 16d | 24d | 260 |
| CTC → Close (7) | 2d | 5d | 8d | 12d | 200 |

*(Values are illustrative — actual values are computed from each tenant's historical data.)*

### Close-On-Time Probability

**Function:** `calculateCloseOnTimeProbability(loan, stats)`

For each active loan, computes a 0–100 probability of closing on time.

**Path A — Has estimated closing date (primary):**

1. **Compare days remaining against stage-to-close percentiles.** This is the core logic:
   - If `daysRemaining >= p90` → 95% base probability (way more time than even the slowest loans needed)
   - If `daysRemaining >= p75` → 85% (more time than 75% of loans needed)
   - If `daysRemaining >= p50` → 70% (more time than the median)
   - If `daysRemaining >= p25` → 50% (less than median, getting tight)
   - If `daysRemaining < p25` → 10–40% (less than even the fastest 25% needed)
   - If `daysRemaining <= 0` → 5% (out of time)

   **Example:** A loan is at "Locked" (readiness 4). Historically, Lock → Close takes a median of 22 days (p50). This loan has 30 days remaining → `daysRemaining (30) >= p75 (30)` → 85% base probability. After applying the stage factor (0.85 for Locked), final = 72%.

   **Counter-example:** Same stage, but only 8 days remaining → `daysRemaining (8) < p25 (14)` → ~27% base. After stage factor → 23%. This loan is behind schedule.

2. **Apply stage factor multiplier** (CTC = 1.3, Approved = 1.15, ..., Not Yet In Processing = 0.3). A loan at CTC with a tight timeline is still more likely to close than one stuck in Processing.

3. **Fallback:** If insufficient stage-to-close samples for this readiness level, falls back to historical on-time rate + time bonus/penalty (original logic).

**Path B — No estimated closing date:**

Falls back to comparing loan age against stage-to-close percentiles for stage 1 (application → close), then overall cycle time percentiles.

### Close-Late Risk Flag

```
closeLateRisk = true  if closeOnTimeProbability < 50
closeLateRisk = false if closeOnTimeProbability >= 50
```

---

## 9. Database Persistence

### Predictions Table (`public.loan_predictions`)

**Function:** `savePredictionsToDatabase()`

For each bucketed loan, the system upserts a row:

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `loan_id` | VARCHAR | Foreign key to `public.loans` |
| `predicted_outcome` | ENUM | `'withdraw'`, `'deny'`, or `'originate'` |
| `confidence` | INTEGER | 0–100 |
| `reasoning` | TEXT | Human-readable risk summary |
| `risk_factors` | TEXT[] | Array of risk factor strings |
| `bucket` | VARCHAR | `'high'`, `'medium'`, or `'low'` |
| `model_version` | VARCHAR | Version identifier |
| `loan_data` | JSONB | **Full bucketed loan data** including all signal buckets, risk scores, close-late fields |
| `created_at` | TIMESTAMP | When prediction was created |
| `updated_at` | TIMESTAMP | Last update |

**Upsert strategy:** DELETE existing prediction for `loan_id`, then INSERT new one. This ensures only the latest prediction per loan is stored.

### Key Fields in `loan_data` JSONB

The `loan_data` column stores the complete bucketed loan object, including:

- All signal buckets (e.g., `ficoScoreSignal`, `ltvSignal`, `dtiSignal`)
- Risk scores (`riskScore`, `creditRiskScore`, `processRiskScore`)
- Close-late fields (`closeOnTimeProbability`, `closeLateRisk`, `pipelineStage`, `pipelineReadiness`)
- Pull-through percentages (`loPullthroughPercentage`, etc.)
- Original loan fields (`loan_amount`, `fico_score`, `lock_date`, etc.)

This allows the GET endpoint to reconstruct the full loan context without re-running the prediction.

---

## 10. Caching System

### Historical Loan Bucket Cache

**Table:** `public.historical_loan_bucket_cache`

| Column | Type | Description |
|--------|------|-------------|
| `loan_id` | VARCHAR | Primary key |
| `bucket_snapshot` | JSONB | All signal bucket values for this loan |
| `created_at` | TIMESTAMP | When cached |

### How It Works

1. **On first prediction run:** All historical loans are bucketed (expensive operation). Results are saved to the cache table.
2. **On subsequent runs:** Cached buckets are loaded and merged with loan data. Only new/changed loans need bucketing.
3. **Cache staleness detection:** The system samples 10 rows from the cache and checks if key signals (`ficoScoreSignal`, `ltvSignal`, `dtiSignal`) are non-null. If they're all null, the cache is stale (from an older schema) and gets cleared.
4. **Cache clearing:** `TRUNCATE public.historical_loan_bucket_cache` — full rebuild on next run.

### Cached Values

All signal buckets and composite signals:
- `ficoScoreSignal`, `ltvSignal`, `dtiSignal`, `cltvSignal`
- `creditMetricsSignalStrength`, `loanCharacteristicsSignalStrength`
- `timeInMotionSignalStrength`, `mloAeFalloutProneSignalStrength`
- `interestLockVsMarketSignalStrength`
- All pull-through signals and percentages
- `marketChangeDelta`, `lockMarketRate`, `closeMarketRate`

### Important

- **Only historical (finalized) loans are cached.** Active loans are re-bucketed on every prediction run.
- The cache is database-backed and persists across server restarts.

---

## 11. API Endpoints

### POST `/api/predictions`

**Triggers a new prediction run.**

**Request:**
```json
{
  "customPrompt": "(optional)",
  "loanIds": ["(optional array to limit scope)"],
  "maxLoanAgeMonths": 0,
  "limit": 1000
}
```

**Internal flow:**
1. Queries active loans: `current_loan_status = 'Active Loan'` AND `application_date IS NOT NULL`
2. Queries historical loans: all non-active loans (limit 5000)
3. Calls `predictLoanOutcomes()` with both sets
4. Formats response with bucketed loans (max 50 per bucket) stripped to essential fields

**Response:**
```json
{
  "predictions": [],
  "bucketedLoans": [
    {
      "loan_id": "...",
      "riskScore": 72,
      "bucket": "medium",
      "predictedOutcome": "withdraw",
      "confidence": 68,
      "closeLateRisk": true,
      "closeOnTimeProbability": 35,
      "pipelineStage": "Locked",
      "ficoScoreSignal": 3,
      "ltvSignal": 4,
      "dtiSignal": 2,
      "...": "..."
    }
  ],
  "bucketSummary": { "high": 11, "medium": 45, "low": 89 },
  "totalBucketedLoans": 145,
  "summary": {
    "totalAnalyzed": 145,
    "predictedWithdraw": 42,
    "predictedDeny": 26,
    "predictedOriginate": 77,
    "likelyCloseLateCount": 18
  },
  "metadata": {
    "model": "rule-based-v3",
    "timestamp": "2026-02-06T...",
    "processingTimeMs": 2340
  }
}
```

### GET `/api/predictions`

**Loads saved predictions from the database.**

**Query params:**
- `period` — filters by application date (e.g., `rolling_3_months`, `rolling_6_months`)
- `outcome` — filter by predicted outcome
- `loanIds` — filter by specific loan IDs

**Response:** Same structure as POST, but loaded from `loan_predictions` table. The `loan_data` JSONB is merged with fresh values from the `loans` table.

### GET `/api/predictions/status`

Returns `{ inProgress: boolean }` — whether a prediction is currently running (mutex check).

### GET `/api/predictions/:loanId/recommendations`

Returns AI or rule-based recommendations for a specific loan.

### Essential Fields in API Response

The API strips bucketed loans to ~68 essential fields for performance. Key categories:

- **Identifiers:** `loan_id`, `loan_number`
- **Financial:** `loan_amount`, `interest_rate`, `market_rate`, `marketChangeDelta`
- **Dates:** `application_date`, `lock_date`, `closing_date`, `estimated_closing_date`, `funding_date`
- **Credit:** `fico_score`, `ltv_ratio`, `be_dti_ratio`
- **Status:** `current_loan_status`, `current_milestone`, `bucket`
- **Risk:** `riskScore`, `creditRiskScore`, `processRiskScore`, `riskSummary`
- **Close-Late:** `closeOnTimeProbability`, `closeLateRisk`, `pipelineStage`, `pipelineReadiness`
- **All signal buckets** (e.g., `ficoScoreSignal`, `ltvSignal`, `dtiSignal`)
- **Pull-through rates** per role
- **Personnel:** `loan_officer`, `underwriter`, `closer`, `processor`

### Backfill Logic

The API backfills missing fields from the raw `loans` table when stored prediction data is incomplete:
- `loan_purpose` / `channel` — often missing from older prediction saves
- `lock_date` / `lock_expiration_date` — may not have been in JSONB

---

## 12. Frontend Display

**Component:** `src/components/dashboard/ClosingFalloutForecast.tsx`

### Data Sources

| Source | Origin | Used For |
|--------|--------|----------|
| `loansRaw` | `GET /api/loans?limit=5000` | Client-side metric computation (active, funded, locked counts) |
| `bucketedLoans` | Prediction API response | Risk tables, high-risk cards, server-computed metrics |
| `statsData` | `GET /api/loans/stats` | Fallback counts (active, closed, locked) |
| `serverActiveLoansCount` | `GET /api/loans/active-loans-count` | Authoritative active loan count with SQL date filter |

### Metric Computation

`computeMetricsFromLoans()` performs a single pass through `loansRaw`:

**Active loan identification** (`isActiveLoan`):
- Strictly checks `current_loan_status = 'Active Loan'` (normalized)
- Requires `application_date` to be non-null and non-empty
- Matches the server-side SQL definition exactly

**Counts computed:**

| Metric | Logic |
|--------|-------|
| **Active Loans Today** | Server count (preferred) or client `isActiveLoan` count |
| **Locked Loans** | Active loans with `lock_date` populated (from `loansRaw` + `bucketedLoans` fallback) |
| **Past Est. Close** | Active loans where `estimated_closing_date < today` (snapshot, not filtered by period) |
| **Likely Close Late** | Server `closeLateRisk` count (preferred) or client `isLikelyCloseLateForecast` heuristic |
| **Predicted Fallout** | From prediction summary (`withdraw + deny`) |
| **Predicted Closing** | `activeLoans × pullThroughRate` |
| **Funded Loans** | Period-filtered by `closing_date`, or total by status |
| **Pull-Through Rate** | From `useMetrics` hook (rolling 90 days) |
| **Fallout Rate** | `predictedFallout / activeLoans × 100` |

### Period Filtering

The component supports filtering active loans by application date period:
- `all` — all active loans
- `mtd` — month to date
- `ytd` — year to date
- `rolling_90_days` — last 90 days
- `last_month` — previous month
- `last_year` — previous year

**Important:** Some metrics are **snapshot metrics** (not affected by period filter):
- "Past Est. Close Date" — always counts ALL active loans past their estimated close, regardless of filter
- "Locked Loans" — for "all" period: all active with locks; for filtered periods: only active loans within that period

### KPI Cards

The main metrics grid displays (in a 4-column layout):

1. **Active Loans Today** — with pipeline value and "Live" badge
2. **Predicted Closing** — estimated loans to successfully close
3. **Likely Close Late** — clickable, opens drilldown modal
4. **Past Est. Close** — turns red with "Alert" badge when > 0

Below that, outcome metrics:

5. **Predicted Fallout** — total with fallout rate percentage
6. **Likely Withdraw** — process-risk-driven fallout
7. **Likely Decline** — credit-risk-driven fallout

Additional KPIs:

8. **Locked Loans** — active loans with rate locks
9. **Pipeline UPB** — total unpaid principal balance
10. **Pull-Through Rate** — historical success rate

### Critical Loans Table

Displays high-risk loans from `bucketedLoans` with:
- Borrower name, loan amount, risk score, bucket (high/medium/low)
- Predicted outcome with color coding
- Signal bucket breakdown
- Click-through to detailed risk analysis modal

### Drilldown Modals

- **Predicted Fallout / Withdraw / Decline** → `OutcomeLoansModal` showing filtered loan list
- **Likely Close Late** → `OutcomeLoansModal` with `type='delayed'`, prioritizes `closeLateRisk` from server, falls back to client heuristic
- **Active Loans / Funded Loans** → `ClosingFalloutMetricModal` with loan list

### Frontend Close-Late Fallback

When server-computed `closeLateRisk` is not available (predictions not yet run or saved before the feature existed), the frontend uses `isLikelyCloseLateForecast()`:

1. Check `closeLateRisk` field from server → use directly if present
2. Check `estimated_closing_date` → if > 3 days past, flag as late
3. Fallback: if loan is > 30 days old (from `application_date`), flag as late

---

## 13. Design Decisions

### Unified Risk Score

The `riskScore` (1–100) drives bucket assignment, predicted outcome, AND what users see in the UI. This eliminates the confusion of a loan showing "medium risk" but being "predicted to originate" — the score, bucket, and outcome always tell a consistent story.

### Max of Two Dimensions

Using `Math.max(processRisk, creditRisk)` instead of averaging ensures that a single critical dimension isn't diluted. A loan with perfect credit but terrible process risk still shows as high risk.

### Inverse FICO for Process Risk

Strong borrowers (high FICO) are **more** likely to withdraw because they have more options and are more likely to shop. This counterintuitive mapping is supported by industry data on mortgage fallout patterns.

### Per-Tenant Calibration

Every lender has different borrower profiles, markets, and operational characteristics. A 47% fallout rate at one lender shouldn't be forced onto another with 25% fallout. Per-tenant calibration automatically adjusts.

### Snapshot vs. Period Metrics

Some KPIs (Active Loans, Past Est. Close, Locked Loans) are **snapshot** metrics showing the current state. Others (Funded Loans, Pull-Through) are **historical** metrics filtered by date range. The UI clearly distinguishes these.

### Bucketed Loans as Fallback

The frontend uses `bucketedLoans` (from predictions) as a secondary data source alongside `loansRaw` (from the loans API). For metrics like locked count and past-est-close count, it takes `Math.max(bucketedCount, rawCount)` to ensure the best available data is displayed.

---

## Appendix: Full Signal Flow Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                     RAW LOAN DATA (from DB)                       │
│  fico_score, be_dti_ratio, ltv_ratio, loan_type, loan_purpose,  │
│  lock_date, application_date, interest_rate, loan_officer, ...   │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                    prepareLoanData()
                           │
                    bucketLoanData()
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                    SIGNAL BUCKETS (1–6 each)                      │
│                                                                   │
│  Credit Signals:              Process Signals:                    │
│  ├─ ficoScoreSignal           ├─ timeInMotionSignalStrength      │
│  ├─ dtiSignal                 ├─ mloAeFalloutProneSignalStrength │
│  ├─ ltvSignal                 ├─ closerPullthroughSignalStrength │
│  ├─ loanCharacteristics       ├─ processorPullthroughSignal      │
│  └─ uwPullthroughSignal       ├─ interestLockVsMarketSignal     │
│                               └─ inverseFICO (7 - ficoSignal)    │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                  generateRuleBasedSummary()
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│              RISK DIMENSIONS (averages, 1.0–6.0)                  │
│                                                                   │
│  creditRiskAvg ──scale──► creditRiskScore (1–100)                │
│  processRiskAvg ─scale──► processRiskScore (1–100)               │
│                                                                   │
│  riskScore = max(creditRiskScore, processRiskScore)               │
└──────────────────────────┬───────────────────────────────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
         ┌────────┐  ┌─────────┐  ┌──────────┐
         │ Bucket │  │ Outcome │  │ Display  │
         │ high   │  │ vs      │  │ Score    │
         │ medium │  │ calib.  │  │ shown    │
         │ low    │  │ thresh. │  │ in UI    │
         └────────┘  └─────────┘  └──────────┘
```
