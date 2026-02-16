# Plan: Historical Bucket–Based Risk Scoring (Steps 3 & 4)

This document describes the implementation plan for the new loan prediction method that uses historically high-fallout buckets to drive credit and process risk scores, with a fixed outcome threshold.

---

## Current vs New Flow

| Step | Current | New |
|------|--------|-----|
| 1 | Dynamic thresholds (FICO/LTV/DTI by type) | Same ✓ |
| 2 | Bucket all loans (active + historical) | Same ✓ |
| 3 | — | Compute deny % and withdraw % per bucket from history; find "significant" bucket sets (cumulative ≥ threshold) |
| 4 | Risk = average of 1–6 buckets → scale to 100; calibrated cutoff from history | Risk = count of "my bucket is in significant set" per dimension → scale to 100; **fixed** cutoff (e.g. 60) |

---

## Step 3: Define "High Risk" Buckets From History

### 3.1 Data and Scope

- **Input:** `historicalWithOutcomes` (bucketed historical loans with `actualOutcome`: `'deny' | 'withdraw' | 'originate'`).
- **Features used for credit risk score (deny):** loan type, loan purpose, occupancy, FICO, LTV, DTI, self-employed, active days, loan officer pullthrough, processor pullthrough, underwriter pullthrough, closer pullthrough.  
  **Signal names:** `loanTypeSignal`, `loanPurposeSignal`, `occupancyTypeSignal`, `ficoScoreSignal`, `ltvSignal`, `dtiSignal`, `selfEmployedSignal`, `timeInMotionSignal` (active days), `loPullthroughSignal`, `processorPullthroughSignal`, `uwPullthroughSignal`, `closerPullthroughSignal`.
- **Features used for process risk score (withdraw):** loan type, loan purpose, occupancy, FICO, LTV, DTI, self-employed, active days, days remaining for lock, market rate vs locked rate, loan officer pullthrough, processor pullthrough, underwriter pullthrough, closer pullthrough.  
  **Signal names:** same as above, plus `lockExpirationDaysRemainingSignal` (days remaining for lock), `interestLockVsMarketSignalStrength` (market rate vs locked rate). Active days = `timeInMotionSignal`; LO pullthrough = `loPullthroughSignal` / `mloAeFalloutProneSignalStrength` (same bucket).
- Use **only individual signals** (no composite credit metric). FICO/LTV/DTI for process risk use the same bucket as credit, with withdraw significant set (built 1→6); no inverse FICO.
- **Self-employed bucketing:** Uses field `borr_self_employed` (or `borrSelfEmployed`). **Bucket 1:** `false` or `null`. **Bucket 6:** `true`. (No other buckets; effectively binary for risk.)
- **Loan-type split:** For **FICO, LTV, DTI** only, compute stats **per loan type** (Conventional vs Government), using `getLoanTypeCategory(loan)`. All other signals: one set of stats across all historical loans.

### 3.2 Per-Signal, Per-Bucket Percentages

**Percent formula (share of total fallout):**

We want to see which bucket contains the most of that outcome type. So we express each bucket’s contribution as a **share of all loans with that outcome** (within the same scope), not as a rate within the bucket.

- **FICO, LTV, DTI (per loan type):** For each of these signals, compute deny and withdraw percentages **per loan type**. Example for `ficoScore|Conventional`:
  - Restrict to Conventional loans only (using `getLoanTypeCategory(loan) === 'Conventional'`).
  - **Deny:** `denyCount(b) = count(Conventional loans in bucket b with actualOutcome === 'deny')`, `totalDeny = count(all Conventional loans with actualOutcome === 'deny')`, **`denyPct(b) = denyCount(b) / totalDeny`**.
  - **Withdraw:** `withdrawCount(b) = count(Conventional loans in bucket b with actualOutcome === 'withdraw')`, `totalWithdraw = count(all Conventional loans with actualOutcome === 'withdraw')`, **`withdrawPct(b) = withdrawCount(b) / totalWithdraw`**.
  - Same for `ficoScore|Government`, `ltv|Conventional`, `ltv|Government`, `dti|Conventional`, `dti|Government`. Within each (signal, loanType), percentages sum to 100% across buckets.

- **All other signals (no loan-type split):** Use all historical loans.
  - **Deny:** `denyCount(b) = count(loans in bucket b with actualOutcome === 'deny')`, `totalDeny = count(all loans with actualOutcome === 'deny')`, **`denyPct(b) = denyCount(b) / totalDeny`**.
  - **Withdraw:** `withdrawCount(b) = count(loans in bucket b with actualOutcome === 'withdraw')`, `totalWithdraw = count(all loans with actualOutcome === 'withdraw')`, **`withdrawPct(b) = withdrawCount(b) / totalWithdraw`**.

If `totalDeny` or `totalWithdraw` is 0 for that scope, treat all bucket percentages as 0 (or skip cumulative logic for that outcome).

**Example (2-bucket case):** 1,000 total loans, 100 deny. Bucket 1: 100 loans, 50 denied. Bucket 2: 900 loans, 50 denied.

- With the **old** formula (rate within bucket): bucket 1 = 50%, bucket 2 ≈ 5.6% — bucket 1 looks "worse" even though both buckets contributed 50 denials each.
- With the **new** formula (share of all denials): bucket 1 = 50/100 = **50%**, bucket 2 = 50/100 = **50%**. Each bucket accounts for half of all denials, which matches the goal of "which bucket has the most percentage of fallout" in terms of contribution to total fallout.

Compute per (signal, loanType if applicable): two 6-element vectors `denyPct[1..6]` and `withdrawPct[1..6]`.

### 3.3 Cumulative Threshold → Significant Bucket Sets

- **Config:** One parameter, e.g. `FALLOUT_CUMULATIVE_THRESHOLD = 0.5` (50%). Could live in env or a small config.
- **Include rule:** Include the current bucket when cumulative **≥** threshold (e.g. 50% exactly includes that bucket).
- **Direction rules:**
  - **Deny (credit risk):** Always start at bucket **6**, then 5, 4, 3, 2, 1. Add buckets until the **sum** of `denyPct(b)` over the buckets added so far ≥ threshold. Significant set = those bucket numbers (e.g. {6, 5}).
  - **Withdraw (process risk):**
    - **FICO, LTV, DTI only:** For these features, a *better* score (lower bucket) is associated with *higher* withdraw rates (e.g. strong borrowers shop). So start at bucket **1**, then 2, 3, 4, 5, 6. Add buckets until the sum of `withdrawPct(b)` ≥ threshold. Significant set = {1}, {1,2}, {1,2,3}, etc. Process risk then uses the same FICO/LTV/DTI bucket as credit (no inverse): "if loan's bucket is in withdraw significant set" (e.g. bucket ≤ 3).
    - **All other process features** (time in motion, MLO pullthrough, closer, processor, interest lock vs market): Start at bucket **6**, then 5, 4, 3, 2, 1 — same as deny. Add until cumulative withdraw % ≥ threshold. Significant set = {6}, {6,5}, etc.
- **Withdraw direction for self-employed:** Self-employed is bucketed as bucket 1 (false/null) or 6 (true). For withdraw, treat as "other" process feature: start at **6** (then 5, 4, …). So cumulate 6 → 1 for self-employed on withdraw.
- **Hard rule (halfway default):** If after adding the **first 3 buckets** (in the direction we're going) the cumulative threshold has **not** been met, **default** the significant set to those first 3 buckets:
  - When starting at **6** (deny for all, or withdraw for non–FICO/LTV/DTI): after adding 6, 5, 4, if cumulative < threshold → significant set = **{6, 5, 4}**.
  - When starting at **1** (withdraw for FICO, LTV, DTI): after adding 1, 2, 3, if cumulative < threshold → significant set = **{1, 2, 3}**.

So:

- **Deny:** Always cumulate 6 → 5 → 4 → 3 → 2 → 1.
- **Withdraw:** Cumulate 1 → 2 → … → 6 for **ficoScore**, **ltv**, **dti** (and their loan-type variants). Cumulate 6 → 5 → … → 1 for all other process signals.

**Output of Step 3:** For each (signal, loanType where applicable):

- `denySignificantBuckets`: set of bucket numbers (e.g. {5, 6}).
- `withdrawSignificantBuckets`: set of bucket numbers (e.g. {1} or {1,2,3} for FICO/LTV/DTI; {6,5} for others). Process risk for FICO/LTV/DTI uses the loan's raw bucket and this set (no inverse FICO).

### 3.4 Where and How to Implement

- **New module (recommended):** e.g. `server/src/services/dashboard/historicalBucketRiskService.ts` or a dedicated section in `predictionService.ts`.
- **New function**, e.g.  
  `computeHistoricalBucketFalloutStats(historicalWithOutcomes, options?: { cumulativeThreshold?: number })`  
  returning a structure like:

```ts
interface HistoricalBucketRiskProfile {
  bySignal: {
    [signalKey: string]: {
      denySignificantBuckets: Set<number>;   // or number[]
      withdrawSignificantBuckets: Set<number>;
      denyPctByBucket?: Record<number, number>;   // optional, for debugging
      withdrawPctByBucket?: Record<number, number>;
    };
  };
  // For FICO/LTV/DTI, signalKey could be "ficoScore|Conventional", "ficoScore|Government", etc.
}
```

- **Signal keys:**  
  - For FICO/LTV/DTI: `ficoScore|Conventional`, `ficoScore|Government`, `ltv|Conventional`, … so Step 4 can look up by `loanTypeCategory`.  
  - For the rest: `loanCharacteristicsSignalStrength`, `uwPullthroughSignalStrength`, `timeInMotionSignalStrength`, etc. (no `|Conventional` suffix).
- **When to call:** In `runPredictFlow`, **after** you have `historicalWithOutcomes` (and after dynamic thresholds + re-bucketing historical). So: right after the block that sets `historicalWithOutcomes` and before building calibration options. Pass `historicalWithOutcomes` into `computeHistoricalBucketFalloutStats(...)` and store the result (e.g. `historicalBucketRiskProfile`) so Step 4 can use it.

### 3.5 Edge Cases

- **No fallouts:** If `totalDeny === 0` or `totalWithdraw === 0`, all bucket percentages are 0; cumulative never reaches 50%. The halfway default then applies: deny / 6→1 process use {6, 5, 4}; withdraw 1→6 (FICO/LTV/DTI) use {1, 2, 3}.
- **Very few loans:** If total historical count is tiny, you could enforce a minimum sample and otherwise fall back to "no significant buckets."

---

## Step 4: New Risk Score and Fixed Cutoff

### 4.1 Scoring Rule (Binary "In Significant Set")

- **Credit risk (deny):**  
  Use **only individual signals** (no composite). For each of: loan type, loan purpose, occupancy, FICO, LTV, DTI, self-employed, active days, LO pullthrough, processor pullthrough, UW pullthrough, closer pullthrough (see 3.1 for signal names), if the **active loan's bucket** for that signal is in the **denySignificantBuckets** set for that signal (using the correct loan-type key for FICO/LTV/DTI), add 1; else 0.  
  - `creditRiskRaw = sum over credit signals of (1 if loan's bucket in denySignificantBuckets else 0)`.
- **Process risk (withdraw):**  
  For each process signal (loan type, loan purpose, occupancy, FICO, LTV, DTI, self-employed, active days, days remaining for lock, market rate vs locked rate, LO pullthrough, processor, UW, closer — see 3.1), if the loan's bucket is in **withdrawSignificantBuckets**, add 1. For FICO/LTV/DTI the withdraw set is built 1→6. No inverse FICO.  
  - `processRiskRaw = sum over process signals of (1 if loan's bucket in withdrawSignificantBuckets else 0)`.

No "higher bucket = higher score"; it's only "bucket in historically high-fallout set → +1".

### 4.2 Scale to 1–100

- **Credit:**  
  `creditSignalCount` = number of credit signals **present** on the loan (non-null bucket). Then `creditRiskScore100 = creditRiskRaw === 0 ? 1 : Math.min(100, Math.round((creditRiskRaw / creditSignalCount) * 99) + 1)` (or linear: `(creditRiskRaw / creditSignalCount) * 99 + 1` clamped to [1, 100]). So 0 contributions → 1, all present contributing → 100.
- **Process:**  
  Same formula with `processRiskRaw` and `processSignalCount` (count of process signals present on the loan).
- **Combined:**  
  Keep `riskScore = Math.max(processRiskScore100, creditRiskScore100)` so one bad dimension still drives the score.

### 4.3 Predicted Outcome and Bucket (High/Medium/Low)

- **Outcome:**  
  Use a **fixed** threshold, e.g. `FIXED_FALLOUT_THRESHOLD = 60`.  
  - `riskScore >= 60` → predict fallout; then **deny vs withdraw** by which dimension dominates (e.g. `creditRiskScore100 >= processRiskScore100` → deny, else withdraw).  
  - `riskScore < 60` → originate.
- **No** calibrated threshold from historical percentile for the main path; optional for fallback or analytics.
- **Bucket (high/medium/low):**  
  Keep current bands (e.g. ≥75 high, ≥50 medium, <50 low) or adjust if desired.

### 4.4 Where to Implement

- **`generateRuleBasedSummary(loan, options)`** in `predictionService.ts`:
  1. Extend `RuleBasedSummaryOptions` with `historicalBucketRiskProfile?: HistoricalBucketRiskProfile` and make `calibratedRiskScoreThreshold` optional for the new path.
  2. When `historicalBucketRiskProfile` is present: compute credit/process raw counts from "bucket in significant set" and scale to 100; use **fixed threshold 60** for outcome.
  3. When absent: keep current logic (average of 1–6 buckets, scale to 100, calibrated threshold if provided).

### 4.5 Confidence

- Same as before: e.g. fallout `55 + (riskScore - threshold) * 0.8`, originate `60 + (threshold - riskScore) * 0.5`, capped at 95.

---

## Summary of Edits

1. **Percent formula:** Use **share of total outcome** within the same scope. For FICO/LTV/DTI, scope is per loan type (e.g. `totalDeny` = count of Conventional loans with actualOutcome === 'deny' for ficoScore|Conventional). For other signals, scope is all loans. So `denyPct(b) = denyCount(b) / totalDeny`, `withdrawPct(b) = withdrawCount(b) / totalWithdraw`; percentages sum to 100% within that scope.
2. **Withdraw direction:**  
   - **Start at 1 and go up (1→6)** for withdraw **only** for: **FICO, LTV, DTI**. Process risk uses the same FICO/LTV/DTI bucket (no inverse FICO); "bucket in withdraw significant set" (e.g. bucket ≤ 3).  
   - **Start at 6 and go down (6→1)** for deny for all features, and for withdraw for **all other** process features (time in motion, MLO, closer, processor, interest lock vs market).
3. **No composite credit signal:** Only individual credit signals (FICO, DTI, LTV, loan characteristics, UW pullthrough) are used for credit risk.
4. **Halfway default:** If cumulative threshold is not met by the first 3 buckets in direction: when starting at 6 → default significant set to {6, 5, 4}; when starting at 1 → default to {1, 2, 3}.
5. **Include rule:** Include the current bucket when cumulative ≥ threshold.

---

## File / Flow Summary

| Item | Location / change |
|------|-------------------|
| Step 3: compute deny/withdraw share per bucket | New (or in `predictionService`): `computeHistoricalBucketFalloutStats(historicalWithOutcomes, { cumulativeThreshold: 0.5 })` |
| Step 3: cumulative logic (direction per signal) | Same module; deny always 6→1; withdraw 1→6 for FICO/LTV/DTI, 6→1 for others; halfway default {6,5,4} or {1,2,3} |
| Step 3: call from flow | `runPredictFlow`: after `historicalWithOutcomes` is set, call Step 3 and store `historicalBucketRiskProfile` |
| Step 4: score from "bucket in set" | `generateRuleBasedSummary`: when `historicalBucketRiskProfile` is present, use count-based credit/process scores and fixed threshold 60 |
| Step 4: pass profile into summary | `runPredictFlow`: pass `historicalBucketRiskProfile` in options when calling `generateRuleBasedSummary` |
| Fixed threshold | Constant or env, e.g. `FIXED_FALLOUT_THRESHOLD = 60` |

---

## Optional Enhancements

- **Caching Step 3:** Cache `HistoricalBucketRiskProfile` (e.g. keyed by tenant) and invalidate when new historical loans or bucket definitions change.
- **Config:** Make `cumulativeThreshold` (50%) and fixed outcome threshold (60) configurable (env or tenant config).
- **Logging:** Log per-signal deny/withdraw shares and resulting significant sets for verification.
