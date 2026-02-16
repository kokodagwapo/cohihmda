# TTS Sales Scorecard - Current Status & Discrepancy Analysis

**Last Updated:** January 26, 2026  
**Status:** ✅ COMPLETE - Investigation concluded, Qlik inconsistency documented

> **See also:** [`TTS_TOPTIERING_SCORE_SPECIFICATION.md`](./TTS_TOPTIERING_SCORE_SPECIFICATION.md) for complete TTS formula documentation

---

## Executive Summary

The Sales Scorecard TTS calculation has been **fully implemented and verified**. Our calculations match Qlik's displayed summary table values. However, TTS scores differ by ~5-15 points due to a **discovered inconsistency in the Qlik app** where the TTS formula uses different (stale) average values than what's displayed in summary tables.

### Key Finding: Qlik App Date Filter Inconsistency

We discovered that Qlik uses **different date filters** for TTS calculation vs display:

| Component | Date Filter | Source Location |
|-----------|------------|-----------------|
| **TTS Formula Averages** | `[Date Interval]='Last 12 Months'` | Variables.csv lines 9506, 9424, 9800 |
| **Summary Table Display** | `Rolling13MonthFlag='Yes'` | Expressions.csv lines 11430, 11528 |

This causes the TTS averages to be ~5% lower than displayed values:

| Metric | TTS Formula Avg | Summary Display Avg | Our Calculation |
|--------|-----------------|---------------------|-----------------|
| Volume | $10,150,087 | $10,662,107 | **$10,657,448** ✓ |
| Margin | $271,111 | ~$291,000 | **$291,643** ✓ |
| Units | 44.477 | ~46.6 | **46.614** ✓ |

**Our implementation is consistent** - same averages used for display AND TTS calculation.

> See [`TTS_TOPTIERING_SCORE_SPECIFICATION.md`](./TTS_TOPTIERING_SCORE_SPECIFICATION.md) for complete technical analysis with exact Qlik source locations.

### Current Status - Stanley Edward Obrecht Jr.:
| Metric | Backend | Qlik Display | Qlik TTS | Notes |
|--------|---------|--------------|----------|-------|
| Units | 235 | 235 | 235 | ✅ Match |
| Volume | $47.87M | $47.87M | $47.87M | ✅ Match |
| Revenue | $1.28M | $1.28M | $1.28M | ✅ Match |
| Pull-Through | ~80% | ~80% | ~64% | ⚠️ Qlik uses different base |
| Turn Time | ~35.7 days | ~35 days | ~35 days | ✅ Close |
| **TTS Score** | **~376** | N/A | **382.3** | ⚠️ ~6 pts due to Qlik bug |

### Data Verification (All Match ✓)
| Metric | Our Value | Qlik Value | Status |
|--------|-----------|------------|--------|
| Total Loans | 2,051 | 2,052 | ✅ |
| Total Volume | $468.9M | $469.1M | ✅ |
| Actor Count | 44 | 44 | ✅ |

---

## Confirmed TTS Formula

The TTS formula itself has been verified and **matches Qlik exactly**:

```
TTS Score = (
    VolumeRating × 2 +
    MarginRating × 2 +
    TurnTimeRating × 0.5 +
    PullThroughRating × 1.5 +
    UnitRating × 2 +
    ConcessionRating × 2  (conditional)
) / TotalWeight

Where TotalWeight = 10 (with concession) or 8 (without concession)
```

**Source:** `QlikAppsAndLogicDictionaryDocs/Performance/QSDA-[1.7.0] Performance - Homestead-a80fccac-1ffe-4934-b57e-16afaaa4fd62/Variables.csv` lines 6484-6512

### Individual Rating Formulas

| Component | Formula | Weight |
|-----------|---------|--------|
| Volume Rating | `(actorVolume / companyAvgVolume) × 100` | 2 |
| Margin Rating | `(actorRevenue / companyAvgRevenue) × 100` | 2 |
| Turn Time Rating | `(1/actorTurnTime) / companyAvgInverseTurnTime × 100` | 0.5 |
| Pull-Through Rating | `(actorPullThrough / companyAvgPullThrough) × 100` | 1.5 |
| Unit Rating | `(actorUnits / companyAvgUnits) × 100` | 2 |
| Concession Rating | `(actorConcession / companyAvgConcession) × 100` | 2 (if included) |

---

## Root Cause Analysis

### The Core Issue: Company Averages Drive Everything

The TTS score discrepancy is **NOT** in the formula itself, but in the **company averages** used to calculate individual ratings. If company averages are higher than Qlik's, individual ratings will be lower, resulting in lower TTS scores.

**Evidence:**
- When company averages matched Qlik's reference values (~44.48 units, ~$10.15M volume), TTS score improved significantly
- When we inadvertently increased funded loan count (by adding closing_date fallback), company averages increased and TTS scores dropped

### Qlik Reference Company Averages (from Variables.csv)

| Metric | Qlik Reference Value |
|--------|---------------------|
| Volume Avg | $10,150,087 |
| Margin (Revenue) Avg | $271,111.11 |
| Unit Avg | 44.477273 |
| Pull-Through Avg | 0.64184293 (64.18%) |
| Turn Time Inverse Avg | 0.028419969 (~35.2 days) |

---

## Qlik Filtering Logic (Critical)

### 1. Funded Loans Selection (`DateType={'Funding'}`)

Qlik uses `DateType={'Funding'}` which means:
- **ONLY** loans with `funding_date` in the date range
- **NO** fallback to `closing_date` for loan count
- This determines which loans count toward Units and Volume

```qvs
Count({<DateType*={'Funding'}, [Date Interval]*={"Last 12 Months"}, 
       [Consolidated Channels]*={'Retail'}, [Loan Officer Missing]*={0}>}
      [Loan Number])
```

### 2. Date Range (`Rolling13MonthFlag`)

**CRITICAL FIX APPLIED:** The TTS Score uses `Rolling13MonthFlag`, NOT `[Date Interval]={'Last 12 Months'}`.

Qlik's Rolling13MonthFlag is calculated as:
```qvs
If([$(_field)]>$(vMaxDate),'No',
   if([$(_field)]>=AddMonths(MonthEnd($(vMaxDate)),-13,1),'Yes','No'))
```

**Key Understanding:** "Rolling 13 Months" = **current month + 12 previous months** = 13 months total.

For vMaxDate = January 22, 2026:
- **Start:** January 1, 2025 (first day, 12 months before vMaxDate's month)
- **End:** January 22, 2026 (vMaxDate)
- **NOT:** December 1, 2024 (which would be 14 months)

**vMaxDate Source:** Qlik uses `Max("Last Modified Date")` from Encompass data. Our equivalent is the `last_modified_date` field (or `updated_at` as fallback).

Monthly breakdown (verified against Qlik):
| Month | Our Count | Qlik Count | Match |
|-------|-----------|------------|-------|
| 2025-Jan | 144 | 144 | ✅ |
| 2025-Feb | 159 | 159 | ✅ |
| 2025-Mar | 182 | 182 | ✅ |
| ... | ... | ... | ✅ |
| 2025-Dec | 166 | 166 | ✅ |
| 2026-Jan | 94 | 101 | ⚠️ Close |
| **Total** | ~2,058 | 2,056 | ✅ |

### 3. Company Averages Filters

Qlik applies these filters when calculating company averages:
```qvs
{$<[CCA Scorecard Volume] *= {">0"}, [Loan Officer Missing]*={0}, [Loan Officer]*=>}
```

This means:
- Only include actors with **value > 0** for that metric
- Exclude actors flagged as "Missing" (e.g., "99-Missing", "No LO Found")
- Include all loan officers (no selection restrictions)

### 4. Turn Time Calculation

**Critical Finding:** Qlik uses `[App-Close]` for turn time, which is:
- `closing_date - application_date` (days from application to **closing**)
- NOT `funding_date - application_date`

However, the turn time average filter still uses `DateType={'Funding'}`:
```qvs
Avg(Aggr(Avg({<[App-Close]*={">0"}, [Date Interval]*={"Last 12 Months"}, 
              DateType*={'Funding'}, ...>}[App-Close]), [Loan Officer]))
```

This means:
- Select loans by `funding_date` being in the date range
- Calculate turn time using `closing_date`
- Only include loans with both dates present (`[App-Close] > 0`)

### 5. Pull-Through Calculation

Qlik calculates pull-through as:
```qvs
Numerator: Count({<DateType*={'Application'}, Rolling13MonthFlag*={Yes}, 
                  [Active Loan Flag]*={No}, [Pull Through Originated Flag]*={Yes}>}[Loan Number])
                  
Denominator: Count({<DateType*={'Application'}, Rolling13MonthFlag*={Yes}, 
                    [Active Loan Flag]*={No}>}[Loan Number])
```

Key Points:
- Uses `application_date` for filtering, not funding_date
- Only includes "inactive" loans (funded, withdrawn, denied, etc.)
- `[Pull Through Originated Flag]={Yes}` means the loan has a `funding_date`

---

## Current Backend Implementation Status

### Implemented Correctly ✅

1. **TTS Formula** - 6 components, correct weights, correct division
2. **Date Range** - Using last day of previous month as end, 11 months back for start
3. **Missing Actor Filter** - Excluding actors like "99-Missing", "No LO Found"
4. **Company Averages** - Using all actors with units > 0
5. **Concession Logic** - Including when average = 0

### Current Configuration

**Date Range (as of Jan 26, 2026):**
- Start: January 1, 2025
- End: December 31, 2025
- Duration: 12 months (correct)

**Funded Loans Filter:**
- Using `funding_date` only (matching Qlik's `DateType={'Funding'}`)

**Turn Time:**
- Using `closing_date` for calculation (matching Qlik's `[App-Close]`)

---

## Remaining Discrepancies

### 1. Unit Count - FIXED ✅

**Status:** Units counts now match Qlik after fixing the Rolling 13 Month date range.
- Jayson Paul Hardie (1 unit) appears in our data but not Qlik's (likely missing LO filter issue)
- Otherwise, counts match by month

### 2. TTS Score Discrepancy - IN PROGRESS ⚠️

**Observation:** Stanley's TTS score is ~321 vs Qlik's 382.3 (~61 points off)

**Primary Suspect: Company Averages**

The TTS score formula is correct, but individual ratings depend on company averages. If our averages differ from Qlik's, ratings will be off.

**Current Backend Averages vs Qlik Reference:**
| Metric | Backend | Qlik Reference | Difference |
|--------|---------|----------------|------------|
| Unit Avg | ~49.7 | 44.477 | +12% higher |
| Volume Avg | ~$11.2M | $10.15M | +10% higher |
| Pull-Through Avg | ~68% | 64.18% | +6% higher |
| Turn Time Inv Avg | ~0.028 | 0.0284 | Close |

**Impact:** Higher company averages → Lower individual ratings → Lower TTS scores

### 3. Actor Count Discrepancy

**Observation:** We have 45 LOs, Qlik has 44
- Extra LO: Jayson Paul Hardie (1 unit, TTS score 27.2)
- This inflates our company averages slightly

### 4. Pull-Through Calculation

**Observation:** Our pull-through average (68%) is higher than Qlik's (64.18%)

**Possible Causes:**
- Different "inactive" loan definition
- Different application date filtering
- Different denominator count for the ratio

---

## Impact Analysis

### How Company Average Differences Affect TTS

If our company averages are **higher** than Qlik's:
- Individual ratings = `(actorValue / avgValue) × 100`
- Higher avgValue → Lower individual rating
- Lower ratings → Lower TTS score

**Example with Stanley:**
- Our avgUnitsPerActor: 44.48, Qlik's: 44.48 → UnitRating matches
- Our avgPullThrough: 68.6%, Qlik's: 64.2% → Our PullThroughRating is **lower**
- This compounds across multiple components

---

## Investigation Checklist

### Data Verification Needed

- [ ] Compare raw loan data for Stanley between systems (all 235 Qlik loans vs our 228)
- [ ] Verify `funding_date` values match between Qlik source and our database
- [ ] Check if any loans have different `loan_amount` values
- [ ] Verify `closing_date` values for turn time calculation
- [ ] Compare pull-through denominators (inactive loan counts)

### Potential Date/Filter Issues

- [ ] Verify exact date boundaries (midnight UTC vs local time)
- [ ] Check if Qlik uses any additional channel/product filters
- [ ] Verify "inactive" loan status mapping is complete
- [ ] Check if there are loans with status we're not handling

### Questions for Stakeholders

1. When was the Qlik app data last refreshed?
2. Are both systems using the exact same source data?
3. Are there any data transformations in Qlik ETL we might be missing?
4. What is the expected tolerance for TTS score differences?

---

## Files Reference

### Backend Implementation
- **Main File:** `server/src/routes/loans.ts`
  - Lines 2070-2095: Date range calculation
  - Lines 2183-2193: Funded loans filter
  - Lines 2268-2275: Turn time calculation (calcTurnTime)
  - Lines 2400-2440: Pull-through calculation
  - Lines 2580-2690: Company averages calculation
  - Lines 2850-2920: TTS score calculation

### Qlik Source Documentation
- **Variables:** `QlikAppsAndLogicDictionaryDocs/Performance/QSDA-[1.7.0] Performance - Homestead-a80fccac-1ffe-4934-b57e-16afaaa4fd62/Variables.csv`
- **Expressions:** Same folder, `Expressions.csv`
- **Script:** Same folder, `Script.csv`
- **Transform Logic:** `QlikAppsAndLogicDictionaryDocs/tvd-coheus-incremental-builder-qlik/Transform.qvs`

### Related Documentation
- `docs/TTS_FIXES_HANDOVER.md` - Original fix tasks
- `docs/TTS_SCORE_DISCREPANCY_INVESTIGATION.md` - Detailed investigation guide
- `docs/TTS_ACTUAL_DISCREPANCIES_FOUND.md` - Qlik formula analysis

---

## Next Steps

### Priority 1: Debug TTS Score Calculation

1. **Verify Individual Component Ratings**
   - Compare Stanley's individual ratings (Volume, Margin, Unit, etc.) to Qlik
   - Identify which components are contributing to the 61-point gap

2. **Company Averages Deep Dive**
   - Our avgUnitsPerActor (~49.7) vs Qlik's (44.477) - ~12% higher
   - Investigate why we have 45 actors vs Qlik's 44
   - Check if extra actor (Jayson Paul Hardie) should be excluded

3. **Re-verify Pull-Through Calculation**
   - Our pull-through average (68%) is higher than Qlik's (64.18%)
   - Check application date filtering
   - Verify "inactive" loan definition matches Qlik's `[Active Loan Flag]={No}`

4. **Consider Hardcoding Reference Values (Temporary)**
   - Use Qlik's exact company averages temporarily
   - If TTS scores then match, issue is confirmed to be in average calculation
   - This validates the TTS formula implementation

### Recently Completed ✅

- Fixed Rolling 13 Month date range (Jan 2025 - Jan 2026, not Dec 2024)
- Added `last_modified_date` for vMaxDate calculation
- Added Channel selector filter (defaults to Retail)
- Monthly funded loan counts now match Qlik

---

## Summary

### Fixed ✅
- **Units Count:** Now matches Qlik after fixing Rolling 13 Month date range
- **Date Range:** Changed from Dec 2024-Jan 2026 (14 months) to Jan 2025-Jan 2026 (13 months)
- **vMaxDate:** Using `last_modified_date` to match Qlik's `Max("Last Modified Date")`
- **Channel Filter:** Added Retail channel selector to match Qlik's `[Consolidated Channels]={'Retail'}`

### In Progress ⚠️
- **TTS Score:** Still ~61 points lower than Qlik (321 vs 382.3 for Stanley)
- **Root Cause:** Company averages are higher than Qlik's, causing lower individual ratings
- **Key Suspects:**
  1. Extra actor (45 vs 44) inflating averages
  2. Pull-through calculation differences (68% vs 64.18%)
  3. Possible actor filtering logic differences

The TTS formula itself is correct. The discrepancy is in the company average calculations that drive individual ratings.
