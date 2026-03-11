# Market Delta: Fallout Prediction & UI Bucket Implementation

## Overview

Market delta measures the difference between the **lock** market rate and the **outcome** market rate (close date or today). It is one of the features used in fallout prediction.

**Market delta is only calculated when the loan has a lock date.** If a loan is not locked (no `lock_date`), market delta is left blank and the Lock vs Market bucket is shown as N/A. The lock market rate uses **only** the loan’s lock date — application date, started date, and other dates are not used for the lock rate.

**Unlike other features** (FICO, LTV, DTI, days_active), market delta does **not** use historical profile zones. It uses **static bucket ranges** everywhere: in the fallout sequencer, in signal strength calculations, and in the UI.

---

## Formula

```
market_delta = lock_market_rate − outcome_market_rate
```

- **Lock market rate**: FRED rate for the loan’s **lock date only** (no application-date fallback).
- **Outcome market rate**: For **historical** loans, FRED rate on the outcome date (`current_status_date`, `funding_date`, or `closing_date`). For **active** loans, today’s (or most recent) FRED rate.
- **Positive delta** → rates fell since lock → borrower can find better rates elsewhere → **higher fallout risk**.
- **Negative delta** → rates rose since lock → borrower has a favorable locked rate → **lower fallout risk**.

### When market delta is not calculated

- Loan has no `lock_date` → delta is not computed; Lock vs Market is **N/A** in the UI and no zone/bucket is written to `reason_codes` for market_delta.

### Where rates come from

- **Lock market rate**: FRED rate from `public.market_rates` for the loan’s **lock date only**. Falls back up to 7 days if the exact date has no rate.
- **Outcome market rate**: For active loans, the most recent FRED rate. For historical loans, the FRED rate on the outcome date.
- Computed by `computeMarketDeltaForDates(lockDate, outcomeDate)` in `marketRateService.ts`; callers must pass only a lock date (not application date).
- Persisted on `public.loans.market_change_delta` for reuse (only when a delta was computed, i.e. when the loan had a lock date).

---

## Static Bucket Ranges

All systems use the same bucket definitions (1 = low risk, 6 = high risk):

| Delta (Lock − Market) | Bucket | Interpretation |
|-----------------------|--------|----------------|
| ≤ −0.25%              | 1      | Borrower has great rate |
| −0.25% to 0%          | 2      | Favorable |
| 0% to 0.1%            | 3      | Neutral |
| 0.1% to +0.2%         | 4      | Slightly unfavorable |
| +0.2% to +0.3%        | 5      | Unfavorable |
| > 0.3%                | 6      | May shop elsewhere |

---

## How It Flows Through the System

### 1. Fallout Sequencer (`falloutSequencer.ts`)

Market delta is **only used for Withdrawn prediction**, not for Denied (likely decline). The likely-decline prediction uses only FICO, LTV, DTI, and days_active. Market delta is still **calculated and displayed** everywhere (pipeline, API, UI); it simply does not affect the Denied risk score or outcome.

The sequencer predicts loan outcomes (Denied / Withdrawn / Projected to Close / Closing Late). For the **Withdrawn** path, market delta is one of 5 features scored (FICO, LTV, DTI, days_active, market_delta). For the **Denied** path, only 4 features are used (FICO, LTV, DTI, days_active — **no market_delta**).

**Other features** (FICO, LTV, DTI, days_active) use profile-based zone scoring: the loan's value is compared to percentile boundaries (P10, P45–P55, P90, etc.) from blended historical profiles (`outcome_numeric_risk_profiles`). Zones are direction-aware for Denied and symmetric for Withdrawn.

**Market delta** bypasses the profile system entirely. The `staticMarketDeltaZone()` function converts the delta value to a zone using the static bucket table above:

```
Zone = 7 − Bucket
```

| Bucket | Zone | Points |
|--------|------|--------|
| 1      | 6    | 1      |
| 2      | 5    | 2      |
| 3      | 4    | 3      |
| 4      | 3    | 4      |
| 5      | 2    | 5      |
| 6      | 1    | 6      |

The zone and points are written into `reason_codes` as `{ bucket_type: 'market_delta', bucket_value: 'Zone1'–'Zone6', risk_score: points }`.

**For Originated loans** (Projected to Close / Closing Late), the same static function is used. The zone is stored in `reason_codes` with `risk_score: 0` (so it doesn't affect the official risk score, only UI display).

### 2. Prediction Pipeline (`predictionPipelineService.ts`)

Market delta is only computed for loans with a `lock_date`; no application-date fallback. When building `bucketedLoans`:

- `calcInterestLockVsMarketSignal()` → returns **null** when the loan has no lock date (Lock vs Market = N/A). When locked, uses `staticMarketDeltaBucket()` with the FRED-based delta, or `market_rate − interest_rate` if delta is missing.
- `calcMarketChangeDeltaSignal()` → same static bucket function (returns null when delta is null).

### 3. Prediction Service (`predictionService.ts`)

In `bucketLoanData()`, the `marketDeltaBucket` variable is computed using the same static ranges via `bucketNumeric()`.

### 4. Predictions GET Route (`predictions/index.ts`)

The GET endpoint recalculates signal strengths when stored values are missing. It uses `staticMarketDeltaBucketLocal()` — an identical copy of the static bucket function — for both `calculateInterestLockVsMarketSignal()` and `calculateMarketChangeDeltaSignal()`.

### 5. UI (`ClosingFalloutForecast.tsx`)

The UI reads `reason_codes` from the API response and extracts the market_delta zone via `signalBucketsFromReasonCodes()`:

```
display_bucket = 7 − zone
```

Since the sequencer writes zones using `Zone = 7 − Bucket`, the round-trip is:

```
Delta → Bucket → Zone (7−Bucket) → Display (7−Zone) = Bucket
```

So the **displayed value matches the static bucket** directly. No UI changes were needed.

When `reason_codes` are not available, the UI falls back to `interestLockVsMarketSignalStrength` from the API, which is also computed from the same static bucket function.

---

## What Changed vs. Other Features

| Feature | Zone Source | Bucket Source |
|---------|-----------|-------------|
| FICO | Profile percentiles (per segment, status, recency) | Dynamic thresholds or hardcoded fallback |
| LTV | Profile percentiles | Dynamic thresholds or hardcoded fallback |
| DTI | Profile percentiles | Dynamic thresholds or hardcoded fallback |
| days_active | Profile percentiles | Dynamic thresholds or hardcoded fallback |
| **market_delta** | **Static bucket ranges** | **Static bucket ranges** |

Market delta is the only feature where the sequencer zone assignment, signal strength bucketing, and UI display all use the same fixed ranges rather than data-driven boundaries.

---

## Files Modified

| File | What changed |
|------|-------------|
| `server/src/services/fallout/falloutSequencer.ts` | Static market_delta zones; no profile-based zones for market_delta |
| `server/src/services/fallout/numericOutcomeProfileService.ts` | Market delta only computed when `row.lock_date` is present (no application_date for lock rate) |
| `server/src/services/dashboard/predictionService.ts` | `calculateMarketDelta()` uses only `lock_date`; returns all nulls when no lock date. Static bucket ranges for market delta. |
| `server/src/services/dashboard/predictionPipelineService.ts` | Delta only when `loan.lock_date`; `market_rate_at_lock` only from lock date; `calcInterestLockVsMarketSignal()` returns null when no lock date |
| `server/src/services/dashboard/marketRateService.ts` | JSDoc: lock date only, do not pass application date |
| `server/src/routes/predictions/index.ts` | GET: only compute/display delta when loan has `lock_date`; `calculateMarketChangeDelta()` returns null when no lock date |
| `server/src/routes/fallout/index.ts` | Recompute delta only when `loan.lock_date` is present |
