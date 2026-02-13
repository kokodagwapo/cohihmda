# Fallout Calibration and Why Historical Loans Must Use the Same Score Options

This document explains how we calibrate the predicted-outcome threshold to historical fallout rate, and why we had to fix a **scoring mismatch** that caused over-prediction (e.g. 131 of 154 loans predicted fallout when historical fallout was ~54%).

---

## What Calibration Does

For each tenant (lender), we:

1. Compute **historical fallout rate** = (withdraw + deny) / total from loans with known outcomes.
2. Compute a **combined risk score** (max of credit risk score and process risk score) for every historical loan.
3. Choose a **threshold** at the (1 − historicalFalloutRate) percentile of those scores. So if 54% of historical loans fell out, we want 46% of scores to be *below* the threshold (predicted originate) and 54% *at or above* (predicted fallout).
4. For **active** loans we use that same threshold: `combinedRiskScore >= threshold` → predict fallout (deny or withdraw).

If historical and active loans were scored the same way, the predicted fallout rate on active loans would match the historical rate (e.g. ~54%).

---

## The Bug: Different Scoring for Historical vs Active

The risk summary is produced by `generateRuleBasedSummary(loan, options)`. The **options** control several **optional** add-ons that increase the combined risk score:

| Add-on | What it does | When it runs |
|--------|----------------|---------------|
| **Pattern** | "Similar historical loans had high fallout rate" — compares loan to historical by FICO/DTI/MLO; if similar loans had >50% fallout, adds +2 to process risk. | Only when `options.historicalWithOutcomes` is passed. |
| **Trend** | "Personnel have declining recent pull-through" — for LO/UW/closer/processor, if recent pull-through is >10 pts below overall, adds up to +2 process risk. | Only when `options.recentPullthroughByRole` and `options.overallPullthroughByRole` (or `options.allLoans`) are passed. |
| **Stage** | "Loan has been in pipeline longer than typical" — compares time-in-pipeline to historical average; can add process risk. | Only when `options.historicalWithOutcomes` is passed. |

**Before the fix:**

- When computing the **calibration threshold**, we called `generateRuleBasedSummary(loan)` with **no options** for each historical loan. So historical loans never got pattern, trend, or stage add-ons → their combined scores were **lower**.
- When scoring **active** loans we passed full options (historicalWithOutcomes, pullthrough maps, etc.) → active loans got pattern/trend/stage when applicable → their combined scores were **higher**.

Result: the threshold was chosen from a **lower** score distribution (historical), then applied to a **higher** score distribution (active). So many more active loans exceeded the threshold → e.g. 131/154 predicted fallout instead of ~54%.

---

## The Fix: Same Options for Calibration and Active

We now:

1. **Precompute** pull-through by role (recent and overall) from `allLoansForPullthrough` **before** calibration.
2. Build a **calibration options** object with the same context we use for active loans (no threshold yet):
   - `historicalWithOutcomes`
   - `allLoans` (or `recentPullthroughByRole` / `overallPullthroughByRole`)
   - `recentPullthroughByRole`, `overallPullthroughByRole`
3. When computing the threshold, call `getCalibratedThreshold(historicalWithOutcomes, historicalFalloutRate, calibrationScoreOptions)`. Inside that function we call `generateRuleBasedSummary(loan, scoreOptions)` for each historical loan.
4. Active loans are still scored with `generateRuleBasedSummary(loan, summaryOptions)` where `summaryOptions` includes the same fields plus `calibratedCombinedThreshold`.

So **historical and active loans are now scored with the same formula** (including pattern, trend, stage). The threshold is taken from the same score distribution we apply to active loans, and predicted fallout rate should align with historical fallout rate.

---

## Code Locations

- **Calibration threshold:** `getCalibratedThreshold(historicalWithOutcomes, historicalFalloutRate, scoreOptions?)` in `server/src/services/dashboard/predictionService.ts`. The third argument is the options used when scoring historical loans.
- **Precompute pull-through and calibration:** In `runPredictFlow`, pull-through by role is computed right after `historicalWithOutcomes`; `calibrationScoreOptions` is built and passed into `getCalibratedThreshold`.
- **Optional add-ons (pattern, trend, stage):** Inside `generateRuleBasedSummary`, see blocks that use `options?.historicalWithOutcomes`, `options?.recentPullthroughByRole` / `overallPullthroughByRole`, and `calculateStageProgressionRisk(loan, options.historicalWithOutcomes)`.

---

## Summary

- **Calibration** sets one combined-score threshold per tenant so predicted fallout rate matches historical.
- **Pattern, trend, and stage** are optional risk add-ons that only run when options are passed; they increase combined score.
- **Bug:** Historical loans were scored without those options when building the threshold, so the threshold was too low and we over-predicted fallout on active loans.
- **Fix:** We now pass the same options when scoring historical loans in calibration, so the threshold is from the same score distribution as active loans.
