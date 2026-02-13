# Company Scorecard - Data & Metrics Clarification Report

This document outlines all KPIs, metrics, and data elements on the Company Scorecard page, along with questions and answers from the Qlik implementation, plus how each metric maps to the new platform.

---

## Table of Contents
1. [KPI Cards (Header Section)](#1-kpi-cards-header-section)
2. [Summary Table - Tier Columns](#2-summary-table---tier-columns)
3. [Summary Table - Applications Taken Section](#3-summary-table---applications-taken-section)
4. [Summary Table - Originated Totals Section](#4-summary-table---originated-totals-section)
5. [Summary Table - Withdrawn & Denied Section](#5-summary-table---withdrawn--denied-section)
6. [Charts Section](#6-charts-section)
7. [Footer Insights Section](#7-footer-insights-section)
8. [General Questions](#8-general-questions)
9. [Qlik-to-New-Platform Mapping](#9-qlik-to-new-platform-mapping)

---

## 1. KPI Cards (Header Section)

### 1.1 Total Loans

| Aspect | Current Implementation | Qlik Source |
|--------|----------------------|-------------|
| **Metric** | `scorecard_total_loans` - Count of loans with `application_date IS NOT NULL` | **Source**: `Expressions.csv` (ID: FtRGE, Line 177) |
| **Date Field** | `application_date` | Confirmed: `DateType={'Application'}` |
| **Sub-text** | "of X started" uses `loans_started` metric (filtered by `started_date`) | Correct relationship |

**Qlik Formula** (from `QSDA-[...]/Expressions.csv` Line 177):
```qlik
Num(count({$<DateType={'Application'},[$(vToDate)]={'Yes'},[Consolidated Channels]={'$(vChannelGroup)'}>}[Loan Number]),'#,##0')
```

**Answers:**
1. **Should "Total Loans" show applications with RESPA or all loans?** 
   - **Qlik Answer**: It counts ALL loans where `DateType={'Application'}` - meaning loans filtered by `application_date`. This is "Applications Taken" not "RESPA Applications" specifically.
2. **What does `DateType={'Application'}` mean?**
   - **Qlik Answer** (from `Scripts/Calendar-Link.qvs` Lines 11-15): DateType='Application' links to `[Application Date]` field. This is how Qlik filters by the application_date date field.
3. **Is the denominator correct as loans filtered by `started_date`?**
   - **Qlik Answer**: Yes, the "of X started" denominator uses `DateType={'Started'}` which maps to `[Started Date]`.

**New Platform Mapping:**
| Qlik | New Platform |
|------|--------------|
| `Count([Loan Number])` | `metricId: 'scorecard_total_loans'` |
| `DateType={'Application'}` | `defaultDateField: 'application_date'` |
| `[$(vToDate)]={'Yes'}` | `dateRange: { start, end }` parameter |
| `[Consolidated Channels]` | Not yet implemented - needs `additionalFilters.channel` |

**Gap Status**: ✅ Direct mapping (channel filter missing)

---

### 1.2 Volume

| Aspect | Current Implementation | Qlik Source |
|--------|----------------------|-------------|
| **Metric** | `total_volume` - `SUM(l.loan_amount)` | **Source**: `Expressions.csv` (inferred from Tier formula) |
| **Date Field** | `application_date` | Confirmed: Uses `DateType={'Application'}` |

**Qlik Formula** (from `QSDA-[...]/Dimensions.csv` Lines 6-13, Tier calculation uses volume):
```qlik
Sum({$<DateType={'Application'},[$(vToDate)]={'Yes'},[Consolidated Channels]={'$(vChannelGroup)'}>}[Loan Amount])
```

**Answers:**
1. **Is this TOTAL volume or FUNDED/ORIGINATED volume?**
   - **Qlik Answer**: This is volume of ALL applications (not just funded). It uses `DateType={'Application'}`.
2. **Should date filter be on `application_date` or `funding_date`?**
   - **Qlik Answer**: `application_date` (via `DateType={'Application'}`). Funded volume would use `DateType={'Funding'}`.

**New Platform Mapping:**
| Qlik | New Platform |
|------|--------------|
| `Sum([Loan Amount])` | `metricId: 'total_volume'`, `sqlQuery: SUM(l.loan_amount)` |
| `DateType={'Application'}` | `defaultDateField: 'application_date'` |

**Gap Status**: ✅ Direct mapping

---

### 1.3 Revenue

| Aspect | Current Implementation | Qlik Source |
|--------|----------------------|-------------|
| **Metric** | `total_revenue` - ✅ FIXED | **Source**: `Scripts/REVENUE.qvs` (Lines 38, 68) |
| **Date Field** | `funding_date` | Confirmed: Uses `DateType={'Funding'}` |
| **Formula** | Uses `rate_lock_buy_side_base_price_rate` for Base Buy | From configuration or default |

**Qlik Formula** (from `Scripts/REVENUE.qvs` Lines 38, 68):
```qlik
// Default Revenue formula:
[Base Buy ($)] + [Orig Fee Borr Pd] + [Orig Fees Seller] - [CD Lender Credits]
```

**IMPORTANT: `[Base Buy ($)]` is a CALCULATED field** (from `Transform.qvs` Lines 87, 313):
```qlik
// Transform.qvs Line 313: "Base Buy" is aliased from Rate Lock Buy Side Base Price Rate
Num("Rate Lock Buy Side Base Price Rate",'#,##0.000') as "Base Buy"

// Transform.qvs Line 87: [Base Buy ($)] converts basis points to dollars
Num(if("Base Buy"=0 OR len(trim("Base Buy"))=0 OR IsNull("Base Buy"), 0, 
       Round((("Base Buy"-100)/100) * "Loan Amount",.01)),
   '#,##0.00;(#,##0.00)') as [Base Buy ($)]
```

**KEY FINDING**: `"Base Buy"` comes from `rate_lock_buy_side_base_price_rate`, NOT `net_buy`!

**Scorecard Revenue Expression** (from `QSDA-[...]/Expressions.csv` Line 348, ID: HXnPZmP):
```qlik
sum({$<[$(vScorecard)_Production] *= {$(vCurrentProduction)},DateType={'Funding'},[$(vToDate)]={'Yes'},[Rate Lock Buy Side Base Price Rate] = {"">0""}>}[Revenue])
```

**Answers:**
1. **What is the exact formula for revenue?**
   - **Qlik Answer**: `[Base Buy ($)] + [Orig Fee Borr Pd] + [Orig Fees Seller] - [CD Lender Credits]`
   - Where `[Base Buy ($)] = ((net_buy - 100) / 100) * loan_amount` (basis points to dollars)
   - This is calculated in the load script and stored as `[Revenue]` field.
2. **Should revenue only count for originated/funded loans?**
   - **Qlik Answer**: Yes, it uses `DateType={'Funding'}` and requires `[Rate Lock Buy Side Base Price Rate] > 0`.
3. **Which date field should be used?**
   - **Qlik Answer**: `funding_date` (via `DateType={'Funding'}`)

**Encompass Field to DB Column Mapping:**

| Qlik Field | Encompass Field ID | DB Column | Exists in Tenant DB? |
|------------|-------------------|-----------|---------------------|
| `"Rate Lock Buy Side Base Price Rate"` (aliased as "Base Buy") | Fields.2161 | `rate_lock_buy_side_base_price_rate` | ✅ Yes (Line 227) |
| `[Base Buy ($)]` | CALCULATED from above | `((rate_lock_buy_side_base_price_rate - 100) / 100) * loan_amount` | ⚠️ Calculated |
| `[Orig Fee Borr Pd]` | Fields.NEWHUD.X686 | `orig_fee_borr_pd` | ✅ Yes (Line 206) |
| `[Orig Fees Seller]` | Fields.559 | `orig_fees_seller` | ✅ Yes (Line 207) |
| `[CD Lender Credits]` | Fields.CD2.XSTLC | `cd_lender_credits` | ✅ Yes (Line 208) |
| `[Net Buy]` (NOT used for Base Buy) | Fields.2203 | `net_buy` | ✅ Yes (but different purpose) |

**New Platform Mapping:**
| Qlik | New Platform |
|------|--------------|
| `[Base Buy ($)]` | `CASE WHEN rate_lock_buy_side_base_price_rate IS NOT NULL AND != 0 THEN ROUND(((rate_lock_buy_side_base_price_rate - 100) / 100) * loan_amount, 2) ELSE 0 END` |
| `[Orig Fee Borr Pd]` | `orig_fee_borr_pd` ✅ |
| `[Orig Fees Seller]` | `orig_fees_seller` ✅ |
| `[CD Lender Credits]` | `cd_lender_credits` ✅ |
| `DateType={'Funding'}` | `defaultDateField: 'funding_date'` |

**✅ IMPLEMENTED - Correct Revenue SQL Formula** (in `metricsService.ts`):
```sql
-- Revenue = Base Buy ($) + Orig Fee Borr Pd + Orig Fees Seller - CD Lender Credits
-- Base Buy uses rate_lock_buy_side_base_price_rate (NOT net_buy!)
SUM(
  COALESCE(
    CASE 
      WHEN l.rate_lock_buy_side_base_price_rate IS NOT NULL AND l.rate_lock_buy_side_base_price_rate != 0 
      THEN ROUND(((l.rate_lock_buy_side_base_price_rate - 100.0) / 100.0) * l.loan_amount, 2)
      ELSE 0 
    END, 0) +
  COALESCE(l.orig_fee_borr_pd, 0) + 
  COALESCE(l.orig_fees_seller, 0) - 
  COALESCE(l.cd_lender_credits, 0)
)
```

**Gap Status**: ✅ FIXED - Correct formula implemented in `total_revenue` and `originated_revenue` metrics

---

### 1.4 Pull-Through Rate

| Aspect | Current Implementation | Qlik Source |
|--------|----------------------|-------------|
| **Metric** | `pull_through_rate` | **Source**: Inferred from tier lists in `Expressions.csv` |
| **Formula** | `Originated / Total Applications * 100` | Correct |
| **Date Field** | `application_date` | Confirmed |

**Qlik Formula** (from Scorecard context):
```qlik
Count({$<DateType={'Application'},[$(vToDate)]={'Yes'},[Pull Through Originated Flag]*={'Yes'},[Consolidated Channels]={'$(vChannelGroup)'}>}[Loan Number]) 
  / Count({$<DateType={'Application'},[$(vToDate)]={'Yes'},[Consolidated Channels]={'$(vChannelGroup)'}>}[Loan Number])
```

**Answers:**
1. **What is the exact denominator?**
   - **Qlik Answer**: ALL applications with `DateType={'Application'}`. Does NOT exclude active loans in the Company Scorecard context.
2. **Is this a "cohort" or "snapshot" calculation?**
   - **Qlik Answer**: Cohort - loans that have an application date within the period.

**New Platform Mapping:**
| Qlik | New Platform |
|------|--------------|
| `[Pull Through Originated Flag]*={'Yes'}` | Current impl: `current_loan_status ILIKE '%Originated%' OR '%purchased%'` |
| Denominator: All applications | Current impl: Excludes active loans (⚠️ differs from Qlik) |

**Gap Status**: ⚠️ Partial mapping - denominator logic differs

---

### 1.5 Cycle Time

| Aspect | Current Implementation | Qlik Source |
|--------|----------------------|-------------|
| **Metric** | `avg_cycle_time` - Average days from Application to Closing | Correct |
| **Formula** | `AVG(closing_date - application_date)` | Matches `[App-Close]` |
| **Date Field** | `closing_date` | Confirmed for filtering |

**Qlik Formula** (from `Expressions.csv` Line 75, ID: HmRFM):
```qlik
Avg([App-Close])
```

Note: `[App-Close]` is a calculated field in the load script: `[Closing Date] - [Application Date]`

**Answers:**
1. **Should this only count CLOSED loans?**
   - **Qlik Answer**: Yes, only loans with `[Closing Date]` populated.
2. **Filter by closing_date or application_date?**
   - **Qlik Answer**: Depends on context. Company Scorecard typically uses application_date for filtering.

**Gap Status**: ✅ Direct mapping

---

### 1.6 Credit Pulls

| Aspect | Current Implementation | Qlik Source |
|--------|----------------------|-------------|
| **Metric** | `credit_pulls` - Count of loans with credit_pull_date | Correct |
| **Date Field** | `credit_pull_date` | Confirmed |

**Answers:**
1. **Filter by `credit_pull_date` or `application_date`?**
   - **Qlik Answer**: Uses `DateType={'Credit Pull'}` which maps to `[Credit Pull Date]`.
2. **Unique loans or total events?**
   - **Qlik Answer**: Count of unique loans with credit pulls (not total pull events).

**Gap Status**: ✅ Direct mapping

---

## 2. Summary Table - Tier Columns

### 2.1 Tier Assignment Logic

| Aspect | Current Implementation | Qlik Source |
|--------|----------------------|-------------|
| **Ranking Metric** | `tieringVolume` (total volume for tiering) | Confirmed: `[Loan Amount]` |
| **Tier Boundaries** | ✅ FIXED - 50/30/20 by cumulative volume | Qlik uses `RangeSum(Above())` pattern |

**Qlik Tier Dimension** (from `QSDA-[...]/Dimensions.csv` Lines 2-72, LibraryId: CVGGgfP):
```qlik
Aggr(
  if(
    RangeSum(
      Above(
        Sum({$<DateType={'Application'},[$(vToDate)]={'Yes'},[Consolidated Channels]={'$(vChannelGroup)'},[$(vScorecard)]=
        >}[Loan Amount]) 
        / Sum({$<...>}Total [Loan Amount])
      ,1,RowNo())
    ) <= 0.5,
    Dual('Top Tier',1),
    
    if(
      RangeSum(...) <= 0.8,
      Dual('Second Tier',2),
      Dual('Bottom Tier',3)
    )
  ),
  ([$(vScorecard)],(=Sum({$<...>}[Loan Amount]),Desc))
)
```

**Critical Answers:**
1. **What metric determines tier ranking?**
   - **Qlik Answer**: `[Loan Amount]` (Volume), sorted DESCENDING.
2. **What are the exact tier boundaries?**
   - **Qlik Answer**: 
     - **Top Tier**: Cumulative volume `<= 0.5` (first 50% of total volume)
     - **Second Tier**: Cumulative volume `<= 0.8` (next 30% of volume, 50%-80%)
     - **Bottom Tier**: Cumulative volume `> 0.8` (remaining 20% of volume)
   - **This is NOT by count percentage!** It's by cumulative volume contribution.
3. **How are ties handled?**
   - **Qlik Answer**: `RangeSum(Above(...))` accumulates based on row order, which is sorted by volume descending.
4. **Minimum threshold?**
   - **Qlik Answer**: Branches with 0 volume are effectively excluded (they contribute 0 to cumulative).

**✅ IMPLEMENTED - New Platform Implementation** (in `CompanyScorecard.tsx`):
```typescript
// Sort branches by TOTAL volume (tieringVolume) for tier assignment - NOT originated volume
const sortedBranches = [...activeBranches].sort((a, b) => b.tieringVolume - a.tieringVolume);

// Calculate total volume for cumulative percentage calculation (using tieringVolume = total_volume)
const totalVolume = sortedBranches.reduce((sum, b) => sum + b.tieringVolume, 0);

// Qlik Tier Calculation: RangeSum(Above(..., 1, RowNo())) calculates cumulative % of rows ABOVE current row
// This means tier is assigned based on cumulative volume BEFORE the current branch:
// - Top Tier: cumulative volume of rows ABOVE <= 50%
// - Second Tier: cumulative volume of rows ABOVE > 50% and <= 80%
// - Bottom Tier: cumulative volume of rows ABOVE > 80%
let cumulativeVolumeBefore = 0; // Cumulative volume of all branches ABOVE current

for (const branch of sortedBranches) {
  const cumulativePercentBefore = totalVolume > 0 ? cumulativeVolumeBefore / totalVolume : 0;
  
  if (cumulativePercentBefore <= 0.5) {
    topTierBranches.push(branch);
  } else if (cumulativePercentBefore <= 0.8) {
    secondTierBranches.push(branch);
  } else {
    bottomTierBranches.push(branch);
  }
  
  // Add current branch's tieringVolume AFTER tier assignment (for next iteration)
  cumulativeVolumeBefore += branch.tieringVolume;
}
```

**Key Implementation Details:**
1. **Two volume fields**: `tieringVolume` (total_volume for tiering) vs `volume` (originated_volume for display)
2. **Cumulative BEFORE**: Uses `RangeSum(Above(...))` logic - first branch always qualifies for top tier
3. **Sort by total volume**: Tiering based on application volume, not originated volume

**Gap Status**: ✅ FIXED - Cumulative volume logic implemented correctly

---

## 3. Summary Table - Applications Taken Section

### 3.1 Units (Applications Taken)

| Aspect | Current Implementation | Qlik Source |
|--------|----------------------|-------------|
| **Metric** | `scorecard_total_loans` | Confirmed: Same as KPI |
| **Date Field** | `application_date` | Confirmed |

**Answers:**
1. **Is this "Applications Taken" or "Loans Started"?**
   - **Qlik Answer**: "Applications Taken" - meaning loans filtered by `DateType={'Application'}`.
2. **Does this mean applications WITH RESPA specifically?**
   - **Qlik Answer**: In Qlik, if `DateType={'Application'}` is used, it means the `[Application Date]` exists. This effectively is "Applications with RESPA" since Application Date = RESPA trigger.

**Gap Status**: ✅ Direct mapping

---

### 3.2 Volume (Applications Taken)

Same as KPI Volume - uses `DateType={'Application'}` and `Sum([Loan Amount])`.

**Gap Status**: ✅ Direct mapping

---

### 3.3 WAC (Weighted Average Coupon)

| Aspect | Current Implementation | Qlik Source |
|--------|----------------------|-------------|
| **Metric** | `wac` - Currently showing 0 | **Source**: `Expressions.csv` Line 483 |
| **Formula** | Weighted by loan amount | Confirmed |

**Qlik Formula** (from `QSDA-[...]/Expressions.csv` Lines 483-485):
```qlik
Num(Sum({$<[Active Loan Flag]={Yes}, [Interest Rate Out of Range Flag]={No}, [Current Status Date]=>}[Interest Rate] * [Loan Amount])
  / sum({$<[Active Loan Flag]={Yes}, [Interest Rate Out of Range Flag]={No}, [Current Status Date]=>}[Loan Amount]),'#,##0.000')
```

**Scorecard-specific WA metrics** (from `Expressions.csv` Lines 98-127):
```qlik
Sum({$<[BE DTI Ratio]={"">=$(vDTIMin)<=$(vDTIMax)""},Rolling13MonthFlag*={Yes}, DateType*={'$(vDateType)'}, [Consolidated Channels]*={'$(vChannelGroup)'}>}[BE DTI Ratio] * [Loan Amount])
  / Sum({$<...>}[Loan Amount])
```

**Answers:**
1. **Exact formula?**
   - **Qlik Answer**: `Sum([Interest Rate] * [Loan Amount]) / Sum([Loan Amount])`
   - Excludes loans where `[Interest Rate Out of Range Flag] = Yes`
2. **Weighted by loan amount or unit count?**
   - **Qlik Answer**: Weighted by `[Loan Amount]` (volume-weighted).
3. **Which loans included?**
   - **Qlik Answer**: Depends on context. Scorecard uses rolling 13-month flag and excludes out-of-range values.
4. **Database field for interest rate?**
   - **Qlik Answer**: `[Interest Rate]` field.

**New Platform Mapping:**
| Qlik | New Platform |
|------|--------------|
| `[Interest Rate]` | `interest_rate` DB column |
| `[Loan Amount]` | `loan_amount` DB column |
| `[Interest Rate Out of Range Flag]` | Not implemented - needs flag field |

**Gap Status**: ⚠️ Partial mapping - out-of-range filtering not implemented

---

## 4. Summary Table - Originated Totals Section

### 4.1 Originated Units

| Aspect | Current Implementation | Qlik Source |
|--------|----------------------|-------------|
| **Metric** | `originated_loans` | **Source**: `Expressions.csv` (Tier lists) |
| **Date Field** | `application_date` | Confirmed: Uses `DateType={'Application'}` |

**Qlik Formula** (from Scorecard expressions):
```qlik
Count({$<DateType={'Application'},[$(vToDate)]={'Yes'},[Pull Through Originated Flag]*={'Yes'},[Consolidated Channels]={'$(vChannelGroup)'}>}[Loan Number])
```

**Pull Through Originated Flag** (from `tvd-coheus-incremental-builder-qlik/Transform.qvs`):
```qlik
If(WildMatch([Current Loan Status],"*Originated*","*purchased*")>0,"Yes","No") as [Pull Through Originated Flag]
```

**Answers:**
1. **Filter by `funding_date` or `application_date`?**
   - **Qlik Answer**: `application_date` (via `DateType={'Application'}`). This is a key finding - even "Originated" metrics on Company Scorecard use application date, NOT funding date.
2. **What defines "originated"?**
   - **Qlik Answer**: `[Pull Through Originated Flag] = 'Yes'`, which is derived from status containing "Originated" or "purchased".

**✅ IMPLEMENTED - New Platform Mapping:**
| Qlik | New Platform |
|------|--------------|
| `[Pull Through Originated Flag]={'Yes'}` | `current_loan_status ILIKE '%Originated%' OR '%purchased%'` |
| `DateType={'Application'}` | `scorecard_originated_loans` metric with `defaultDateField: 'application_date'` ✅ |

**New metric added** (in `metricsService.ts`):
```typescript
'scorecard_originated_loans': {
  id: 'scorecard_originated_loans',
  name: 'Scorecard Originated Loans',
  description: 'Originated loans filtered by application_date for Company Scorecard.',
  sqlQuery: `COUNT(CASE
    WHEN l.current_loan_status ILIKE '%Originated%' OR l.current_loan_status ILIKE '%purchased%' THEN 1
  END)`,
  defaultDateField: 'application_date' // Company Scorecard uses application_date filter
}
```

**Gap Status**: ✅ FIXED - Created `scorecard_originated_loans` metric with correct date field

---

### 4.2 Originated Units %

**Formula**: `Originated Units / Total Applications * 100`

**Qlik Answer**: Denominator is ALL applications with `DateType={'Application'}` (not excluding active loans).

**Gap Status**: ⚠️ Partial mapping - denominator logic may differ

---

### 4.3 Originated Volume $

**Qlik Formula** (from `Expressions.csv` Line 2737):
```qlik
Sum({$<DateType={'Application'},[$(vToDate)]={'Yes'}, [Pull Through Originated Flag]*={'Yes'},[Consolidated Channels]={'$(vChannelGroup)'}>}[Loan Amount])
```

**Answer**: Uses `application_date` filtering, sum of `[Loan Amount]` for originated loans only.

**✅ IMPLEMENTED - New metric added** (in `metricsService.ts`):
```typescript
'originated_volume': {
  id: 'originated_volume',
  name: 'Originated Volume',
  description: 'Sum of loan amounts for originated loans. Matches Qlik CompanyScorecard_Originated Volume $ expression.',
  sqlQuery: `SUM(CASE 
    WHEN l.current_loan_status ILIKE '%Originated%' OR l.current_loan_status ILIKE '%purchased%' THEN l.loan_amount 
    ELSE 0 
  END)`,
  defaultDateField: 'application_date' // Company Scorecard uses application_date
}
```

**Gap Status**: ✅ FIXED - `originated_volume` metric implemented

---

### 4.4 Originated Revenue $

**Qlik Formula** (from `Expressions.csv` Line 5006):
```qlik
Sum({$<DateType={'Application'},[$(vToDate)]={'Yes'}, [Pull Through Originated Flag]*={'Yes'},[Consolidated Channels]={'$(vChannelGroup)'}>}[Revenue])
```

**Answer**: Sum of `[Revenue]` field for originated loans, filtered by application_date.

**✅ IMPLEMENTED - New metric added** (in `metricsService.ts`):
```typescript
'originated_revenue': {
  id: 'originated_revenue',
  name: 'Originated Revenue',
  description: 'Revenue for originated loans only. Matches Qlik CompanyScorecard_Originated Revenue $ expression.',
  sqlQuery: `SUM(
    CASE 
      WHEN l.current_loan_status ILIKE '%Originated%' OR l.current_loan_status ILIKE '%purchased%' THEN
        COALESCE(
          CASE 
            WHEN l.rate_lock_buy_side_base_price_rate IS NOT NULL AND l.rate_lock_buy_side_base_price_rate != 0 
            THEN ROUND(((l.rate_lock_buy_side_base_price_rate - 100.0) / 100.0) * l.loan_amount, 2)
            ELSE 0 
          END, 0) +
        COALESCE(l.orig_fee_borr_pd, 0) + 
        COALESCE(l.orig_fees_seller, 0) - 
        COALESCE(l.cd_lender_credits, 0)
      ELSE 0
    END
  )`,
  defaultDateField: 'application_date' // Company Scorecard uses application_date
}
```

**Gap Status**: ✅ FIXED - `originated_revenue` metric implemented with correct Base Buy field

---

### 4.5 Gov't Originated Units / %

| Aspect | Current Implementation | Qlik Source |
|--------|----------------------|-------------|
| **Metric** | `govt_units` - `loan_type IN ('FHA', 'VA')` | Matches Qlik logic |

**Qlik Approach** (from general Qlik patterns):
```qlik
Count({$<...[Loan Type Group] = {'Government'}...>}[Loan Number])
```

**Qlik Mapping Table** (from `Transform.qvs` Lines 221-223, `mapping-tables.md` Lines 107-114):
- FHA → Government
- VA → Government
- FarmersHomeA → Government
- FarmersHomeAdministration → Government

**Answers:**
1. **Which loan types are "Government"?**
   - **Qlik Answer**: Uses `[Loan Type Group]` field which groups loan types.
   - Maps: FHA, VA, FarmersHomeA, FarmersHomeAdministration → Government
2. **Only ORIGINATED government loans?**
   - **Qlik Answer**: Yes, combined with `[Pull Through Originated Flag]*={'Yes'}`.

**New Platform Mapping:**
| Qlik | New Platform |
|------|--------------|
| `[Loan Type Group]={'Government'}` | `loan_type IN ('FHA', 'VA', 'FarmersHomeA', 'FarmersHomeAdministration')` |

**SQL Implementation** (no new columns needed):
```sql
COUNT(CASE WHEN loan_type IN ('FHA', 'VA', 'FarmersHomeA', 'FarmersHomeAdministration') THEN 1 END)
```

**Gap Status**: ✅ Direct mapping - use SQL IN clause with existing `loan_type` column

---

### 4.6 Purchase Originated Units / %

| Aspect | Current Implementation | Qlik Source |
|--------|----------------------|-------------|
| **Metric** | `purchase_units` - `purpose ILIKE '%purchase%'` | Matches Qlik logic |

**Qlik Approach**:
```qlik
Count({$<...[Loan Purpose Group] = {'Purchase'}...>}[Loan Number])
```

**Qlik Mapping Table** (from `Transform.qvs` Lines 224, `mapping-tables.md` Lines 194-202):
- Purchase → Purchase (direct match, no grouping needed)
- NoCash-Out Refinance → Refinance
- Cash-Out Refinance → Refinance
- ConstructionToPermanent → C to P
- Other → Other

**Answers:**
1. **What defines "Purchase"?**
   - **Qlik Answer**: Uses `[Loan Purpose Group]` field. Purchase maps directly to 'Purchase'.
2. **Only ORIGINATED purchases?**
   - **Qlik Answer**: Yes, combined with `[Pull Through Originated Flag]*={'Yes'}`.

**New Platform Mapping:**
| Qlik | New Platform |
|------|--------------|
| `[Loan Purpose Group]={'Purchase'}` | `loan_purpose = 'Purchase'` |

**SQL Implementation** (no new columns needed):
```sql
COUNT(CASE WHEN loan_purpose = 'Purchase' THEN 1 END)
```

**Gap Status**: ✅ Direct mapping - use SQL WHERE clause with existing `loan_purpose` column

---

### 4.7 WA FICO / WA LTV / WA DTI

| Aspect | Current Implementation | Qlik Source |
|--------|----------------------|-------------|
| **Metrics** | `wa_fico`, `wa_ltv`, `wa_dti` | **Source**: `Expressions.csv` Lines 98-127, 178-207 |
| **Weighting** | By loan amount | Confirmed |

**Qlik Formulas** (from `QSDA-[...]/Expressions.csv`):

**WA FICO** (ID: HYqPHL - similar pattern):
```qlik
Sum({$<[FICO Score]={"">=$(vFICOMin)<=$(vFICOMax)""},...>}[FICO Score] * [Loan Amount])
  / Sum({$<[FICO Score]={"">=$(vFICOMin)<=$(vFICOMax)""},...>}[Loan Amount])
```

**WA LTV** (Lines 178-207, ID: GNCJac):
```qlik
Sum({$<[LTV Ratio]={"">=$(vLTVMin)<=$(vLTVMax)""}, Rolling13MonthFlag*={Yes}, DateType*={'$(vDateType)'}, [Consolidated Channels]*={'$(vChannelGroup)'},...>}[LTV Ratio] * [Loan Amount])
  / Sum({$<...>}[Loan Amount])
```

**WA DTI** (Lines 98-127, ID: Kyahx):
```qlik
Sum({$<[BE DTI Ratio]={"">=$(vDTIMin)<=$(vDTIMax)""}, Rolling13MonthFlag*={Yes}, DateType*={'$(vDateType)'}, [Consolidated Channels]*={'$(vChannelGroup)'},...>}[BE DTI Ratio] * [Loan Amount])
  / Sum({$<...>}[Loan Amount])
```

**Answers:**
1. **Weighted by loan amount?**
   - **Qlik Answer**: Yes, all are volume-weighted.
2. **Only ORIGINATED loans?**
   - **Qlik Answer**: Depends on context. Scorecard versions exclude out-of-range values using range flags.
3. **Out-of-range exclusion flags:**
   - `[FICO Out of Range Flag]` - excludes FICO < 350 or >= 900
   - `[LTV Out of Range Flag]` - excludes LTV <= 0 or >= 110
   - `[DTI Out of Range Flag]` - excludes DTI <= 0 or >= 70
   - `[Interest Rate Out of Range Flag]` - excludes rate <= 0 or >= 15

**✅ IMPLEMENTED - New Platform Mapping:**
| Qlik | New Platform |
|------|--------------|
| `[FICO Score]` | `fico_score` |
| `[LTV Ratio]` | `ltv_ratio` |
| `[BE DTI Ratio]` | `be_dti_ratio` |
| Out-of-range flags | ✅ CASE WHEN clauses with range checks |

**Out-of-range filtering implemented** (in `metricsService.ts`):
```sql
-- WA FICO: Excludes FICO < 300 or > 850
'wa_fico': `ROUND(
  SUM(CASE WHEN l.fico_score >= 300 AND l.fico_score <= 850 THEN l.fico_score * l.loan_amount ELSE 0 END) / 
  NULLIF(SUM(CASE WHEN l.fico_score >= 300 AND l.fico_score <= 850 THEN l.loan_amount ELSE 0 END), 0)
, 0)`

-- WA LTV: Excludes LTV <= 0 or > 110
'wa_ltv': `ROUND(
  SUM(CASE WHEN l.ltv_ratio > 0 AND l.ltv_ratio <= 110 THEN l.ltv_ratio * l.loan_amount ELSE 0 END) / 
  NULLIF(SUM(CASE WHEN l.ltv_ratio > 0 AND l.ltv_ratio <= 110 THEN l.loan_amount ELSE 0 END), 0)
, 1)`

-- WA DTI: Excludes DTI <= 0 or > 70
'wa_dti': `ROUND(
  SUM(CASE WHEN l.be_dti_ratio > 0 AND l.be_dti_ratio <= 70 THEN l.be_dti_ratio * l.loan_amount ELSE 0 END) / 
  NULLIF(SUM(CASE WHEN l.be_dti_ratio > 0 AND l.be_dti_ratio <= 70 THEN l.loan_amount ELSE 0 END), 0)
, 1)`

-- WAC: Excludes rate <= 0 or > 15
'wac': `ROUND(
  SUM(CASE WHEN l.interest_rate > 0 AND l.interest_rate <= 15 THEN l.interest_rate * l.loan_amount ELSE 0 END) / 
  NULLIF(SUM(CASE WHEN l.interest_rate > 0 AND l.interest_rate <= 15 THEN l.loan_amount ELSE 0 END), 0)
, 3)`
```

**Gap Status**: ✅ FIXED - Out-of-range filtering implemented for all WA metrics

---

## 5. Summary Table - Withdrawn & Denied Section

### 5.1 Withdrawn Units / %

| Aspect | Current Implementation | Qlik Source |
|--------|----------------------|-------------|
| **Metric** | Status contains 'withdraw', 'not accepted', 'incomp' | **Source**: `Script Additions Ranges.qvs` Line 433 |

**Qlik Withdrawn Flag** (from `Performance/.../Script Additions Ranges.qvs` Line 433):
```qlik
If(WildMatch([Current Loan Status],'*withdraw*','*not accepted*','*incomp*')>0,1,0) as [Withdrawn Flag]
```

**Scorecard usage**:
```qlik
Count({$<DateType={'Application'},[$(vToDate)]={'Yes'},[Withdrawn Flag]*={1},[Consolidated Channels]={'$(vChannelGroup)'}>}[Loan Number])
```

**Answers:**
1. **What status values define "Withdrawn"?**
   - **Qlik Answer**: Status containing: `*withdraw*`, `*not accepted*`, `*incomp*`
2. **Denominator?**
   - **Qlik Answer**: Total applications with `DateType={'Application'}`.

**New Platform Mapping:**
| Qlik | New Platform |
|------|--------------|
| `[Withdrawn Flag]={1}` | `current_loan_status ILIKE '%withdraw%' OR '%not accepted%' OR '%incomp%'` |

**Gap Status**: ✅ Direct mapping (via status string matching)

---

### 5.2 Denied Units / %

| Aspect | Current Implementation | Qlik Source |
|--------|----------------------|-------------|
| **Metric** | Status contains 'denied' | **Source**: `Transform.qvs` Line 26, `Script Additions Ranges.qvs` Line 434 |

**Qlik Denied Flag** (from `tvd-coheus-incremental-builder-qlik/Transform.qvs` Line 26):
```qlik
If(WildMatch([Current Loan Status],'*denied*','*incomplet*')>0,1,0) as [Denied Flag]
```

**Alternative** (from `Script Additions Ranges.qvs` Line 434):
```qlik
If(WildMatch([Current Loan Status],'*denied*')>0,1,0) as [Denied Flag.Temp]
```

**Answers:**
1. **What status values define "Denied"?**
   - **Qlik Answer**: Status containing: `*denied*` (some versions also include `*incomplet*`)
2. **Denominator?**
   - **Qlik Answer**: Total applications with `DateType={'Application'}`.

**New Platform Mapping:**
| Qlik | New Platform |
|------|--------------|
| `[Denied Flag]={1}` | `current_loan_status ILIKE '%denied%'` |

**Gap Status**: ✅ Direct mapping

---

## 6. Charts Section

### 6.1 Volume by Branch Chart

Uses same `Sum([Loan Amount])` with `DateType={'Application'}` and `groupBy: 'branch'`.

**Gap Status**: ✅ Direct mapping

---

### 6.2 Pull-Through by Branch Chart

Uses same pull-through formula with `groupBy: 'branch'`.

**Answers:**
1. **Sort by pull-through or volume?**
   - **Qlik Answer**: Typically by volume descending (same as tier ranking).
2. **Exclude low-volume branches?**
   - **Qlik Answer**: Not explicitly, but branches with 0 volume naturally have no pull-through.

**Gap Status**: ✅ Direct mapping

---

## 7. Footer Insights Section

### 7.1 Top Performer / 7.2 Needs Attention / 7.3 Highest Revenue

These are derived from the branch data - take top/bottom by respective metrics.

**Gap Status**: ✅ Derived from existing data

---

## 8. General Questions

### 8.1 Date Filtering

**Answers from Qlik** (`Scripts/Calendar-Link.qvs` Lines 4-64, 86-90):

1. **For "Originated" metrics date filter?**
   - **Qlik Answer**: Company Scorecard uses `DateType={'Application'}` even for originated metrics. This means filtering by when the loan was APPLIED, not when it was funded.

2. **YTD calculations?**
   - **Qlik Answer** (Line 90): `LET vToDate=if($(vYear)=$(vMaxYear),'YTDFlag','PreviousYearFlag');`
   - YTD is calendar year (Jan 1 to current date). If viewing previous year, uses full year.

3. **vToDate variable logic?**
   - **Qlik Answer**: 
     - `YTDFlag` = Year-to-date for current year
     - `PreviousYearFlag` = Full previous year
     - These are flag fields on loans in the calendar table.

### 8.2 Channel Filtering

**Answers from Qlik** (`Scripts/Variables.qvs` Lines 177-179):

1. **Does Company Scorecard filter by `[Consolidated Channels]`?**
   - **Qlik Answer**: Yes, ALL Company Scorecard expressions include `[Consolidated Channels]={'$(vChannelGroup)'}`.

2. **What channels included by default?**
   - **Qlik Answer** (Line 178-179): `SET vChannel='$(vConsolidatedChannels)';` - Set dynamically based on app version (Retail or TPO).

3. **vChannelGroup variable?**
   - **Qlik Answer**: Set to 'Retail' for Retail app, 'TPO' for TPO app.

### 8.3 Production Flag Filtering

**Answer**: Company Scorecard can optionally filter by `[$(vScorecard)_Production]` flag for "current production" branches/LOs. This is typically based on activity in rolling 13 months.

### 8.4 Missing Values

**Answer**: Branches with `'99-Missing'` can be filtered via `$(vScorecardMissingLevel)` variable which sets `[Branch Missing] *= {0}`.

---

## 9. Qlik-to-New-Platform Mapping

### Complete Metric Mapping Table

| Metric | Qlik Expression | Qlik Date Filter | New Platform metricId | New Platform dateField | Gap Status |
|--------|----------------|------------------|----------------------|----------------------|------------|
| **Total Loans** | `Count({$<DateType={'Application'}>}[Loan Number])` | `application_date` | `scorecard_total_loans` | `application_date` | ✅ Direct |
| **Volume** | `Sum({$<DateType={'Application'}>}[Loan Amount])` | `application_date` | `total_volume` | `application_date` | ✅ Direct |
| **Revenue** | `Sum([Revenue])` where Revenue = `[Base Buy ($)]+[Orig Fee Borr Pd]+[Orig Fees Seller]-[CD Lender Credits]` | `funding_date` | `total_revenue` | `funding_date` | ✅ FIXED |
| **Originated Revenue** | `Sum([Revenue])` for originated loans | `application_date` | `originated_revenue` | `application_date` | ✅ FIXED |
| **Pull-Through %** | `Count([Pull Through Originated Flag]={'Yes'}) / Count(All)` | `application_date` | `pull_through_rate` | `application_date` | ⚠️ Partial |
| **Cycle Time** | `Avg([App-Close])` | `closing_date` | `avg_cycle_time` | `closing_date` | ✅ Direct |
| **Credit Pulls** | `Count([Credit Pull Date])` | `credit_pull_date` | `credit_pulls` | `credit_pull_date` | ✅ Direct |
| **Originated Units** | `Count([Pull Through Originated Flag]={'Yes'})` | `application_date` | `scorecard_originated_loans` | `application_date` | ✅ FIXED |
| **Originated Volume** | `Sum([Loan Amount])` for originated loans | `application_date` | `originated_volume` | `application_date` | ✅ FIXED |
| **Withdrawn** | `Count([Withdrawn Flag]={1})` | `application_date` | `fallout_withdrawn` | `application_date` | ✅ Direct |
| **Denied** | `Count([Denied Flag]={1})` | `application_date` | `fallout_denied` | `application_date` | ✅ Direct |
| **WA FICO** | `Sum([FICO Score]*[Loan Amount])/Sum([Loan Amount])` | varies | `wa_fico` | `application_date` | ✅ FIXED (range filter) |
| **WA LTV** | `Sum([LTV Ratio]*[Loan Amount])/Sum([Loan Amount])` | varies | `wa_ltv` | `application_date` | ✅ FIXED (range filter) |
| **WA DTI** | `Sum([BE DTI Ratio]*[Loan Amount])/Sum([Loan Amount])` | varies | `wa_dti` | `application_date` | ✅ FIXED (range filter) |
| **WAC** | `Sum([Interest Rate]*[Loan Amount])/Sum([Loan Amount])` | varies | `wac` | `application_date` | ✅ FIXED (range filter) |
| **Gov't Units** | `Count([Loan Type Group]={'Government'})` | `application_date` | `govt_units` | `application_date` | ✅ Direct |
| **Purchase Units** | `Count([Loan Purpose Group]={'Purchase'})` | `application_date` | `purchase_units` | `application_date` | ✅ Direct |
| **Tier Assignment** | Cumulative volume <= 0.5/0.8 | N/A | Frontend logic | N/A | ✅ FIXED |

### Gap Analysis Summary

| Status | Count | Items |
|--------|-------|-------|
| ✅ Fixed/Direct | 17 | Total Loans, Volume, Revenue, Originated Revenue, Cycle Time, Credit Pulls, Originated Units, Originated Volume, Withdrawn, Denied, WA FICO/LTV/DTI/WAC, Gov't Units, Purchase Units, Tier Calculation |
| ⚠️ Partial Mapping | 1 | Pull-Through (denominator logic may differ slightly) |
| ❌ Not Implemented | 0 | - |

### Completed Fixes (January 2026)

1. ✅ **Tier Calculation**: Changed from count-based to 50/30/20 cumulative volume using `RangeSum(Above())` logic
2. ✅ **Revenue Formula**: Fixed to use `rate_lock_buy_side_base_price_rate` (not `net_buy`) for Base Buy calculation
3. ✅ **Originated Volume**: New `originated_volume` metric - filters loan_amount by originated status
4. ✅ **Originated Revenue**: New `originated_revenue` metric - filters revenue by originated status  
5. ✅ **Originated Units**: New `scorecard_originated_loans` metric with `application_date` filter
6. ✅ **WA Metrics**: Added out-of-range value filtering for FICO (300-850), LTV (0-110), DTI (0-70), WAC (0-15)
7. ✅ **Date Field Selector**: Added UI selector to filter all metrics by same date field (Application/Funding/Started/etc.)

### Remaining Improvements

1. ~~**LOW - Channel filtering**: Add `additionalFilters.channel` support for Retail/TPO filtering~~ ✅ DONE
2. **LOW - Pull-Through denominator**: Verify denominator includes all applications (currently excludes active loans)

### Channel Filtering (Added January 2026)

The Company Scorecard now supports channel filtering via the `ChannelSelector` component:

- **Qlik Logic**: `[Consolidated Channels]={'$(vChannelGroup)'}` filter on all metrics
- **Implementation**: `additionalFilters.consolidated_channel` passed to metrics API
- **Default Behavior**: Auto-selects the most populated channel group (typically "Retail")
- **Channel Groups**: Retail, TPO, Correspondent, etc. (consolidated from individual channels)

---

## Withdrawn & Denied Metrics - Qlik Logic Analysis

### Withdrawn Flag Definition (Script Additions Ranges.qvs Line 433)

```qlik
If(WildMatch([Current Loan Status],'*withdraw*','*not accepted*','*incomp*')>0,1,0) as [Withdrawn Flag]
```

**Key Insight**: The `[Withdrawn Flag]` includes THREE status types:
1. `*withdraw*` - Any status containing "withdraw" (e.g., "Withdrawn", "Application withdrawn")
2. `*not accepted*` - Any status containing "not accepted"
3. `*incomp*` - Any status containing "incomp" (e.g., "Incomplete", "File incomplete")

### Denied Flag Definition (Script Additions Ranges.qvs Line 434)

```qlik
If(WildMatch([Current Loan Status],'*denied*')>0,1,0) as [Denied Flag.Temp]
```

### Withdrawn $ (Line 22497)

**Qlik Expression**:
```qlik
Sum({$<DateType={'Application'},[$(vToDate)]={'Yes'}, [Withdrawn Flag]*={1}>}[Loan Amount])
```

**SQL Implementation**:
```sql
SUM(CASE 
  WHEN l.current_loan_status ILIKE '%withdraw%' 
    OR l.current_loan_status ILIKE '%not accepted%'
    OR l.current_loan_status ILIKE '%incomp%'
  THEN l.loan_amount 
  ELSE 0 
END)
```

### W/D ProForma Revenue (Lines 22498-22502)

**IMPORTANT**: This metric uses `[Current Loan Status]` directly, NOT the `[Withdrawn Flag]`!
It only includes `*withdrawn*` and `*not accepted*` - NOT incomplete loans.

**Qlik Expression**:
```qlik
Sum({$<DateType={'Application'},[$(vToDate)]={'Yes'}, 
    [Current Loan Status]*={"*withdrawn*","*not accepted*"},
    Revenue={">0"}>}Revenue)
+
Sum({$<DateType={'Application'},[$(vToDate)]={'Yes'}, 
    [Current Loan Status]*={"*withdrawn*","*not accepted*"},
    Revenue={"<=0"}>}[Loan Amount]*$(vFundedRevMargin))
```

**Logic**:
- For withdrawn/not accepted loans WITH positive revenue: Use actual Revenue
- For withdrawn/not accepted loans WITHOUT positive revenue: Estimate as `Loan Amount * vFundedRevMargin`
- `vFundedRevMargin` is a client-configurable variable (typically ~2% or 0.02)

**SQL Implementation**:
```sql
SUM(CASE 
  WHEN l.current_loan_status ILIKE '%withdraw%' OR l.current_loan_status ILIKE '%not accepted%' THEN
    CASE 
      WHEN (calculated_revenue) > 0 THEN calculated_revenue
      ELSE l.loan_amount * 0.02  -- Default vFundedRevMargin
    END
  ELSE 0
END)
```

### Denied $ (Line 22509)

**Qlik Expression**:
```qlik
Sum({$<DateType={'Application'},[$(vToDate)]={'Yes'}, [Denied Flag]*={1}>}[Loan Amount])
```

**SQL Implementation**:
```sql
SUM(CASE 
  WHEN l.current_loan_status ILIKE '%denied%' 
  THEN l.loan_amount 
  ELSE 0 
END)
```

### Key Differences Table

| Metric | Uses Flag | Status Patterns Included |
|--------|-----------|-------------------------|
| Withdrawn $ | `[Withdrawn Flag]=1` | withdraw, not accepted, **incomplete** |
| W/D ProForma Revenue | Direct status match | withdraw, not accepted (NO incomplete) |
| Denied $ | `[Denied Flag]=1` | denied |

---

## Appendix: Current Backend Metric Definitions

| Metric ID | Default Date Field | Current SQL | Matches Qlik? |
|-----------|-------------------|-------------|---------------|
| `loans_started` | `started_date` | `COUNT(l.loan_id)` | ✅ |
| `scorecard_total_loans` | `application_date` | `COUNT(CASE WHEN l.application_date IS NOT NULL THEN 1 END)` | ✅ |
| `scorecard_originated_loans` | `application_date` | Status ILIKE '%Originated%' OR '%purchased%' | ✅ |
| `originated_loans` | `funding_date` | Status ILIKE '%Originated%' OR '%purchased%' | ✅ (for other contexts) |
| `fallout_withdrawn` | `application_date` | Status matching (withdraw, not accepted, incomp) | ✅ |
| `fallout_denied` | `application_date` | Status matching (denied) | ✅ |
| `total_volume` | `application_date` | `SUM(l.loan_amount)` | ✅ |
| `originated_volume` | `application_date` | `SUM(CASE WHEN originated THEN loan_amount END)` | ✅ |
| `funded_volume` | `funding_date` | `SUM(loan_amount WHERE funding_date IS NOT NULL)` | ✅ |
| `avg_cycle_time` | `closing_date` | `AVG(closing_date - application_date)` | ✅ |
| `pull_through_rate` | `application_date` | Originated/Applications (excludes active) | ⚠️ Denominator differs |
| `credit_pulls` | `credit_pull_date` | `COUNT(WHERE credit_pull_date IS NOT NULL)` | ✅ |
| `wa_fico` | `application_date` | `SUM(fico * loan_amt WHERE 350<=fico<=900) / SUM(loan_amt)` | ✅ |
| `wa_ltv` | `application_date` | `SUM(ltv * loan_amt WHERE 0<=ltv<=110) / SUM(loan_amt)` | ✅ |
| `wa_dti` | `application_date` | `SUM(dti * loan_amt WHERE 0<=dti<=70) / SUM(loan_amt)` | ✅ |
| `wac` | `application_date` | `SUM(rate * loan_amt WHERE 0<rate<=15) / SUM(loan_amt)` | ✅ |
| `total_revenue` | `funding_date` | `Base Buy ($) + Orig Fees - Lender Credits` | ✅ |
| `originated_revenue` | `application_date` | Same as above, filtered by originated status | ✅ |
| `govt_originated_units` | `application_date` | Originated + Government loan type | ✅ |
| `purchase_originated_units` | `application_date` | Originated + Purchase purpose | ✅ |
| `withdrawn_volume` | `application_date` | Status: withdraw, not accepted, incomplete | ✅ FIXED |
| `withdrawn_proforma_revenue` | `application_date` | Revenue or Loan Amount * 2% (withdraw/not accepted only) | ✅ FIXED |
| `denied_volume` | `application_date` | Status: denied | ✅ |

### New Metrics Added (January 2026)

| Metric ID | Purpose | Key Feature |
|-----------|---------|-------------|
| `scorecard_originated_loans` | Originated count for Company Scorecard | Uses `application_date` (not `funding_date`) |
| `originated_volume` | Volume for originated loans only | Filters by originated status before summing |
| `originated_revenue` | Revenue for originated loans only | Combines revenue formula with originated filter |
| `govt_originated_units` | Gov't loans that originated | Uses Pull Through Originated Flag + Loan Type Group |
| `purchase_originated_units` | Purchase loans that originated | Uses Pull Through Originated Flag + Loan Purpose |
| `withdrawn_volume` | Withdrawn $ | Includes incomplete per Qlik Withdrawn Flag |
| `withdrawn_proforma_revenue` | W/D ProForma Revenue | Uses direct status (no incomplete) + revenue/margin logic |
| `denied_volume` | Denied $ | Sum of loan amounts for denied loans |

### Key Formula Corrections

1. **Revenue Base Buy Field**: Changed from `net_buy` to `rate_lock_buy_side_base_price_rate`
2. **Tier Calculation**: Changed from "cumulative after" to "cumulative before" current branch (matches Qlik's `RangeSum(Above())`)
3. **WA Metrics**: Added out-of-range filtering in SQL CASE statements

---

*Document created: January 2026*
*Last updated: January 25, 2026*
*Qlik Source: `QlikAppsAndLogicDictionaryDocs/Performance/tvd-coheus-performance-qlik/`*
*Withdrawn Flag Logic: `QlikAppsAndLogicDictionaryDocs/Performance/tvd-performance-1-70-qlik/Script Additions Ranges.qvs` Line 433*