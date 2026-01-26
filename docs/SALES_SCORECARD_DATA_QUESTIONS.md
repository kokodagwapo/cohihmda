# Sales Scorecard Data Questions & Implementation

## Overview

This document tracks the data logic for the Sales Scorecard page, which implements the Qlik Performance app's "Sales Scorecard" sheet functionality. The Sales Scorecard uses a **TTS (Top Tier Score) weighted scoring system** to evaluate and tier loan officers/branches based on their performance across multiple dimensions.

**Important:** This is NOT the same as the "TopTiering by" sheet which uses Pareto analysis. The Sales Scorecard uses TTS score-based tier assignment.

---

## ✅ Implementation Status Summary (Updated 2026-01-24)

| Issue | Qlik Expected | Current Implementation | Status |
|-------|---------------|----------------------|--------|
| **Date Type** | `DateType={'Funding'}` | Uses `funding_date` | ✅ Correct |
| **Default Time Frame** | Rolling 13 months | Rolling 13 months (default) | ✅ Fixed |
| **Rate Lock Filter** | `[Rate Lock Buy Side Base Price Rate] > 0` | Not implemented (field may not exist) | ⚠️ Minor gap |
| **TTS Weights** | 6 components (Unit 20%, Volume 20%, Margin 20%, Concessions 20%, PullThrough 15%, TurnTime 5%) | 6 components with correct weights | ✅ Fixed |
| **Tier Assignment** | Score-based (>=120 Top, >=80 Second, <80 Bottom) | Score-based thresholds from Qlik `vCCA_TVI_13MonthTiersDim` | ✅ Fixed |
| **Unit Rating** | Included in TTS formula | Implemented: `(Actor Units / Avg Units) × 100` | ✅ Fixed |
| **Concession Rating** | Included in TTS formula | Uses `branch_price_concession` or `corporate_price_concession`: `(Concession % / 100) × Loan Amount` | ✅ Fixed |
| **Revenue Formula** | `Base Buy + Orig Fee Borr + Orig Fee Seller - CD Lender Credits` | `origination_points + orig_fee_borr_pd + orig_fees_seller - cd_lender_credits` | ✅ Correct |

---

## Source Documentation

- **Qlik Sheet**: "Sales Scorecard" in Performance app (object ID: 067718b9-ee44-4bf0-8292-7a1c34dde964)
- **Key Scripts**: 
  - `tvd-coheus-performance-qlik/Scripts/TTS + Staffing Variables.qvs`
  - `tvd-coheus-performance-qlik/Scripts/Variables.qvs`
- **Reference App**: `cohi-merge-12426/coheus-dev/src/pages/toptiering/sales/SalesScorecard.tsx`

---

## ⚠️ CRITICAL: Date Type and Time Frame Configuration

### Date Type: FUNDING DATE (not Application Date!)

The Sales Scorecard / TopTiering views in Qlik use **Funding Date** (`DateType={'Funding'}`), NOT Application Date.

From the Qlik expressions in `Frontend TTS.md`:
```qvs
// ALL TopTiering metrics filter by DateType={'Funding'}
{<[$(vScorecard)_Production] *= {$(vCurrentProduction)}, 
  DateType={'Funding'}, 
  [$(vToDate)]={'Yes'}, 
  [Rate Lock Buy Side Base Price Rate] = {">0"}>}
```

**This means:** Loans are counted/summed based on when they **funded**, not when the application was taken.

**Current Implementation Issue:** The backend may be filtering correctly, but the date range selector should clarify this is "Funding Date" range.

### Default Time Frame: Rolling 13 Months (for TTS Score)

Per the Qlik TTS documentation (`tts-scorecard.md` lines 356-361):
> **By Time Period:**
> - Rolling 13 months (standard)
> - Rolling 2 months (short-term)
> - Year to date, Month to date, Quarter to date

**For TTS Long Term Score** (`$(eCCA_TVI_Score_13_Months)`), the calculation uses a **rolling 13-month window**.

### Available Time Frame Options (vToDate)

| vToDate Value | Label | Description |
|---------------|-------|-------------|
| `LastWeekFlag` | Last Week | Previous 7 days |
| `MTD` | Month to Date | Current month |
| `PreviousMonthFlag` | Last Month | Previous full month |
| `QTD` | Quarter to Date | Current quarter |
| `PreviousQuarterFlag` | Last Quarter | Previous full quarter |
| `YTDFlag` | Year to Date | Jan 1 to today |
| `PreviousYearFlag` | Last Year | Previous full year |

### Additional Required Filter: Rate Lock Price > 0

ALL TopTiering calculations in Qlik include this filter:
```qvs
[Rate Lock Buy Side Base Price Rate] = {">0"}
```
This **excludes loans without a valid rate lock price**. We may not have this field, so our loan counts could differ.

### Current Production Filter

Qlik also filters by `[$(vScorecard)_Production] *= {$(vCurrentProduction)}` which excludes inactive actors. The `vCurrentProduction` defaults to `'Yes'`.

---

## TTS (Top Tier Score) Methodology

### Overview

TTS is a weighted composite score that measures actor (Loan Officer/Branch) performance relative to company averages over a rolling time period. Each component rating compares an individual actor's performance to the company average (100 = average performance).

### Component Ratings (All 6 from Qlik TTS Formula Documentation)

**CRITICAL FINDING (2026-01-24):** Different ratings use different aggregation methods:

| Rating | Qlik Formula | Aggregation | Description |
|--------|--------------|-------------|-------------|
| **Unit Rating** | `[Scorecard Output Units] / vScorecardUnitsAvg × 100` | SUM | Actor's loan COUNT / Avg loan count per actor |
| **Volume Rating** | `[CCA Scorecard Volume] / vCCA_ScorecardVolumeAvg × 100` | SUM | Actor's TOTAL loan volume $ / Avg total volume per actor |
| **Margin Rating** | `Avg([Margin (BPS)]) / vScorecardMarginAvg × 100` | AVG | Actor's AVG Margin BPS / Avg of (Avg Margin BPS per actor) |
| **Concession Rating** | `(Actor Total Concession / Avg Total Concession) × 100` | SUM | Actor's TOTAL concession $ / Avg total concession per actor |
| **Pull-Through Rating** | `[CCA Scorecard PullThrough] / vCCA_ScorecardPullThroughAvg × 100` | % | Actor's pull-through % / Avg pull-through % |
| **Turn Time Rating** | `Pow([TurnTime], -1) / vCCA_ScorecardTurnTimeAvg × 100` | AVG(INVERSE) | Uses INVERSE: `(1/ActorTurnTime) / Avg(1/AllActorTurnTimes)` |

**Key Insights:**
- **Volume Rating** uses **TOTAL** loan volume (SUM) - rewards high-volume actors
- **Margin Rating** uses **AVERAGE** Margin in Basis Points (BPS) per loan - NOT total revenue!
  - Margin (BPS) = `(Revenue / Loan Amount) × 10000`
  - This normalizes for loan size, rewarding efficient margin regardless of volume

### Concession Calculation (from Qlik Transform.qvs)

**Source Field:**
- `Branch Price Concession` (Fields.3375) → `branch_price_concession`

> **Note:** Qlik also loads `Corporate Price Concession` (Fields.3371), but **only `Branch Concession ($)` is used** in TTS/scorecard calculations.

**Qlik Formula (Script Additions Ranges.qvs):**
```qvs
Branch Concession ($) = (Branch Concession / 100) * Loan Amount
```

**Our Implementation:**
```typescript
// branch_price_concession stored as percentage (e.g., 0.25 = 0.25%)
const concessionDollars = (branch_price_concession / 100) * loan_amount;
// Average per actor, then compare to company average for Concession Rating
```

**Note:** Higher concession means giving away more profit. Depending on business context, this could be a positive indicator (winning deals) or negative (margin erosion). Qlik uses direct comparison.

### TTS Score Formula

**Qlik `eCCA_TVI_Score_13_Months` - 4 Components with Compound Scaling:**

```
TTS = (
  VolumeRating × VolumeWeight +
  MarginRating × MarginWeight +
  TurnTimeRating × (VolumeRating / 100) × TurnTimeWeight +
  PullThroughRating × (MarginRating / 100) × PullThroughWeight
) / (VolumeWeight + MarginWeight + TurnTimeWeight + PullThroughWeight)
```

**Default Weights:** Volume=3, Margin=2, TurnTime=1, PullThrough=2 (total=8)

**Key Feature - Compound Scaling:**
- TurnTime rating is multiplied by `VolumeRating/100` - high-volume actors get more credit for fast turn times
- PullThrough rating is multiplied by `MarginRating/100` - high-margin actors get more credit for good pull-through

**Note:** Unit and Concession ratings are NOT included in the TTS score formula per Qlik's actual implementation.

### Actual Weights Used (from Qlik eCCA_TVI_Score_13_Months)

**Qlik Sales Scorecard TTS Formula (4 components):**
| Component | Weight | Description |
|-----------|--------|-------------|
| Volume | 3 | Volume Rating × 3 |
| Margin | 2 | Margin Rating × 2 |
| Turn Time | 1 | Turn Time Rating × (VolumeRating/100) × 1 (compound) |
| Pull-Through | 2 | Pull-Through Rating × (MarginRating/100) × 2 (compound) |
| **Total** | **8** | Divisor for normalized TTS |

**Note:** Unit and Concession ratings exist but are NOT used in `eCCA_TVI_Score_13_Months`.

**XML Configuration in Qlik (weights are loaded and divided by 10):**
```xml
<Sales>
  <Weight Name="Volume" Value="30"/>   <!-- becomes 3 -->
  <Weight Name="Margin" Value="20"/>   <!-- becomes 2 -->
  <Weight Name="TurnTime" Value="10"/> <!-- becomes 1 -->
  <Weight Name="PullThrough" Value="20"/> <!-- becomes 2 -->
</Sales>
```

### TTS Tier Thresholds (Score-Based, from Qlik `vCCA_TVI_13MonthTiersDim`)

The Qlik expression defines tiers by **TTS score thresholds**:

```qvs
if (TTS >= 120) → 'Top Tier'
else if (TTS >= 80) → 'Second Tier'  
else if (TTS >= 0) → 'Bottom Tier'
```

| TTS Score | Performance Level |
|-----------|-------------------|
| >= 120 | **Top Tier** |
| >= 80 | **Second Tier** |
| < 80 | **Bottom Tier** |

*Note: Tier thresholds may be configured per client.*

**Current Implementation:** Uses score-based thresholds from Qlik `vCCA_TVI_13MonthTiersDim`:
- **Top Tier**: TTS >= 120
- **Second Tier**: TTS >= 80 (and < 120)
- **Bottom Tier**: TTS < 80

---

## Loan Complexity Score (from Qlik Transform.qvs)

The Loan Complexity Score is the **sum of 8 component complexity values**. Each component adds or subtracts based on loan characteristics.

### Component Calculations

| Component | Condition | Complexity Value |
|-----------|-----------|------------------|
| **Loan Purpose** | C to P (Construction) | +0.30 |
| | Purchase | +0.10 |
| | Refi CO (Cash Out) | +0.10 |
| | Refi No CO | 0 |
| **Loan Type** | FHA | +0.10 |
| | VA | +0.05 |
| | Conventional | 0 |
| **Loan Amount** | >= $1,000,000 (Jumbo) | +0.10 |
| | < $1,000,000 | 0 |
| **Occupancy** | SecondHome | +0.10 |
| | Investor | +0.10 |
| | Primary | 0 |
| **FICO Score** | > 760 (Excellent) | **-0.10** |
| | 681-760 (Good) | 0 |
| | 621-681 (Fair) | +0.05 |
| | <= 620 (Poor) | +0.15 |
| **LTV Ratio** | >= 95% (High LTV) | +0.05 |
| | < 95% | 0 |
| **DTI Ratio** | >= 43% (High DTI) | +0.05 |
| | < 43% | 0 |
| **Employment** | Self-Employed | +0.20 |
| | W-2 Employee | 0 |

### Formula

```qvs
[Loan Complexity Score] = RangeSum(
  [Loan Purpose Complexity],
  [Loan Type Complexity],
  [Loan Amount Complexity],
  [Occupancy Complexity],
  [FICO Complexity],
  [LTV Complexity],
  [DTI Complexity],
  [Employment Complexity]
)
```

**Example:** A self-employed borrower (0.2) with 640 FICO (0.05), purchasing (0.1) a $1.2M jumbo (0.1) primary residence (0), 96% LTV (0.05), 45% DTI (0.05), VA loan (0.05):
- Raw Complexity = 0.2 + 0.05 + 0.1 + 0.1 + 0 + 0.05 + 0.05 + 0.05 = **0.60**

### Display Formula (from Qlik)

The raw complexity score (0.0 to ~0.6) is converted for display using:

```qvs
(1 + [Loan Complexity Score]) * 100
```

**Examples:**
- Raw 0.00 → Display **100.0** (baseline)
- Raw 0.14 → Display **114.0**
- Raw 0.20 → Display **120.0**
- Raw 0.60 → Display **160.0**

Higher values indicate more complex loans.

### Tier Assignment (Current Implementation - Score-Based)

Actors are assigned to tiers based on TTS score thresholds:

| Tier | Assignment Rule | Description |
|------|-----------------|-------------|
| **Top Tier** | Top 33% by TTS score | Highest performing actors |
| **Second Tier** | Middle 33% by TTS score | Average performing actors |
| **Bottom Tier** | Bottom 33% by TTS score | Lower performing actors |

---

## Summary Metrics (20 Total)

The pivot table displays these metrics with columns: **Totals, Top Tier, Second Tier, Bottom Tier**

### General Metrics (14)

| # | Metric | Qlik Expression | PostgreSQL/New Platform | Status |
|---|--------|-----------------|------------------------|--------|
| 1 | **Loan Officer Count** | `Count(Distinct [$(vScorecardActor)])` | `COUNT(DISTINCT loan_officer)` | ✅ |
| 2 | **TTS Long Term Score** | `$(eCCA_TVI_Score_13_Months)` | Weighted TTS calculation (see formula above) | ✅ |
| 3 | **Loan Complexity Score** | `Avg([Loan Complexity])` | Based on loan type/purpose mix scoring | ⚠️ Placeholder |
| 4 | **Units** | `Count([Loan Number])` where DateType='Funding' | `COUNT(*)` funded loans in period | ✅ |
| 5 | **Units %** | `Units / Total Units × 100` | `tier_units / total_units * 100` | ✅ |
| 6 | **Volume** | `Sum([Loan Amount])` | `SUM(loan_amount)` | ✅ |
| 7 | **Volume %** | `Volume / Total Volume × 100` | `tier_volume / total_volume * 100` | ✅ |
| 8 | **Revenue $** | `Sum([Revenue])` | `SUM(revenue)` | ✅ |
| 9 | **Revenue (BPS)** | `(Revenue / Volume) × 10000` | `(revenue / volume) * 10000` | ✅ |
| 10 | **Lost Opportunity Revenue** | `Sum([Revenue])` where Withdrawn/Denied | `SUM(revenue)` for lost opportunity loans | ✅ |
| 11 | **Lost Opportunity Units** | `Count([Loan Number])` where Withdrawn/Denied | `COUNT(*)` withdrawn/denied loans | ✅ |
| 12 | **Denied Units** | `Count([Loan Number])` where Denied Flag=1 | `COUNT(*)` denied loans only | ✅ |
| 13 | **Avg LO Revenue** | `Revenue / Actor Count` | `total_revenue / actor_count` | ✅ |
| 14 | **Avg LO Units** | `Units / Actor Count` | `total_units / actor_count` | ✅ |

### Average Conditions Metrics (6)

| # | Metric | Qlik Expression | PostgreSQL/New Platform | Status |
|---|--------|-----------------|------------------------|--------|
| 15 | **Turn Time App to Close** | `Avg(NetworkDays([Application Date], [Funding Date]))` | `AVG(funding_date - application_date)` in days | ✅ |
| 16 | **Pull Through** | `Count(Funded) / Count(Started) × 100` | `funded_count / started_count * 100` | ✅ |
| 17 | **WA W-H Days** | `Sum([Loan Amount] × [Warehouse Days]) / Sum([Loan Amount])` | Not available - no warehouse_days field | ❌ N/A |
| 18 | **WA FICO** | `Sum([Loan Amount] × [FICO Score]) / Sum([Loan Amount])` | Weighted average calculation | ✅ |
| 19 | **WA LTV** | `Sum([Loan Amount] × [LTV]) / Sum([Loan Amount])` | Weighted average calculation | ✅ |
| 20 | **WA DTI** | `Sum([Loan Amount] × [DTI]) / Sum([Loan Amount])` | Weighted average calculation | ✅ |

**Implementation Score: 19 of 20 metrics (95%)**

---

## Backend API Implementation

### Endpoint: `/api/loans/sales-scorecard`

**File:** `server/src/routes/loans.ts`

### Phase 1: Fetch All Loans

```typescript
const allLoansResult = await pool.query(
  `SELECT 
    loan_id, loan_amount, loan_type, loan_purpose, current_loan_status, channel,
    funding_date, closing_date, application_date, started_date,
    branch, loan_officer, fico_score, ltv_ratio, be_dti_ratio,
    origination_points, orig_fee_borr_pd, orig_fees_seller, cd_lender_credits
   FROM public.loans 
   WHERE tenant_id = $1`,
  [tenantId]
);
```

### Phase 2: Apply Filters

```typescript
// Channel filter
const channelFilteredLoans = allLoans.filter(l => {
  if (!channelGroup || channelGroup === 'All') return true;
  const channel = (l.channel || '').toLowerCase();
  if (channelGroup === 'Retail') return channel.includes('retail') || channel.includes('brok');
  if (channelGroup === 'TPO') return channel.includes('whole') || channel.includes('corresp');
  return true;
});

// Rolling 12-month window (default)
const effectiveEndDate = endDate ? new Date(endDate) : new Date();
const effectiveStartDate = startDate 
  ? new Date(startDate) 
  : new Date(effectiveEndDate.getFullYear() - 1, effectiveEndDate.getMonth(), effectiveEndDate.getDate());

// Funded loans in date range
const fundedLoans = channelFilteredLoans.filter(l => {
  const fundDate = l.funding_date || l.closing_date;
  if (!fundDate) return false;
  const fd = new Date(fundDate);
  return fd >= effectiveStartDate && fd <= effectiveEndDate;
});

// Started loans (for pull-through calculation)
const startedLoans = channelFilteredLoans.filter(l => {
  const startedDate = l.started_date || l.application_date;
  if (!startedDate) return false;
  const sd = new Date(startedDate);
  return sd >= effectiveStartDate && sd <= effectiveEndDate;
});

// Lost opportunity loans (withdrawn/denied)
const lostOpportunityLoans = channelFilteredLoans.filter(l => {
  const status = (l.current_loan_status || '').toUpperCase();
  return status.includes('WITHDRAWN') || status.includes('DENIED') || 
         status.includes('CANCELLED') || status.includes('DECLINED');
});
```

### Phase 3: Group by Actor and Calculate Metrics

```typescript
const actorMap = new Map<string, ActorMetrics>();

fundedLoans.forEach(l => {
  const actorName = l[actorColumn]; // 'loan_officer' or 'branch'
  if (!actorName) return;
  
  if (!actorMap.has(actorName)) {
    actorMap.set(actorName, {
      units: 0, volume: 0, revenue: 0,
      turnTimes: [], 
      ficoWeighted: { sum: 0, weight: 0 },
      ltvWeighted: { sum: 0, weight: 0 },
      dtiWeighted: { sum: 0, weight: 0 },
      fundedCount: 0, startedCount: 0
    });
  }
  
  const actor = actorMap.get(actorName)!;
  const loanAmount = parseFloat(l.loan_amount) || 0;
  
  actor.units += 1;
  actor.volume += loanAmount;
  actor.revenue += calcLoanRevenue(l);
  
  // Turn time
  if (l.application_date && (l.funding_date || l.closing_date)) {
    const turnTime = daysBetween(l.application_date, l.funding_date || l.closing_date);
    if (turnTime > 0) actor.turnTimes.push(turnTime);
  }
  
  // Weighted averages
  if (l.fico_score && loanAmount > 0) {
    actor.ficoWeighted.sum += parseFloat(l.fico_score) * loanAmount;
    actor.ficoWeighted.weight += loanAmount;
  }
  // ... similar for LTV, DTI
});
```

### Phase 4: Calculate Company Averages

```typescript
const actorCount = actorMap.size;
let totalUnits = 0, totalVolume = 0, totalRevenue = 0;
let totalTurnTimeSum = 0, turnTimeActorCount = 0;
let totalPullThroughSum = 0, pullThroughCount = 0;

actorMap.forEach((data, name) => {
  totalUnits += data.units;
  totalVolume += data.volume;
  totalRevenue += data.revenue;
  
  // Actor's average turn time
  if (data.turnTimes.length > 0) {
    const avgTurnTime = data.turnTimes.reduce((a, b) => a + b, 0) / data.turnTimes.length;
    totalTurnTimeSum += avgTurnTime;
    turnTimeActorCount++;
  }
  
  // Actor's pull-through
  const actorPullThrough = data.startedCount > 0 
    ? (data.fundedCount / data.startedCount) * 100 
    : 0;
  if (actorPullThrough > 0) {
    totalPullThroughSum += actorPullThrough;
    pullThroughCount++;
  }
});

const companyAvg = {
  avgLoanAmount: totalVolume / totalUnits,
  avgRevenue: totalRevenue / totalUnits,
  avgTurnTime: turnTimeActorCount > 0 ? totalTurnTimeSum / turnTimeActorCount : 30,
  avgPullThrough: pullThroughCount > 0 ? totalPullThroughSum / pullThroughCount : 70
};
```

### Phase 5: Calculate TTS Score for Each Actor

```typescript
const weightConfig = {
  volume: 30,
  margin: 25,
  turnTime: 25,
  pullThrough: 20
};
const totalWeight = weightConfig.volume + weightConfig.margin + 
                    weightConfig.turnTime + weightConfig.pullThrough;

actorMap.forEach((data, name) => {
  const actorAvgLoanAmount = data.units > 0 ? data.volume / data.units : 0;
  const actorAvgRevenue = data.units > 0 ? data.revenue / data.units : 0;
  const actorAvgTurnTime = data.turnTimes.length > 0 
    ? data.turnTimes.reduce((a, b) => a + b, 0) / data.turnTimes.length 
    : companyAvg.avgTurnTime;
  const actorPullThrough = data.startedCount > 0 
    ? (data.fundedCount / data.startedCount) * 100 
    : companyAvg.avgPullThrough;
  
  // Calculate ratings (100 = company average)
  const volumeRating = companyAvg.avgLoanAmount > 0 
    ? (actorAvgLoanAmount / companyAvg.avgLoanAmount) * 100 
    : 100;
  const marginRating = companyAvg.avgRevenue > 0 
    ? (actorAvgRevenue / companyAvg.avgRevenue) * 100 
    : 100;
  const turnTimeRating = actorAvgTurnTime > 0 
    ? (companyAvg.avgTurnTime / actorAvgTurnTime) * 100 
    : 100; // Inverse - faster is better
  const pullThroughRating = companyAvg.avgPullThrough > 0 
    ? (actorPullThrough / companyAvg.avgPullThrough) * 100 
    : 100;
  
  // TTS Score with compound weighting
  const ttsScore = (
    volumeRating * weightConfig.volume +
    marginRating * weightConfig.margin +
    turnTimeRating * weightConfig.turnTime * (volumeRating / 100) +
    pullThroughRating * weightConfig.pullThrough * (marginRating / 100)
  ) / totalWeight;
  
  data.ttsScore = ttsScore;
});
```

### Phase 6: Assign Tiers by TTS Score

```typescript
// Sort actors by TTS score descending
const sortedActors = Array.from(actorMap.entries())
  .map(([name, data]) => ({ name, ...data }))
  .sort((a, b) => b.ttsScore - a.ttsScore);

// Assign tiers (top 33%, middle 33%, bottom 33%)
const tierSize = Math.ceil(sortedActors.length / 3);
const actors = sortedActors.map((actor, index) => {
  let tier: 'top' | 'second' | 'bottom';
  if (index < tierSize) tier = 'top';
  else if (index < tierSize * 2) tier = 'second';
  else tier = 'bottom';
  
  return { ...actor, tier };
});
```

### Phase 7: Aggregate by Tier

```typescript
const tierSummary = {
  top: { count: 0, units: 0, volume: 0, revenue: 0, ... },
  second: { count: 0, units: 0, volume: 0, revenue: 0, ... },
  bottom: { count: 0, units: 0, volume: 0, revenue: 0, ... }
};

actors.forEach(actor => {
  const tier = tierSummary[actor.tier];
  tier.count++;
  tier.units += actor.units;
  tier.volume += actor.volume;
  tier.revenue += actor.revenue;
  // ... aggregate other metrics
});
```

---

## Revenue Calculation

### Qlik Formula
```
[Revenue] = [Base Buy ($)] + [Orig Fee Borr Pd] + [Orig Fees Seller] - [CD Lender Credits]
```

### New Platform Implementation
```typescript
const calcLoanRevenue = (l: any): number => {
  const origPoints = parseFloat(l.origination_points) || 0;
  const origFeeBorr = parseFloat(l.orig_fee_borr_pd) || 0;
  const origFeeSeller = parseFloat(l.orig_fees_seller) || 0;
  const cdCredits = parseFloat(l.cd_lender_credits) || 0;
  
  if (origPoints + origFeeBorr + origFeeSeller > 0) {
    return origPoints + origFeeBorr + origFeeSeller - cdCredits;
  }
  
  // Fallback: estimate revenue as 1% of loan amount
  return (parseFloat(l.loan_amount) || 0) * 0.01;
};
```

---

## Loan Complexity Score

### Definition
A score representing the complexity of an actor's loan portfolio based on loan characteristics.

### Qlik Logic (Simplified)
```
Loan Complexity = Weighted combination of:
- Loan Type mix (Conv vs Govt)
- Loan Purpose mix (Purchase vs Refi)
- LTV distribution
- DTI distribution
- FICO distribution
```

### New Platform Implementation (Placeholder)
```typescript
// Placeholder: Use 100 as baseline, adjust based on loan mix
const calcLoanComplexity = (actor: ActorMetrics): number => {
  // Future: Implement scoring based on loan type/purpose distribution
  return 100; // Placeholder
};
```

---

## API Response Structure

```typescript
interface SalesScorecardResponse {
  actors: {
    name: string;
    units: number;
    volume: number;
    revenue: number;
    revenueBps: number;
    avgTurnTime: number;
    pullThrough: number;
    waFico: number;
    waLtv: number;
    waDti: number;
    ttsScore: number;
    tier: 'top' | 'second' | 'bottom';
  }[];
  totals: {
    actorCount: number;
    units: number;
    volume: number;
    revenue: number;
    avgTurnTime: number;
    pullThrough: number;
    waFico: number;
    waLtv: number;
    waDti: number;
    lostOpportunityUnits: number;
    lostOpportunityRevenue: number;
    deniedUnits: number;
    avgTtsScore: number;
    loanComplexityScore: number;
  };
  tierSummary: {
    top: TierSummary;
    second: TierSummary;
    bottom: TierSummary;
  };
  companyAverages: {
    avgLoanAmount: number;
    avgRevenue: number;
    avgTurnTime: number;
    avgPullThrough: number;
  };
  weightConfig: {
    volume: number;
    margin: number;
    turnTime: number;
    pullThrough: number;
  };
  dateRange: {
    startDate: string;
    endDate: string;
  };
}

interface TierSummary {
  count: number;
  units: number;
  unitsPercent: number;
  volume: number;
  volumePercent: number;
  revenue: number;
  revenueBps: number;
  avgTurnTime: number;
  pullThrough: number;
  waFico: number;
  waLtv: number;
  waDti: number;
  lostOpportunityUnits: number;
  lostOpportunityRevenue: number;
  deniedUnits: number;
  avgLoRevenue: number;
  avgLoUnits: number;
  avgTtsScore: number;
  loanComplexityScore: number;
}
```

---

## Date Range Options

| Option | Time Period | Description |
|--------|-------------|-------------|
| 3 Months | Rolling 3 months | Short-term performance |
| 6 Months | Rolling 6 months | Medium-term performance |
| 12 Months | Rolling 12 months | Long-term performance (default) |
| YTD | Jan 1 to today | Year-to-date |
| Last Year | Previous full year | Annual comparison |

---

## Database Columns Used

```sql
-- Date fields
funding_date TIMESTAMPTZ
closing_date DATE
application_date DATE
started_date DATE

-- Revenue fields  
origination_points DECIMAL(12,2)
orig_fee_borr_pd DECIMAL(12,2)
orig_fees_seller DECIMAL(12,2)
cd_lender_credits DECIMAL(12,2)

-- Actor fields
branch TEXT
loan_officer TEXT

-- Metrics
loan_amount DECIMAL(12,2)
fico_score INTEGER
ltv_ratio DECIMAL(12,2)
be_dti_ratio DECIMAL(12,2)

-- Status/Classification
current_loan_status TEXT
channel TEXT
loan_type TEXT
loan_purpose TEXT
```

---

## Not Implemented Metrics

### WA W-H Days (Warehouse Days)
**Reason:** No `warehouse_days` field exists in the current database schema. This metric tracks days a loan spends in warehouse before investor purchase.

**Future:** Add warehouse_days field to schema if this metric is needed.

---

## Troubleshooting

### Issue: All Metrics Return 0

**Possible Causes:**
1. **Date range too restrictive** - Default to rolling 12 months instead of YTD
2. **Column names don't exist** - Verify `loan_officer` and `branch` columns have data
3. **No funded loans** - Check if `funding_date` or `closing_date` columns are populated

**Debugging:**
```typescript
logInfo('[SalesScorecard] Data check', {
  totalLoans: allLoans.length,
  loansWithFundingDate: allLoans.filter(l => l.funding_date).length,
  loansWithLoanOfficer: allLoans.filter(l => l.loan_officer).length,
  dateRange: { start: effectiveStartDate, end: effectiveEndDate }
});
```

### Issue: Tier Distribution Uneven

**Cause:** Small dataset may not divide evenly into thirds.

**Solution:** Use Math.ceil for tier sizes to ensure all actors are assigned.

---

## Changelog

| Date | Change | Files Modified |
|------|--------|----------------|
| 2026-01-26 | Complete rewrite for TTS-based methodology | SALES_SCORECARD_DATA_QUESTIONS.md |
| 2026-01-26 | Updated from Pareto to TTS score tiers | loans.ts |
| 2026-01-26 | Changed to 3 tiers (top/second/bottom) | useSalesScorecardData.ts, SalesScorecard.tsx |

---

## Differences from TopTiering (Pareto)

| Aspect | Sales Scorecard (TTS) | TopTiering (Pareto) |
|--------|----------------------|---------------------|
| Tier Assignment | Based on TTS score (33%/33%/33%) | Based on cumulative revenue (65%/25%/10%) |
| Metrics | 20 comprehensive metrics | Basic revenue/volume/units |
| Time Period | Rolling 12 months (default) | Flexible date range |
| Primary Measure | TTS weighted score | Revenue contribution |
| Number of Tiers | 3 (Top, Second, Bottom) | 3 (Top, Second, Bottom) |
