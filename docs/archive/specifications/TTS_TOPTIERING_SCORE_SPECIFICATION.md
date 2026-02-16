# TopTiering Score (TTS) - Complete Specification

## Overview

The TopTiering Score (TTS) is a performance metric used to evaluate Loan Officers based on 6 key components. This document defines how TTS is calculated in our system and documents known discrepancies with the Qlik Performance app.

---

## TTS Formula

```
TTS = (VolumeRating × 2 + MarginRating × 2 + TurnTimeRating × 0.5 + 
       PullThroughRating × 1.5 + UnitRating × 2 + ConcessionRating × 2*) / TotalWeight
```

**Weights:**
| Component | Weight | Percentage |
|-----------|--------|------------|
| Volume | 2 | 20% |
| Margin (Revenue) | 2 | 20% |
| Turn Time | 0.5 | 5% |
| Pull Through | 1.5 | 15% |
| Units | 2 | 20% |
| Concession* | 2 | 20% |

*Concession is **conditionally included**:
- If company average concession = 0 → Concession EXCLUDED, TotalWeight = 8
- If company average concession ≠ 0 → Concession INCLUDED, TotalWeight = 10

---

## Rating Calculations

Each rating compares an individual Loan Officer's performance to the company average:

```
Rating = (LO Value / Company Average) × 100
```

A rating of **100 = average performance**.

### 1. Volume Rating
```
VolumeRating = (LO Total Volume / Avg Volume per LO) × 100
```
- **LO Total Volume**: Sum of `loan_amount` for all funded loans attributed to this LO
- **Avg Volume per LO**: Total company volume ÷ Number of LOs with volume > 0

### 2. Margin Rating (Revenue)
```
MarginRating = (LO Total Revenue / Avg Revenue per LO) × 100
```
- **Revenue Calculation** (per loan):
  ```
  Revenue = BaseBuy($) + OrigFeeBorrPd + OrigFeesSeller - CDLenderCredits
  
  Where: BaseBuy($) = Round(((rate_lock_buy_side_base_price_rate - 100) / 100) × LoanAmount, 0.01)
  ```
- **Important**: Only loans with `rate_lock_buy_side_base_price_rate > 0` are included in revenue calculations

### 3. Unit Rating
```
UnitRating = (LO Units / Avg Units per LO) × 100
```
- **Units**: Count of funded loans attributed to this LO

### 4. Pull-Through Rating
```
PullThroughRating = (LO PullThrough% / Avg PullThrough%) × 100
```
- **Pull-Through %**: Percentage of inactive loans that eventually funded
- **Formula**: 
  ```
  PullThrough = Count(Inactive loans with funding_date) / Count(All inactive loans with application_date)
  ```
- **Inactive Loan**: `current_loan_status ≠ 'Active Loan'` AND has `application_date`

### 5. Turn Time Rating (Inverse)
```
TurnTimeRating = (1/LO_AvgTurnTime) / (Avg of 1/TurnTime per LO) × 100
```
- **Turn Time**: `closing_date - application_date` (in days)
- **Note**: Uses INVERSE formula so faster (lower) turn times get higher ratings
- Only loans with `closing_date - application_date > 0` are included

### 6. Concession Rating
```
ConcessionRating = (LO Total Concession / Avg Concession per LO) × 100
```
- **Concession**: `branch_price_concession` field
- **Conditional**: Only included if company average concession ≠ 0

---

## Date Range: Rolling 13 Months

TTS uses a **Rolling 13 Month** window (current month + 12 previous months).

```
Start Date = First day of month, 12 months before vMaxDate's month
End Date = vMaxDate (max last_modified_date in database)
```

**Example** (if vMaxDate = January 22, 2026):
- Start: January 1, 2025
- End: January 22, 2026

---

## Filters Applied

### 1. Channel Filter
- `[Consolidated Channels] = 'Retail'` (configurable)
- Maps to: `channel` contains 'retail' or 'brok'

### 2. Missing LO Filter
Excludes loans where Loan Officer is:
- `'99-Missing'`
- `'Missing'`
- `'No LO Found'`
- `'No Loan Officer'`
- Empty/null
- Starts with `'99-'`

### 3. Funding Date Filter
- `DateType = 'Funding'` - Only includes loans with a valid `funding_date`

### 4. Date Range Filter
- `Rolling13MonthFlag = 'Yes'` - funding_date within rolling 13 months

---

## Known Qlik Discrepancies

### CRITICAL: Inconsistent Average Values in Qlik

**Discovery Date**: January 2026

The Qlik Performance app has an **internal inconsistency** where the TTS formula uses different date filters than the summary table display.

---

#### Root Cause: Different Date Filters

The Qlik app uses two different date filtering mechanisms that produce different results:

| Component | Date Filter Used | Result |
|-----------|-----------------|--------|
| **TTS Formula Averages** (`[CCA Scorecard *]` fields) | `[Date Interval]*={"Last $(vSalesScorecardMonthRange) Months"}` | Uses calendar-based "Last 12 Months" |
| **Summary Table Display** | `Rolling13MonthFlag*={Yes}` | Uses data-driven rolling window from `vMaxDate` |

**`[Date Interval]`** is a static calendar calculation (e.g., "Jan 2025 - Dec 2025")
**`Rolling13MonthFlag`** is calculated from `vMaxDate = Max(Last Modified Date)` and includes partial months

---

#### Current Average Values in TTS Formula

The TTS score formula (`eCCA_TVI_Score_13_Months`) divides each LO's metric by the company average.

The average variables (e.g., `vCCA_ScorecardVolumeAvg`) are **dynamically calculated**, but at the time of export they evaluated to:

| Variable | Current Value | Used In |
|----------|---------------|---------|
| `vCCA_ScorecardVolumeAvg` | 10,150,087 | Volume Rating |
| `vCCA_ScorecardMarginAvg` | 271,111.11 | Margin Rating |
| `vCCA_ScorecardUnitAvg` | 44.477273 | Unit Rating |
| `vCCA_ScorecardPullThroughAvg` | 0.64184293 | Pull-Through Rating |
| `vCCA_ScorecardTurnTimeAvg` | 0.028419969 | Turn Time Rating |

These values are calculated from the `[CCA Scorecard *]` fields (see next section).

---

#### How the Averages Are Calculated

**Step 1: `[CCA Scorecard Volume]` field** (dynamic measure):
```qvs
if(
    Sum(Aggr([CCA Current Production Check], $(vCCA_ScorecardAggrLevel))) < 0,
    Null(),
    Avg(
        Aggr(
            Sum({<
                [Date Interval]*={"Last $(vSalesScorecardMonthRange) Months"}, 
                DateType*={'$(vCCA_TVI_DateType)'}, 
                [Consolidated Channels]*={'$(vCCA_ChannelGroup)'}, 
                $(vCCA_ScorecardMissingLevel)
            >}
            [Loan Amount]),
            $(vCCA_ScorecardAggrLevel)
        )
    )
)
```

**Variable Defaults** (when viewing Sales Scorecard):
- `vSalesScorecardMonthRange` = `12`
- `vCCA_TVI_DateType` = `Funding`
- `vCCA_ChannelGroup` = `Retail`
- `vCCA_ScorecardAggrLevel` = `[Loan Officer]`

**Step 2: `vCCA_ScorecardVolumeAvg`** (Variables.csv line 9506):
```qvs
=Avg({$<[CCA Scorecard Volume] *= {">0"}, $(vCCA_ScorecardMissingLevel), $(vCCA_ScorecardIgnoreLevel)>}
    Aggr({$<$(vCCA_ScorecardIgnoreLevel)>}
        [CCA Scorecard Volume],
        $(vCCA_ScorecardAggrLevel)))
```

**Key Finding**: The `[CCA Scorecard Volume]` field uses `[Date Interval]*={"Last 12 Months"}` filter, which is different from `Rolling13MonthFlag*={Yes}` used in the summary table display.

---

#### Summary Table Uses Different Filter

The summary table Units expression (Expressions.csv line 11430):
```qvs
Count({<Rolling13MonthFlag*={Yes}, DateType*={'$(vCCA_TVI_DateType)'}, 
       [Consolidated Channels]*={'$(vCCA_ChannelGroup)'}, ...>}
      [Loan Number])
```

**Uses**: `Rolling13MonthFlag*={Yes}` - calculated from `vMaxDate`:
```qvs
// From Script.csv - Rolling13MonthFlag calculation
If(FundingDate > vMaxDate, 'No',
   If(FundingDate >= AddMonths(MonthEnd(vMaxDate), -13, 1), 'Yes', 'No'))
```

**The Difference**:
- `[Date Interval]='Last 12 Months'` = Fixed calendar months (e.g., Jan-Dec 2025)
- `Rolling13MonthFlag='Yes'` = Dynamic window from `vMaxDate` (includes current partial month)

---

#### Resulting Value Discrepancy

| Metric | TTS Formula Average | Our Calculation | Difference |
|--------|---------------------|-----------------|------------|
| Volume Avg | $10,150,087 | $10,657,448 | +5.0% |
| Margin Avg | $271,111 | $291,643 | +7.6% |
| Unit Avg | 44.477 | 46.614 | +4.8% |
| PullThrough Avg | 64.18% | 68.40% | +6.6% |
| TurnTime Avg | 0.0284 | 0.0280 | -1.4% |

---

#### Impact on TTS Scores

Because the TTS formula uses **lower averages** (from the `[Date Interval]` filter):
- Individual ratings are **higher** in Qlik than they should be
- Stanley's Qlik TTS: 382.3 vs Our TTS: ~376 (using correct averages)
- ~5-15 point difference depending on the LO

**Example - Stanley's Volume Rating:**
- Using Qlik's avg ($10.15M): `$47.87M / $10.15M × 100 = 471.6`
- Using correct avg ($10.66M): `$47.87M / $10.66M × 100 = 449.2`

---

#### Our Implementation Decision

Our implementation uses **consistent calculations**:
- Display values match what's used in TTS calculation
- All calculations use `Rolling13MonthFlag` equivalent date range
- Averages are calculated live from the same funded loan dataset

The Qlik app has an architectural bug where:
1. Pre-calculated fields use `[Date Interval]='Last 12 Months'`
2. Summary displays use `Rolling13MonthFlag='Yes'`
3. These are NOT equivalent date ranges

---

## Implementation Details

### File Locations
- **Backend**: `server/src/routes/loans.ts` - `/api/loans/sales-scorecard` endpoint
- **Frontend**: `src/pages/SalesScorecard.tsx` - Display component

### Key Functions in Backend

1. **`calcLoanRevenue(loan)`**: Calculates revenue per loan using Base Buy formula
2. **`calcTurnTime(loan)`**: Returns closing_date - application_date in days
3. **`isActorMissing(name)`**: Checks if LO name is a placeholder/missing value
4. **Company averages**: Calculated by summing per-LO totals, then dividing by count of LOs with value > 0

### Debug Logging

The backend outputs comparison tables showing:
- Our calculated averages vs Qlik reference values
- All actors sorted by volume
- Stanley's detailed TTS breakdown

---

## Verification Checklist

When comparing to Qlik, verify:

- [ ] Total loan count matches (~2,051)
- [ ] Total volume matches (~$469M)
- [ ] Actor count matches (44)
- [ ] Date range is correct (Rolling 13 months from vMaxDate)
- [ ] Channel filter applied (Retail)
- [ ] Missing LO filter applied

### Expected Differences

Due to the Qlik inconsistency documented above, expect:
- **TTS Scores**: Our scores will be ~5-15 points different from Qlik
- **Averages**: Our averages will be ~5% higher than Qlik's TTS variables
- **Display Values**: Our display values should match Qlik's summary tables

---

## Changelog

| Date | Change | Author |
|------|--------|--------|
| 2026-01-26 | Initial documentation of TTS formula and Qlik discrepancies | AI Assistant |
| 2026-01-26 | Documented vCCA_ScorecardVolumeAvg vs Summary Table inconsistency | AI Assistant |
