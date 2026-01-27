# Operation Scorecard Trends Page - Implementation Handover

## Overview

The `OperationScorecardTrends` page (`src/pages/OperationScorecardTrends.tsx`) displays monthly performance trends for operations staff (Processors, Underwriters, Closers) in a pivot table format. The page currently uses **100% mock data** and needs to be connected to real database data, matching the "Operation Scorecard Trends" sheet in the Qlik Performance app.

---

## Current State

### Page Structure
- **Page Component**: `src/pages/OperationScorecardTrends.tsx`
- **View Component**: `src/components/dashboard/views/OperationScorecardTrendsView.tsx`
- **Data Source**: Hardcoded mock data (`mockProcessors`, `mockTierSummaries`, `mockMonths`)

### UI Components (from OperationScorecardTrendsView.tsx)

1. **Left Sidebar - Controls**
   - Actor selector (Processor / Underwriter / Closer)
   - Comparison view selector (Vs Target / Monthly / Year-over-Year)
   - TopTiering Story card with tier summaries

2. **Top Metrics Row** (5 KPI cards)
   - Target Units Per Month
   - Total Monthly Output
   - Avg Volume Output
   - Loan Complexity Score
   - Average Days

3. **Main Pivot Table**
   - Rows: Individual actors (e.g., processors)
   - Columns: Months (e.g., Jan-2026, Dec-2025, Nov-2025, Oct-2025)
   - Metrics per month:
     - Units Output
     - Output vs Target
     - Average Days
     - % Conversion
     - Loan Complexity Score

4. **Performance Indicators**
   - Color-coded rows based on target achievement
   - Up/down arrows for vs target values
   - Tooltips with performance details

### Current Mock Data Structure

```typescript
interface ProcessorMonthData {
  unitsOutput: number;
  outputVsTarget: number;
  averageDays: number;
  conversionPercent: number;
  loanComplexityScore: number;
}

interface ProcessorData {
  id: string;
  name: string;
  tier: 'top' | 'second' | 'bottom';
  months: {
    [key: string]: ProcessorMonthData;  // e.g., 'Jan-2026': {...}
  };
}

interface TierSummary {
  tier: 'top' | 'second' | 'bottom';
  count: number;
  totalUnits: number;
  percentOfTotal: number;
  avgUnitsPerMonth: number;
  avgDaysPerUnit: number;
}
```

---

## Qlik Reference

### Sheet: "Operation Scorecard Trends" (Sheets.csv line 3)
Sheet ID: `1b7e60bb-c475-4922-a4f8-2c9c4b89fbb5`

### Key Qlik Variables (from Variables.csv)

| Variable | Description | Example Value |
|----------|-------------|---------------|
| `vOpsScorecardActor` | Actor type | 'Processor', 'Underwriter', 'Closer' |
| `vOpsScorecardMonthRange` | Month range for trends | 13 (months) |
| `vScorecardUnitsAverage` | Average units per actor | Calculated |
| `vScorecardTurnTimeAverage` | Average turn time | Calculated |
| `vScorecardVolumeAverage` | Average volume | Calculated |
| `vOpsScorecardMinYearMonth` | Start month for trends | 'Jan 2025' |
| `vOpsScorecardMaxYearMonth` | End month for trends | 'Jan 2026' |

### Qlik KPI Components (from Vizobjects.csv)

| Component | Description |
|-----------|-------------|
| `Operation Scorecard Trends: Target Unit KPI` | Monthly target units |
| `Operation Scorecard Trends: Avg Units Output KPI` | Average units output |
| `Operation Scorecard Trends: Average Volume Output KPI` | Average volume |
| `Operation Scorecard Trends: Loan Complexity Score KPI` | Complexity score |
| `Operation Scorecard Trends: Average Days KPI` | Average turn time |

### Actor-Specific Date Fields (same as Operations Scorecard)

| Actor | Output Date Field | Turn Time Calculation |
|-------|-------------------|----------------------|
| **Processor** | `submitted_to_underwriting_date` | submitted_to_underwriting_date - submitted_to_processing_date |
| **Underwriter** | `ctc_date` | ctc_date - submitted_to_underwriting_date |
| **Closer** | `closing_date` | closing_date - ctc_date |

---

## Implementation Plan

### Phase 1: Backend API Endpoint

Create `/api/loans/operations-scorecard-trends` in `server/src/routes/loans.ts`

**Query Parameters:**
- `actor_type`: 'processor' | 'underwriter' | 'closer' (default: 'underwriter')
- `months`: Number of months to include (default: 13, like Qlik's rolling 13 months)
- `channel_group`: Optional channel filter
- `comparison_type`: 'vs-target' | 'monthly' | 'year-over-year' (default: 'vs-target')

**Response Structure:**
```typescript
interface OperationsScorecardTrendsResponse {
  actors: {
    id: string;
    name: string;
    tier: 'top' | 'second' | 'bottom';
    months: {
      [yearMonth: string]: {
        unitsOutput: number;
        outputVsTarget: number;
        averageDays: number;
        conversionPercent: number;
        loanComplexityScore: number;
        volumeOutput: number;
      };
    };
  }[];
  months: string[];  // Ordered list of month keys, e.g., ['Jan-2026', 'Dec-2025', ...]
  totals: {
    [yearMonth: string]: {
      unitsOutput: number;
      outputVsTarget: number;
      volumeOutput: number;
    };
  };
  tierSummary: {
    top: TierSummaryData;
    second: TierSummaryData;
    bottom: TierSummaryData;
  };
  kpis: {
    targetUnitsPerMonth: number;
    avgUnitsOutput: number;
    avgVolumeOutput: number;
    avgLoanComplexityScore: number;
    avgDays: number;
  };
  dateRange: {
    start: string;
    end: string;
    monthsIncluded: number;
  };
}
```

### Phase 2: Frontend Hook

Create `src/hooks/useOperationsScorecardTrendsData.ts`

Pattern to follow: `src/hooks/useOperationsScorecardData.ts`

```typescript
export type ScorecardActorType = 'processor' | 'underwriter' | 'closer';
export type ComparisonViewType = 'vs-target' | 'monthly' | 'year-over-year';

export const useOperationsScorecardTrendsData = (
  actorType: ScorecardActorType,
  comparisonView: ComparisonViewType,
  selectedTenantId?: string | null,
  selectedChannel?: string | null,
  monthsToShow?: number
) => {
  // Fetch and return data
  return { data, loading, error };
};
```

### Phase 3: Frontend Integration

Update `OperationScorecardTrendsView.tsx`:

1. Import and use the new hook
2. Pass `selectedTenantId` and `selectedChannel` from parent page (needs prop drilling)
3. Replace mock data with API data
4. Add loading and error states
5. Dynamic month columns based on API response
6. Calculate totals row from actual data

---

## Database Query Strategy

The endpoint needs to aggregate data **by actor and by month**. Use the existing operations scorecard logic as a base but group by month.

```sql
-- Get monthly metrics for each actor
WITH monthly_data AS (
  SELECT 
    ${actorColumn} AS actor_name,
    DATE_TRUNC('month', ${outputDateField})::date AS output_month,
    COUNT(*) AS units_output,
    SUM(loan_amount) AS volume_output,
    AVG(${outputDateField} - ${inputDateField}) AS avg_days,
    -- Loan complexity score calculation
    AVG(
      CASE WHEN loan_type IN ('FHA', 'VA', 'USDA') THEN 0.10 ELSE 0 END +
      CASE WHEN loan_purpose = 'Purchase' THEN 0.10 ELSE 0 END +
      CASE WHEN fico_score < 680 THEN 0.10 ELSE 0 END +
      CASE WHEN ltv_ratio > 95 THEN 0.05 ELSE 0 END +
      CASE WHEN borr_self_employed = true THEN 0.20 ELSE 0 END
    ) * 100 + 100 AS loan_complexity_score
  FROM loans
  WHERE ${outputDateField} IS NOT NULL
    AND ${outputDateField} >= $1  -- start date
    AND ${outputDateField} <= $2  -- end date
    AND ${actorColumn} IS NOT NULL
    AND ${actorColumn} NOT IN ('99-Missing', 'Missing', '')
  GROUP BY ${actorColumn}, DATE_TRUNC('month', ${outputDateField})
)
SELECT * FROM monthly_data
ORDER BY actor_name, output_month DESC
```

---

## Metrics Calculation

### 1. Units Output
```
COUNT(loans) for actor in month
```

### 2. Output vs Target
```
Units Output - Target Units Per Month
```
Note: Target is typically a configurable value (default: 25 from UI)

### 3. Average Days (Turn Time)
Actor-specific calculation:
- Processor: `submitted_to_underwriting_date - submitted_to_processing_date`
- Underwriter: `ctc_date - submitted_to_underwriting_date`
- Closer: `closing_date - ctc_date`

### 4. % Conversion
```
(Approved Loans / Total Decisions) × 100
```
Only applicable for Underwriters primarily.

### 5. Loan Complexity Score
Same formula as Operations Scorecard:
```
(1 + BaseComplexity) × 100
Where BaseComplexity considers: FHA/VA, Purchase, Low FICO, High LTV, Self-Employed
```

---

## Tier Assignment

Tiers are assigned based on TTS score (same as Operations Scorecard):
- **Top Tier**: TTS > 120 (20%+ above average)
- **Second Tier**: 100 ≤ TTS ≤ 120 (at or above average)
- **Bottom Tier**: TTS < 100 (below average)

TTS Formula (Operations):
```
OPS_TTS = (UnitRating × 0.70 + TurnTimeRating × 0.15 + ComplexityRating × 0.15)
```

---

## Comparison View Logic

### Vs Target (Default)
- Shows: Units Output, Output vs Target (units - 25)
- Highlighting: Green if >= target, Red if < target

### Monthly
- Shows: Month-over-month change
- Output vs Target becomes: Current Month - Previous Month

### Year-over-Year
- Shows: Same month last year comparison
- Output vs Target becomes: Current Month - Same Month Last Year
- Requires additional query for prior year data

---

## Files to Modify/Create

1. **Create**: `docs/OPERATION_SCORECARD_TRENDS_SPECIFICATION.md` - Detailed spec
2. **Modify**: `server/src/routes/loans.ts` - Add `/operations-scorecard-trends` endpoint
3. **Create**: `src/hooks/useOperationsScorecardTrendsData.ts` - Data fetching hook
4. **Modify**: `src/pages/OperationScorecardTrends.tsx` - Pass filter props to view
5. **Modify**: `src/components/dashboard/views/OperationScorecardTrendsView.tsx` - Integrate hook

---

## Reference Implementations

- **Operations Scorecard Backend**: `server/src/routes/loans.ts` → `/operations-scorecard` endpoint
- **Operations Scorecard Hook**: `src/hooks/useOperationsScorecardData.ts`
- **Operations Scorecard Spec**: `docs/OPERATIONS_SCORECARD_SPECIFICATION.md`
- **Database Schema**: `server/src/config/tenantDatabaseSchema.ts`

---

## Testing Checklist

### API Testing
- [ ] Endpoint returns data for processor actor type
- [ ] Endpoint returns data for underwriter actor type
- [ ] Endpoint returns data for closer actor type
- [ ] Monthly aggregation is correct
- [ ] Turn time calculations match actor type
- [ ] Tier assignment is correct

### UI Testing
- [ ] KPI cards show correct values
- [ ] Pivot table renders with correct months
- [ ] Totals row calculates correctly
- [ ] Tier colors are correctly applied
- [ ] Performance indicators show correctly
- [ ] vs Target highlighting works
- [ ] Export to Excel works with real data

### Data Validation (Compare with Qlik)
- [ ] Units per month matches
- [ ] Turn time (Average Days) matches
- [ ] Loan Complexity Score matches
- [ ] Tier assignments match
- [ ] Date range is correct (rolling 13 months)

---

## Key Differences from Operations Scorecard

| Aspect | Operations Scorecard | Operations Scorecard Trends |
|--------|---------------------|----------------------------|
| **View Type** | Summary by tier | Monthly breakdown by actor |
| **Grouping** | By tier (top/second/bottom) | By actor, then by month |
| **Time Period** | Single period (3/6/12 months) | Rolling 13 months, month-by-month |
| **Primary Focus** | Tier comparison | Individual actor trends |
| **Target Comparison** | TTS-based | Units vs monthly target |

---

## Notes

1. The trends view is essentially a **pivot table** with actors as rows and months as columns
2. Each cell contains multiple metrics (units, vs target, days, conversion, complexity)
3. The data source is the same as Operations Scorecard but aggregated differently
4. Consider caching monthly data since historical months don't change
5. The "comparison view" (vs-target, monthly, YoY) changes what the "Output vs Target" column shows

---

## Changelog

| Date | Change | Author |
|------|--------|--------|
| 2026-01-27 | Initial handover document | AI Assistant |
