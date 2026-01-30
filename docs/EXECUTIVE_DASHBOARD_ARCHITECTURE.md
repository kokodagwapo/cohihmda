# Executive Dashboard (Business Overview) Architecture

This document provides a comprehensive review of the Executive Dashboard component, including frontend logic, backend API integration, and data flow.

## Overview

The ExecutiveDashboard (`src/components/dashboard/ExecutiveDashboard.tsx`) displays 6 key performance indicator (KPI) cards with drill-down modals for detailed breakdowns. It's a core business intelligence component that provides executives with at-a-glance metrics.

---

## Component Structure

```
ExecutiveDashboard
├── 6 KPI Cards (responsive grid layout)
│   ├── Active Loans (current state - no date filter)
│   ├── Closed Loans (filterable by timeframe)
│   ├── Locked Loans (filterable by timeframe)
│   ├── Cycle Time (filterable by timeframe)
│   ├── Pull-Through Rate (default: rolling 90 days)
│   └── Credit Pulls (filterable by timeframe)
└── Detail Modals (on card click)
    ├── Summary metrics row
    └── Breakdown tables (by loan type, purpose, stage, etc.)
```

---

## Frontend Logic

### Key Files

| File | Purpose |
|------|---------|
| `src/components/dashboard/ExecutiveDashboard.tsx` | Main component |
| `src/hooks/useMetrics.ts` | API hook for metrics queries |
| `src/utils/closingFalloutFilters.ts` | Period-to-date range conversion |
| `src/components/dashboard/BusinessDataTable.tsx` | Table component for modal breakdowns |

### State Management

| State | Type | Purpose |
|-------|------|---------|
| `kpiTimeframes` | `Record<string, PeriodValue>` | Per-KPI timeframe selection |
| `kpiCustomDates` | `Record<string, { start, end }>` | Custom date ranges per KPI |
| `metricsData` | `Record<string, any>` | Fetched metrics from API |
| `loadingKpis` | `Set<string>` | Set of currently loading KPI IDs |
| `animatedValues` | `Record<string, number>` | For count-up animation effect |
| `selectedCard` | `string \| null` | Which card's detail modal is open |
| `openDropdown` | `string \| null` | Which KPI's timeframe dropdown is open |

### Period Options

Each KPI (except Active Loans) has its own timeframe selector:

```typescript
const PERIOD_OPTIONS = [
  { value: 'mtd', label: 'Month to Date', shortLabel: 'MTD' },
  { value: 'ytd', label: 'Year to Date', shortLabel: 'YTD' },
  { value: 'last_month', label: 'Last Month', shortLabel: 'Last Mo' },
  { value: 'last_year', label: 'Last Year', shortLabel: 'Last Yr' },
  { value: 'all', label: 'All Time', shortLabel: 'All' },
  { value: 'custom', label: 'Custom Range', shortLabel: 'Custom' },
];
```

### KPI to Metric Mapping

```typescript
const KPI_METRICS: Record<string, { primary: string; volume?: string }> = {
  activeLoans: { primary: 'active_loans', volume: 'active_volume' },
  closedLoans: { primary: 'closed_loans', volume: 'closed_volume' },
  lockedLoans: { primary: 'locked_loans', volume: 'locked_volume' },
  cycleTime: { primary: 'avg_cycle_time' },
  pullThrough: { primary: 'pull_through_rate' },
  creditPulls: { primary: 'credit_pulls' },
};
```

### Special Behaviors

| KPI | Special Behavior |
|-----|------------------|
| **Active Loans** | Always shows current state (no date filter applied) |
| **Pull-Through** | Defaults to `rolling_90_days` (industry standard for 30-45 day loan cycles) |
| **All others** | Default to `mtd` (Month-to-Date) |

### Data Fetching Flow

```typescript
// 1. On mount or tenant/year change
useEffect(() => {
  fetchKpiMetrics('activeLoans', 'all');  // Current state
  Object.entries(kpiTimeframes).forEach(([kpiId, period]) => {
    fetchKpiMetrics(kpiId, period);
  });
}, [selectedTenantId, year]);

// 2. fetchKpiMetrics calls useMetrics hook
const fetchKpiMetrics = async (kpiId, period, customDates?) => {
  const metricsToFetch = [kpiConfig.primary, kpiConfig.volume]; // e.g., ['active_loans', 'active_volume']
  const results = await queryMetrics(metricsToFetch, period);
  setMetricsData(prev => ({ ...prev, ...results }));
};

// 3. Display values calculated via useMemo
const metrics = useMemo(() => {
  const activeLoans = metricsData.active_loans?.value || 0;
  // ... transform and format for display
}, [metricsData]);
```

### Animation System

The component includes a count-up animation when values change:

```typescript
// Staggered animation for each card
const animationDuration = 1500; // 1.5 seconds per card
const staggerDelay = 200; // 200ms between cards

kpiCards.forEach((card, index) => {
  setTimeout(() => {
    // Animate from 0 to target value with ease-out
  }, index * staggerDelay);
});
```

---

## Backend API Logic

### useMetrics Hook

Located at `src/hooks/useMetrics.ts`, provides three query methods:

```typescript
// Single metric query
queryMetric(metricId: string, period: PeriodValue): Promise<MetricResult>

// Multiple metrics query (batch)
queryMetrics(metricIds: string[], period: PeriodValue): Promise<Record<string, MetricResult>>

// Custom date range query
queryMetricsWithDateRange(metricIds: string[], startDate: Date, endDate: Date): Promise<Record<string, MetricResult>>
```

### API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/metrics/catalog` | GET | List all available metrics with definitions |
| `/api/metrics/:metricId` | GET | Query a single metric |
| `/api/metrics/query` | POST | Query multiple metrics in batch |
| `/api/metrics/category/:category` | GET | All metrics in a category |

### Metrics Route (`server/src/routes/metrics.ts`)

```typescript
// POST /api/metrics/query - Main endpoint used by ExecutiveDashboard
router.post('/query', authenticateToken, attachTenantContext, async (req, res) => {
  const { metricIds, dateRange, dateField, groupBy, additionalFilters } = req.body;
  const tenantPool = getTenantContext(req).tenantPool;
  
  const results = await queryMetrics(tenantPool, metricIds, {
    dateRange,
    dateField,
    additionalFilters
  });
  
  res.json({ metrics: results });
});
```

### Metrics Service (`server/src/services/metrics/metricsService.ts`)

Uses a **Metrics Catalog** pattern based on Qlik Logic Dictionary formulas:

```typescript
export const METRICS_CATALOG: Record<string, MetricDefinition> = {
  'active_loans': {
    id: 'active_loans',
    name: 'Active Loans',
    description: 'Count of loans with Active Loan Flag = Yes (current state)',
    category: 'status',
    formula: 'Count({<[Active Loan Flag]={Yes}>}[Loan Number])',  // Qlik formula reference
    sqlQuery: `COUNT(CASE 
      WHEN l.current_loan_status = 'Active Loan' 
      AND l.application_date IS NOT NULL 
      THEN 1 
    END)`,
    ignoreDateFilter: true  // Current state metric
  },
  
  'closed_loans': {
    id: 'closed_loans',
    name: 'Closed Loans',
    description: 'Count of loans with Funded Flag = Yes',
    category: 'status',
    formula: 'Count({<[Funded Flag]={Yes}>}[Loan Number])',
    sqlQuery: `COUNT(CASE WHEN l.funding_date IS NOT NULL THEN 1 END)`,
    defaultDateField: 'funding_date'
  },
  
  'avg_cycle_time': {
    id: 'avg_cycle_time',
    name: 'Average Cycle Time',
    description: 'Average App-Close turn time (days)',
    category: 'turn_time',
    formula: 'Avg([App-Close])',
    sqlQuery: `AVG(CASE 
      WHEN l.closing_date IS NOT NULL AND l.application_date IS NOT NULL 
      THEN DATE(l.closing_date) - DATE(l.application_date) 
    END)`,
    defaultDateField: 'closing_date'
  },
  
  'pull_through_rate': {
    id: 'pull_through_rate',
    name: 'Pull-Through Rate',
    description: 'Percentage of applications that funded/closed',
    category: 'pull_through',
    formula: 'Count(Funded) / Count(Applications) * 100',
    sqlQuery: `COUNT(funded) / NULLIF(COUNT(applications), 0) * 100`
  },
  // ... more metrics
};
```

### Date Range Handling

```typescript
// Dates passed as strings (YYYY-MM-DD) to avoid timezone issues
const parsedDateRange: DateRange = {
  start: dateRange.start || null,  // e.g., "2026-01-01"
  end: dateRange.end || null       // e.g., "2026-01-27"
};

// SQL applies date filter based on metric's defaultDateField
WHERE ${dateField} >= '${dateRange.start}' AND ${dateField} <= '${dateRange.end}'
```

### Tenant Context

The metrics API uses tenant context middleware for multi-tenant isolation:

```typescript
router.post('/query', authenticateToken, attachTenantContext, async (req, res) => {
  const tenantPool = getTenantContext(req).tenantPool;
  // All queries run against tenant's isolated database
});
```

---

## Data Flow Diagram

```
┌─────────────────────────┐
│   ExecutiveDashboard    │
│   (React Component)     │
└───────────┬─────────────┘
            │ fetchKpiMetrics()
            ▼
┌─────────────────────────┐
│      useMetrics         │
│      (React Hook)       │
└───────────┬─────────────┘
            │ POST /api/metrics/query
            │ Body: { metricIds, dateRange }
            ▼
┌─────────────────────────┐
│    metrics.ts Routes    │
│    (Express Router)     │
│  - authenticateToken    │
│  - attachTenantContext  │
└───────────┬─────────────┘
            │ queryMetrics(tenantPool, metricIds, options)
            ▼
┌─────────────────────────┐
│   metricsService.ts     │
│   (Metrics Catalog)     │
│  - METRICS_CATALOG      │
│  - SQL query builder    │
└───────────┬─────────────┘
            │ SQL Query with date filters
            ▼
┌─────────────────────────┐
│    Tenant Database      │
│    (loans table)        │
└─────────────────────────┘
```

---

## Modal Breakdown Data

When a user clicks a KPI card, a detailed modal appears with breakdowns. The data is currently calculated client-side:

### Active/Closed/Locked Loans Modal

- **Summary**: Units, $ Volume, Avg Rate, Avg Balance, FICO, LTV
- **By Loan Type**: Conventional, FHA, VA, USDA, Jumbo
- **By Loan Purpose**: Purchase, Refinance
- **By Loan Size**: Jumbo, Conforming Balance
- **By Stage** (Active only): Locked, Submitted to UW, Approved, CTC

### Cycle Time Modal

- **By Stage**: App to Lock, Lock to UW, UW to Approval, etc.
- **By Loan Type**: Breakdown per loan type with trend indicators

### Pull-Through Modal

- **By Loan Type**: Rate per type vs company average
- **Fallout Breakdown**: Withdrawn vs Denied percentages

### Credit Pulls Modal

- **By Loan Type**: MTD vs Last Month comparison
- **By Loan Purpose**: MTD vs Last Month comparison

---

## Known Limitations

### 1. Estimated Change Percentages

The component estimates previous period values using hardcoded multipliers:

```typescript
// Current implementation (estimated)
const activeLoansPrev = Math.round(activeLoans * 0.88);
const activeLoansChange = ((activeLoans - activeLoansPrev) / activeLoansPrev * 100);

// TODO: Should fetch actual previous period data
```

### 2. Hardcoded Breakdown Distributions

Modal breakdowns use estimated distributions rather than actual data:

```typescript
// Current implementation (hardcoded)
const loanTypeDistribution = {
  'Conventional': 0.60,
  'FHA': 0.25,
  'VA': 0.10,
  'USDA': 0.03,
  'Jumbo': 0.02
};

// TODO: Should query actual grouped metrics
```

### 3. Missing Fallout Metrics

Withdrawn/Denied loan counts are placeholders:

```typescript
const withdrawnUnits = 0; // TODO: Add withdrawn loans metric
const deniedUnits = 0;    // TODO: Add denied loans metric
```

### 4. No Grouped Query for Breakdowns

The API supports `groupBy` parameter but the component doesn't use it:

```typescript
// Available but unused
POST /api/metrics/query
{ 
  metricIds: ['total_units', 'total_volume'],
  groupBy: 'loan_type'  // Would return breakdown by loan type
}
```

---

## Recommendations for Future Improvements

### 1. Add Period Comparison Endpoint

Create an API that returns current vs previous period values:

```typescript
// Proposed endpoint
GET /api/metrics/compare
?metricIds=active_loans,closed_loans
&currentPeriod=mtd
&previousPeriod=last_month

// Response
{
  active_loans: { current: 1250, previous: 1100, change: 13.6 },
  closed_loans: { current: 890, previous: 820, change: 8.5 }
}
```

### 2. Use Grouped Metrics for Breakdowns

Leverage existing `groupBy` support:

```typescript
const breakdownByType = await queryMetrics(
  ['total_units', 'total_volume'],
  { groupBy: 'loan_type', dateRange }
);
```

### 3. Add Caching Layer

Consider caching frequently-queried metrics to improve performance:

```typescript
// Redis or in-memory cache
const cacheKey = `metrics:${tenantId}:${metricIds.join(',')}:${period}`;
const cached = await cache.get(cacheKey);
if (cached) return cached;
```

### 4. Real-time Updates

Consider WebSocket updates for active loans count that changes frequently.

---

## Testing Checklist

- [ ] All 6 KPI cards display correct values
- [ ] Timeframe selectors update data correctly
- [ ] Custom date range picker works
- [ ] Modal opens with correct breakdown data
- [ ] Animation runs smoothly on data update
- [ ] Loading states display correctly
- [ ] Error states handled gracefully
- [ ] Multi-tenant data isolation verified

---

*Document created: January 27, 2026*
