# Operations Scorecard - Complete Specification

## Overview

The Operations Scorecard evaluates performance of operations staff (Processors, Underwriters, Closers) using a TopTiering Score (TTS) system with different weights than Sales Scorecard. This document defines the metric calculations and database mappings.

---

## Implementation Status

| Component | Status | Notes |
|-----------|--------|-------|
| **Unit Counts** | ✅ Matching Qlik | Processor: 2,087, Underwriter: 2,171, Closer: 1,305 |
| **Date Field Mappings** | ✅ Verified | See Actor-Specific Date Fields section |
| **Tiering Logic** | ✅ Implemented | TTS Score thresholds: >=120 Top, >=80 Second |
| **TTS Calculation** | ✅ Implemented | 70% Unit, 15% TurnTime, 15% Complexity |
| **Date Range Filter** | ✅ Verified | 12 months, exclusive end date (matches Qlik) |

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

**IMPORTANT**: The Qlik field names (e.g., `[Sent To Underwriting]`, `[Sent To Closing]`) are **aliases** configured in client-specific `CoheusConfig.xml` via `TriggerDateField` mappings. The actual field IDs vary by client.

### Verified Mappings for Homestead (from CoheusConfig.xml)

| Actor | Qlik Alias | Encompass Field ID | Database Column | Verified Count |
|-------|------------|-------------------|-----------------|----------------|
| **Processor** | `[Sent To Underwriting]` | `Log.MS.Date.Approval` | `approval_date` | 2,087 units ✅ |
| **Underwriter** | `[Sent To Closing]` | `Fields.748` | `closing_date` | 2,171 units ✅ |
| **Closer** | `[End Date to indicate Loan Closed/Funded]` | `Fields.1997` | `disbursement_date` | 1,305 units ✅ |

### Turn Time Calculations

| Actor | Output Date | Input Date | Turn Time Formula |
|-------|-------------|------------|-------------------|
| **Processor** | `approval_date` | `submitted_to_processing_date` | approval_date - submitted_to_processing_date |
| **Underwriter** | `closing_date` | `approval_date` | closing_date - approval_date |
| **Closer** | `disbursement_date` | `closing_date` | disbursement_date - closing_date |

### Qlik Field Aliases (Client-Configurable)

| Qlik Alias | Purpose | Config Location |
|------------|---------|-----------------|
| `[Sent To Underwriting]` | Processor output milestone | `OperationalScorecards/TriggerDateField[@Name='Sent To Underwriting']` |
| `[Sent To Closing]` | Underwriter output milestone | `OperationalScorecards/TriggerDateField[@Name='Sent To Closing']` |
| `[End Date to indicate Loan Closed/Funded]` | Closer output milestone | `OperationalScorecards/TriggerDateField[@Name='End Date to indicate Loan Closed/Funded']` |

**Note**: The `disbursement_date` column was added to `tenantDatabaseSchema.ts` to support Fields.1997 mapping for the Closer output date.

### Future Consideration: Client-Configurable Date Fields

The Qlik TriggerDateField mappings are **client-specific**. Different clients may map different Encompass fields to `[Sent To Closing]` or `[End Date to indicate Loan Closed/Funded]`. A future enhancement could add a configuration option allowing clients to select which database column maps to each Qlik alias. This would be stored in tenant configuration.

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

## UI Views

The Operations Scorecard page has three view tabs:

### Summary Tab (Tier Aggregation)
Displays metrics aggregated by tier (Top, Second, Bottom) in a pivot table format. Shows:
- Totals column for all actors
- Top Tier, Second Tier, Bottom Tier columns
- Rows for each metric (Actor Count, Units, Volume, etc.)

### Details Tab (Individual Actors)

**Qlik Reference**: Object ID `a50b485b-0cc4-4ffa-8a40-6e2e3edea613` - "Output Scorecard" table

Displays individual actor performance data in a sortable/filterable table. Each row represents one actor with their metrics.

| Column | Description | Sort Default |
|--------|-------------|--------------|
| **Actor Name** | Processor/Underwriter/Closer name | A-Z |
| **Tier** | Badge showing Top/Second/Bottom tier | Top first |
| **TTS Score** | TopTiering Score (color-coded) | Descending |
| **Units** | Count of loans processed | Descending |
| **Volume** | Total loan amount (formatted currency) | Descending |
| **Avg/Mo** | Average units per month | Descending |
| **Days** | Average turn time in days | Ascending (lower is better) |
| **Complexity** | Loan complexity score (base 100) | Descending |
| **Approved** | Approval percentage | Descending |
| **Govt %** | Government loan percentage | Descending |
| **Purch %** | Purchase transaction percentage | Descending |
| **FICO** | Weighted average FICO score | Descending |
| **LTV** | Weighted average LTV ratio | Ascending (lower is better) |

#### Features:
- **Sortable columns**: Click any column header to sort
- **Search filter**: Filter actors by name
- **TTS Score color coding**:
  - >= 120: Top tier color (dark blue)
  - >= 100: Green
  - >= 80: Amber/Yellow
  - < 80: Red
- **Tier badges**: Color-coded badges matching tier colors

### Charts Tab
Visual representations of tier distributions and performance metrics.

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

Actors are assigned to tiers based on their TTS score. This logic comes from Qlik's **"13 Month TVI Score Tiers"** dimension (Dimensions.csv):

```qlik
If(Avg(TVI_Score) >= 120, Dual('Top Tier', 1),
   If(Avg(TVI_Score) >= 80, Dual('Second Tier', 2),
      Dual('Bottom Tier', 3)))
```

### Thresholds

| Tier | TTS Score Range | Description |
|------|-----------------|-------------|
| **Top Tier** | TTS >= 120 | 20%+ above average |
| **Second Tier** | 80 <= TTS < 120 | Average to above average |
| **Bottom Tier** | TTS < 80 | Below average |

### Implementation

```typescript
// From server/src/routes/loans.ts
if (ttsScore >= 120) tier = 'top';
else if (ttsScore >= 80) tier = 'second';
else tier = 'bottom';
```

**Note**: The Operations Scorecard uses the same TVI Score Tier dimension as the Sales Scorecard, selected dynamically via:
```qlik
=if(vOpsScorecardMonthRange=12, '13 Month TVI Score Tiers', '4 Month TVI Score Tiers')
```

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

1. **Primary columns for output**: `approval_date` (Processor), `closing_date` (Underwriter), `disbursement_date` (Closer)
2. **Turn time input columns**: `submitted_to_processing_date`, `approval_date`, `closing_date`
3. **Handle null values gracefully**: Exclude loans without required dates from turn time calculation

### SQL Column Selection
```sql
SELECT 
  loan_id,
  COALESCE(loan_number, loan_id) as loan_number,
  loan_amount, loan_type, loan_purpose, current_loan_status, channel,
  -- Actor columns
  processor, underwriter, closer,
  -- Date columns per Homestead CoheusConfig.xml TriggerDateFields
  submitted_to_processing_date,
  processing_date,
  approval_date,        -- Processor output (Qlik: [Sent To Underwriting] = Log.MS.Date.Approval)
  closing_date,         -- Underwriter output (Qlik: [Sent To Closing] = Fields.748)
  disbursement_date,    -- Closer output (Qlik: [End Date to indicate Loan Closed/Funded] = Fields.1997)
  funding_date,
  application_date,
  -- Metrics columns
  fico_score, ltv_ratio, be_dti_ratio,
  occupancy_type, borr_self_employed
FROM loans
```

### Actor Configuration (from loans.ts)
```typescript
const actorConfigs: Record<string, ActorConfig> = {
  processor: {
    actorColumn: 'processor',
    outputDateField: 'approval_date',  // Qlik: [Sent To Underwriting] = Log.MS.Date.Approval
    turnTimeStartField: 'submitted_to_processing_date',
    turnTimeEndField: 'approval_date'
  },
  underwriter: {
    actorColumn: 'underwriter',
    outputDateField: 'closing_date',   // Qlik: [Sent To Closing] = Fields.748 = Closing Date
    turnTimeStartField: 'approval_date',
    turnTimeEndField: 'closing_date'
  },
  closer: {
    actorColumn: 'closer',
    outputDateField: 'disbursement_date', // Qlik: [End Date to indicate Loan Closed/Funded] = Fields.1997
    turnTimeStartField: 'closing_date',
    turnTimeEndField: 'disbursement_date'
  }
};
```

---

## Testing Checklist

### Processor Scorecard
- [x] Units match Qlik (count loans with approval_date in range) - **2,087 units ✅**
- [ ] Turn time = approval_date - submitted_to_processing_date
- [ ] Actor count correct
- [ ] Tier assignments match (TTS >= 120 = Top, >= 80 = Second)

### Underwriter Scorecard
- [x] Units match Qlik (count loans with closing_date in range) - **2,171 units ✅**
- [ ] Turn time = closing_date - approval_date
- [ ] Approved/Denied percentages correct
- [ ] Tier assignments match (TTS >= 120 = Top, >= 80 = Second)

### Closer Scorecard
- [x] Units match Qlik (count loans with disbursement_date in range) - **1,305 units ✅**
- [ ] Turn time = disbursement_date - closing_date
- [ ] Actor count correct
- [ ] Tier assignments match (TTS >= 120 = Top, >= 80 = Second)

### All Actors
- [ ] Volume output matches
- [ ] Government % correct
- [ ] Purchase % correct
- [ ] WA FICO correct
- [ ] WA LTV correct
- [x] Date range filtering works (12-month range, exclusive end date)
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
| 2026-01-26 | Updated date field mappings after Qlik verification: Processor=approval_date, Underwriter=closing_date, Closer=disbursement_date | AI Assistant |
| 2026-01-26 | Added disbursement_date column to tenantDatabaseSchema.ts for Fields.1997 mapping | AI Assistant |
| 2026-01-26 | Fixed tier assignment thresholds: >=120 Top, >=80 Second, <80 Bottom (from Qlik Dimensions.csv) | AI Assistant |
| 2026-01-27 | Verified unit counts match Qlik: Processor 2,087, Underwriter 2,171, Closer 1,305 | AI Assistant |
| 2026-01-28 | Implemented Details tab with individual actor table, sorting, filtering, and tier badges (Qlik object a50b485b-0cc4-4ffa-8a40-6e2e3edea613) | AI Assistant |

## Qlik Reference Files

The following Qlik files were analyzed to determine the correct logic:

| File | Purpose |
|------|---------|
| `Variables.csv` | TTS weights, tier variable definitions, evaluated tier member lists |
| `Dimensions.csv` | "13 Month TVI Score Tiers" dimension with threshold logic |
| `Script.csv` | vMaxDate calculation, date range expressions, production flags |
| `L1 Aliasing.qvs` | Field alias mappings for TriggerDateFields |
| `CoheusConfig.xml` (Homestead) | Client-specific TriggerDateField mappings (Fields.1997, etc.) |
| `CoheusDataDictionary.xml` | Encompass field ID to alias mappings |

## Qlik Object References

| Object ID | Type | Name | Sheet |
|-----------|------|------|-------|
| `a50b485b-0cc4-4ffa-8a40-6e2e3edea613` | table | Output Scorecard | Operation Scorecard |
| `f70ad8f0-fc9e-4fe8-8a76-c2af0175041e` | pivot-table | Output Scorecard Summary | Operation Scorecard |
| `fbauUhG` | container | Chart Container | Operation Scorecard |
