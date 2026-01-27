# Sales Scorecard Summary Table - Complete Specification

## Overview

The Sales Scorecard Summary Table displays key performance metrics for Loan Officers, grouped by tier (Top, Second, Bottom). This document defines exactly how each metric is calculated, including the Qlik expressions and our implementation.

---

## Table Structure

| Column | Description |
|--------|-------------|
| Metric | Row label |
| Totals | Company-wide total/average |
| Top Tier | Top performers (highest TTS scores) |
| Second Tier | Middle performers |
| Bottom Tier | Lowest performers |

---

## Date Range: Rolling 13 Months

All metrics use a **Rolling 13 Month** window:

```
Start Date = First day of month, 12 months before vMaxDate's month
End Date = vMaxDate (max last_modified_date in database)
```

**Qlik Variable**: `Rolling13MonthFlag = 'Yes'`

---

## Common Filters

Unless otherwise specified, all metrics apply these filters:

| Filter | Qlik Expression | Our Implementation |
|--------|-----------------|-------------------|
| Date Type | `DateType = 'Funding'` | `funding_date` within range |
| Channel | `[Consolidated Channels] = '$(vCCA_ChannelGroup)'` | Retail (configurable) |
| Missing LO | `[Loan Officer Missing] = 0` | Exclude '99-Missing', 'Missing', etc. |
| Rolling 13 Month | `Rolling13MonthFlag = 'Yes'` | `funding_date` within date range |

---

## Metric Specifications

### Row 1: Loan Officer Count

**Description**: Count of active Loan Officers in the tier/company.

**Qlik Expression**:
```qlik
Count(distinct [Loan Officer])
```

**Our Implementation**:
```typescript
// Count of actors with TTS score > 0
actors.filter(a => a.ttsScore > 0).length
```

---

### Row 2: TTS Long Term Score

**Description**: Average TopTiering Score for the tier/company.

**Qlik Expression**:
```qlik
Avg(Aggr([eCCA_TVI_Score_13_Months], [Loan Officer]))
```

**Our Implementation**:
```typescript
// Average TTS across all actors in tier
tierActors.reduce((sum, a) => sum + a.ttsScore, 0) / tierActors.length
```

**See**: `TTS_TOPTIERING_SCORE_SPECIFICATION.md` for full TTS calculation details.

---

### Row 3: Loan Complexity Score

**Description**: Average loan complexity score for the tier.

**Qlik Expression**:
```qlik
Avg(Aggr(
  Sum({<...filters...>}[Loan Complexity Score]) / Count({<...filters...>}[Loan Number]),
  [Loan Officer]
))
```

**Our Implementation**:
```typescript
// Calculate complexity score per loan, then average per actor
const loanComplexity = occupancyFactor + ltvFactor + employmentFactor + purposeFactor;
// Average across actors
tierActors.reduce((sum, a) => sum + a.loanComplexityScore, 0) / tierActors.length
```

**Factors**:
- Occupancy: Non-owner occupied = 1, else 0
- LTV: > 80% = 1, else 0
- Employment: Self-employed = 1, else 0
- Purpose: Refinance = 1, else 0

---

### Row 4: Units

**Description**: Total funded loan count.

**Qlik Expression**:
```qlik
Count({<DateType={'Funding'}, Rolling13MonthFlag={Yes}, ...>}[Loan Number])
```

**Our Implementation**:
```typescript
fundedLoans.filter(l => tierActorNames.has(l.loan_officer)).length
```

---

### Row 5: Units %

**Description**: Percentage of total units attributed to this tier.

**Qlik Expression**:
```qlik
Count(Tier Units) / Count(Total Units) * 100
```

**Our Implementation**:
```typescript
(tierUnits / totalUnits) * 100
```

---

### Row 6: Volume

**Description**: Total funded loan volume (sum of loan amounts).

**Qlik Expression**:
```qlik
Sum({<DateType={'Funding'}, Rolling13MonthFlag={Yes}, ...>}[Loan Amount])
```

**Our Implementation**:
```typescript
tierLoans.reduce((sum, l) => sum + parseFloat(l.loan_amount), 0)
```

---

### Row 7: Volume %

**Description**: Percentage of total volume attributed to this tier.

**Qlik Expression**:
```qlik
Sum(Tier Volume) / Sum(Total Volume) * 100
```

**Our Implementation**:
```typescript
(tierVolume / totalVolume) * 100
```

---

### Row 8: Revenue $

**Description**: Total revenue from funded loans.

**Qlik Expression**:
```qlik
Sum({<[Rate Lock Buy Side Base Price Rate]={">0"}, ...>}
  Round(([Rate Lock Buy Side Base Price Rate]-100)/100*[Loan Amount],0.01)
  + [Orig Fee Borr Pd]
  + [Orig Fees Seller]
  - [CD Lender Credits]
)
```

**Our Implementation**:
```typescript
function calcLoanRevenue(loan) {
  const baseBuyDollars = ((basePriceRate - 100) / 100) * loanAmount;
  return baseBuyDollars + origFeeBorrPd + origFeesSeller - cdLenderCredits;
}
```

**Filter**: Only loans with `rate_lock_buy_side_base_price_rate > 0`

---

### Row 9: Revenue (BPS)

**Description**: Revenue expressed in basis points relative to volume.

**Qlik Expression**:
```qlik
(Sum(Revenue) / Sum(Volume)) * 10000
```

**Our Implementation**:
```typescript
(tierRevenue / tierVolume) * 10000
```

---

### Row 10: Lost Opportunity Revenue

**Description**: Revenue that would have been earned from lost opportunity loans.

**Qlik Expression**:
```qlik
Sum({<[Current Loan Status]*={"*withdraw*","*not accepted*","*incomp*"}, DateType={'Application'}, ...>}
  [Revenue Calculation]
)
```

**Our Implementation**:
```typescript
lostOpportunityLoans.reduce((sum, l) => sum + calcLoanRevenue(l), 0)
```

**Note**: Uses `application_date` for date range, not `funding_date`.

---

### Row 11: Average Conditions

**Description**: Average number of underwriting conditions per loan.

**Qlik Expression**:
```qlik
Avg(Aggr(
  Sum({<...>}[Number Of Conditions]) / Count({<...>}[Loan Number]),
  [Loan Officer]
))
```

**Our Implementation**:
```typescript
const totalConditions = tierLoans.reduce((sum, l) => sum + (l.number_of_conditions || 0), 0);
totalConditions / tierLoans.length
```

**Database Field**: `number_of_conditions` (Encompass field `Fields.UWC.ALLCOUNT`)

---

### Row 12: Turn Time App to Consumer Close

**Description**: Average days from application to closing.

**Qlik Expression**:
```qlik
Avg(Aggr(
  Sum({<...>}[Closing Date] - [Application Date]) / Count({<...>}[Loan Number]),
  [Loan Officer]
))
```

**Our Implementation**:
```typescript
const turnTime = (closingDate - applicationDate) / (1000 * 60 * 60 * 24); // days
// Average per actor, then average of actors
```

**Filter**: Only loans where `closing_date - application_date > 0`

---

### Row 13: Pull Through

**Description**: Percentage of applications that became funded loans.

**Qlik Expression**:
```qlik
Avg(Aggr(
  Count({<[Active Loan Flag]={No}, DateType={'Application'}, ...>}[Funded Inactive Loans])
  /
  Count({<[Active Loan Flag]={No}, DateType={'Application'}, ...>}[All Inactive Loans]),
  [Loan Officer]
))
```

**Our Implementation**:
```typescript
// Per actor: funded inactive loans / all inactive loans
// Then average across actors
const actorPullThrough = fundedInactiveLoans.length / allInactiveLoans.length;
avgPullThrough = actors.reduce((sum, a) => sum + a.pullThrough, 0) / actors.length;
```

**Key Filters**:
- `[Active Loan Flag] = 'No'` (inactive loans only)
- `DateType = 'Application'` (uses application_date for range)

---

### Row 14: WA W-H Days (Weighted Average Warehouse Holding Days)

**Description**: Loan-amount-weighted average days loans spend in warehouse.

**Qlik Expression**:
```qlik
Avg(Aggr(
  Sum({<[Investor Status]-={'Purchased'}, Channel-={'Brokered'}, ...>}[W-H Days] * [Loan Amount])
  /
  Sum({<[Investor Status]-={'Purchased'}, Channel-={'Brokered'}, ...>}[Loan Amount]),
  [Loan Officer]
))
```

**W-H Days Calculation** (from `Transform.qvs` line 180-181):
```qlik
If(Len("Investor Purchase Date")>0, 
   "Investor Purchase Date" - "Funding Date",
   If(Len("Investor Purchase Date")=0 AND Len("Funding Date")>0, 
      Date(Floor($(vMaxDate))) - "Funding Date", 
      0)
) as "W-H Days"
```

**Our Implementation**:
```typescript
if (investor_purchase_date) {
  whDays = investor_purchase_date - funding_date;
} else if (funding_date) {
  whDays = effectiveEndDate - funding_date; // vMaxDate equivalent
} else {
  whDays = 0;
}

// Weighted average
waWhDays = Sum(whDays * loanAmount) / Sum(loanAmount);
```

**Filters**:
- `[Investor Status] != 'Purchased'`
- `Channel != 'Brokered'`

**Database Fields**:
- `investor_purchase_date` (Encompass `Fields.2370`)
- `funding_date` (Encompass `Fields.MS.FUN`)

---

### Row 15: WA FICO (Weighted Average FICO Score)

**Description**: Loan-amount-weighted average FICO score.

**Qlik Expression**:
```qlik
Sum({<...>}[FICO Score] * [Loan Amount]) / Sum({<...>}[Loan Amount])
```

**Our Implementation**:
```typescript
waFico = Sum(fico_score * loan_amount) / Sum(loan_amount)
```

---

### Row 16: WA LTV (Weighted Average Loan-to-Value)

**Description**: Loan-amount-weighted average LTV ratio.

**Qlik Expression**:
```qlik
Sum({<...>}[LTV Ratio] * [Loan Amount]) / Sum({<...>}[Loan Amount])
```

**Our Implementation**:
```typescript
waLtv = Sum(ltv_ratio * loan_amount) / Sum(loan_amount)
```

---

### Row 17: WA DTI (Weighted Average Debt-to-Income)

**Description**: Loan-amount-weighted average DTI ratio.

**Qlik Expression**:
```qlik
Sum({<[DTI Out of Range Flag]={No}, ...>}[BE DTI Ratio] * [Loan Amount]) 
/ 
Sum({<[DTI Out of Range Flag]={No}, ...>}[Loan Amount])
```

**Our Implementation**:
```typescript
// Filter: DTI must be in valid range (0-150%)
if (dtiRatio > 0 && dtiRatio <= 150) {
  waDti = Sum(be_dti_ratio * loan_amount) / Sum(loan_amount);
}
```

**Filter**: `[DTI Out of Range Flag] = 'No'` - excludes unreasonable DTI values

---

### Row 18: Lost Opportunity Units

**Description**: Count of lost opportunity loans (withdrawn, cancelled, incomplete).

**Qlik Expression**:
```qlik
Count({<[Current Loan Status]*={"*withdraw*","*not accepted*","*incomp*"}, DateType={'Application'}, ...>}[Loan Number])
```

**Our Implementation**:
```typescript
const lostOpportunityLoans = loans.filter(l => {
  const status = l.current_loan_status.toUpperCase();
  return status.includes('WITHDRAWN') || status.includes('CANCELLED') ||
         status.includes('NOT ACCEPTED') || status.includes('INCOMPLETE');
});
```

**IMPORTANT**: Lost Opportunity does NOT include denied loans (they are counted separately).

---

### Row 19: Lost Opportunity Units %

**Description**: Lost opportunity loans as percentage of total applications.

**Qlik Expression**:
```qlik
Count(Lost Opportunity Loans) / Count(Total Applications) * 100
```

**Our Implementation**:
```typescript
// Denominator is TOTAL APPLICATIONS (not funded units)
lostOpportunityUnitsPercent = (lostOpportunityLoans / totalApplications) * 100
```

**Key**: Uses total applications (loans with `application_date` in range) as denominator.

---

### Row 20: Denied Units

**Description**: Count of denied loans.

**Qlik Expression**:
```qlik
Count({<[Current Loan Status]*={"*denied*"}, DateType={'Application'}, ...>}[Loan Number])
```

**Our Implementation**:
```typescript
const deniedLoans = loans.filter(l => {
  const status = l.current_loan_status.toUpperCase();
  return status.includes('DENIED') || status.includes('DECLINED');
});
```

---

### Row 21: Denied Units %

**Description**: Denied loans as percentage of total applications.

**Qlik Expression**:
```qlik
Count(Denied Loans) / Count(Total Applications) * 100
```

**Our Implementation**:
```typescript
deniedUnitsPercent = (deniedLoans / totalApplications) * 100
```

---

### Row 22: Lost Opportunity & Denied Revenue

**Description**: Combined revenue from lost opportunity and denied loans.

**Qlik Expression**:
```qlik
Sum(Lost Opportunity Revenue) + Sum(Denied Revenue)
```

**Our Implementation**:
```typescript
lostOppAndDeniedRevenue = lostOpportunityRevenue + deniedRevenue
```

---

### Row 23: Lost Opportunity & Denied Revenue BPS

**Description**: Combined lost revenue as basis points of funded volume.

**Qlik Expression**:
```qlik
(Sum(Lost Opp Revenue + Denied Revenue) / Sum(Funded Volume)) * 10000
```

**Our Implementation**:
```typescript
lostOppAndDeniedRevenueBps = (lostOppAndDeniedRevenue / fundedVolume) * 10000
```

---

### Row 24: Average LO Revenue

**Description**: Average revenue per Loan Officer.

**Qlik Expression**:
```qlik
Sum(Revenue) / Count(distinct [Loan Officer])
```

**Our Implementation**:
```typescript
avgLoRevenue = totalRevenue / loCount
```

---

### Row 25: Average LO Units

**Description**: Average units per Loan Officer.

**Qlik Expression**:
```qlik
Count(Units) / Count(distinct [Loan Officer])
```

**Our Implementation**:
```typescript
avgLoUnits = totalUnits / loCount
```

---

### Row 26: Average LO Units per Month

**Description**: Average units per LO per month (over 13 months).

**Qlik Expression**:
```qlik
(Count(Units) / Count(distinct [Loan Officer])) / 13
```

**Our Implementation**:
```typescript
avgLoUnitsPerMonth = avgLoUnits / 13
```

---

### Row 27: Average LO Volume

**Description**: Average volume per Loan Officer.

**Qlik Expression**:
```qlik
Sum(Volume) / Count(distinct [Loan Officer])
```

**Our Implementation**:
```typescript
avgLoVolume = totalVolume / loCount
```

---

### Row 28: Average LO Volume per Month

**Description**: Average volume per LO per month (over 13 months).

**Qlik Expression**:
```qlik
(Sum(Volume) / Count(distinct [Loan Officer])) / 13
```

**Our Implementation**:
```typescript
avgLoVolumePerMonth = avgLoVolume / 13
```

---

## Database Field Mappings

| Metric | Database Field | Encompass Field ID |
|--------|---------------|-------------------|
| Loan Amount | `loan_amount` | `Fields.2` |
| FICO Score | `fico_score` | `Fields.VASUMM.X23` |
| LTV Ratio | `ltv_ratio` | `Fields.353` |
| DTI Ratio | `be_dti_ratio` | `Fields.742` |
| Number of Conditions | `number_of_conditions` | `Fields.UWC.ALLCOUNT` |
| Investor Purchase Date | `investor_purchase_date` | `Fields.2370` |
| Funding Date | `funding_date` | `Fields.MS.FUN` |
| Closing Date | `closing_date` | `Fields.748` |
| Application Date | `application_date` | `Fields.3142` |
| Investor Status | `investor_status` | `Fields.2031` |
| Channel | `channel` | `Fields.2626` |
| Current Loan Status | `current_loan_status` | `Fields.1393` |
| Rate Lock Buy Side Base Price | `rate_lock_buy_side_base_price_rate` | `Fields.2161` |
| Orig Fee Borr Pd | `orig_fee_borr_pd` | `Fields.NEWHUD.X686` |
| Orig Fees Seller | `orig_fees_seller` | `Fields.559` |
| CD Lender Credits | `cd_lender_credits` | `Fields.CD2.XSTLC` |
| Branch Price Concession | `branch_price_concession` | `Fields.3375` |
| Occupancy Type | `occupancy_type` | `Fields.1811` |
| Borr Self Employed | `borr_self_employed` | `Fields.FE0115` |
| Loan Purpose | `loan_purpose` | `Fields.19` |

---

## Implementation Files

| File | Description |
|------|-------------|
| `server/src/routes/loans.ts` | Backend calculations (`/api/loans/sales-scorecard`) |
| `src/pages/SalesScorecard.tsx` | Frontend display component |
| `src/hooks/useSalesScorecardData.ts` | TypeScript interfaces |

---

## Known Discrepancies & Notes

### 1. Lost Opportunity vs Denied Separation

**Issue**: Lost Opportunity and Denied are counted SEPARATELY in Qlik.

**Qlik Status Filters**:
- **Lost Opportunity**: `*withdraw*`, `*not accepted*`, `*incomp*`
- **Denied**: `*denied*`

**Our Implementation**: Correctly separates these two categories.

### 2. Percentage Denominators

**Issue**: Lost Opportunity % and Denied % use **total applications** as denominator, not funded units.

**Qlik**: `Count(Lost Opp) / Count(Total Applications)`

**Our Implementation**: Uses `totalApplications` (count of loans with `application_date` in range).

### 3. DTI Range Filtering

**Issue**: Qlik filters out-of-range DTI values using `[DTI Out of Range Flag]`.

**Our Implementation**: Filters DTI to 0-150% range.

### 4. W-H Days for Unfunded Loans

**Issue**: Loans funded but not yet purchased use `vMaxDate - funding_date`.

**Our Implementation**: Uses `effectiveEndDate - funding_date` for unfunded loans.

---

## Verification Checklist

When comparing to Qlik, verify:

- [ ] Loan Officer Count matches
- [ ] Total Units matches (~2,051)
- [ ] Total Volume matches (~$469M)
- [ ] Lost Opportunity Units excludes denied loans
- [ ] Denied Units only includes denied/declined
- [ ] Percentages use total applications as denominator
- [ ] W-H Days calculation handles unfunded loans
- [ ] DTI filters unreasonable values

---

## Changelog

| Date | Change | Author |
|------|--------|--------|
| 2026-01-26 | Initial specification document | AI Assistant |
| 2026-01-26 | Added W-H Days calculation from Transform.qvs | AI Assistant |
| 2026-01-26 | Documented Lost Opportunity vs Denied separation | AI Assistant |
| 2026-01-26 | Added percentage denominator clarification | AI Assistant |
