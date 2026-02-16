# Numeric Outcome Prediction Engine

This document describes how the COHI **Numeric Segmented Risk Range Engine** works: segment definition, yearly profiles, persistence and reuse of older years, blended profiles, similarity scoring, and the sequential Denied → Withdrawn → Projected to Close flow used by the Predict API.

## Overview

The prediction engine assigns each active loan a **projected outcome**: Denied, Withdrawn, Closing Late, or Projected to Close. It does this by:

1. Building **yearly numeric outcome profiles** from historical loans (2023 to present) per segment and status (Denied / Withdrawn).
2. **Blending** those yearly profiles into a single profile per (status, segment) used on every Predict run.
3. **Scoring** each active loan by **similarity** to the blended Denied and Withdrawn profiles (feature zones and points).
4. **Sequencing**: rank by Denied similarity → assign top N as Denied; then rank remaining by Withdrawn similarity → assign top M as Withdrawn; then Closing Late and the rest as Projected to Close.

No categorical risk bands or human-pattern multipliers are used for Denied/Withdrawn scoring; the sequencer uses only the numeric blended profiles and similarity logic below.

---

## Segments

- **Segment dimensions**: `loan_type`, `loan_purpose`, `occupancy`.
- **loan_type**: Raw value from the database (e.g. FHA, VA, Conventional), not normalized to Conventional/Government.
- **loan_purpose** and **occupancy**: Raw values; null/empty are normalized to `'Unknown'`.
- **Segment enumeration**: Distinct `(loan_type, loan_purpose, occupancy)` are derived from historical loans and iterated when building yearly profiles.

---

## Year and Outcome Date

- **Year**: Taken from **application_date** (calendar year).
- **Outcome date**: Defined as **current_status_date** (used for historical outcome and for market delta “close” date where applicable).
- **Days active (historical)**: From **application_date** to the **outcome end date**, where outcome end date is **funding_date** if present, else **closing_date**, else **current_status_date**. So “days active” is the length of the loan’s life until that end date.
- **Days active (active loans)**: From **application_date** to **funding_date** if present, else **closing_date**, else **current_status_date**, else **today**.

---

## Yearly Profiles (outcome_numeric_risk_profiles)

- **Source**: Historical loans from **2023 through the current year** (year from application_date).
- **Table**: `outcome_numeric_risk_profiles` (tenant DB), keyed by `(year, status_type, loan_type, loan_purpose, occupancy, feature_name)`.
- **Metrics per feature**: `mean_value`, `q1_value`, `q3_value`, `iqr_value`, `sample_size`, `low_confidence`, `calculated_at`.
- **Features**:
  - **Denied**: `fico_score`, `ltv_ratio`, `be_dti_ratio`, `days_active`.
  - **Withdrawn**: same four plus **market_delta** (market rate vs locked rate; see below).
- **Minimum sample size**: 30; otherwise the segment/feature is not persisted (or marked low_confidence as implemented).
- **Market delta**: Uses the existing market-rate implementation: lock rate (at lock or application date) minus close rate (at outcome date). For historical loans this is computed via `computeMarketDeltaForDates(lock_date, current_status_date)` (or funding/closing date as fallback). For active loans in Predict, market delta is precomputed (lock date to today) and attached to each loan before the sequencer.

---

## Persistence and Reuse of Older Years

- **Stored**: All yearly profile rows are stored in `outcome_numeric_risk_profiles`.
- **Reuse**: Profiles for years **more than one year ago** (e.g. 2023, 2024) are treated as stable and **not recalculated**.
- **Recalculation**: When such older-year data already exists for the tenant, the engine **only recalculates the current year and the previous year** (e.g. 2026 and 2025). Existing rows for 2023 and 2024 (and earlier) are left as-is and reused in blend calculations.
- **Effect**: Avoids unnecessary recomputation while still refreshing recent years on each run (or when a scheduled job runs; see Scheduling below).

---

## Blended Profile (per Predict run)

- **Input**: All rows in `outcome_numeric_risk_profiles` from 2023 through the current year.
- **Output**: In-memory **blended** profile per (status_type, segment): for each feature, **blended_mean**, **blended_q1**, **blended_q3**, **blended_iqr**.
- **Weights**: Most recent years are weighted higher (e.g. 1.2, 1.0, 0.8 for the last three years). If a year is missing, remaining years are reweighted so weights sum to 1.
- **Persistence**: The blend is **not** persisted; it is recomputed on **every** Predict run from the stored yearly table.

---

## Missing Segment for an Active Loan (Partial-Aggregate Fallback)

If an active loan’s exact segment `(loan_type, loan_purpose, occupancy)` has **no** blended profile:

1. Aggregate over all segments that match **loan_type** and **loan_purpose** (all occupancy values). Use the resulting means and IQRs as the profile for that loan.
2. If still missing, aggregate over all segments with the same **loan_type** (all purpose and occupancy).
3. If still missing, use the aggregate over **all** segments for that status.

So “missing segment” is handled by relaxing the segment dimensions and reusing the same feature names and zone logic.

---

## Similarity Scoring (Zones and Points)

- For each **feature** (fico_score, ltv_ratio, be_dti_ratio, days_active, and for Withdrawn also market_delta):
  - Compare the **loan’s value** to the blended **q1**, **q3**, and **iqr** for that (status, segment) and feature.
  - **Zone 1**: Value inside [q1, q3] → **3 points** (most similar to historical outcome).
  - **Zone 2**: Within 1× IQR outside [q1, q3] → **2 points**.
  - **Zone 3**: Within 2× IQR outside → **1 point**.
  - **Zone 4**: Beyond 2× IQR → **0 points**.
- **Null/missing features**: **Skipped**; no points are added and the feature does not contribute to the score (total possible is reduced for that loan).
- **Denied score**: Sum of points over Denied features (fico, ltv, dti, days_active).
- **Withdrawn score**: Sum of points over Withdrawn features (same four plus market_delta).
- **Reason codes**: Each contributing feature is stored with `bucket_type` = feature name, `bucket_value` = e.g. `Zone2`, and `risk_score` = points, so the UI/API keep a consistent structure.

---

## Sequential Assignment

1. **Denied**: Rank all active loans by **Denied similarity score** (descending). Assign **projected_status = Denied** to the top **N** loans, where N = round(historical denied rate × active count). Attach Denied reason codes (feature + zone/points).
2. **Withdrawn**: From the **remaining** loans (not Denied), rank by **Withdrawn similarity score** (descending). Assign **projected_status = Withdrawn** to the top **M** loans, where M = round(historical withdrawn rate × remaining count). Attach Withdrawn reason codes.
3. **Closing Late**: Among the rest, if **projected_funding_date > estimated_closing_date**, set **projected_status = Closing Late** (turn-time baselines still used for projected funding date where available).
4. **Projected to Close**: All others get **projected_status = Projected to Close**.

Historical denied and withdrawn rates come from `getHistoricalFalloutRates` (completed loans in the historical window).

---

## Predict API Flow

1. **Numeric outcome profile derivation**  
   `runNumericOutcomeProfileDerivation(tenantPool)` ensures yearly profiles exist. If 2023/2024 (and older) data already exist, only the current and prior year are recomputed; otherwise all years from 2023 are computed.
2. **Active loans**  
   Fetched with columns needed for segment and features (including `current_status_date`, `closing_date`, `funding_date` for days_active and outcome date).
3. **Market delta for active loans**  
   Each active loan is enriched with **marketChangeDelta** (lock rate − current market rate) using the existing market rate service, so Withdrawn similarity can use the market_delta feature.
4. **Blended profiles**  
   Loaded from `outcome_numeric_risk_profiles` and blended in memory (no persistence of blend).
5. **Sequencer**  
   `runFalloutSequencer(tenantPool, activeLoans, { historicalDeniedRate, historicalWithdrawnRate })` scores by similarity (with partial-aggregate fallback for missing segments), then applies the sequential Denied → Withdrawn → Closing Late → Projected to Close assignment and persists to **loan_predictions**.
6. **Response**  
   The API returns predictions and summary as before (e.g. bucketed loans, summary counts, metadata), using the new projected_status and reason_codes from the sequencer.

---

## Scheduling

- **Job scheduling for numeric outcome profile derivation is not yet implemented.**  
  A comment in code (and in the profile service) states that scheduling (e.g. nightly or weekly refresh of yearly profiles) still needs to be done. Predict runs will continue to call `runNumericOutcomeProfileDerivation` so that current and prior year are updated when needed; when scheduling is added, the same service can be invoked on a schedule and Predict can rely on existing profiles for recent years.

---

## Tenant Schema and Duplication

- **Migration**: `033_outcome_numeric_risk_profiles.sql` creates `outcome_numeric_risk_profiles` in the tenant DB.
- **Tenant schema**: `createTenantDatabaseSchema` creates this table for new tenants.
- **Duplication**: The table is included in the tenant duplication list so copied tenants get outcome numeric risk profiles.

---

## Summary

| Item | Detail |
|------|--------|
| Segment | Raw `loan_type`, `loan_purpose`, `occupancy`; distinct segments from historical loans |
| Year | From **application_date** |
| Outcome date | **current_status_date**; days_active end = funding_date ?? closing_date ?? current_status_date |
| Historical range | **2023** to present year |
| Older-year reuse | 2023/2024 (and older) kept; only current and prior year recalculated when they exist |
| Blended profile | Recomputed every Predict run; not persisted |
| Missing segment | Partial aggregate over matching dimensions (e.g. all occupancy for same loan_type + loan_purpose) |
| Null features | Skipped (no 0; total possible reduced) |
| Market delta | Existing implementation; reused for historical and active loans |
| Scheduling | Not implemented; explicit TODO/comment in code |
