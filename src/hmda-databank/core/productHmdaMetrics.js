import {
  selectHmdaInsightsForLenderRow,
  larDetailYearForPanel,
} from '@hmda/utils/hmdaFfiecLive.js'
import { STATE_MEDIAN_INCOME } from '@hmda/core/geography/geo-map-features.js'
import { getPanelDisposition, resolveDispositionYear } from '@hmda/core/geography/geo-hmda-disposition.js'

export const HMDA_PRODUCT_LOAN_TYPE_CODE = {
  Conventional: '1',
  FHA: '2',
  VA: '3',
  USDA: '4',
}

export const HMDA_LOAN_TYPE_LABELS = {
  1: 'Conventional',
  2: 'FHA',
  3: 'VA',
  4: 'USDA / RHS',
}

/** National HMDA-style medians when lender-level LAR fields are missing. */
export const PRODUCT_NATIONAL_BENCHMARKS = {
  Conventional: { spread: 0.28, dti: 36, cltv: 78, income: 91000 },
  FHA: { spread: 0.42, dti: 41, cltv: 96, income: 68000 },
  VA: { spread: 0.22, dti: 38, cltv: 94, income: 76000 },
  USDA: { spread: 0.38, dti: 39, cltv: 97, income: 59000 },
  'Non-QM': { spread: 1.85, dti: 43, cltv: 72, income: 118000 },
  Jumbo: { spread: 0.18, dti: 34, cltv: 68, income: 142000 },
  HELOC: { spread: 1.2, dti: 32, cltv: 58, income: 98000 },
  Construction: { spread: 0.55, dti: 37, cltv: 82, income: 88000 },
}

const US_MEDIAN_INCOME_PROXY = Math.round(
  Object.values(STATE_MEDIAN_INCOME).reduce((a, b) => a + b, 0) / Object.values(STATE_MEDIAN_INCOME).length,
)

export const PRODUCT_TYPICAL_LOAN_PURPOSES = {
  Conventional: ['Home purchase', 'Refinancing', 'Cash-out refinancing', 'Home improvement'],
  FHA: ['Home purchase', 'Refinancing', 'Streamline refi'],
  VA: ['Home purchase', 'IRRRL refinancing'],
  USDA: ['Home purchase', 'Refinancing'],
  'Non-QM': ['Investment property', 'Bank statement', 'DSCR', 'Foreign national'],
  Jumbo: ['Home purchase', 'Refinancing', 'Cash-out refinancing'],
  HELOC: ['Home improvement', 'Cash-out / line draw'],
  Construction: ['Construction-to-permanent', 'Lot + build financing'],
}

/** National HMDA loan_purpose mix by product — shares of originated units (sum ≈ 1). */
export const PRODUCT_PURPOSE_UNIT_MIX = {
  Conventional: [
    { label: 'Home purchase', share: 0.58 },
    { label: 'Refinancing', share: 0.2 },
    { label: 'Cash-out refinancing', share: 0.16 },
    { label: 'Home improvement', share: 0.06 },
  ],
  FHA: [
    { label: 'Home purchase', share: 0.72 },
    { label: 'Refinancing', share: 0.17 },
    { label: 'Streamline refi', share: 0.11 },
  ],
  VA: [
    { label: 'Home purchase', share: 0.64 },
    { label: 'IRRRL refinancing', share: 0.36 },
  ],
  USDA: [
    { label: 'Home purchase', share: 0.81 },
    { label: 'Refinancing', share: 0.19 },
  ],
  'Non-QM': [
    { label: 'Investment property', share: 0.34 },
    { label: 'Bank statement', share: 0.28 },
    { label: 'DSCR', share: 0.22 },
    { label: 'Foreign national', share: 0.16 },
  ],
  Jumbo: [
    { label: 'Home purchase', share: 0.52 },
    { label: 'Refinancing', share: 0.22 },
    { label: 'Cash-out refinancing', share: 0.26 },
  ],
  HELOC: [
    { label: 'Home improvement', share: 0.44 },
    { label: 'Cash-out / line draw', share: 0.56 },
  ],
  Construction: [
    { label: 'Construction-to-permanent', share: 0.76 },
    { label: 'Lot + build financing', share: 0.24 },
  ],
}

export function buildLoanPurposeUnits(productName, totalOriginated) {
  const mix = PRODUCT_PURPOSE_UNIT_MIX[productName]
  const total = Math.max(0, Math.round(Number(totalOriginated) || 0))
  if (!mix?.length || total <= 0) return []

  let allocated = 0
  return mix.map((row, i) => {
    const isLast = i === mix.length - 1
    const units = isLast ? Math.max(0, total - allocated) : Math.round(total * row.share)
    allocated += units
    return {
      label: row.label,
      units,
      share: row.share,
    }
  }).filter((r) => r.units > 0)
}

function loanTypeRow(h, code) {
  if (!h?.loanTypeSummary) return null
  return h.loanTypeSummary[String(code)] ?? h.loanTypeSummary[code] ?? null
}

function originatedFromRow(row) {
  if (row == null) return 0
  if (typeof row === 'number' && Number.isFinite(row)) return Math.max(0, Math.round(row))
  if (typeof row === 'object' && row.originated != null && Number.isFinite(Number(row.originated))) {
    return Math.max(0, Math.round(Number(row.originated)))
  }
  return 0
}

function sumLoanTypeOriginated14(h) {
  let sum = 0
  for (const code of ['1', '2', '3', '4']) {
    sum += originatedFromRow(loanTypeRow(h, code))
  }
  return sum
}

function toNum(v) {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function isLegacyPlaceholderRow(lender) {
  const o = Number(lender?.originations ?? lender?.units ?? 0)
  if (!Number.isFinite(o) || o < 0) return false
  const proxySites = Math.max(1, Math.floor(o / 500))
  return (
    Number(lender?.minFico) === 620 &&
    Number(lender?.maxLtv) === 97 &&
    Number(lender?.maxDti) === 50 &&
    Number(lender?.branches) === proxySites
  )
}

function resolveLenderCltv(lender, h) {
  const fromInsights = toNum(h?.originatedMedianCltv)
  if (fromInsights != null) return fromInsights
  if (!isLegacyPlaceholderRow(lender)) return toNum(lender?.maxLtv)
  return null
}

function resolveLenderDti(lender, h) {
  const fromInsights = toNum(h?.originatedMedianDti)
  if (fromInsights != null) return fromInsights
  if (!isLegacyPlaceholderRow(lender)) return toNum(lender?.maxDti)
  return null
}

function resolveLenderRateSpread(h) {
  return toNum(h?.originatedMedianRateSpread)
}

function resolveLenderMedianIncome(lender, h) {
  if (Array.isArray(h?.stateBreakdown) && h.stateBreakdown.length) {
    let sum = 0
    let w = 0
    for (const row of h.stateBreakdown) {
      const st = row?.state
      const ow = Number(row?.originated) || Number(row?.applications) || 0
      if (st && STATE_MEDIAN_INCOME[st] && ow > 0) {
        sum += STATE_MEDIAN_INCOME[st] * ow
        w += ow
      }
    }
    if (w > 0) return Math.round(sum / w)
  }

  const list = Array.isArray(lender?.stateList) ? lender.stateList : []
  const vals = list.map((st) => STATE_MEDIAN_INCOME[st]).filter(Boolean)
  if (vals.length) return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)

  const stCount = Number(lender?.states)
  if (Number.isFinite(stCount) && stCount > 0 && stCount <= 51) {
    return US_MEDIAN_INCOME_PROXY
  }

  return null
}

function resolveInsightsForLender(lender, allLenders, panelYear) {
  const direct = selectHmdaInsightsForLenderRow(lender)
  if (direct) return direct

  const lei = String(lender?.lei || '').trim().toUpperCase()
  if (!lei || !Array.isArray(allLenders) || !allLenders.length) return null

  const larYear = Number.isFinite(Number(panelYear)) ? larDetailYearForPanel(panelYear) : null
  if (larYear) {
    const larRow = allLenders.find(
      (r) =>
        String(r?.lei || '').trim().toUpperCase() === lei &&
        Number(r?.hmdaInsights?.reportingYear) === larYear,
    )
    if (larRow?.hmdaInsights) return larRow.hmdaInsights
  }

  const withMedians = allLenders.find(
    (r) =>
      String(r?.lei || '').trim().toUpperCase() === lei &&
      (r?.hmdaInsights?.originatedMedianCltv != null ||
        r?.hmdaInsights?.originatedMedianDti != null ||
        r?.hmdaInsights?.originatedMedianRateSpread != null),
  )
  if (withMedians?.hmdaInsights) return withMedians.hmdaInsights

  return allLenders.find((r) => String(r?.lei || '').trim().toUpperCase() === lei)?.hmdaInsights || null
}

function productWeight(lender, h, share) {
  if (share?.originated > 0) return share.originated
  if (share?.apps > 0) return share.apps
  const orig = Number(lender?.originations ?? h?.totalOriginated ?? 0)
  if (!Number.isFinite(orig) || orig <= 0) return 0
  const tags = Math.max(1, (lender?.products || []).length)
  return Math.round(orig / tags)
}

export function productShareForLender(lender, productName, allLenders = null, panelYear = null) {
  if (!lender?.products?.includes(productName)) return null
  const h = resolveInsightsForLender(lender, allLenders, panelYear)
  if (!h) return null

  const code = HMDA_PRODUCT_LOAN_TYPE_CODE[productName]
  if (code) {
    const row = loanTypeRow(h, code)
    const apps = Math.round(Number(row?.applications) || 0)
    const originated = originatedFromRow(row)
    if (apps > 0 || originated > 0) {
      const totalApps = Math.round(Number(h?.totalApplications) || 0)
      const totalOrig = Math.round(Number(h?.totalOriginated ?? lender?.originations) || 0)
      let resolvedApps = apps
      let exact = apps > 0
      const looksOriginatedOnly =
        resolvedApps > 0 &&
        originated > 0 &&
        resolvedApps === originated &&
        totalApps > totalOrig &&
        totalOrig > 0
      if ((resolvedApps <= 0 || looksOriginatedOnly) && originated > 0) {
        // Avoid forcing 100% pull-through when loan_type apps are missing.
        // Estimate product apps from lender-level total applications/originations.
        resolvedApps =
          totalApps > 0 && totalOrig > 0
            ? Math.max(originated, Math.round((originated * totalApps) / totalOrig))
            : originated
        exact = false
      } else if (resolvedApps > 0) {
        // Keep denominator at least as large as originated to avoid impossible >100%.
        resolvedApps = Math.max(resolvedApps, originated)
      }
      return {
        apps: resolvedApps,
        originated,
        volume: Math.round(Number(row?.dollarVolume) || 0),
        exact,
      }
    }
  }

  const totalOrig = lender.originations ?? h.totalOriginated ?? 0
  const totalApps = h.totalApplications ?? 0
  if (!Number.isFinite(totalOrig) || totalOrig <= 0 || totalApps <= 0) return null

  const extras = (lender.products || []).filter((p) => !HMDA_PRODUCT_LOAN_TYPE_CODE[p])
  let productOrig = null
  if (extras.length === 1 && extras[0] === productName) {
    productOrig = Math.max(0, Math.round(totalOrig - sumLoanTypeOriginated14(h)))
  }
  if (!productOrig || productOrig <= 0) return null

  const frac = productOrig / totalOrig
  return {
    apps: Math.round(totalApps * frac),
    originated: productOrig,
    volume: lender.dollarVol ? Math.round(lender.dollarVol * frac) : 0,
    exact: false,
  }
}

function weightedMedian(values) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a.v - b.v)
  const total = sorted.reduce((s, x) => s + x.w, 0)
  if (total <= 0) return null
  let half = total / 2
  for (const x of sorted) {
    half -= x.w
    if (half <= 0) return x.v
  }
  return sorted[sorted.length - 1].v
}

export function aggregateProductHmdaMetrics(lenders, productName, opts = {}) {
  const { allLenders = null, panelYear = null, unitsOriginated = null } = opts
  const pool = allLenders || lenders
  const members = (lenders || []).filter((l) => l.products?.includes(productName))

  let applications = 0
  let originated = 0
  let volume = 0
  let denied = 0
  let withdrawn = 0
  let incomplete = 0
  let approvedNotAccepted = 0
  let approximate = false
  let lendersWithInsights = 0

  const spreadSamples = []
  const dtiSamples = []
  const cltvSamples = []
  const incomeSamples = []

  for (const l of members) {
    const h = resolveInsightsForLender(l, pool, panelYear)
    if (!h) continue

    const share = productShareForLender(l, productName, pool, panelYear)
    const w = productWeight(l, h, share)

    if (share && (share.apps > 0 || share.originated > 0)) {
      lendersWithInsights += 1
      if (!share.exact) approximate = true

      applications += share.apps
      originated += share.originated
      volume += share.volume || 0

      const lenderApps = h.totalApplications || 0
      if (lenderApps > 0 && share.apps > 0) {
        const frac = share.apps / lenderApps
        denied += frac * (h.denialCount || 0)
        withdrawn += frac * (h.withdrawalCount || 0)
        incomplete += frac * (h.incompleteCount || 0)
        approvedNotAccepted += frac * (h.approvedNotAcceptedCount || 0)
      }
    }

    if (w <= 0) continue

    const spread = resolveLenderRateSpread(h)
    if (spread != null) spreadSamples.push({ v: spread, w })

    const dti = resolveLenderDti(l, h)
    if (dti != null) dtiSamples.push({ v: dti, w })

    const cltv = resolveLenderCltv(l, h)
    if (cltv != null) cltvSamples.push({ v: cltv, w })

    const income = resolveLenderMedianIncome(l, h)
    if (income != null) incomeSamples.push({ v: income, w })
  }

  const code = HMDA_PRODUCT_LOAN_TYPE_CODE[productName]
  const roundCount = (n) => Math.max(0, Math.round(n))

  let medianSpread = weightedMedian(spreadSamples)
  let medianDti = weightedMedian(dtiSamples)
  let medianCltv = weightedMedian(cltvSamples)
  let medianIncome = weightedMedian(incomeSamples)
  let benchmarksUsed = false

  const bench = PRODUCT_NATIONAL_BENCHMARKS[productName]
  if (bench) {
    if (medianSpread == null && bench.spread != null) {
      medianSpread = bench.spread
      benchmarksUsed = true
    }
    if (medianDti == null && bench.dti != null) {
      medianDti = bench.dti
      benchmarksUsed = true
    }
    if (medianCltv == null && bench.cltv != null) {
      medianCltv = bench.cltv
      benchmarksUsed = true
    }
    if (medianIncome == null && bench.income != null) {
      medianIncome = bench.income
      benchmarksUsed = true
    }
  }

  if (medianIncome == null && members.length > 0) {
    medianIncome = US_MEDIAN_INCOME_PROXY
    benchmarksUsed = true
  }

  const origRounded = roundCount(originated)
  const panelOrigFallback = members.reduce((s, l) => s + (Number(l.originations) || 0), 0)
  const purposeBase =
    origRounded > 0
      ? origRounded
      : Math.max(0, Math.round(Number(unitsOriginated) || 0)) || panelOrigFallback
  const loanPurposes = buildLoanPurposeUnits(productName, purposeBase)
  const purposeFromPanelOrig = origRounded <= 0 && purposeBase === panelOrigFallback && panelOrigFallback > 0

  let dispositionEstimated = false
  let dispositionYear = null
  let appsRounded = roundCount(applications)
  let deniedRounded = roundCount(denied)
  let withdrawnRounded = roundCount(withdrawn)
  let incompleteRounded = roundCount(incomplete)
  let approvedNotAcceptedRounded = roundCount(approvedNotAccepted)
  let originatedForReturn = origRounded

  const origForDisp = origRounded > 0 ? origRounded : purposeBase
  const looksAllOriginatedOnly = appsRounded > 0 && origRounded > 0 && appsRounded === origRounded
  if ((appsRounded <= 0 || looksAllOriginatedOnly) && origForDisp > 0 && pool?.length) {
    dispositionYear = resolveDispositionYear(pool, panelYear)
    const panelDisp = getPanelDisposition(pool, dispositionYear)
    const pt = panelDisp?.pullthroughRate
    if (panelDisp && pt > 0 && pt < 1) {
      const appsEst = Math.max(origForDisp, Math.round(origForDisp / pt))
      appsRounded = appsEst
      if (origRounded <= 0) originatedForReturn = origForDisp
      deniedRounded = Math.round(appsEst * (panelDisp.denialRate || 0))
      withdrawnRounded = Math.round(appsEst * (panelDisp.withdrawnRate || 0))
      incompleteRounded = Math.round(appsEst * (panelDisp.incompleteRate || 0))
      if (panelDisp.totalApplications > 0) {
        approvedNotAcceptedRounded = Math.round(
          appsEst * ((panelDisp.approvedNotAcceptedCount || 0) / panelDisp.totalApplications),
        )
      }
      dispositionEstimated = true
      approximate = true
    }
  }

  const pullthrough =
    appsRounded > 0 ? Math.round((originatedForReturn / appsRounded) * 1000) / 1000 : null

  return {
    hasData: applications > 0 || origRounded > 0 || purposeBase > 0,
    approximate,
    lendersWithInsights,
    applications: appsRounded,
    originated: originatedForReturn,
    volume: roundCount(volume),
    denied: deniedRounded,
    withdrawn: withdrawnRounded,
    incomplete: incompleteRounded,
    approvedNotAccepted: approvedNotAcceptedRounded,
    pullthrough,
    dispositionEstimated,
    dispositionYear,
    loanTypeCode: code || null,
    loanTypeLabel: code ? HMDA_LOAN_TYPE_LABELS[Number(code)] || `loan_type ${code}` : null,
    loanPurposes,
    purposeUnitsTotal: purposeBase,
    purposeFromPanelOrig,
    typicalPurposes: PRODUCT_TYPICAL_LOAN_PURPOSES[productName] || [],
    medianSpread: medianSpread != null ? Math.round(medianSpread * 100) / 100 : null,
    medianDti: medianDti != null ? Math.round(medianDti) : null,
    medianCltv: medianCltv != null ? Math.round(medianCltv) : null,
    medianIncome,
    incomeIsProxy: incomeSamples.length === 0 && medianIncome != null,
    benchmarksUsed,
  }
}

/** Sum loan_type originated units across lenders (cross-year LAR companion when panel row lacks insights). */
export function sumProductLoanTypeUnits(lenders, code, allLenders = null, panelYear = null) {
  const pool = allLenders || lenders
  let sum = 0
  let has = false
  for (const l of lenders || []) {
    const h = resolveInsightsForLender(l, pool, panelYear)
    const row = loanTypeRow(h, code)
    const n = originatedFromRow(row)
    if (n > 0) {
      has = true
      sum += n
    }
  }
  return has ? sum : null
}
