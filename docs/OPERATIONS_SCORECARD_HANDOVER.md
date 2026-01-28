# Operations Scorecard Implementation Handover

## Overview

The Operations Scorecard page (`src/pages/OperationScorecard.tsx`) displays performance metrics for operations staff (Processors, Underwriters, Closers) with tier-based groupings. **Currently uses 100% mock data** in `OperationsScorecardView.tsx`. This task is to connect it to real data from the database following the patterns established in Sales Scorecard and Sales Trends implementations.

---

## Current State

### Page Structure
- **Main Page**: `src/pages/OperationScorecard.tsx` (wrapper with Navigation, filters)
- **View Component**: `src/components/dashboard/views/OperationsScorecardView.tsx` (~1,559 lines)

### Current UI Components (all using mock data)
1. **Actor Selector**: Toggle between Processor / Underwriter / Closer
2. **Date Range Selector**: 3-months / 6-months / 12-months
3. **View Tabs**: Summary / Detail / Charts
4. **Summary Table**: Tier-based metrics (Top Tier, Second Tier, Bottom Tier, Totals)
5. **Detail Table**: Individual actor rows with all metrics
6. **Comparison Toggle**: Show period-over-period changes
7. **Drilldown Modal**: Click on tier/metric for detailed breakdown
8. **Fullscreen Mode**: Expand table view

### Mock Data Interfaces (from OperationsScorecardView.tsx)

```typescript
interface ScorecardData {
  underwriterCount: number;      // Actor count in tier
  unitsOutput: number;           // Loans processed
  unitsPercent: number;          // % of total units
  volumeOutput: number;          // $ loan volume
  loanComplexityScore: number;   // Composite complexity score
  avgUnitsPerMonth: number;      // Monthly average output
  avgDays: number;               // Turn time (processing days)
  compensation: string;          // '$' - not currently available
  costPerFile: string;           // '$' - not currently available
  approvedPercent: number;       // UW approval rate
  deniedPercent: number;         // UW denial rate
  governmentPercent: number;     // % govt loans
  purchasePercent: number;       // % purchase vs refi
  waFico: number;                // Weighted avg FICO
  waLtv: number;                 // Weighted avg LTV
}

interface TierData {
  totals: ScorecardData;
  topTier: ScorecardData;
  secondTier: ScorecardData;
  bottomTier: ScorecardData;
}
```

---

## Qlik Reference

### Qlik Sheets (Performance App)
- **Operation Scorecard**: Sheet ID `3c65849c-a82a-4180-85b3-febe540f3e81`
- **Operation Scorecard Trends**: Sheet ID `1b7e60bb-c475-4922-a4f8-2c9c4b89fbb5`

### Key Qlik Visualizations
- `vOpsScorecardActor Output Scorecard Summary` - Pivot table (ID: `f70ad8f0-fc9e-4fe8-8a76-c2af0175041e`)
- `vOpsScorecardActor Output Scorecard` - Detail table (ID: `a50b485b-0cc4-4ffa-8a40-6e2e3edea613`)
- `Operation Scorecard: Chart Container` (ID: `fbauUhG`)
- `Choose Scorecard Actor` - Actor selector
- `Choose Short Term Comparison Date Range` - Date selector

### Key Qlik Variables
| Variable | Description |
|----------|-------------|
| `vOpsScorecardActor` | Current actor type: 'Processor', 'Underwriter', or 'Closer' |
| `vOpsScorecardMonthRange` | Number of months to include |
| `vScorecardUnitsAverage` | Average units per actor |
| `vScorecardTurnTimeAverage` | Average turn time calculation |
| `vScorecardVolumeAverage` | Average volume per actor |
| `vCurrentProductionOps` | Production flag for ops filtering |

### Actor-Specific Date Fields
| Actor | Output Date Field | Turn Time Calculation |
|-------|-------------------|----------------------|
| Processor | `Sent To Underwriting` | `Sent To Underwriting - Sent To Processing` |
| Underwriter | `Sent To Closing` | `Sent To Closing - Sent To Underwriting` |
| Closer | `End Date to indicate Loan Closed/Funded` | `Closing Date - Sent To Closing` |

### Qlik Documentation Files
- `QlikAppsAndLogicDictionaryDocs/Performance/QSDA-[1.7.0] Performance - Homestead-*/Variables.csv` - Contains scorecard variable definitions
- `QlikAppsAndLogicDictionaryDocs/Performance/QSDA-[1.7.0] Performance - Homestead-*/Expressions.csv` - Expression formulas
- `QlikAppsAndLogicDictionaryDocs/tvd-coheus-operations-qlik/` - Operations-specific Qlik app scripts

---

## Implementation Plan

### Phase 1: Create Specification Document
Create `docs/OPERATIONS_SCORECARD_SPECIFICATION.md` with:
- All metric definitions and Qlik formulas
- Database field mappings
- Tier assignment logic (TopTiering for Ops)
- Turn time calculations per actor type
- Testing checklist

### Phase 2: Backend API
Create `/api/loans/operations-scorecard` endpoint in `server/src/routes/loans.ts`:

**Query Parameters:**
- `actor_type`: 'processor' | 'underwriter' | 'closer'
- `date_range`: '3-months' | '6-months' | '12-months'
- `channel_group`: Channel filter

**Response Structure:**
```typescript
{
  actors: OperationsActor[];      // Individual actor data
  tierSummary: {
    top: TierMetrics;
    second: TierMetrics;
    bottom: TierMetrics;
  };
  totals: TierMetrics;
  companyAverages: CompanyAverages;
  dateRange: { start: string; end: string };
}
```

### Phase 3: Frontend Hook
Create `src/hooks/useOperationsScorecardData.ts` following the pattern from:
- `src/hooks/useSalesScorecardData.ts`
- `src/hooks/useSalesTrendsData.ts`

### Phase 4: Frontend Integration
Update `OperationsScorecardView.tsx`:
- Import and use the hook
- Replace mock data with API data
- Add loading/error states
- Wire up actor selector and date range to API

### Phase 5: Testing
- Compare each metric against Qlik Operations Scorecard
- Verify tier assignments match
- Test all three actor types
- Document discrepancies

---

## Key Metrics to Implement

| Metric | Qlik Field/Expression | Database Implementation |
|--------|----------------------|------------------------|
| Units Output | Count of loans by actor-specific date | COUNT loans WHERE [actor_date] in range |
| Volume Output | SUM loan_amount | SUM(loan_amount) |
| Avg Units/Month | `vScorecardUnitsAverage` | units / months_in_period / actor_count |
| Avg Days (Turn Time) | Actor-specific calculation | AVG(output_date - input_date) |
| Approved % | Approved / Total decisions | COUNT(status='Approved') / COUNT(*) |
| Denied % | Denied / Total decisions | COUNT(status='Denied') / COUNT(*) |
| Government % | Govt loans / Total | COUNT(loan_type IN ('FHA','VA','USDA')) / COUNT(*) |
| Purchase % | Purchase / Total | COUNT(loan_purpose='Purchase') / COUNT(*) |
| WA FICO | Weighted avg credit score | SUM(fico * loan_amount) / SUM(loan_amount) |
| WA LTV | Weighted avg LTV | SUM(ltv * loan_amount) / SUM(loan_amount) |
| Loan Complexity | Composite score | See TTS complexity formula |

---

## Database Fields Required

| Field | Encompass ID | Usage |
|-------|--------------|-------|
| `processor` | Fields.362 | Processor name |
| `underwriter` | Fields.VEND.X263 or similar | Underwriter name |
| `closer` | Various | Closer name |
| `sent_to_processing` | Milestone date | Processor input |
| `sent_to_underwriting` | Fields.2986 | Processor output / UW input |
| `sent_to_closing` | Milestone date | UW output / Closer input |
| `closing_date` | Fields.748 | Closer output |
| `loan_amount` | Fields.2 | Volume calculation |
| `loan_type` | Fields.1172 | Government % |
| `loan_purpose` | Fields.19 | Purchase % |
| `credit_score` | Fields.MORNET.X23 | FICO |
| `ltv` | Fields.353 | LTV |
| `current_loan_status` | Fields.1393 | Approval/Denial |

---

## Reference Implementations

### Backend Pattern
See `/api/loans/sales-scorecard` endpoint in `server/src/routes/loans.ts` (line ~2060):
- Date range calculation
- Actor aggregation
- TTS tier assignment
- Company averages calculation

### Frontend Pattern
See `src/hooks/useSalesScorecardData.ts`:
- TypeScript interfaces
- API request pattern (`api.request<T>(url)`)
- Loading/error state management

---

## Differences from Sales Scorecard

| Aspect | Sales Scorecard | Operations Scorecard |
|--------|-----------------|---------------------|
| Actor Types | Branch / Loan Officer | Processor / Underwriter / Closer |
| Output Date | Funding Date | Actor-specific milestone date |
| Turn Time | App to Close | Actor-specific (UW: Sent to UW → Sent to Closing) |
| Approval/Denial | Not shown | Key metrics for Underwriters |
| TTS Weights | Sales-specific | Operations-specific (different formula) |

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `docs/OPERATIONS_SCORECARD_SPECIFICATION.md` | Create - Full spec |
| `server/src/routes/loans.ts` | Add `/api/loans/operations-scorecard` |
| `src/hooks/useOperationsScorecardData.ts` | Create - Data hook |
| `src/components/dashboard/views/OperationsScorecardView.tsx` | Modify - Replace mock data |

---

## Testing Checklist

- [ ] Processor scorecard matches Qlik
- [ ] Underwriter scorecard matches Qlik
- [ ] Closer scorecard matches Qlik
- [ ] Tier assignments are correct
- [ ] Turn times calculate correctly per actor
- [ ] Date range filtering works
- [ ] Channel filtering works
- [ ] Comparison period shows correct changes
- [ ] Detail table shows individual actors
- [ ] Drilldown modal loads correct data

---

## Notes

1. **Compensation and Cost Per File** are shown as '-' in mock data because this data is typically not available in loan data - may need separate HR/payroll integration
2. **Actor Missing Filter** - Qlik uses `[$(vOpsScorecardActor) Missing] *= {0}` to exclude missing actors (e.g., '99-Missing')
3. **Production Flag** - `[$(vOpsScorecardActor)_Production] *= {$(vCurrentProductionOps)}` filters for active production loans

---

## Getting Started

1. Read through the current `OperationsScorecardView.tsx` to understand all UI requirements
2. Search Qlik Expressions.csv and Variables.csv for `OpsScorecardActor` and `Scorecard` patterns
3. Review the `/api/loans/sales-scorecard` implementation as the primary pattern to follow
4. Create the specification document first before implementing
5. Test each actor type separately against Qlik
