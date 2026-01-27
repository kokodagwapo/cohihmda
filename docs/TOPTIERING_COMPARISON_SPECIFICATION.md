# TopTiering Comparison - Complete Specification

## Overview

The TopTiering Comparison page displays Pareto charts showing revenue, units, and profitability metrics by Branch or Loan Officer. Unlike the Sales Scorecard (which uses a weighted TTS composite score), the TopTiering Comparison page uses **cumulative revenue percentage** for tier assignment.

**Key Difference from Sales Scorecard:**
- **Sales Scorecard**: Tiers based on TTS weighted score thresholds (>120 = Top, 100-120 = Second, <100 = Bottom)
- **TopTiering Comparison**: Tiers based on cumulative revenue percentage (Top 50% revenue = Top Tier, Next 30% = Second, Remaining 20% = Bottom)

---

## Qlik Reference

### Sheet: "TopTiering by" (Performance App)

```qvs
// Sheet title expression:
='TopTiering by $(=if($(vCompanyScorecardShowHide)=0,'$(vScorecard)','$(vScorecardActor)')) | Production Data  
    $(=Pick(Match(vToDate,'LastWeekFlag','MTD','PreviousMonthFlag','QTD','PreviousQuarterFlag','YTDFlag','PreviousYearFlag'),
        'Last Week','Month to Date','Last Month','Quarter to Date','Last Quarter','Year to Date','Last Year'))' 
```

### Key Variables (from Script.csv)

| Variable | Retail Value | TPO Value | Description |
|----------|--------------|-----------|-------------|
| `vScorecard` | 'Branch' | 'Account Executive' | Entity type for first-level grouping |
| `vScorecardActor` | 'Loan Officer' | 'Broker Lender Name' | Actor type for second-level grouping |
| `vParetoMeasure` | 'Loan Amount' | - | Default measure: 'Loan Amount' or 'Branch Concession ($)' |
| `vChannelGroup` | 'Retail' | 'TPO' | Channel filter |

### Revenue Calculation (matches Qlik)

```qvs
// Revenue is the sum of all revenue components for funded loans
Revenue = Sum({<DateType={'Funding'}, [Rate Lock Buy Side Base Price Rate] = {">0"}>}[Revenue])

// [Revenue] field is calculated during load as:
// BaseBuy($) + OrigFeeBorrPd + OrigFeesSeller - CDLenderCredits + PayoutAmounts
```

In our implementation:
```sql
revenue = 
  COALESCE(origination_points, 0) +
  COALESCE(orig_fee_borr_pd, 0) +
  COALESCE(orig_fees_seller, 0) -
  COALESCE(cd_lender_credits, 0) +
  COALESCE(pa_sell_amt, 0) +
  COALESCE(pa_srp_amt, 0) +
  COALESCE(pa_payout_1, 0) + ... + COALESCE(pa_payout_12, 0)
```

---

## Tier Assignment Algorithm

Unlike TTS score-based tiering, TopTiering uses **cumulative revenue percentage**:

```javascript
// 1. Sort actors by revenue (descending)
const sorted = actors.sort((a, b) => b.revenue - a.revenue);

// 2. Calculate total revenue
const totalRevenue = sorted.reduce((sum, a) => sum + a.revenue, 0);

// 3. Assign tiers based on cumulative revenue percentage
let cumulativeRevenue = 0;
sorted.forEach(actor => {
  cumulativeRevenue += actor.revenue;
  const cumulativePercent = (cumulativeRevenue / totalRevenue) * 100;
  
  if (cumulativePercent <= 50) {
    actor.tier = 'top';      // Actors contributing to top 50% of revenue
  } else if (cumulativePercent <= 80) {
    actor.tier = 'second';   // Actors contributing to next 30% (50-80%)
  } else {
    actor.tier = 'bottom';   // Actors contributing to remaining 20% (80-100%)
  }
});
```

**Important**: The tier thresholds are based on cumulative revenue percentage, NOT actor count. This means:
- A few high-performing actors might make up the entire Top Tier
- Many lower-performing actors might be in the Bottom Tier
- The 50/30/20 split refers to **revenue contribution**, not actor count

---

## Date Range Options

| Filter | Calculation | Qlik Equivalent |
|--------|-------------|-----------------|
| `last-year` | Previous calendar year (Jan 1 - Dec 31) | `PreviousYearFlag = 'Yes'` |
| `last-quarter` | Previous complete quarter | `PreviousQuarterFlag = 'Yes'` |
| `last-month` | Previous complete month | `PreviousMonthFlag = 'Yes'` |
| `ytd` | Year to date (Jan 1 - vMaxDate) | `YTDFlag = 'Yes'` |
| `qtd` | Quarter to date | `QTD` |
| `mtd` | Month to date | `MTD` |
| `custom` | User-specified start/end dates | Custom range |

`vMaxDate` = MAX(COALESCE(last_modified_date, funding_date)) from loans table

---

## API Endpoint

### `GET /api/loans/toptiering-comparison`

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `actor_type` | string | 'loan-officer' | 'branch' or 'loan-officer' |
| `date_range` | string | 'last-year' | 'last-year', 'last-quarter', 'last-month', 'ytd', 'qtd', 'mtd', 'custom' |
| `start_date` | string | - | ISO date for custom range |
| `end_date` | string | - | ISO date for custom range |
| `channel_group` | string | - | 'Retail', 'TPO', or specific channel |

**Response Structure:**

```typescript
interface TopTieringComparisonResponse {
  actors: {
    id: string;                    // Actor ID (loan_officer_id or branch)
    name: string;                  // Actor name
    tier: 'top' | 'second' | 'bottom';
    revenue: number;               // Total revenue ($)
    units: number;                 // Number of funded loans
    volume: number;                // Total loan amount ($)
    revenueBPS: number;            // Revenue in basis points (revenue/volume * 10000)
    revenuePerLoan: number;        // Revenue per loan ($)
    cumulativeRevenuePercent: number;  // For Pareto line
    cumulativeUnitsPercent: number;    // For Units Pareto line
  }[];
  totals: {
    revenue: number;
    units: number;
    volume: number;
    avgRevenueBPS: number;
    actorCount: number;
    avgRevenuePerActor: number;
    avgUnitsPerActor: number;
  };
  tierSummary: {
    top: { count: number; revenue: number; revenuePercent: number; units: number; unitsPercent: number; avgRevenue: number; avgUnits: number; };
    second: { count: number; revenue: number; revenuePercent: number; units: number; unitsPercent: number; avgRevenue: number; avgUnits: number; };
    bottom: { count: number; revenue: number; revenuePercent: number; units: number; unitsPercent: number; avgRevenue: number; avgUnits: number; };
  };
  dateRange: {
    start: string;
    end: string;
    label: string;
    periodType: string;
  };
  yoyGrowth?: number;  // Year-over-year revenue growth percentage
}
```

---

## Revenue BPS Calculation

```
Revenue BPS = (Revenue / Loan Amount) × 10000
```

Example: If revenue is $5,000 on a $200,000 loan:
- Revenue BPS = (5,000 / 200,000) × 10000 = 250 BPS = 2.5%

---

## Missing Actor Filter

Excludes loans where actor name is:
- `NULL` or empty string
- `'99-Missing'`
- `'Missing'`
- `'No LO Found'`
- `'No Loan Officer'`
- `'No Branch Found'`
- `'Unknown'`
- Starts with `'99-'`

This matches Qlik's `vScorecardMissingLevel` and `vCCA_ScorecardMissingLevel` filters.

---

## Channel Filter Logic

| Channel Group | SQL Condition |
|--------------|---------------|
| 'Retail' | `channel ILIKE '%retail%' OR channel ILIKE '%brok%'` |
| 'TPO' | `channel ILIKE '%whole%' OR channel ILIKE '%corresp%'` |
| Other | `channel = <value>` |

---

## Files Structure

### Backend
- **Endpoint**: `server/src/routes/loans.ts` → `/api/loans/toptiering-comparison`
- **Status**: ✅ Implemented

### Frontend
- **Page**: `src/pages/TopTieringComparison.tsx`
- **View**: `src/components/dashboard/views/TopTieringComparisonView.tsx`
- **Hook**: `src/hooks/useTopTieringComparisonData.ts`
- **Status**: Hook and integration needed

---

## UI Components

### 1. Left Sidebar
- Search filter (by name or ID)
- Time filter dropdown (Last Year, Last Quarter, Last Month, YTD, QTD, MTD, Custom)
- Actor selector (Branch / Loan Officer tabs)
- Chart sorting selector
- TopTiering Story card with tier summaries
- Statistical insights (Median, Q1-Q3, etc.)

### 2. KPI Summary Dashboard (4 cards)
- Total Revenue with YoY growth
- Total Units with avg per actor
- Avg Revenue BPS with range
- Total Actors with tier breakdown

### 3. Pareto Charts
1. **Revenue by Actor**: Bar chart with cumulative % line
2. **Units by Actor**: Bar chart with cumulative % line (tabs: Units, Volume, Detail)
3. **Revenue BPS / Revenue per Loan**: Bar chart by actor (tabs)

---

## Testing Checklist

### API Testing
- [ ] Returns data for `actor_type=branch`
- [ ] Returns data for `actor_type=loan-officer`
- [ ] Date range filtering works (all 7 options)
- [ ] Channel filtering works (Retail, TPO, specific)
- [ ] Custom date range works with start_date/end_date
- [ ] Tier assignment follows 50/30/20 revenue split
- [ ] YoY growth calculation is correct

### UI Testing
- [ ] Hook fetches and displays real data
- [ ] Loading state shows during fetch
- [ ] Error state displays on API failure
- [ ] Demo data indicator shown when falling back to mock
- [ ] KPI cards show correct totals
- [ ] Pareto charts render with cumulative % line
- [ ] Tier colors correctly applied to bars
- [ ] Search filter works
- [ ] Sorting works (revenue/units asc/desc)
- [ ] Export CSV downloads correct data

### Data Validation (Compare with Qlik)
- [ ] Total revenue matches within 1%
- [ ] Total units matches exactly
- [ ] Top Tier revenue percentage ~50%
- [ ] Second Tier revenue percentage ~30%
- [ ] Bottom Tier revenue percentage ~20%
- [ ] Actor count matches
- [ ] Revenue BPS calculation matches

---

## Known Differences from Qlik

### 1. Tier Boundary Actors
When an actor's cumulative revenue crosses a threshold (e.g., exactly at 50%), our implementation assigns them to the **higher tier** (Top instead of Second). Qlik may handle this edge case differently.

### 2. Date Calculations
Our `vMaxDate` uses `MAX(COALESCE(last_modified_date, funding_date))`. Qlik uses `Max("Last Modified Date")`. If `last_modified_date` is not populated consistently, results may vary.

### 3. Revenue Components
We include all payout fields (`pa_payout_1` through `pa_payout_12`). If Qlik uses additional or different payout fields, revenue totals may differ slightly.

---

## Changelog

| Date | Change | Author |
|------|--------|--------|
| 2026-01-27 | Initial specification document | AI Assistant |
