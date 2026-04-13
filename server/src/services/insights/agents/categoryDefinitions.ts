/**
 * Functional Category Definitions
 *
 * Single source of truth for the five functional insight categories.
 * Each category carries:
 *   - plannerSupplement: injected into the planner system prompt to scope questions
 *   - evaluatorSupplement: injected into the evaluator to apply domain-specific severity
 *   - sourceMappings: existing source values that belong to this category (used as fallback)
 *   - questionCount: how many investigation questions the planner should target
 *
 * All agent code reads from FUNCTIONAL_CATEGORIES — names/prompts iterate here, not in agent files.
 */

export interface CategoryDefinition {
  id: string;
  label: string;
  plannerSupplement: string;
  evaluatorSupplement: string;
  sourceMappings: string[];
  questionCount: { min: number; max: number };
  /** RAG search topic used to fetch relevant knowledge center chunks for this category */
  knowledgeTopic: string;
}

export const FUNCTIONAL_CATEGORIES: CategoryDefinition[] = [
  {
    id: "operations",
    label: "Operations",
    plannerSupplement: `
CATEGORY: OPERATIONS — Pipeline Velocity, Cycle Time & Operational Health

Your investigation questions MUST focus exclusively on operational efficiency and throughput topics:
- Pipeline velocity: how fast loans move through each stage (application → lock → UW → CTC → close → fund)
- Cycle time by stage: turn times, average days at each milestone, bottlenecks in the process
- Stuck/stale loans: loans that have not advanced past a milestone in abnormally long periods
- Condition backlogs: loans held at underwriting or CTC due to pending conditions
- Clear-to-close (CTC) timing: how many days between submission and CTC issuance
- Closing date misses: loans that closed late relative to expected close date
- Pipeline composition: active loan count, volume, expected close volume in 30/60/90 day windows
- Operational throughput: funded units per period, pull-through rate as an operational efficiency metric (not sales metric)
- Stage distribution: where in the pipeline loans are concentrated, and whether that distribution is healthy

DO NOT ask about loan officer performance, pricing, market rates, or compliance in this category.
Generate 8-10 questions that will surface operational bottlenecks, velocity issues, and throughput health. Cover all major pipeline stages: intake, lock, underwriting, CTC, and closing/funding.`,

    evaluatorSupplement: `
CATEGORY CONTEXT: These insights are classified under OPERATIONS — Pipeline Velocity & Operational Health.

Apply these severity definitions for this category:
- "critical" (Immediate Action Required): Operational failures directly causing funding delays or missed close dates. Examples: >20% of pipeline stuck at one stage beyond target turn time; CTC issuance delays exceeding 5 days above normal; funded volume down >25% vs prior period with identifiable process cause.
- "attention" (Monitor Closely): Concerning trends in cycle time or throughput that are not yet failures but warrant close tracking. Examples: average cycle time increasing 10-20%; growing condition backlog; declining pull-through without clear cause.
- "working" (Strategic Review): Positive operational signals worth recognizing. Examples: cycle time improving, throughput increasing, stage velocity ahead of targets.
- "context" (Informational): Portfolio composition and pipeline distribution data — helpful context but not immediately actionable.

The "source" field for operations insights should be one of: pipeline_velocity, pipeline, condition_backlog, closing_risk, trid_risk, funnel, historical.`,

    sourceMappings: [
      "pipeline_velocity",
      "pipeline",
      "condition_backlog",
      "closing_risk",
      "trid_risk",
      "trid",
      "funnel",
      "historical",
    ],
    questionCount: { min: 8, max: 10 },
    knowledgeTopic: "mortgage pipeline operations velocity cycle time throughput SLA milestones",
  },

  {
    id: "sales",
    label: "Sales",
    plannerSupplement: `
CATEGORY: SALES — Loan Officer Performance, Conversion & Revenue Growth

Your investigation questions MUST focus exclusively on sales performance and conversion topics:
- Loan officer (LO) performance: funded volume, pull-through rate, conversion by stage, fallout rate per LO
- LO rankings: top and bottom performers by volume, conversion, and cycle time
- Conversion trends: application-to-lock, lock-to-close, application-to-fund rates over time
- Lost opportunity analysis: withdrawn and denied loans by LO, product, or channel — patterns and causes
- Pull-through by channel/branch: which channels or branches are converting best vs worst
- New application volume trends: pipeline intake, application cadence, growth or decline
- LO-to-funded volume ratio: efficiency of the sales team
- Period-over-period sales performance: YTD vs prior YTD, trailing 90D vs prior 90D

DO NOT ask about pipeline velocity (operational), pricing/margins, market rates, or compliance in this category.
Generate 8-10 questions that will surface sales performance gaps, top performers, and conversion opportunities. Cover LO rankings, channel performance, conversion by stage, and period-over-period trends.`,

    evaluatorSupplement: `
CATEGORY CONTEXT: These insights are classified under SALES — Loan Officer Performance & Conversion.

Apply these severity definitions for this category:
- "critical" (Immediate Action Required): Material sales performance failures requiring same-day management action. Examples: specific LO with pull-through <30% on significant volume; branch conversion collapse (>30% decline vs prior period); high-value pipeline at risk due to poor follow-through.
- "attention" (Monitor Closely): Deteriorating sales trends or LO performance that needs coaching/intervention. Examples: LO conversion declining 15-25%; withdrawal rate increasing; new application volume declining 20%+ vs prior period.
- "working" (Strategic Review): Strong sales signals worth recognizing and replicating. Examples: top LO exceeding targets; improving conversion trend; branch outperforming peers; successful product or channel growth.
- "context" (Informational): Sales pipeline composition, product mix by LO, application volume distribution.

The "source" field for sales insights should be one of: performance, officer_performance, personnel, conversion_trends, lost_opportunity, funnel.`,

    sourceMappings: [
      "performance",
      "officer_performance",
      "personnel",
      "conversion_trends",
      "lost_opportunity",
    ],
    questionCount: { min: 8, max: 10 },
    knowledgeTopic: "loan officer performance sales conversion pull-through fallout pipeline production goals",
  },

  {
    id: "finance",
    label: "Finance",
    plannerSupplement: `
CATEGORY: FINANCE — Margin, Revenue, Lock Risk & Financial Health

Your investigation questions MUST focus exclusively on financial performance and risk topics:
- Margin/revenue: funded loan revenue, average loan size trends, revenue per funded unit
- Lock risk and expiration: locks approaching expiration, locks at above/below-market rates, potential renegotiation or cancellation cost
- Predicted fallout at risk: financial exposure from high-probability fallout loans (volume × predicted fallout rate)
- Revenue at risk: loans with fallout risk carrying significant dollar volume
- Lock-to-market rate spread: how locked rates compare to current market — borrower regret risk
- Product mix and revenue concentration: reliance on single product types, FNMA/FHLMC/FHA/VA split
- Rate sensitivity: how changes in market rates are affecting locked pipeline value
- Average loan amount trends: movement in average loan size over time

DO NOT ask about LO performance, cycle time, or compliance topics in this category.
Generate 8-10 questions that will surface financial exposure, lock risk, and revenue health. Cover revenue trends, lock expirations, fallout risk by dollar volume, product mix concentration, and rate sensitivity.`,

    evaluatorSupplement: `
CATEGORY CONTEXT: These insights are classified under FINANCE — Margin, Revenue & Lock Risk.

Apply these severity definitions for this category:
- "critical" (Immediate Action Required): Material financial exposure requiring immediate action. Examples: high-probability fallout loans with >$1M revenue at risk; significant lock expiration cluster within 7 days; locked rate spread to market indicating mass borrower regret risk.
- "attention" (Monitor Closely): Financial risks building that need tracking and mitigation planning. Examples: fallout-at-risk volume growing; lock expirations accumulating in 14-30 day window; product concentration risk.
- "working" (Strategic Review): Positive financial signals. Examples: average loan amount increasing; funded revenue ahead of prior period; favorable lock-to-market spread (borrowers well-positioned).
- "context" (Informational): Product mix distribution, average loan size, rate environment summary for the pipeline.

The "source" field for finance insights should be one of: predictions, lock_expiration, margin, revenue, tiering, product_breakdown, credit_risk, risk_cross_tab.`,

    sourceMappings: [
      "predictions",
      "lock_expiration",
      "lock_risk",
      "margin",
      "revenue",
      "tiering",
      "product_breakdown",
      "credit_risk",
      "risk_cross_tab",
    ],
    questionCount: { min: 8, max: 10 },
    knowledgeTopic: "lock risk margin revenue financial exposure fallout rate lock expiration hedging",
  },

  {
    id: "secondary_marketing",
    label: "Secondary Marketing",
    plannerSupplement: `
CATEGORY: SECONDARY MARKETING — Pricing, Product Strategy & Market Positioning

Your investigation questions MUST focus exclusively on secondary marketing and capital markets topics:
- Product mix strategy: distribution of conventional, FHA, VA, USDA, jumbo, and non-QM loans
- Rate lock behavior: lock-in timing relative to application, lock duration distribution, early vs late lock patterns
- Pricing competitiveness: how the pipeline's locked rates compare to current market rates (OBMMIC30YF or similar benchmark)
- Buy-side pricing: base price rates, SRP (service release premium), margin by product type — only analyze if fields are populated
- Pipeline composition by product type: FNMA/FHLMC eligibility, loan-to-value distribution, FICO distribution by product
- Market rate response: how quickly borrowers are locking after application — urgency signal for rate movements
- Product concentration risk: over-reliance on a single loan type or rate bracket
- Lock duration strategy: are locks being set for appropriate durations given cycle times?

DO NOT ask about LO individual performance, operational cycle times, or compliance in this category.
Generate 6-8 questions targeting secondary marketing strategy and capital markets positioning. Cover product mix, lock behavior, pricing spread, rate sensitivity, and product concentration risk.`,

    evaluatorSupplement: `
CATEGORY CONTEXT: These insights are classified under SECONDARY MARKETING — Pricing Strategy & Capital Markets.

Apply these severity definitions for this category:
- "critical" (Immediate Action Required): Acute pricing or capital markets exposure. Examples: large cluster of locks about to expire with market rates moved significantly; product type creating sellability risk; major adverse rate movement threatening pipeline value.
- "attention" (Monitor Closely): Pricing trends or product mix shifts that need secondary marketing review. Examples: growing concentration in one product/rate band; lock timing patterns suggesting suboptimal pricing; market rate drift creating spread risk.
- "working" (Strategic Review): Favorable secondary marketing signals. Examples: lock timing well-aligned with market; product mix diversifying; competitive rate positioning across the pipeline.
- "context" (Informational): Product mix distribution, lock duration distribution, rate band distribution across the pipeline.

The "source" field for secondary marketing insights should be one of: predictions, tiering, product_breakdown, market_news, comparisons.`,

    sourceMappings: [
      "market_news",
      "comparisons",
    ],
    questionCount: { min: 6, max: 8 },
    knowledgeTopic: "secondary marketing pricing product mix rate lock strategy SRP capital markets mortgage-backed securities",
  },

  {
    id: "compliance",
    label: "Compliance",
    plannerSupplement: `
CATEGORY: COMPLIANCE — Regulatory Risk, TRID, Fair Lending & Operational Compliance

Your investigation questions MUST focus exclusively on compliance and regulatory topics that CAN be answered from the available loan data.

PRIORITIZE these topics — they are reliably answerable from date/status/milestone columns:
- TRID timing: check for loans where the gap between application_date and first disclosure date is > 3 business days, or where date sequences are logically impossible (close date before lock date, etc.)
- Lock extension patterns: active loans with more than 1-2 lock extensions, or extensions totalling > 30 days — these indicate process failure or potential borrower deception
- Required milestone completion: active loans past application by 60+ days that still have no lock_date, or funded loans missing close_date or funding_date
- Condition backlog risk: loans where the gap between underwriting submission and CTC (if those dates exist) exceeds normal SLAs

LOWER PRIORITY — only include if field population stats confirm these columns are populated (>30% of active loans):
- HMDA/fair lending signals: denial rate patterns by product type that may suggest disparate impact
- Appraisal timing: loans with abnormally long or missing appraisal-to-close timelines
- Data integrity for compliance: missing required fields (loan officer name, product type, denial reasons on denied loans). NOTE: missing uw_denied_date or denial_date is NOT a data integrity issue — the platform uses current_status_date as fallback.

RULES:
- Before generating a question, mentally check: "Can this be answered from the loan date, status, and milestone columns in the schema?" If not, skip it.
- Do NOT generate questions about fields you aren't confident exist or are populated. One data-quality question is better than three that return empty results.
- If the organization's knowledge base context contains compliance guidelines, SLA definitions, or regulatory thresholds, use those specific thresholds in your questions (e.g., "loans where X exceeds the SLA defined in our policy").
- If most compliance fields are sparse, generate 1-2 focused questions on what IS available, plus one question that quantifies which compliance-critical fields are missing and what percentage of loans are affected.

Generate 6-8 compliance-focused questions.`,

    evaluatorSupplement: `
CATEGORY CONTEXT: These insights are classified under COMPLIANCE — Regulatory Risk & Fair Lending.

Apply these severity definitions for this category:
- "critical" (Immediate Action Required): Active regulatory or legal exposure requiring same-day escalation to Compliance. Examples: loans with apparent TRID violations; date sequences that are impossible or legally problematic; patterns that could trigger fair lending scrutiny.
- "attention" (Monitor Closely): Compliance risks that need review and remediation planning. Examples: loans with missing required data fields at scale; lock extension patterns indicating systemic process issues; active loans past expected close date with no documented extension.
- "working" (Strategic Review): Positive compliance signals. Examples: clean TRID timing across the portfolio; no anomalous denial patterns detected; strong data completeness on regulated fields.
- "context" (Informational): Compliance data quality summary — including which fields ARE missing and what % of loans are affected (this IS a useful context insight when specific numbers are given).

DROP RULES for compliance:
- Drop any finding that says a topic "cannot be assessed", "insufficient data", or "data not available" WITHOUT providing specific numbers on what is missing. These add no value. Exception: if the finding includes specific percentages (e.g., "HMDA ethnicity is blank on 94% of 1,117 active loans"), keep it as a single "context" insight — it is a real data quality finding.
- If multiple findings report the same type of data gap on different fields, merge them into ONE "context" insight listing all the missing fields and their population rates.
- Do NOT keep more than one "data quality" context insight per evaluation batch.

The "source" field for compliance insights should be one of: compliance, trid_risk, closing_risk, comparisons.`,

    sourceMappings: ["compliance"],
    questionCount: { min: 6, max: 8 },
    knowledgeTopic: "compliance TRID HMDA fair lending regulatory disclosure requirements RESPA Regulation B",
  },
];

/**
 * Map from known source values to functional_category.
 * Used as a fallback when the LLM omits functional_category or for insights
 * generated by the legacy pipeline that predate category tagging.
 */
export const SOURCE_TO_CATEGORY: Record<string, string> = {};

for (const cat of FUNCTIONAL_CATEGORIES) {
  for (const src of cat.sourceMappings) {
    SOURCE_TO_CATEGORY[src] = cat.id;
  }
}

export function getCategoryById(id: string): CategoryDefinition | undefined {
  return FUNCTIONAL_CATEGORIES.find((c) => c.id === id);
}
