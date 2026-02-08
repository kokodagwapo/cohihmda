---
name: Enhanced Fallout Prediction with Personnel Pull-Through
overview: Enhance the fallout prediction system to leverage per-loan personnel pull-through rates (LO, UW, Closer, Processor) more effectively and add features that compare current pipeline loans to historical fallout patterns for better accuracy.
todos:
  - id: enhance-personnel-pullthrough
    content: Enhance generateRuleBasedSummary to use all personnel pull-through signals (UW, Closer, Processor) in risk scoring, not just MLO
    status: completed
  - id: calibrate-thresholds
    content: Add historical fallout rate calibration - calculate org-wide fallout rate and use percentile-based thresholds instead of fixed values
    status: completed
  - id: historical-pattern-comparison
    content: Add compareToHistoricalFallouts function to find similar historical loans that fell out and use their outcomes to adjust predictions
    status: completed
  - id: team-composition-risk
    content: Add calculateTeamRisk function to detect when multiple personnel have low pull-through (multiplicative risk effect)
    status: completed
  - id: recent-trend-analysis
    content: Add calculateRecentTrend function to detect declining personnel performance (recent vs. overall pull-through)
    status: completed
  - id: stage-progression-risk
    content: Add calculateStageProgressionRisk function to detect loans stuck in a stage longer than typical
    status: completed
  - id: integrate-all-features
    content: Update generateRuleBasedSummary to integrate all new features (team risk, historical comparison, trends, stage progression) with proper weighting
    status: completed
  - id: test-validation
    content: Add logging and validation to compare predicted vs. actual outcomes and track which features are most predictive
    status: completed
isProject: false
---

# Enhanced Fallout Prediction with Personnel Pull-Through

## Current State Analysis

**What's Working:**

- Personnel pull-through rates are calculated per loan from historical data (LO, UW, Closer, Processor)
- Each loan gets signal strengths (1-6) for each role based on that specific person's historical performance
- MLO pull-through is partially used in process risk scoring

**Gaps:**

- Only MLO pull-through is used in risk scoring; UW pull-through is commented out, Closer/Processor not used
- Fixed thresholds (creditRiskScore > 7, processRiskScore > 6) don't calibrate to historical fallout rates
- No comparison of current loans to historical loans that actually fell out
- Missing features like team composition risk, recent trend analysis, and loan stage progression

## Implementation Plan

### 1. Enhance Personnel Pull-Through Usage in Risk Scoring

**File:** `server/src/services/dashboard/predictionService.ts` (function: `generateRuleBasedSummary`)

**Changes:**

- **Uncomment and enhance UW pull-through** in credit risk score (currently commented out at line 2986-2989)
- **Add Closer pull-through** to process risk score (closers affect final-stage fallout)
- **Add Processor pull-through** to process risk score (processors affect mid-stage fallout)
- **Weight personnel signals more heavily** - they're loan-specific and highly predictive

**Implementation:**

```typescript
// Credit Risk: Add UW pull-through (uncomment and enhance)
if (loan.uwPullthroughSignalStrength >= 5) {
  risks.push("Underwriter has below-average historical pullthrough rate");
  creditRiskScore += 2; // Increase from +1 to +2
} else if (loan.uwPullthroughSignalStrength >= 4) {
  creditRiskScore += 1;
}

// Process Risk: Add Closer pull-through
if (loan.closerPullthroughSignalStrength >= 5) {
  risks.push("Closer has below-average historical pullthrough rate");
  processRiskScore += 2;
} else if (loan.closerPullthroughSignalStrength >= 4) {
  processRiskScore += 1;
}

// Process Risk: Add Processor pull-through
if (loan.processorPullthroughSignalStrength >= 5) {
  risks.push("Processor has below-average historical pullthrough rate");
  processRiskScore += 2;
} else if (loan.processorPullthroughSignalStrength >= 4) {
  processRiskScore += 1;
}
```

### 2. Calibrate Thresholds to Historical Fallout Rate

**File:** `server/src/services/dashboard/predictionService.ts` (function: `runPredictFlow`)

**Changes:**

- Calculate organization-wide historical fallout rate from `historicalLoans`
- Use percentile-based thresholds instead of fixed values
- Calibrate so predicted fallout count matches historical rate (e.g., if 46% historically fell out, predict ~46% of active loans to fallout)

**Implementation:**

```typescript
// After bucketing historical loans, calculate org fallout rate
const historicalFalloutRate = calculateHistoricalFalloutRate(
  historicalWithOutcomes,
);
// Example: if 46% fell out historically, use 46th percentile of risk scores as threshold

// In generateRuleBasedSummary, use dynamic thresholds based on org rate
const orgFalloutPercentile = getOrgFalloutPercentile(historicalFalloutRate);
// Adjust creditRiskScore and processRiskScore thresholds dynamically
```

### 3. Add Historical Pattern Comparison

**File:** `server/src/services/dashboard/predictionService.ts` (new function: `compareToHistoricalFallouts`)

**Changes:**

- For each active loan, find similar historical loans that fell out (withdrew/denied)
- Compare signal strength profiles (e.g., "loans with FICO bucket 3, DTI bucket 4, LO pull-through bucket 5 fell out 60% of the time")
- Use this similarity score to adjust predicted outcome

**Implementation:**

```typescript
function compareToHistoricalFallouts(
  activeLoan: any,
  historicalFallouts: any[],
): { similarityScore: number; falloutRate: number } {
  // Find historical loans with similar signal profiles
  const similarLoans = historicalFallouts.filter((hist) => {
    const signalDiff =
      Math.abs(hist.ficoScoreSignal - activeLoan.ficoScoreSignal) +
      Math.abs(hist.dtiSignal - activeLoan.dtiSignal) +
      Math.abs(
        hist.mloAeFalloutProneSignalStrength -
          activeLoan.mloAeFalloutProneSignalStrength,
      );
    return signalDiff <= 3; // Similar if total difference ≤ 3
  });

  if (similarLoans.length === 0) return { similarityScore: 0, falloutRate: 0 };

  const falloutRate =
    similarLoans.filter(
      (l) => l.actualOutcome === "withdraw" || l.actualOutcome === "deny",
    ).length / similarLoans.length;
  return { similarityScore: similarLoans.length, falloutRate };
}
```

### 4. Add Team Composition Risk Feature

**File:** `server/src/services/dashboard/predictionService.ts` (new function: `calculateTeamRisk`)

**Changes:**

- Calculate combined risk when multiple personnel have low pull-through
- Example: LO bucket 5 + UW bucket 5 = higher risk than either alone
- Add multiplicative effect for multiple weak links

**Implementation:**

```typescript
function calculateTeamRisk(loan: any): number {
  const personnelBuckets = [
    loan.mloAeFalloutProneSignalStrength,
    loan.uwPullthroughSignalStrength,
    loan.closerPullthroughSignalStrength,
    loan.processorPullthroughSignalStrength,
  ].filter((b) => b !== null && b !== undefined);

  if (personnelBuckets.length === 0) return 0;

  // Count how many personnel are in high-risk buckets (≥4)
  const highRiskCount = personnelBuckets.filter((b) => b >= 4).length;

  // Multiplicative effect: 2+ high-risk personnel = exponential risk
  if (highRiskCount >= 3) return 3; // Very high team risk
  if (highRiskCount >= 2) return 2; // High team risk
  if (highRiskCount >= 1) return 1; // Moderate team risk
  return 0; // Low team risk
}
```

### 5. Add Recent Trend Analysis

**File:** `server/src/services/dashboard/predictionService.ts` (new function: `calculateRecentTrend`)

**Changes:**

- Calculate personnel pull-through for recent loans only (last 30/60/90 days)
- Compare recent vs. overall pull-through to detect declining performance
- Add trend risk if recent performance is worse than historical average

**Implementation:**

```typescript
function calculateRecentTrend(
  personnelName: string,
  role: string,
  allLoans: any[],
  days: number = 90,
): {
  recentPullthrough: number;
  overallPullthrough: number;
  trendRisk: number;
} {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  const recentLoans = allLoans.filter((loan) => {
    const appDate = loan.applicationDate
      ? new Date(loan.applicationDate)
      : null;
    return appDate && appDate >= cutoffDate;
  });

  const recentPullthrough =
    calculatePullthroughForRole(recentLoans, [role])[personnelName] || 0;
  const overallPullthrough =
    calculatePullthroughForRole(allLoans, [role])[personnelName] || 0;

  // Trend risk: if recent is significantly worse, add risk
  const trendRisk = recentPullthrough < overallPullthrough - 10 ? 1 : 0;

  return { recentPullthrough, overallPullthrough, trendRisk };
}
```

### 6. Add Loan Stage Progression Risk

**File:** `server/src/services/dashboard/predictionService.ts` (enhance existing time-in-motion logic)

**Changes:**

- Track which stage the loan is in (Application, Processing, Underwriting, Closing)
- Compare time-in-stage vs. historical average for that stage
- Loans stuck in a stage longer than typical = higher fallout risk

**Implementation:**

```typescript
function calculateStageProgressionRisk(
  loan: any,
  historicalLoans: any[],
): number {
  const currentStage = loan.status || "Unknown";
  const daysInStage = calculateDaysInCurrentStage(loan);

  // Calculate average days in this stage from historical loans
  const avgDaysInStage =
    historicalLoans
      .filter((h) => h.status === currentStage && h.closingDate)
      .map((h) => calculateDaysInStage(h, currentStage))
      .reduce((sum, days) => sum + days, 0) / historicalLoans.length || 0;

  // Risk if significantly longer than average
  if (daysInStage > avgDaysInStage * 1.5) return 2;
  if (daysInStage > avgDaysInStage * 1.2) return 1;
  return 0;
}
```

### 7. Update Risk Score Calculation

**File:** `server/src/services/dashboard/predictionService.ts` (function: `generateRuleBasedSummary`)

**Changes:**

- Integrate all new features (team risk, historical comparison, trends, stage progression)
- Weight personnel pull-through signals more heavily (they're loan-specific)
- Use calibrated thresholds based on org historical fallout rate

**New Risk Score Formula:**

```typescript
// Base scores from existing logic
let creditRiskScore = /* existing credit risk calculation */;
let processRiskScore = /* existing process risk calculation */;

// Add team composition risk
const teamRisk = calculateTeamRisk(loan);
processRiskScore += teamRisk;

// Add historical pattern comparison
const historicalComparison = compareToHistoricalFallouts(loan, historicalFallouts);
if (historicalComparison.falloutRate > 0.5) {
  processRiskScore += 2; // High similarity to historical fallouts
}

// Add recent trend risk (if personnel declining)
// ... (integrate recent trend analysis)

// Use calibrated thresholds instead of fixed
const calibratedCreditThreshold = getCalibratedThreshold('credit', orgFalloutRate);
const calibratedProcessThreshold = getCalibratedThreshold('process', orgFalloutRate);
```

### 8. Testing & Validation

**Files:** Add test cases or validation logging

**Changes:**

- Log predictions vs. actual outcomes for validation
- Compare predicted fallout count to historical rate
- Track which features (personnel, trends, patterns) are most predictive
- A/B test calibrated vs. fixed thresholds

## Expected Outcomes

1. **Better accuracy**: Using all personnel pull-through signals (not just MLO) should improve predictions
2. **Calibrated predictions**: Thresholds match historical fallout rates (e.g., 46% org rate → predict ~46% fallout)
3. **Loan-specific insights**: Each loan's prediction based on its specific team's performance
4. **Pattern recognition**: Loans similar to historical fallouts get flagged appropriately
5. **Trend awareness**: Declining personnel performance detected and factored in

## Implementation Order

1. **Phase 1**: Enhance personnel pull-through usage (add UW, Closer, Processor to risk scores)
2. **Phase 2**: Add historical fallout rate calibration
3. **Phase 3**: Add historical pattern comparison
4. **Phase 4**: Add team composition and trend analysis features
5. **Phase 5**: Integrate all features and test/validate
