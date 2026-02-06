# Fallout Risk: Risk Score Calculation, Bucket Assignment, and Predicted Outcome

This document describes how loans are assigned risk scores (1–100), risk buckets (`high`, `medium`, `low`), and predicted outcomes (`originate`, `withdraw`, `deny`) in the Closing Fallout Forecast system.

---

## Overview

The risk assessment process has three main steps:

1. **Calculate Risk Score** (1–100) based on signal buckets using a split approach (process risk vs. credit risk)
2. **Assign Risk Bucket** (`high`, `medium`, `low`) based on the risk score ranges
3. **Determine Predicted Outcome** (`originate`, `withdraw`, `deny`) based on credit and process risk scores

---

## 1. Risk Score Calculation (Backend)

**Location:** `server/src/services/dashboard/predictionService.ts` (lines 2991–3042)

**Purpose:** Calculate a numeric risk score (1–100) by averaging signal buckets, split into process risk and credit risk dimensions.

### Signal Buckets (1–6 Scale)

All signal buckets use a 1–6 scale where:
- **1–2**: Low risk (favorable)
- **3–4**: Medium risk (moderate concern)
- **5–6**: High risk (elevated concern)

### Process Risk Calculation

**Process Risk** measures withdrawal risk (borrower cancels due to process/market issues).

**Buckets used:**
- `timeInMotionSignalStrength` (1–6)
- `mloAeFalloutProneSignalStrength` (1–6)
- `interestLockVsMarketSignalStrength` (1–6)
- **Inverse FICO**: `7 - ficoScoreSignal` (1–6)
  - FICO bucket 1 (excellent credit) → becomes 6 (high process risk - strong borrowers shop more)
  - FICO bucket 6 (poor credit) → becomes 1 (low process risk - weak borrowers don't shop)

**Calculation:**
```ts
processRiskAvg = average of available process risk buckets
```

**Range:** 1.0–6.0 (average of 4 buckets)

### Credit Risk Calculation

**Credit Risk** measures denial risk (lender rejects due to credit issues).

**Buckets used:**
- `ficoScoreSignal` (1–6)
- `dtiSignal` (1–6)
- `ltvSignal` (1–6)
- `loanCharacteristicsSignalStrength` (1–6)

**Calculation:**
```ts
creditRiskAvg = average of available credit risk buckets
```

**Range:** 1.0–6.0 (average of 4 buckets)

### Final Risk Score

**Formula:**
```ts
maxRiskAvg = Math.max(processRiskAvg, creditRiskAvg)
riskScore = Math.round(((maxRiskAvg - 1) / 5) * 99 + 1)
riskScore = Math.min(100, Math.max(1, riskScore)) // Clamp to 1-100
```

**Scaling Explanation:**
- Input range: 1–6 (range of 5)
- Output range: 1–100 (range of 99)
- Formula: `(avg - 1) / 5 * 99 + 1`
  - `avg = 1.0` → `(1-1)/5 * 99 + 1 = 1`
  - `avg = 3.5` → `(3.5-1)/5 * 99 + 1 = 50.5`
  - `avg = 6.0` → `(6-1)/5 * 99 + 1 = 100`

**Design Rationale:**
- Uses `Math.max()` to take the dominant risk (process or credit)
- A loan with high credit risk but low process risk (or vice versa) will reflect the higher risk
- This ensures critical issues aren't masked by averaging

**Fallback:**
- If no signal buckets are available, `riskScore = 50` (medium risk)

---

## 2. Risk Bucket Assignment (Backend)

**Location:** `server/src/services/dashboard/predictionService.ts` (lines 3037–3042)

**Purpose:** Assign each loan a risk bucket (`high`, `medium`, or `low`) based on the calculated risk score.

### Logic

```ts
if (riskScore >= 75) {
  bucket = 'high';
} else if (riskScore >= 50) {
  bucket = 'medium';
} else {
  bucket = 'low';
}
```

### Bucket Ranges

| Bucket | Risk Score Range | Description |
|--------|------------------|-------------|
| **high** | 75–100 | Elevated risk, likely to fallout |
| **medium** | 50–74 | Moderate risk, requires attention |
| **low** | 1–49 | Low risk, likely to originate |

---

## 3. Predicted Outcome Calculation (Backend)

**Location:** `server/src/services/dashboard/predictionService.ts` (lines 2888–2980)

**Purpose:** Determine the predicted outcome (`originate`, `withdraw`, `deny`) based on credit and process risk scores.

### Two Risk Dimensions

- **Credit Risk Score** → measures **denial risk** (lender rejects)
- **Process Risk Score** → measures **withdrawal risk** (borrower cancels)

### Credit Risk Score Calculation

**Purpose:** Quantify denial risk based on credit metrics and loan characteristics.

| Signal | Condition | Points Added |
|--------|-----------|--------------|
| FICO | = 6 | +3 |
| FICO | ≥ 5 (but not 6) | +2 |
| DTI | = 6 | +3 |
| DTI | ≥ 5 (but not 6) | +2 |
| LTV | = 6 | +3 |
| LTV | ≥ 5 (but not 6) | +2 |
| Loan characteristics | ≥ 3 | +2 |

**Maximum Credit Risk Score:** 11 (was 12, UW pullthrough removed)

**Minimum Credit Risk Score:** 0

### Process Risk Score Calculation

**Purpose:** Quantify withdrawal risk based on process delays, market conditions, and borrower behavior.

| Signal | Condition | Points Added |
|--------|-----------|--------------|
| Time in motion | ≥ 5 | +2 |
| Time in motion | ≥ 4 (but not 5) | +1 |
| MLO pullthrough | ≥ 5 | +2 |
| Interest lock vs market | ≥ 5 | +3 |
| Interest lock vs market | ≥ 4 (but not 5) | +1 |
| FICO | ≤ 2 | +2 (strong borrower = shop/withdraw risk) |

**Maximum Process Risk Score:** 9

**Minimum Process Risk Score:** 0

### Predicted Outcome Logic

**Threshold:** Both risk scores use a threshold of **6** to determine if a loan is predicted to fallout.

```ts
if (creditRiskScore > 6 && creditRiskScore > processRiskScore) {
  predictedOutcome = 'deny';
  confidence = 55 + Math.min(creditRiskScore * 5, 30); // Range: 55-85
} else if (processRiskScore > 6 && processRiskScore > creditRiskScore) {
  predictedOutcome = 'withdraw';
  confidence = 55 + Math.min(processRiskScore * 5, 30); // Range: 55-85
} else if ((creditRiskScore > 6 || processRiskScore > 6) && creditRiskScore === processRiskScore) {
  // Both scores are high and equal - default to withdraw
  predictedOutcome = 'withdraw';
  confidence = 55 + Math.min(Math.max(creditRiskScore, processRiskScore) * 5, 30);
} else {
  // Both scores are low/balanced - likely to originate
  predictedOutcome = 'originate';
  confidence = 70 + Math.min(positives.length * 5, 25); // Range: 70-95
}
```

### Outcome Types

| Outcome | Condition | Confidence Range | Description |
|---------|-----------|-----------------|-------------|
| **deny** | `creditRiskScore > 6` AND `creditRiskScore > processRiskScore` | 55–85 | Lender will likely reject due to credit issues |
| **withdraw** | `processRiskScore > 6` AND `processRiskScore > creditRiskScore` OR both scores are high and equal | 55–85 | Borrower will likely cancel due to process/market issues |
| **originate** | Both scores ≤ 6 OR scores are balanced | 70–95 | Loan is likely to successfully close |

### Positives (Low-Risk Signals)

If any composite signal is ≤ 2, a positive message is added (e.g., "Strong credit profile", "Favorable loan characteristics", "Loan progressing on schedule"). These boost confidence for `originate` outcomes.

---

## 4. Overall Risk Derivation

**Location:** `server/src/services/dashboard/predictionService.ts` (lines 2982–2989)

**Purpose:** Derive `overallRisk` from `predictedOutcome` for API response compatibility (not used in prediction logic).

```ts
if (predictedOutcome === 'deny' || predictedOutcome === 'withdraw') {
  overallRisk = 'high';
} else {
  overallRisk = 'low';
}
```

---

## 5. Return Value Structure

**Location:** `server/src/services/dashboard/predictionService.ts` (lines 3043–3051)

The `generateRuleBasedSummary` function returns:

```ts
{
  risks: string[];              // Human-readable risk descriptions
  positives: string[];          // Human-readable positive factors
  overallRisk: string;          // 'high' | 'low' (derived from predictedOutcome)
  predictedOutcome: 'originate' | 'withdraw' | 'deny';
  confidence: number;           // 55–95
  bucket: 'high' | 'medium' | 'low';  // Based on riskScore ranges
  riskScore: number;            // 1–100 (calculated from signal buckets)
}
```

---

## How the Components Relate

1. **Risk Score Calculation** (Section 1): Uses signal buckets to calculate a 1–100 risk score via split process/credit risk approach, taking the maximum of the two.

2. **Bucket Assignment** (Section 2): Maps the risk score to `high` (75–100), `medium` (50–74), or `low` (1–49).

3. **Predicted Outcome** (Section 3): Uses credit and process risk scores (threshold-based, not bucket-based) to determine `deny`, `withdraw`, or `originate`.

4. **Overall Risk** (Section 4): Derived from predicted outcome for API compatibility.

### Key Design Decisions

- **Split Risk Approach**: Separating process risk and credit risk allows the system to distinguish between "borrower will cancel" (withdraw) vs. "lender will reject" (deny).

- **Max of Two Risks**: Using `Math.max(processRiskAvg, creditRiskAvg)` ensures that a single critical issue (either credit or process) drives the risk score, preventing masking of problems.

- **Inverse FICO for Process Risk**: Strong borrowers (FICO bucket 1) are more likely to shop/withdraw, so FICO is inverted for process risk calculation.

- **Threshold-Based Prediction**: The predicted outcome uses a threshold of 6 for credit/process risk scores, independent of the bucket assignment, allowing more granular control.

---

## Frontend Display

**Location:** `src/components/dashboard/ClosingFalloutForecast.tsx`

The frontend displays the `riskScore` and `predictedOutcome` directly from the backend's `riskSummary` object. No recalculation is performed on the frontend.

**Critical Loans Filtering:**
- Loans are filtered to show those with `predictedOutcome === 'withdraw' || predictedOutcome === 'deny'`
- This matches the "Predicted Fallout" metric count
