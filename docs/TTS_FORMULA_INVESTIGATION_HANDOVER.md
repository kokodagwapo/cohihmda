# TTS Formula Investigation Handover

## Current Problem

The Sales Scorecard TTS (Top Tier Score) calculations are **still not matching Qlik**:

| LO Name | New App Score | Qlik Expected Score | Difference |
|---------|---------------|---------------------|------------|
| Stanley Edward Obrecht Jr. | 261.7 | 382.3 | ~68% of expected |
| Aaron Michael Rist | ~209 (now 2nd) | 211 | Close but was 418.7 before |

**LO Tier Distribution also incorrect:**
- New App (L12M): 14/4/26 (Top/Second/Bottom)
- New App (L13M): 15/4/26
- Qlik Expected: 13/8/23

The scores being ~68-70% of expected suggests we may have the **weights wrong** or are **missing a multiplier**.

---

## Investigation Tasks

### 1. Find the EXACT `eCCA_TVI_Score_13_Months` Definition

**Search locations (in order of priority):**

1. **Performance App Variables.csv** (PRIMARY SOURCE):
   ```
   QlikAppsAndLogicDictionaryDocs/Performance/tvd-coheus-performance-qlik/QSDA-[1.6.0] Performance-82c16f07-1efc-4482-ae53-99d8abba3ee4/Variables.csv
   ```

2. **Performance App Scripts** (for variable definitions):
   ```
   QlikAppsAndLogicDictionaryDocs/Performance/tvd-coheus-performance-qlik/Scripts/
   ```
   - Look for: `CCA_AppInclude.qvs`, `TTS + Staffing Variables.qvs`, `Variables.qvs`

3. **DataPilot Variables.csv** (secondary reference):
   ```
   QlikAppsAndLogicDictionaryDocs/tvd-coheus-datapilot-qlik/QSDA-Data Pilot-dbaa5b90-3f7f-467e-98e7-0053c46b913a/Variables.csv
   ```

**What to look for:**
- `eCCA_TVI_Score_13_Months` - full formula definition
- `eCCA_TVI_VolumeRating` - how Volume Rating is calculated
- `eCCA_TVI_MarginRating` - how Margin Rating is calculated (BPS vs $ ?)
- `eCCA_TVI_TurnTimesRating` - Turn Time Rating formula
- `eCCA_TVI_PullThroughRating` - Pull Through Rating formula

---

### 2. Find the ACTUAL Weight Values

**Current assumption (may be WRONG):**
- Volume: 3
- Margin: 2
- TurnTime: 1
- PullThrough: 2
- **Total: 8**

**Search for weight definitions:**

1. **TTS + Staffing Variables.qvs** in Performance app:
   ```
   QlikAppsAndLogicDictionaryDocs/Performance/tvd-coheus-performance-qlik/Scripts/TTS + Staffing Variables.qvs
   ```
   
   We found this loads from XML and divides by 10:
   ```qvs
   LET vScorecardVolumeWeight = $(SalesVolumeWeight) / 10;
   LET vScorecardMarginWeight = $(SalesMarginWeight) / 10;
   LET vScorecardTurnTimeWeight = $(SalesTurnTimeWeight) / 10;
   LET vScorecardPullThroughWeight = $(SalesPullThroughWeight) / 10;
   ```

2. **Find the XML source values** - search for `SalesVolumeWeight`, `SalesMarginWeight` etc. in:
   - `QSS Files.qvs`
   - `Configuration Data.qvs`
   - Any XML/config files in the Performance or Incremental Builder apps

3. **Check Incremental Builder** for config loading:
   ```
   QlikAppsAndLogicDictionaryDocs/tvd-coheus-incremental-builder-qlik/
   ```

**CRITICAL QUESTION:** Are the weights 3,2,1,2 (total 8) or something else like 30,20,10,20 (total 80) BEFORE the /10 division?

---

### 3. Verify Individual Rating Formulas

**Volume Rating:**
```
Current: (Actor Total Loan Amount) / (Avg Total Loan Amount per Actor) × 100
```
- Search for: `eCCA_TVI_VolumeRating`, `CCA Scorecard Volume`, `vCCA_ScorecardVolumeAvg`

**Margin Rating:**
```
Current: (Actor Avg Margin BPS) / (Company Avg Margin BPS) × 100
Where Margin BPS = (Revenue / Loan Amount) × 10000
```
- **VERIFY:** Is it `Avg([Margin (BPS)])` or `Sum([Margin $])`?
- Search for: `eCCA_TVI_MarginRating`, `CCA Scorecard Margin`, `vCCA_ScorecardMarginAvg`, `Margin (BPS)`

**Turn Time Rating:**
```
Current: (1 / Actor Avg Turn Time) / (Avg of 1/Turn Time per Actor) × 100
```
- Search for: `eCCA_TVI_TurnTimesRating`, `CCA Scorecard TurnTime`, `vCCA_ScorecardTurnTimeAvg`
- **VERIFY:** Is it `Pow(TurnTime, -1)` or something else?

**Pull Through Rating:**
```
Current: (Actor Pull Through %) / (Avg Pull Through % per Actor) × 100
```
- Search for: `eCCA_TVI_PullThroughRating`, `CCA Scorecard PullThrough`, `vCCA_ScorecardPullThroughAvg`

---

### 4. Verify Compound Scaling Formula

**Current implementation:**
```typescript
const ttsScore = (
  volumeRating * weightConfig.volume +
  marginRating * weightConfig.margin +
  turnTimeRating * (volumeRating / 100) * weightConfig.turnTime +
  pullThroughRating * (marginRating / 100) * weightConfig.pullThrough
) / totalWeight;
```

**Questions to verify:**
1. Is TurnTime compound-scaled by VolumeRating/100? Or just straight weighted?
2. Is PullThrough compound-scaled by MarginRating/100? Or just straight weighted?
3. Does the denominator include compound-scaled weights or just base weights?

---

### 5. Check for Missing Components

**Are Unit and Concession ratings used?**

The user originally specified 6 components:
- Unit: 20%
- Volume: 20%
- Margin: 20%
- Concessions: 20%
- Pull-Through: 15%
- Turn Time: 5%

But we found Qlik's `eCCA_TVI_Score_13_Months` only uses 4 components.

**VERIFY:** Which formula does the Performance app's "Sales Scorecard" sheet ACTUALLY use?
- Search the Dimensions.csv and Expressions.csv for the exact TTS formula used in that sheet

---

### 6. Files to Search

**Performance App (PRIMARY):**
```
QlikAppsAndLogicDictionaryDocs/Performance/tvd-coheus-performance-qlik/
├── QSDA-[1.6.0] Performance-82c16f07-1efc-4482-ae53-99d8abba3ee4/
│   ├── Variables.csv      <-- Variable definitions
│   ├── Dimensions.csv     <-- Dimension expressions (tiering)
│   ├── Expressions.csv    <-- Measure expressions
│   └── Script.csv         <-- Full load script
├── Scripts/
│   ├── TTS + Staffing Variables.qvs  <-- Weight loading
│   ├── Variables.qvs
│   └── CCA_AppInclude.qvs (if exists)
```

**Incremental Builder (for data transforms):**
```
QlikAppsAndLogicDictionaryDocs/tvd-coheus-incremental-builder-qlik/
├── Transform.qvs          <-- Field transformations
├── Variables.qvs
└── Scripts/
```

**DataPilot (secondary reference):**
```
QlikAppsAndLogicDictionaryDocs/tvd-coheus-datapilot-qlik/
├── QSDA-Data Pilot-dbaa5b90-3f7f-467e-98e7-0053c46b913a/
│   └── Variables.csv      <-- Has eCCA_TVI_Score_13_Months definition
```

---

### 7. Current Backend Implementation

**File:** `server/src/routes/loans.ts`

**Endpoint:** `/api/loans/sales-scorecard`

**Current Weight Config (lines ~2085-2091):**
```typescript
const weightConfig = {
  volume: 3,       // Volume Rating weight
  margin: 2,       // Margin Rating weight
  turnTime: 1,     // Turn Time Rating weight (compound scaled by VolumeRating/100)
  pullThrough: 2,  // Pull Through Rating weight (compound scaled by MarginRating/100)
};
const totalWeight = 8;
```

**Current TTS Formula (lines ~2680-2687):**
```typescript
const ttsScore = (
  volumeRating * weightConfig.volume +
  marginRating * weightConfig.margin +
  turnTimeRating * (volumeRating / 100) * weightConfig.turnTime +
  pullThroughRating * (marginRating / 100) * weightConfig.pullThrough
) / totalWeight;
```

---

## Debugging Approach

1. **Add logging** to output individual ratings for a specific LO (e.g., Stanley):
   - volumeRating, marginRating, turnTimeRating, pullThroughRating
   - Each component's contribution to final score
   - Compare to Qlik's values if available

2. **Cross-reference** with Qlik detail data:
   - Get Stanley's individual ratings from Qlik
   - Compare each component to what our backend calculates

3. **Test different weight scenarios:**
   - Try weights from XML before /10 division
   - Try simple weighted average without compound scaling

---

## Key Hypotheses

1. **Weights are wrong** - The actual weights from XML might be different than 3,2,1,2

2. **Compound scaling is wrong** - Maybe it's not `(VolumeRating/100)` but something else, or maybe no compound scaling at all

3. **Margin Rating formula is wrong** - Maybe it's total revenue, not Avg BPS, or BPS is calculated differently

4. **Missing multiplier** - Score being 68% suggests dividing by wrong total or missing a factor

5. **Different formula entirely** - The "Sales Scorecard" sheet might use a different formula than `eCCA_TVI_Score_13_Months`

---

## Success Criteria

1. Stanley's TTS Long Term Score = 382.3 (matching Qlik)
2. LO Tier Distribution = 13 Top / 8 Second / 23 Bottom (matching Qlik for L13M or L12M)
3. All LOs' scores match within 1% of Qlik values

---

## Documentation to Update

After fixing, update:
- `docs/SALES_SCORECARD_DATA_QUESTIONS.md` - Correct formula and weights
- Add inline comments in `loans.ts` explaining the exact Qlik formula source
