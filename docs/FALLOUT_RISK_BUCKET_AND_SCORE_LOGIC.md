# Fallout Risk: Bucket Assignment, Rule-Based Summary, and Score Calculation

This document describes how loans are bucketed by risk, how rule-based summaries are generated, and how the numeric risk score (40–100) is calculated for display in the Closing Fallout Forecast UI.

---

## 1. Bucket Assignment (Backend)

**Location:** `server/src/services/dashboard/predictionService.ts` (lines 2481–2508)

**Purpose:** Assign each loan a risk bucket (`high`, `medium`, or `low`) based on composite signal strengths.

### Inputs

Five composite signals (each on a 1–6 scale, higher = more risk):

- Credit metrics (FICO, DTI, LTV)
- Loan characteristics (type, purpose, occupancy)
- Time in motion (how long in pipeline)
- MLO/AE fallout proneness (historical pullthrough)
- Interest lock vs market (rate competitiveness)

### Logic

1. **Collect signals** — Take the five composite signals and filter out any that are `null`.
2. **Compute metrics:**
   - `avgSignal` = average of the composite signals
   - `severeCount` = number of signals ≥ 5
   - `elevatedCount` = number of signals ≥ 4
3. **Assign bucket** (checked in order):
   - **high** if `severeCount >= 3` (3+ severe signals)
   - **medium** if `severeCount >= 2` OR `elevatedCount >= 2` OR `avgSignal >= 5`
   - **low** if `avgSignal <= 3`
   - **medium** otherwise (everything else)

### Design Note

The logic is count-based rather than purely average-based. A few very strong signals can push a loan to `high` or `medium` even if the average is moderate.

---

## 2. Risk Score Calculation (Frontend Display)

**Location:** `src/components/dashboard/ClosingFalloutForecast.tsx` (lines 1049–1071)

**Purpose:** Map the bucket and `avgSignal` to a numeric risk score (40–100) for display on loan cards.

### Inputs

Same five composite signals as the backend:

- `creditMetricsSignalStrength`
- `loanCharacteristicsSignalStrength`
- `timeInMotionSignalStrength`
- `mloAeFalloutProneSignalStrength`
- `interestLockVsMarketSignalStrength`

### Logic

```ts
let riskScore = 75; // Default for high-risk loans
if (signals.length > 0) {
  const avgSignal = signals.reduce((sum, s) => sum + s, 0) / signals.length;
  const severeCount = signals.filter(s => s >= 5).length;
  const elevatedCount = signals.filter(s => s >= 4).length;
  // Same bucket logic as backend
  let bucket: 'low' | 'medium' | 'high';
  if (severeCount >= 3) bucket = 'high';
  else if (severeCount >= 2 || elevatedCount >= 2 || avgSignal >= 5) bucket = 'medium';
  else if (avgSignal <= 3) bucket = 'low';
  else bucket = 'medium';
  // Map bucket to 40-100, use avgSignal for within-bucket spread
  if (bucket === 'low') {
    riskScore = Math.round(40 + (avgSignal / 3) * 15);
  } else if (bucket === 'medium') {
    riskScore = Math.round(55 + (avgSignal / 6) * 20);
  } else {
    riskScore = Math.round(75 + (avgSignal / 6) * 25);
  }
  riskScore = Math.min(100, Math.max(40, riskScore));
} else if (l.riskSummary?.confidence) {
  riskScore = l.riskSummary.confidence;
}
```

### Score Ranges by Bucket

| Bucket | Formula | Range | Divisor |
|--------|---------|-------|---------|
| **low** | `40 + (avgSignal / 3) * 15` | 40–55 | 3 |
| **medium** | `55 + (avgSignal / 6) * 20` | 55–75 | 6 |
| **high** | `75 + (avgSignal / 6) * 25` | 75–100 | 6 |

### Why Different Divisors?

- **Low bucket (÷3):** In the low bucket, `avgSignal` is always ≤ 3. Dividing by 3 normalizes the 0–3 range to 0–1 so the full 40–55 range is used.
- **Medium/High buckets (÷6):** In these buckets, `avgSignal` can span the full 1–6 scale. Dividing by 6 normalizes against the overall maximum.

### Fallbacks

- If no signals are present and `l.riskSummary?.confidence` exists, that confidence value is used as the risk score.
- Otherwise, the default is 75 (high-risk).
- The final score is clamped to 40–100.

---

## 3. Rule-Based Summary (`generateRuleBasedSummary`)

**Location:** `server/src/services/dashboard/predictionService.ts` (lines 2938–3050)

**Purpose:** Convert the loan's signal strengths into human-readable risk summaries and a predicted outcome (originate, withdraw, deny, at_risk).

### Two Risk Dimensions

- **Credit risk** → more likely **deny** (lender rejects)
- **Process risk** → more likely **withdraw** (borrower cancels)

### Credit Risk Score (Denial Risk)

| Signal | Condition | Effect |
|--------|-----------|--------|
| FICO | = 6 | +3 to creditRiskScore |
| FICO | ≥ 5 | +2 |
| DTI | = 6 | +3 |
| DTI | ≥ 5 | +2 |
| LTV | = 6 | +3 |
| LTV | ≥ 5 | +2 |
| Loan characteristics | ≥ 3 | +2 |
| UW pullthrough | ≥ 4 | +1 |

### Process Risk Score (Withdrawal Risk)

| Signal | Condition | Effect |
|--------|-----------|--------|
| Time in motion | ≥ 5 | +2 |
| Time in motion | ≥ 4 | +1 |
| MLO pullthrough | ≥ 5 | +2 |
| Interest lock vs market | ≥ 5 | +3 |
| Interest lock vs market | ≥ 4 | +1 |
| FICO | ≤ 2 | +2 (strong borrower = shop/withdraw risk) |
| UW pullthrough | ≥ 4 | +1 to creditRiskScore |

### Positives (Low-Risk Signals)

If any composite signal is ≤ 2, add a positive message (e.g., "Strong credit profile", "Favorable loan characteristics", "Loan progressing on schedule").

### Predicted Outcome and Confidence

Uses `loan.bucket` (from Section 1) plus the two risk scores:

- **Bucket = high:** If credit risk dominates → `deny`, confidence 55–85; otherwise → `withdraw`, confidence 55–85
- **Bucket = medium:** → `at_risk`, confidence 50–70 (boosted by positives)
- **Bucket = low:** → `originate`, confidence 70–95 (boosted by positives)

### Return Value

```ts
{
  risks: string[];      // Human-readable risk descriptions
  positives: string[];  // Human-readable positive factors
  overallRisk: string;  // 'high' | 'medium' | 'low'
  predictedOutcome: 'originate' | 'withdraw' | 'deny' | 'at_risk';
  confidence: number;  // 50–95
}
```

---

## How the Three Sections Relate

1. **Bucket assignment** (backend) determines `high` / `medium` / `low` from the five composite signals.
2. **Risk score** (frontend) uses the same bucket logic and `avgSignal` to produce a numeric 40–100 score for display on loan cards.
3. **Rule-based summary** (backend) uses that bucket plus the same signals to compute credit vs. process risk, decide deny vs. withdraw for high-risk loans, and produce human-readable summaries.

The bucket drives the overall risk level; the risk score provides a compact numeric display; the rule-based summary adds outcome type (deny vs. withdraw) and explanatory text.
