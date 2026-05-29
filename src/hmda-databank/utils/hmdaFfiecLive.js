/**
 * Client helpers for FFIEC HMDA Data Browser aggregate API (same public source as ffiec.cfpb.gov).
 * Live fetches go through `/api/hmda/ffiec/aggregations` (server proxy + cache) when VITE_HMDA_FFIRC_LIVE=1.
 *
 * NMLS: there is no official public REST API for bulk company facts; use NMLS Consumer Access links.
 * Federal Reserve: macro series use `/api/fred/latest-series` (FRED graph CSV via server proxy).
 */

export const FFIEC_ACTIONS_ALL = '1,2,3,4,5,6,7,8'

/** Latest year with action_taken on the FFIEC Data Browser API (updated from /api/hmda/meta). */
let ffiecLarMaxReportingYear = 2024

export function setFfiecLarMaxReportingYear(year) {
  const y = Number(year)
  if (Number.isFinite(y) && y >= 2018 && y <= 2035) ffiecLarMaxReportingYear = y
}

export function getFfiecLarMaxReportingYear() {
  return ffiecLarMaxReportingYear
}

/** Newest public LAR year available for a panel year (e.g. panel 2025 → LAR 2024 until FFIEC publishes 2025). */
export function larDetailYearForPanel(panelYear) {
  const py = Number(panelYear)
  if (!Number.isFinite(py)) return ffiecLarMaxReportingYear
  return Math.min(py, ffiecLarMaxReportingYear)
}

/** LAR disposition / loan_type insights for this row (may be a companion year below dataYear). */
export function selectHmdaInsightsForLenderRow(lender) {
  return selectHmdaInsightsForYear(lender, larDetailYearForPanel(lender?.dataYear))
}

/** True when insights carry LAR metrics for the requested HMDA reporting year. */
export function hmdaInsightsMatchesYear(h, year) {
  if (!h) return false
  const y = Number(year)
  if (!Number.isFinite(y)) return false
  const ry = Number(h.reportingYear)
  if (!Number.isFinite(ry)) return false
  return ry === y
}

/** LAR-shaped insights for a lender row only when reporting year matches (avoids showing prior-year counts on a new-year row). */
export function selectHmdaInsightsForYear(lender, year) {
  const h = lender?.hmdaInsights
  return hmdaInsightsMatchesYear(h, year) ? h : null
}

/** Official FFIEC field-reference URL for a reporting year. */
export function ffiecHmdaFieldReferenceUrl(year) {
  const y = Number(year)
  if (Number.isFinite(y) && y >= 2018 && y <= 2035) {
    return `https://ffiec.cfpb.gov/documentation/public/${y}/`
  }
  return 'https://ffiec.cfpb.gov/documentation/public/'
}

/** Build hmdaInsights-shaped disposition counts from Data Browser `aggregations` rows. */
export function buildInsightsFromFfiecAggregationRows(rows, year) {
  const actionTaken = {}
  let totalApplications = 0
  for (const r of rows || []) {
    const k = String(r.actions_taken ?? '').trim()
    if (!k) continue
    const c = Number(r.count) || 0
    actionTaken[k] = (actionTaken[k] || 0) + c
    totalApplications += c
  }
  for (const k of ['1', '2', '3', '4', '5', '6', '7', '8']) {
    if (actionTaken[k] == null) actionTaken[k] = 0
  }

  return {
    schemaVersion: 2,
    reportingYear: year,
    totalApplications,
    totalOriginated: actionTaken['1'] || 0,
    actionTaken,
    denialReasons: {},
    denialReasonsSuppressedCount: 0,
    denialCount: actionTaken['3'] || 0,
    withdrawalCount: actionTaken['4'] || 0,
    incompleteCount: actionTaken['5'] || 0,
    approvedNotAcceptedCount: actionTaken['2'] || 0,
    purchasedLoanCount: actionTaken['6'] || 0,
    originatedMedianInterestRate: null,
    originatedMedianRateSpread: null,
    originatedMedianLoanTermMonths: null,
    spreadSampleSize: 0,
    termSampleSize: 0,
    interestRateSampleSize: 0,
    geographyHhiStates: null,
    topStateOriginationShare: null,
    stateBreakdown: [],
    topCounties: [],
    topMsas: [],
    loanTypeSummary: {},
    lienOnOriginated: {},
    hoepaOnOriginated: {},
    submissionOnApplications: {},
    initiallyPayableOnApplications: {},
    quarterlyFromLar: null,
    monthlyFromLar: null,
    hasActionTakenDate: false,
    databrowserSource: true,
    csvPricingFromDataBrowser: false,
    liveFfiecClientMerged: true,
    databrowserNote:
      'action_taken counts from FFIEC Data Browser API (live proxy). Denial reason codes and rich MLAR fields still come from your deployed extract when present.',
  }
}

const LOAN_TYPE_PRODUCTS = { 1: 'Conventional', 2: 'FHA', 3: 'VA', 4: 'USDA' }

/** Products array from hmdaInsights.loanTypeSummary codes 1–4. */
export function productsFromLoanTypeSummary(loanTypeSummary) {
  if (!loanTypeSummary || typeof loanTypeSummary !== 'object') return null
  const out = []
  for (const code of ['1', '2', '3', '4']) {
    const n = Number(loanTypeSummary[code]?.originated) || 0
    if (n > 0 && LOAN_TYPE_PRODUCTS[code]) out.push(LOAN_TYPE_PRODUCTS[code])
  }
  return out.length ? out : null
}

/** Merge server `/lender-insights` payload into a lender row (keeps richer MLAR fields when present). */
export function mergeLenderInsightsIntoRow(lender, insights) {
  if (!lender || !insights || insights.error) return lender
  const lenderYear = Number(lender.dataYear)
  const insYear = Number(insights.reportingYear ?? lender.dataYear)
  const allowedLarYear = larDetailYearForPanel(lenderYear)
  if (Number.isFinite(insYear) && insYear !== allowedLarYear) {
    return lender
  }
  const base = lender.hmdaInsights || null
  const baseMatches = !base || hmdaInsightsMatchesYear(base, allowedLarYear)
  const merged =
    base && baseMatches
      ? mergeFfiecDispositionIntoBase(base, { aggregations: actionRowsFromInsights(insights) }, insYear)
      : { ...insights, reportingYear: insYear }
  const withLoanTypes =
    insights.loanTypeSummary && Object.keys(insights.loanTypeSummary).length > 0
      ? { ...merged, loanTypeSummary: { ...(merged.loanTypeSummary || {}), ...insights.loanTypeSummary } }
      : merged
  const withStates =
    Array.isArray(insights.stateBreakdown) && insights.stateBreakdown.length > 0
      ? {
          ...withLoanTypes,
          stateBreakdown: insights.stateBreakdown,
          hmdaStateCount: insights.hmdaStateCount ?? insights.stateBreakdown.length,
          topStateOriginationShare: insights.topStateOriginationShare ?? withLoanTypes.topStateOriginationShare,
        }
      : withLoanTypes
  const withMedians = {
    ...withStates,
    originatedMedianRateSpread: insights.originatedMedianRateSpread ?? withStates.originatedMedianRateSpread,
    originatedMedianCltv: insights.originatedMedianCltv ?? withStates.originatedMedianCltv,
    originatedMedianDti: insights.originatedMedianDti ?? withStates.originatedMedianDti,
    originatedMedianLoanTermMonths: insights.originatedMedianLoanTermMonths ?? withStates.originatedMedianLoanTermMonths,
    originatedMedianInterestRate: insights.originatedMedianInterestRate ?? withStates.originatedMedianInterestRate,
    spreadSampleSize: insights.spreadSampleSize ?? withStates.spreadSampleSize,
    termSampleSize: insights.termSampleSize ?? withStates.termSampleSize,
    csvPricingFromDataBrowser: insights.csvPricingFromDataBrowser || withStates.csvPricingFromDataBrowser,
    demographicsOnOriginated:
      insights.demographicsOnOriginated && Object.keys(insights.demographicsOnOriginated).length > 0
        ? insights.demographicsOnOriginated
        : withStates.demographicsOnOriginated,
  }
  const products = productsFromLoanTypeSummary(withMedians.loanTypeSummary) || lender.products
  const stateCount =
    withMedians.hmdaStateCount ??
    (Array.isArray(withMedians.stateBreakdown) ? withMedians.stateBreakdown.length : null)
  return {
    ...lender,
    hmdaInsights: withMedians,
    products,
    states: stateCount != null && stateCount > 0 ? stateCount : lender.states,
    stateList:
      Array.isArray(withMedians.stateBreakdown) && withMedians.stateBreakdown.length > 0
        ? withMedians.stateBreakdown.map((r) => r.state).filter(Boolean)
        : lender.stateList,
  }
}

function actionRowsFromInsights(h) {
  if (!h?.actionTaken) return []
  return Object.entries(h.actionTaken).map(([actions_taken, count]) => ({
    actions_taken,
    count,
  }))
}

/** Prefer existing MLAR-backed fields; overlay live disposition totals from FFIEC. */
export function mergeFfiecDispositionIntoBase(base, apiBody, year) {
  const rows = apiBody?.aggregations || []
  if (!Array.isArray(rows) || rows.length === 0) {
    return base
  }
  const live = buildInsightsFromFfiecAggregationRows(rows, year)
  if (!live) return base
  if (!base) return live
  const keepDenialReasons =
    base.denialReasons && typeof base.denialReasons === 'object' && Object.keys(base.denialReasons).length > 0
  return {
    ...base,
    totalApplications: live.totalApplications,
    totalOriginated: live.totalOriginated,
    actionTaken: live.actionTaken,
    denialCount: live.denialCount,
    withdrawalCount: live.withdrawalCount,
    incompleteCount: live.incompleteCount,
    approvedNotAcceptedCount: live.approvedNotAcceptedCount,
    purchasedLoanCount: live.purchasedLoanCount,
    reportingYear: live.reportingYear,
    liveFfiecClientMerged: true,
    denialReasons: keepDenialReasons ? base.denialReasons : live.denialReasons,
    denialReasonsSuppressedCount: base.denialReasonsSuppressedCount ?? live.denialReasonsSuppressedCount,
    databrowserNote: [base.databrowserNote, live.databrowserNote].filter(Boolean).join(' '),
  }
}

/** NMLS Consumer Access deep link (company). `raw` may include formatting; digits are extracted. */
export function nmlsConsumerAccessCompanyUrl(raw) {
  const id = String(raw || '')
    .replace(/\D/g, '')
    .trim()
  if (!id) return 'https://www.nmlsconsumeraccess.org/'
  return `https://www.nmlsconsumeraccess.org/EntityDetails.aspx/COMPANY/${id}`
}
