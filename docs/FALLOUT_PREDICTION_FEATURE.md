# Fallout Prediction Feature - Technical Documentation

## Overview

The Fallout Prediction feature provides real-time risk assessment for active loans in the pipeline, predicting which loans are likely to:
- **Withdraw** - Borrower cancels the application (market/process issues)
- **Deny** - Lender rejects the application (credit/qualification issues)
- **Originate** - Loan successfully closes

The system uses a **rule-based signal strength bucketing approach** that analyzes multiple risk factors to generate instant predictions without requiring AI inference.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              DATA FLOW                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐    ┌───────────────────┐    ┌────────────────────────┐   │
│  │   Database   │───►│  Backend Service  │───►│  Frontend Dashboard    │   │
│  │ (PostgreSQL) │    │ (predictionService)│    │ (ClosingFalloutForecast)│  │
│  └──────────────┘    └───────────────────┘    └────────────────────────┘   │
│                              │                            │                  │
│                              ▼                            ▼                  │
│                    ┌───────────────────┐       ┌────────────────────────┐   │
│                    │  Market Rates     │       │  Critical Loan Cards   │   │
│                    │  (FRED API)       │       │  with Risk Summaries   │   │
│                    └───────────────────┘       └────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Key Components

### 1. Backend Services

#### `server/src/services/dashboard/predictionService.ts`
**Primary prediction engine** (~2900 lines)

Key functions:
- `predictLoanOutcomes()` - Main entry point for prediction flow
- `runPredictFlow()` - Orchestrates the prediction pipeline
- `prepareLoanData()` - Extracts and normalizes loan fields from various sources
- `bucketLoanData()` - Calculates signal strength buckets for each loan
- `generateRuleBasedSummary()` - Generates risk assessment and predicted outcome
- `calculatePullthroughForRole()` - Computes historical pullthrough rates for personnel
- `calculateMarketDelta()` - Computes rate lock vs market rate differential

#### `server/src/services/dashboard/marketRateService.ts`
**Market rate integration** (~500 lines)

Key functions:
- `fetchMarketRatesFromFRED()` - Fetches 30-Year Fixed Rate Conforming Mortgage Index
- `storeMarketRates()` - Persists rates to database
- `getMarketRateForDate()` - Retrieves rate for a specific date
- `autoSyncMarketRatesIfNeeded()` - Automatically syncs missing market data

### 2. Frontend Components

#### `src/components/dashboard/ClosingFalloutForecast.tsx`
**Main dashboard component** (~1600 lines)

Key features:
- "Start Prediction" button triggers prediction
- Displays predicted fallout metrics (withdraw count, decline count)
- Shows critical loan cards with risk assessments
- Manages bucketed loan data state

#### `src/components/dashboard/LoanCardsContainer.tsx`
**Critical loan card display** (~450 lines)

Key features:
- Tabs: All Loans, Likely Withdrawal, Likely Decline
- Risk level badges and predicted outcome indicators
- Drill-down modal on card click

#### `src/components/dashboard/LoanDrilldownModal.tsx`
**Detailed loan view** (~580 lines)

Key features:
- Signal strength bucket scores display
- Risk/success factors list
- AI recommendations integration
- Predicted outcome badge

---

## Data Flow

### Step 1: Prediction Trigger

User clicks "Start Prediction" button in the UI, which calls:

```typescript
POST /api/loans/predict
Body: { maxLoanAgeMonths: number }
```

### Step 2: Data Retrieval

The backend queries active loans from the tenant database:

```sql
SELECT 
  loan_id, loan_number, loan_amount, interest_rate, loan_type,
  application_date, lock_date, closing_date, funding_date,
  current_loan_status, current_milestone, branch, loan_officer,
  fico_score, be_dti_ratio, ltv_ratio, cltv,
  loan_purpose, property_type, occupancy_type,
  underwriter, closer, processor
FROM public.loans
WHERE current_loan_status = 'Active Loan'
```

### Step 3: Market Rate Sync

Before processing, the system auto-syncs market rates from FRED API:

```typescript
// Checks if market_rates table needs updating
await autoSyncMarketRatesIfNeeded();
```

Data source: FRED API series `OBMMIC30YF` (30-Year Fixed Rate Conforming Mortgage Index)

### Step 4: Data Preparation

Each loan goes through `prepareLoanData()` which:
1. Extracts fields from both top-level columns and `raw_data` JSON
2. Normalizes field names (handles various naming conventions)
3. Parses dates and numeric values
4. Identifies personnel (loan officer, underwriter, closer, processor)

### Step 5: Bucketing (Signal Strength Calculation)

Each loan is analyzed across multiple dimensions:

| Signal Category | Fields Analyzed | Bucket Range |
|----------------|-----------------|--------------|
| Credit Metrics | FICO, LTV, DTI, CLTV | 1-6 |
| Loan Characteristics | Amount, Type, Purpose, Occupancy | 1-6 |
| Time in Motion | Active Days, Milestone Progress | 1-6 |
| MLO Fallout Prone | LO Historical Pullthrough | 1-6 |
| Interest Lock vs Market | Lock Rate - Market Rate Delta | 1-6 |
| UW Pullthrough | Underwriter Historical Success | 1-6 |
| Closer Pullthrough | Closer Historical Success | 1-6 |
| Processor Pullthrough | Processor Historical Success | 1-6 |

**Bucket Interpretation:**
- 1-2: Low risk (favorable)
- 3-4: Medium risk (moderate concern)
- 5-6: High risk (elevated concern)

### Step 6: Outcome Prediction

The `generateRuleBasedSummary()` function determines the predicted outcome:

```typescript
// Risk scoring logic
let creditRiskScore = 0;   // Issues leading to DENY
let processRiskScore = 0;  // Issues leading to WITHDRAW

// Credit risks (denial indicators)
if (creditMetricsSignalStrength >= 5) creditRiskScore += 3;
if (ficoScoreSignal >= 5) creditRiskScore += 2;
if (dtiSignal >= 5) creditRiskScore += 1;
if (ltvSignal >= 5) creditRiskScore += 1;

// Process risks (withdrawal indicators)  
if (timeInMotionSignalStrength >= 5) processRiskScore += 2;
if (interestLockVsMarketSignalStrength >= 5) processRiskScore += 3;
if (mloAeFalloutProneSignalStrength >= 5) processRiskScore += 2;

// Determine outcome
if (overallRisk === 'high') {
  if (creditRiskScore > processRiskScore) {
    predictedOutcome = 'deny';
  } else {
    predictedOutcome = 'withdraw';
  }
}
```

### Step 7: Response Structure

```typescript
{
  predictions: [],  // Empty - using rule-based summaries instead
  bucketedLoans: [
    {
      loan_id: "12345",
      loan_officer: "John Smith",
      fico_score: 680,
      ltv_ratio: 85,
      be_dti_ratio: 42,
      interest_rate: 6.5,
      market_rate: 6.2,
      current_milestone: "Processing",
      bucket: "high",
      riskSummary: {
        risks: ["Credit metrics indicate elevated risk", "Interest rate lock is unfavorable"],
        positives: [],
        overallRisk: "high",
        predictedOutcome: "withdraw",
        confidence: 75
      },
      // Signal strength buckets
      creditMetricsSignalStrength: 4,
      loanCharacteristicsSignalStrength: 3,
      timeInMotionSignalStrength: 5,
      mloAeFalloutProneSignalStrength: 2,
      interestLockVsMarketSignalStrength: 5,
      // ... more fields
    }
  ],
  summary: {
    totalAnalyzed: 150,
    predictedWithdraw: 12,
    predictedDeny: 5,
    predictedOriginate: 133
  },
  metadata: {
    model: "rule-based",
    timestamp: "2026-01-28T10:30:00Z",
    processingTimeMs: 2500
  }
}
```

---

## Signal Strength Bucketing Details

### Credit Metrics Signal

Composite of FICO, LTV, DTI, and CLTV:

| FICO Score | Bucket |
|------------|--------|
| ≥760 | 1 (Excellent) |
| 720-759 | 2 (Very Good) |
| 680-719 | 3 (Good) |
| 640-679 | 4 (Fair) |
| 620-639 | 5 (Poor) |
| <620 | 6 (High-risk) |

| LTV Ratio | Bucket |
|-----------|--------|
| ≤60% | 1 |
| 61-70% | 2 |
| 71-80% | 3 |
| 81-90% | 4 |
| 91-95% | 5 |
| >95% | 6 |

| DTI Ratio | Bucket |
|-----------|--------|
| ≤28% | 1 |
| 29-36% | 2 |
| 37-43% | 3 |
| 44-50% | 4 |
| 51-55% | 5 |
| >55% | 6 |

### Time in Motion Signal

Based on days since application:

| Active Days | Bucket |
|-------------|--------|
| ≤15 | 1 (On Track) |
| 16-25 | 2 |
| 26-35 | 3 |
| 36-45 | 4 |
| 46-60 | 5 |
| >60 | 6 (Stale) |

### Market Delta Signal

Difference between lock rate and current market rate:

| Delta (Lock - Market) | Bucket | Interpretation |
|-----------------------|--------|----------------|
| ≤-0.5% | 1 | Borrower has great rate |
| -0.5% to -0.25% | 2 | Favorable |
| -0.25% to 0% | 3 | Neutral |
| 0% to +0.25% | 4 | Slightly unfavorable |
| +0.25% to +0.5% | 5 | Unfavorable |
| >+0.5% | 6 | May shop elsewhere |

### Pullthrough Signal

Based on historical close rate for personnel:

| Pullthrough Rate | Bucket |
|------------------|--------|
| ≥85% | 1 (Excellent) |
| 75-84% | 2 |
| 65-74% | 3 |
| 55-64% | 4 |
| 45-54% | 5 |
| <45% | 6 (High Fallout) |

---

## Withdraw vs Deny Logic

The system distinguishes between two types of fallout:

### Likely to WITHDRAW (Borrower-initiated)
Triggered when process/market risks dominate:
- **Unfavorable rate lock** - Market rates have dropped since lock
- **Long time in pipeline** - Loan taking too long to close
- **Low LO pullthrough** - Loan officer history suggests process issues
- **Market delta signal** - Significant rate improvement opportunity

### Likely to DENY (Lender-initiated)
Triggered when credit risks dominate:
- **Poor credit metrics** - Low FICO, high DTI, high LTV
- **Risky loan characteristics** - Jumbo, investment property, cash-out refi
- **High UW fallout rate** - Underwriter sees qualification issues
- **Individual signal concerns** - FICO <620, DTI >50%, LTV >95%

---

## Database Tables

### `public.market_rates`
Stores FRED market rate data:
```sql
CREATE TABLE market_rates (
  id SERIAL PRIMARY KEY,
  rate_date DATE UNIQUE NOT NULL,
  rate DECIMAL(5,3) NOT NULL,
  source VARCHAR(50) DEFAULT 'FRED',
  series_id VARCHAR(50) DEFAULT 'OBMMIC30YF',
  created_at TIMESTAMP DEFAULT NOW()
);
```

### `public.historical_loan_bucket_cache`
Caches bucketed data for historical loans:
```sql
CREATE TABLE historical_loan_bucket_cache (
  loan_id VARCHAR(100) PRIMARY KEY,
  bucket_snapshot JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### `public.loan_predictions` (Optional - for AI predictions)
Stores AI-generated predictions:
```sql
CREATE TABLE loan_predictions (
  id SERIAL PRIMARY KEY,
  tenant_id UUID,
  loan_id VARCHAR(100) NOT NULL,
  predicted_outcome VARCHAR(20),
  confidence INTEGER,
  reasoning TEXT,
  risk_factors JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## Environment Variables

```bash
# Required for market rate sync
FRED_API_KEY=your_fred_api_key



# RAG tuning (optional)
LOAN_RAG_TOP_K=30
LOAN_RAG_EMBEDDING_MODEL=openai/text-embedding-3-small
```

---

## API Endpoints

### POST `/api/loans/predict`
Triggers prediction for active loans.

**Request:**
```json
{
  "maxLoanAgeMonths": 0  // 0 = no filter
}
```

**Response:**
```json
{
  "predictions": [],
  "bucketedLoans": [...],
  "summary": {
    "totalAnalyzed": 150,
    "predictedWithdraw": 12,
    "predictedDeny": 5,
    "predictedOriginate": 133
  },
  "metadata": {
    "model": "rule-based",
    "timestamp": "2026-01-28T10:30:00Z",
    "processingTimeMs": 2500
  }
}
```

### GET `/api/loans/predictions`
Fetches stored AI predictions (if available).

### POST `/api/loans/sync-market-rates`
Manually triggers FRED market rate sync.

### GET `/api/loans/:loanId/recommendations`
Fetches AI-generated recommendations for a specific loan.

---

## Frontend Display

### Critical Loans Section
Shows high-risk loans with:
- **Predicted Outcome Badge**: "⚠ Likely Decline" or "↩ Likely Withdraw"
- **Risk Level**: CRITICAL / AT RISK / LOW
- **Confidence Score**: Percentage
- **Risk Factors**: Top 3 contributing factors

### Tabs
- **All Loans**: Complete list of critical loans
- **Likely Withdrawal**: Loans predicted to withdraw (process/market issues)
- **Likely Decline**: Loans predicted to be denied (credit issues)

### Loan Drilldown Modal
Detailed view showing:
- All signal strength bucket scores
- FICO/LTV/DTI metrics with status colors
- Loan information (officer, type, milestone, active days)
- Rate & Market details (lock rate, market rate, delta)
- Historical pullthrough rates
- Success/Warning/Critical factors
- AI recommendations (on-demand)

---

## Performance Considerations

1. **Historical bucket caching**: Finalized loans are cached to avoid re-bucketing
2. **Market rate caching**: In-memory cache with 1-minute cooldown between syncs
3. **Batch processing**: Loans processed in batches of 100
4. **Essential fields filtering**: API response only includes necessary fields

---

## Future Enhancements

1. **RAG-based AI predictions**: Uses pgvector embeddings to find similar historical loans
2. **Pattern learning**: AI learns from historical outcomes to improve predictions
3. **Real-time updates**: WebSocket notifications when predictions complete
4. **Threshold customization**: Admin-configurable risk thresholds
