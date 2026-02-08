# Fallout Risk: Unified Risk Score, Bucket, and Predicted Outcome

This document describes how loans are assigned risk scores (1–100), risk buckets (`high`, `medium`, `low`), and predicted outcomes (`originate`, `withdraw`, `deny`) in the Closing Fallout Forecast system.

**Key principle:** The `riskScore` (1–100) is the **single source of truth** for risk level, bucket assignment, AND predicted outcome. Higher score = higher risk = more likely to fall out.

---

## Overview

The risk assessment process:

1. **Calculate Risk Score** (1–100) from signal buckets, split into process risk vs. credit risk dimensions
2. **Assign Risk Bucket** (`high`, `medium`, `low`) from risk score thresholds
3. **Determine Predicted Outcome** (`originate`, `withdraw`, `deny`) by comparing risk score against a **calibrated threshold** on the same 1–100 scale
4. **Determine withdraw vs deny** from which dimension (process or credit) dominates

All three outputs derive from the same score — what the user sees always matches the prediction.

---

## 1. Risk Score Calculation

**Location:** `server/src/services/dashboard/predictionService.ts` — `generateRuleBasedSummary()`

### Signal Buckets (1–6 Scale)

All signal buckets use a 1–6 scale where:
- **1–2**: Low risk (favorable)
- **3–4**: Medium risk (moderate concern)
- **5–6**: High risk (elevated concern)

### Process Risk Dimension

**Process Risk** measures withdrawal risk (borrower cancels due to process/market issues).

**Buckets used:**
- `timeInMotionSignalStrength` (1–6)
- `mloAeFalloutProneSignalStrength` (1–6)
- `closerPullthroughSignalStrength` (1–6)
- `processorPullthroughSignalStrength` (1–6)
- `interestLockVsMarketSignalStrength` (1–6)
- **Inverse FICO**: `7 - ficoScoreSignal` (1–6)
  - FICO bucket 1 (excellent credit) → becomes 6 (high process risk — strong borrowers shop more)
  - FICO bucket 6 (poor credit) → becomes 1 (low process risk)

**Calculation:** `processRiskAvg = average of available process risk buckets` (range: 1.0–6.0)

### Credit Risk Dimension

**Credit Risk** measures denial risk (lender rejects due to credit issues).

**Buckets used:**
- `ficoScoreSignal` (1–6)
- `dtiSignal` (1–6)
- `ltvSignal` (1–6)
- `loanCharacteristicsSignalStrength` (1–6)
- `uwPullthroughSignalStrength` (1–6)

**Calculation:** `creditRiskAvg = average of available credit risk buckets` (range: 1.0–6.0)

### Final Risk Score (1–100)

```ts
maxRiskAvg = Math.max(processRiskAvg, creditRiskAvg)
riskScore = Math.round(((maxRiskAvg - 1) / 5) * 99 + 1)  // Scale 1-6 → 1-100
riskScore = Math.min(100, Math.max(1, riskScore))           // Clamp
```

Each dimension is also individually scaled to 1–100:
- `processRiskScore` = process risk on 1–100 scale
- `creditRiskScore` = credit risk on 1–100 scale

**Scaling examples:**
- `avg = 1.0` → score `1`
- `avg = 3.5` → score `51`
- `avg = 6.0` → score `100`

**Design:** Uses `Math.max()` so a single critical dimension (either credit or process) drives the score. Problems aren't hidden by averaging.

**Fallback:** If no signal buckets are available, `riskScore = 50`.

---

## 2. Risk Bucket Assignment

```ts
if (riskScore >= 75) bucket = 'high';
else if (riskScore >= 50) bucket = 'medium';
else bucket = 'low';
```

| Bucket | Risk Score | Description |
|--------|-----------|-------------|
| **high** | 75–100 | Elevated risk, likely to fallout |
| **medium** | 50–74 | Moderate risk, requires attention |
| **low** | 1–49 | Low risk, likely to originate |

---

## 3. Predicted Outcome (Unified with Risk Score)

**The predicted outcome is derived directly from the same `riskScore` displayed in the UI.**

### Calibrated Mode (preferred)

When the system has historical loans with known outcomes, it computes a **calibrated `riskScore` threshold** (on the 1–100 scale) so the predicted fallout rate matches the tenant's historical fallout rate.

**How it works:**
1. Score all historical loans using the same `generateRuleBasedSummary()` with the same options (pattern, trend, stage)
2. Sort historical riskScores ascending
3. Find the score at the `(1 - historicalFalloutRate)` percentile
4. That score becomes the threshold

**Example:** If historical fallout is 47%, the threshold is at the 53rd percentile of historical riskScores. Roughly 47% of loans will score at or above it.

**Scope:** Each **tenant is a lender**. Thresholds are computed **dynamically per lender** from that tenant's historical outcomes.

### Uncalibrated Mode (fallback)

When no historical data exists, a **fixed threshold of 65** is used (conservative — avoids over-predicting fallout).

### Outcome Determination

```ts
if (riskScore >= threshold) {
  // Loan is predicted to fall out
  if (creditRiskAvg >= processRiskAvg) {
    predictedOutcome = 'deny';    // Credit dimension dominates → lender rejects
  } else {
    predictedOutcome = 'withdraw'; // Process dimension dominates → borrower cancels
  }
} else {
  predictedOutcome = 'originate';  // Below threshold → likely to close
}
```

**This means:** If you see a loan with `riskScore = 70` and the calibrated threshold is `68`, it's predicted fallout. If the threshold is `72`, it's predicted originate. The score and outcome always make sense together.

### Confidence

- **Fallout:** `confidence = 55 + (riskScore - threshold) * 0.8` (higher when further above threshold, max 95)
- **Originate:** `confidence = 60 + (threshold - riskScore) * 0.5` (higher when further below threshold, max 95)

### Outcome Types

| Outcome | Condition | Description |
|---------|-----------|-------------|
| **deny** | `riskScore >= threshold` AND credit dominates | Lender will likely reject due to credit issues |
| **withdraw** | `riskScore >= threshold` AND process dominates | Borrower will likely cancel due to process/market issues |
| **originate** | `riskScore < threshold` | Loan is likely to successfully close |

---

## 4. Risk Reason Codes

In addition to the numeric score, the system generates human-readable risk factors and positives:

**Risk factors** (added when signals are elevated):
- "Credit metrics indicate elevated risk (low FICO, high DTI, or high LTV)"
- "Loan officer has below-average historical pullthrough rate"
- "Interest rate lock is unfavorable compared to current market"
- "Similar historical loans had high fallout rate"
- "One or more personnel have declining recent pull-through"
- etc.

**Positives** (added when signals are favorable, bucket ≤ 2):
- "Strong credit profile (high FICO, low DTI)"
- "Loan is progressing on schedule"
- "Loan officer has excellent historical pullthrough rate"
- etc.

These are informational only — they don't affect the score or outcome.

---

## 5. Return Value Structure

The `generateRuleBasedSummary` function returns:

```ts
{
  risks: string[];              // Human-readable risk descriptions
  positives: string[];          // Human-readable positive factors
  overallRisk: string;          // 'high' | 'low' (derived from predictedOutcome)
  predictedOutcome: 'originate' | 'withdraw' | 'deny';
  confidence: number;           // 55–95
  bucket: 'high' | 'medium' | 'low';  // Based on riskScore ranges
  riskScore: number;            // 1–100 (overall, max of process and credit)
  creditRiskScore: number;      // 1–100 (credit dimension only)
  processRiskScore: number;     // 1–100 (process dimension only)
}
```

---

## How Everything Connects

```
Signal Buckets (1-6)
  ├── processRiskAvg (1-6) ──→ processRiskScore (1-100)
  └── creditRiskAvg  (1-6) ──→ creditRiskScore  (1-100)
                                       │
                                       ▼
                              riskScore = max(process, credit)  ← SINGLE SOURCE OF TRUTH
                                       │
                        ┌──────────────┼──────────────┐
                        ▼              ▼              ▼
                    Bucket         Outcome         Display
                  (75+ high)    (≥ threshold     (shown in UI
                  (50-74 med)    → fallout)       loan table)
                  (1-49 low)
```

### Key Design Decisions

- **Unified scoring**: Risk score, bucket, and predicted outcome all derive from the same number. What the user sees always matches the prediction.

- **Split risk approach**: Process risk (withdrawal) and credit risk (denial) are computed separately, then combined via `Math.max()`. The dominant dimension determines withdraw vs deny.

- **Inverse FICO for process risk**: Strong borrowers (FICO 1) get high process risk (6) because they're more likely to shop and withdraw.

- **Calibrated threshold on the same scale**: The threshold is a `riskScore` value (e.g., 62) — intuitive and directly comparable to what's shown in the UI.

- **Per-tenant calibration**: Each tenant is a lender. Thresholds are dynamically computed from that tenant's historical outcomes.

---

## Frontend Display

**Location:** `src/components/dashboard/ClosingFalloutForecast.tsx`

The frontend displays `riskScore`, `predictedOutcome`, `creditRiskScore`, and `processRiskScore` directly from the backend. No recalculation is performed on the frontend.

**Critical Loans Filtering:**
- Loans are filtered to show those with `predictedOutcome === 'withdraw' || predictedOutcome === 'deny'`
- This matches the "Predicted Fallout" metric count
