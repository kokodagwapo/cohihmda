# Prediction Pipeline: How We Predict Fallout and Risk

This document explains how the system predicts **Decline (Denied)**, **Withdraw**, **Likely Close Late**, and **High Risk**, and how **risk scores** are calculated for each. It is written in plain language and stays close to how the code actually works.

---

## Table of Contents

1. [Overview: The Big Picture](#overview-the-big-picture)
2. [Step 1: Deny and Withdraw Prediction](#step-1-deny-and-withdraw-prediction)  
   - [Recency weighting: recent is weighted more](#recency-weighting-recent-is-weighted-more)
3. [Step 2: Likely Close Late Prediction](#step-2-likely-close-late-prediction)
4. [Step 3: Risk Scores (0–100)](#step-3-risk-scores-0100)
5. [High Risk: How It’s Defined in the UI](#high-risk-how-its-defined-in-the-ui)
6. [Where Predictions Are Stored and Used](#where-predictions-are-stored-and-used)

---

## Overview: The Big Picture

The pipeline runs in a fixed order:

1. **Numeric outcome profiles** are derived (or refreshed) from historical loans: per-segment percentiles for Denied and Withdrawn features, including **days_active** (for Denied: application → denial_date, or current_status_date when denial_date is missing; for Withdrawn: application → funding/closing/status date). These profiles are blended by recency (≤180 days vs \&gt;180 days) and used in the next step.
2. **Deny** and **Withdraw** are decided per loan using “similarity” to those historical profiles (four features for Deny, five for Withdraw; see below).
3. Loans that are **not** predicted Deny or Withdraw are then checked for **Closing Late** (projected funding date after the estimated closing date).
4. Everyone else is **Projected to Close** (on time).

Each loan gets a **predicted outcome** (deny, withdraw, or originate) and a **risk score from 0 to 100**. The UI then uses these to show “Likely Decline,” “Likely Withdraw,” “Likely Close Late,” and “High Risk.” When the app calls **POST /api/predictions**, the server runs profile derivation (if needed) and then the fallout sequencer; results are written to **loan_predictions** and returned as **bucketedLoans** with **reason_codes** for risk and zone-based UI (e.g. FICO/LTV/DTI/days_active zones).

---

## Step 1: Deny and Withdraw Prediction

### How we decide Deny vs Withdraw

We do **not** assign a fixed number of “denied” and “withdrawn” slots. Instead we:

1. Score each loan for **how similar it is to historical Denied loans** and **how similar to historical Withdrawn loans**.
2. Turn those similarities into two **risk percentages** (0–100).
3. Only assign **Deny** or **Withdraw** if that outcome’s risk is **above a threshold** (60%).
4. If **both** are above the threshold, we pick the outcome with the **higher** risk. **Ties go to Withdraw.**

So:

- **Predict Deny** when:  
  Deny risk &gt; 60% **and** (Withdraw risk ≤ 60% **or** Deny risk &gt; Withdraw risk).
- **Predict Withdraw** when:  
  Withdraw risk &gt; 60% **and** (Deny risk ≤ 60% **or** Withdraw risk ≥ Deny risk).

### How the “similarity” scores are built

For each loan we look at a few **features** and compare them to **historical profiles** (percentiles from past Denied and Withdrawn loans, by segment).

- **For Deny** we use: **FICO score**, **LTV ratio**, **back-end DTI**, **days active**.  
  For *historical* Denied loans, “days active” = application date to **denial date** (or **current status date** if denial date is not populated). For *active* loans we score against today, so their “days active” = application date to today. This lets the model use “time in pipeline” when comparing to historical denials.
- **For Withdraw** we use: **FICO score**, **LTV ratio**, **back-end DTI**, **days active**, **market delta**.  
  For historical Withdrawn loans, “days active” = application date to funding/closing/current status date; for active loans, application date to today.

Profiles are stored per **segment** (loan type, loan purpose, occupancy). When a loan’s segment has no profile (e.g. a new or rare loan type), we use **fallbacks** so we still have feature means and zones to compare against:

1. **Exact segment** (e.g. VA \| Purchase \| Owner)
2. **Loan type + purpose** (e.g. VA \| Purchase \| All)
3. **Loan type only** (e.g. VA \| All \| All)
4. **Global fallback** – **All \| All \| All**: one profile for “all denied loans” and one for “all withdrawn loans,” so even unknown segments get sensible similarity scores.

### Recency weighting: recent is weighted more

We weight **more recent** historical loans higher so that recent mix and market conditions matter more. **Year is used only to define the data range** (2023 to present); we do **not** build separate profiles per year or average across years.

For each outcome \| loan type \| purpose \| occupancy \| feature we:

1. **Split historical data** (all loans from 2023–present) by how recent the loan’s outcome was: **≤180 days** (outcome date = funding date, or current status date, or application date—whichever is available—within the last 180 days) and **\&gt;180 days** (older).
2. **Build two profiles** per segment/feature: one for “≤180 days” and one for “\&gt;180 days,” each with its own mean and percentiles (P10–P90). Each profile uses **all** loans in that recency bucket in the 2023–present range (no per-year grouping).
3. **When scoring active loans**, we **merge** the two profiles into a single set of zone thresholds (P40–P60, etc.) using a **weighted average**: the “≤180 days” profile is weighted **1.2** and the “\&gt;180 days” profile **1.0**. So the final P40, P60, mean, and other stats are **(1.2 × recent + 1.0 × older) / 2.2**. Recent history is weighted more, so zone boundaries and similarity scores reflect current conditions more than older ones.

For each feature we see where the loan’s value falls in the profile’s percentiles (P10–P90) and assign **zone points**:

- **Zone 1** (middle band, P40–P60): **3 points**
- **Zone 2** (P30–P40 or P60–P70): **2 points**
- **Zone 3** (e.g. P20–P30, P70–P80): **1 point**
- **Zone 4** (below P10 or above P90): **0 points**

We add up the points across the features we use:

- **Deny**: 4 features × up to 3 points each → **max 12 points**.
- **Withdraw**: 5 features × up to 3 points each → **max 15 points**.

Those raw point totals are what we call “denied score” and “withdrawn score.” They are then turned into **0–100 risk** for the threshold and tie-breaker:

- **Deny risk (0–100)** = (denied score / 12) × 100  
- **Withdraw risk (0–100)** = (withdrawn score / 15) × 100  

So: **Deny and Withdraw are predicted only after checking that the corresponding risk is above the threshold, and when both are above threshold we choose by the higher risk; ties go to Withdraw.**

---

## Step 2: Likely Close Late Prediction

### Why we predict “Likely Close Late”

Loans that are still expected to fund (not Deny or Withdraw) can still **close after** the date the borrower or investor was promised—the **estimated closing date (ECD)**. Closing late can hurt customer experience, lock expiration, and investor commitments. So we estimate **when** each active loan will fund and compare that to ECD. If the projected funding date is after ECD, we flag the loan as **Closing Late** and give it a risk score so the team can prioritize pipeline management and communication.

### When we say “Likely Close Late”

A loan is **Likely Close Late** when **both** of these are true:

1. It was **not** predicted Deny or Withdraw (so it’s “originate”).
2. Its **projected funding date** is **after** its **estimated closing date (ECD)**.

So: **projected funding date &gt; ECD** → we set status to **Closing Late** and set a flag (e.g. `closeLateRisk` / `projected_status === 'ClosingLate'`) that the UI uses for “Likely Close Late.”

### Where the “projected funding date” comes from

We don’t use a single global average. We prefer **milestone-based** projection, then **turn-time fallbacks**, then an **application-to-funding** fallback.

**Primary: milestone + turn-time**

1. We look at the loan’s **current milestone** (Clear to Close, Approval, Conditional Approval, or Lock) and the **date** of that milestone.
2. We use **turn-time baselines** (average days from that milestone to funding) from historical funded loans. Baselines are stored by **segment** (loan type, purpose, occupancy). If the loan’s exact segment has no baseline, we fall back in order: **exact segment** → **loan type \| All \| All** → **All** (all loans).
3. We add that many days to the milestone date to get **projected funding date**.

**Fallback when milestone or baseline is missing**

If we have **no** milestone (e.g. loan hasn’t reached Lock yet) or **no** turn-time baseline for any segment, we still want to avoid treating the loan as “on time” by default. So we use a **global fallback**:

1. We compute the **average number of days from application to funding** across all historical funded loans.
2. For the active loan we set **projected funding date = application date + that average**.
3. We then compare this projected date to ECD exactly as above: if it’s after ECD, we mark **Closing Late** and compute the close-late risk score.

So even when we don’t have a milestone or segment-specific turn-time, we still get a projected funding date and can flag loans that are at risk of closing late based on typical cycle length.

### Past estimated closing date

If **today** is already **after** the loan’s ECD (by date), the UI treats that as **“Past Est. Closing”** and may show that label instead of or in addition to “Likely Close Late.” The pipeline still uses the same rule: **projected funding date &gt; ECD** to set **Closing Late** and the close-late risk score.

---

## Step 3: Risk Scores (0–100)

Every loan gets **one** risk score from **0 to 100** that you see in the UI. It is computed from **reason codes** stored with the prediction.

### How the stored “reason codes” become 0–100

Each prediction has a list of **reason codes**. Each reason code has a **risk_score** (a number of “points”). The API adds up those points and then scales to 0–100 using a **maximum** that depends on the **predicted outcome**:

- **Deny**: max = **12** (4 features × 3 points)  
  `risk score = round( (sum of points / 12) × 100 )`, capped at 100.
- **Withdraw**: max = **15**  
  `risk score = round( (sum of points / 15) × 100 )`, capped at 100.
- **Originate** (including Closing Late and Projected to Close): max = **18**  
  `risk score = round( (sum of points / 18) × 100 )`, capped at 100.

So the **same “sum of points”** is scaled differently for deny, withdraw, and originate so that the final number is always on a 0–100 scale.

### Where the “points” in reason codes come from

- **Deny**: The points are the **zone points** from the Deny similarity (one entry per feature: FICO, LTV, DTI, days_active). Sum is at most 12.
- **Withdraw**: Same idea with **Withdraw** zone points (FICO, LTV, DTI, days_active, market_delta). Sum is at most 15.
- **Closing Late**: We compute a **close-late score 0–100** (see below), then convert it to points so that `(points / 18) × 100` equals that score. So the API formula above gives the same 0–100 you computed for close late.
- **Projected to Close**: We store a small or zero point value so the displayed risk is low (e.g. 0).

### Close-Late risk score (0–100) formula

For **Closing Late** only, we don’t use zone points. We use two ideas:

1. **Urgency** – How close today is to ECD (closer = higher).
2. **Lateness** – How far past ECD the projected funding date is (further = higher).

Steps:

- **daysToECD** = days from today to ECD (can be negative if ECD is in the past).
- **projectedDaysPastECD** = days from ECD to projected funding date (only used when &gt; 0).
- **Urgency** (0–1):  
  If we’re within 30 days of ECD or past it, urgency goes from 0 to 1.  
  Formula: `min(1, max(0, (30 − daysToECD) / 30))`.
- **Lateness** (0–1):  
  How many days past ECD, capped at 30 days.  
  Formula: `min(1, projectedDaysPastECD / 30)`.
- **Close-late score (0–100)** = `round(50 × urgency + 50 × lateness)`, capped at 100.

So: **the closer to ECD and the further past ECD the projected close is, the higher the close-late risk score.** That 0–100 is then converted into the reason-code points so the API’s usual formula gives the same 0–100.

---

## High Risk: How It’s Defined in the UI

**High Risk** in the dashboard is **not** the same as the pipeline’s internal “bucket.” It is defined in the UI as:

A loan is **High Risk** if **all** of the following are true:

1. Its **risk score** (the 0–100 from the API) is **≥ 80**, and  
2. It is in one of these outcome groups:
   - **Likely Decline** (predicted outcome = deny), or  
   - **Likely Withdraw** (predicted outcome = withdraw), or  
   - **Likely Close Late** (predicted originate and `closeLateRisk` = true).

So: **High Risk = (Deny or Withdraw or Likely Close Late) and risk score ≥ 80.**  
Counts and lists for “High Risk” in the UI use this definition (e.g. critical loans, High Risk KPI, and the High Risk modal).

---

## Where Predictions Are Stored and Used

- **Stored**: Each run of the pipeline writes one row per loan into **loan_predictions**, including:
  - **predicted_outcome**: `deny` | `withdraw` | `originate`
  - **projected_status**: `Denied` | `Withdrawn` | `ClosingLate` | `ProjectedToClose`
  - **reason_codes**: list of `{ bucket_type, bucket_value, risk_score }`
  - **projected_funding_date**, **projected_close_window**, and related fields.

- **API**: When the app asks for predictions, the API reads these rows and:
  - Computes the **0–100 risk score** from **reason_codes** using the outcome-specific max (12 for Deny, 15 for Withdraw, 18 for Originate).
  - Sets **closeLateRisk** from **projected_status** (e.g. true when `projected_status === 'ClosingLate'`).

- **UI**: The dashboard uses:
  - **predicted_outcome** for “Likely Decline” and “Likely Withdraw.”
  - **closeLateRisk** (and sometimes “past ECD”) for “Likely Close Late” and “Past Est. Closing.”
  - **risk score** and the High Risk rule above for the **High Risk** KPI and lists.

---

## Summary Table

| Concept | How it’s determined | Risk score (0–100) |
|--------|----------------------|---------------------|
| **Likely Decline** | Deny risk &gt; 60% and (Withdraw ≤ 60% or Deny risk &gt; Withdraw risk) | Sum of deny reason-code points ÷ 12 × 100 |
| **Likely Withdraw** | Withdraw risk &gt; 60% and (Deny ≤ 60% or Withdraw risk ≥ Deny risk) | Sum of withdraw reason-code points ÷ 15 × 100 |
| **Likely Close Late** | Originate and projected funding date &gt; ECD | 50×urgency + 50×lateness (then stored as points ÷ 18 × 100) |
| **High Risk** (UI) | (Deny or Withdraw or Likely Close Late) and risk score ≥ 80 | Same as above, per outcome |

This document reflects the behavior of the **fallout sequencer** and the **predictions API** as of the last update. It includes: **Deny** using four features (FICO, LTV, DTI, **days_active**); for historical Denied loans, days_active = application to **denial_date** (with **current_status_date** as fallback when denial_date is not populated); for active loans, days_active = application to today; segment fallbacks (All|All|All for deny/withdraw); recency-weighted profiles (≤180 days weighted 1.2×, \&gt;180 days 1.0× when blending; year used only to filter data 2023–present); and the application-to-funding fallback for close-late when milestone or turn-time baseline is missing. For implementation details, see `server/src/services/fallout/falloutSequencer.ts`, `server/src/services/fallout/numericOutcomeProfileService.ts`, `server/src/services/fallout/numericProfileBlendService.ts`, `server/src/services/fallout/turnTimeProjectionService.ts`, `server/src/routes/predictions/index.ts`, and the `denial_date` column on `public.loans` (migration `036_loans_denial_date.sql`).

---

## Ideas and Recommendations for Improvement

Below are suggestions that could make the pipeline more accurate, easier to operate, or easier to explain. They are optional and can be prioritized by impact and effort. Items that have been implemented are noted.

### 1. Make key levers configurable

- **Risk threshold (60%)** – Today it’s a constant. Exposing it (e.g. per tenant or in admin) would let you tighten or loosen how many loans get a Deny/Withdraw label without code changes.
- **High Risk cutoff (80)** – Same idea: allow tuning the “High Risk” bar so it matches how your team actually prioritizes.
- **Close-late constants (30-day urgency window, 30-day lateness cap, 50/50 urgency–lateness split)** – Making these configurable would support A/B tests or segment-specific behavior (e.g. different urgency for purchase vs refi).

### 2. Calibration and validation

- **Back-test** – Periodically compare predictions to actual outcomes (denied, withdrawn, closed late) and track precision/recall or simple hit rates by outcome. That will show whether the 60% threshold and zone logic are well aligned with reality.
- **Segment-level checks** – If some loan types or channels are under- or over-predicted, consider segment-specific thresholds or separate calibration of the zone profiles.

### 3. Richer “why” for users

- **Reason-code summaries** – Storing a short, human-readable summary (e.g. “FICO in risky band; LTV above P70”) in addition to raw reason codes would make it easier to show “why this loan is Likely Decline” in the UI without re-deriving it on the front end.
- **Close-late explanation** – For Closing Late, expose the two drivers (e.g. “X days to ECD, Y days past ECD”) in the API or in the doc so support and ops can explain scores quickly.

### 4. Deny/Withdraw similarity

- **Refresh profiles** – Ensure historical profiles (percentiles for Denied/Withdrawn) are refreshed on a schedule so they reflect recent mix and market; document the refresh cadence.
- **Days active for Denied** – **Implemented.** Deny prediction now uses **days_active** as a fourth feature. For historical Denied loans we use **denial_date** (application → denial) with **current_status_date** as fallback; for active loans we use application → today. The `denial_date` column is on `public.loans` (migration `036_loans_denial_date.sql`).
- **Fallback segments** – **Implemented.** We use fallbacks for deny/withdraw: exact segment → loan type + purpose → loan type only → **All \| All \| All** (global profile for all denied and all withdrawn loans). New or unknown segments (e.g. a new loan type) still get sensible similarity scores from the global profile.
- **Recency weighting** – **Implemented.** Historical data is filtered to 2023–present; year is not used to split or weight profiles. Profiles are built only by recency: “≤180 days” and “\&gt;180 days” (by outcome date). When scoring active loans, the two are merged with weights 1.2 (recent) and 1.0 (older) so more recent historical loans have a stronger influence on zone thresholds (P40–P60, etc.) and thus on similarity scores.
- **Zone boundaries** – Revisit the P40–P60 = 3, P30–P70 = 2, etc. if back-tests show that “middle” loans are not actually lower risk; the current design assumes middle = more like historical outcomes.

### 5. Close-late and turn-time

- **Missing projected funding** – **Implemented.** When milestone or turn-time baseline is missing, we now use a fallback: **average days from application to funding** across historical funded loans. We set projected funding date = application date + that average, then compare to ECD and assign Closing Late / risk score as usual, so loans aren’t silently treated as on-time when data is thin.
- **Stale milestones** – If milestone dates are old, projected funding might be in the past. Consider ignoring or down-weighting very old milestones, or surfacing “no recent milestone” in the UI so it’s clear why a loan isn’t Close Late.

### 6. High Risk and UX

- **Single definition** – High Risk is currently defined only in the UI. If other systems (reports, APIs, alerts) need the same concept, consider defining “High Risk” once (e.g. in the API or a shared spec) and having the UI consume it, so the rule doesn’t drift.
- **Confidence or “gray zone”** – For scores just below 80 or just above 60%, consider a secondary label (e.g. “Elevated risk”) so users can still triage without treating them the same as clearly high-risk loans.

### 7. Operational and maintenance

- **Audit trail** – Storing pipeline run id or as-of date with each prediction (you already have as_of_date) helps when debugging “why did this loan flip to Withdraw?” after a run.
- **Docs and constants** – Keep this doc and the summary table in sync when you change thresholds or formulas; a short “Changelog” at the top or bottom can help. Centralizing constants (thresholds, max points, close-late parameters) in one place in code will make future tuning and doc updates easier.
