# TTS (Top Tier Score) Formula Investigation Findings

**Investigation Date:** January 26, 2026  
**Status:** Complete - All 6 component formulas documented  
**Scope:** Sales Scorecard (for Loan Officers) in the Performance App

---

## Executive Summary

The TTS (Top Tier Score) formula uses **6 components**:

1. **Volume Rating** × Volume Weight
2. **Margin Rating** × Margin Weight  
3. **Turn Time Rating** × Turn Time Weight (NO compound scaling - commented out)
4. **Pull Through Rating** × Pull Through Weight (NO compound scaling - commented out)
5. **Unit Rating** × Unit Weight
6. **Concession Rating** × Concession Weight (conditional - controlled by `vCCA_ScorecardIncludeConcession`)

**KEY CORRECTION**: The compound scaling that was previously believed to exist (`VolumeRating/100` and `MarginRating/100` multipliers) is **COMMENTED OUT** in the actual formula.

---

## Finding 1: TTS Uses 6-Component Weights from XML

From the Qlik Performance app's TopTiering AppliedWeights section (screenshot evidence):

| Component | Weight (from XML %) | After /10 Division |
|-----------|---------------------|---------------------|
| **Unit Weight** | 20% | 2 |
| **Turn Time Weight** | 5% | 0.5 |
| **Pull Through Weight** | 15% | 1.5 |
| **Volume Weight** | 20% | 2 |
| **Margin Weight** | 20% | 2 |
| **Concessions Weight** | 20% | 2 |
| **TOTAL** | **100%** | **10** |

**CONFIRMED**: All 6 weights ARE used in the actual TTS Score calculation.

### Source File
```
QlikAppsAndLogicDictionaryDocs/Performance/tvd-coheus-performance-qlik/Scripts/QSS Files.qvs
```

```qvs
// Weights pulled from the Setup Tool XML (divided by 10 to maintain current production trait)
LET vScorecardVolumeWeight = $(SalesVolumeWeight) / 10;
LET vScorecardMarginWeight = $(SalesMarginWeight) / 10;
LET vScorecardTurnTimeWeight = $(SalesTurnTimeWeight) / 10;
LET vScorecardPullThroughWeight = $(SalesPullThroughWeight) / 10;
LET vScorecardUnitWeight = $(SalesUnitWeight) / 10;
LET vScorecardConcessionWeight = $(SalesConcessionsWeight) / 10;
```

### Weight Loading from XML
```
QlikAppsAndLogicDictionaryDocs/Performance/tvd-coheus-performance-qlik/Scripts/TTS + Staffing Variables.qvs
```

Weights are loaded from XML path: `Setup/ScoreCards/Sales/Weight`

---

## Finding 2: Actual TTS Formula - 6 Components (CORRECTED)

The actual `eCCA_TVI_Score_13_Months` formula from Qlik:

```qvs
eCCA_TVI_Score_13_Months = (
    $(eCCA_TVI_VolumeRating) * $(vScorecardVolumeWeight)
    +
    $(eCCA_TVI_MarginRating) * $(vScorecardMarginWeight)
    +
    $(eCCA_TVI_TurnTimesRating) /* * ($(eCCA_TVI_VolumeRating) / 100) */ * $(vScorecardTurnTimeWeight)
    +
    $(eCCA_TVI_PullThroughRating) /* * ($(eCCA_TVI_MarginRating) / 100) */ * $(vScorecardPullThroughWeight)
    +
    $(eCCA_TVI_UnitRating) * $(vScorecardUnitWeight)
    +
    Pick(vCCA_ScorecardIncludeConcession, 0, $(eCCA_TVI_ConcessionRating)) * $(vScorecardConcessionWeight)
)
/
(
    $(vScorecardVolumeWeight) + $(vScorecardMarginWeight) + $(vScorecardTurnTimeWeight) + 
    $(vScorecardPullThroughWeight) + $(vScorecardUnitWeight) + 
    Pick(vCCA_ScorecardIncludeConcession, 0, $(vScorecardConcessionWeight))
)
```

### Key Observations:

1. **6 Components** - Volume, Margin, TurnTime, PullThrough, Unit, and Concession
2. **NO Compound Scaling** - The `VolumeRating/100` and `MarginRating/100` multipliers are **COMMENTED OUT** (`/* */`)
3. **Conditional Concession** - Uses `Pick(vCCA_ScorecardIncludeConcession, 0, value)` to optionally include concession rating
   - If `vCCA_ScorecardIncludeConcession = 0` → Concession rating is 0 (not included)
   - If `vCCA_ScorecardIncludeConcession = 1` → Concession rating IS included

### Weights from XML (After /10 Division)

| Variable | XML Value | After /10 |
|----------|-----------|-----------|
| `vScorecardVolumeWeight` | 20 | 2 |
| `vScorecardMarginWeight` | 20 | 2 |
| `vScorecardTurnTimeWeight` | 5 | 0.5 |
| `vScorecardPullThroughWeight` | 15 | 1.5 |
| `vScorecardUnitWeight` | 20 | 2 |
| `vScorecardConcessionWeight` | 20 | 2 |
| **TOTAL (with concession)** | **100** | **10** |
| **TOTAL (without concession)** | **80** | **8** |

---

## Finding 3: Individual Rating Formulas (All 6 Components)

### Volume Rating
```qvs
eCCA_TVI_VolumeRating = num(([CCA Scorecard Volume] / $(vCCA_ScorecardVolumeAvg)) * 100, '$(vNumFormat)')
```
- `[CCA Scorecard Volume]` = Sum([Loan Amount]) per actor for Rolling 13 Month funded loans
- `vCCA_ScorecardVolumeAvg` = Average of [CCA Scorecard Volume] across all actors with production

### Margin Rating
```qvs
eCCA_TVI_MarginRating = num(([CCA Scorecard Margin $] / $(vCCA_ScorecardMarginAvg)) * 100, '$(vNumFormat)')
```
- **CRITICAL**: Uses Revenue in **DOLLARS**, not BPS (Basis Points)
- `[CCA Scorecard Margin $]` = Sum([Revenue]) per actor
- `vCCA_ScorecardMarginAvg` = Average of [CCA Scorecard Margin $] across all actors

### Turn Time Rating
```qvs
eCCA_TVI_TurnTimesRating = num((Pow([CCA Scorecard TurnTime], -1) / $(vCCA_ScorecardTurnTimeAvg) * 100), '$(vNumFormat)')
```
- `[CCA Scorecard TurnTime]` = Avg([App-Close]) per actor
- **CRITICAL**: Average is calculated as `Avg(Pow([CCA Scorecard TurnTime], -1))` - the average of inverses!
- Lower turn time = higher score (inverse relationship)

### Pull Through Rating
```qvs
eCCA_TVI_PullThroughRating = num(([CCA Scorecard PullThrough] / $(vCCA_ScorecardPullThroughAvg)) * 100, '$(vNumFormat)')
```
- `[CCA Scorecard PullThrough]` = Funded Count / Application Count (as percentage)
- `vCCA_ScorecardPullThroughAvg` = Average of [CCA Scorecard PullThrough] across all actors

### Unit Rating
```qvs
eCCA_TVI_UnitRating = num(([CCA Scorecard Unit] / $(vCCA_ScorecardUnitAvg)) * 100, '$(vNumFormat)')
```
- `[CCA Scorecard Unit]` = Count of funded loans per Loan Officer in Rolling 13 Month period
  - For Sales: `Count({<Rolling13MonthFlag*={Yes}, DateType*={'Funding'}, [Consolidated Channels]*={'$(vCCA_ChannelGroup)'}, $(vCCA_ScorecardMissingLevel)>}distinct [Loan Number])`
- `vCCA_ScorecardUnitAvg` = Average of [CCA Scorecard Unit] across all LOs with current production

### Concession Rating
```qvs
eCCA_TVI_ConcessionRating = num(([CCA Scorecard Concession] / $(vCCA_ScorecardConcessionAvg)) * 100, '$(vNumFormat)')
```
- `[CCA Scorecard Concession]` = Sum([Branch Concession ($)]) per Loan Officer in Rolling 13 Month period
  - For Sales: `Sum({<Rolling13MonthFlag*={Yes}, DateType*={'Funding'}, [Consolidated Channels]*={'$(vCCA_ChannelGroup)'}, $(vCCA_ScorecardMissingLevel)>}[Branch Concession ($)])`
- `vCCA_ScorecardConcessionAvg` = Average of [CCA Scorecard Concession] across all LOs with current production
- **NOTE**: Higher concessions = higher rating score (NOT inverse!) - this means actors who give more concessions get a higher score, which seems counterintuitive. Need business verification on whether this is intentional.

---

## Finding 4: Compound Scaling is DISABLED (Commented Out)

**CRITICAL CORRECTION**: The compound scaling is **COMMENTED OUT** in the actual formula:

```qvs
// These multipliers are COMMENTED OUT in the actual formula:
$(eCCA_TVI_TurnTimesRating) /* * ($(eCCA_TVI_VolumeRating) / 100) */ * $(vScorecardTurnTimeWeight)
$(eCCA_TVI_PullThroughRating) /* * ($(eCCA_TVI_MarginRating) / 100) */ * $(vScorecardPullThroughWeight)
```

This means:
- Turn Time Rating is **NOT** compound scaled by Volume Rating
- Pull Through Rating is **NOT** compound scaled by Margin Rating
- Each rating stands on its own merit

**Backend Implementation Note**: If the current backend implements compound scaling, it needs to be REMOVED to match Qlik.

---

## Finding 5: Tier Thresholds (from DataPilot Variables.csv lines 620-631)

| Tier | Score Range |
|------|-------------|
| **Top Tier** | Score >= 120 |
| **Second Tier** | 80 <= Score < 120 |
| **Bottom Tier** | 0 <= Score < 80 |

---

## Key Discrepancies Between Current Backend and Qlik

### 1. Number of Components
| Aspect | Current Backend | Qlik Actual |
|--------|-----------------|-------------|
| Components | 4 | **6** |
| Unit Rating | ❌ Missing | ✅ Included |
| Concession Rating | ❌ Missing | ✅ Conditional |

### 2. Compound Scaling
| Aspect | Current Backend | Qlik Actual |
|--------|-----------------|-------------|
| TurnTime × VolumeRating/100 | ✅ Implemented | ❌ **COMMENTED OUT** |
| PullThrough × MarginRating/100 | ✅ Implemented | ❌ **COMMENTED OUT** |

### 3. Weights
| Component | Current Backend | Qlik Actual |
|-----------|-----------------|-------------|
| Volume | 3 | **2** (20/10) |
| Margin | 2 | **2** (20/10) |
| Turn Time | 1 | **0.5** (5/10) |
| Pull Through | 2 | **1.5** (15/10) |
| Unit | ❌ Missing | **2** (20/10) |
| Concession | ❌ Missing | **2** (20/10, conditional) |
| **Total** | 8 | **10** (or 8 without concession) |

### 2. Margin Rating: BPS vs Dollars

The DataPilot formula clearly uses **Revenue in dollars** (`[CCA Scorecard Margin $]`), not `[Margin (BPS)]`.

**Current backend may be wrong if using:**
```typescript
// WRONG?
const marginRating = avgMarginBPS / companyAvgMarginBPS * 100;
```

**Should be:**
```typescript
// CORRECT
const marginRating = totalRevenueDollars / avgRevenuePerActor * 100;
```

### 3. Turn Time Average Calculation

Qlik calculates: `Avg(Pow([TurnTime], -1))` - average of inverses

**Current backend may be wrong if using:**
```typescript
// WRONG?
const turnTimeRating = (1 / avgTurnTime) / (1 / companyAvgTurnTime) * 100;
```

**Should be:**
```typescript
// CORRECT - average the inverses first
const avgInverseTurnTime = sum(1/turnTimes) / count;
const turnTimeRating = (1 / actorTurnTime) / avgInverseTurnTime * 100;
```

---

## Source Files Referenced

### Primary Sources
| File | Purpose |
|------|---------|
| `QlikAppsAndLogicDictionaryDocs/tvd-coheus-datapilot-qlik/QSDA-Data Pilot-.../Variables.csv` | CCA TVI formulas |
| `QlikAppsAndLogicDictionaryDocs/Performance/tvd-coheus-performance-qlik/Scripts/QSS Files.qvs` | Weight variable definitions |
| `QlikAppsAndLogicDictionaryDocs/Performance/tvd-coheus-performance-qlik/Scripts/TTS + Staffing Variables.qvs` | XML weight loading |

### Variable Locations in DataPilot Variables.csv
| Variable | Line Number |
|----------|-------------|
| `eCCA_TVI_Score_13_Months` | 1861-1871 |
| `eCCA_TVI_VolumeRating` | 2285 |
| `eCCA_TVI_MarginRating` | 1853 |
| `eCCA_TVI_TurnTimesRating` | 1847 |
| `eCCA_TVI_PullThroughRating` | 1857 |
| `vScorecardVolumeWeight` | 2406 |
| `vScorecardMarginWeight` | 2407 |
| `vScorecardTurnTimeWeight` | 2408 |
| `vScorecardPullThroughWeight` | 2409 |
| `vCCA_TVI_13MonthTiersDim` (tier thresholds) | 620-631 |

---

## Finding 6: Units and Concessions ARE Used in TTS Score (CONFIRMED)

Units and Concessions ARE used in the TTS Score calculation - formulas now confirmed:

### Unit Rating - `eCCA_TVI_UnitRating`
```qvs
eCCA_TVI_UnitRating = num(([CCA Scorecard Unit] / $(vCCA_ScorecardUnitAvg)) * 100, '$(vNumFormat)')
```
- `[CCA Scorecard Unit]` = Count of funded loans per actor
- Weight: 2 (from 20% / 10)
- Same pattern as other ratings: (actor value / company average) * 100

### Concession Rating - `eCCA_TVI_ConcessionRating`
```qvs
eCCA_TVI_ConcessionRating = num(([CCA Scorecard Concession] / $(vCCA_ScorecardConcessionAvg)) * 100, '$(vNumFormat)')
```
- `[CCA Scorecard Concession]` = Sum([Branch Concession ($)]) per actor
- Conditionally included via `Pick(vCCA_ScorecardIncludeConcession, 0, value)`
- Weight: 2 (from 20% / 10) when enabled
- **IMPORTANT**: This is NOT an inverse rating - higher concessions = higher score, which seems counterintuitive. May need business verification.

### Rating Pattern Summary
All 6 ratings follow the same formula pattern:
```
Rating = (Actor's Value / Company Average) * 100
```
- If actor equals company average → Rating = 100
- If actor is above average → Rating > 100
- If actor is below average → Rating < 100

---

## Next Steps

### Backend Changes Required

1. **Add Unit Rating** - Currently missing from backend
   - Find the exact `eCCA_TVI_UnitRating` formula
   - Implement with weight 2 (20/10)

2. **Add Concession Rating** - Currently missing from backend
   - Find the exact `eCCA_TVI_ConcessionRating` formula  
   - Make conditional based on `vCCA_ScorecardIncludeConcession` flag
   - Implement with weight 2 (20/10) when enabled

3. **REMOVE Compound Scaling** - Backend has it, Qlik does NOT
   - Remove `turnTimeRating * (volumeRating / 100)`
   - Remove `pullThroughRating * (marginRating / 100)`

4. **Update Weights** - Backend weights are wrong
   - Volume: 3 → **2**
   - Margin: 2 → **2** (correct)
   - Turn Time: 1 → **0.5**
   - Pull Through: 2 → **1.5**
   - Unit: missing → **2**
   - Concession: missing → **2** (conditional)
   - Total: 8 → **10** (or 8 without concession)

5. **Fix Margin Rating**: Change from BPS to Revenue in dollars

6. **Fix Turn Time Average**: Calculate average of inverses, not inverse of average

7. **Test with specific LO**: Compare component-by-component with Qlik values

---

## Appendix: Correct 6-Component Formula (Pseudocode)

```typescript
// Weights from XML (after /10 division)
const weights = {
  volume: 2,       // 20% / 10
  margin: 2,       // 20% / 10
  turnTime: 0.5,   // 5% / 10
  pullThrough: 1.5, // 15% / 10
  unit: 2,         // 20% / 10
  concession: 2    // 20% / 10
};

// Configuration flag
const includeConcession = vCCA_ScorecardIncludeConcession; // 0 or 1

// 1. Calculate individual ratings (all follow same pattern: actor/avg * 100)
const volumeRating = (actorTotalLoanAmount / avgLoanAmountPerActor) * 100;
const marginRating = (actorTotalRevenueDollars / avgRevenueDollarsPerActor) * 100;
const turnTimeRating = (1 / actorAvgTurnTime) / avgOfInverseTurnTimes * 100;  // inverse for turn time
const pullThroughRating = (actorPullThroughPct / avgPullThroughPctPerActor) * 100;
const unitRating = (actorUnitCount / avgUnitCountPerActor) * 100;
const concessionRating = (actorConcessionDollars / avgConcessionDollarsPerActor) * 100;  // NOT inverse!

// 2. NO compound scaling (it's commented out in Qlik)
// DO NOT multiply turnTimeRating by volumeRating/100
// DO NOT multiply pullThroughRating by marginRating/100

// 3. Calculate weighted score
const totalWeight = includeConcession 
  ? weights.volume + weights.margin + weights.turnTime + weights.pullThrough + weights.unit + weights.concession  // = 10
  : weights.volume + weights.margin + weights.turnTime + weights.pullThrough + weights.unit;  // = 8

const concessionComponent = includeConcession ? concessionRating * weights.concession : 0;

const ttsScore = (
  volumeRating * weights.volume +
  marginRating * weights.margin +
  turnTimeRating * weights.turnTime +
  pullThroughRating * weights.pullThrough +
  unitRating * weights.unit +
  concessionComponent
) / totalWeight;

// 4. Assign tier
const tier = ttsScore >= 120 ? 'Top' : ttsScore >= 80 ? 'Second' : 'Bottom';
```

---

## Appendix: Outstanding Questions

1. ~~**What is `eCCA_TVI_UnitRating` formula?**~~ ✅ FOUND: `([CCA Scorecard Unit] / vCCA_ScorecardUnitAvg) * 100`
2. ~~**What is `eCCA_TVI_ConcessionRating` formula?**~~ ✅ FOUND: `([CCA Scorecard Concession] / vCCA_ScorecardConcessionAvg) * 100`
3. **What is `vCCA_ScorecardIncludeConcession` set to?** - Is concession currently enabled or disabled?
4. **Concession rating direction** - The formula shows higher concessions = higher rating. Is this intentional? Typically you'd want lower concessions = better performance (inverse relationship like turn time).
