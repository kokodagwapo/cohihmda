What you’re asking is how to make Cohi operate like:

• A 25-year mortgage executive
• A capital markets strategist
• A chief credit officer
• A head of operations
• A data scientist
• And a disciplined communicator

— without drifting, hallucinating, or overwhelming executives.

Below is a deep BRD + PRD expansion focused on executive cognition, scaling, governance, and RAG control architecture.

PART I — How We Make Cohi Think Like a Senior Mortgage Executive

Cohi must operate from a defined “Executive Cognitive Framework.”

This is not prompt engineering.
This is institutionalizing executive judgment.

1️⃣ Define the Executive Thinking Model (ETM)

Cohi must reason in this order:

What changed?

Why did it change?

What is the business impact?

What is the risk if ignored?

What action is recommended?

Who owns it?

If Cohi does not follow this sequence — it is not executive-grade.

2️⃣ Codify Mortgage Domain Knowledge as Structured Intelligence

Instead of “knowledge documents,” create:

A. Mortgage Ontology Layer

Entities:

Loan

Borrower

Channel

Branch

Product

Lock

Condition

Guideline

Overlay

Compliance rule

Margin

Pull-through

Fallout

Turn time

Relationships:

LTV impacts risk layering

DTI + income type affects denial probability

Lock extension impacts margin

Conditions count correlates with close late

This becomes a graph-based reasoning layer.

3️⃣ Create Cohi’s “Executive Personality Guardrails”

Cohi must:

✔ Quantify everything
✔ Avoid generic AI tone
✔ Avoid speculative language
✔ Speak in business impact terms
✔ Default to materiality (>$ impact, % impact)
✔ Avoid emotional language
✔ Avoid over-alerting

Tone:
Professional. Direct. Controlled. Analytical.

PART II — Expanded BRD (Business Requirements Document)
BUSINESS OBJECTIVE

Cohi will function as an AI-powered executive operating system for mortgage lenders that:

• Analyzes LOS + enterprise data
• Identifies material risks and opportunities
• Quantifies business impact
• Provides prescriptive actions
• Scales across lenders without degradation
• Improves through structured learning

CORE EXECUTIVE USE CASES
1️⃣ Daily Executive Brief

Delivered each morning:

Sections:
• Volume & pipeline velocity
• Fallout risk movement
• Margin compression signals
• Credit layering shifts
• Operational bottlenecks
• Compliance drift
• Data quality degradation
• Emerging pattern anomalies

2️⃣ Critical Event Alerts (Only Material Events)

Triggers must meet materiality thresholds:

Examples:
• Denial rate +8% MoM AND >$5M volume impacted
• Close late rate > 20% in one channel
• Lock extensions increased > 15% week-over-week
• DTI band shift above QM threshold
• Product mix shift impacting margin > 10 bps

No minor noise.

3️⃣ Board-Ready Narrative Generator

Cohi produces:
• Executive summary slides
• Quantified risk narrative
• Action plan tracking

SCALABILITY REQUIREMENTS

• Multi-tenant architecture
• Segmented model training per lender
• Shared feature framework
• Tenant-specific overlay and policy embeddings
• Model monitoring per tenant
• Auto scaling inference
• Governance logs per insight

LEARNING REQUIREMENTS

Cohi must learn through:

Executive feedback tagging

Outcome-based retraining

Drift detection

Overlay updates

Agency update ingestion

Competitive market changes

PART III — Expanded PRD (Product Requirements Document)
1️⃣ COGNITIVE STACK ARCHITECTURE

Layer 1 — Data Intelligence
Layer 2 — Predictive Models
Layer 3 — Executive Judgment Rules
Layer 4 — RAG Policy Control
Layer 5 — Narrative Engine
Layer 6 — Governance & Monitoring

2️⃣ EXECUTIVE INSIGHT ENGINE DESIGN

Each insight must follow this JSON structure:

{
“category”: “Credit Risk”,
“materiality_score”: 0-100,
“what_changed”: “…”
“drivers”: [list]
“historical_comparison”: “…”
“financial_impact”: “$”
“risk_level”: “Low/Moderate/High”
“recommended_action”: “...”
“owner”: “Capital Markets”
“confidence_score”: 0-100
}

This enforces structure and control.

3️⃣ CRITICAL CONTROL ELEMENTS

To prevent Cohi from drifting:

A. Topic Confinement

Cohi only responds within:
• Mortgage operations
• Credit risk
• Capital markets
• Compliance
• Data governance
• Performance analytics

No external general AI commentary.

B. Evidence Binding

Every numeric statement must map to:
• Query ID
• Model version
• Dataset timestamp

No unsupported statements allowed.

C. Materiality Thresholds

Insights below defined materiality:
→ Not surfaced
→ Logged internally

D. Drift Control

Monitor:
• Feature drift
• Prediction drift
• Narrative drift

If narrative tone deviates:
→ Flag for calibration

PART IV — Leveraging RAG for Control WITHOUT Limiting Learning

This is critical.

Most people misuse RAG as static knowledge injection.

For Cohi, RAG must serve 4 purposes:

1️⃣ Policy Grounding

Embed:
• Agency guidelines
• Lender overlays
• Compliance manuals
• Historical board memos
• SOP documents

Cohi cannot override these.

2️⃣ Contextual Grounding

Before generating insight:
Retrieve:
• Relevant KPI queries
• Historical baseline
• Segment definitions
• Policy thresholds

Generation must cite retrieved chunks.

3️⃣ Constraint Injection

Instead of “answer freely,” system prompt enforces:

“If requested output is not supported by retrieved evidence, state insufficient evidence.”

4️⃣ Dynamic Learning Without Freeform Drift

Learning occurs in:

• Feature updates
• Model retraining
• Feedback signals
• Policy updates

NOT in unrestricted language drift.

RAG CONTROL ARCHITECTURE

Retriever Layers:

Mortgage Ontology Retriever

Policy Retriever

Tenant Overlay Retriever

KPI Historical Retriever

Executive Preference Retriever

Each has priority weighting.

Generation pipeline:

Query → Retrieval → Evidence Scoring → Structured Draft → Rule Validation → Output

PART V — Making Cohi Both Data Scientist AND Executive

Cohi must operate in two modes:

Executive Mode

• High-level
• Quantified
• Focused
• Action-oriented

Analyst Mode

• Drill-down
• Feature importance
• SHAP explanation
• Data visualizations
• Query references

Toggle-based.

PART VI — Visualization Strategy

Senior executives do not want dashboards with 40 charts.

Cohi should generate:

• 5 KPI tiles
• 3 risk movement charts
• 2 driver decomposition visuals
• 1 forward projection band

All minimal, clean, modern fintech style.

No clutter.

PART VII — Rapid Scaling Architecture

To scale Cohi across lenders:

• Central feature framework
• Tenant-specific data marts
• Shared model templates
• Policy embedding isolation
• Federated learning optional layer
• Horizontal scaling inference API
• Model registry per tenant

PART VIII — How Cohi Stays on Topic

You must enforce:

Strict domain ontology

Evidence-backed generation

Structured JSON outputs

Confidence scoring

Materiality filtering

Alert throttling

Human override layer

No creative language

Executive vocabulary constraint

Continuous calibration loop

Final Strategic Insight

Cohi does not need to be creative.

It needs to be:

• Disciplined
• Quantitative
• Grounded
• Controlled
• Strategic
• Material

The power of Cohi will not come from bigger models.

It will come from:

Structured mortgage intelligence

Controlled RAG

Executive reasoning discipline

Continuous learning feedback loops

Tight governance
