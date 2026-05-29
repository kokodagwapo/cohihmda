/**
 * Aggregate public HMDA LAR disposition rates from the loaded lender panel
 * (same action_taken counts shown in lender modals — not volume-intensity proxies).
 */

const MIN_APPS_NATIONAL = 500
const MIN_APPS_STATE = 75

function roundRate(n) {
  return Math.round(n * 10000) / 10000
}

function packRates(totals) {
  const { totalApplications, denial, withdrawal, incomplete, approvedNotAccepted, originated, lenderCount } =
    totals
  if (!(totalApplications > 0)) return null
  return {
    totalApplications: Math.round(totalApplications),
    denialCount: Math.round(denial),
    withdrawalCount: Math.round(withdrawal),
    incompleteCount: Math.round(incomplete),
    approvedNotAcceptedCount: Math.round(approvedNotAccepted),
    originatedCount: Math.round(originated),
    denialRate: roundRate(denial / totalApplications),
    withdrawnRate: roundRate(withdrawal / totalApplications),
    incompleteRate: roundRate(incomplete / totalApplications),
    pullthroughRate: roundRate(originated / totalApplications),
    falloutRate: roundRate(
      (denial + withdrawal + incomplete + approvedNotAccepted) / totalApplications,
    ),
    lenderCount,
    dispositionSource: 'hmda-panel',
  }
}

function accumulateLender(totals, h, weight = 1) {
  if (!h || !(h.totalApplications > 0) || weight <= 0) return
  totals.totalApplications += h.totalApplications * weight
  totals.denial += (h.denialCount || 0) * weight
  totals.withdrawal += (h.withdrawalCount || 0) * weight
  totals.incomplete += (h.incompleteCount || 0) * weight
  totals.approvedNotAccepted += (h.approvedNotAcceptedCount || 0) * weight
  totals.originated += (h.totalOriginated || 0) * weight
  totals.lenderCount += 1
}

function emptyTotals() {
  return {
    totalApplications: 0,
    denial: 0,
    withdrawal: 0,
    incomplete: 0,
    approvedNotAccepted: 0,
    originated: 0,
    lenderCount: 0,
  }
}

/** National panel aggregate for the reporting year. */
export function getPanelDisposition(lenders, panelYear) {
  const year = Number(panelYear)
  const totals = emptyTotals()
  for (const l of lenders || []) {
    if (Number(l.dataYear) !== year) continue
    accumulateLender(totals, l.hmdaInsights, 1)
  }
  const packed = packRates(totals)
  if (!packed || packed.totalApplications < MIN_APPS_NATIONAL) return null
  return packed
}

/** Aggregate LAR disposition for a reporting year across any lender row with matching insights (ignores dataYear filter). */
export function aggregateLarYearDispositionPool(lenders, reportingYear) {
  const year = Number(reportingYear)
  if (!Number.isFinite(year)) return null
  const totals = emptyTotals()
  for (const l of lenders || []) {
    const h = l?.hmdaInsights
    if (!h || Number(h.reportingYear) !== year || !(h.totalApplications > 0)) continue
    accumulateLender(totals, h, 1)
  }
  const packed = packRates(totals)
  if (!packed || packed.totalApplications < MIN_APPS_NATIONAL) return null
  return packed
}

/** When panelYear has no merged hmdaInsights yet, use the latest prior year with LAR counts. */
export function resolveDispositionYear(lenders, panelYear) {
  const want = Number(panelYear)
  if (getPanelDisposition(lenders, want)) return want

  const years = [
    ...new Set(
      (lenders || [])
        .map((l) => Number(l.dataYear))
        .filter((y) => Number.isFinite(y) && y >= 2000),
    ),
  ].sort((a, b) => b - a)

  const notAfter = years.filter((y) => y <= want)
  const pool = notAfter.length ? notAfter : years
  for (const y of pool) {
    if (getPanelDisposition(lenders, y)) return y
  }
  return want
}

/**
 * Per-state disposition by allocating each lender's LAR counts using
 * `hmdaInsights.stateBreakdown[].applications` weights.
 */
export function buildDispositionByState(lenders, panelYear) {
  const year = Number(panelYear)
  const byState = {}

  for (const l of lenders || []) {
    if (Number(l.dataYear) !== year) continue
    const h = l.hmdaInsights
    if (!h || !(h.totalApplications > 0)) continue

    const breakdown = Array.isArray(h.stateBreakdown) ? h.stateBreakdown : []
    if (breakdown.length) {
      for (const row of breakdown) {
        const st = row?.state
        const stateApps = Number(row?.applications) || 0
        if (!st || stateApps <= 0) continue
        if (!byState[st]) byState[st] = emptyTotals()
        const frac = stateApps / h.totalApplications
        byState[st].totalApplications += stateApps
        byState[st].denial += (h.denialCount || 0) * frac
        byState[st].withdrawal += (h.withdrawalCount || 0) * frac
        byState[st].incomplete += (h.incompleteCount || 0) * frac
        byState[st].approvedNotAccepted += (h.approvedNotAcceptedCount || 0) * frac
        byState[st].originated += Number(row?.originated) || 0
        byState[st].lenderCount += 1
      }
      continue
    }

    // Lenders without geographic breakdown still contribute to national-style fallback per state via origination share is unavailable — skip.
  }

  const out = {}
  for (const [st, totals] of Object.entries(byState)) {
    const packed = packRates(totals)
    if (packed && packed.totalApplications >= MIN_APPS_STATE) {
      out[st] = { ...packed, dispositionSource: 'hmda-state' }
    }
  }
  return out
}

/** County / tract inherit the state panel rate (geo drilldown has no county LAR dispositions). */
export function inheritStateDisposition(stateCode, dispositionByState, nationalDisposition) {
  const state = dispositionByState?.[stateCode]
  if (state) {
    return {
      denialRate: state.denialRate,
      withdrawnRate: state.withdrawnRate,
      pullthroughRate: state.pullthroughRate,
      incompleteRate: state.incompleteRate,
      falloutRate: state.falloutRate,
      dispositionSource: 'hmda-state-inherited',
    }
  }
  if (nationalDisposition) {
    return {
      denialRate: nationalDisposition.denialRate,
      withdrawnRate: nationalDisposition.withdrawnRate,
      pullthroughRate: nationalDisposition.pullthroughRate,
      incompleteRate: nationalDisposition.incompleteRate,
      falloutRate: nationalDisposition.falloutRate,
      dispositionSource: 'hmda-panel-inherited',
    }
  }
  return null
}

export function dispositionSourceLabel(source) {
  switch (source) {
    case 'hmda-panel':
      return 'HMDA LAR · panel aggregate'
    case 'hmda-state':
      return 'HMDA LAR · state panel'
    case 'hmda-state-inherited':
      return 'HMDA LAR · state panel rate'
    case 'hmda-panel-inherited':
      return 'HMDA LAR · panel rate'
    default:
      return null
  }
}
