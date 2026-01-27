# Operations Scorecard - Complete Specification

## Overview

The Operations Scorecard evaluates performance of operations staff (Processors, Underwriters, Closers) using a TopTiering Score (TTS) system with different weights than Sales Scorecard. This document defines the metric calculations and database mappings.

---

## TTS Formula (Operations)

```
OPS_TTS = (UnitRating × 0.70 + TurnTimeRating × 0.15 + ComplexityRating × 0.15) / TotalWeight
```

**Weights (from Qlik Script.csv lines 2314-2316):**
| Component | Weight | Percentage |
|-----------|--------|------------|
| Units | 0.70 | 70% |
| Turn Time | 0.15 | 15% |
| Loan Complexity | 0.15 | 15% |

**Total Weight = 1.0**

---

## Rating Calculations

Each rating compares an individual actor's performance to the company average:

```
Rating = (Actor Value / Company Average) × 100
```

A rating of **100 = average performance**.

### 1. Unit Rating
```
UnitRating = (Actor Units / Avg Units per Actor) × 100
```
- **Actor Units**: Count of loans processed by this actor in date range
- **Avg Units per Actor**: Total company units ÷ Number of actors with units > 0

### 2. Turn Time Rating (Inverse)
```
TurnTimeRating = (1/Actor_AvgTurnTime) / (Avg of 1/TurnTime per Actor) × 100
```
- Uses INVERSE formula so faster (lower) turn times get higher ratings
- Only loans with valid turn time (output_date - input_date > 0) are included

### 3. Loan Complexity Rating
```
ComplexityRating = (Actor AvgComplexity / Company AvgComplexity) × 100
```
- **Loan Complexity Score**: Composite score from Qlik (1 + [Loan Complexity Score]) × 100
- Formula: Based on government %, purchase %, FICO/LTV/DTI risk factors

---

## Actor-Specific Date Fields

Each actor type uses different milestone dates for output and turn time calculations.

**Database column names** (from `tenantDatabaseSchema.ts`):

| Actor | Output Date Field | Input Date Field | Turn Time Calculation |
|-------|-------------------|------------------|----------------------|
| **Processor** | `submitted_to_underwriting_date` | `submitted_to_processing_date` | submitted_to_underwriting_date - submitted_to_processing_date |
| **Underwriter** | `ctc_date` | `submitted_to_underwriting_date` | ctc_date - submitted_to_underwriting_date |
| **Closer** | `closing_date` | `ctc_date` | closing_date - ctc_date |

### Qlik Field Mappings
| Qlik Field | Database Column | Fallback Columns |
|------------|-----------------|------------------|
| `[Processor]` | `processor` | - |
| `[Underwriter]` | `underwriter` | - |
| `[Closer]` | `closer` | - |
| `[Sent To Processing]` | `submitted_to_processing_date` | `processing_date`, `started_date` |
| `[Sent To Underwriting]` | `submitted_to_underwriting_date` | `submittal_date` |
| `[Sent To Closing]` | `ctc_date` | - (CTC = Clear To Close) |
| `[End Date to indicate Loan Closed/Funded]` | `closing_date` | `funding_date` |

---

## Metrics to Display

### Summary Table Metrics (14 metrics per tier)

| Metric | Calculation | Qlik Reference |
|--------|-------------|----------------|
| **Actor Count** | COUNT(DISTINCT actor) | Count of actors in tier |
| **Units Output** | COUNT(loans) | [Scorecard Output Units] |
| **Units % Output** | (Tier Units / Total Units) × 100 | Percentage distribution |
| **Volume Output** | SUM(loan_amount) | Total loan volume |
| **Loan Complexity Score** | AVG((1 + [Loan Complexity Score]) × 100) | From Qlik field |
| **Avg Units Per Month** | Units / Months in Period / Actor Count | Monthly productivity |
| **Avg Days** | AVG(turn_time) | Actor-specific turn time |
| **Compensation $** | '-' (not available) | Requires HR data |
| **Cost Per File** | '-' (not available) | Requires HR data |
| **% Approved** | COUNT(approved) / COUNT(decisions) × 100 | UW metric primarily |
| **% Denied** | COUNT(denied) / COUNT(decisions) × 100 | UW metric primarily |
| **Government %** | COUNT(govt loans) / COUNT(*) × 100 | FHA, VA, USDA |
| **Purchase %** | COUNT(purchase) / COUNT(*) × 100 | Purchase vs Refinance |
| **WA FICO** | SUM(fico × loan_amount) / SUM(loan_amount) | Weighted average |
| **WA LTV** | SUM(ltv × loan_amount) / SUM(loan_amount) | Weighted average |

---

## Loan Complexity Score

From Qlik (Transform.qvs), Loan Complexity Score is pre-calculated and stored in the data. The formula considers:

1. **Government Loans** (FHA, VA, USDA) - More complex
2. **Purchase Transactions** - More complex than refinance
3. **Risk Factors**: Low FICO, High LTV, High DTI

The display formula is:
```
(1 + [Loan Complexity Score]) × 100
```
Where a score of 100 = baseline complexity, >100 = higher complexity.

---

## Tier Assignment

Actors are assigned to tiers based on their TTS score:

| Tier | TTS Score Range | Description |
|------|-----------------|-------------|
| **Top Tier** | TTS > 120 | 20%+ above average |
| **Second Tier** | 100 ≤ TTS ≤ 120 | At or above average |
| **Bottom Tier** | TTS < 100 | Below average |

---

## Date Range Options

| Option | Description | Months |
|--------|-------------|--------|
| `3-months` | Rolling 3 months | 3 |
| `6-months` | Rolling 6 months | 6 |
| `12-months` | Rolling 12 months | 12 |

Date range is calculated from the max output date in the data (similar to vMaxDate in Sales Scorecard).

---

## Filters Applied

### 1. Actor Missing Filter
Excludes actors where name is:
- `'99-Missing'`
- `'Missing'`
- Empty/null
- Starts with `'99-'`

From Qlik: `[$(vOpsScorecardActor) Missing] *= {0}`

### 2. Production Flag Filter
From Qlik: `[$(vOpsScorecardActor)_Production] *= {$(vCurrentProductionOps)}`

This filters for "current production" - actors who have processed loans in the last 30 days from the max date.

### 3. Channel Filter (Optional)
Same as Sales Scorecard - filters by consolidated channel (Retail, TPO, etc.)

---

## API Endpoint Specification

### Request
```
GET /api/loans/operations-scorecard
```

### Query Parameters
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `actor_type` | string | No | 'underwriter' | 'processor' \| 'underwriter' \| 'closer' |
| `date_range` | string | No | '3-months' | '3-months' \| '6-months' \| '12-months' |
| `channel_group` | string | No | null | Channel filter |
| `tenant_id` | string | No | from auth | Tenant ID for multi-tenant |

### Response
```typescript
{
  actors: OperationsActor[];
  tierSummary: {
    top: OperationsTierMetrics;
    second: OperationsTierMetrics;
    bottom: OperationsTierMetrics;
  };
  totals: OperationsTierMetrics;
  companyAverages: {
    avgUnits: number;
    avgTurnTime: number;
    avgComplexity: number;
  };
  weightConfig: {
    unit: 0.70;
    turnTime: 0.15;
    complexity: 0.15;
  };
  dateRange: {
    start: string;
    end: string;
    months: number;
  };
}
```

---

## Database Query Strategy

The actual database columns are defined in `server/src/config/tenantDatabaseSchema.ts`. The query uses:

1. **Primary columns**: `submitted_to_processing_date`, `submitted_to_underwriting_date`, `ctc_date`, `closing_date`
2. **Fallback columns via COALESCE**: `processing_date`, `started_date`, `submittal_date`, `funding_date`
3. **Handle null values gracefully**: Exclude loans without required dates from turn time calculation

### SQL Column Selection
```sql
SELECT 
  loan_id, loan_amount, loan_type, loan_purpose, current_loan_status, channel,
  -- Actor columns
  processor, underwriter, closer,
  -- Date columns (with fallbacks matching schema)
  COALESCE(submitted_to_processing_date, processing_date, started_date) as submitted_to_processing_date,
  COALESCE(submitted_to_underwriting_date, submittal_date) as submitted_to_underwriting_date,
  ctc_date,
  COALESCE(closing_date, funding_date) as closing_date,
  -- Metrics columns
  fico_score, ltv_ratio, be_dti_ratio,
  occupancy_type
FROM loans
```

---

## Testing Checklist

### Processor Scorecard
- [ ] Units match Qlik (count loans with submitted_to_underwriting_date in range)
- [ ] Turn time = submitted_to_underwriting_date - submitted_to_processing_date
- [ ] Actor count correct
- [ ] Tier assignments match

### Underwriter Scorecard
- [ ] Units match Qlik (count loans with ctc_date in range)
- [ ] Turn time = ctc_date - submitted_to_underwriting_date
- [ ] Approved/Denied percentages correct
- [ ] Tier assignments match

### Closer Scorecard
- [ ] Units match Qlik (count loans with closing_date in range)
- [ ] Turn time = closing_date - ctc_date
- [ ] Actor count correct
- [ ] Tier assignments match

### All Actors
- [ ] Volume output matches
- [ ] Government % correct
- [ ] Purchase % correct
- [ ] WA FICO correct
- [ ] WA LTV correct
- [ ] Date range filtering works
- [ ] Channel filtering works

---

## Known Differences from Sales Scorecard

| Aspect | Sales Scorecard | Operations Scorecard |
|--------|-----------------|---------------------|
| **Actor Types** | Branch, Loan Officer | Processor, Underwriter, Closer |
| **Output Date** | funding_date | Actor-specific milestone |
| **Turn Time** | application_date → closing_date | Actor-specific milestones |
| **TTS Components** | 6 (Volume, Margin, Unit, PullThrough, TurnTime, Concession) | 3 (Unit, TurnTime, Complexity) |
| **Primary Weight** | Volume/Margin/Unit (20% each) | Units (70%) |
| **Approval/Denial** | Not shown | Key UW metrics |

---

## Changelog

| Date | Change | Author |
|------|--------|--------|
| 2026-01-26 | Initial specification | AI Assistant |
