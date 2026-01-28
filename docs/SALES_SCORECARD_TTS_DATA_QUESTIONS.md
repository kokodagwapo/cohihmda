# Sales Scorecard TTS (Top Tier Score) - Data Questions & Implementation

## Overview

This document details the TTS (Top Tier Score) weighted scoring system used in the Sales Scorecard page, based on the Qlik Performance app's "Sales Scorecard" sheet (object id: 067718b9-ee44-4bf0-8292-7a1c34dde964).

**Important**: This is DIFFERENT from the Pareto-based TopTiering used in the "TopTiering by Branch/LO" sheets. TTS uses weighted performance ratings compared to company averages, not cumulative revenue percentage tiers.

---

## TTS Scoring Methodology

### What is TTS?

TTS (Top Tier Score) is a **weighted composite score** that measures Loan Officer (or Branch) performance relative to all other actors over a rolling time period. Each component rating compares an individual actor's performance to the company average.

**Key Principle**: A score of 100 = average performance. Above 100 = above average. Below 100 = below average.

---

## Component Ratings

All ratings are calculated as a **percentage of the company average** (100 = average performance).

### 1. Unit Rating (20% weight)

**Qlik Logic**:
```qvs
(LO Originated Units / All LO Avg Originated Units) × 100
```

**New Platform Logic**:
```sql
-- Calculate company average units per actor
WITH actor_units AS (
  SELECT loan_officer, COUNT(*) as units
  FROM loans
  WHERE funding_date BETWEEN :startDate AND :endDate
    AND tenant_id = :tenantId
  GROUP BY loan_officer
),
company_avg AS (
  SELECT AVG(units) as avg_units FROM actor_units
)
SELECT 
  a.loan_officer,
  a.units,
  (a.units / c.avg_units) * 100 as unit_rating
FROM actor_units a, company_avg c;
```

**Status**: IMPLEMENTED

---

### 2. Volume Rating (20% weight)

**Qlik Logic**:
```qvs
(LO Avg Loan Amount / All LO Avg Loan Amount) × 100
```

**New Platform Logic**:
```sql
-- Calculate average loan amount per actor vs company average
WITH actor_volume AS (
  SELECT loan_officer, AVG(loan_amount) as avg_loan_amount
  FROM loans
  WHERE funding_date BETWEEN :startDate AND :endDate
    AND tenant_id = :tenantId
  GROUP BY loan_officer
),
company_avg AS (
  SELECT AVG(avg_loan_amount) as company_avg_amount FROM actor_volume
)
SELECT 
  a.loan_officer,
  a.avg_loan_amount,
  (a.avg_loan_amount / c.company_avg_amount) * 100 as volume_rating
FROM actor_volume a, company_avg c;
```

**Status**: IMPLEMENTED

---

### 3. Margin/Revenue Rating (20% weight)

**Qlik Logic**:
```qvs
Revenue = Base Buy + Orig Fee Borrower + Orig Fee Seller - CD Lender Credits
(LO Avg Revenue / All LO Avg Revenue) × 100
```

**New Platform Logic**:
```typescript
// Revenue calculation per loan
const calcLoanRevenue = (loan) => {
  const points = loan.origination_points || 0;
  const feesBorr = loan.orig_fee_borr_pd || 0;
  const feesSeller = loan.orig_fees_seller || 0;
  const credits = loan.cd_lender_credits || 0;
  
  // Qlik formula: Base Buy + Orig Fee Borrower + Orig Fee Seller - CD Lender Credits
  let revenue = (loan.loan_amount * points / 100) + feesBorr + feesSeller - credits;
  
  // Fallback if revenue fields are zero
  if (revenue === 0 && loan.loan_amount > 0) {
    revenue = loan.loan_amount * 0.01; // 1% default margin
  }
  return revenue;
};

// Rating = (Actor Avg Revenue / Company Avg Revenue) * 100
```

**Database Fields**:
- `origination_points` - Points as percentage
- `orig_fee_borr_pd` - Origination fees paid by borrower
- `orig_fees_seller` - Origination fees from seller
- `cd_lender_credits` - Lender credits to subtract

**Status**: IMPLEMENTED

---

### 4. Pull-Through Rating (15% weight)

**Qlik Logic**:
```qvs
Pull-Through = Funded Loans / Started Loans (with same application date range)
(LO Pull-Through Rate / All LO Avg Pull-Through Rate) × 100
```

**New Platform Logic**:
```typescript
// Calculate pull-through per actor
const fundedLoans = loans.filter(l => 
  l.funding_date >= startDate && l.funding_date <= endDate
);
const startedLoans = loans.filter(l => 
  (l.started_date || l.application_date) >= startDate && 
  (l.started_date || l.application_date) <= endDate
);

// Group by actor
const actorPullThrough = {};
actorGroups.forEach(actor => {
  const actorFunded = fundedLoans.filter(l => l.loan_officer === actor).length;
  const actorStarted = startedLoans.filter(l => l.loan_officer === actor).length;
  actorPullThrough[actor] = actorStarted > 0 ? (actorFunded / actorStarted) * 100 : 0;
});

// Company average
const avgPullThrough = Object.values(actorPullThrough).reduce((a, b) => a + b, 0) / Object.keys(actorPullThrough).length;

// Rating = (Actor Pull-Through / Company Avg Pull-Through) * 100
```

**Status**: IMPLEMENTED

---

### 5. Turn Time Rating (5% weight)

**Qlik Logic**:
```qvs
Turn Time = Application Date → Close Date
Rating uses INVERSE logic (lower/faster is better)
(1 / LO Avg Turn Time) / (1 / All LO Avg Turn Time) × 100
```

**New Platform Logic**:
```typescript
// Calculate turn time (days from application to close/funding)
const calcTurnTime = (loan) => {
  const appDate = loan.application_date;
  const closeDate = loan.funding_date || loan.closing_date;
  if (!appDate || !closeDate) return null;
  
  const diffMs = new Date(closeDate) - new Date(appDate);
  return Math.floor(diffMs / (1000 * 60 * 60 * 24)); // days
};

// Inverse rating: faster times get HIGHER scores
// (1 / actorTurnTime) / (1 / companyAvgTurnTime) * 100
// Simplified: (companyAvgTurnTime / actorTurnTime) * 100
const turnTimeRating = (companyAvgTurnTime / actorAvgTurnTime) * 100;
```

**Status**: IMPLEMENTED

---

### 6. Concession Rating (20% weight)

**Qlik Logic**:
```qvs
(LO Avg Price Concession / All LO Avg Price Concession) × 100
```

**New Platform Logic**:
- Requires `price_concession` field in database
- Currently NOT available in Encompass sync

**Status**: NOT IMPLEMENTED - Field not available in database. Using 100 (average) as placeholder.

---

## TTS Score Formula

```
TTS = (UnitRating × 0.20) + 
      (VolumeRating × 0.20) + 
      (MarginRating × 0.20) + 
      (ConcessionRating × 0.20) + 
      (PullThroughRating × 0.15) + 
      (TurnTimeRating × 0.05)
```

### Default Weight Configuration

| Component | Weight | Description |
|-----------|--------|-------------|
| Unit | 20% | Number of loans originated |
| Volume | 20% | Average loan size |
| Margin | 20% | Average revenue per loan |
| Concession | 20% | Price concessions (placeholder) |
| Pull-Through | 15% | Conversion rate from app to funding |
| Turn Time | 5% | Speed of closing (inverse) |
| **Total** | **100%** | |

### Qlik XML Configuration

```xml
<Sales>
  <Weight Name="Unit" Value="20.0"/>
  <Weight Name="Volume" Value="20.0"/>
  <Weight Name="Margin" Value="20.0"/>
  <Weight Name="Concessions" Value="20.0"/>
  <Weight Name="PullThrough" Value="15.0"/>
  <Weight Name="TurnTime" Value="5.0"/>
</Sales>
```

---

## Tier Assignment

Tiers are assigned based on **TTS Score** (NOT cumulative revenue percentage like Pareto):

| TTS Score | Tier | Description |
|-----------|------|-------------|
| > 120 | **Top Tier** | Performing 20%+ above average |
| 100 - 120 | **Above Average** | At or above average performance |
| 80 - 100 | **Below Average** | Below average but not significantly |
| < 80 | **Bottom Tier** | Performing 20%+ below average |

**Note**: These thresholds may be configurable per client.

---

## Example Calculation

| Component | LO Value | Company Avg | Rating | Weight | Weighted |
|-----------|----------|-------------|--------|--------|----------|
| Units | 15 loans | 10 loans | 150 | 20% | 30.0 |
| Volume | $350K | $300K | 116.7 | 20% | 23.3 |
| Margin | $8,500 | $7,000 | 121.4 | 20% | 24.3 |
| Concession | - | - | 100.0 | 20% | 20.0 |
| Pull-Through | 78% | 72% | 108.3 | 15% | 16.2 |
| Turn Time | 25 days | 30 days | 120.0 | 5% | 6.0 |
| **TTS Score** | | | | | **119.8** |

**Result**: This LO has a TTS of 119.8 = "Above Average" tier.

---

## Comparison: TTS vs Pareto TopTiering

| Aspect | TTS Sales Scorecard | Pareto TopTiering |
|--------|---------------------|-------------------|
| **Metric** | Weighted composite score | Cumulative revenue % |
| **Baseline** | Company average (100) | Total revenue |
| **Tier Assignment** | Score thresholds (80, 100, 120) | Cumulative % (65%, 90%) |
| **Components** | 6 weighted metrics | Single metric (revenue) |
| **Focus** | Balanced performance | Revenue concentration |
| **Use Case** | Individual performance evaluation | Revenue distribution analysis |

---

## API Endpoint

### GET `/api/loans/sales-scorecard`

**Query Parameters**:
- `actor`: `loan_officer` or `branch`
- `startDate`: Start of date range (YYYY-MM-DD)
- `endDate`: End of date range (YYYY-MM-DD)
- `tenant_id`: Tenant UUID
- `channelGroup`: Optional channel filter (Retail, TPO, All)

**Response Structure**:
```typescript
interface SalesScorecardResponse {
  actors: {
    name: string;
    units: number;
    volume: number;
    revenue: number;
    pullThrough: number;
    avgTurnTime: number;
    // Component ratings (0-200+ scale, 100 = average)
    unitRating: number;
    volumeRating: number;
    marginRating: number;
    pullThroughRating: number;
    turnTimeRating: number;
    concessionRating: number; // Always 100 until field available
    // Composite score
    ttsScore: number;
    tier: 'top' | 'above_average' | 'below_average' | 'bottom';
  }[];
  companyAverages: {
    avgUnits: number;
    avgVolume: number;
    avgRevenue: number;
    avgPullThrough: number;
    avgTurnTime: number;
  };
  weightConfig: {
    unit: number;
    volume: number;
    margin: number;
    concession: number;
    pullThrough: number;
    turnTime: number;
  };
  tierSummary: {
    top: { count: number; totalUnits: number; totalRevenue: number; avgTtsScore: number };
    aboveAverage: { count: number; totalUnits: number; totalRevenue: number; avgTtsScore: number };
    belowAverage: { count: number; totalUnits: number; totalRevenue: number; avgTtsScore: number };
    bottom: { count: number; totalUnits: number; totalRevenue: number; avgTtsScore: number };
  };
  totals: {
    units: number;
    volume: number;
    revenue: number;
    actorCount: number;
  };
  dateRange: {
    startDate: string;
    endDate: string;
  };
}
```

---

## Database Schema Requirements

### Current Fields (Available)

| Field | Type | Used For |
|-------|------|----------|
| `loan_officer` | VARCHAR | Actor grouping (LO) |
| `branch` | VARCHAR | Actor grouping (Branch) |
| `loan_amount` | DECIMAL | Volume calculation |
| `origination_points` | DECIMAL | Revenue calculation |
| `orig_fee_borr_pd` | DECIMAL | Revenue calculation |
| `orig_fees_seller` | DECIMAL | Revenue calculation |
| `cd_lender_credits` | DECIMAL | Revenue calculation |
| `application_date` | DATE | Turn time start |
| `funding_date` | DATE | Turn time end, Pull-through |
| `closing_date` | DATE | Turn time end (fallback) |
| `started_date` | DATE | Pull-through denominator |
| `current_loan_status` | VARCHAR | Status filtering |
| `channel` | VARCHAR | Channel filtering |
| `tenant_id` | UUID | Multi-tenancy |

### Missing Fields (Future Enhancement)

| Field | Type | Used For |
|-------|------|----------|
| `price_concession` | DECIMAL | Concession rating |
| `base_buy_price` | DECIMAL | More accurate revenue |

---

## Frontend Display Requirements

### Summary Tab

Display aggregated TTS metrics by tier:
- Actor count per tier
- Average TTS score per tier
- Total units/revenue per tier
- Percentage distribution

### Detail Tab

Display each actor with:
- Name
- TTS Score (primary sort)
- Component ratings (Unit, Volume, Margin, Pull-Through, Turn Time)
- Units, Volume, Revenue
- Tier badge

### Sidebar Weights

Show current weight configuration:
- Unit: 20%
- Volume: 20%
- Margin: 20%
- Concession: 20%
- Pull-Through: 15%
- Turn Time: 5%

---

## Source References

- **Qlik Sheet**: "Sales Scorecard" in Performance app (e09c9a85-fc05-4db7-b8cc-23e0a720986b)
- **Qlik Object**: 067718b9-ee44-4bf0-8292-7a1c34dde964 (main table container)
- **Load Script**: `TTS + Staffing Variables.qvs`
- **Documentation**: `QlikAppsAndLogicDictionaryDocs/perfordoc/TTS Formula Documentation.md`
- **TTS Scorecard Doc**: `QlikAppsAndLogicDictionaryDocs/logic-dictionary-docs/logic-dictionary/derived/tts-scorecard.md`
