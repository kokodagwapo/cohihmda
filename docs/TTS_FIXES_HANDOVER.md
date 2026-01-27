# TTS Score Discrepancy Fixes - Implementation Handover

**Date:** January 26, 2026  
**Status:** Ready for Implementation  
**Priority:** CRITICAL - Fixes required to match Qlik Performance app calculations

---

## Objective

Fix all 7 discrepancies identified between the backend TTS calculation and the Qlik Performance app to eliminate the ±30 point score differences.

**Reference Document:** `docs/TTS_ACTUAL_DISCREPANCIES_FOUND.md` (contains all detailed analysis, Qlik formulas, and exact code locations)

---

## Implementation Tasks

### Task 1: Fix Date Range (12 vs 13 months) - CRITICAL

**File:** `server/src/routes/loans.ts`  
**Line:** 2076  
**Priority:** CRITICAL

**Current Code:**
```typescript
const effectiveStartDate = startDate 
  ? new Date(startDate) 
  : new Date(effectiveEndDate.getFullYear(), effectiveEndDate.getMonth() - 13, 1);
```

**Required Change:**
```typescript
const effectiveStartDate = startDate 
  ? new Date(startDate) 
  : new Date(effectiveEndDate.getFullYear(), effectiveEndDate.getMonth() - 12, 1);
```

**Verification:**
- Qlik uses "Last 12 Months" which excludes current month (MonthsAgo > 0 AND MonthsAgo <= 12)
- If end date is Jan 26, 2026, should include Jan-Dec 2025, exclude Jan 2026
- Verify the date range calculation matches Qlik's "Last 12 Months" logic exactly

---

### Task 2: Fix Pull-Through Company Average - CRITICAL

**File:** `server/src/routes/loans.ts`  
**Lines:** 2601-2608  
**Priority:** CRITICAL

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

**Required Change:**
```typescript
// Pull-through per actor (percentage) - use correct data from pull-through calculation
// Qlik uses: application_date for inactive loans, not started_date/funding_date
const actorPullThrough = data.applicationCount > 0 
  ? (data.pullThroughFundedCount / data.applicationCount) * 100 
  : 0;
if (actorPullThrough > 0) {
  totalPullThroughSum += actorPullThrough;
  pullThroughCount++;
}
```

**Verification:**
- `data.applicationCount` is correctly populated at line 2435 (all inactive loans with application_date in range)
- `data.pullThroughFundedCount` is correctly populated at line 2436 (inactive loans with funding_date)
- Company average pull-through should match Qlik's `vCCA_ScorecardPullThroughAvg`

---

### Task 3: Fix End Date (MonthEnd vs Today) - HIGH

**File:** `server/src/routes/loans.ts`  
**Line:** 2071  
**Priority:** HIGH

**Current Code:**
```typescript
const now = new Date();
const effectiveEndDate = endDate ? new Date(endDate) : now;
```

**Required Change:**
```typescript
const now = new Date();
// Qlik uses MonthEnd(vMaxDate) - last day of current month
const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
const effectiveEndDate = endDate ? new Date(endDate) : lastDayOfMonth;
```

**Verification:**
- If today is Jan 26, 2026, end date should be Jan 31, 2026 (not Jan 26)
- This ensures backend includes loans from end of current month that Qlik includes

---

### Task 4: Filter Actors with Value > 0 in Company Averages - HIGH

**File:** `server/src/routes/loans.ts`  
**Lines:** 2588-2626 (actorMap.forEach loop)  
**Priority:** HIGH

**Current Code:**
```typescript
actorMap.forEach((data) => {
  totalUnits += data.units;
  totalVolume += data.volume;
  totalRevenue += data.revenue;
  // ... all actors included regardless of value
});
```

**Required Change:**
```typescript
actorMap.forEach((data) => {
  // Qlik filters by [CCA Scorecard ...] *= {">0"} - only include actors with value > 0
  if (data.units > 0) {
    totalUnits += data.units;
    // Count this actor for units average
  }
  if (data.volume > 0) {
    totalVolume += data.volume;
    // Count this actor for volume average
  }
  if (data.revenue > 0) {
    totalRevenue += data.revenue;
    // Count this actor for revenue average
  }
  
  // Apply same filter for:
  // - Margin BPS (if data.marginBpsValues.length > 0)
  // - Pull-through (if actorPullThrough > 0) - already handled in Task 2
  // - Turn time (if data.turnTimes.length > 0)
  // - Concession (if data.concessions.length > 0)
  
  // Update actorCount to only count actors with production > 0
});
```

**Also Update:**
- Line 2630-2637: Update `actorCount` to only count actors with value > 0 for each metric
- Each average should divide by the count of actors with that metric > 0, not total actor count

**Verification:**
- Actors with 0 units should not be included in units average
- Actors with 0 volume should not be included in volume average
- Same for all other metrics

---

### Task 5: Exclude Actors with No Current Production - HIGH

**File:** `server/src/routes/loans.ts`  
**Location:** Add before line 2588 (before company average calculation)  
**Priority:** HIGH

**Required Implementation:**

Add this code block before the `actorMap.forEach((data) => {` loop:

```typescript
// Filter actors with current production (last 30 days) - Qlik excludes actors without current production
// Qlik: if(Sum(Aggr([CCA Current Production Check],...))<0, Null(), ...)
// Current Production Check = Count of funded loans OR active loans in last 30 days
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

// Filter actorMap to only include actors with current production
const filteredActorMap = new Map<string, ActorMetrics>();
actorMap.forEach((data, name) => {
  if (actorsWithCurrentProduction.has(name)) {
    filteredActorMap.set(name, data);
  }
});
```

**Then Update:**
- Replace `actorMap.forEach` with `filteredActorMap.forEach` in the company average calculation loop
- Update `actorCount` to use `filteredActorMap.size` instead of `actorMap.size`

**Verification:**
- Only actors with production in last 30 days should be included in company averages
- Actors without current production should be excluded (matching Qlik's Null() behavior)

---

### Task 6: Fix Concession Inclusion Logic - MEDIUM

**File:** `server/src/routes/loans.ts`  
**Line:** 2091 (and line 2760 where it's used)  
**Priority:** MEDIUM

**Current Code:**
```typescript
const includeConcession = true;
```

**Required Change:**

Move the `includeConcession` calculation to AFTER company averages are computed (after line 2637):

```typescript
// Qlik: vCCA_ScorecardIncludeConcession = (vCCA_ScorecardConcessionAvg = 0) + 2
// If avg = 0 → 1 + 2 = 3 → Pick(3, 0, value) → included
// If avg ≠ 0 → 0 + 2 = 2 → Pick(2, 0, value) → excluded
// Concession is included ONLY when average concession = 0
const includeConcession = companyAverages.avgConcessionPerActor === 0;
```

**Note:** This requires moving the `includeConcession` declaration and updating the `totalWeight` calculation to happen after company averages are computed.

**Verification:**
- If average concession = 0, concession component should be included in TTS score
- If average concession ≠ 0, concession component should be excluded (set to 0)

---

### Task 7: Remove Closing Date Fallback from Turn Time - MEDIUM

**File:** `server/src/routes/loans.ts`  
**Line:** 2240  
**Priority:** MEDIUM

**Current Code:**
```typescript
const calcTurnTime = (l: any): number | null => {
  const appDate = l.application_date;
  const fundDate = l.funding_date || l.closing_date;  // FALLBACK to closing_date
  if (!appDate || !fundDate) return null;
  const diffMs = new Date(fundDate).getTime() - new Date(appDate).getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
};
```

**Required Change:**
```typescript
const calcTurnTime = (l: any): number | null => {
  const appDate = l.application_date;
  // Qlik uses DateType={'Funding'} which means only funding_date, no fallback
  const fundDate = l.funding_date;
  if (!appDate || !fundDate) return null; // Exclude loans without funding_date
  const diffMs = new Date(fundDate).getTime() - new Date(appDate).getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
};
```

**Verification:**
- Loans without `funding_date` should be excluded from turn time calculation
- Only loans with both `application_date` and `funding_date` should be included

---

## Implementation Order

**Recommended order (by dependency):**

1. **Task 1** (Date Range) - Must be done first, affects all other calculations
2. **Task 3** (End Date) - Should be done early, affects date filtering
3. **Task 5** (Current Production Filter) - Should be done before company averages
4. **Task 4** (Filter Actors > 0) - Should be done with company averages
5. **Task 2** (Pull-Through Average) - Part of company averages calculation
6. **Task 6** (Concession Inclusion) - Depends on company averages being calculated
7. **Task 7** (Turn Time Fallback) - Independent, can be done anytime

---

## Testing & Verification

After implementing all fixes:

### 1. Unit Tests
- Test date range calculation matches "Last 12 Months" exactly
- Test pull-through calculation uses correct data sources
- Test company averages exclude actors with 0 values
- Test concession inclusion logic

### 2. Integration Tests
- Compare TTS scores for specific LOs with Qlik Performance app
- Verify scores are within ±2 points (allowing for rounding differences)
- Test edge cases: actors with 0 production, no current production, etc.

### 3. Validation Checklist
- [ ] Date range: 12 months, excludes current month
- [ ] End date: Last day of current month
- [ ] Pull-through company average uses `applicationCount` and `pullThroughFundedCount`
- [ ] Company averages exclude actors with value = 0
- [ ] Company averages exclude actors without current production (last 30 days)
- [ ] Concession included only when average concession = 0
- [ ] Turn time calculation doesn't use closing_date fallback
- [ ] TTS formula: 6 components, no compound scaling, correct weights (2, 2, 0.5, 1.5, 2, conditional 2)

### 4. Comparison with Qlik
For each test case:
1. Get TTS score from backend
2. Get TTS score from Qlik Performance app for same LO
3. Compare individual ratings (Volume, Margin, TurnTime, PullThrough, Unit, Concession)
4. Compare company averages
5. Document any remaining differences

---

## Important Notes

1. **Don't break existing functionality:** Make sure all changes are backward compatible or properly versioned
2. **Preserve logging:** Keep existing log statements, add new ones for debugging
3. **Error handling:** Ensure all edge cases are handled (null values, empty arrays, etc.)
4. **Performance:** The current production filter may add overhead - optimize if needed
5. **Documentation:** Update code comments to reference Qlik formulas

---

## Questions or Issues?

If you encounter any issues during implementation:

1. **Reference the source:** Check `docs/TTS_ACTUAL_DISCREPANCIES_FOUND.md` for detailed Qlik formulas
2. **Check Qlik exports:** Review `QlikAppsAndLogicDictionaryDocs/Performance/QSDA-[1.7.0] Performance - Homestead-a80fccac-1ffe-4934-b57e-16afaaa4fd62/` for exact formulas
3. **Verify assumptions:** When in doubt, check the Qlik Performance app directly

---

## Success Criteria

✅ All 7 discrepancies fixed  
✅ TTS scores match Qlik Performance app within ±2 points  
✅ Individual ratings match Qlik within ±1 point  
✅ Company averages match Qlik exactly  
✅ All tests passing  
✅ No regressions in existing functionality

---

**Good luck! This is critical work that will ensure our TTS scores match the official Qlik Performance app calculations.**
