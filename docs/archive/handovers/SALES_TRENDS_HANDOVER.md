# Sales Trends Page - Implementation Handover

## Task Overview

Connect the `SalesTrends.tsx` page to real data from the Qlik Performance app's "Sales Trends" sheet. The page currently displays **mock data** and needs to be wired up to actual metrics/calculations matching Qlik.

---

## Current State

### File Location
- **Frontend**: `cohi-merge-12426/coheus-dev/src/pages/toptiering/sales/SalesTrends.tsx`
- **~1,067 lines** of React/TypeScript code
- Uses **100% mock data** (hardcoded arrays)

### UI Components Needing Real Data

#### 1. KPI Cards (4 cards at top)
| Card | Current Mock Value | Data Needed |
|------|-------------------|-------------|
| Total Units Closed | Sum of mock LOs | Count of funded loans in date range |
| Total Volume | Sum of mock volumes | Sum of loan_amount for funded loans |
| Active Loan Officers | Mock LO count | Count of distinct LOs with production |
| Avg Turn Time | Mock average | Average (closing_date - application_date) |

#### 2. Loan Officer Table/Cards
Each LO displays:
- **Name, Branch, Tier** (top/2nd/bottom)
- **Closed** - funded loan count
- **Volume** - total loan_amount
- **Margin BPS** - revenue in basis points
- **Trend %** - period-over-period comparison
- **Days Avg** - average turn time

#### 3. Units by Fund Type (Pie Chart)
- Conventional, FHA, VA, USDA, Jumbo
- Count of loans by `loan_type`

#### 4. Monthly Performance (Bar Chart)
- Units and Volume aggregated by month
- Shows 3 or 6 months based on date range toggle

#### 5. Drilldown Modal (per LO)
- KPI summary cards
- Performance Trend chart (units & margin by month)
- Contact info (may need DB field or placeholder)
- Branch Rank (LO rank within branch)
- Monthly Details table

---

## Date Range Options

The page has a toggle for **3 Months** vs **6 Months** date range. This should filter all data accordingly:

```typescript
type DateRange = '3-months' | '6-months';
```

---

## Reference Implementation

The **Sales Scorecard** page was recently implemented with similar data requirements. Use these as reference:

### Backend
- `server/src/routes/loans.ts` - `/api/loans/sales-scorecard` endpoint
- Contains TTS calculations, tier assignments, volume/units/revenue calculations

### Specification Docs
- `docs/TTS_TOPTIERING_SCORE_SPECIFICATION.md` - TTS formula details
- `docs/SALES_SCORECARD_SUMMARY_TABLE_SPECIFICATION.md` - All metric calculations

### Key Formulas from Sales Scorecard
```typescript
// Revenue calculation
function calcLoanRevenue(loan) {
  const baseBuyDollars = ((basePriceRate - 100) / 100) * loanAmount;
  return baseBuyDollars + origFeeBorrPd + origFeesSeller - cdLenderCredits;
}

// Margin BPS
marginBps = (totalRevenue / totalVolume) * 10000;

// Turn Time
turnTime = (closingDate - applicationDate) / (1000 * 60 * 60 * 24); // days
```

---

## Qlik Reference Files

Investigate the **Sales Trends** sheet in the Qlik Performance app. Key files to search:

```
QlikAppsAndLogicDictionaryDocs/
├── Performance/
│   └── QSDA-[1.7.0] Performance - Homestead-*/
│       ├── Expressions.csv      # Search for "Sales Trends" expressions
│       ├── Variables.csv        # Variables used in Sales Trends
│       ├── Vizobjects.csv       # Chart/table definitions
│       └── Fields.csv           # Available data fields
│
├── tvd-coheus-incremental-builder-qlik/
│   └── Transform.qvs           # Field calculations (e.g., W-H Days)
│
└── logic-dictionary-docs/
    └── data-dictionary/
        └── CoheusDataDictionary.xml  # Encompass field mappings
```

### Search Patterns
```bash
# Find Sales Trends related expressions
grep -r "Sales Trends" QlikAppsAndLogicDictionaryDocs/

# Find trend calculations
grep -r "vTrend\|Trend.*Percent\|MoM\|YoY" QlikAppsAndLogicDictionaryDocs/

# Find Fund Type breakdown
grep -r "Fund Type\|Loan Type\|Conventional\|FHA\|VA" QlikAppsAndLogicDictionaryDocs/
```

---

## Implementation Steps

### Phase 1: Research Qlik Logic
1. Search Qlik docs for "Sales Trends" sheet expressions
2. Document each metric's exact Qlik formula
3. Identify required database fields
4. Note any filters (date range, channel, missing LO, etc.)

### Phase 2: Backend API
1. Create new endpoint `/api/loans/sales-trends` OR extend existing endpoint
2. Implement date range filtering (3/6 months from vMaxDate)
3. Calculate per-LO metrics:
   - Closed units, Volume, Revenue, Margin BPS
   - Turn Time average
   - Trend % (compare current period to previous period)
4. Calculate aggregates:
   - Total units, volume
   - Units by fund type
   - Monthly breakdown

### Phase 3: Frontend Integration
1. Create data fetching hook (similar to `useSalesScorecardData.ts`)
2. Replace mock data arrays with API data
3. Handle loading/error states
4. Ensure date range toggle updates API calls

### Phase 4: Drilldown Modal
1. Add per-LO detail endpoint or include in main response
2. Connect modal data to real values
3. Branch rank calculation

---

## Key Differences from Sales Scorecard

| Aspect | Sales Scorecard | Sales Trends |
|--------|-----------------|--------------|
| Date Range | Rolling 13 months | 3 or 6 months |
| Primary View | Summary table by tier | LO cards/table |
| Charts | None | Pie chart, Bar chart |
| Trend Data | Single snapshot | Period-over-period comparison |
| Drilldown | None | Full LO detail modal |

---

## Mock Data Interfaces (for reference)

```typescript
interface LoanOfficer {
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
  trendData: TrendDataPoint[];
}

interface FundTypeData {
  name: string;  // 'Conventional', 'FHA', 'VA', 'USDA', 'Jumbo'
  value: number; // count of loans
  fill: string;  // chart color
}

interface MonthlyPerformance {
  month: string;  // '2025-Nov'
  units: number;
  volume: number;
}
```

---

## Questions to Answer During Research

1. **Trend Calculation**: How does Qlik calculate the trend percentage?
   - Is it MoM (month-over-month)?
   - Is it period-over-period (3mo vs previous 3mo)?
   - What's the formula?

2. **Fund Type Mapping**: What `loan_type` values map to each category?
   - Conventional vs Conforming?
   - How are edge cases handled?

3. **Tier Assignment**: Does Sales Trends use the same TTS-based tiers as Scorecard?

4. **Date Range**: 
   - Does "3 months" include the current partial month?
   - How does Qlik define the period boundaries?

---

## Success Criteria

- [ ] All KPI cards show real data matching Qlik
- [ ] LO list matches Qlik's Sales Trends sheet
- [ ] Pie chart matches Qlik's fund type breakdown
- [ ] Bar chart matches Qlik's monthly performance
- [ ] Date range toggle correctly filters data
- [ ] Drilldown modal shows accurate LO details
- [ ] Create specification doc similar to `SALES_SCORECARD_SUMMARY_TABLE_SPECIFICATION.md`

---

## Related Documentation

- `docs/TTS_TOPTIERING_SCORE_SPECIFICATION.md`
- `docs/SALES_SCORECARD_SUMMARY_TABLE_SPECIFICATION.md`
- `docs/TTS_SALES_SCORECARD_STATUS.md`
- `src/hooks/useSalesScorecardData.ts` (reference for data fetching pattern)

---

## Notes

- The main cohi repo (`C:\Users\MPetrovic\Documents\Cohi\cohi`) contains the backend
- The cohi-merge-12426 repo contains the updated frontend with SalesTrends.tsx
- Both repos may need changes depending on how the backend is structured
