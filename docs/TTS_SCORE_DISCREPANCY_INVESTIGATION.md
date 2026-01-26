# TTS Score Discrepancy Investigation Handover

## Current Status

**Progress:** TTS scores are now **close** to Qlik values (within ±30 points) but not exact.

**Example Discrepancies:**
- Stanley Edward Obrecht Jr.: Our score vs Qlik score (difference of ~30 points)
- Other LOs: Similar ±30 point differences across the board

**What's Working:**
- ✅ 6-component formula implemented (Volume, Margin, TurnTime, PullThrough, Unit, Concession)
- ✅ Correct weights (2, 2, 0.5, 1.5, 2, 2 = total 10)
- ✅ No compound scaling (removed per Qlik findings)
- ✅ Revenue calculation using Base Buy with Origination Points fallback
- ✅ Pull-through calculation using application_date for inactive loans
- ✅ Filtering out LOs with 0 units

**What Needs Investigation:**
- Individual rating calculations may have subtle differences
- Date range filtering might be slightly off
- Company average calculations might differ
- Rounding/precision differences
- Missing edge cases or filters

---

## Investigation Approach

### Phase 1: Compare Individual Ratings Component-by-Component

For **2-3 specific LOs** (e.g., Stanley, Aaron), compare each rating component:

#### 1.1 Volume Rating
**Qlik Formula:**
```qvs
eCCA_TVI_VolumeRating = num(([CCA Scorecard Volume] / $(vCCA_ScorecardVolumeAvg)) * 100, '$(vNumFormat)')
```

**Our Implementation:**
```typescript
const volumeRating = companyAverages.avgVolumePerActor > 0 
  ? (data.volume / companyAverages.avgVolumePerActor) * 100 
  : 100;
```

**Investigation Tasks:**
1. **Verify `[CCA Scorecard Volume]` definition:**
   - Check Qlik Expressions.csv for exact formula
   - Verify it's `Sum([Loan Amount])` per actor for Rolling 13 Month funded loans
   - Confirm date filter: `DateType={'Funding'}` and `Rolling13MonthFlag={Yes}`

2. **Verify `vCCA_ScorecardVolumeAvg` calculation:**
   - Check how Qlik calculates the company average
   - Is it `Avg(Aggr([CCA Scorecard Volume], Actor))`?
   - Does it exclude actors with 0 volume?
   - Does it use the same date range?

3. **Compare actual values:**
   - Get Stanley's Volume Rating from Qlik
   - Get Stanley's total volume from Qlik
   - Get company average volume from Qlik
   - Compare to our calculated values

**Files to Check:**
- `QlikAppsAndLogicDictionaryDocs/Performance/tvd-coheus-performance-qlik/QSDA-[1.6.0] Performance-82c16f07-1efc-4482-ae53-99d8abba3ee4/Expressions.csv` - Search for "Volume Rating" or "eCCA_TVI_VolumeRating"
- `QlikAppsAndLogicDictionaryDocs/tvd-coheus-datapilot-qlik/QSDA-Data Pilot-dbaa5b90-3f7f-467e-98e7-0053c46b913a/Variables.csv` - Line 2285 (eCCA_TVI_VolumeRating)

#### 1.2 Margin Rating
**Qlik Formula:**
```qvs
eCCA_TVI_MarginRating = num(([CCA Scorecard Margin $] / $(vCCA_ScorecardMarginAvg)) * 100, '$(vNumFormat)')
```

**Our Implementation:**
```typescript
const marginRating = companyAverages.avgRevenuePerActor > 0 
  ? (data.revenue / companyAverages.avgRevenuePerActor) * 100 
  : 100;
```

**Investigation Tasks:**
1. **Verify `[CCA Scorecard Margin $]` definition:**
   - Check if it's `Sum([Revenue])` per actor
   - Verify revenue formula matches Qlik exactly
   - Check if Qlik uses Base Buy formula or Origination Points formula
   - Verify date filter matches

2. **Verify revenue calculation:**
   - Check Qlik Transform.qvs line 549 for exact revenue formula
   - Verify `vDefaultRevFlag` value (0 = Base Buy, 1 = custom)
   - Check if there are other revenue flags (`vSalesRevFlag`, etc.)
   - Compare our Base Buy calculation: `((baseBuy - 100) / 100) * loanAmount`
   - Compare our Origination Points fallback

3. **Verify `vCCA_ScorecardMarginAvg`:**
   - How is company average calculated?
   - Does it exclude actors with 0 revenue?

**Files to Check:**
- `QlikAppsAndLogicDictionaryDocs/tvd-coheus-incremental-builder-qlik/Transform.qvs` - Lines 549-553 (Revenue formulas)
- `QlikAppsAndLogicDictionaryDocs/tvd-coheus-datapilot-qlik/QSDA-Data Pilot-dbaa5b90-3f7f-467e-98e7-0053c46b913a/Variables.csv` - Line 1853 (eCCA_TVI_MarginRating)
- `QlikAppsAndLogicDictionaryDocs/Performance/tvd-coheus-performance-qlik/QSDA-[1.6.0] Performance-82c16f07-1efc-4482-ae53-99d8abba3ee4/Expressions.csv` - Search for "Margin Rating"

#### 1.3 Turn Time Rating
**Qlik Formula:**
```qvs
eCCA_TVI_TurnTimesRating = num((Pow([CCA Scorecard TurnTime], -1) / $(vCCA_ScorecardTurnTimeAvg) * 100), '$(vNumFormat)')
```

**Our Implementation:**
```typescript
const actorInverseTurnTime = actorAvgTurnTime > 0 ? 1 / actorAvgTurnTime : 0;
const turnTimeRating = companyAverages.avgInverseTurnTime > 0 && actorInverseTurnTime > 0
  ? (actorInverseTurnTime / companyAverages.avgInverseTurnTime) * 100 
  : 100;
```

**Investigation Tasks:**
1. **Verify `[CCA Scorecard TurnTime]` definition:**
   - Is it `Avg([App-Close])` per actor?
   - What date range is used?
   - Are there any filters (funded loans only, etc.)?

2. **Verify `vCCA_ScorecardTurnTimeAvg` calculation:**
   - Qlik formula: `Avg(Aggr(Pow([CCA Scorecard TurnTime], -1), Actor))`
   - This is the **average of inverses**, not the inverse of the average
   - Verify our implementation matches this exactly

3. **Verify turn time calculation:**
   - Our formula: `(1 / actorAvgTurnTime) / avgOfInverseTurnTimes * 100`
   - Qlik formula: `(Pow(actorTurnTime, -1) / avgOfInverseTurnTimes) * 100`
   - These should be equivalent, but verify

4. **Check for edge cases:**
   - What if actor has no turn time data?
   - What if turn time is 0 or negative?
   - How does Qlik handle missing data?

**Files to Check:**
- `QlikAppsAndLogicDictionaryDocs/tvd-coheus-datapilot-qlik/QSDA-Data Pilot-dbaa5b90-3f7f-467e-98e7-0053c46b913a/Variables.csv` - Line 1847 (eCCA_TVI_TurnTimesRating)
- `QlikAppsAndLogicDictionaryDocs/Performance/tvd-coheus-performance-qlik/QSDA-[1.6.0] Performance-82c16f07-1efc-4482-ae53-99d8abba3ee4/Expressions.csv` - Search for "Turn Time Rating"

#### 1.4 Pull Through Rating
**Qlik Formula:**
```qvs
eCCA_TVI_PullThroughRating = num(([CCA Scorecard PullThrough] / $(vCCA_ScorecardPullThroughAvg)) * 100, '$(vNumFormat)')
```

**Our Implementation:**
```typescript
const actorPullThrough = data.applicationCount > 0 
  ? (data.pullThroughFundedCount / data.applicationCount) * 100 
  : companyAverages.avgPullThrough;
```

**Investigation Tasks:**
1. **Verify `[CCA Scorecard PullThrough]` definition:**
   - Check Qlik Expressions.csv lines 1391-1450 for exact formula
   - Numerator: `Count({DateType={'Application'}, Rolling13MonthFlag={Yes}, [Active Loan Flag]={No}, [Pull Through Originated Flag]={Yes}}[Loan Number])`
   - Denominator: `Count({DateType={'Application'}, Rolling13MonthFlag={Yes}, [Active Loan Flag]={No}}[Loan Number])`
   - Verify our implementation matches these filters exactly

2. **Verify date range:**
   - Both numerator and denominator use `DateType={'Application'}` (application_date)
   - Both use `Rolling13MonthFlag={Yes}` (rolling 13-month window)
   - Verify our `effectiveStartDate` and `effectiveEndDate` match Qlik's calculation

3. **Verify `[Active Loan Flag]={No}` filter:**
   - Our implementation checks: funded, withdrawn, denied, cancelled, declined, originated, purchased
   - Verify this matches Qlik's definition exactly
   - Check if there are other statuses that should be included

4. **Verify `[Pull Through Originated Flag]={Yes}`:**
   - This should be `Len(Trim([Funding Date])) > 0`
   - Our implementation: `hasFundingDate = !!l.funding_date`
   - Verify this is correct

**Files to Check:**
- `QlikAppsAndLogicDictionaryDocs/Performance/tvd-coheus-performance-qlik/QSDA-[1.6.0] Performance-82c16f07-1efc-4482-ae53-99d8abba3ee4/Expressions.csv` - Lines 1391-1450 (Pull Through formulas)
- `QlikAppsAndLogicDictionaryDocs/tvd-coheus-datapilot-qlik/QSDA-Data Pilot-dbaa5b90-3f7f-467e-98e7-0053c46b913a/Variables.csv` - Line 1857 (eCCA_TVI_PullThroughRating)

#### 1.5 Unit Rating
**Qlik Formula:**
```qvs
eCCA_TVI_UnitRating = num(([CCA Scorecard Unit] / $(vCCA_ScorecardUnitAvg)) * 100, '$(vNumFormat)')
```

**Our Implementation:**
```typescript
const unitRating = companyAverages.avgUnitsPerActor > 0 
  ? (data.units / companyAverages.avgUnitsPerActor) * 100 
  : 100;
```

**Investigation Tasks:**
1. **Verify `[CCA Scorecard Unit]` definition:**
   - Should be `Count(distinct [Loan Number])` per actor
   - Date filter: `Rolling13MonthFlag={Yes}`, `DateType={'Funding'}`
   - Verify our count matches (we count `fundedLoans` with `funding_date` in range)

2. **Verify `vCCA_ScorecardUnitAvg`:**
   - Should be average of unit counts across all actors
   - Does it exclude actors with 0 units?

**Files to Check:**
- `QlikAppsAndLogicDictionaryDocs/tvd-coheus-datapilot-qlik/QSDA-Data Pilot-dbaa5b90-3f7f-467e-98e7-0053c46b913a/Variables.csv` - Search for "eCCA_TVI_UnitRating"

#### 1.6 Concession Rating
**Qlik Formula:**
```qvs
eCCA_TVI_ConcessionRating = num(([CCA Scorecard Concession] / $(vCCA_ScorecardConcessionAvg)) * 100, '$(vNumFormat)')
```

**Our Implementation:**
```typescript
const actorTotalConcession = data.concessions.reduce((a, b) => a + b, 0);
const concessionRating = companyAverages.avgConcessionPerActor > 0 
  ? (actorTotalConcession / companyAverages.avgConcessionPerActor) * 100 
  : 100;
```

**Investigation Tasks:**
1. **Verify `[CCA Scorecard Concession]` definition:**
   - Should be `Sum([Branch Concession ($)])` per actor
   - Our formula: `(branch_price_concession / 100) * loan_amount`
   - Verify this matches Qlik's `[Branch Concession ($)]` calculation

2. **Verify concession is conditional:**
   - Check if `vCCA_ScorecardIncludeConcession` is 0 or 1
   - Our implementation: `includeConcession = true` (hardcoded)
   - Should this be configurable or always true?

**Files to Check:**
- `QlikAppsAndLogicDictionaryDocs/tvd-coheus-datapilot-qlik/QSDA-Data Pilot-dbaa5b90-3f7f-467e-98e7-0053c46b913a/Variables.csv` - Search for "eCCA_TVI_ConcessionRating"

---

### Phase 2: Verify Date Range Calculations

**Qlik Rolling 13 Months:**
- Qlik uses `Rolling13MonthFlag={Yes}`
- This is based on `MonthEnd(vMaxDate)` and goes back 13 months
- Our implementation: `new Date(effectiveEndDate.getFullYear(), effectiveEndDate.getMonth() - 13, 1)`

**Investigation Tasks:**
1. **Verify start date calculation:**
   - Qlik: `AddMonths(MonthEnd(vMaxDate), -13, 1)` - first day of month 13 months ago
   - Our: `new Date(year, month - 13, 1)` - should match
   - Test with specific dates to verify

2. **Verify end date:**
   - Qlik: `MonthEnd(vMaxDate)` - last day of current month
   - Our: `effectiveEndDate` - what is this set to?
   - Should it be last day of current month or today's date?

3. **Verify date filtering:**
   - For funded loans: `funding_date >= startDate && funding_date <= endDate`
   - For pull-through: `application_date >= startDate && application_date <= endDate`
   - Verify these match Qlik's date filters exactly

**Files to Check:**
- `QlikAppsAndLogicDictionaryDocs/Performance/tvd-coheus-performance-qlik/Scripts/` - Look for Rolling13MonthFlag definition
- `server/src/routes/loans.ts` - Lines ~2070-2076 (date range calculation)

---

### Phase 3: Verify Company Average Calculations

**Investigation Tasks:**
1. **Check which actors are included in averages:**
   - Do we exclude actors with 0 units?
   - Do we exclude actors with no production?
   - Does Qlik do the same?

2. **Verify aggregation method:**
   - Volume Avg: `Sum(volumes) / Count(actors)` or `Avg(Aggr(Sum(volume), Actor))`?
   - Margin Avg: Same question
   - Turn Time Avg: `Avg(Aggr(Pow(TurnTime, -1), Actor))` - verify our implementation

3. **Check for edge cases:**
   - What if only one actor has data?
   - What if all actors have 0 for a metric?
   - How does Qlik handle these cases?

**Files to Check:**
- `server/src/routes/loans.ts` - Lines ~2500-2560 (company averages calculation)
- `QlikAppsAndLogicDictionaryDocs/tvd-coheus-datapilot-qlik/QSDA-Data Pilot-dbaa5b90-3f7f-467e-98e7-0053c46b913a/Variables.csv` - Search for "vCCA_Scorecard*Avg" variables

---

### Phase 4: Verify TTS Formula Assembly

**Qlik Formula:**
```qvs
eCCA_TVI_Score_13_Months = (
    $(eCCA_TVI_VolumeRating) * $(vScorecardVolumeWeight)
    + $(eCCA_TVI_MarginRating) * $(vScorecardMarginWeight)
    + $(eCCA_TVI_TurnTimesRating) * $(vScorecardTurnTimeWeight)
    + $(eCCA_TVI_PullThroughRating) * $(vScorecardPullThroughWeight)
    + $(eCCA_TVI_UnitRating) * $(vScorecardUnitWeight)
    + Pick(vCCA_ScorecardIncludeConcession, 0, $(eCCA_TVI_ConcessionRating)) * $(vScorecardConcessionWeight)
) / (
    $(vScorecardVolumeWeight) + $(vScorecardMarginWeight) + $(vScorecardTurnTimeWeight) + 
    $(vScorecardPullThroughWeight) + $(vScorecardUnitWeight) + 
    Pick(vCCA_ScorecardIncludeConcession, 0, $(vScorecardConcessionWeight))
)
```

**Our Implementation:**
```typescript
const concessionComponent = includeConcession 
  ? concessionRating * weightConfig.concession 
  : 0;

const ttsScore = (
  volumeRating * weightConfig.volume +
  marginRating * weightConfig.margin +
  turnTimeRating * weightConfig.turnTime +
  pullThroughRating * weightConfig.pullThrough +
  unitRating * weightConfig.unit +
  concessionComponent
) / totalWeight;
```

**Investigation Tasks:**
1. **Verify weights match exactly:**
   - Volume: 2 (20/10)
   - Margin: 2 (20/10)
   - TurnTime: 0.5 (5/10)
   - PullThrough: 1.5 (15/10)
   - Unit: 2 (20/10)
   - Concession: 2 (20/10) when included
   - Total: 10 (or 8 without concession)

2. **Verify concession inclusion:**
   - Our: `includeConcession = true` (hardcoded)
   - Qlik: `Pick(vCCA_ScorecardIncludeConcession, 0, value)`
   - Check what value Qlik actually uses

3. **Verify division:**
   - Qlik divides by sum of weights (including conditional concession)
   - Our: `totalWeight = includeConcession ? 10 : 8`
   - Verify this matches

4. **Check for rounding:**
   - Qlik uses `num(..., '$(vNumFormat)')` for formatting
   - Does Qlik round intermediate values or only final result?
   - Our: No explicit rounding - JavaScript floating point
   - Could this cause ±30 point differences?

**Files to Check:**
- `QlikAppsAndLogicDictionaryDocs/tvd-coheus-datapilot-qlik/QSDA-Data Pilot-dbaa5b90-3f7f-467e-98e7-0053c46b913a/Variables.csv` - Lines 1861-1881 (eCCA_TVI_Score_13_Months)
- `server/src/routes/loans.ts` - Lines ~2686-2693 (TTS formula)

---

### Phase 5: Add Debug Logging

**Add detailed logging for 2-3 specific LOs:**

```typescript
// Add after calculating each rating
if (name === 'Stanley Edward Obrecht Jr.' || name === 'Aaron Michael Rist') {
  logInfo(`[TTS Debug] ${name}`, {
    volumeRating,
    marginRating,
    turnTimeRating,
    pullThroughRating,
    unitRating,
    concessionRating,
    volume: data.volume,
    revenue: data.revenue,
    units: data.units,
    avgVolumePerActor: companyAverages.avgVolumePerActor,
    avgRevenuePerActor: companyAverages.avgRevenuePerActor,
    avgUnitsPerActor: companyAverages.avgUnitsPerActor,
    actorPullThrough,
    avgPullThrough: companyAverages.avgPullThrough,
    actorAvgTurnTime,
    avgInverseTurnTime: companyAverages.avgInverseTurnTime,
    ttsScore,
    ttsComponents: {
      volume: volumeRating * weightConfig.volume,
      margin: marginRating * weightConfig.margin,
      turnTime: turnTimeRating * weightConfig.turnTime,
      pullThrough: pullThroughRating * weightConfig.pullThrough,
      unit: unitRating * weightConfig.unit,
      concession: concessionComponent,
    },
    totalWeight,
  });
}
```

**Compare logged values to Qlik:**
- Get exact values from Qlik for each component
- Compare side-by-side to find discrepancies

---

### Phase 6: Check Edge Cases and Filters

**Investigation Tasks:**
1. **Verify loan filtering:**
   - Are we filtering by `DateType={'Funding'}` correctly?
   - Are we excluding loans without funding_date?
   - Are we filtering by channel group correctly?

2. **Verify actor filtering:**
   - Are we excluding actors with 0 units? (Yes, we do this now)
   - Are we excluding actors with no production?
   - Does Qlik do the same?

3. **Check for data quality issues:**
   - Are there loans with null/missing dates?
   - Are there loans with invalid data?
   - How does Qlik handle these?

**Files to Check:**
- `server/src/routes/loans.ts` - Lines ~2148-2200 (loan filtering)
- `server/src/routes/loans.ts` - Lines ~2819-2820 (filtering actors with production)

---

## Files to Review

### Our Implementation
1. **`server/src/routes/loans.ts`** - Main TTS calculation logic
   - Lines ~2078-2094: Weight configuration
   - Lines ~2208-2232: Revenue calculation
   - Lines ~2350-2386: Pull-through counting
   - Lines ~2500-2560: Company averages
   - Lines ~2625-2674: Individual ratings
   - Lines ~2686-2693: TTS formula

2. **`docs/TTS_FORMULA_FINDINGS.md`** - Our findings document
   - Review all findings for accuracy
   - Check if anything was missed

3. **`docs/SALES_SCORECARD_TTS_DATA_QUESTIONS.md`** - Data questions doc
   - Review for any unanswered questions

### Qlik Source Files
1. **`QlikAppsAndLogicDictionaryDocs/tvd-coheus-datapilot-qlik/QSDA-Data Pilot-dbaa5b90-3f7f-467e-98e7-0053c46b913a/Variables.csv`**
   - Lines 1861-1881: eCCA_TVI_Score_13_Months
   - Line 2285: eCCA_TVI_VolumeRating
   - Line 1853: eCCA_TVI_MarginRating
   - Line 1847: eCCA_TVI_TurnTimesRating
   - Line 1857: eCCA_TVI_PullThroughRating
   - Search for: eCCA_TVI_UnitRating, eCCA_TVI_ConcessionRating

2. **`QlikAppsAndLogicDictionaryDocs/Performance/tvd-coheus-performance-qlik/QSDA-[1.6.0] Performance-82c16f07-1efc-4482-ae53-99d8abba3ee4/Expressions.csv`**
   - Lines 1391-1450: Pull Through formulas
   - Search for: Volume Rating, Margin Rating, Turn Time Rating, Unit Rating, Concession Rating

3. **`QlikAppsAndLogicDictionaryDocs/tvd-coheus-incremental-builder-qlik/Transform.qvs`**
   - Lines 549-553: Revenue formulas
   - Line 87: Base Buy ($) calculation
   - Line 44: Origination Revenue calculation

4. **`QlikAppsAndLogicDictionaryDocs/Performance/tvd-coheus-performance-qlik/Scripts/TTS + Staffing Variables.qvs`**
   - Weight variable definitions
   - Check for any additional logic

---

## Success Criteria

After investigation, the following should match Qlik exactly:

1. **Individual Ratings** (for Stanley and Aaron):
   - Volume Rating: ±0.1 points
   - Margin Rating: ±0.1 points
   - Turn Time Rating: ±0.1 points
   - Pull Through Rating: ±0.1 points
   - Unit Rating: ±0.1 points
   - Concession Rating: ±0.1 points

2. **Final TTS Score:**
   - Stanley: equal to Qlik's 382.3
   - Aaron: equal to Qlik's 211.0
   - All other LOs: Within ±1 point

3. **Tier Distribution:**
   - Should match Qlik exactly: 13 Top / 8 Second / 23 Bottom

---

## Expected Findings

Based on ±30 point discrepancies, likely causes:

1. **Rounding differences:**
   - Qlik may round intermediate values
   - JavaScript floating point may accumulate errors
   - Solution: Round to match Qlik's precision

2. **Date range edge cases:**
   - First/last day of month handling
   - Timezone differences
   - Solution: Verify exact date boundaries

3. **Company average calculation:**
   - Slight differences in which actors are included
   - Different aggregation methods
   - Solution: Match Qlik's exact aggregation

4. **Missing filters:**
   - Subtle filters we're not applying
   - Edge cases in loan status handling
   - Solution: Add missing filters

5. **Revenue calculation:**
   - Base Buy vs Origination Points decision logic
   - Missing revenue components
   - Solution: Verify exact revenue formula

---

## Next Steps After Investigation

1. **Document findings** in this file or a new findings document
2. **Fix identified discrepancies** one at a time
3. **Test after each fix** to verify improvement
4. **Update documentation** with correct formulas
5. **Add unit tests** for edge cases

---

## Questions to Answer

1. What is the exact value of `vDefaultRevFlag` in Qlik? (0 = Base Buy, 1 = custom)
2. What is the exact value of `vCCA_ScorecardIncludeConcession`? (0 = exclude, 1 = include)
3. How does Qlik calculate `Rolling13MonthFlag` exactly?
4. Does Qlik round intermediate rating values or only the final TTS score?
5. Are there any additional filters we're missing?
6. How does Qlik handle actors with 0 units in company averages?
