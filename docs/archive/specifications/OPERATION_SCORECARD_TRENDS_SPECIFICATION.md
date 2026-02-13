# Operation Scorecard Trends - Complete Specification

## Overview

The Operation Scorecard Trends page (`src/pages/OperationScorecardTrends.tsx`) displays monthly performance trends for operations staff (Processors, Underwriters, Closers) in a pivot table format. This specification defines the metrics calculations, database mappings, and API design required to achieve parity with the Qlik Performance app.

### Qlik Reference
- **Sheet Name**: "Operation Scorecard Trends"
- **Sheet ID**: `1b7e60bb-c475-4922-a4f8-2c9c4b89fbb5`
- **App**: Performance (Qlik Sense)

### Relationship to Operations Scorecard

| Aspect | Operations Scorecard | Operations Scorecard Trends |
|--------|---------------------|----------------------------|
| **Aggregation** | By actor only | By actor AND by month |
| **View Type** | Summary by tier | Monthly breakdown by actor |
| **Time Period** | Single period (3/6/12 months) | Rolling 13 months, month-by-month |
| **Primary Focus** | Tier comparison | Individual actor trends over time |
| **Target Comparison** | TTS-based scoring | Units vs monthly target |

---

## Data Model Specification

### Primary Aggregation

Unlike the Operations Scorecard which groups data by actor only, the Trends view groups by **actor AND month**:

```sql
GROUP BY ${actorColumn}, DATE_TRUNC('month', ${outputDateField})
```

### Key Qlik Variables

| Variable | Purpose | Default Value |
|----------|---------|---------------|
| `vOpsScorecardActor` | Actor type selector | 'Underwriter' |
| `vOpsScorecardMonthRange` | Number of months to display | 12 (results in 13 months rolling) |
| `vScorecardUnitsAverage` | Average units per actor calculation | Calculated |
| `vScorecardTurnTimeAverage` | Average turn time calculation | Calculated |
| `vOpsScorecardMinYearMonth` | Start month for trends | Calculated from range |
| `vOpsScorecardMaxYearMonth` | End month for trends | Current month |

### Actor Types

| Actor Type | Database Column | Display Name |
|------------|-----------------|--------------|
| `processor` | `processor` | Processor |
| `underwriter` | `underwriter` | Underwriter |
| `closer` | `closer` | Closer |

---

## Actor-Specific Date Mappings

Each actor type uses different milestone dates for output and turn time calculations.

| Actor | Output Date Field | Input Date Field | Turn Time Formula |
|-------|-------------------|------------------|-------------------|
| **Processor** | `submitted_to_underwriting_date` | `submitted_to_processing_date` | output - input |
| **Underwriter** | `ctc_date` | `submitted_to_underwriting_date` | output - input |
| **Closer** | `closing_date` | `ctc_date` | output - input |

### Database Column Fallbacks

From `server/src/config/tenantDatabaseSchema.ts`:

| Primary Column | Fallback Columns |
|----------------|------------------|
| `submitted_to_processing_date` | `processing_date`, `started_date` |
| `submitted_to_underwriting_date` | `submittal_date` |
| `ctc_date` | (none) |
| `closing_date` | `funding_date` |

---

## Metrics Calculations

### Per Actor Per Month Metrics

#### 1. Units Output
```
COUNT(loans) WHERE actor = X AND output_month = Y
```
- **Database**: Count distinct loans where `output_date` falls within the month
- **Qlik Reference**: `[Scorecard Output Units]`

#### 2. Output vs Target
```
Units Output - Target Units Per Month
```
- **Default Target**: 25 units/month (configurable via UI)
- **Display**: Positive values show `+X`, negative show `(X)` in financial format

#### 3. Average Days (Turn Time)
```
AVG(output_date - input_date)
```
- **Actor-specific**: Uses the date fields from the table above
- **Filter**: Only loans where turn time > 0 days
- **Qlik Reference**: Actor-specific turn time fields

#### 4. % Conversion
```
(COUNT(approved loans) / COUNT(total decisions)) × 100
```
- **Primarily for Underwriters**: Most meaningful for UW decisions
- **Filter**: Only loans with a decision status
- **Qlik Reference**: Approval/Denial tracking fields

#### 5. Loan Complexity Score
```
(1 + BaseComplexity) × 100
```

Where **BaseComplexity** considers:
- Government loans (FHA, VA, USDA): +0.10
- Purchase transactions: +0.10
- Low FICO (<680): +0.10
- High LTV (>95%): +0.05
- Self-employed borrower: +0.20

**Score Interpretation**:
- 100 = Baseline complexity
- \>100 = Higher complexity loans

#### 6. Volume Output
```
SUM(loan_amount) WHERE actor = X AND output_month = Y
```
- **Database**: `loan_amount` column
- **Format**: Currency with abbreviations ($68.4M)

---

## KPI Calculations (Top Row)

Five KPI cards appear above the pivot table:

| KPI | Calculation | Notes |
|-----|-------------|-------|
| **Target Units Per Month** | Configurable (default: 25) | Static value from settings |
| **Total Monthly Output** | SUM(all actors' units in current month) | Current period total |
| **Avg Volume Output** | AVG(volume per actor) | Across all actors in period |
| **Loan Complexity Score** | AVG(complexity scores) | Weighted by units |
| **Average Days** | AVG(turn time) across all actors | Weighted by units |

---

## Tier Assignment

Tiers are assigned based on TTS (TopTiering Score), same formula as Operations Scorecard:

### TTS Formula (Operations)
```
OPS_TTS = (UnitRating × 0.70 + TurnTimeRating × 0.15 + ComplexityRating × 0.15)
```

### Rating Calculations
```
UnitRating = (Actor Units / Avg Units per Actor) × 100
TurnTimeRating = (1/Actor_AvgTurnTime) / (Avg of 1/TurnTime per Actor) × 100
ComplexityRating = (Actor AvgComplexity / Company AvgComplexity) × 100
```

### Tier Thresholds

| Tier | TTS Score Range | Description | Color |
|------|-----------------|-------------|-------|
| **Top Tier** | TTS > 120 | 20%+ above average | Teal |
| **Second Tier** | 100 ≤ TTS ≤ 120 | At or above average | Emerald |
| **Bottom Tier** | TTS < 100 | Below average | Lime |

---

## Tier Summary Metrics

The left sidebar shows tier summaries with:

| Metric | Calculation |
|--------|-------------|
| **Count** | Number of actors in tier |
| **Total Units** | SUM(units) for actors in tier |
| **% of Total** | (Tier Units / All Units) × 100 |
| **Avg Units/Month** | Total Units / Months / Actor Count |
| **Avg Days** | AVG(turn time) for actors in tier |

---

## Comparison View Logic

Three comparison views change how "Output vs Target" is calculated:

### 1. Vs Target (Default)
```
Output vs Target = Units Output - Target (25)
```
- **Highlighting**: Green if >= target, Red if < target
- **Use Case**: Measure against company goals

### 2. Monthly
```
Output vs Target = Current Month Units - Previous Month Units
```
- **Highlighting**: Green if positive, Red if negative
- **Use Case**: Track month-over-month growth

### 3. Year-over-Year
```
Output vs Target = Current Month Units - Same Month Last Year Units
```
- **Highlighting**: Green if positive, Red if negative
- **Use Case**: Compare seasonal performance
- **Note**: Requires 13+ months of data

---

## API Endpoint Specification

### Endpoint
```
GET /api/loans/operations-scorecard-trends
```

### Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `actor_type` | string | No | 'underwriter' | 'processor' \| 'underwriter' \| 'closer' |
| `months` | number | No | 13 | Number of months to include |
| `channel_group` | string | No | null | Channel filter (Retail, TPO, etc.) |
| `comparison_type` | string | No | 'vs-target' | 'vs-target' \| 'monthly' \| 'year-over-year' |
| `tenant_id` | string | No | from auth | Tenant ID for multi-tenant |
| `target_units` | number | No | 25 | Monthly target for vs-target comparison |

### Response Structure

```typescript
interface OperationsScorecardTrendsResponse {
  actors: ActorTrendsData[];
  months: string[];  // Ordered: ['Jan-2026', 'Dec-2025', 'Nov-2025', ...]
  totals: {
    [yearMonth: string]: MonthlyTotals;
  };
  tierSummary: {
    top: TierSummaryData;
    second: TierSummaryData;
    bottom: TierSummaryData;
  };
  kpis: {
    targetUnitsPerMonth: number;
    totalMonthlyOutput: number;
    avgVolumeOutput: number;
    avgLoanComplexityScore: number;
    avgDays: number;
  };
  dateRange: {
    start: string;  // ISO date
    end: string;    // ISO date
    monthsIncluded: number;
  };
  companyAverages: {
    avgUnitsPerActor: number;
    avgTurnTime: number;
    avgComplexity: number;
  };
}

interface ActorTrendsData {
  id: string;
  name: string;
  tier: 'top' | 'second' | 'bottom';
  ttsScore: number;
  months: {
    [yearMonth: string]: MonthlyMetrics;
  };
}

interface MonthlyMetrics {
  unitsOutput: number;
  outputVsTarget: number;  // Calculated based on comparison_type
  averageDays: number;
  conversionPercent: number;
  loanComplexityScore: number;
  volumeOutput: number;
}

interface MonthlyTotals {
  unitsOutput: number;
  outputVsTarget: number;
  volumeOutput: number;
}

interface TierSummaryData {
  count: number;
  totalUnits: number;
  percentOfTotal: number;
  avgUnitsPerMonth: number;
  avgDaysPerUnit: number;
}
```

---

## SQL Query Strategy

### Main Query Structure

```sql
WITH monthly_data AS (
  SELECT 
    ${actorColumn} AS actor_name,
    DATE_TRUNC('month', ${outputDateField})::date AS output_month,
    COUNT(DISTINCT loan_id) AS units_output,
    SUM(loan_amount) AS volume_output,
    AVG(
      CASE 
        WHEN ${outputDateField} > ${inputDateField} 
        THEN EXTRACT(EPOCH FROM (${outputDateField} - ${inputDateField})) / 86400
        ELSE NULL 
      END
    ) AS avg_days,
    -- Loan complexity score calculation
    AVG(
      (1 + (
        CASE WHEN loan_type IN ('FHA', 'VA', 'USDA') THEN 0.10 ELSE 0 END +
        CASE WHEN loan_purpose = 'Purchase' THEN 0.10 ELSE 0 END +
        CASE WHEN fico_score < 680 THEN 0.10 ELSE 0 END +
        CASE WHEN ltv_ratio > 95 THEN 0.05 ELSE 0 END +
        CASE WHEN borr_self_employed = true THEN 0.20 ELSE 0 END
      )) * 100
    ) AS loan_complexity_score,
    -- Conversion metrics (for underwriters)
    COUNT(CASE WHEN current_loan_status IN ('Approved', 'CTC', 'Funded', 'Closed') THEN 1 END)::float / 
      NULLIF(COUNT(CASE WHEN current_loan_status NOT IN ('In Process', 'Suspended') THEN 1 END), 0) * 100 
      AS conversion_percent
  FROM loans
  WHERE ${outputDateField} IS NOT NULL
    AND ${outputDateField} >= $1  -- start date
    AND ${outputDateField} <= $2  -- end date
    AND ${actorColumn} IS NOT NULL
    AND ${actorColumn} NOT IN ('99-Missing', 'Missing', '')
    AND ${actorColumn} !~ '^99-'
    ${channelFilter}
  GROUP BY ${actorColumn}, DATE_TRUNC('month', ${outputDateField})
),
actor_totals AS (
  SELECT 
    actor_name,
    SUM(units_output) AS total_units,
    AVG(avg_days) AS overall_avg_days,
    AVG(loan_complexity_score) AS overall_complexity
  FROM monthly_data
  GROUP BY actor_name
)
SELECT 
  md.*,
  at.total_units,
  at.overall_avg_days,
  at.overall_complexity
FROM monthly_data md
JOIN actor_totals at ON md.actor_name = at.actor_name
ORDER BY at.total_units DESC, md.output_month DESC
```

### Dynamic Column Selection

```typescript
const getActorConfig = (actorType: string) => {
  const configs = {
    processor: {
      column: 'processor',
      outputDate: 'COALESCE(submitted_to_underwriting_date, submittal_date)',
      inputDate: 'COALESCE(submitted_to_processing_date, processing_date, started_date)',
    },
    underwriter: {
      column: 'underwriter',
      outputDate: 'ctc_date',
      inputDate: 'COALESCE(submitted_to_underwriting_date, submittal_date)',
    },
    closer: {
      column: 'closer',
      outputDate: 'COALESCE(closing_date, funding_date)',
      inputDate: 'ctc_date',
    },
  };
  return configs[actorType] || configs.underwriter;
};
```

---

## Frontend Hook Interface

### Hook Definition

File: `src/hooks/useOperationsScorecardTrendsData.ts`

```typescript
import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

export type ScorecardActorType = 'processor' | 'underwriter' | 'closer';
export type ComparisonViewType = 'vs-target' | 'monthly' | 'year-over-year';

export interface UseOperationsScorecardTrendsOptions {
  actorType?: ScorecardActorType;
  comparisonView?: ComparisonViewType;
  selectedTenantId?: string | null;
  selectedChannel?: string | null;
  monthsToShow?: number;
  targetUnits?: number;
}

export const useOperationsScorecardTrendsData = (
  options: UseOperationsScorecardTrendsOptions = {}
) => {
  const {
    actorType = 'underwriter',
    comparisonView = 'vs-target',
    selectedTenantId,
    selectedChannel,
    monthsToShow = 13,
    targetUnits = 25,
  } = options;

  const [data, setData] = useState<OperationsScorecardTrendsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      // ... implementation
    };
    fetchData();
  }, [actorType, comparisonView, selectedTenantId, selectedChannel, monthsToShow, targetUnits]);

  return { data, loading, error };
};
```

---

## Frontend Integration

### Page Component Updates

File: `src/pages/OperationScorecardTrends.tsx`

Changes required:
1. Pass `selectedTenantId` and `selectedChannel` to view component
2. Add loading state handling

```tsx
<OperationScorecardTrendsView 
  selectedTenantId={selectedTenantId}
  selectedChannel={selectedChannel}
/>
```

### View Component Updates

File: `src/components/dashboard/views/OperationScorecardTrendsView.tsx`

Changes required:
1. Accept props for tenant/channel filters
2. Import and use `useOperationsScorecardTrendsData` hook
3. Replace mock data with API data
4. Add loading and error states
5. Make month columns dynamic based on API response

---

## Qlik KPI Component Mappings

| Qlik Component ID | Component Name | Our Implementation |
|-------------------|----------------|-------------------|
| `NdLnCMZ` | Target Unit KPI | `kpis.targetUnitsPerMonth` |
| `qtDsgCB` | Avg Units Output KPI | `kpis.totalMonthlyOutput` |
| `YYTjeX` | Average Volume Output KPI | `kpis.avgVolumeOutput` |
| `kTxNeX` | Loan Complexity Score KPI | `kpis.avgLoanComplexityScore` |
| `jsLLmsP` | Average Days KPI | `kpis.avgDays` |
| `cGmdxs` | TopTiering Story | `tierSummary` sidebar |
| `PArmmDn` | Chart Container | Main pivot table |

---

## Filters Applied

### 1. Actor Missing Filter
Excludes actors where name is:
- `'99-Missing'`
- `'Missing'`
- Empty/null
- Starts with `'99-'`

### 2. Production Flag Filter
Only includes actors who have output in the date range (active producers).

### 3. Date Range Filter
Rolling 13 months from the max date in the data.

### 4. Channel Filter (Optional)
Filters by consolidated channel group when provided.

---

## Testing Requirements

### API Testing Checklist

- [ ] Endpoint returns data for processor actor type
- [ ] Endpoint returns data for underwriter actor type
- [ ] Endpoint returns data for closer actor type
- [ ] Monthly aggregation is correct (13 months)
- [ ] Turn time calculations match actor type
- [ ] Tier assignment matches TTS formula
- [ ] Comparison view calculations work (vs-target, monthly, YoY)
- [ ] Channel filtering works correctly
- [ ] Tenant isolation is maintained

### UI Testing Checklist

- [ ] KPI cards show correct values from API
- [ ] Pivot table renders with dynamic month columns
- [ ] Totals row calculates correctly
- [ ] Tier colors are correctly applied to rows
- [ ] Performance indicators show correctly
- [ ] vs Target highlighting works (green/red)
- [ ] Actor selector changes data
- [ ] Comparison view selector changes calculations
- [ ] Export to Excel includes real data
- [ ] Loading state displays correctly
- [ ] Error state handles gracefully

### Data Validation (Compare with Qlik)

- [ ] Units per month per actor matches Qlik
- [ ] Turn time (Average Days) matches Qlik
- [ ] Loan Complexity Score matches Qlik
- [ ] Tier assignments match Qlik
- [ ] Date range is correct (rolling 13 months)
- [ ] Volume output matches Qlik
- [ ] Conversion percentages match Qlik (for UW)

---

## Implementation Files

| File | Action | Description |
|------|--------|-------------|
| `docs/OPERATION_SCORECARD_TRENDS_SPECIFICATION.md` | Create | This specification document |
| `server/src/routes/loans.ts` | Modify | Add `/operations-scorecard-trends` endpoint |
| `src/hooks/useOperationsScorecardTrendsData.ts` | Create | Data fetching hook |
| `src/pages/OperationScorecardTrends.tsx` | Modify | Pass filter props to view |
| `src/components/dashboard/views/OperationScorecardTrendsView.tsx` | Modify | Integrate hook, remove mock data |

---

## Reference Implementations

- **Operations Scorecard Backend**: `server/src/routes/loans.ts` → `/operations-scorecard` endpoint (line 3511)
- **Operations Scorecard Hook**: `src/hooks/useOperationsScorecardData.ts`
- **Operations Scorecard Spec**: `docs/OPERATIONS_SCORECARD_SPECIFICATION.md`
- **Database Schema**: `server/src/config/tenantDatabaseSchema.ts`
- **Qlik Documentation**: `QlikAppsAndLogicDictionaryDocs/Performance/`

---

## Performance Considerations

1. **Caching**: Historical months don't change - consider caching completed months
2. **Query Optimization**: Use indexes on actor columns and date fields
3. **Response Size**: 13 months × ~20 actors × 6 metrics = moderate payload (~50KB)
4. **Lazy Loading**: Consider loading tier summary first, then full data

---

## Changelog

| Date | Change | Author |
|------|--------|--------|
| 2026-01-27 | Initial specification document | AI Assistant |
