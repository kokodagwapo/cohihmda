# Sales Trends Page - Complete Specification

## Overview

The Sales Trends page displays performance metrics for Loan Officers over a configurable time period (3 or 6 months). This document defines exactly how each metric is calculated, including the Qlik expressions and our implementation.

**Qlik Sheet**: Sales Trends (ID: `58b57188-4641-4d9d-b40e-7b22fc8cecc6`)

---

## Page Components

| Component | Description |
|-----------|-------------|
| KPI Cards | 4 summary cards (Units, Volume, Active LOs, Avg Turn Time) |
| LO Table/Cards | Per-LO metrics with tier badges |
| Fund Type Chart | Pie chart showing loan distribution by type |
| Monthly Performance | Bar chart showing units/volume by month |
| Drilldown Modal | Detailed per-LO metrics and trends |

---

## Date Range Options

The page supports two date range modes:

| Mode | Period | Comparison Period |
|------|--------|-------------------|
| 3 Months | Last 3 complete months from vMaxDate | Previous 3 months (for trend %) |
| 6 Months | Last 6 complete months from vMaxDate | Previous 6 months (for trend %) |

**vMaxDate**: Maximum `last_modified_date` in the database (data freshness date)

```typescript
// 3-month mode example (if vMaxDate = Jan 22, 2026):
currentPeriod: Nov 1, 2025 - Jan 22, 2026
previousPeriod: Aug 1, 2025 - Oct 31, 2025

// 6-month mode example:
currentPeriod: Aug 1, 2025 - Jan 22, 2026
previousPeriod: Feb 1, 2025 - Jul 31, 2025
```

---

## Common Filters

All metrics apply these filters unless otherwise specified:

| Filter | Qlik Expression | Our Implementation |
|--------|-----------------|-------------------|
| Date Type | `DateType = 'Funding'` | `funding_date` within range |
| Channel | `[Consolidated Channels] = '$(vSalesTrendsChannel)'` | Retail (configurable) |
| Missing LO | `[Loan Officer Missing] = 0` | Exclude '99-Missing', 'Missing', etc. |

---

## KPI Card Specifications

### Card 1: Total Units Closed

**Description**: Count of funded loans in the date range.

**Qlik Expression** (line 14314-14323):
```qlik
Count({<[DateType]={'Funding'},[Funding Date]={"*"},[Consolidated Channels]*={'$(vChannelGroup)'}, $(vScorecardMissingLevel)>}DISTINCT [Loan Number])
```

**Our Implementation**:
```typescript
const totalUnits = fundedLoans.filter(l => 
  l.funding_date >= startDate && 
  l.funding_date <= endDate &&
  !isActorMissing(l.loan_officer)
).length;
```

**Status**: [ ] Verified against Qlik

---

### Card 2: Total Volume

**Description**: Sum of loan amounts for funded loans.

**Qlik Expression** (line 14314-14323):
```qlik
Sum({<[DateType]={'Funding'},[Funding Date]={"*"},[Consolidated Channels]*={'$(vChannelGroup)'}, $(vScorecardMissingLevel)>}[Loan Amount])
```

**Our Implementation**:
```typescript
const totalVolume = fundedLoans.reduce((sum, l) => sum + parseFloat(l.loan_amount || 0), 0);
```

**Status**: [ ] Verified against Qlik

---

### Card 3: Active Loan Officers

**Description**: Count of distinct LOs with funded production in the period.

**Qlik Expression**:
```qlik
Count(DISTINCT [Loan Officer])
```

**Our Implementation**:
```typescript
const activeLOs = new Set(fundedLoans.map(l => l.loan_officer)).size;
```

**Status**: [ ] Verified against Qlik

---

### Card 4: Average Turn Time

**Description**: Average days from application to closing.

**Qlik Expression** (line 14384-14423):
```qlik
Avg(
  Aggr(
    Avg({<Rolling13MonthFlag*={Yes}, DateType*={'$(vCCA_TVI_DateType)'}, [Consolidated Channels]*={'$(vCCA_ChannelGroup)'}>}
    [App-Close]),
    [Loan Officer], [YearMonth]
  )
)
```

**Our Implementation**:
```typescript
function calcTurnTime(loan: any): number | null {
  if (!loan.closing_date || !loan.application_date) return null;
  const closingDate = new Date(loan.closing_date);
  const appDate = new Date(loan.application_date);
  const days = (closingDate.getTime() - appDate.getTime()) / (1000 * 60 * 60 * 24);
  return days > 0 ? days : null;
}

const turnTimes = fundedLoans.map(calcTurnTime).filter(t => t !== null);
const avgTurnTime = turnTimes.reduce((a, b) => a + b, 0) / turnTimes.length;
```

**Filter**: Only loans where `closing_date - application_date > 0`

**Status**: [ ] Verified against Qlik

---

## Loan Officer Table Specifications

Each LO row displays the following metrics:

### LO Name, Branch, Tier

**Tier Assignment** (same as Sales Scorecard):
```typescript
// Uses TTS Score thresholds
if (ttsScore >= 120) tier = 'top';
else if (ttsScore >= 80) tier = 'second';
else tier = 'bottom';
```

---

### Closed (Units)

**Description**: Count of funded loans for this LO.

**Our Implementation**:
```typescript
const loUnits = fundedLoans.filter(l => l.loan_officer === loName).length;
```

---

### Volume

**Description**: Total loan amount for this LO.

**Our Implementation**:
```typescript
const loVolume = fundedLoans
  .filter(l => l.loan_officer === loName)
  .reduce((sum, l) => sum + parseFloat(l.loan_amount || 0), 0);
```

---

### Margin BPS

**Description**: Revenue in basis points relative to volume.

**Qlik Expression** (line 14325-14377):
```qlik
If('$(vCurrentProduction)' = 'Yes',
  Avg(Aggr(Avg({<DateType*={'Closing'}, [Consolidated Channels]*={'$(vChannelGroup)'}, $(vScorecardMissingLevel)>}
    [Margin (BPS)]), $(vScorecardAggrLevel), [YearMonth]))
)
```

**Our Implementation**:
```typescript
// Revenue calculation per loan
function calcLoanRevenue(loan: any): number {
  const basePriceRate = parseFloat(loan.rate_lock_buy_side_base_price_rate || 0);
  const loanAmount = parseFloat(loan.loan_amount || 0);
  const origFeeBorrPd = parseFloat(loan.orig_fee_borr_pd || 0);
  const origFeesSeller = parseFloat(loan.orig_fees_seller || 0);
  const cdLenderCredits = parseFloat(loan.cd_lender_credits || 0);
  
  if (basePriceRate <= 0) return 0;
  
  const baseBuyDollars = ((basePriceRate - 100) / 100) * loanAmount;
  return baseBuyDollars + origFeeBorrPd + origFeesSeller - cdLenderCredits;
}

// Margin BPS = (Total Revenue / Total Volume) * 10000
const marginBps = loVolume > 0 ? (loRevenue / loVolume) * 10000 : 0;
```

**Status**: [ ] Verified against Qlik

---

### Trend %

**Description**: Period-over-period comparison of units closed.

**Formula**:
```typescript
// Compare current period to previous period
const currentUnits = getUnitsInPeriod(lo, currentStart, currentEnd);
const previousUnits = getUnitsInPeriod(lo, previousStart, previousEnd);

const trendPercent = previousUnits > 0 
  ? ((currentUnits - previousUnits) / previousUnits) * 100 
  : (currentUnits > 0 ? 100 : 0);
```

**Note**: If previous period has 0 units and current has > 0, trend is +100%.

**Status**: [ ] Verified against Qlik

---

### Days Avg (Turn Time)

**Description**: Average turn time for this LO.

**Our Implementation**:
```typescript
const loTurnTimes = fundedLoans
  .filter(l => l.loan_officer === loName)
  .map(calcTurnTime)
  .filter(t => t !== null);

const loAvgTurnTime = loTurnTimes.length > 0
  ? loTurnTimes.reduce((a, b) => a + b, 0) / loTurnTimes.length
  : 0;
```

---

## Fund Type Breakdown (Pie Chart)

**Description**: Distribution of funded loans by loan type.

### Fund Type Mapping

| Display Name | Loan Type Values |
|--------------|------------------|
| Conventional | `loan_type = 'Conventional'` |
| FHA | `loan_type = 'FHA'` |
| VA | `loan_type = 'VA'` |
| USDA | `loan_type IN ('FarmersHomeA', 'FarmersHomeAdministration', 'USDA')` |
| Jumbo | `loan_amount > conforming_limit` (typically $726,200 for 2023) |

**Qlik Expression** (line 14378-14380):
```qlik
Count({$<DateType={'Closing'},[Loan Type Group] = {'Government'},[Consolidated Channels]={'$(vChannelGroup)'}>}[Loan Number])
/Count({$<DateType={'Closing'},[Consolidated Channels]={'$(vChannelGroup)'}>}[Loan Number])
```

**Our Implementation**:
```typescript
const fundTypeBreakdown = [
  { name: 'Conventional', value: countByType('Conventional'), fill: '#3b82f6' },
  { name: 'FHA', value: countByType('FHA'), fill: '#10b981' },
  { name: 'VA', value: countByType('VA'), fill: '#a855f7' },
  { name: 'USDA', value: countUSDA(), fill: '#f97316' },
  { name: 'Jumbo', value: countJumbo(), fill: '#ec4899' },
];

function countByType(type: string): number {
  return fundedLoans.filter(l => l.loan_type === type).length;
}

function countUSDA(): number {
  return fundedLoans.filter(l => 
    l.loan_type?.toLowerCase().includes('farmershome') ||
    l.loan_type?.toLowerCase() === 'usda'
  ).length;
}

function countJumbo(): number {
  const conformingLimit = 726200; // 2023 limit
  return fundedLoans.filter(l => 
    parseFloat(l.loan_amount || 0) > conformingLimit &&
    l.loan_type === 'Conventional'
  ).length;
}
```

**Status**: [ ] Verified against Qlik

---

## Monthly Performance (Bar Chart)

**Description**: Units and volume aggregated by funding month.

**Our Implementation**:
```typescript
interface MonthlyPerformance {
  month: string;  // 'YYYY-MMM' format (e.g., '2025-Nov')
  units: number;
  volume: number;
}

function aggregateByMonth(loans: any[]): MonthlyPerformance[] {
  const monthMap = new Map<string, { units: number; volume: number }>();
  
  loans.forEach(loan => {
    if (!loan.funding_date) return;
    const date = new Date(loan.funding_date);
    const monthKey = `${date.getFullYear()}-${date.toLocaleString('en', { month: 'short' })}`;
    
    const existing = monthMap.get(monthKey) || { units: 0, volume: 0 };
    monthMap.set(monthKey, {
      units: existing.units + 1,
      volume: existing.volume + parseFloat(loan.loan_amount || 0),
    });
  });
  
  return Array.from(monthMap.entries())
    .map(([month, data]) => ({ month, ...data }))
    .sort((a, b) => new Date(a.month).getTime() - new Date(b.month).getTime());
}
```

**Status**: [ ] Verified against Qlik

---

## Drilldown Modal Specifications

When clicking on an LO, the modal displays:

### Summary KPIs
- Total Closed (units)
- Total Volume
- Average Margin (BPS)
- Turn Time (days)

### Branch Rank
- LO's rank within their branch by units
- Format: "Rank X of Y"

### Monthly Details Table

| Column | Description |
|--------|-------------|
| Month | YYYY-MMM format |
| Closed | Units for that month |
| Volume | Loan amount sum |
| Margin | BPS for that month |
| Pull Through | % of apps that funded |
| Turn Time | Avg days app-to-close |

### Performance Trend Chart
- Line chart showing units and margin by month
- X-axis: months in range
- Y-axis (dual): units (bars) and margin BPS (line)

---

## Database Field Mappings

| Metric | Database Field | Encompass Field ID | Notes |
|--------|---------------|-------------------|-------|
| Loan Amount | `loan_amount` | Fields.2 | |
| Loan Type | `loan_type` | Fields.1172 | |
| Loan Purpose | `loan_purpose` | Fields.19 | |
| Funding Date | `funding_date` | Fields.MS.FUN | |
| Application Date | `application_date` | Fields.3142 | |
| Closing Date | `closing_date` | Fields.748 | |
| Loan Officer | `loan_officer` | Fields.317 | |
| Branch | `branch` | Various | |
| Channel | `channel` | Fields.2626 | |
| Rate Lock Base Price | `rate_lock_buy_side_base_price_rate` | Fields.2161 | For revenue calc |
| Orig Fee Borr Pd | `orig_fee_borr_pd` | Fields.NEWHUD.X686 | For revenue calc |
| Orig Fees Seller | `orig_fees_seller` | Fields.559 | For revenue calc |
| CD Lender Credits | `cd_lender_credits` | Fields.CD2.XSTLC | For revenue calc |
| Current Loan Status | `current_loan_status` | Fields.1393 | For active/inactive |

---

## Implementation Files

| File | Description |
|------|-------------|
| `server/src/routes/loans.ts` | Backend API (`/api/loans/sales-trends`) |
| `src/hooks/useSalesTrendsData.ts` | Frontend data fetching hook |
| `src/pages/toptiering/sales/SalesTrends.tsx` | Page component |

---

## API Endpoint Specification

### `GET /api/loans/sales-trends`

**Query Parameters**:
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `date_range` | `'3-months' \| '6-months'` | `'3-months'` | Period selection |
| `channel_group` | `string` | `'Retail'` | Channel filter |

**Response**:
```typescript
{
  loanOfficers: {
    id: string;
    name: string;
    initials: string;
    branch: string;
    branchNumber: string;
    tier: 'top' | '2nd' | 'bottom';
    closed: number;
    volume: number;
    marginBPS: number;
    trendPercent: number;
    daysAvg: number;
    ttsScore: number;
  }[];
  
  kpiMetrics: {
    totalUnits: number;
    totalVolume: number;
    activeLOs: number;
    avgTurnTime: number;
  };
  
  fundTypeBreakdown: {
    name: string;
    value: number;
    fill: string;
  }[];
  
  monthlyPerformance: {
    month: string;
    units: number;
    volume: number;
  }[];
  
  dateRange: {
    startDate: string;
    endDate: string;
    previousStartDate: string;
    previousEndDate: string;
  };
}
```

---

## Verification Checklist

When comparing to Qlik, verify:

- [ ] Total Units matches Qlik Sales Trends sheet
- [ ] Total Volume matches
- [ ] Active LO count matches
- [ ] Average Turn Time matches
- [ ] Individual LO units match
- [ ] Individual LO volumes match
- [ ] Individual LO margin BPS values match
- [ ] Trend % calculations are correct
- [ ] Fund type breakdown matches
- [ ] Monthly aggregation matches
- [ ] Date range toggle correctly filters data

---

## Known Differences from Sales Scorecard

| Aspect | Sales Scorecard | Sales Trends |
|--------|-----------------|--------------|
| Date Range | Rolling 13 months | 3 or 6 months |
| Primary View | Summary table by tier | LO cards/table |
| Charts | None | Pie chart, Bar chart |
| Trend Data | Single snapshot | Period-over-period comparison |
| Drilldown | None | Full LO detail modal |
| Actor Grouping | Tier-based summary | Individual LO rows |

---

## Implementation Status

### Completed
- [x] Specification document created
- [x] Backend API endpoint `/api/loans/sales-trends`
- [x] Backend drilldown endpoint `/api/loans/sales-trends/drilldown/:loName`
- [x] Frontend hook `useSalesTrendsData.ts`
- [x] Frontend integration in `SalesTrends.tsx`
- [x] Loading and error states
- [x] Date range toggle wired to API
- [x] Drilldown modal with API data

### Testing Required
- [ ] Compare Total Units against Qlik
- [ ] Compare Total Volume against Qlik
- [ ] Compare Individual LO metrics against Qlik
- [ ] Verify fund type breakdown percentages
- [ ] Verify monthly aggregation accuracy
- [ ] Test 3-month vs 6-month toggle

---

## Testing Procedure

### Step 1: Set Up Comparison
1. Open Qlik Performance app, navigate to Sales Trends sheet
2. Set channel filter to "Retail"
3. Note the date range being displayed

### Step 2: Compare KPI Cards
1. In Cohi, navigate to Sales Trends page
2. Compare these values:
   - Total Units Closed
   - Total Volume
   - Active Loan Officers count
   - Average Turn Time (days)

### Step 3: Compare Individual LOs
1. Select a few top performers in Qlik
2. Find the same LOs in Cohi
3. Compare: Units, Volume, Margin BPS, Turn Time

### Step 4: Compare Charts
1. Fund Type Breakdown: Verify each category count
2. Monthly Performance: Verify units per month

### Step 5: Test Drilldown
1. Click on an LO in Cohi
2. Verify the drilldown data matches Qlik detail view

---

## Known Issues and Discrepancies

*(To be populated during testing)*

| Issue | Description | Status |
|-------|-------------|--------|
| - | - | - |

---

## Changelog

| Date | Change | Author |
|------|--------|--------|
| 2026-01-27 | Initial specification document | AI Assistant |
| 2026-01-27 | Backend API implementation | AI Assistant |
| 2026-01-27 | Frontend integration completed | AI Assistant |
| 2026-01-27 | Added testing procedure and implementation status | AI Assistant |
