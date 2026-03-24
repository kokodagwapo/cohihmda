COHI Backlog (Draft)

Project / board: COHI

Use real issue keys from Jira in place of COHI-XXX when tickets are created.

Bulk create via Jira API: see COHI_JIRA_IMPORT.json in this folder. Each entry is a ready-made fields payload for POST /rest/api/3/issue (Jira Cloud). The file meta.issueTypes and meta.labeling describe when to use Bug vs Task and how to filter product backlog versus QA runs. Adjust issuetype names if project COHI uses different defaults (e.g. Defect instead of Bug).

To run the bulk create from this repo: copy jira-import.env.example to jira-import.env.local in the repo root (that file is gitignored). Put JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN there. Node 20.6+: npm run jira:report to list COHI issues that already have label cohi-backlog-draft; npm run jira:import:dry-run:skip to preview what would be created without duplicating summaries; npm run jira:import runs import with --skip-existing so re-running the same JSON does not create a second copy when the summary string matches an issue already in project COHI. Use npm run jira:import:force only when you intentionally want every row POSTed again (duplicates). Script: scripts/jira-import-from-json.mjs.


BACKLOG ITEMS

COHI-XXX   Cohi Builder — homebuilder / affiliated mortgage segment (JDia POC)
           Owner: JDia
           See: Cohi Builder section below. Complements Lender profile when the tenant is a builder-affiliated lender.

COHI-XXX   Lender profile — tenant onboarding
           Owner: MC / MP
           See: Lender Profile section below.

COHI-XXX   PowerPoint — Workbench canvas builder
           Owner: MP
           See: PowerPoint / Canvas section below.

COHI-XXX   CSV uploads POC — Servicing
           Owner: JDia / MP
           See: CSV — Servicing section below.

COHI-XXX   CSV uploads POC — Compensation
           Owner: JDia / MP
           See: CSV — Compensation section below.

COHI-XXX   CSV — freeform uploads for Cohi Chat and Research Lab
           Owner: TBD
           See: CSV — Chat and Research Lab section below.

COHI-XXX   Salesforce / CRM APIs
           Owner: TBD
           See: Salesforce / CRM section below.

COHI-XXX   HMDA comparison vs Encompass; fair lending / redlining (exploration)
           Owner: JD / MP
           See: HMDA and Fair Lending section below.

COHI-XXX   Prompt saving, per-user optimization, LLM cost reuse for current data load, token and usage tracking
           Owner: CH / MP
           See: Prompt Saving section below.

COHI-XXX   Encompass Webhooks API — expand implementation; new data capabilities
           Owner: MP
           See: Webhooks section below.

COHI-XXX   Dashboard insights — partial rollout (review with Maylin); more pages follow
           Owner: CHays
           See: Dashboard Insights section below.

COHI-XXX   Enhance insights — bottlenecks; category tabs; each category has full four-bucket insight sets
           Owner: TBD
           See: Enhance Insights section below.

COHI-XXX   Data quality section on regular dashboards
           Owner: TBD
           See: Data Quality on Dashboards section below.

COHI-XXX   Mobile testing / QA
           Owner: TBD
           See: Mobile Testing section below.

COHI-XXX   Cohi refresh schedule and display; debug Coheus Classic refresh
           Owner: TBD
           See: Refresh Schedule section below.

COHI-XXX   Mark QA findings — individual issues in COHI_JIRA_IMPORT.json (umbrella + 21 children)
           Owner: TBD
           See: Mark QA Findings section below.

COHI-XXX   MCT thin app — Data Quality led; Insights, Workbench, Chat as teaser; partner / off-infra strategy
           Owner: TBD
           See: MCT Thin App and Embedded Cohi section below.


COHI BUILDER — HOMEBUILDER AND AFFILIATED MORTGAGE SEGMENT (JDIA POC)

What Cohi Builder means here

Cohi Builder is not a generic “configure your tiles” tool. It is a version of Cohi aimed at mortgage companies that sit inside or alongside production homebuilders—firms like Toll Brothers and peers in the same class (e.g. Lennar, DHI, Taylor Morrison). Those lenders care about outcomes retail banks do not optimize for first: keeping financing aligned with long construction cycles, protecting closings when the home finishes six to nine months after contract, and maximizing how many contracted buyers use the builder’s mortgage operation versus outside lenders.

Why the segment is different

Builders want influence over who provides the mortgage so money is in place when construction completes. Between contract and completion, the borrower’s qualifications, income, and market conditions can change, so the lender and builder both need visibility into loan health over time, not only at application. They also track capture rate: share of contracted buyers who use the builder’s mortgage company (numerator) versus buyers who signed purchase contracts (denominator). Capture rate is always below one; improving it is a core operating and executive metric.

How this market usually works (context for product design)

At scale, production builders often run builder-specific sales and CRM systems, construction or ERP-style platforms for lots, options, schedules, and contracts, plus a captive or preferred mortgage company on a separate LOS. The builder stack is typically the system of record for leads, communities, contracts, and incentives; the lender receives buyer and deal data downstream. Leads are centralized and routed by community, product, and source before they are handed to the lender. Preferred-lender economics—credits, design incentives, rate-buydowns, long rate-lock programs for new construction—are a normal part of steering without assuming any specific legal conclusions about tying. Loan status, lock status, material conditions, and risk flags are often pushed back into builder-facing systems so sales and construction are not blind to financing. Integrations between builder CRM or ERP and lender LOS are a recurring industry pattern; vendors in the builder software space advertise two-way or real-time mortgage status inside builder workflows.

What Cohi would offer this tenant

Cohi Builder should eventually support analytics and AI that speak this language: capture rate and funnel from contract to funded loan, fallout and condition drift during the build window, community- and source-level performance, visibility that mirrors what executives expect from combined builder plus lender data, and Research Lab or chat context tuned to new construction and affiliated-lender workflows rather than only resale retail. Concrete scope—which external systems to integrate first, which KPIs ship in v1, and how much is configuration versus custom—is what the POC proves.

Relationship to lender profile

This lines up with the lender profile and onboarding work. When a tenant identifies as builder-affiliated or captive mortgage, onboarding should capture business context that generic retail lenders do not need: relationship to the builder brand, communities or MSAs, capture-rate targets, incentive philosophy, and where their data comes from (LOS only versus partial builder-system feeds). That profile drives the same curated experience described under Lender profile—insights, chat, prompts, and RAG tuned for builder-mortgage semantics and for the integrations product intends to support.

Proof of concept

JDia leads the POC. Outcomes to document include target customer definition, minimum viable metrics and narratives, integration assumptions (which builder or mortgage platforms matter first), and whether Cohi Builder is a configuration profile inside one product, a feature-gated package, or a separate go-to-market track. Success criteria and timeline are owned by the POC lead and should be captured in Jira or Confluence under this umbrella or child issues.


LENDER PROFILE — TENANT ONBOARDING

Purpose

The lender profile is a structured onboarding experience for new tenants. During onboarding, the tenant describes their business—how they originate and operate, product mix, channels, strategic priorities, compliance posture, and other inputs we define as the process is designed. That information is not decorative; it becomes the basis for how we tune their use of Cohi so the product reflects how they actually work.

Builder-affiliated lenders

When the tenant is a mortgage operation tied to a production builder (the Cohi Builder segment), onboarding should capture that segment explicitly: affiliation with the builder, geographic or community focus, importance of capture rate and long-build financing risk, and what data they can share from builder-side systems versus the LOS alone. That path shares the same downstream behavior as other profiles—curated insights, chat, Research Lab, prompts, and knowledge center—but the questions and defaults differ. Detailed overlap with the Cohi Builder POC is described in the Cohi Builder section.

Curated application experience

Collected profile data drives a curated in-app experience. Navigation, defaults, and emphasis can align with what matters to that lender rather than a one-size-fits-all layout. The goal is faster time-to-value and fewer generic answers from AI features.

Cohi insights and chat

Insights and the Cohi chat experience should use tenant-supplied business context when generating and prioritizing content. Prompts and system behavior can reference the lender’s stated focus (for example operations vs. sales vs. credit) so narratives and suggestions stay relevant. This reduces rework for users who otherwise have to re-explain their business on every session.

Research Lab

Research Lab should inherit the same context. Investigations, follow-up questions, and summaries should assume the lender’s segment, products, and stated priorities so research output matches how the tenant describes their world, not a generic mortgage abstract.

Prompt engineering and RAG / knowledge center

Profile inputs inform how we configure prompt templates and what we emphasize in prompt engineering for that tenant. They also guide what belongs in the RAG corpus and the knowledge center: which documents to prioritize, which topics to surface first, and how retrieved material should be scoped so retrieval-augmented generation reinforces the lender’s own language and priorities.

What we still need to define

The exact questions and steps in onboarding, where profile data is stored, how it maps to configuration objects (prompts, knowledge artifacts, feature flags), and how and when profile updates trigger refreshes of chat, insights, and Research Lab behavior. Those decisions belong in product and engineering design as this item moves from backlog to delivery.


POWERPOINT — WORKBENCH CANVAS BUILDER

Objective

Resume the PowerPoint builder in Workbench canvas and align it with how canvas and dashboarding work today. Earlier work removed or simplified some PowerPoint paths from canvas to reduce maintenance; the product now needs a deliberate pass to bring export and slide-building back in sync with current widgets, layouts, data bindings, and dashboard patterns.

Scope direction

Re-enable or rebuild the canvas-to-PowerPoint flow so users can take what they see on a canvas—KPIs, charts, tables, and narrative blocks—and produce a credible deck without re-entering data. Work should account for current canvas capabilities: widget catalog, filters, and any AI-generated visuals so slides reflect the same numbers and titles the user sees in the app.

Optimization

Optimize for performance and layout fidelity (fonts, chart rendering, slide order, titles) against the current stack. Validate with real tenant-style canvases, not only demo layouts. Acceptance is product-defined but should include a short list of supported widget types and a clear path from canvas to downloadable PPTX.


CSV — SERVICING (POC)

Servicing CSV is a proof-of-concept for bringing post-origination or servicing-oriented columns and files into Cohi, scoped to what product and compliance approve for a first release. Work includes deciding the minimum file format, field mapping, how rows attach to existing loans, and where servicing metrics appear first (dashboard vs. research vs. chat context). Owners JDia and MP split discovery, pipeline, and UI as they agree.


CSV — COMPENSATION (POC)

Compensation CSV is a proof-of-concept to load compensation or cost-related inputs in a structured way so Operations and modeling views can move off placeholders. Scope includes which grain the file uses (employee, role, period), join keys back to production data, and which screens consume the loaded values first. Same owner split as servicing unless reassigned.


CSV — FREEFORM FOR COHI CHAT AND RESEARCH LAB

Objective

Add a CSV path that is not limited to LOS loan warehouse shape: users can upload a freeform or semi-structured CSV to ground Cohi Chat and Research Lab in that file for the session or for a saved project.

Behavior direction

Upload should parse headers and sample rows, let the user confirm column meanings if needed, and attach the dataset as context for questions, summaries, and follow-ups—without requiring the file to match the standard loan import schema. Product must define limits (max size, row count, retention, PII), whether the file is tenant-scoped, and whether it feeds RAG, ephemeral context only, or both.

Relationship to other CSV work

This item is separate from servicing and compensation POCs, which are about operational lending data. Freeform CSV is about ad hoc analysis and chat grounded in arbitrary tabular data the user supplies.


SALESFORCE / CRM APIS

Objective

Integrate Cohi with Salesforce or other CRM systems so CRM objects and activities can inform—or be informed by—pipeline, personnel, and engagement views in Cohi where product sees fit. There is no production CRM connector in the codebase today; this item is greenfield from a requirements and architecture standpoint.

Work direction

Start with a written integration brief: which objects, read vs. write, auth model, sync frequency, and which Cohi surfaces consume CRM data first. Engineering follows with connector design consistent with existing vendor and LOS patterns. Assign when a primary owner is named.


HMDA COMPARISON AND FAIR LENDING — EXPLORATION

Objective

Explore how Cohi should compare HMDA-related data as modeled in Cohi against source-of-record in Encompass (or the authoritative LOS), and how far the product should go toward fair lending and geographic redlining analysis versus staying analytical-only with clear legal and compliance review.

Work direction

Inventory fields and reports already in tenant schema and data quality rules, define comparison rules and discrepancy handling, and separate “data reconciliation” work from any statistical or geographic fair lending analytics, which needs partner and counsel input before scope is committed. Owners JD and MP drive discovery and technical spikes as split by the team.


PROMPT SAVING AND OPTIMIZATION PER USER

Objective

Let individual users save, reuse, and refine prompts they rely on in Cohi Chat and related AI surfaces, and over time use usage and feedback to improve relevance per user without replacing tenant-level prompt governance owned by admins.

LLM cost optimization and reuse against the current data load

Explore how answers (and intermediate reasoning or retrieved context) already produced for a tenant’s current data snapshot can be reused when users ask new questions, so we avoid redundant full generations when the underlying data and intent are unchanged or nearly the same. That may include exact or fuzzy matching on question text, semantic similarity, cache keys tied to tenant plus sync or data version, safe partial reuse of prior completions, and clear invalidation when the data load refreshes so stale answers are never served as current truth. Product and engineering must define trust rules: when reuse is automatic versus surfaced to the user as “from earlier” or “still valid after last sync,” and auditing when a cached path is taken.

Token tracking and usage tracking

Broaden how the platform records and exposes LLM usage beyond ad hoc logging: tokens in and out by call, by feature surface (chat, insights, research, voice, workbench AI, etc.), by tenant and ideally by user where policy allows, aggregated over time for cost allocation and capacity planning. Consider admin-facing or finance-facing reporting, rate visibility for tenants on consumption-based plans, alerts when usage spikes, and hooks for export to billing or FinOps. Privacy and access control must match how sensitive usage data is treated internally.

Work direction

Product defines what “saved prompt” means (text only, parameters, attached context), where it appears in the UI, retention, and the minimum viable reuse and observability behaviors for v1. Engineering adds storage, APIs, cache or similarity layer for reuse where justified, guardrails so personalization does not leak across users or break admin-approved defaults, and an expanded telemetry and reporting model for tokens and usage. Owners CH and MP split UX and platform work as agreed; cost and observability work may pull in additional backend ownership.


ENCOMPASS WEBHOOKS API — EXPAND AND NEW DATA CAPABILITIES

Objective

Extend the current Encompass webhook implementation—event intake, priority fields, queue processing, and reconciliation—so it covers the data change types the business needs now, and clarify what “new data capabilities” means: additional fields, event types, downstream triggers (sync, insights, alerts), or outbound notifications.

Work direction

Baseline is existing webhook service and scheduler in the platform. This ticket captures gap analysis against current Encompass usage, configuration UX for tenants, and prioritized engineering changes. Owner MP with LOS integration support as needed.


DASHBOARD INSIGHTS

Objective

Continue delivery of dashboard page–scoped insights: short generated callouts tied to the data and filters on performance dashboards so executives see anomalies and highlights where they browse.

Current status

Implementation is not complete across all dashboards. The first wave covers the leaderboard, loan complexity dashboard, and company scorecard dashboard. That slice was merged to dev so Maylin can review and give feedback (in review / feedback loop—not the final scope). Additional dashboard adapters and pages remain to be sequenced after product direction from that review. CHays continues to own delivery; child Jira issues per page or per milestone are preferable to one monolithic ticket once epics are in use.

Work direction

CHays leads implementation against the agreed design: which pages first, how insights refresh with data sync, and how critical items escalate to the main insights experience. After Maylin feedback, reprioritize remaining pages from docs/DASHBOARD_INSIGHTS_IMPLEMENTATION_PLAN.md or equivalent.


JIRA ORGANIZATION — EPICS AND HOW TO STRUCTURE THE BACKLOG

Epics are useful when you have many issues that share one outcome (for example “Dashboard insights — all pages” or “MCT thin app”) and you want roadmaps, progress bars, and clean filters without relying on labels alone. Tasks and Bugs stay small; the Epic is the umbrella. On Jira Cloud, create Epics in project COHI, then link Stories, Tasks, and Bugs to each Epic using your project’s Epic link field (often on issue create or bulk-edit).

A practical split for this program

Consider five to seven epics so the board is readable: (1) Dashboard and executive insights — dashboard page insights, enhance insights with category tabs, and related UX. (2) Tenant experience and segments — lender profile, Cohi Builder segment onboarding. (3) Data and integrations — CSV programs, Encompass webhooks expansion, CRM when scoped. (4) Workbench and reporting — PowerPoint canvas, distribution if tied. (5) AI platform — prompt saving, LLM reuse and token usage. (6) Quality and reliability — mobile QA, refresh visibility, Coheus Classic refresh, and QA finding batches from test runs. (7) Partner and thin app — MCT thin app and embedded deployment strategy. Adjust names to match how your team names releases.

What to keep as labels

Keep labels for cross-cutting tags: qa-run dates, client or environment, cohi-backlog-draft, and themes like dashboard-insights. Epics answer “what initiative is this for?” Labels answer “what kind of work is this?” Use both.

Bulk JSON versus Jira hierarchy

The file COHI_JIRA_IMPORT.json was generated as a flat list for API import. After import, spend one session in Jira: create Epics, drag or bulk-link existing issues into the right Epic, convert the generic dashboard insights Task into a child of the Executive insights Epic or replace it with page-level children. Going forward, create Epic first, then add issues underneath so you do not repeat the flat import cleanup.


ENHANCE INSIGHTS — BOTTLENECKS AND CATEGORIZATION

Objective

Improve insight quality by calling out process bottlenecks using pipeline and milestone timing where data supports it, and organize insights by function: operations, sales, finance, and data quality (final list is product-owned).

Information architecture

The experience is not a single flat list with a category label on each card. Users tab (or otherwise navigate) among categories. For each category we maintain a full set of insights in the same four-bucket structure Cohi insights uses today—Working, Attention, Critical, and Context—so within Operations the user sees those four sections populated only with operations-oriented items, and the same pattern repeats under Sales, Finance, and Data Quality. That mirrors the mental model users already learn on the main insights surface while giving each function its own space.

Work direction

Insight generation and storage must tag each item with category plus bucket so the UI can render per-tab four-section layouts without mixing streams incorrectly. Product defines category definitions, copy for empty states per tab, and whether critical items still escalate globally in addition to appearing under their category tab. Engineering extends the insight pipeline, metrics segmentation, and frontend shell (tabs plus four sections per tab). Depends on metrics and narrative templates the engine can supply per category. Owner TBD until a single DRI is assigned.


DATA QUALITY ON REGULAR DASHBOARDS

Objective

Make data quality visible outside the admin-only experience: a concise quality readout or section on standard dashboards so business users see freshness, completeness, or rule violations that affect the numbers in front of them.

Work direction

Reuse existing data quality rules and APIs where possible; define which dashboard surfaces get the first embed, what threshold triggers a visible warning, and how deep linking to remediation works. Owner TBD.


MOBILE TESTING AND QA

Objective

Validate core flows on mobile browsers at agreed breakpoints, fix layout and interaction issues, and align with the QA runbook for regression tagging so mobile does not rely on ad hoc checks only.

Work direction

Use defined device widths and browsers per QA policy; prioritize routes that revenue and exec users touch on phone or tablet. Owner TBD for test execution; engineering fixes per prioritized bug list.


REFRESH SCHEDULE AND DISPLAY; COHEUS CLASSIC REFRESH

Objective

Surface when Cohi data last refreshed and when the next sync is expected, at least for tenant admins and ideally where it helps trust in dashboards. In parallel, investigate and fix defects in Coheus Classic refresh behavior (legacy Qlik path) tied to tenant duplication or refresh services so demo and legacy parity issues stop recurring.

Work direction

Product defines what every user sees versus admin-only. Engineering traces refresh pipeline for Cohi and the Classic path, reproduces reported failures, and ships fixes with logging suitable for support. Owner TBD.


MARK QA FINDINGS — IMPORT AND TRACK

Objective

Take the QA document Mark provided (Word), break each finding into trackable issues in Jira under COHI, assign severity and owners, and tie fixes to regression tests per team QA policy.

Status

Source: docs/QA Coheus 2.0 Platform recovered.docx (Mark Roszko, Mar 12–13 2026, cohi-dev, Homestead Financial Mortgage). The import file COHI_JIRA_IMPORT.json now includes one umbrella Task titled [QA run] Coheus 2.0 Platform — Mark Roszko, plus twenty-one follow-on issues. Most findings are issuetype Bug; legal or parity investigations are Task. Each has labels including qa, qa-run-2026-03, qa-coheus-2-0, qa-finding (or qa-umbrella-batch on the parent), env-cohi-dev, client-homestead. After API import, link children to the umbrella or to a QA Epic if your project uses Epics.

How to organize in Jira (summary)

Use Bug for defective behavior and Task for compliance review or open investigations so dashboards and sprint hygiene stay clear. Use labels to separate product roadmap items (themed backlog) from QA batches (qa-run-YYYY-MM). Optionally add Components such as Frontend, Market Data, or Compliance when you triage. See meta.labeling.howToOrganizeInJira inside COHI_JIRA_IMPORT.json for the full list. Re-run or extend scripts/merge-qa-issues-into-jira-import.mjs only if you need to regenerate from a changed template; the script has already been applied once.


MCT THIN APP AND EMBEDDED COHI — STRATEGY AND REQUIREMENTS

Product intent for MCT clients

The thin application we want to put in front of MCT clients should lead with Data Quality: a concrete, trust-building slice of Cohi that shows clear value on LOS accuracy and governance without exposing the full platform on day one. Around that core, selectively expose Insights, Workbench, and Cohi Chat so they experience the executive and analytical depth of the product. The commercial goal is a deliberate teaser—enough capability to be credible and habit-forming, with a path that naturally leads them to want the full Cohi offering rather than stopping at the thin tier.

Broader pattern: thin app is one instance of a larger class of deployments

Thin app sits next to other integration scenarios where we deploy Cohi but the experience is not always viewed inside Teraverde infrastructure, or where Cohi must surface inside or alongside a partner’s product. Examples include customer-owned hosting, partner marketplaces, co-branded shells, or APIs and widgets that power another vendor’s UI. Those patterns share questions: where identity lives, where data is processed and stored, what the support and security boundary is, how we version features for partial SKUs, and how we prevent thin deployments from creating unbounded bespoke forks.

Strategy work required

We need a deliberate strategy before engineering commits to a single shape. Topics include packaging (named SKU versus feature flags versus separate deploy artifact), authentication and SSO when the host application is not our main web app, embedding versus deep linking versus standalone subdomain, data residency and tenant isolation when another party’s stack fronts the user, contractual and roadmap implications of partner-led distribution, and how Data Quality–first positioning stays consistent across MCT and any future thin or embedded programs.

Requirements package

Produce a signed requirements and architecture-options document for the MCT thin track: mandatory surfaces (Data Quality first), teaser surfaces (Insights, Workbench, Chat) and any limits on each, navigation and upsell paths to full Cohi, deployment targets (our cloud, customer VPC, partner frame), branding rules, and API or SDK needs if a partner product must host Cohi capabilities. No build commitment until product, engineering, and partnerships align on that document. Owner TBD; workshop with MCT stakeholders and internal platform owners.
