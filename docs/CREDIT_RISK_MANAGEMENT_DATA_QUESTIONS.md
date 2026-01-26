# Credit Risk Management - Data & Metrics Clarification Report

This document outlines all KPIs, metrics, and data elements on the Credit Risk Management page, along with the Qlik implementation logic and how each metric maps to the new platform.

---

## Table of Contents
1. [Application Type Filter](#1-application-type-filter)
2. [KPI Cards Section](#2-kpi-cards-section)
3. [Credit Risk Story](#3-credit-risk-story)
4. [FICO Distribution Chart](#4-fico-distribution-chart)
5. [LTV Distribution Chart](#5-ltv-distribution-chart)
6. [DTI Distribution Chart](#6-dti-distribution-chart)
7. [Loan Mix Tables](#7-loan-mix-tables)
8. [Channel & Date Filtering](#8-channel--date-filtering)
9. [Credit Risk Thresholds](#9-credit-risk-thresholds)
10. [Known Issues & Debugging](#10-known-issues--debugging)

---

## 1. Application Type Filter

### Qlik Logic

The Application Type filter controls which loans are shown based on the `DateType` field. This is defined in `Calendar-Link.qvs`:

```qlik
// Calendar-Link.qvs - DateType mappings
DateLink:
LOAD 'Started' as DateType, [Started Date] as Date RESIDENT Coheus_Input;    // Started
LOAD 'Application' as DateType, [Application Date] as Date RESIDENT Coheus_Input;  // Applications Taken
LOAD 'Closing' as DateType, [Closing Date] as Date RESIDENT Coheus_Input;    // Closed
LOAD 'Funding' as DateType, [Funding Date] as Date RESIDENT Coheus_Input;    // Funded Production
LOAD 'HMDA' as DateType, [Current Status Date] as Date RESIDENT Coheus_Input; // For Withdrawn/Denied
```

**Variables from `Variables.qvs` (Line 129):**
```qlik
LET vDateSelect = 'Application';  // Default selection
```

### Application Type to DateType Mapping

| Application Type | Qlik DateType | Date Field | Status Filter |
|-----------------|---------------|------------|---------------|
| **Applications Taken** | `DateType={'Application'}` | `application_date` | None (all loans) |
| **Funded Production** | `DateType={'Funding'}` | `funding_date` | Implied (has funding_date) |
| **Lost Opportunities** | `[Withdrawn Flag]={1}` | **ANY date** (see below) | Withdrawn only (NOT denied!) |
| **All Loans** | `DateType={'Started'}` | `started_date` | None |

**⚠️ CRITICAL: Lost Opportunities uses Qlik's Associative Model for Date Filtering!**

When `[Withdrawn Flag]={1}` is used WITHOUT specifying a `DateType`, Qlik's associative model matches loans where **ANY** of their dates in the DateLink table falls within the date range.

From `Expressions.csv` (line 8893):
```qlik
DateType={Application}~Applications Taken|DateType={Funding}~Funded Production|[Withdrawn Flag]={1}~Lost Opportunities|DateType={Started}~All Loans
```

From `Variables.csv` - vProductionGroup for Lost Opportunities:
```qlik
'[Withdrawn Flag]={1},[$(vToDate)]={Yes}'
```

**Key Insight:** The `[$(vToDate)]={'Yes'}` filter (like `PreviousYearFlag={'Yes'}`) applies to ALL DateTypes in the DateLink table. A loan is counted if it has `Withdrawn Flag=1` AND **any** of its dates falls in the selected time period.

### DateLink Table - All Date Types (Calendar-Link.qvs)

Qlik loads **10 different DateTypes** into the DateLink table:

```qlik
DateLink:
LOAD RowNo, [Started Date] as Date, 'Started' as DateType RESIDENT Coheus_Input;
LOAD RowNo, [Application Date] as Date, 'Application' as DateType RESIDENT Coheus_Input;
LOAD RowNo, [Closing Date] as Date, 'Closing' as DateType RESIDENT Coheus_Input;
LOAD RowNo, [Funding Date] as Date, 'Funding' as DateType RESIDENT Coheus_Input;
LOAD RowNo, [Investor Purchase Date] as Date, 'Investor Purchase' as DateType RESIDENT Coheus_Input;
LOAD RowNo, [Investor Lock Date] as Date, 'Investor Lock' as DateType RESIDENT Coheus_Input;
LOAD RowNo, [Estimated Closing Date] as Date, 'Estimated Close' as DateType RESIDENT Coheus_Input;
LOAD RowNo, [Projected Closing Date] as Date, 'Estimated Closing' as DateType RESIDENT Coheus_Input;
LOAD RowNo, [CTC Date] as Date, 'CTC' as DateType RESIDENT Coheus_Input;
LOAD RowNo, [Current Status Date] as Date, 'HMDA' as DateType RESIDENT Coheus_Input;
```

### Withdrawn Flag Definition (Credit Risk Management)

**From `Script Additions Ranges.qvs`:**
```qlik
// Withdrawn Flag includes: withdraw, not accepted, incomplete
If(WildMatch([Current Loan Status],'*withdraw*','*not accepted*','*incomp*')>0,1,0) as [Withdrawn Flag]
```

**For Credit Risk Management Lost Opportunities:**
- Only `[Withdrawn Flag]={1}` is used
- This does NOT include denied loans (different from Loan Funnel page)
- Does NOT use `[Pull Through Originated Flag]` exclusion (that's for Loan Funnel page)
- Date filter checks ALL date fields via Qlik's associative model

### New Platform Implementation

**File:** `server/src/routes/metrics.ts` (credit-risk endpoint)

```typescript
// Handle application type filter - maps to Qlik's DateType field
// 'Applications Taken' -> DateType={'Application'} -> application_date
// 'Funded Production' -> DateType={'Funding'} -> funding_date
// 'Lost Opportunities' -> [Withdrawn Flag]={1} with ANY date in range (Qlik associative model)
// 'All Loans' -> DateType={'Started'} -> started_date
let effectiveDateField = dateField || 'application_date';
let effectiveFilters = { ...additionalFilters };

if (applicationType === 'Funded Production') {
  effectiveDateField = 'funding_date';
} else if (applicationType === 'Lost Opportunities') {
  // Credit Risk Management Lost Opportunities:
  // Qlik uses [Withdrawn Flag]={1},[$(vToDate)]={'Yes'} without specifying DateType
  // In Qlik's associative model, this means loans with Withdrawn Flag=1 where ANY date is in range
  // We use 'any_date' to check ALL date fields to replicate this behavior
  effectiveDateField = 'any_date';  // Special flag for multi-date filtering
  effectiveFilters.withdrawn_filter = true;
} else if (applicationType === 'All Loans') {
  effectiveDateField = 'started_date';
}
```

**File:** `server/src/services/metrics/metricsService.ts` (buildDateRangeClause)

```typescript
// Special case: 'any_date' means ANY of the loan's dates can be in range (Qlik associative model)
// All DateTypes from Qlik's DateLink table (Calendar-Link.qvs):
if (dateField === 'any_date') {
  const dateFields = [
    'application_date',       // Application
    'started_date',           // Started
    'current_status_date',    // HMDA
    'funding_date',           // Funding
    'closing_date',           // Closing
    'investor_purchase_date', // Investor Purchase
    'lock_date',              // Investor Lock
    'estimated_closing_date', // Estimated Close / Estimated Closing
    'ctc_date'                // CTC (Clear to Close)
  ];
  
  // Build OR condition: loan is included if ANY of its dates is in range
  const orConditions = dateFields.map(df => 
    `(l.${df} IS NOT NULL AND DATE(l.${df}) >= $1::date AND DATE(l.${df}) <= $2::date)`
  );
  
  return { clause: `AND (${orConditions.join(' OR ')})`, params: [dateRange.start, dateRange.end] };
}
```

**File:** `server/src/services/metrics/metricsService.ts` (buildWhereClause)

```typescript
// Credit Risk Management Lost Opportunities:
// ONLY [Withdrawn Flag]={1} - does NOT include denied!
// Qlik Withdrawn Flag: WildMatch([Current Loan Status],'*withdraw*','*not accepted*','*incomp*')>0
if (filters.withdrawn_filter) {
  clauses.push(`(l.current_loan_status ILIKE '%withdraw%' OR l.current_loan_status ILIKE '%not accepted%' OR l.current_loan_status ILIKE '%incomp%')`);
}
```

### Gap Analysis

| Aspect | Qlik | New Platform | Status |
|--------|------|--------------|--------|
| Applications Taken | `DateType={'Application'}` | `dateField='application_date'` | ✅ Matches |
| Funded Production | `DateType={'Funding'}` | `dateField='funding_date'` | ✅ Matches |
| Lost Opportunities | `[Withdrawn Flag]={1},[$(vToDate)]={Yes}` (any DateType) | `dateField='any_date'` + `withdrawn_filter=true` | ✅ Matches |
| All Loans | `DateType={'Started'}` | `dateField='started_date'` | ✅ Matches |

**✅ RESOLVED:** Credit Risk Management Lost Opportunities uses:
1. **Status Filter:** `[Withdrawn Flag]={1}` (withdrawn, not accepted, incomplete - NOT denied)
2. **Date Filter:** ANY of the loan's dates (all 9 DateTypes from DateLink table) falls within the selected date range

This replicates Qlik's associative model behavior where no specific DateType is specified.

---

## 2. KPI Cards Section

### 2.1 Units KPI

| Aspect | Qlik Logic | New Platform |
|--------|-----------|--------------|
| **Metric** | `Count([Loan Number])` | `metricId: 'total_units'` |
| **SQL** | N/A | `COUNT(l.loan_number)` |
| **Date Filter** | `DateType` + `[$(vToDate)]={'Yes'}` | `dateField` + `dateRange` |

**Note:** SQL uses `COUNT(loan_number)` not `COUNT(*)` to match Qlik's `Count([Loan Number])` which skips NULL values.

**Qlik Formula Pattern:**
```qlik
Count({$<DateType={'$(vDateSelect)'},[$(vToDate)]={'Yes'},[Consolidated Channels]={'$(vChannelGroup)'}>}[Loan Number])
```

**New Platform SQL:**
```sql
-- metricsService.ts - total_units metric
COUNT(*)
```

**Gap Status:** ✅ Matches (with proper filters)

---

### 2.2 Volume KPI

| Aspect | Qlik Logic | New Platform |
|--------|-----------|--------------|
| **Metric** | `Sum([Loan Amount])` | `metricId: 'total_volume'` |
| **SQL** | N/A | `SUM(l.loan_amount)` |

**Qlik Formula Pattern:**
```qlik
Sum({$<DateType={'$(vDateSelect)'},[$(vToDate)]={'Yes'},[Consolidated Channels]={'$(vChannelGroup)'}>}[Loan Amount])
```

**New Platform SQL:**
```sql
SUM(l.loan_amount)
```

**Gap Status:** ✅ Matches

---

### 2.3 WAC (Weighted Average Coupon) KPI

| Aspect | Qlik Logic | New Platform |
|--------|-----------|--------------|
| **Metric** | Weighted Avg of Interest Rate | `metricId: 'wac'` |
| **Weight** | `[Loan Amount]` | `loan_amount` |
| **Out of Range Filter** | `[Interest Rate]>0 AND [Interest Rate]<=15` | Same |

**Qlik Formula Pattern:**
```qlik
Sum({$<[Interest Rate]={"">0<=15""},...>}[Interest Rate] * [Loan Amount])
/ Sum({$<[Interest Rate]={"">0<=15""},...>}[Loan Amount])
```

**New Platform SQL:**
```sql
SUM(CASE WHEN l.interest_rate > 0 AND l.interest_rate <= 15 
    THEN l.interest_rate * l.loan_amount ELSE 0 END) /
NULLIF(SUM(CASE WHEN l.interest_rate > 0 AND l.interest_rate <= 15 
    THEN l.loan_amount ELSE 0 END), 0)
```

**Gap Status:** ✅ Matches

---

### 2.4 WA FICO KPI

| Aspect | Qlik Logic | New Platform |
|--------|-----------|--------------|
| **Metric** | Weighted Avg of FICO Score | `metricId: 'wa_fico'` |
| **Weight** | `[Loan Amount]` | `loan_amount` |
| **Out of Range Filter** | `vFICOMin=350`, `vFICOMax=900` | Same |

**Qlik Variables (Script Additions Ranges.qvs Lines 134-135):**
```qlik
SET vFICOMin = 350;
SET vFICOMax = 900;
```

**Qlik Formula:**
```qlik
Sum({$<[FICO Score]={"">=$(vFICOMin)<=$(vFICOMax)""},...>}[FICO Score] * [Loan Amount])
/ Sum({$<[FICO Score]={"">=$(vFICOMin)<=$(vFICOMax)""},...>}[Loan Amount])
```

**New Platform SQL:**
```sql
SUM(CASE WHEN l.fico_score >= 350 AND l.fico_score <= 900 
    THEN l.fico_score * l.loan_amount ELSE 0 END) /
NULLIF(SUM(CASE WHEN l.fico_score >= 350 AND l.fico_score <= 900 
    THEN l.loan_amount ELSE 0 END), 0)
```

**Gap Status:** ✅ Matches

---

### 2.5 WA LTV KPI

| Aspect | Qlik Logic | New Platform |
|--------|-----------|--------------|
| **Metric** | Weighted Avg of LTV Ratio | `metricId: 'wa_ltv'` |
| **Weight** | `[Loan Amount]` | `loan_amount` |
| **Out of Range Filter** | `vLTVMin=0`, `vLTVMax=110` | Same |

**Qlik Variables:**
```qlik
SET vLTVMin = 0;
SET vLTVMax = 110;
```

**New Platform SQL:**
```sql
SUM(CASE WHEN l.ltv_ratio >= 0 AND l.ltv_ratio <= 110 
    THEN l.ltv_ratio * l.loan_amount ELSE 0 END) /
NULLIF(SUM(CASE WHEN l.ltv_ratio >= 0 AND l.ltv_ratio <= 110 
    THEN l.loan_amount ELSE 0 END), 0)
```

**Gap Status:** ✅ Matches

---

### 2.6 WA DTI KPI

| Aspect | Qlik Logic | New Platform |
|--------|-----------|--------------|
| **Metric** | Weighted Avg of BE DTI Ratio | `metricId: 'wa_dti'` |
| **Weight** | `[Loan Amount]` | `loan_amount` |
| **Out of Range Filter** | `vDTIMin=0`, `vDTIMax=70` | Same |

**Qlik Variables:**
```qlik
SET vDTIMin = 0;
SET vDTIMax = 70;
```

**New Platform SQL:**
```sql
SUM(CASE WHEN l.be_dti_ratio >= 0 AND l.be_dti_ratio <= 70 
    THEN l.be_dti_ratio * l.loan_amount ELSE 0 END) /
NULLIF(SUM(CASE WHEN l.be_dti_ratio >= 0 AND l.be_dti_ratio <= 70 
    THEN l.loan_amount ELSE 0 END), 0)
```

**Gap Status:** ✅ Matches

---

## 3. Credit Risk Story

The Credit Risk Story section displays dynamic narrative insights about the loan portfolio composition.

### 3.1 Largest Category Story Items

**⚠️ CRITICAL: Qlik uses VOLUME (Sum of Loan Amount) NOT COUNT for these percentages!**

There are TWO versions in Qlik - Units and Volume. The Credit Risk Management sheet uses the **Volume** version:

#### Largest Loan Type

**Qlik Formula (Volume-based):**
```qlik
//Volume
Only({<[Loan Type]={"=Rank(Sum({<$(vProductionGroup)>}[Loan Amount]))=1"}>}[Loan Type]) 
& ' is the largest Loan Type Category with a ' 
& num(
    sum({<$(vProductionGroup),[Loan Type]={"=Rank(sum([Loan Amount]))=1"}>}[Loan Amount])
    /
    sum({<$(vProductionGroup)>}total[Loan Amount])
  ,'0%') 
& ' share.'
```

**Logic Breakdown:**
1. Find Loan Type with highest `Sum([Loan Amount])` using `Rank()=1`
2. Calculate percentage: `sum(that type's volume) / sum(total volume)`
3. Format as whole percentage (0%)

#### Largest Loan Purpose

**NOTE: Loan Purpose Naming Differences**

Qlik's `[Loan Purpose]` field may use abbreviated values (e.g., "Refi CO") that differ from Encompass/database values (e.g., "Cash-Out Refinance").

| Qlik Value | Encompass/Database Value |
|------------|--------------------------|
| `Refi CO` | `Cash-Out Refinance` |
| `Refi NoCO` | `Rate/Term Refinance` or `No Cash-Out Refinance` |
| `Purchase` | `Purchase` |

**Our Implementation:** We display raw values from the database as they come from Encompass - no mapping is applied. This means category names may differ from Qlik but represent the actual source data.

**⚠️ IMPORTANT: Qlik Story vs Table Discrepancy**

The Qlik Credit Risk Story and Loan Mix Table can show **different percentages** for the same category! This is because they use different formulas:

**Loan Mix Table (Volume %):**
```qlik
num(sum({<$(vProductionGroup)>}[Loan Amount])
/
sum({<$(vProductionGroup)>}total[Loan Amount]),'0.0%')
```
- The table dimension (Loan Purpose) naturally groups each row
- Percentage is calculated within the date-filtered context

**Credit Risk Story (Loan Purpose %):**
```qlik
num(sum({<$(vProductionGroup),[Loan Purpose]={"=Rank(sum([Loan Amount]))=1"}>}[Loan Amount])
/
sum({<$(vProductionGroup)>}total[Loan Amount]),'0%')
```
- Uses `Rank(sum([Loan Amount]))=1` to find the #1 category
- The inner `Rank()` function may evaluate in a **different context** (potentially without date filters)
- This can identify a different "largest" category or calculate a different percentage

**Result:** Our implementation matches the **Loan Mix Table** formula, which shows the accurate percentage within the filtered date range. The Qlik Story may show different values due to its Rank() evaluation context.

**Qlik Formula (Volume-based):**
```qlik
//Volume
Only({<[Loan Purpose]={"=Rank(Sum({<$(vProductionGroup)>}[Loan Amount]))=1"}>}[Loan Purpose]) 
& ' is the largest Loan Purpose Category with a ' 
& num(
    sum({<$(vProductionGroup),[Loan Purpose]={"=Rank(sum([Loan Amount]))=1"}>}[Loan Amount])
    /
    sum({<$(vProductionGroup)>}total[Loan Amount])
  ,'0%') 
& ' share.'
```

**`total[Loan Amount]` Denominator Behavior**

The `total` keyword in Qlik means the denominator sums across ALL dimension values (all Loan Purpose categories), but still excludes loans with NULL values since they're not part of any dimension value.

- **Numerator**: Sum of loan amount for loans in the specific Loan Purpose category
- **Denominator**: Sum of loan amount across all Loan Purpose categories (excluding NULLs)

Our implementation matches this behavior - totals are calculated from loans that have a non-NULL loan_purpose value.

#### Largest Occupancy Type

**Qlik Formula (Volume-based):**
```qlik
//Volume
Only({<[Occupancy Type]={"=Rank(Sum({<$(vProductionGroup)>}[Loan Amount]))=1"}>}[Occupancy Type]) 
& ' is the largest Occupancy Category with a ' 
& num(
    sum({<$(vProductionGroup),[Occupancy Type]={"=Rank(sum([Loan Amount]))=1"}>}[Loan Amount])
    /
    sum({<$(vProductionGroup)>}total[Loan Amount])
  ,'0%') 
& ' share.'
```

### 3.2 Qualified Loan Percentages

**⚠️ CRITICAL: Uses `[Loan Type Group]` NOT `[Loan Type]`!**

`[Loan Type Group]` is a derived field that groups loan types:
- `'Conventional'` or `*Conv*` pattern
- `'Government'` or `*Gov*` pattern (FHA, VA, USDA)

#### Conventional Qualified Loans

**Qlik Formula:**
```qlik
='Conventional loans with credit score > 680, DTI < 43%, LTV < 80% = '
& num(
    sum({<$(vProductionGroup),
        [Loan Type Group]*={"*Conv*"},
        [FICO Score]*={">680"},
        [LTV Ratio]*={"<80"},
        [BE DTI Ratio]*={"<43"},
        [Loan Type]*=>}
        [Loan Amount])
    /
    sum({<$(vProductionGroup),
        [Loan Type Group]*={"*Conv*"},
        [Loan Type]*=>}
        [Loan Amount])
  ,'0%') 
& '.'
```

**Key Points:**
- Uses `[Loan Type Group]*={"*Conv*"}` pattern matching (NOT exact `loan_type='Conventional'`)
- Filters: FICO > 680, LTV < 80, DTI < 43
- **VOLUME-based**: Sum of Loan Amount, NOT count of loans
- Percentage = qualified conventional volume / total conventional volume

#### Government Qualified Loans

**Qlik Formula:**
```qlik
'Government loans with credit score > 620, DTI < 50%, LTV < 100% = '
& num(
    sum({<$(vProductionGroup),
        [Loan Type Group]*={"*Gov*"},
        [FICO Score]*={">620"},
        [LTV Ratio]*={"<100"},
        [BE DTI Ratio]*={"<50"},
        [Loan Type]*=>}
        [Loan Amount])
    /
    sum({<$(vProductionGroup),
        [Loan Type Group]*={"*Gov*"},
        [Loan Type]*=>}
        [Loan Amount])
  ,'0%') 
& '.'
```

**Key Points:**
- Uses `[Loan Type Group]*={"*Gov*"}` pattern matching (includes FHA, VA, USDA)
- Filters: FICO > 620, LTV < 100, DTI < 50
- **VOLUME-based**: Sum of Loan Amount, NOT count of loans
- Percentage = qualified government volume / total government volume

### 3.3 New Platform Implementation

**File:** `server/src/services/metrics/metricsService.ts` - `queryLoanMix()`

The loan mix query calculates percentages matching Qlik's **Loan Mix Table** behavior:

```sql
WITH loan_data AS (
  -- Includes loans with non-NULL groupBy field (matches Qlik's dimension behavior)
  SELECT COALESCE(loan_purpose, 'Other') as category, loan_amount, ...
  FROM public.loans l
  WHERE loan_purpose IS NOT NULL ${dateFilters} ${additionalFilters}
),
totals AS (
  -- Total sums across all dimension values (excludes NULLs, matching Qlik)
  SELECT COUNT(*) as total_units, SUM(loan_amount) as total_volume
  FROM loan_data
)
-- Percentage: category_volume / total_volume_across_all_categories
SELECT 
  category,
  SUM(loan_amount) as volume,
  SUM(loan_amount) * 100.0 / total_volume as volume_percent
FROM loan_data
GROUP BY category
```

**Note:** Our implementation matches Qlik's Loan Mix Table, NOT the Credit Risk Story (which uses a different Rank-based formula).

**File:** `server/src/services/metrics/metricsService.ts` - `queryCreditRiskStory()`

```typescript
// Query for qualified loan percentages - VOLUME BASED (Sum of Loan Amount)
// Loan Type Group mapping:
//   - Conventional: loan_type ILIKE '%conv%' OR loan_type = 'Conventional'
//   - Government: loan_type IN ('FHA', 'VA', 'USDA') OR loan_type ILIKE '%gov%'
const qualifiedQuery = `
  WITH filtered_loans AS (
    SELECT loan_type, fico_score, be_dti_ratio, ltv_ratio, loan_amount
    FROM public.loans l
    WHERE ...filters...
  ),
  conventional_stats AS (
    SELECT 
      SUM(loan_amount) as total_conventional_volume,
      SUM(CASE 
        WHEN fico_score > 680 AND be_dti_ratio < 43 AND ltv_ratio < 80 
        THEN loan_amount 
      END) as qualified_conventional_volume
    FROM filtered_loans
    WHERE UPPER(loan_type) LIKE '%CONV%' OR UPPER(loan_type) = 'CONVENTIONAL'
  ),
  government_stats AS (
    SELECT 
      SUM(loan_amount) as total_government_volume,
      SUM(CASE 
        WHEN fico_score > 620 AND be_dti_ratio < 50 AND ltv_ratio < 100 
        THEN loan_amount 
      END) as qualified_government_volume
    FROM filtered_loans
    WHERE UPPER(loan_type) IN ('FHA', 'VA', 'USDA')
       OR UPPER(loan_type) LIKE '%GOV%'
  )
  SELECT 
    ROUND(qualified_conventional_volume * 100.0 / NULLIF(total_conventional_volume, 0), 0),
    ROUND(qualified_government_volume * 100.0 / NULLIF(total_government_volume, 0), 0)
  FROM conventional_stats, government_stats
`;
```

**File:** `server/src/routes/metrics.ts` - credit-risk endpoint

```typescript
// Calculate largest categories from loan mix data (by VOLUME, not units!)
const findLargestByVolume = (rows: LoanMixRow[]) => {
  if (!rows || rows.length === 0) return { category: 'N/A', volumePercent: 0 };
  const sorted = [...rows].sort((a, b) => b.volume - a.volume);
  return { category: sorted[0].category, volumePercent: sorted[0].volumePercent };
};
```

### 3.4 Gap Analysis

| Story Item | Qlik Logic | Our Implementation | Status |
|------------|------------|-------------------|--------|
| Largest Loan Type | Volume-based (`Sum([Loan Amount])`) | ✅ Volume-based | ✅ Correct |
| Largest Loan Purpose | Volume-based (`Sum([Loan Amount])`) | ✅ Volume-based, matches Loan Mix Table | ✅ Correct |
| Largest Occupancy | Volume-based (`Sum([Loan Amount])`) | ✅ Volume-based | ✅ Correct |
| Conventional Qualified % | `[Loan Type Group]*={"*Conv*"}`, Volume-based | ✅ Pattern matching, Volume-based | ✅ Correct |
| Government Qualified % | `[Loan Type Group]*={"*Gov*"}`, Volume-based | ✅ Pattern matching, Volume-based | ✅ Correct |

**Implementation Notes:**
1. ✅ Largest category calculation uses `volume` (Sum of Loan Amount)
2. ✅ Qualified loan calculation uses SUM(loan_amount), not COUNT
3. ✅ Loan Type filtering uses pattern matching (`%Conv%`, `%Gov%`, `FHA`, `VA`, `USDA`)
4. ✅ Our percentages match Qlik's **Loan Mix Table** values
5. ⚠️ Qlik's **Credit Risk Story** may show different percentages than the Loan Mix Table due to the `Rank()` function evaluation context (see note in section 3.1)

---

## 4. FICO Distribution Chart

### Qlik Logic

The FICO distribution groups loans by FICO score ranges. From `Vizobjects.csv`, this is the "FICO Distribution" bar chart.

**Standard FICO Buckets:**
| Bucket | Range |
|--------|-------|
| `<580` | FICO < 580 |
| `580-619` | 580 <= FICO < 620 |
| `620-679` | 620 <= FICO < 680 |
| `680-719` | 680 <= FICO < 720 |
| `720-759` | 720 <= FICO < 760 |
| `760-799` | 760 <= FICO < 800 |
| `800+` | FICO >= 800 |

### New Platform Implementation

**File:** `server/src/services/metrics/metricsService.ts` - `queryFicoDistribution()`

```sql
WITH fico_buckets AS (
  SELECT 
    CASE
      WHEN l.fico_score IS NULL OR l.fico_score < 350 THEN 'Missing/Invalid'
      WHEN l.fico_score < 580 THEN '<580'
      WHEN l.fico_score < 620 THEN '580-619'
      WHEN l.fico_score < 680 THEN '620-679'
      WHEN l.fico_score < 720 THEN '680-719'
      WHEN l.fico_score < 760 THEN '720-759'
      WHEN l.fico_score < 800 THEN '760-799'
      ELSE '800+'
    END as range,
    l.loan_amount
  FROM public.loans l
  WHERE 1=1 
    ${dateRangeClause}
    ${additionalFiltersClause}
)
SELECT 
  range,
  COUNT(*) as units,
  COALESCE(SUM(loan_amount), 0) as volume,
  ROUND(COUNT(*) * 100.0 / NULLIF(total_units, 0), 1) as percentage
FROM fico_buckets
WHERE range != 'Missing/Invalid'
GROUP BY range
ORDER BY sort_order
```

**Gap Status:** ⚠️ Need to verify bucket boundaries match Qlik exactly

---

## 5. LTV Distribution Chart

### Qlik Logic

**Standard LTV Buckets:**
| Bucket | Range |
|--------|-------|
| `0-Values` | LTV <= 0 or NULL |
| `0.01-60.00` | 0 < LTV <= 60 |
| `60.01-75.00` | 60 < LTV <= 75 |
| `75.01-80.00` | 75 < LTV <= 80 |
| `80.01-90.00` | 80 < LTV <= 90 |
| `90.01-100.00` | 90 < LTV <= 100 |
| `>100` | LTV > 100 |

### New Platform Implementation

**File:** `server/src/services/metrics/metricsService.ts` - `queryLtvDistribution()`

```sql
CASE
  WHEN l.ltv_ratio IS NULL OR l.ltv_ratio <= 0 THEN '0-Values'
  WHEN l.ltv_ratio <= 60 THEN '0.01-60.00'
  WHEN l.ltv_ratio <= 75 THEN '60.01-75.00'
  WHEN l.ltv_ratio <= 80 THEN '75.01-80.00'
  WHEN l.ltv_ratio <= 90 THEN '80.01-90.00'
  WHEN l.ltv_ratio <= 100 THEN '90.01-100.00'
  ELSE '>100'
END as range
```

**Gap Status:** ✅ Matches standard buckets

---

## 6. DTI Distribution Chart

### Qlik Logic

**Standard DTI Buckets:**
| Bucket | Range |
|--------|-------|
| `Values<=0` | DTI <= 0 or NULL |
| `0.01-28.00` | 0 < DTI <= 28 |
| `28.01-36.00` | 28 < DTI <= 36 |
| `36.01-43.00` | 36 < DTI <= 43 |
| `43.01-50.00` | 43 < DTI <= 50 |
| `>50.00` | DTI > 50 |

### New Platform Implementation

**File:** `server/src/services/metrics/metricsService.ts` - `queryDtiDistribution()`

```sql
CASE
  WHEN l.be_dti_ratio IS NULL OR l.be_dti_ratio <= 0 THEN 'Values<=0'
  WHEN l.be_dti_ratio <= 28 THEN '0.01-28.00'
  WHEN l.be_dti_ratio <= 36 THEN '28.01-36.00'
  WHEN l.be_dti_ratio <= 43 THEN '36.01-43.00'
  WHEN l.be_dti_ratio <= 50 THEN '43.01-50.00'
  ELSE '>50.00'
END as range
```

**Gap Status:** ✅ Matches standard buckets

---

## 7. Loan Mix Tables

### 6.1 Loan Mix by Type

Groups loans by `[Loan Type]` field.

**Qlik Dimension:** `[Loan Type]` or `[Loan Type Group]`

**Measures per row:**
| Measure | Qlik Formula | New Platform |
|---------|-------------|--------------|
| Units | `Count([Loan Number])` | `COUNT(*)` |
| Units % | Units / Total Units * 100 | Calculated |
| Volume | `Sum([Loan Amount])` | `SUM(loan_amount)` |
| Volume % | Volume / Total Volume * 100 | Calculated |
| WAC | Weighted Avg Interest Rate | Weighted calculation |
| WA FICO | Weighted Avg FICO | Weighted calculation |
| WA LTV | Weighted Avg LTV | Weighted calculation |
| WA DTI | Weighted Avg DTI | Weighted calculation |

### 6.2 Loan Mix by Purpose

Groups loans by `[Loan Purpose]` field.

**Common values:** Purchase, Refi CO (Cash Out), Refi NO CO (No Cash Out)

### 6.3 Loan Mix by Occupancy

Groups loans by `[Occupancy Type]` field.

**Common values:** Primary Residence, Second Home, Investment

### New Platform Implementation

**File:** `server/src/services/metrics/metricsService.ts` - `queryLoanMix()`

```sql
SELECT 
  COALESCE(NULLIF(TRIM(l.${groupBy}::text), ''), 'Other') as category,
  COUNT(*) as units,
  ROUND(COUNT(*) * 100.0 / NULLIF(total_units, 0), 1) as units_percent,
  COALESCE(SUM(l.loan_amount), 0) as volume,
  ROUND(SUM(l.loan_amount) * 100.0 / NULLIF(total_volume, 0), 1) as volume_percent,
  -- WAC with out-of-range filter
  ROUND(
    SUM(CASE WHEN l.interest_rate > 0 AND l.interest_rate <= 15 
        THEN l.interest_rate * l.loan_amount ELSE 0 END) / 
    NULLIF(SUM(CASE WHEN l.interest_rate > 0 AND l.interest_rate <= 15 
        THEN l.loan_amount ELSE 0 END), 0)
  , 3) as wac,
  -- WA FICO, WA LTV, WA DTI with respective filters...
FROM loan_data
GROUP BY category
ORDER BY volume DESC
```

**Gap Status:** ✅ Structure matches

---

## 8. Channel & Date Filtering

### Channel Filter

**Qlik Variable (Variables.qvs):**
```qlik
LET vChannelGroup='$(vConsolidatedChannels)';
// vConsolidatedChannels can be: 'Retail', 'TPO', 'All' (or specific channel names)
```

**Qlik Set Analysis:**
```qlik
[Consolidated Channels]={'$(vChannelGroup)'}
```

**New Platform:**
```typescript
// useCreditRiskData.ts
if (filters.channel && filters.channel !== 'All') {
  additionalFilters.consolidated_channel = filters.channel;
}
```

### Date Filtering

**Qlik Variable:**
```qlik
LET vToDate = if($(vYear)=$(vMaxYear),'YTDFlag','PreviousYearFlag');
// [$(vToDate)]={'Yes'} filters to YTD or full previous year
```

**New Platform:**
```typescript
const dateRangeStart = filters.dateRange?.start || `${filters.year}-01-01`;
const dateRangeEnd = filters.dateRange?.end || `${filters.year}-12-31`;
```

---

## 8. Credit Risk Thresholds

### Credit Risk Flag Variables

These variables define what constitutes "Credit Risk" (highlighted in red in Qlik).

**From Script Additions Ranges.qvs (Lines 87-94):**
```qlik
SET vFICOCreditMax = 580;   // FICO below this is credit risk
SET vFICOCreditMin = 350;   // Below this is invalid/missing

SET vLTVCreditMax = 97;     // LTV above this is credit risk  
SET vLTVCreditMin = 0;      // Below this is invalid

SET vDTICreditMax = 70;     // DTI above this is credit risk
SET vDTICreditMin = 50;     // DTI between 50-70 may be flagged
```

**Credit Risk Highlighting Logic:**
```qlik
// FICO Credit Risk: Score between vFICOCreditMin and vFICOCreditMax (350-580)
if([FICO Score]>=$(vFICOCreditMin) AND [FICO Score]<=$(vFICOCreditMax), vErrorColor, ...)

// LTV Credit Risk: Ratio above vLTVCreditMax (>97%)
if([LTV Ratio]>=$(vLTVCreditMax) OR [LTV Ratio]<=$(vLTVCreditMin), vErrorColor, ...)

// DTI Credit Risk: Ratio between vDTICreditMin and vDTICreditMax (50-70)
if([BE DTI Ratio]>=$(vDTICreditMin) AND [BE DTI Ratio]<=$(vDTICreditMax), vErrorColor, ...)
```

**New Platform:** Not yet implemented - future enhancement for visual highlighting.

---

## 10. Known Issues & Debugging

### ✅ RESOLVED: Lost Opportunities Filter Logic (Credit Risk Management)

**Issue:** Lost Opportunities was showing incorrect unit counts.

**Investigation Journey:**
| Attempt | Configuration | Result | Off By |
|---------|--------------|--------|--------|
| 1 | withdrawn+denied + current_status_date | 1084 | +28 over |
| 2 | withdrawn only + current_status_date | 975 | -81 under |
| 3 | withdrawn+denied + application_date | 969 | -87 under |
| 4 | withdrawn+denied + any_date (5 fields) | 1151 | +95 over |
| 5 | withdrawn only + any_date (5 fields) | 1035 | -21 under |
| 6 | withdrawn only + any_date (9 fields) | **1056** | ✅ **EXACT MATCH** |

**Root Cause:** Credit Risk Management's Lost Opportunities uses a different formula than Loan Funnel:

1. **Status Filter:** `[Withdrawn Flag]={1}` which only matches:
   - `*withdraw*`
   - `*not accepted*`
   - `*incomp*`
   - **Does NOT include `*denied*`** (that's only on Loan Funnel page)

2. **Date Filter:** When `[Withdrawn Flag]={1}` is used WITHOUT specifying a `DateType`, Qlik's associative model matches loans where **ANY** of their dates in the DateLink table falls within the date range.

**Final Fixes Applied:**
1. Set `effectiveDateField = 'any_date'` in `metrics.ts` for Lost Opportunities
2. Implemented `any_date` logic in `buildDateRangeClause()` to check ALL 9 date fields with OR logic:
   - application_date, started_date, current_status_date, funding_date, closing_date
   - investor_purchase_date, lock_date, estimated_closing_date, ctc_date
3. `withdrawn_filter` in `metricsService.ts` only includes withdrawn/not accepted/incomplete (NOT denied)

### Debugging Queries

**Correct Lost Opportunities Query (Credit Risk Management):**
```sql
-- Lost Opportunities: Withdrawn only (NOT denied), ANY date in range
SELECT COUNT(loan_number) as units
FROM public.loans l
WHERE (
  -- Status filter: Withdrawn Flag only (NOT denied)
  l.current_loan_status ILIKE '%withdraw%' 
  OR l.current_loan_status ILIKE '%not accepted%' 
  OR l.current_loan_status ILIKE '%incomp%'
)
AND (
  -- Date filter: ANY date in range (Qlik associative model)
  (l.application_date IS NOT NULL AND DATE(l.application_date) BETWEEN '2025-01-01' AND '2025-12-31')
  OR (l.started_date IS NOT NULL AND DATE(l.started_date) BETWEEN '2025-01-01' AND '2025-12-31')
  OR (l.current_status_date IS NOT NULL AND DATE(l.current_status_date) BETWEEN '2025-01-01' AND '2025-12-31')
  OR (l.funding_date IS NOT NULL AND DATE(l.funding_date) BETWEEN '2025-01-01' AND '2025-12-31')
  OR (l.closing_date IS NOT NULL AND DATE(l.closing_date) BETWEEN '2025-01-01' AND '2025-12-31')
  OR (l.investor_purchase_date IS NOT NULL AND DATE(l.investor_purchase_date) BETWEEN '2025-01-01' AND '2025-12-31')
  OR (l.lock_date IS NOT NULL AND DATE(l.lock_date) BETWEEN '2025-01-01' AND '2025-12-31')
  OR (l.estimated_closing_date IS NOT NULL AND DATE(l.estimated_closing_date) BETWEEN '2025-01-01' AND '2025-12-31')
  OR (l.ctc_date IS NOT NULL AND DATE(l.ctc_date) BETWEEN '2025-01-01' AND '2025-12-31')
);
```

**Compare counts with different configurations (for debugging):**
```sql
-- Using single date field (will NOT match Qlik)
SELECT COUNT(loan_number) as by_app_date
FROM public.loans
WHERE application_date BETWEEN '2025-01-01' AND '2025-12-31'
  AND (current_loan_status ILIKE '%withdraw%' 
       OR current_loan_status ILIKE '%not accepted%' 
       OR current_loan_status ILIKE '%incomp%');

-- Using current_status_date (CORRECT for Lost Opportunities)
SELECT COUNT(*) as by_status_date
FROM public.loans
WHERE current_status_date BETWEEN '2025-01-01' AND '2025-12-31'
  AND (current_loan_status ILIKE '%withdraw%' 
       OR current_loan_status ILIKE '%not accepted%' 
       OR current_loan_status ILIKE '%incomp%' 
       OR current_loan_status ILIKE '%denied%');
```

**Breakdown by status type:**
```sql
SELECT 
  COUNT(*) as total,
  COUNT(CASE WHEN current_loan_status ILIKE '%withdraw%' THEN 1 END) as withdrawn,
  COUNT(CASE WHEN current_loan_status ILIKE '%not accepted%' THEN 1 END) as not_accepted,
  COUNT(CASE WHEN current_loan_status ILIKE '%incomp%' THEN 1 END) as incomplete,
  COUNT(CASE WHEN current_loan_status ILIKE '%denied%' THEN 1 END) as denied
FROM public.loans
WHERE current_status_date BETWEEN '2025-01-01' AND '2025-12-31'
  AND (current_loan_status ILIKE '%withdraw%' 
       OR current_loan_status ILIKE '%not accepted%' 
       OR current_loan_status ILIKE '%incomp%' 
       OR current_loan_status ILIKE '%denied%');
```

### ✅ RESOLVED: Previous Year Shows 28 Extra Units

**Symptoms:**
- YTD counts match Qlik ✅
- Previous year (2025) was showing 28 more units than Qlik ❌

**Root Cause Found:**
- **Qlik formula**: `Count([Loan Number])` - counts only NON-NULL values
- **Our SQL was**: `COUNT(*)` - counts ALL rows including those with NULL loan_number

**Fix Applied:**
Changed `total_units` metric in `metricsService.ts` from:
```sql
COUNT(*)
```
To:
```sql
COUNT(l.loan_number)
```

This matches Qlik's behavior of skipping loans where [Loan Number] is NULL.

**Verification Query:**

```sql
-- Check if there are loans with NULL loan_number (these are excluded in Qlik)
SELECT 
  COUNT(*) as total_rows,
  COUNT(loan_number) as non_null_loan_numbers,
  COUNT(*) - COUNT(loan_number) as null_loan_numbers
FROM public.loans
WHERE application_date BETWEEN '2025-01-01' AND '2025-12-31';
```

### Status Checklist

- [x] Lost Opportunities uses `current_status_date` (DateType='HMDA')
- [x] Status filter includes: withdraw, not accepted, incomp, denied
- [x] YTD counts match Qlik ✅
- [x] Previous year counts - Fixed NULL loan_number handling (COUNT(loan_number) vs COUNT(*))

---

## Related Files

### Qlik Source Files
- `QlikAppsAndLogicDictionaryDocs/Performance/tvd-coheus-performance-qlik/Scripts/Calendar-Link.qvs` - DateType mappings
- `QlikAppsAndLogicDictionaryDocs/Performance/tvd-performance-1-70-qlik/Script Additions Ranges.qvs` - Flags and ranges
- `QlikAppsAndLogicDictionaryDocs/Performance/tvd-coheus-performance-qlik/Scripts/Variables.qvs` - Variables
- `QlikAppsAndLogicDictionaryDocs/Performance/tvd-coheus-performance-qlik/QSDA-[1.6.0] Performance-*/Expressions.csv` - All expressions

### New Platform Files
- `server/src/routes/metrics.ts` - API endpoint (`/api/metrics/credit-risk`)
- `server/src/services/metrics/metricsService.ts` - Metric definitions and query functions
- `src/hooks/useCreditRiskData.ts` - Frontend data fetching hook
- `src/pages/CreditRiskManagement.tsx` - UI component

---

*Document created: January 2026*
*Last updated: January 2026*
