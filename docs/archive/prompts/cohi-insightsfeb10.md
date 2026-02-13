Below is a single, consolidated Technical Specification that merges your original Cohi executive-intelligence framework with the uploaded “Agentic AI CEO Daily Briefing System” document, removes redundancy, and aligns everything into one build-ready spec.

This is written so engineering, data, product, and AI teams can execute without reinterpretation.

Shape

Cohi Executive Intelligence System

Technical Specification (Merged & De-Duplicated)

CEO_AI_Briefing_Spec_JD

Shape

1. System Purpose

Cohi is an Agentic AI Executive Intelligence System for mortgage lenders.
Its sole mission is to run the company forward each day by delivering a prioritized, decision-ready briefing answering:

What is working and should be scaled

What needs attention before it becomes damage

What is critical and requires action today

What changed externally or internally

What patterns are emerging beneath daily noise

What will likely happen this month—and what levers still exist

Cohi replaces dashboards, reports, and static KPIs with a headline-driven, mobile-first executive command feed.

Shape

2. Design Principles (Unified)

2.1 Executive Attention Is the Constraint

No dashboards

No charts as primary UX

No analyst language

No “interpretation required”

Every insight must answer:
What happened → Why it matters → What to do now

2.2 Editorial, Not Analytical

Cohi behaves like an editorial desk, not a BI tool:

Detects changes

Decides what matters

Writes executive-level headlines

Pushes a curated daily edition

2.3 Deterministic First, LLM Second

Rules, thresholds, models determine what surfaces

LLM determines how it is communicated

Zero hallucination tolerance

Shape

3. High-Level Architecture

3.1 Agentic Flow (Daily 6:00 AM ET)

Data Ingestion Agent

Internal LOS, pricing, compliance, accounting

External market + regulatory feeds

Analytics & Signal Agent

KPI computation

Time-series deltas

Anomaly detection

Model inference (fallout, late close, margin risk)

Context Agent

Correlates internal performance vs market trends

Associates agency/regulatory changes to active loans

Insight Candidate Generator

Converts signals into ranked, structured findings

Narrative Agent (LLM)

Writes executive-grade headlines and understories

Prioritization Agent

Orders cards by materiality, urgency, exposure

Delivery

Mobile feed + optional push notification

Shape

4. Insight Taxonomy (Unified, Reduced to Essentials)

Cohi generates insights across 10 executive channels, grouped into four decision buckets:

Bucket A — What’s Working (Blue)

Origination momentum

Top branches & producers

Cycle-time improvements

Margin expansion

Bucket B — Needs Attention (Yellow)

Pull-through degradation

Pipeline aging

Capacity strain

Pricing competitiveness drift

Bucket C — Critical Issues (Red)

Fallout risk (deny / withdraw / late)

Lock expirations without CTC

Compliance timing exposure

Severe data defects on near-close loans

Bucket D — Context, Trends & Outlook (Neutral)

Market & rate environment

Credit & risk mix shifts

Financial performance snapshot

Regulatory & agency updates

Forecast & scenario outlook

Shape

5. Insight Candidate Object (Canonical)

Every surfaced item originates from a single normalized structure:

{

"candidate_id": "cand_10421",

"bucket": "working|attention|critical|context",

"priority": "BLUE|YELLOW|RED|GRAY",

"headline": "Pull-Through Drops 4 Points WoW — Processing Stage Driving Fallout",

"understory": "Pull-through declined from 75% to 71%, concentrated in processing. 38 loans cancelled before underwriting, primarily due to documentation delays.",

"impact": {

    "type": "revenue|compliance|operational",

    "estimated_dollars": 420000,

    "units_affected": 38,

    "severity_score": 0.82

},

"scope": {

    "channel": ["Retail"],

    "branch": ["Central Region"],

    "product": ["FHA", "Conventional"]

},

"recommended_action": {

    "owner_role": "Operations Leader",

    "action": "Reallocate processing capacity and clear stalled files",

    "urgency": "Today"

},

"evidence": {

    "metrics": ["pull_through_rate", "stage_cancellations"],

    "comparisons": ["WoW", "vs_90_day_avg"],

    "loan_ids": [...]

},

"confidence": 0.88

}

Shape

6. Prioritization Logic (Merged)

Severity score (0–1) = weighted blend of:

Financial exposure ($, bps, units)

Time sensitivity (locks, close dates, compliance timers)

Breadth (number of loans / teams affected)

Regulatory or reputational risk

Model confidence & data quality

Thresholds

RED ≥ 0.80 or hard compliance breach

YELLOW 0.55–0.79

BLUE requires positive delta + materiality

GRAY informational only

Shape

7. Data Model Mapping (Normalized)

7.1 Core Entities

Loan (fact)

Loan Milestone Event (event)

Lock & Pricing (fact)

Conditions (event)

Compliance Findings (fact)

Data Quality Issues (fact)

Forecast Snapshot (fact)

7.2 Derived Feature Views

Pipeline Health View

Fallout Risk Model (4-way: deny / withdraw / late / close)

Margin & Pricing View

Compliance Risk Timers

Credit & Risk Distribution View

7.3 Insight → Data Mapping (Example)

Insight Type

Primary Inputs

Pull-through drop

Loan status changes, stage transitions

Closing late risk

Est close vs milestone aging

Lock expiration

Lock exp date + CTC flag

Data defect alert

Field validity + QC rules

Credit shift

FICO / LTV / DTI distributions

Margin erosion

Price, concessions, execution tiers

Shape

8. Executive Briefing UI (Merged Design)

8.1 UX Pattern

Single-column, vertical feed

Mobile-first, desktop-adaptive

Headline + 2–3 sentence understory

Color-coded sentiment strip

“Go Deeper →” drill-down

8.2 Screen Structure

Header

Date

Comparison baseline (“vs yesterday”, “vs last week”)

Filters (Channel, Product, Region)

Export / Share / Ask Cohi

Executive Summary

Max 5 cards

RED first, then YELLOW, then BLUE

Scrollable Insight Feed

Grouped by bucket

Priority-ranked automatically

Forecast Module (Pinned or Bottom)

MTD funded units & volume

Projected month close with confidence band

Risk mix (% deny / withdraw / late / close)

Actionable levers with estimated impact

Shape

9. Drill-Down Experience

Each card opens a focused detail view:

Why this triggered (rule / model)

Trend sparkline (7/30/90)

Top drivers

Affected loans table

Assign owner / create task

Shape

10. LLM Prompt Guardrails

Use only provided candidate objects

Never invent metrics

Each item must include:

Metric

Comparison

Action

Max 45 words per card

Repeat items only if:

Severity changed

Scope expanded

Deadline imminent

Shape

11. Scheduling & Alerts

Daily

6:00 AM ET full briefing

Optional midday refresh

Real-Time Interrupts

Lock expiring <24h without CTC

TRID/CD timing breach

Sudden pull-through collapse

Breaking agency or regulatory change affecting live loans

Shape

12. What This System Replaces

Dashboards

Static executive reports

Daily ops calls focused on data gathering

Manual monitoring of HousingWire, OBMMI, PMMS

Post-mortem discovery of problems

Shape

13. Outcome

Cohi becomes the operating system for executive decision-making—not a reporting tool.

Executives should:

Know what matters in under 60 seconds

Never ask “compared to what?”

Never ask “so what?”

Always know what lever they can still pull
