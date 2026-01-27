# TopTiering Comparison Page - Implementation Handover

## Overview

The `TopTieringComparison` page (`src/pages/TopTieringComparison.tsx`) displays Pareto charts showing revenue, units, and profitability metrics by Branch or Loan Officer. The page currently uses **100% mock data** and needs to be connected to real database data, matching the "TopTiering by" sheet in the Qlik Performance app.

---

## Current State

### Page Structure
- **Page Component**: `src/pages/TopTieringComparison.tsx`
- **View Component**: `src/components/dashboard/views/TopTieringComparisonView.tsx`
- **Data Source**: Hardcoded mock data (`mockBranches`, `mockLoanOfficers`)

### UI Components (from TopTieringComparisonView.tsx)

1. **Left Sidebar - Filters & Story**
   - Search filter (by name or ID)
   - Time filter (Last Year, Last Quarter, Last Month, Custom)
   - Actor selector (Branch / Loan Officer)
   - Chart sorting selector (Default, Revenue High-Low, Revenue Low-High, Units High-Low, Units Low-High)
   - TopTiering Story card with tier summaries
   - Statistical insights (Median, Q1-Q3, etc.)

2. **KPI Summary Dashboard** (4 cards)
   - Total Revenue with YoY growth
   - Total Units with average per actor
   - Avg Revenue BPS with range
   - Total Actors with tier breakdown

3. **Pareto Charts** (3 charts)
   - **Chart 1**: Revenue by Branch/LO with cumulative % line
   - **Chart 2**: Units by Branch/LO with cumulative % line (tabs: Units, Volume, Detail)
   - **Chart 3**: Revenue BPS / Revenue per Loan by Branch/LO (tabs)

### Current Mock Data Structure

```typescript
interface ActorData {
  id: string;           // Branch ID or LO ID
  name: string;         // Branch name or LO name
  tier: 'top' | 'second' | 'bottom';  // TTS-based tier
  revenue: number;      // Total revenue ($)
  units: number;        // Number of loans
  volume: number;       // Loan volume ($)
  revenueBPS: number;   // Revenue in basis points
  revenuePerLoan: number; // Revenue per loan ($)
}
```

---

## Qlik Reference

### Sheet: "TopTiering by" (Sheets.csv line 23)
```
TopTiering by $(=if($(vCompanyScorecardShowHide)=0,'$(vScorecard)','$(vScorecardActor)')) | Production Data
```

### Key Qlik Variables (from Variables.csv)

| Variable | Description |
|----------|-------------|
| `vScorecard` | Entity type: 'Branch' |
| `vScorecardActor` | Actor type: 'Loan Officer' |
| `vScorecardEntities` | Branch dimension |
| `vScorecardActors` | Loan Officer dimension |
| `vParetoMeasure` | Measure selector: 'Loan Amount' or 'Branch Concession ($)' |
| `vParetoMeasureLabel` | Display label: 'Volume' or 'Concessions' |

### Key Qlik Expressions (from Expressions.csv)

| Expression | Description |
|------------|-------------|
| `vScorecard_Revenue Top Tier` | Total revenue for Top Tier actors |
| `vScorecardActor_Revenue % Top Tier` | Revenue percentage for Top Tier |
| `vScorecardActor_Revenue Second Tier` | Revenue for Second Tier |
| `vScorecardActor_Revenue % Bottom Tier` | Revenue percentage for Bottom Tier |
| `eCCA_TVI_DetailChartVolume13` | Detail chart volume (rolling 13 months) |

### Tier Assignment Logic
From Qlik TTS calculations, actors are assigned to tiers based on their TopTiering Score:
- **Top Tier**: Top 50% of revenue contributors
- **Second Tier**: Next 30% of revenue contributors  
- **Bottom Tier**: Remaining 20% of revenue contributors

### Revenue Calculation
Revenue is calculated from funded loans using:
```
Sum({<DateType={'Funding'}, [Rate Lock Buy Side Base Price Rate] = {">0"}>}[Revenue])
```

### Revenue BPS Calculation
```
Revenue BPS = (Revenue / Loan Amount) × 10000
```

---

## Implementation Plan

### Phase 1: Backend API Endpoint

Create `/api/loans/toptiering-comparison` in `server/src/routes/loans.ts`

**Query Parameters:**
- `actor_type`: 'branch' | 'loan-officer' (default: 'loan-officer')
- `date_range`: 'last-year' | 'last-quarter' | 'last-month' | 'custom'
- `start_date`: ISO date (for custom range)
- `end_date`: ISO date (for custom range)
- `channel_group`: Optional channel filter

**Response Structure:**
```typescript
interface TopTieringComparisonResponse {
  actors: {
    id: string;
    name: string;
    tier: 'top' | 'second' | 'bottom';
    revenue: number;
    units: number;
    volume: number;
    revenueBPS: number;
    revenuePerLoan: number;
  }[];
  totals: {
    revenue: number;
    units: number;
    volume: number;
    avgRevenueBPS: number;
    actorCount: number;
  };
  tierSummary: {
    top: { count: number; revenue: number; percent: number; };
    second: { count: number; revenue: number; percent: number; };
    bottom: { count: number; revenue: number; percent: number; };
  };
  yoyGrowth?: number;
  dateRange: {
    start: string;
    end: string;
    label: string;
  };
}
```

### Phase 2: Frontend Hook

Create `src/hooks/useTopTieringComparisonData.ts`

Pattern to follow: `src/hooks/useSalesScorecardData.ts`

```typescript
export type TopTieringActorType = 'branch' | 'loan-officer';
export type TimeFilterType = 'last-year' | 'last-quarter' | 'last-month' | 'custom';

export const useTopTieringComparisonData = (
  actorType: TopTieringActorType,
  timeFilter: TimeFilterType,
  selectedTenantId?: string | null,
  selectedChannel?: string | null,
  customDateRange?: { start: string; end: string }
) => {
  // Fetch and return data
  return { data, loading, error };
};
```

### Phase 3: Frontend Integration

Update `TopTieringComparisonView.tsx`:

1. Import and use the new hook
2. Pass `selectedTenantId` and `selectedChannel` from parent page
3. Replace `mockBranches` and `mockLoanOfficers` with API data
4. Add loading and error states
5. Show "(Using demo data)" indicator when falling back to mock data

---

## Database Columns Required

From `server/src/config/tenantDatabaseSchema.ts`:

| Column | Type | Description |
|--------|------|-------------|
| `loan_id` | TEXT | Unique loan identifier |
| `loan_amount` | DECIMAL | Loan volume |
| `loan_officer` | TEXT | Loan officer name |
| `loan_officer_id` | TEXT | Loan officer ID |
| `branch` | TEXT | Branch name |
| `funding_date` | DATE | Funding date for date filtering |
| `channel` | TEXT | Channel for filtering |

### Revenue Calculation Columns
Revenue = Sum of:
- `origination_points`
- `orig_fee_borr_pd`
- `orig_fees_seller`
- `cd_lender_credits` (subtracted)
- `pa_sell_amt`
- `pa_srp_amt`
- `pa_payout_1` through `pa_payout_12`

---

## SQL Query Strategy

```sql
-- Get funded loans with revenue metrics
SELECT 
  loan_officer AS actor_name,
  loan_officer_id AS actor_id,
  branch,
  COUNT(*) AS units,
  SUM(loan_amount) AS volume,
  SUM(
    COALESCE(origination_points, 0) +
    COALESCE(orig_fee_borr_pd, 0) +
    COALESCE(orig_fees_seller, 0) -
    COALESCE(cd_lender_credits, 0) +
    COALESCE(pa_sell_amt, 0) +
    COALESCE(pa_srp_amt, 0) +
    COALESCE(pa_payout_1, 0) + COALESCE(pa_payout_2, 0) + ...
  ) AS revenue
FROM loans
WHERE funding_date IS NOT NULL
  AND funding_date >= $1  -- start_date
  AND funding_date <= $2  -- end_date
  AND ($3::text IS NULL OR channel ILIKE $3)  -- channel filter
GROUP BY loan_officer, loan_officer_id, branch
ORDER BY revenue DESC
```

---

## Tier Assignment Algorithm

```javascript
// Sort actors by revenue descending
const sorted = actors.sort((a, b) => b.revenue - a.revenue);
const totalRevenue = sorted.reduce((sum, a) => sum + a.revenue, 0);

let cumulativeRevenue = 0;
sorted.forEach(actor => {
  cumulativeRevenue += actor.revenue;
  const cumulativePercent = (cumulativeRevenue / totalRevenue) * 100;
  
  if (cumulativePercent <= 50) {
    actor.tier = 'top';        // Top 50% of revenue
  } else if (cumulativePercent <= 80) {
    actor.tier = 'second';     // Next 30% (50-80%)
  } else {
    actor.tier = 'bottom';     // Remaining 20% (80-100%)
  }
});
```

---

## Date Range Logic

| Filter | Calculation |
|--------|-------------|
| `last-year` | `vMaxDate - 12 months` to `vMaxDate` |
| `last-quarter` | `vMaxDate - 3 months` to `vMaxDate` |
| `last-month` | `vMaxDate - 1 month` to `vMaxDate` |
| `custom` | User-specified start/end dates |

`vMaxDate` = MAX(funding_date) from loans table, or current date if no data.

---

## Files to Modify/Create

1. **Created**: `docs/TOPTIERING_COMPARISON_SPECIFICATION.md` - Detailed spec ✅
2. **Already Exists**: `server/src/routes/loans.ts` - `/toptiering-comparison` endpoint (lines 4593-4944) ✅
3. **Created**: `src/hooks/useTopTieringComparisonData.ts` - Data fetching hook ✅
4. **Modified**: `src/pages/TopTieringComparison.tsx` - Pass filter props ✅
5. **Modified**: `src/components/dashboard/views/TopTieringComparisonView.tsx` - Integrated hook ✅

---

## Reference Implementations

- **Sales Scorecard Backend**: `server/src/routes/loans.ts` → `/sales-scorecard` endpoint
- **Sales Scorecard Hook**: `src/hooks/useSalesScorecardData.ts`
- **Operations Scorecard**: `server/src/routes/loans.ts` → `/operations-scorecard` endpoint
- **Operations Scorecard Hook**: `src/hooks/useOperationsScorecardData.ts`
- **TTS Specification**: `docs/TTS_TOPTIERING_SCORE_SPECIFICATION.md`

---

## Testing Checklist

### API Testing
- [ ] Endpoint returns data for branch actor type
- [ ] Endpoint returns data for loan-officer actor type
- [ ] Date range filtering works correctly
- [ ] Channel filtering works correctly
- [ ] Tier assignment matches Qlik logic (50/30/20 split by revenue)

### UI Testing
- [ ] KPI cards show correct totals
- [ ] Pareto charts render with real data
- [ ] Cumulative percentage line is accurate
- [ ] Tier colors are correctly applied to bars
- [ ] Search filter works
- [ ] Sorting works (revenue/units asc/desc)
- [ ] Export CSV downloads correct data

### Data Validation (Compare with Qlik)
- [ ] Total revenue matches
- [ ] Total units matches
- [ ] Top Tier revenue % matches (~50%)
- [ ] Actor count per tier matches
- [ ] Revenue BPS calculation matches

---

## Notes

1. The TopTiering page is focused on **sales performance** (Branch/Loan Officer), not operations
2. Revenue is the primary tier assignment metric
3. Tiers are based on **cumulative revenue percentage**, not TTS score
4. The Pareto chart shows individual actor values with a cumulative % line
5. YoY growth calculation requires comparing current period to same period last year

---

## Changelog

| Date | Change | Author |
|------|--------|--------|
| 2026-01-27 | Initial handover document | AI Assistant |
| 2026-01-27 | Full implementation complete: specification doc, frontend hook, view integration | AI Assistant |
