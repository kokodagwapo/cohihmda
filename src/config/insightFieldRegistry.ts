/**
 * Insight Field Registry
 *
 * Single source of truth for how any field renders in the insight detail modal.
 * The LLM picks which fields to show per insight; the frontend uses this
 * registry to know how to format and display each one.
 */

// ============================================================================
// Column field config (table columns)
// ============================================================================

export type FieldFormat =
  | "text"
  | "currency"
  | "percent"
  | "number"
  | "date"
  | "rate"
  | "days"
  | "mono"
  | "badge"
  | "bps"
  | "boolean";

export interface FieldConfig {
  label: string;
  format: FieldFormat;
  align: "left" | "right" | "center";
}

export const FIELD_REGISTRY: Record<string, FieldConfig> = {
  // ---- Core loan fields ----
  loanNumber:        { label: "Loan #",        format: "mono",     align: "left" },
  loanAmount:        { label: "Amount",        format: "currency", align: "right" },
  loanType:          { label: "Type",          format: "text",     align: "left" },
  status:            { label: "Status",        format: "text",     align: "left" },
  milestone:         { label: "Milestone",     format: "text",     align: "left" },
  interestRate:      { label: "Rate",          format: "rate",     align: "right" },
  applicationDate:   { label: "App Date",      format: "date",     align: "left" },
  loanOfficer:       { label: "Loan Officer",  format: "text",     align: "left" },

  // ---- Credit ----
  ficoScore:         { label: "FICO",          format: "number",   align: "right" },
  ltv:               { label: "LTV",           format: "percent",  align: "right" },
  dti:               { label: "DTI",           format: "percent",  align: "right" },
  riskReason:        { label: "Risk Reason",   format: "badge",    align: "left" },

  // ---- Predictions ----
  predictedOutcome:  { label: "Outcome",       format: "badge",    align: "left" },
  confidence:        { label: "Confidence",    format: "percent",  align: "right" },
  reasoning:         { label: "Reasoning",     format: "text",     align: "left" },

  // ---- Pipeline ----
  daysInPipeline:    { label: "Days in Pipeline", format: "days",  align: "right" },
  lockDate:          { label: "Lock Date",     format: "date",     align: "left" },
  locked:            { label: "Locked",        format: "boolean",  align: "center" },

  // ---- Closing risk ----
  estimatedClosingDate: { label: "Est. Close",  format: "date",    align: "left" },
  ctcDate:              { label: "CTC Date",    format: "date",    align: "left" },
  daysToClose:          { label: "Days to Close", format: "days",  align: "right" },

  // ---- Lock expiration ----
  lockExpirationDate: { label: "Lock Expiry",  format: "date",     align: "left" },
  daysToExpiry:       { label: "Days Left",    format: "days",     align: "right" },
  lockDays:           { label: "Lock Days",    format: "number",   align: "right" },

  // ---- TRID ----
  closingDisclosureSentDate:     { label: "CD Sent",     format: "date", align: "left" },
  closingDisclosureReceivedDate: { label: "CD Received", format: "date", align: "left" },

  // ---- Condition backlog ----
  conditions:        { label: "Conditions",    format: "number",   align: "right" },

  // ---- Officer / performance fields ----
  name:              { label: "Name",          format: "text",     align: "left" },
  totalLoans:        { label: "Total Loans",   format: "number",   align: "right" },
  fundedLoans:       { label: "Funded",        format: "number",   align: "right" },
  pullThrough:       { label: "Pull-Through",  format: "percent",  align: "right" },
  totalVolume:       { label: "Total Volume",  format: "currency", align: "right" },
  fundedVolume:      { label: "Funded Volume", format: "currency", align: "right" },
  avgCycleTime:      { label: "Cycle Time",    format: "days",     align: "right" },

  // ---- Monthly comparison fields ----
  month:             { label: "Month",         format: "text",     align: "left" },
  loansStarted:      { label: "Started",       format: "number",   align: "right" },
  loansFunded:       { label: "Funded",        format: "number",   align: "right" },

  // ---- Product breakdown fields ----
  productType:       { label: "Product",        format: "text",     align: "left" },
  active:            { label: "Active",         format: "number",   align: "right" },
  funded:            { label: "Funded",         format: "number",   align: "right" },
  withdrawn:         { label: "Withdrawn",      format: "number",   align: "right" },
  denied:            { label: "Denied",         format: "number",   align: "right" },
  pullThroughRate:   { label: "Pull-Through %", format: "percent",  align: "right" },
  falloutRate:       { label: "Fallout %",      format: "percent",  align: "right" },
  totalCompleted:    { label: "Completed",      format: "number",   align: "right" },

  // ---- Risk cross-tab fields ----
  product:           { label: "Product",        format: "text",     align: "left" },
  ficoBand:          { label: "FICO Band",      format: "text",     align: "left" },
  dtiBand:           { label: "DTI Band",       format: "text",     align: "left" },
  total:             { label: "Total Loans",    format: "number",   align: "right" },
  fallenOut:         { label: "Fallen Out",     format: "number",   align: "right" },

  // ---- Tiering fields ----
  tier:              { label: "Tier",           format: "badge",    align: "left" },
  revenue:           { label: "Revenue",        format: "currency", align: "right" },
  units:             { label: "Units",          format: "number",   align: "right" },
  revenueBps:        { label: "Rev BPS",        format: "number",   align: "right" },
  revenuePerLoan:    { label: "Rev/Loan",       format: "currency", align: "right" },
  lostOpportunityUnits: { label: "Lost",        format: "number",   align: "right" },
  deniedUnits:       { label: "Denied",         format: "number",   align: "right" },
};

// ============================================================================
// Summary metric config (summary cards)
// ============================================================================

export interface SummaryMetricConfig {
  label: string;
  format: "number" | "currency" | "percent" | "days" | "bps";
  color: "blue" | "green" | "red" | "amber" | "purple";
  description?: string;
}

export const SUMMARY_REGISTRY: Record<string, SummaryMetricConfig> = {
  // Predictions
  totalAtRisk:         { label: "At Risk",          format: "number",   color: "red",    description: "Loans with a predicted outcome of deny or withdraw based on current data signals" },
  likelyWithdraw:      { label: "Likely Withdraw",  format: "number",   color: "amber",  description: "Loans where the borrower is likely to withdraw their application before closing" },
  likelyDeny:          { label: "Likely Deny",      format: "number",   color: "red",    description: "Loans likely to be denied based on credit, income, or collateral factors" },
  avgConfidence:       { label: "Avg Confidence",   format: "percent",  color: "amber",  description: "Average model confidence across all predictions in this cohort" },

  // Credit
  totalHighRisk:       { label: "High Risk Loans",  format: "number",   color: "red",    description: "Loans flagged for elevated credit risk (low FICO, high LTV, or high DTI)" },
  lowFico:             { label: "Low FICO (<620)",   format: "number",   color: "amber",  description: "Loans with a borrower FICO score below 620" },
  highLtv:             { label: "High LTV (>95%)",   format: "number",   color: "amber",  description: "Loans where the loan-to-value ratio exceeds 95%" },
  highDti:             { label: "High DTI (>50%)",   format: "number",   color: "amber",  description: "Loans where the borrower's debt-to-income ratio exceeds 50%" },

  // Lost opportunity
  totalLost:           { label: "Total Lost",        format: "number",   color: "red",    description: "Total loans lost to withdrawal or denial during the selected period" },
  withdrawn:           { label: "Withdrawn",         format: "number",   color: "amber",  description: "Loans where the borrower withdrew their application" },
  denied:              { label: "Denied",            format: "number",   color: "red",    description: "Loans denied by underwriting or the lender" },
  estimatedLostRevenue: { label: "Lost Revenue",     format: "currency", color: "purple", description: "Estimated revenue impact from withdrawn and denied loans" },
  withdrawnVolume:     { label: "Withdrawn Volume",  format: "currency", color: "purple", description: "Total dollar volume of withdrawn loan applications" },
  deniedVolume:        { label: "Denied Volume",     format: "currency", color: "purple", description: "Total dollar volume of denied loan applications" },

  // Pipeline
  totalActive:         { label: "Active Loans",      format: "number",   color: "blue",   description: "Loans currently in active pipeline (not yet funded, denied, or withdrawn)" },
  locked:              { label: "Locked",             format: "number",   color: "green",  description: "Loans with an active rate lock in place" },
  unlocked:            { label: "Unlocked",           format: "number",   color: "amber",  description: "Active loans that have not yet locked a rate" },
  over30Days:          { label: "Over 30 Days",       format: "number",   color: "amber",  description: "Loans that have been in pipeline for more than 30 days" },
  over45Days:          { label: "Over 45 Days",       format: "number",   color: "red",    description: "Loans that have been in pipeline for more than 45 days — may need intervention" },
  avgDaysInPipeline:   { label: "Avg Days",           format: "days",     color: "blue",   description: "Average number of business days loans have been in the active pipeline" },

  // Volume (shared)
  totalVolume:         { label: "Volume",             format: "currency", color: "purple", description: "Total dollar volume of loans in this cohort" },

  // Performance
  totalOfficers:       { label: "Loan Officers",      format: "number",   color: "blue",   description: "Number of loan officers included in this analysis" },
  totalLoans:          { label: "Total Loans",         format: "number",   color: "blue",   description: "Total number of loans originated or in pipeline" },
  totalFunded:         { label: "Total Funded",        format: "number",   color: "green",  description: "Number of loans that have successfully funded" },

  // Comparisons
  monthsAnalyzed:      { label: "Months Analyzed",     format: "number",   color: "blue",   description: "Number of months included in this comparison" },
  currentYtdVolume:    { label: "Current YTD Vol",     format: "currency", color: "green",  description: "Year-to-date funded volume for the current year" },
  priorYtdVolume:      { label: "Prior YTD Vol",       format: "currency", color: "blue",   description: "Year-to-date funded volume for the same period last year" },
  currentYtdFunded:    { label: "Current YTD Funded",  format: "number",   color: "green",  description: "Year-to-date funded loan count for the current year" },
  priorYtdFunded:      { label: "Prior YTD Funded",    format: "number",   color: "blue",   description: "Year-to-date funded loan count for the same period last year" },
  ytdVolumeDelta:      { label: "YTD Vol Δ",           format: "percent",  color: "amber",  description: "Percentage change in year-to-date volume vs. the prior year" },

  // Closing risk
  avgDaysToClose:      { label: "Avg Days to Close",   format: "days",     color: "amber",  description: "Average business days from today to estimated closing date" },

  // Lock expiration
  totalExpiring:       { label: "Locks Expiring",      format: "number",   color: "red",    description: "Number of rate locks expiring within the monitored window" },
  avgDaysToExpiry:     { label: "Avg Days to Expiry",  format: "days",     color: "amber",  description: "Average days remaining before rate locks expire" },

  // Margin
  currentMonthBps:     { label: "Current Month",       format: "bps",      color: "blue",   description: "Revenue margin for the current month in basis points" },
  priorMonthBps:       { label: "Prior Month",         format: "bps",      color: "blue",   description: "Revenue margin for the prior month in basis points" },
  deltaBps:            { label: "Delta",               format: "bps",      color: "amber",  description: "Change in revenue margin between current and prior month" },

  // Condition backlog
  avgConditions:       { label: "Avg Conditions",      format: "number",   color: "blue",   description: "Average number of outstanding conditions per loan" },

  // Cycle time (shared)
  avgCycleTime:        { label: "Avg Cycle Time",      format: "days",     color: "blue",   description: "Average business days from application to funding" },

  // Tiering — all-officers view
  totalActors:         { label: "Total Personnel",      format: "number",   color: "blue",   description: "Total number of personnel included in the tiering analysis" },
  topCount:            { label: "Top Tier",              format: "number",   color: "green",  description: "Number of personnel in the top performance tier" },
  secondCount:         { label: "Second Tier",           format: "number",   color: "amber",  description: "Number of personnel in the middle performance tier" },
  bottomCount:         { label: "Bottom Tier",           format: "number",   color: "red",    description: "Number of personnel in the lowest performance tier" },
  totalRevenue:        { label: "Total Revenue",         format: "currency", color: "purple", description: "Total revenue generated across all personnel" },

  // Product breakdown
  totalProducts:       { label: "Product Types",         format: "number",   color: "blue",   description: "Number of distinct loan product types in this analysis" },
  totalFallout:        { label: "Total Fallout",         format: "number",   color: "red",    description: "Total number of loans that fell out (withdrawn + denied)" },
  avgPullThrough:      { label: "Avg Pull-Through",      format: "percent",  color: "green",  description: "Average percentage of started loans that successfully fund" },

  // Risk cross-tab
  totalPockets:        { label: "Risk Segments",         format: "number",   color: "blue",   description: "Number of distinct risk segments identified in the cross-tab" },
  worstFalloutRate:    { label: "Worst Fallout Rate",    format: "percent",  color: "red",    description: "Highest fallout rate across all risk segments" },
  totalFallenOut:      { label: "Total Fallen Out",      format: "number",   color: "red",    description: "Total loans that fell out across all risk segments" },

  // Tiering — officer-specific view
  officerUnits:        { label: "Units",                 format: "number",   color: "green",  description: "Number of funded loan units for this officer" },
  officerVolume:       { label: "Volume",                format: "currency", color: "purple", description: "Total funded dollar volume for this officer" },
  officerRevenue:      { label: "Revenue",               format: "currency", color: "purple", description: "Total revenue generated by this officer" },
  officerPullThrough:  { label: "Pull-Through",          format: "percent",  color: "blue",   description: "Percentage of this officer's started loans that fund" },
  officerCycleTime:    { label: "Cycle Time",            format: "days",     color: "blue",   description: "Average days from application to funding for this officer" },
  officerLost:         { label: "Lost",                  format: "number",   color: "amber",  description: "Number of loans lost by this officer (withdrawn)" },
  officerDenied:       { label: "Denied",                format: "number",   color: "red",    description: "Number of loans denied for this officer" },
};

// ============================================================================
// Fallback defaults per source (backward compat for insights without detail_columns)
// ============================================================================

export const DEFAULT_COLUMNS: Record<string, string[]> = {
  predictions:       ["loanNumber", "predictedOutcome", "confidence", "loanAmount", "milestone", "interestRate", "loanOfficer"],
  credit_risk:       ["loanNumber", "riskReason", "ficoScore", "ltv", "dti", "loanAmount", "milestone", "interestRate"],
  lost_opportunity:  ["loanNumber", "status", "loanAmount", "loanType", "milestone", "interestRate", "loanOfficer"],
  pipeline:          ["loanNumber", "loanAmount", "loanType", "milestone", "interestRate", "daysInPipeline", "loanOfficer"],
  performance:       ["name", "totalLoans", "fundedLoans", "pullThrough", "fundedVolume", "avgCycleTime"],
  comparisons:       ["month", "loansStarted", "loansFunded", "pullThrough", "fundedVolume", "avgCycleTime"],
  closing_risk:      ["loanNumber", "loanAmount", "milestone", "estimatedClosingDate", "daysToClose", "ctcDate", "loanOfficer"],
  lock_expiration:   ["loanNumber", "loanAmount", "milestone", "interestRate", "lockExpirationDate", "daysToExpiry", "lockDays", "loanOfficer"],
  trid:              ["loanNumber", "loanAmount", "milestone", "estimatedClosingDate", "daysToClose", "closingDisclosureSentDate", "loanOfficer"],
  margin:            [],
  condition_backlog: ["loanNumber", "loanAmount", "conditions", "milestone", "loanType", "status", "loanOfficer"],
  tiering:           ["name", "tier", "revenue", "units", "fundedVolume", "revenueBps", "pullThrough", "avgCycleTime", "lostOpportunityUnits", "deniedUnits"],
  product_breakdown: ["productType", "active", "funded", "withdrawn", "denied", "fundedVolume", "pullThroughRate", "falloutRate"],
  risk_cross_tab:    ["product", "ficoBand", "dtiBand", "total", "funded", "fallenOut", "falloutRate"],
};

export const DEFAULT_SUMMARY_METRICS: Record<string, string[]> = {
  predictions:       ["totalAtRisk", "likelyWithdraw", "likelyDeny", "totalVolume"],
  credit_risk:       ["totalHighRisk", "lowFico", "highLtv", "highDti"],
  lost_opportunity:  ["totalLost", "withdrawn", "denied", "estimatedLostRevenue"],
  pipeline:          ["totalActive", "locked", "over30Days", "totalVolume"],
  performance:       ["totalOfficers", "totalLoans", "totalFunded", "totalVolume", "avgCycleTime"],
  comparisons:       ["currentYtdVolume", "priorYtdVolume", "ytdVolumeDelta", "currentYtdFunded", "priorYtdFunded"],
  closing_risk:      ["totalAtRisk", "totalVolume", "avgDaysToClose"],
  lock_expiration:   ["totalExpiring", "totalVolume", "avgDaysToExpiry"],
  trid:              ["totalAtRisk", "totalVolume", "avgDaysToClose"],
  margin:            ["currentMonthBps", "priorMonthBps", "deltaBps"],
  condition_backlog: ["totalLoans", "avgConditions", "totalVolume"],
  tiering:           ["totalActors", "topCount", "secondCount", "bottomCount"],
  product_breakdown: ["totalProducts", "totalActive", "totalFunded", "totalFallout", "totalVolume"],
  risk_cross_tab:    ["totalPockets", "worstFalloutRate", "totalLoans", "totalFunded", "totalFallenOut"],
};
