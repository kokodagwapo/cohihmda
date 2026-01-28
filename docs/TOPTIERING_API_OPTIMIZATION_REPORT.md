# TopTiering API Optimization Report

## Executive Summary

This report analyzes all TopTiering-related pages and their backend API endpoints in `server/src/routes/loans.ts`. The file has grown to **5,700+ lines** with significant code duplication, redundant helper functions, and opportunities for consolidation.

**Key Finding**: The existing `metricsService.ts` (1,700 lines) provides a centralized metrics library that the TopTiering endpoints do NOT currently utilize. Significant optimization is possible by refactoring to use this service.

---

## Current Architecture Overview

### TopTiering-Related Pages (6 Total)

| Page | Component | Data Hook | API Endpoint | Lines in loans.ts |
|------|-----------|-----------|--------------|-------------------|
| **Sales Scorecard** | `SalesScorecard.tsx` | `useSalesScorecardData.ts` | `/sales-scorecard` | ~1,450 lines (2060-3509) |
| **Operations Scorecard** | `OperationScorecard.tsx` | `useOperationsScorecardData.ts` | `/operations-scorecard` | ~610 lines (3510-4119) |
| **Operations Scorecard Trends** | `OperationScorecardTrends.tsx` | `useOperationsScorecardTrendsData.ts` | `/operations-scorecard-trends` | ~630 lines (4120-4749) |
| **Sales Trends** | `SalesTrends.tsx` | `useSalesTrendsData.ts` | `/sales-trends` | ~370 lines (4750-5120) |
| **Sales Trends Drilldown** | - | - | `/sales-trends/drilldown/:loName` | ~205 lines (5121-5325) |
| **TopTiering** (legacy) | `TopTieringComparison.tsx` | `useTopTieringData.ts` | `/toptiering` | ~455 lines (1606-2058) |
| **TopTiering Comparison** | `TopTieringComparison.tsx` | `useTopTieringComparisonData.ts` | `/toptiering-comparison` | ~390 lines (5326-5719) |

**Total TopTiering-related code in loans.ts: ~4,110 lines (72% of the 5,700 line file)**

---

## Identified Redundancies

### 1. `isActorMissing()` Helper Function (4 Duplications)

The same helper function is defined **4 times** inside different endpoints, with **inconsistent logic**:

```typescript
// Version 1 (Sales Scorecard - most comprehensive)
// Lines 2082-2092
const isActorMissing = (name: string | null | undefined): boolean => {
  if (!name || name.trim() === '') return true;
  const normalizedName = name.toUpperCase().trim();
  return normalizedName === '99-MISSING' || 
         normalizedName === 'MISSING' ||
         normalizedName === 'NO LO FOUND' ||
         normalizedName === 'NO LOAN OFFICER' ||
         normalizedName === 'NO BRANCH FOUND' ||
         normalizedName === 'UNKNOWN' ||
         normalizedName.startsWith('99-');
};

// Version 2 (Operations Scorecard / Trends - simpler)
// Lines 3571-3575, 4178-4182
const isActorMissing = (name: string | null | undefined): boolean => {
  if (!name || name.trim() === '') return true;
  return name.trim().toLowerCase() === '99-missing';  // Only checks '99-Missing'
};

// Version 3 (TopTiering Comparison - same as Version 1)
// Lines 5347-5357
```

**Issue**: Different endpoints use different definitions, potentially causing data inconsistencies.

---

### 2. `vMaxDate` Calculation (5 Duplications)

Each endpoint independently calculates the maximum date from the data:

```typescript
// Pattern 1: Uses last_modified_date with fallbacks
const maxDateResult = await tenantPool.query(`
  SELECT 
    MAX(COALESCE(last_modified_date, funding_date, application_date, created_at)) as max_date
  FROM public.loans
`);

// Pattern 2: Checks for last_modified_date separately
const lastModifiedResult = await tenantPool.query(`
  SELECT MAX(last_modified_date) as max_last_modified FROM public.loans 
  WHERE last_modified_date IS NOT NULL
`);

// Pattern 3: Uses funding_date only
const maxDateResult = await tenantPool.query(`
  SELECT MAX(funding_date) as max_date FROM public.loans WHERE funding_date IS NOT NULL
`);
```

**Issue**: 5 separate database queries for essentially the same calculation with inconsistent logic.

---

### 3. `ActorConfig` Interface (3 Duplications)

The same interface is defined inside each operations endpoint:

```typescript
// Defined at lines: 3530-3535, 4142-4147
interface ActorConfig {
  actorColumn: string;
  outputDateField: string;
  turnTimeStartField: string;
  turnTimeEndField: string;
}

const actorConfigs: Record<string, ActorConfig> = {
  processor: { actorColumn: 'processor', outputDateField: 'approval_date', ... },
  underwriter: { actorColumn: 'underwriter', outputDateField: 'closing_date', ... },
  closer: { actorColumn: 'closer', outputDateField: 'disbursement_date', ... }
};
```

**Issue**: Identical configuration defined 3 times.

---

### 4. Channel Filtering Logic (4 Duplications)

Channel filtering is implemented separately in each endpoint with slight variations:

```typescript
// Pattern 1: Using ILIKE in SQL
if (channelGroup === 'Retail') {
  whereClause += ` AND (channel ILIKE '%retail%' OR channel ILIKE '%brokered%')`;
}

// Pattern 2: JavaScript filtering post-query
const channelFilteredLoans = allLoans.filter((l: any) => {
  const channel = (l.channel || '').toLowerCase();
  if (channelGroup === 'Retail') {
    return channel.includes('retail') || channel.includes('brok');
  }
  // ...
});
```

**Issue**: Inconsistent filtering logic and inefficient post-query filtering in some cases.

---

### 5. TTS Score Calculation Logic (Multiple Duplications)

TTS score calculation follows similar patterns but is implemented separately:

```typescript
// Operations Scorecard (TVI Score thresholds)
if (ttsScore >= 120) tier = 'top';
else if (ttsScore >= 80) tier = 'second';
else tier = 'bottom';

// Sales Scorecard (same logic, different context)
// TopTiering Comparison (Pareto-based, different approach)
```

---

### 6. Revenue Calculation (Multiple Duplications)

Revenue calculation (`calcLoanRevenue`) is duplicated:

```typescript
// Pattern: Base Buy + Orig Fees - Lender Credits
const calcLoanRevenue = (l: any): number => {
  const baseBuy = l.rate_lock_buy_side_base_price_rate 
    ? ((l.rate_lock_buy_side_base_price_rate - 100) / 100) * l.loan_amount
    : 0;
  const origFees = (l.orig_fee_borr_pd || 0) + (l.orig_fees_seller || 0);
  const lenderCredits = l.cd_lender_credits || 0;
  return baseBuy + origFees - lenderCredits;
};
```

**Note**: This is already defined in `metricsService.ts` as the `total_revenue` metric but not used.

---

### 7. Date Range Calculation (Multiple Duplications)

Each endpoint independently calculates date ranges:

```typescript
// Rolling months calculation (Operations)
const effectiveStartDate = new Date(vMaxDate.getFullYear(), vMaxDate.getMonth() - monthsBack + 1, 1);

// Period-based calculation (TopTiering Comparison)
switch (dateRange) {
  case 'last-year':
    effectiveStartDate = new Date(vMaxDate.getFullYear() - 1, 0, 1);
    // ...
}

// 13-month rolling (Sales Scorecard)
const effectiveStartDate = new Date(vMaxDate.getFullYear(), vMaxDate.getMonth() - 13 + 1, 1);
```

---

## Performance Issues

### 1. Large SQL Queries Without Optimization

Each endpoint fetches **all loans** and filters in JavaScript:

```typescript
// Example from /toptiering (line 1651-1663)
const allLoansResult = await pool.query(
  `SELECT loan_id, loan_amount, loan_type, current_loan_status, channel,
          funding_date, closing_date, application_date, started_date, ...
   FROM public.loans WHERE tenant_id = $1`,
  [tenantId]
);
// Then filters in JavaScript - INEFFICIENT for large datasets
```

**Impact**: For a tenant with 50,000+ loans, this is very inefficient.

### 2. Multiple Database Round-Trips

Some endpoints make 3-5 separate queries when one would suffice:

```typescript
// Pattern in /operations-scorecard-trends
// Query 1: Get max funding_date
// Query 2: Get max updated_at  
// Query 3: Check for last_modified_date
// Query 4: Fetch all loans
// Query 5: (sometimes) Get additional metadata
```

### 3. No Database Indexing Awareness

Queries don't optimize for existing indexes on date columns.

---

## Underutilized: metricsService.ts

The `metricsService.ts` file (1,700 lines) provides a centralized metrics catalog with:

- **56 pre-defined metrics** (active_loans, closed_loans, total_revenue, wa_fico, etc.)
- **Built-in date range filtering** with proper NULL handling
- **Channel/actor filtering utilities**
- **Grouped metric queries** (by loan_officer, branch, etc.)

**Current Usage**: Only used by `/company-overview` and `/diagnostic` endpoints.

**NOT Used By**: Any of the 7 TopTiering endpoints.

### Example of What metricsService Provides

```typescript
// Already available in metricsService.ts
const metrics = await queryMetrics(tenantPool, [
  'total_units',
  'total_volume', 
  'total_revenue',
  'wa_fico',
  'wa_ltv',
  'avg_cycle_time'
], {
  dateRange: { start: '2025-01-01', end: '2026-01-22' },
  additionalFilters: { consolidated_channel: 'Retail' }
});
```

---

## Recommended Optimizations

### Phase 1: Extract Common Utilities (Low Risk)

Create a new file `server/src/utils/scorecard-utils.ts`:

```typescript
// Consolidated helper functions
export const isActorMissing = (name: string | null | undefined, strict: boolean = false): boolean => { ... };
export const getVMaxDate = async (pool: Pool): Promise<Date> => { ... };
export const calculateDateRange = (vMaxDate: Date, rangeType: string): { start: Date, end: Date } => { ... };
export const filterByChannel = (channel: string, channelGroup: string): boolean => { ... };
export const calcLoanRevenue = (loan: LoanRow): number => { ... };

// Shared interfaces
export interface ActorConfig {
  actorColumn: string;
  outputDateField: string;
  turnTimeStartField: string;
  turnTimeEndField: string;
}

export const OPERATIONS_ACTOR_CONFIGS: Record<string, ActorConfig> = {
  processor: { ... },
  underwriter: { ... },
  closer: { ... }
};

export const SALES_ACTOR_CONFIGS: Record<string, ActorConfig> = {
  branch: { ... },
  loan_officer: { ... }
};
```

**Estimated Impact**: Reduce `loans.ts` by ~500 lines, improve consistency.

---

### Phase 2: Refactor to Use metricsService (Medium Risk)

Extend `metricsService.ts` with scorecard-specific metrics:

```typescript
// Add to METRICS_CATALOG
'ops_units_by_actor': {
  id: 'ops_units_by_actor',
  name: 'Operations Units by Actor',
  sqlQuery: `COUNT(DISTINCT loan_number)`,
  groupBy: ['processor', 'underwriter', 'closer']
},
'tts_score': {
  id: 'tts_score',
  name: 'TTS Score',
  formula: '(UnitRating × 0.70 + TurnTimeRating × 0.15 + ComplexityRating × 0.15)',
  // Complex calculation referencing other metrics
}
```

**Estimated Impact**: Reduce TopTiering endpoint code by 60%, improve maintainability.

---

### Phase 3: Consolidate Similar Endpoints (Higher Risk)

Combine similar endpoints into parameterized versions:

| Current Endpoints | Consolidated Endpoint |
|-------------------|----------------------|
| `/operations-scorecard` | `/scorecard?type=operations&actor=underwriter` |
| `/operations-scorecard-trends` | |
| `/sales-scorecard` | `/scorecard?type=sales&actor=loan_officer` |
| `/toptiering` | `/toptiering?view=standard` |
| `/toptiering-comparison` | `/toptiering?view=comparison` |

**Estimated Impact**: Reduce from 7 endpoints to 2-3, with shared logic.

---

### Phase 4: Database Query Optimization

1. **Add composite indexes** for common query patterns:
   ```sql
   CREATE INDEX idx_loans_scorecard ON loans(tenant_id, funding_date, channel, loan_officer);
   CREATE INDEX idx_loans_ops ON loans(tenant_id, approval_date, closing_date, disbursement_date);
   ```

2. **Use SQL aggregation instead of JavaScript**:
   ```sql
   SELECT 
     loan_officer,
     COUNT(*) as units,
     SUM(loan_amount) as volume,
     AVG(DATE(closing_date) - DATE(application_date)) as avg_turn_time
   FROM loans
   WHERE funding_date BETWEEN $1 AND $2
   GROUP BY loan_officer
   ```

3. **Cache vMaxDate** at application level (refreshed every 5 minutes).

---

## Impact Summary

| Optimization | Lines Saved | Queries Reduced | Complexity |
|--------------|-------------|-----------------|------------|
| Extract utilities | ~500 | 0 | Low |
| Use metricsService | ~2,000 | ~25 | Medium |
| Consolidate endpoints | ~1,000 | ~10 | High |
| Database optimization | 0 | ~15 | Medium |
| **Total** | **~3,500** | **~50** | - |

**Result**: `loans.ts` could be reduced from 5,700 lines to ~2,200 lines with significantly improved consistency and performance.

---

## Files to Modify

| File | Action |
|------|--------|
| `server/src/routes/loans.ts` | Major refactoring |
| `server/src/services/metrics/metricsService.ts` | Add scorecard metrics |
| `server/src/utils/scorecard-utils.ts` | **NEW** - shared utilities |
| `server/src/config/tenantDatabaseSchema.ts` | Add indexes |
| `src/hooks/use*ScorecardData.ts` | Minor updates to match new API |

---

## Risk Assessment

| Phase | Risk Level | Rollback Difficulty | Testing Required |
|-------|------------|---------------------|------------------|
| Phase 1 (Utilities) | Low | Easy | Unit tests |
| Phase 2 (metricsService) | Medium | Moderate | Integration tests + Qlik comparison |
| Phase 3 (Consolidation) | High | Difficult | Full regression + frontend updates |
| Phase 4 (Database) | Low | Easy | Performance testing |

---

## Recommended Implementation Order

1. **Start with Phase 1** - Extract utilities, no API changes
2. **Add Phase 4** - Database optimizations, independent improvement  
3. **Implement Phase 2** - Refactor incrementally, one endpoint at a time
4. **Consider Phase 3** - Only if maintenance burden justifies the risk

---

## Appendix: Full Endpoint Analysis

### /sales-scorecard (Lines 2060-3509)

**Purpose**: TTS scoring for branch/loan_officer with 6-component rating
**Key Calculations**: Volume, Margin, Unit, PullThrough, TurnTime, Concession ratings
**Database Queries**: 3 (vMaxDate, all loans, branch info)
**Redundant Code**: isActorMissing, calcLoanRevenue, date range logic

### /operations-scorecard (Lines 3510-4119)

**Purpose**: TTS scoring for processor/underwriter/closer with 3-component rating
**Key Calculations**: Unit, TurnTime, Complexity ratings
**Database Queries**: 2 (vMaxDate, loans by output date)
**Redundant Code**: isActorMissing, ActorConfig, tier thresholds

### /operations-scorecard-trends (Lines 4120-4749)

**Purpose**: Monthly trends for operations scorecard
**Key Calculations**: Same as /operations-scorecard, grouped by month
**Database Queries**: 4 (max funding, max updated, last_modified, loans)
**Redundant Code**: Same as /operations-scorecard (nearly identical)

### /sales-trends (Lines 4750-5120)

**Purpose**: Monthly trends for sales scorecard
**Key Calculations**: Units, volume, revenue by month for loan officers
**Database Queries**: 2 (vMaxDate, loans in range)
**Redundant Code**: calcLoanRevenue, date range logic

### /toptiering (Lines 1606-2058)

**Purpose**: Legacy endpoint for basic TopTiering data
**Note**: Uses different auth pattern (gets tenant_id from profile)
**Database Queries**: 1 (fetches ALL loans, filters in JavaScript)
**Redundant Code**: Channel filtering, revenue calculation

### /toptiering-comparison (Lines 5326-5719)

**Purpose**: Pareto-based TopTiering comparison view
**Key Calculations**: Cumulative revenue percentage for tier assignment
**Database Queries**: 2 (vMaxDate, loans with revenue)
**Redundant Code**: isActorMissing, channel filtering, date range calculation

---

## Conclusion

The TopTiering API suite has grown organically with significant code duplication. A phased refactoring approach starting with utility extraction and leveraging the existing `metricsService.ts` can reduce the codebase by ~60% while improving consistency, maintainability, and performance.

**Recommended Next Step**: Begin with Phase 1 (utility extraction) as it carries the lowest risk and provides immediate benefits without API changes.
