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
}

export const SUMMARY_REGISTRY: Record<string, SummaryMetricConfig> = {
  // Predictions
  totalAtRisk:         { label: "At Risk",          format: "number",   color: "red" },
  likelyWithdraw:      { label: "Likely Withdraw",  format: "number",   color: "amber" },
  likelyDeny:          { label: "Likely Deny",      format: "number",   color: "red" },
  avgConfidence:       { label: "Avg Confidence",   format: "percent",  color: "amber" },

  // Credit
  totalHighRisk:       { label: "High Risk Loans",  format: "number",   color: "red" },
  lowFico:             { label: "Low FICO (<620)",   format: "number",   color: "amber" },
  highLtv:             { label: "High LTV (>95%)",   format: "number",   color: "amber" },
  highDti:             { label: "High DTI (>50%)",   format: "number",   color: "amber" },

  // Lost opportunity
  totalLost:           { label: "Total Lost",        format: "number",   color: "red" },
  withdrawn:           { label: "Withdrawn",         format: "number",   color: "amber" },
  denied:              { label: "Denied",            format: "number",   color: "red" },
  estimatedLostRevenue: { label: "Lost Revenue",     format: "currency", color: "purple" },
  withdrawnVolume:     { label: "Withdrawn Volume",  format: "currency", color: "purple" },
  deniedVolume:        { label: "Denied Volume",     format: "currency", color: "purple" },

  // Pipeline
  totalActive:         { label: "Active Loans",      format: "number",   color: "blue" },
  locked:              { label: "Locked",             format: "number",   color: "green" },
  unlocked:            { label: "Unlocked",           format: "number",   color: "amber" },
  over30Days:          { label: "Over 30 Days",       format: "number",   color: "amber" },
  over45Days:          { label: "Over 45 Days",       format: "number",   color: "red" },
  avgDaysInPipeline:   { label: "Avg Days",           format: "days",     color: "blue" },

  // Volume (shared)
  totalVolume:         { label: "Volume",             format: "currency", color: "purple" },

  // Performance
  totalOfficers:       { label: "Loan Officers",      format: "number",   color: "blue" },
  totalLoans:          { label: "Total Loans",         format: "number",   color: "blue" },
  totalFunded:         { label: "Total Funded",        format: "number",   color: "green" },

  // Comparisons
  monthsAnalyzed:      { label: "Months Analyzed",     format: "number",   color: "blue" },
  currentYtdVolume:    { label: "Current YTD Vol",     format: "currency", color: "green" },
  priorYtdVolume:      { label: "Prior YTD Vol",       format: "currency", color: "blue" },
  currentYtdFunded:    { label: "Current YTD Funded",  format: "number",   color: "green" },
  priorYtdFunded:      { label: "Prior YTD Funded",    format: "number",   color: "blue" },
  ytdVolumeDelta:      { label: "YTD Vol Δ",           format: "percent",  color: "amber" },

  // Closing risk
  avgDaysToClose:      { label: "Avg Days to Close",   format: "days",     color: "amber" },

  // Lock expiration
  totalExpiring:       { label: "Locks Expiring",      format: "number",   color: "red" },
  avgDaysToExpiry:     { label: "Avg Days to Expiry",  format: "days",     color: "amber" },

  // Margin
  currentMonthBps:     { label: "Current Month",       format: "bps",      color: "blue" },
  priorMonthBps:       { label: "Prior Month",         format: "bps",      color: "blue" },
  deltaBps:            { label: "Delta",               format: "bps",      color: "amber" },

  // Condition backlog
  avgConditions:       { label: "Avg Conditions",      format: "number",   color: "blue" },

  // Cycle time (shared)
  avgCycleTime:        { label: "Avg Cycle Time",      format: "days",     color: "blue" },

  // Tiering — all-officers view
  totalActors:         { label: "Total Personnel",      format: "number",   color: "blue" },
  topCount:            { label: "Top Tier",              format: "number",   color: "green" },
  secondCount:         { label: "Second Tier",           format: "number",   color: "amber" },
  bottomCount:         { label: "Bottom Tier",           format: "number",   color: "red" },
  totalRevenue:        { label: "Total Revenue",         format: "currency", color: "purple" },

  // Tiering — officer-specific view (used when drilldown filters to named officers)
  officerUnits:        { label: "Units",                 format: "number",   color: "green" },
  officerVolume:       { label: "Volume",                format: "currency", color: "purple" },
  officerRevenue:      { label: "Revenue",               format: "currency", color: "purple" },
  officerPullThrough:  { label: "Pull-Through",          format: "percent",  color: "blue" },
  officerCycleTime:    { label: "Cycle Time",            format: "days",     color: "blue" },
  officerLost:         { label: "Lost",                  format: "number",   color: "amber" },
  officerDenied:       { label: "Denied",                format: "number",   color: "red" },
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
};
