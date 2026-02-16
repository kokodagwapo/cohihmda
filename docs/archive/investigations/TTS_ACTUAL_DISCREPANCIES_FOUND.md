# TTS Score Discrepancies - ACTUAL FINDINGS

**Date:** January 26, 2026  
**Status:** Complete Analysis - All Discrepancies Documented  
**Source:** Performance App QSDA-[1.7.0] Performance - Homestead-a80fccac-1ffe-4934-b57e-16afaaa4fd62

---

## DISCREPANCY #1: Date Range - 12 Months vs 13 Months

**CRITICAL:** Qlik uses **12 months**, backend uses **13 months**.

### Qlik Formula:
- Uses `[Date Interval]={Last 12 Months}` where `vSalesScorecardMonthRange = 12`
- "Last 12 Months" is calculated as: `MonthsAgo > 0 AND MonthsAgo <= 12`
- This includes exactly 12 months (months 1-12 ago)

**Source:** Variables.csv line 9086, 9101, 8928, 8963, etc.

### Backend Implementation:
```typescript
// Line 2076
const effectiveStartDate = startDate 
  ? new Date(startDate) 
  : new Date(effectiveEndDate.getFullYear(), effectiveEndDate.getMonth() - 13, 1);
```

**Problem:** Backend uses 13 months, Qlik uses 12 months. This will cause different loans to be included/excluded.

**Impact:** This discrepancy alone could cause significant score differences as it changes which loans are included in all calculations.

---

## DISCREPANCY #2: Pull-Through Company Average Calculation

**CRITICAL:** Backend uses wrong data source for pull-through company average.

### Qlik Formula:
```qvs
vCCA_ScorecardPullThroughAvg = Avg(Aggr([CCA Scorecard PullThrough], Actor))
```
Where `[CCA Scorecard PullThrough]` is calculated per actor as:
```qvs
Count({DateType={'Application'}, [Date Interval]={Last 12 Months}, [Active Loan Flag]={No}, [Pull Through Originated Flag]={Yes}}[Loan Number])
/ 
Count({DateType={'Application'}, [Date Interval]={Last 12 Months}, [Active Loan Flag]={No}}[Loan Number])
```

### Backend Implementation:
```typescript
// Line 2601-2608 - WRONG!
const actorPullThrough = data.startedCount > 0 
  ? (data.fundedCount / data.startedCount) * 100 
  : 0;
if (actorPullThrough > 0) {
  totalPullThroughSum += actorPullThrough;
  pullThroughCount++;
}
```

**Problem:** 
- `data.startedCount` and `data.fundedCount` are from `startedLoans` and `fundedLoans` which use `started_date`/`application_date` and `funding_date` from FUNDED loans
- This is NOT the same as the pull-through calculation which uses `application_date` for ALL inactive loans (funded, withdrawn, denied, etc.)

**Correct Implementation Should Use:**
- `data.applicationCount` (denominator: all inactive loans with application_date in range)
- `data.pullThroughFundedCount` (numerator: inactive loans with funding_date)

**Impact:** Company average pull-through is calculated incorrectly, affecting all pull-through ratings.

---

## DISCREPANCY #3: Pull-Through Calculation for Individual Actors

**Status:** ✅ CORRECT - Individual actor pull-through uses correct data (line 2698-2700)

The individual actor pull-through calculation correctly uses:
```typescript
const actorPullThrough = data.applicationCount > 0 
  ? (data.pullThroughFundedCount / data.applicationCount) * 100 
  : companyAverages.avgPullThrough;
```

This matches Qlik's formula. However, since the company average is wrong (Discrepancy #2), the fallback value is also wrong.

---

## DISCREPANCY #4: Date Range Calculation - MonthEnd vs Today

### Qlik Formula:
- `Rolling13MonthFlag` uses: `AddMonths(MonthEnd($(vMaxDate)), -13, 1)`
- This goes to the **first day of the month, 13 months ago**
- End date is `MonthEnd($(vMaxDate))` - **last day of current month**

### Backend Implementation:
```typescript
// Line 2070-2076
const now = new Date();
const effectiveEndDate = endDate ? new Date(endDate) : now;
const effectiveStartDate = startDate 
  ? new Date(startDate) 
  : new Date(effectiveEndDate.getFullYear(), effectiveEndDate.getMonth() - 13, 1);
```

**Problem:**
- Backend uses `now` (today's date) as end date
- Qlik uses `MonthEnd(vMaxDate)` (last day of current month)
- If today is Jan 26, 2026, backend end date = Jan 26, 2026
- Qlik end date = Jan 31, 2026 (last day of month)
- This means Qlik includes loans from Jan 27-31 that backend excludes

**Impact:** Backend excludes loans from the end of the current month that Qlik includes.

---

## DISCREPANCY #5: Company Average Calculation - Which Actors Included

### Qlik Formula:
All company averages use: `Avg(Aggr(..., Actor))` with filter `[CCA Scorecard ...] *= {">0"}`

This means:
- Only actors with value > 0 are included in the average
- For example, `vCCA_ScorecardVolumeAvg` only includes actors with volume > 0

### Backend Implementation:
```typescript
// Line 2630-2637
const avgUnitsPerActor = actorCount > 0 ? totalUnits / actorCount : 0;
const avgVolumePerActor = actorCount > 0 ? totalVolume / actorCount : 0;
const avgRevenuePerActor = actorCount > 0 ? totalRevenue / actorCount : 0;
```

**Problem:**
- Backend uses `actorCount` which is `actorMap.size` - all actors with funded loans
- Qlik filters by `[CCA Scorecard ...] *= {">0"}` which excludes actors with 0 value
- If an actor has 0 volume, Qlik excludes them from volume average, but backend includes them

**Impact:** Company averages are calculated over different sets of actors, causing rating differences.

---

## DISCREPANCY #6: Margin Rating - Using Revenue vs Margin BPS

### Qlik Formula:
```qvs
eCCA_TVI_MarginRating = ([CCA Scorecard Margin $] / vCCA_ScorecardMarginAvg) * 100
```
Where `[CCA Scorecard Margin $]` = `Sum([Revenue])` per actor (dollars)

### Backend Implementation:
```typescript
// Line 2730-2732
const marginRating = companyAverages.avgRevenuePerActor > 0 
  ? (data.revenue / companyAverages.avgRevenuePerActor) * 100 
  : 100;
```

**Status:** ✅ CORRECT - Backend uses revenue in dollars, matching Qlik.

**Note:** Backend also calculates `avgMarginBpsPerActor` (line 2637) but doesn't use it for margin rating, which is correct.

---

## DISCREPANCY #7: Turn Time Average Calculation

### Qlik Formula:
```qvs
vCCA_ScorecardTurnTimeAvg = Avg(Aggr(Pow([CCA Scorecard TurnTime], -1), Actor))
```
Where `[CCA Scorecard TurnTime]` = `Avg([App-Close])` per actor

So Qlik:
1. Calculates `Avg([App-Close])` per actor (average turn time per actor)
2. Takes `Pow(..., -1)` of each actor's average (inverse)
3. Averages those inverses

### Backend Implementation:
```typescript
// Line 2612-2618
if (data.turnTimes.length > 0) {
  const avgTurnTime = data.turnTimes.reduce((a, b) => a + b, 0) / data.turnTimes.length;
  if (avgTurnTime > 0) {
    totalInverseTurnTimeSum += 1 / avgTurnTime; // Inverse for Qlik formula
  }
  turnTimeActorCount++;
}
```

**Status:** ✅ CORRECT - Backend calculates average turn time per actor, then takes inverse, then averages inverses, matching Qlik.

---

## DISCREPANCY #8: Concession Inclusion Flag

### Qlik Formula:
```qvs
vCCA_ScorecardIncludeConcession = $(=vCCA_ScorecardConcessionAvg = 0) + 2
```
This evaluates to:
- If `vCCA_ScorecardConcessionAvg = 0` → `1 + 2 = 3`
- If `vCCA_ScorecardConcessionAvg ≠ 0` → `0 + 2 = 2`

Then in the formula:
```qvs
Pick(vCCA_ScorecardIncludeConcession, 0, $(eCCA_TVI_ConcessionRating))
```
- If value = 3 → returns `eCCA_TVI_ConcessionRating` (3rd parameter)
- If value = 2 → returns `0` (2nd parameter)

So concession is included ONLY if average concession = 0 (which seems backwards, but that's what the formula does).

### Backend Implementation:
```typescript
// Line 2091
const includeConcession = true;
```

**Problem:** Backend always includes concession, but Qlik only includes it when average concession = 0.

**Impact:** If Qlik has non-zero average concession, concession rating is excluded from TTS score, but backend includes it.

---

## DISCREPANCY #9: Company Average - Actors with 0 Units or No Current Production

### Qlik Formula:
All scorecard fields check: `if(Sum(Aggr([CCA Current Production Check],...))<0, Null(), ...)`

If an actor has no current production (last 30 days), their scorecard value is `Null()`.

Then company averages filter by `[CCA Scorecard ...] *= {">0"}` which excludes `Null()` values.

**Current Production Check** = Count of:
- Funded loans with `CurrentProductionFlag={Yes}` (last 30 days)
- Active loans with `CurrentProductionFlag={Yes}` (last 30 days)

### Backend Implementation:
```typescript
// Line 2628-2637 - Company averages calculated for ALL actors in actorMap
const avgUnitsPerActor = actorCount > 0 ? totalUnits / actorCount : 0;
// ...
// Line 2822 - Actors with 0 units filtered AFTER averages calculated
const actorsWithProduction = actorScores.filter(a => a.units > 0);
```

**Problem:**
- Backend includes ALL actors with funded loans in the date range in company averages
- Qlik excludes actors with no current production (last 30 days) from company averages
- Backend filters 0-unit actors AFTER calculating averages, so they're included in averages

**Impact:** Company averages include different sets of actors, causing rating differences.

---

## DISCREPANCY #10: Concession Inclusion Logic - Backwards Logic

### Qlik Formula:
```qvs
vCCA_ScorecardIncludeConcession = $(=vCCA_ScorecardConcessionAvg = 0) + 2
```
- If average concession = 0 → `1 + 2 = 3` → `Pick(3, 0, value)` → returns `value` (INCLUDED)
- If average concession ≠ 0 → `0 + 2 = 2` → `Pick(2, 0, value)` → returns `0` (EXCLUDED)

**This means:** Concession is included ONLY when average concession = 0 (seems backwards, but that's the formula).

### Backend Implementation:
```typescript
// Line 2091
const includeConcession = true;
```

**Problem:** Backend always includes concession, but Qlik only includes it when average = 0.

**Impact:** If Qlik has non-zero average concession, backend includes concession component but Qlik doesn't, causing score differences.

---

## DISCREPANCY #11: Turn Time Calculation - Closing Date Fallback

### Qlik Formula:
```qvs
eCCA_TVI_ScorecardTurnTime = Avg(Aggr(Avg({<[App-Close]*={">0"}, [Date Interval]={Last 12 Months}, DateType={'Funding'}, ...>}[App-Close]), Actor))
```

**Key Points:**
- Uses `[App-Close]` field
- Filters by `DateType={'Funding'}` which means it uses `funding_date`
- No fallback to `closing_date` mentioned

### Backend Implementation:
```typescript
// Line 2238-2244
const calcTurnTime = (l: any): number | null => {
  const appDate = l.application_date;
  const fundDate = l.funding_date || l.closing_date;  // FALLBACK to closing_date
  if (!appDate || !fundDate) return null;
  const diffMs = new Date(fundDate).getTime() - new Date(appDate).getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
};
```

**Problem:** Backend uses `funding_date || closing_date` as fallback, but Qlik may only use `funding_date` (needs verification of what `[App-Close]` actually is).

**Impact:** If Qlik doesn't use closing_date fallback, loans without funding_date are excluded from turn time, but backend includes them using closing_date.

---

## DISCREPANCY #12: Funded Loans Filter - Closing Date Fallback

### Qlik Formula:
All scorecard fields use `DateType={'Funding'}` which means they use `funding_date` only.

### Backend Implementation:
```typescript
// Line 2159-2163
const fundedLoans = channelFilteredLoans.filter((l: any) => {
  if (!l.funding_date) return false; // Must have funding_date (no fallback)
  const fd = new Date(l.funding_date);
  return fd >= effectiveStartDate && fd <= effectiveEndDate;
});
```

**Status:** ✅ CORRECT - Backend correctly requires `funding_date` with no fallback for funded loans filter.

However, turn time calculation (line 2240) DOES use closing_date as fallback, which may be inconsistent.

---

## Summary of Critical Discrepancies

| # | Discrepancy | Impact | Severity |
|---|-------------|--------|----------|
| 1 | Date Range: 12 vs 13 months | Different loans included | **CRITICAL** |
| 2 | Pull-through company average uses wrong data | Wrong company average | **CRITICAL** |
| 4 | End date: Today vs MonthEnd | Missing end-of-month loans | **HIGH** |
| 5 | Company averages include/exclude actors differently | Different averages | **HIGH** |
| 8 | Concession inclusion logic | Concession may be included when it shouldn't | **MEDIUM** |
| 9 | Actors with no current production included in averages | Different actor sets | **HIGH** |
| 11 | Turn time uses closing_date fallback | May include loans Qlik excludes | **MEDIUM** |

---

## Detailed Analysis of Each Discrepancy

### DISCREPANCY #1: Date Range Calculation

**Qlik "Last 12 Months" Calculation:**
- `MonthsAgo = 12 * (year(today()) - year($1)) + month(today()) - month($1)`
- Filter: `MonthsAgo > 0 AND MonthsAgo <= 12`
- Example: If today is Jan 26, 2026:
  - Jan 2025: MonthsAgo = 12 * (2026-2025) + (1-1) = 12 ✅ Included
  - Dec 2024: MonthsAgo = 12 * (2026-2024) + (1-12) = 24 - 11 = 13 ❌ Excluded
  - So it includes Jan 2025 through Dec 2025 = 12 months

**Backend "13 Months" Calculation:**
- `effectiveStartDate = new Date(year, month - 13, 1)`
- Example: If today is Jan 26, 2026:
  - Start = Dec 1, 2024
  - End = Jan 26, 2026
  - This includes Dec 2024, Jan-Dec 2025, and Jan 2026 = 14 months of data!

**CRITICAL:** Backend includes an extra month (Dec 2024) that Qlik excludes, PLUS includes partial current month (Jan 1-26, 2026) that Qlik may or may not include depending on how "Last 12 Months" handles the current month.

---

### DISCREPANCY #2: Pull-Through Company Average - Detailed Analysis

**Qlik Pull-Through Per Actor:**
```qvs
[CCA Scorecard PullThrough] = 
  Count({DateType={'Application'}, [Date Interval]={Last 12 Months}, [Active Loan Flag]={No}, [Pull Through Originated Flag]={Yes}}[Loan Number])
  /
  Count({DateType={'Application'}, [Date Interval]={Last 12 Months}, [Active Loan Flag]={No}}[Loan Number])
```

**Backend Pull-Through Per Actor (WRONG):**
```typescript
// Line 2602-2604 - Uses startedCount and fundedCount
const actorPullThrough = data.startedCount > 0 
  ? (data.fundedCount / data.startedCount) * 100 
  : 0;
```

**What `startedCount` and `fundedCount` Actually Are:**
- `startedCount` (line 2347-2352): Count of loans with `started_date` or `application_date` in date range (from `startedLoans`)
- `fundedCount` (line 2454): Count of loans with `funding_date` in date range (from `fundedLoans`)

**What They SHOULD Be:**
- Denominator: `applicationCount` = All inactive loans with `application_date` in range (line 2435)
- Numerator: `pullThroughFundedCount` = Inactive loans with `funding_date` and `application_date` in range (line 2436)

**The Problem:**
- `startedCount` includes ALL loans with started_date/application_date, not just inactive ones
- `fundedCount` only counts funded loans, but pull-through numerator should count inactive loans with funding_date
- The correct data (`applicationCount` and `pullThroughFundedCount`) is calculated correctly at lines 2363-2394, but NOT used for company average!

---

## Next Steps - Priority Order with Exact Code Changes

### 1. CRITICAL - Fix Discrepancy #1: Date Range (12 vs 13 months)

**File:** `server/src/routes/loans.ts`  
**Line:** 2076

**Current Code:**
```typescript
const effectiveStartDate = startDate 
  ? new Date(startDate) 
  : new Date(effectiveEndDate.getFullYear(), effectiveEndDate.getMonth() - 13, 1);
```

**Change To:**
```typescript
const effectiveStartDate = startDate 
  ? new Date(startDate) 
  : new Date(effectiveEndDate.getFullYear(), effectiveEndDate.getMonth() - 12, 1);
```

**Also verify:** "Last 12 Months" in Qlik excludes current month (MonthsAgo > 0), so if end date is Jan 26, 2026, we should exclude Jan 2026 and include Jan-Dec 2025. Need to verify if backend should also exclude current month.

---

### 2. CRITICAL - Fix Discrepancy #2: Pull-Through Company Average

**File:** `server/src/routes/loans.ts`  
**Lines:** 2601-2608

**Current Code (WRONG):**
```typescript
// Pull-through per actor (percentage)
const actorPullThrough = data.startedCount > 0 
  ? (data.fundedCount / data.startedCount) * 100 
  : 0;
if (actorPullThrough > 0) {
  totalPullThroughSum += actorPullThrough;
  pullThroughCount++;
}
```

**Change To:**
```typescript
// Pull-through per actor (percentage) - use correct data from pull-through calculation
const actorPullThrough = data.applicationCount > 0 
  ? (data.pullThroughFundedCount / data.applicationCount) * 100 
  : 0;
if (actorPullThrough > 0) {
  totalPullThroughSum += actorPullThrough;
  pullThroughCount++;
}
```

---

### 3. HIGH - Fix Discrepancy #4: End Date (MonthEnd vs Today)

**File:** `server/src/routes/loans.ts`  
**Line:** 2071

**Current Code:**
```typescript
const now = new Date();
const effectiveEndDate = endDate ? new Date(endDate) : now;
```

**Change To:**
```typescript
const now = new Date();
// Qlik uses MonthEnd(vMaxDate) - last day of current month
const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
const effectiveEndDate = endDate ? new Date(endDate) : lastDayOfMonth;
```

---

### 4. HIGH - Fix Discrepancy #5: Filter Actors with Value > 0

**File:** `server/src/routes/loans.ts`  
**Lines:** 2588-2626 (actorMap.forEach loop)

**Current Code:**
```typescript
actorMap.forEach((data) => {
  totalUnits += data.units;
  totalVolume += data.volume;
  totalRevenue += data.revenue;
  // ... all actors included
});
```

**Change To:**
```typescript
actorMap.forEach((data) => {
  // Qlik filters by [CCA Scorecard ...] *= {">0"} - only include actors with value > 0
  if (data.units > 0) {
    totalUnits += data.units;
    // ... only count if > 0
  }
  if (data.volume > 0) {
    totalVolume += data.volume;
    // ... only count if > 0
  }
  // Apply same filter for revenue, turn time, pull-through, concession
});
```

**Also update actorCount calculation** to only count actors with production > 0.

---

### 5. HIGH - Fix Discrepancy #9: Exclude Actors with No Current Production

**File:** `server/src/routes/loans.ts`  
**Add before line 2588:**

**New Code:**
```typescript
// Filter actors with current production (last 30 days) - Qlik excludes actors without current production
const thirtyDaysAgo = new Date(effectiveEndDate.getTime() - 30 * 24 * 60 * 60 * 1000);
const actorsWithCurrentProduction = new Set<string>();

// Check each actor has at least one funded loan or active loan in last 30 days
channelFilteredLoans.forEach((l: any) => {
  const actorName = l[actorColumn];
  if (!actorName || actorName.trim() === '') return;
  
  const fundDate = l.funding_date ? new Date(l.funding_date) : null;
  const appDate = l.application_date ? new Date(l.application_date) : null;
  const status = (l.current_loan_status || '').toUpperCase();
  const isActive = !status.includes('WITHDRAWN') && !status.includes('DENIED') && 
                   !status.includes('CANCELLED') && !status.includes('DECLINED') &&
                   !status.includes('ORIGINATED') && !status.includes('PURCHASED') && !fundDate;
  
  // Current production = funded loan in last 30 days OR active loan in last 30 days
  if (fundDate && fundDate >= thirtyDaysAgo && fundDate <= effectiveEndDate) {
    actorsWithCurrentProduction.add(actorName);
  } else if (isActive && appDate && appDate >= thirtyDaysAgo && appDate <= effectiveEndDate) {
    actorsWithCurrentProduction.add(actorName);
  }
});

// Then filter actorMap to only include actors with current production
const filteredActorMap = new Map<string, ActorMetrics>();
actorMap.forEach((data, name) => {
  if (actorsWithCurrentProduction.has(name)) {
    filteredActorMap.set(name, data);
  }
});
```

**Then use `filteredActorMap` instead of `actorMap` for company average calculations.**

---

### 6. MEDIUM - Fix Discrepancy #8: Concession Inclusion Logic

**File:** `server/src/routes/loans.ts`  
**Line:** 2091

**Current Code:**
```typescript
const includeConcession = true;
```

**Change To:**
```typescript
// Qlik: vCCA_ScorecardIncludeConcession = (vCCA_ScorecardConcessionAvg = 0) + 2
// If avg = 0 → 1 + 2 = 3 → included
// If avg ≠ 0 → 0 + 2 = 2 → excluded
const includeConcession = companyAverages.avgConcessionPerActor === 0;
```

**Note:** This needs to be calculated AFTER company averages are computed, so it may need to be moved or calculated conditionally.

---

### 7. MEDIUM - Fix Discrepancy #11: Turn Time Closing Date Fallback

**File:** `server/src/routes/loans.ts`  
**Line:** 2240

**Current Code:**
```typescript
const fundDate = l.funding_date || l.closing_date;
```

**Change To:**
```typescript
// Qlik uses DateType={'Funding'} which means only funding_date, no fallback
const fundDate = l.funding_date;
if (!fundDate) return null; // Exclude loans without funding_date
```

---

## Verification Checklist

After making these fixes, verify:

1. ✅ Date range matches Qlik "Last 12 Months" exactly
2. ✅ Pull-through company average uses `applicationCount` and `pullThroughFundedCount`
3. ✅ End date is last day of current month
4. ✅ Company averages only include actors with value > 0
5. ✅ Company averages only include actors with current production (last 30 days)
6. ✅ Concession inclusion logic matches Qlik (only when avg = 0)
7. ✅ Turn time calculation doesn't use closing_date fallback
8. ✅ All individual rating formulas match Qlik exactly
9. ✅ TTS formula assembly matches Qlik exactly (6 components, no compound scaling, correct weights)
