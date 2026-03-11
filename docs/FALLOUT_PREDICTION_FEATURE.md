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
**Main dashboard component** (~1860 lines)

The primary container for the Closing & Fallout Forecast section of the executive dashboard.

**Key State:**
```typescript
// Prediction results
const [predictions, setPredictions] = useState<{ likelyWithdraw: number; likelyDecline: number; predictedFalloutTotal: number } | null>(null);
const [bucketedLoans, setBucketedLoans] = useState<any[]>([]);
const [loanPredictions, setLoanPredictions] = useState<Record<string, string>>({}); // loan_id -> outcome

// Data state
const [loansRaw, setLoansRaw] = useState<any[] | null>(null);
const [period, setPeriod] = useState<PeriodValue>('all');
```

**Key Features:**
- **"Start Prediction" button** - Triggers `POST /api/loans/predict` and updates state
- **Main KPIs (3 centered):**
  - Active Loans Today (with pipeline value)
  - Predicted Closing (based on pullthrough rate)
  - Likely Close Late (loans past expected close)
- **Outcome Metrics Grid (3 cards):**
  - Predicted Fallout (total at-risk loans)
  - Likely Withdraw (borrower-initiated)
  - Likely Decline (lender-initiated)
- **Pipeline Snapshot (right panel):**
  - Pipeline UPB (total active volume)
  - Locks (90D) - Rate locks from useMetrics hook
  - Pull-Through rate (rolling 90 days)
- **Critical Loans Tab** - Shows high-risk loan cards
- **Loan Officers Tab** - Shows officer-level metrics

**Key Hooks Used:**
- `useDashboardStats()` - Fetches aggregate statistics
- `useMetrics()` - Fetches time-filtered metrics (locked_loans, etc.)

---

#### `src/components/dashboard/LoanCardsContainer.tsx`
**Critical loan card display** (~450 lines)

Displays tabbed list of critical loans with filtering by predicted outcome.

**Props:**
```typescript
interface LoanCardsContainerProps {
  loans: LoanCard[];
  isDarkMode: boolean;
  onLoanClick: (loan: LoanCard) => void;
  predictions?: Array<{ loanId: string; predictedOutcome: string; confidence: number; reasoning?: string }>;
}
```

**Key Features:**
- **Tabs:** All Loans | Likely Withdrawal | Likely Decline
- **Risk level badges:** CRITICAL (rose) / AT RISK (amber) / LOW (emerald)
- **Predicted outcome badges:** "↩ Withdraw" or "⛔ Decline"
- **Virtual scrolling** for performance with large loan lists
- **Click handler** opens `LoanDrilldownModal`

---

#### `src/components/dashboard/LoanDrilldownModal.tsx`
**Detailed loan view modal** (~580 lines)

Full-screen modal showing comprehensive loan risk analysis.

**Props:**
```typescript
interface LoanDrilldownModalProps {
  loan: LoanCard;
  isOpen: boolean;
  onClose: () => void;
  isDarkMode: boolean;
}
```

**Modal Sections:**

1. **Header:**
   - Risk level badge (CRITICAL/AT RISK/LOW)
   - Predicted outcome badge (Withdraw/Decline)
   - Borrower name and loan ID

2. **Signal Strength Buckets Grid (8 buckets):**
   | Bucket | Description |
   |--------|-------------|
   | Credit Metrics | Composite FICO/LTV/DTI score |
   | Loan Characteristics | Amount, type, purpose |
   | Time in Motion | Days since application |
   | MLO Fallout Prone | Loan officer pullthrough |
   | Lock vs Market | Rate lock favorability |
   | UW Pullthrough | Underwriter success rate |
   | Closer Pullthrough | Closer success rate |
   | Processor Pullthrough | Processor success rate |

3. **Loan Information:**
   - Loan Officer, Type, Current Milestone, Active Days

4. **Credit Metrics:**
   - FICO Score, LTV Ratio, DTI Ratio (color-coded by risk)

5. **Rate & Market:**
   - Interest Rate, Market Rate, Market Delta

6. **Success/Warning/Critical Factors:**
   - Three-column layout showing risk factors by severity

7. **AI Recommendations:**
   - On-demand recommendations via `/api/loans/:loanId/recommendations`

---

#### `src/components/dashboard/modals/OutcomeLoansModal.tsx`
**Predicted outcome loans modal** (~380 lines)

Modal for viewing loans by predicted outcome (fallout, withdraw, decline, delayed).

**Props:**
```typescript
interface OutcomeLoansModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  outcomeType: 'fallout' | 'withdraw' | 'decline' | 'delayed' | null;
  dateFilter: PeriodValue;
  isDarkMode: boolean;
  loansRaw: any[] | null;
  loanPredictions?: Record<string, string>; // loan_id -> outcome
  bucketedLoans?: any[]; // Loans with riskSummary attached
}
```

**Modal Layout:**

1. **Header:**
   - Icon and title based on outcome type
   - Subtitle with loan count

2. **Summary Stats (2 cards):**
   - Total count (with withdraw/decline breakdown for fallout)
   - At-risk volume (dollar amount)

3. **Loan List:**
   - Scrollable list of at-risk loans
   - Each card shows: borrower, loan ID, amount, risk badge, reason
   - Click opens `LoanDrilldownModal`

**Filtering Logic:**
```typescript
// For withdraw/decline: uses PREDICTED outcomes from loanPredictions/bucketedLoans
const targetOutcomes = outcomeType === 'fallout' 
  ? ['withdraw', 'deny'] 
  : [outcomeType === 'withdraw' ? 'withdraw' : 'deny'];

// For delayed: uses heuristic (isLikelyCloseLate)
return isLikelyCloseLate(loan, 30, now);
```

---

#### `src/components/dashboard/modals/ClosingFalloutMetricModal.tsx`
**General metric drilldown modal** (~325 lines)

Modal for drilling into any KPI (Active Loans, Funded Loans, Predicted Closing, Predicted Fallout).

**Key Features:**
- **Alethia Insights** - AI-generated Success/Warning/Critical insights
- **Hero Stats** - Selected metric value + computed volume
- **Priority Loans** - Top 8 loans by risk score
- **TopTiering Insights** - Loan officer performance analysis
- **Borrower Coaching** - Suggested actions for at-risk borrowers

---

#### `src/utils/closingFalloutFilters.ts`
**Utility functions for filtering and calculations** (~400 lines)

Key exports:
```typescript
// Period filtering
export type PeriodValue = 'today' | 'wtd' | 'mtd' | 'qtd' | 'ytd' | 'rolling_90_days' | 'all' | 'custom';
export function getPeriodRange(period: PeriodValue, now: Date, year?: number): { start: Date | null; end: Date | null };
export function isDateInPeriod(dateValue: any, period: PeriodValue, now?: Date): boolean;

// Loan status inference
export function inferLoanStatus(loan: any): 'Active' | 'Locked' | 'Funded' | 'Withdrawn' | 'Denied' | 'Unknown';
export function isFundedInPeriod(loan: any, period: PeriodValue): boolean;
export function isLikelyCloseLate(loan: any, thresholdDays: number, now: Date): boolean;

// Value extraction
export function getLoanAmountNumber(loan: any): number;
```

---

#### `src/utils/loanDataTransform.ts`
**Loan data transformation** (~250 lines)

Transforms raw loan data into display-ready card format.

```typescript
export interface LoanCard {
  id: string;
  borrower: string;
  officer: string;
  amount: string; // Formatted (e.g., "$425,000")
  riskLevel: 'Low' | 'Medium' | 'Very High';
  riskScore: number; // 0-100
  reason: string;
  status: string;
  signalBuckets?: {
    creditMetrics: number;
    loanCharacteristics: number;
    timeInMotion: number;
    // ... etc
  };
}

export function transformLoanToCard(loan: any): LoanCard;
```

---

#### `src/hooks/useMetrics.ts`
**Metrics fetching hook** (~160 lines)

React hook for querying time-filtered metrics from the backend.

```typescript
export const useMetrics = (selectedTenantId?: string | null, year?: number) => {
  const queryMetric = (metricId: string, period: PeriodValue): Promise<MetricResult>;
  const queryMetrics = (metricIds: string[], period: PeriodValue): Promise<Record<string, MetricResult>>;
  const queryMetricsWithDateRange = (metricIds: string[], start: Date, end: Date): Promise<Record<string, MetricResult>>;
  
  return { queryMetric, queryMetrics, queryMetricsWithDateRange, loading, error };
};
```

Used in `ClosingFalloutForecast` for fetching `locked_loans` with rolling 90-day period.

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

### Step 7: Save Predictions to Database

After generating risk summaries, predictions are automatically saved to the `loan_predictions` table:

```typescript
// savePredictionsToDatabase() is called automatically
// For each bucketed loan with a riskSummary:
await dbPool.query(`
  INSERT INTO public.loan_predictions 
    (loan_id, predicted_outcome, confidence, reasoning, risk_factors, model_version)
  VALUES ($1, $2, $3, $4, $5, 'rule-based-v1')
`, [loanId, predictedOutcome, confidence, reasoning, riskFactors]);
```

**Upsert Logic**: Existing predictions for the same loan are deleted before inserting the new one, ensuring only the latest prediction is stored.

### Step 8: Response Structure

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
| ≤−0.25% | 1 | Borrower has great rate |
| −0.25% to 0% | 2 | Favorable |
| 0% to 0.1% | 3 | Neutral |
| 0.1% to +0.2% | 4 | Slightly unfavorable |
| +0.2% to +0.3% | 5 | Unfavorable |
| > 0.3% | 6 | May shop elsewhere |

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

### Main Dashboard Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│  CLOSINGS & FALLOUT FORECAST                          [Period Dropdown] │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                 │
│    │ Active Loans │  │  Predicted   │  │ Likely Close │   ┌───────────┐ │
│    │    Today     │  │   Closing    │  │     Late     │   │ Pipeline  │ │
│    │     247      │  │     189      │  │      12      │   │  Snapshot │ │
│    │  $89.2M UPB  │  │ 76% P/T R90D │  │    Units     │   │           │ │
│    └──────────────┘  └──────────────┘  └──────────────┘   │ UPB: $89M │ │
│                                                            │ Locks: 45 │ │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐          │ P/T: 76%  │ │
│  │ Predicted  │  │   Likely   │  │   Likely   │          └───────────┘ │
│  │  Fallout   │  │  Withdraw  │  │  Decline   │                        │
│  │    17      │  │     12     │  │     5      │                        │
│  │   6.9%     │  │            │  │            │   [Start Prediction]   │
│  └────────────┘  └────────────┘  └────────────┘                        │
│                                                                          │
├─────────────────────────────────────────────────────────────────────────┤
│  [Critical Loans]  [Loan Officers]                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │ ┌───────────────────────────────────────────────────────────────┐  ││
│  │ │ CRITICAL | ↩ Withdraw                              $425,000   │  ││
│  │ │ John Smith - Loan #12345                                      │  ││
│  │ │ Interest rate lock is unfavorable compared to current market  │  ││
│  │ └───────────────────────────────────────────────────────────────┘  ││
│  │ ┌───────────────────────────────────────────────────────────────┐  ││
│  │ │ AT RISK | ⛔ Decline                                $315,000   │  ││
│  │ │ Jane Doe - Loan #12346                                        │  ││
│  │ │ Credit metrics indicate elevated risk (FICO 618, DTI 52%)     │  ││
│  │ └───────────────────────────────────────────────────────────────┘  ││
│  └─────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────┘
```

### KPI Click Behavior

| KPI Clicked | Modal Opened | Content |
|-------------|--------------|---------|
| Active Loans Today | `ClosingFalloutMetricModal` | Alethia insights + priority loans |
| Predicted Closing | `ClosingFalloutMetricModal` | Closing forecast analysis |
| Likely Close Late | `OutcomeLoansModal` (delayed) | Loans past expected close date |
| Predicted Fallout | `OutcomeLoansModal` (fallout) | All predicted withdraw + decline |
| Likely Withdraw | `OutcomeLoansModal` (withdraw) | Borrower-initiated fallout |
| Likely Decline | `OutcomeLoansModal` (decline) | Lender-initiated fallout |

### Critical Loans Card Display

Each critical loan card shows:
- **Risk Level Badge**: CRITICAL (rose) / AT RISK (amber) / LOW (emerald)
- **Predicted Outcome Badge**: "↩ Withdraw" or "⛔ Decline"
- **Borrower/Officer Name**
- **Loan Amount**
- **Primary Risk Reason** (top contributing factor)

### OutcomeLoansModal Layout

When clicking Predicted Fallout, Likely Withdraw, or Likely Decline:

```
┌─────────────────────────────────────────────────────────┐
│  🔺 Predicted Fallout                              [X]  │
│  All At-Risk Loans - 17 loans                           │
│  Loans predicted to either withdraw or decline...       │
├─────────────────────────────────────────────────────────┤
│  ┌──────────────────┐  ┌──────────────────┐            │
│  │  Total Fallout   │  │  At-Risk Volume  │            │
│  │       17         │  │     $6.2M        │            │
│  │ 12 withdraw · 5  │  │  Pipeline at risk│            │
│  │     decline      │  │                  │            │
│  └──────────────────┘  └──────────────────┘            │
│                                                         │
│  ┌─────────────────────────────────────────────────────┤
│  │ At-Risk Loans                            17 loans   │
│  ├─────────────────────────────────────────────────────┤
│  │ ┌─────────────────────────────────────────────────┐ │
│  │ │ 📄 John Smith              $425,000  [Critical] │ │
│  │ │    Loan #12345 · LO: Mary Johnson               │ │
│  │ │    Interest lock unfavorable vs market          │ │
│  │ │                                  View Details → │ │
│  │ └─────────────────────────────────────────────────┘ │
│  │ ┌─────────────────────────────────────────────────┐ │
│  │ │ 📄 Jane Doe                $315,000  [At Risk]  │ │
│  │ │    Loan #12346 · LO: Bob Wilson                 │ │
│  │ │    Credit metrics indicate elevated risk        │ │
│  │ │                                  View Details → │ │
│  │ └─────────────────────────────────────────────────┘ │
│  └─────────────────────────────────────────────────────┤
└─────────────────────────────────────────────────────────┘
```

### Loan Drilldown Modal

Detailed view when clicking any loan card:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  [CRITICAL] [↩ Withdraw]                                          [X]  │
│  John Smith · Loan #12345                                              │
├─────────────────────────────────────────────────────────────────────────┤
│  SIGNAL STRENGTH BUCKETS                                               │
│  ┌─────────┐┌─────────┐┌─────────┐┌─────────┐┌─────────┐┌─────────┐   │
│  │ Credit  ││  Loan   ││ Time in ││   MLO   ││Lock vs ││   UW    │   │
│  │ Metrics ││ Charact ││ Motion  ││ Fallout ││ Market  ││Pullthru │   │
│  │   ▓▓▓░░ ││  ▓▓░░░  ││ ▓▓▓▓▓░  ││  ▓▓░░░  ││ ▓▓▓▓▓▓  ││  ▓▓░░░  │   │
│  │   4/6   ││   3/6   ││   5/6   ││   2/6   ││   6/6   ││   3/6   │   │
│  └─────────┘└─────────┘└─────────┘└─────────┘└─────────┘└─────────┘   │
│                                                                         │
│  LOAN INFORMATION                    CREDIT METRICS                     │
│  ┌────────────────────────┐         ┌────────────────────────┐         │
│  │ Loan Officer: M.Johnson│         │ FICO: 680 [▓▓▓░░░]     │         │
│  │ Type: Conventional     │         │ LTV: 85% [▓▓▓▓░░]      │         │
│  │ Milestone: Processing  │         │ DTI: 42% [▓▓▓░░░]      │         │
│  │ Active Days: 47        │         └────────────────────────┘         │
│  └────────────────────────┘                                            │
│                                                                         │
│  RATE & MARKET                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Interest Rate: 6.75%  │  Market Rate: 6.25%  │  Delta: +0.50%    │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                     │
│  │  ✓ SUCCESS  │  │  ⚠ WARNING  │  │  ✗ CRITICAL │                     │
│  │  LO has 78% │  │  47 days in │  │  Rate lock  │                     │
│  │  pullthrough│  │  pipeline   │  │  unfavorable│                     │
│  └─────────────┘  └─────────────┘  └─────────────┘                     │
│                                                                         │
│  AI RECOMMENDATIONS                                      [Loading...]   │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ • Consider offering a rate renegotiation to retain borrower      │  │
│  │ • Expedite processing to reduce pipeline time                    │  │
│  │ • Schedule check-in call with borrower this week                 │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

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
