/**
 * Build hmdaInsights-shaped objects from FFIEC Data Browser aggregation rows.
 * @see https://ffiec.cfpb.gov/documentation/api/data-browser/
 */

const LOAN_TYPE_LABELS = {
  1: 'Conventional',
  2: 'FHA',
  3: 'VA',
  4: 'USDA',
}

export function loanTypeCodeToProducts(loanTypeSummary) {
  if (!loanTypeSummary || typeof loanTypeSummary !== 'object') return ['Conventional']
  const out = []
  for (const code of ['1', '2', '3', '4']) {
    const n = Number(loanTypeSummary[code]?.originated) || 0
    if (n > 0 && LOAN_TYPE_LABELS[code]) out.push(LOAN_TYPE_LABELS[code])
  }
  return out.length ? out : ['Conventional']
}

/** @param {Array<{ actions_taken?: string, count?: number }>} rows */
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
    originatedMedianCltv: null,
    originatedMedianDti: null,
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
      'action_taken and loan_type counts from FFIEC Data Browser API (public). Denial reason codes require MLAR row extract. Median rate spread / CLTV / DTI from streamed LAR CSV when requested and origination volume is below server cap.',
  }
}

export function mergeLoanTypeSummaryIntoInsights(base, loanTypeSummary) {
  if (!base) return base
  if (!loanTypeSummary || !Object.keys(loanTypeSummary).length) return base
  return {
    ...base,
    loanTypeSummary,
    loanTypesFromDataBrowser: true,
  }
}

export function mergeStateBreakdownIntoInsights(base, stateBreakdown) {
  if (!base || !Array.isArray(stateBreakdown) || stateBreakdown.length === 0) return base
  const totalOrig = stateBreakdown.reduce((s, r) => s + (Number(r.originated) || 0), 0)
  const top = stateBreakdown[0]
  return {
    ...base,
    stateBreakdown,
    hmdaStateCount: stateBreakdown.length,
    topStateOriginationShare:
      totalOrig > 0 && top ? Math.round(((Number(top.originated) || 0) / totalOrig) * 1000) / 1000 : null,
  }
}

export function mergeDemographicsIntoInsights(base, demographics) {
  if (!base || !demographics) return base
  const hasEth = demographics.ethnicity && Object.keys(demographics.ethnicity).length > 0
  const hasRace = demographics.race && Object.keys(demographics.race).length > 0
  const hasSex = demographics.sex && Object.keys(demographics.sex).length > 0
  if (!hasEth && !hasRace && !hasSex) return base
  return {
    ...base,
    demographicsOnOriginated: {
      ethnicity: demographics.ethnicity || {},
      race: demographics.race || {},
      sex: demographics.sex || {},
      databrowserSource: true,
      reportingYear: demographics.reportingYear ?? base.reportingYear,
    },
  }
}

export function mergeMedianPricingIntoInsights(base, medians) {
  if (!base || !medians) return base
  return {
    ...base,
    originatedMedianRateSpread: medians.originatedMedianRateSpread ?? base.originatedMedianRateSpread,
    originatedMedianLoanTermMonths: medians.originatedMedianLoanTermMonths ?? base.originatedMedianLoanTermMonths,
    originatedMedianInterestRate: medians.originatedMedianInterestRate ?? base.originatedMedianInterestRate,
    originatedMedianCltv: medians.originatedMedianCltv ?? base.originatedMedianCltv,
    originatedMedianDti: medians.originatedMedianDti ?? base.originatedMedianDti,
    spreadSampleSize: medians.spreadSampleSize ?? base.spreadSampleSize,
    termSampleSize: medians.termSampleSize ?? base.termSampleSize,
    interestRateSampleSize: medians.interestRateSampleSize ?? base.interestRateSampleSize,
    csvPricingFromDataBrowser: true,
    loanTypeSummary:
      medians.loanTypeSummary && Object.keys(medians.loanTypeSummary).length > 0
        ? { ...(base.loanTypeSummary || {}), ...medians.loanTypeSummary }
        : base.loanTypeSummary,
  }
}

export { LOAN_TYPE_LABELS }
