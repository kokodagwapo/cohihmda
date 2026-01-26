---
name: Connect CompanyScorecard to Data
overview: Enhance the backend metrics API with groupBy support, then connect CompanyScorecard to real tenant data using the unified metrics endpoint.
todos:
  - id: backend-groupby
    content: "Phase 1a: Add queryMetricsGroupedBy function to metricsService.ts"
    status: completed
  - id: backend-route
    content: "Phase 1b: Update POST /api/metrics/query route to support groupBy parameter"
    status: completed
  - id: backend-metrics
    content: "Phase 1c: Add missing metrics to catalog (wa_fico, wa_ltv, wa_dti, wac, revenue, govt_units)"
    status: completed
  - id: frontend-hook
    content: "Phase 2a: Create useCompanyScorecardData hook for data fetching"
    status: completed
  - id: frontend-integrate
    content: "Phase 2b: Update CompanyScorecard.tsx to use hook and remove mock data"
    status: completed
  - id: verify
    content: "Phase 3: Test end-to-end and verify values match database"
    status: completed
isProject: false
---

# Connect CompanyScorecard to Real Tenant Data

## Architecture Decision

**Chosen approach:** Enhance `/api/metrics/query` to support `groupBy` for batch queries, making it the single flexible API for all analytics pages. This keeps business logic (Qlik formulas) centralized in `metricsService.ts` while giving the frontend control over which metrics to fetch and how to group them.

---

## Phase 1: Backend Enhancement

### 1.1 Add `groupBy` Support to Batch Metrics Query

**File:** `server/src/services/metrics/metricsService.ts`

The service already has `queryMetricGroupedBy` for single metrics. Add a new function to query multiple metrics grouped by a dimension:

```typescript
/**
 * Query multiple metrics grouped by a field
 * Returns metrics organized by group key
 */
export async function queryMetricsGroupedBy(
  tenantPool: pg.Pool,
  metricIds: string[],
  groupBy: 'branch' | 'loan_officer' | 'channel' | 'loan_type' | 'processor' | 'underwriter' | 'investor',
  options: MetricQueryOptions = {}
): Promise<Record<string, GroupedMetricResult[]>> {
  const results: Record<string, GroupedMetricResult[]> = {};
  
  // Query each metric in parallel
  await Promise.all(
    metricIds.map(async (metricId) => {
      try {
        results[metricId] = await queryMetricGroupedBy(tenantPool, metricId, groupBy, options);
      } catch (error: any) {
        console.error(`[MetricsService] Error querying grouped metric ${metricId}:`, error.message);
        results[metricId] = [];
      }
    })
  );
  
  return results;
}
```

### 1.2 Update Route to Accept groupBy

**File:** `server/src/routes/metrics.ts`

Update the `POST /api/metrics/query` endpoint:

```typescript
router.post('/query', authenticateToken, attachTenantContext, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const { metricIds, dateRange, dateField, groupBy, additionalFilters } = req.body;
    const tenantPool = getTenantContext(req).tenantPool;
    
    if (!Array.isArray(metricIds) || metricIds.length === 0) {
      return res.status(400).json({ error: 'metricIds must be a non-empty array' });
    }
    
    const parsedDateRange: DateRange | undefined = dateRange
      ? { start: dateRange.start ? new Date(dateRange.start) : null,
          end: dateRange.end ? new Date(dateRange.end) : null }
      : undefined;
    
    const options = { dateRange: parsedDateRange, dateField, additionalFilters };
    
    // If groupBy is specified, return grouped results
    if (groupBy) {
      const allowedGroupBy = ['branch', 'loan_officer', 'channel', 'loan_type', 'processor', 'underwriter', 'investor'];
      if (!allowedGroupBy.includes(groupBy)) {
        return res.status(400).json({ error: `Invalid groupBy. Allowed: ${allowedGroupBy.join(', ')}` });
      }
      
      const groupedResults = await queryMetricsGroupedBy(tenantPool, metricIds, groupBy, options);
      return res.json({ metrics: groupedResults, groupedBy: groupBy });
    }
    
    // Non-grouped query (existing behavior)
    const results = await queryMetrics(tenantPool, metricIds, options);
    res.json({ metrics: results });
  } catch (error: any) {
    console.error('[Metrics] Error querying metrics:', error);
    res.status(500).json({ error: error.message || 'Failed to query metrics' });
  }
});
```

### 1.3 Add Missing Scorecard Metrics to Catalog

**File:** `server/src/services/metrics/metricsService.ts`

Add these metrics to `METRICS_CATALOG`:

```typescript
// Weighted Average Metrics
'wa_fico': {
  id: 'wa_fico',
  name: 'Weighted Average FICO',
  description: 'Volume-weighted average FICO score',
  category: 'count',
  formula: 'Sum([FICO Score] * [Loan Amount]) / Sum([Loan Amount])',
  sqlQuery: `ROUND(SUM(l.fico_score * l.loan_amount) / NULLIF(SUM(l.loan_amount), 0), 0)`,
  dependencies: [],
  defaultDateField: 'application_date'
},
'wa_ltv': {
  id: 'wa_ltv',
  name: 'Weighted Average LTV',
  description: 'Volume-weighted average LTV ratio',
  category: 'count',
  formula: 'Sum([LTV Ratio] * [Loan Amount]) / Sum([Loan Amount])',
  sqlQuery: `ROUND(SUM(l.ltv_ratio * l.loan_amount) / NULLIF(SUM(l.loan_amount), 0), 1)`,
  dependencies: [],
  defaultDateField: 'application_date'
},
'wa_dti': {
  id: 'wa_dti',
  name: 'Weighted Average DTI',
  description: 'Volume-weighted average DTI ratio',
  category: 'count',
  formula: 'Sum([BE DTI Ratio] * [Loan Amount]) / Sum([Loan Amount])',
  sqlQuery: `ROUND(SUM(l.be_dti_ratio * l.loan_amount) / NULLIF(SUM(l.loan_amount), 0), 1)`,
  dependencies: [],
  defaultDateField: 'application_date'
},
'wac': {
  id: 'wac',
  name: 'Weighted Average Coupon (WAC)',
  description: 'Volume-weighted average interest rate',
  category: 'count',
  formula: 'Sum([Interest Rate] * [Loan Amount]) / Sum([Loan Amount])',
  sqlQuery: `ROUND(SUM(l.interest_rate * l.loan_amount) / NULLIF(SUM(l.loan_amount), 0), 3)`,
  dependencies: [],
  defaultDateField: 'application_date'
},

// Loan Type Breakdowns
'govt_units': {
  id: 'govt_units',
  name: 'Government Loan Units',
  description: 'Count of FHA and VA loans',
  category: 'count',
  formula: 'Count({<[Loan Type]={FHA,VA}>}[Loan Number])',
  sqlQuery: `COUNT(CASE WHEN l.loan_type IN ('FHA', 'VA') THEN 1 END)`,
  dependencies: [],
  defaultDateField: 'application_date'
},
'purchase_units': {
  id: 'purchase_units',
  name: 'Purchase Loan Units',
  description: 'Count of purchase loans',
  category: 'count',
  formula: 'Count({<[Loan Purpose]={"*Purchase*"}>}[Loan Number])',
  sqlQuery: `COUNT(CASE WHEN l.loan_purpose ILIKE '%purchase%' THEN 1 END)`,
  dependencies: [],
  defaultDateField: 'application_date'
},

// Revenue Metric (simplified - uses origination points as proxy)
'total_revenue': {
  id: 'total_revenue',
  name: 'Total Revenue',
  description: 'Sum of origination fees and revenue components',
  category: 'revenue',
  formula: 'Sum([Origination Points] + [Orig Fee Borr Pd] + [PA Sell Amt] + [PA SRP Amt])',
  sqlQuery: `SUM(
    COALESCE(l.origination_points, 0) + 
    COALESCE(l.orig_fee_borr_pd, 0) + 
    COALESCE(l.pa_sell_amt, 0) + 
    COALESCE(l.pa_srp_amt, 0)
  )`,
  dependencies: [],
  defaultDateField: 'funding_date'
}
```

---

## Phase 2: Frontend Integration

### 2.1 Create Custom Hook

**File:** `src/hooks/useCompanyScorecardData.ts` (new file)

```typescript
import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

interface ScorecardFilters {
  year: number;
  branch: string;
  loanOfficer: string;
}

interface MetricsByBranch {
  [metricId: string]: Array<{ groupKey: string; value: number; metadata?: any }>;
}

export function useCompanyScorecardData(filters: ScorecardFilters) {
  const [data, setData] = useState<MetricsByBranch | null>(null);
  const [totals, setTotals] = useState<Record<string, number> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);
        
        const yearStart = `${filters.year}-01-01`;
        const yearEnd = `${filters.year}-12-31`;
        
        const additionalFilters: Record<string, any> = {};
        if (filters.branch !== 'all') additionalFilters.branch = filters.branch;
        if (filters.loanOfficer !== 'all') additionalFilters.loan_officer = filters.loanOfficer;
        
        // Fetch grouped metrics by branch
        const groupedResponse = await api.request<{ metrics: MetricsByBranch }>('/api/metrics/query', {
          method: 'POST',
          body: JSON.stringify({
            metricIds: [
              'loans_started', 'originated_loans', 'fallout_withdrawn', 'fallout_denied',
              'total_volume', 'funded_volume', 'avg_cycle_time', 'pull_through_rate',
              'credit_pulls', 'wa_fico', 'wa_ltv', 'wa_dti', 'wac', 'total_revenue',
              'govt_units', 'purchase_units'
            ],
            dateRange: { start: yearStart, end: yearEnd },
            groupBy: 'branch',
            additionalFilters: Object.keys(additionalFilters).length > 0 ? additionalFilters : undefined
          })
        });
        
        // Also fetch totals (non-grouped)
        const totalsResponse = await api.request<{ metrics: Record<string, { value: number }> }>('/api/metrics/query', {
          method: 'POST',
          body: JSON.stringify({
            metricIds: [
              'loans_started', 'originated_loans', 'fallout_withdrawn', 'fallout_denied',
              'total_volume', 'avg_cycle_time', 'pull_through_rate', 'credit_pulls'
            ],
            dateRange: { start: yearStart, end: yearEnd },
            additionalFilters: Object.keys(additionalFilters).length > 0 ? additionalFilters : undefined
          })
        });
        
        setData(groupedResponse.metrics);
        
        // Transform totals to simple key-value
        const totalsMap: Record<string, number> = {};
        Object.entries(totalsResponse.metrics).forEach(([key, result]) => {
          totalsMap[key] = typeof result.value === 'number' ? result.value : 0;
        });
        setTotals(totalsMap);
        
      } catch (err: any) {
        setError(err.message || 'Failed to load scorecard data');
      } finally {
        setLoading(false);
      }
    };
    
    fetchData();
  }, [filters.year, filters.branch, filters.loanOfficer]);

  return { data, totals, loading, error };
}
```

### 2.2 Update CompanyScorecard.tsx

- Import the new hook
- Remove mock data (lines 22-82)
- Use hook data to populate KPIs, charts, and tables
- Add loading/error states

---

## Files to Modify

### Backend:

1. **`server/src/services/metrics/metricsService.ts`**

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - Add `queryMetricsGroupedBy` function
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - Add new metrics to `METRICS_CATALOG`

2. **`server/src/routes/metrics.ts`**

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - Update `POST /api/metrics/query` to handle `groupBy`

### Frontend:

3. **`src/hooks/useCompanyScorecardData.ts`** (new file)

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - Custom hook for scorecard data fetching

4. **`src/pages/CompanyScorecard.tsx`**

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - Remove mock data
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - Integrate hook
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                - Add loading/error UI

---

## API Usage Example

**Request:**

```json
POST /api/metrics/query
{
  "metricIds": ["loans_started", "originated_loans", "pull_through_rate", "wa_fico"],
  "dateRange": { "start": "2024-01-01", "end": "2024-12-31" },
  "groupBy": "branch"
}
```

**Response:**

```json
{
  "metrics": {
    "loans_started": [
      { "groupKey": "Downtown", "value": 150, "metadata": { "count": 150 } },
      { "groupKey": "Westside", "value": 280, "metadata": { "count": 280 } }
    ],
    "originated_loans": [
      { "groupKey": "Downtown", "value": 120, "metadata": { "count": 120 } },
      { "groupKey": "Westside", "value": 230, "metadata": { "count": 230 } }
    ],
    "pull_through_rate": [
      { "groupKey": "Downtown", "value": 80.0, "metadata": { "count": 150 } },
      { "groupKey": "Westside", "value": 82.1, "metadata": { "count": 280 } }
    ],
    "wa_fico": [
      { "groupKey": "Downtown", "value": 735, "metadata": { "count": 150 } },
      { "groupKey": "Westside", "value": 742, "metadata": { "count": 280 } }
    ]
  },
  "groupedBy": "branch"
}
```

---

## Verification Steps

1. **Backend Test:** Call `POST /api/metrics/query` with `groupBy: 'branch'`
2. **Verify Response:** Confirm metrics are grouped by branch with correct values
3. **Frontend Test:** Load CompanyScorecard page, verify API calls in Network tab
4. **Data Validation:** Compare displayed values with database aggregations
5. **Filter Test:** Change branch/LO filters, verify data refreshes correctly