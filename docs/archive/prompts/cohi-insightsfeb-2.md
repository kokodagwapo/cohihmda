Cohi Executive Event Trigger Framework
Technical Specification

1. Design Principles for Executive Triggers
   1.1 Trigger Philosophy

An event is triggered only when a threshold is crossed that changes business risk, revenue outcome, or compliance exposure.

Cohi does not notify on:

Normal daily variance

Minor KPI movement

Known seasonality

Non-actionable fluctuations

1.2 Trigger Qualities

Each trigger must be:

Material (financial, compliance, or operational impact)

Time-sensitive

Explainable

Actionable

Objective (no sentiment, no speculation)

2. Trigger Severity Levels
   Level  Meaning  Delivery
   CRITICAL  Immediate risk or loss likely  Push + Briefing
   IMPORTANT  Business outcome drifting  Briefing
   INFORMATIONAL  Contextual awareness  Briefing only
3. Executive Event Triggers (Curated Set)
   CATEGORY A — Revenue & Volume Integrity
   A1. Funded Volume at Risk

Severity: CRITICAL
Trigger Condition:

Projected month-end funded volume drops ≥5% below plan or

Projected funded units drop ≥7% below plan

Objective Data Provided:

Current MTD funded volume & units

Projected month-end outcome

Variance vs plan ($ and units)

Top 3 drivers (by loan count)

A2. Pull-Through Rate Degradation

Severity: IMPORTANT
Trigger Condition:

Pull-through declines ≥2.0 percentage points below trailing 90-day average

Objective Data Provided:

Current pull-through rate

90-day average

Stage where fallout occurs

Count of loans affected

CATEGORY B — Fallout & Pipeline Risk
B1. Elevated Decline Risk

Severity: CRITICAL
Trigger Condition:

% of active pipeline with high decline probability exceeds:

+25% relative increase vs prior 14-day average

Objective Data Provided:

Count of loans with elevated decline probability

Primary decline drivers (credit, income, DTI, collateral)

Stages impacted

B2. Elevated Withdrawal Risk

Severity: IMPORTANT
Trigger Condition:

Withdrawal probability increases ≥20% week-over-week

Objective Data Provided:

Loans at risk of withdrawal

Average days stalled

Borrower responsiveness metrics

Rate movement context (bps)

B3. Closing-Late Risk Threshold

Severity: CRITICAL
Trigger Condition:

Loans projected to close late exceed:

≥10% of loans scheduled to close in next 10 days

Objective Data Provided:

Count of loans at risk

Common blocking milestones

Average days late if unresolved

Lock expiration overlap (if applicable)

CATEGORY C — Lock & Pricing Exposure
C1. Lock Expiration Exposure

Severity: CRITICAL
Trigger Condition:

Locked volume expiring within 7 days without CTC exceeds:

$10M or

≥15 loans

Objective Data Provided:

Total expiring locked volume

Extension cost exposure (bps and $)

Loans without CTC

Days to expiration

C2. Margin Compression Event

Severity: IMPORTANT
Trigger Condition:

Gain-on-sale margin declines ≥8 bps MoM

Objective Data Provided:

Current margin vs prior month

Channel-level margin breakdown

Concession trends

Execution tier success rate

CATEGORY D — Operational Capacity & Efficiency
D1. Cycle Time Breach

Severity: IMPORTANT
Trigger Condition:

Median application-to-funding cycle time exceeds:

+3 days above trailing 90-day median

Objective Data Provided:

Current median cycle time

Historical benchmark

Stage(s) causing delay

Loan count affected

D2. Condition Backlog Accumulation

Severity: IMPORTANT
Trigger Condition:

Average open conditions per loan increase ≥20% WoW

Objective Data Provided:

Avg open conditions

Condition categories

Aging distribution

% tied to underwriting vs borrower

CATEGORY E — Credit & Risk Profile Shifts
E1. Credit Quality Deterioration

Severity: IMPORTANT
Trigger Condition:

Average FICO of new locks declines ≥10 points vs 60-day average

Objective Data Provided:

Current average FICO

60-day benchmark

Product mix shift

FHA / VA share change

E2. LTV / DTI Risk Accumulation

Severity: INFORMATIONAL
Trigger Condition:

% of pipeline with:

LTV ≥95% or

DTI ≥45%
increases ≥15% over 30 days

Objective Data Provided:

Risk bucket distribution

Product/channel segmentation

Impacted volume

CATEGORY F — Data Quality & Integrity
F1. Critical Data Defects Near Close

Severity: CRITICAL
Trigger Condition:

≥5 loans closing within 48 hours have high-severity data defects

Objective Data Provided:

Loan count

Defect categories

Stage of discovery

Resolution ownership

F2. Systemic Data Pattern Detected

Severity: IMPORTANT
Trigger Condition:

Same data defect appears in ≥10 loans within 24 hours

Objective Data Provided:

Defect type

Affected data field(s)

Source system

Loans impacted

CATEGORY G — Compliance & Regulatory
G1. TRID Timing Exposure

Severity: CRITICAL
Trigger Condition:

Any loan breaches TRID timing or

≥3 loans at risk of breach within next 48 hours

Objective Data Provided:

Loan IDs

Timing requirement

Days to deadline

Remediation status

G2. Agency Guideline Impact Event

Severity: IMPORTANT
Trigger Condition:

New agency or investor guideline impacts ≥5 active loans

Objective Data Provided:

Guideline reference

Effective date

Impacted loans

Affected eligibility criteria

4. Event Payload Specification (Standardized)
   {
   "event_id": "evt_20260210_004",
   "event_type": "LOCK_EXPIRATION_EXPOSURE",
   "severity": "CRITICAL",
   "detected_at": "2026-02-10T05:48:00Z",
   "summary": "18 locked loans totaling $42M expire within 7 days without CTC",
   "metrics": {
   "loan_count": 18,
   "volume": 42000000,
   "extension_cost_estimate": 126000
   },
   "thresholds": {
   "triggered_rule": "LOCK_EXPIRING_NO_CTC",
   "threshold": "$10M or 15 loans"
   },
   "scope": {
   "channel": ["Retail"],
   "product": ["Conventional", "FHA"]
   },
   "supporting_data": {
   "loan_ids": [...],
   "stage_breakdown": {...}
   }
   }

5. Delivery Rules

CRITICAL

Immediate push notification

Included in next executive briefing

IMPORTANT

Included in daily briefing

INFORMATIONAL

Briefing only

No push

6. What Is Explicitly Excluded

Cohi must not trigger on:

Minor daily KPI fluctuations

Individual LO underperformance (unless systemic)

One-off data errors

News without direct pipeline or revenue impact

Subjective interpretations or recommendations

7. Executive Value Outcome

With this trigger framework:

Senior leaders receive fewer than 5 CRITICAL events per week

No executive alert fatigue

Every alert is explainable in <30 seconds

Every alert ties to a measurable business outcome
