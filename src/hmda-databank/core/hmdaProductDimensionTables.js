import {
  aggregateProductHmdaMetrics,
  buildLoanPurposeUnits,
  PRODUCT_NATIONAL_BENCHMARKS,
} from './productHmdaMetrics.js'
import { getPanelDisposition, resolveDispositionYear } from './geography/geo-hmda-disposition.js'

const LOAN_TYPE_LABELS = ['Conventional', 'FHA', 'VA', 'USDA']

const PURPOSE_ROLLUP = {
  'Home purchase': 'Purchase',
  Refinancing: 'Refinance - Rate and Term',
  'Streamline refi': 'Refinance - Rate and Term',
  'IRRRL refinancing': 'Refinance - Rate and Term',
  'Home improvement': 'Refinance - Rate and Term',
  'Cash-out refinancing': 'Refinance - Cash out',
  'Cash-out / line draw': 'Refinance - Cash out',
}

const OCCUPANCY_MIX = [
  { label: 'Primary Residence', share: 0.862 },
  { label: 'Second Home', share: 0.041 },
  { label: 'Investment', share: 0.097 },
]

const PROPERTY_TYPE_MIX = [
  { label: 'Single Residence', share: 0.684 },
  { label: 'Condo', share: 0.118 },
  { label: '2 Family', share: 0.052 },
  { label: 'PUD', share: 0.086 },
]

const LIEN_MIX = [
  { label: 'First Lien', share: 0.938 },
  { label: 'Second Lien', share: 0.062 },
]

function fmtUnits(n) {
  if (n == null || !Number.isFinite(n)) return '—'
  return Math.round(n).toLocaleString()
}

function fmtVolume(n) {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`
  return `$${Math.round(n).toLocaleString()}`
}

function fmtRate(spread) {
  if (spread == null || !Number.isFinite(spread)) return '—'
  const sign = spread >= 0 ? '+' : ''
  return `${sign}${spread.toFixed(2)}%`
}

function fmtPct(rate) {
  if (rate == null || !Number.isFinite(rate)) return '—'
  return `${(rate * 100).toFixed(1)}%`
}

function fmtCltv(v) {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${Math.round(v)}%`
}

function allocateByMix(total, mix) {
  const base = Math.max(0, Math.round(Number(total) || 0))
  if (!base || !mix?.length) return mix.map((m) => ({ label: m.label, units: 0 }))

  let allocated = 0
  return mix.map((m, i) => {
    const isLast = i === mix.length - 1
    const units = isLast ? Math.max(0, base - allocated) : Math.round(base * (m.share ?? 0))
    allocated += units
    return { label: m.label, units }
  })
}

/** Convert warehouse dimension map { bucket: share } to mix rows. */
export function warehouseMixToRows(dimensionsMap, labelMap = {}) {
  if (!dimensionsMap || typeof dimensionsMap !== 'object') return null
  const entries = Object.entries(dimensionsMap).filter(([, v]) => Number(v) > 0)
  if (!entries.length) return null
  return entries.map(([bucket, share]) => ({
    label: labelMap[bucket] || bucket,
    share: Number(share),
  }))
}

function rowMetrics({ label, units, volume, spread, pullthrough, cltv, drill = null }) {
  return {
    label,
    units,
    volume,
    rate: spread,
    pullthrough,
    cltv,
    drill,
    unitsFmt: fmtUnits(units),
    volumeFmt: fmtVolume(volume),
    rateFmt: fmtRate(spread),
    pullthroughFmt: fmtPct(pullthrough),
    cltvFmt: fmtCltv(cltv),
  }
}

const DISPOSITION_MAP_METRICS = {
  Originations: 'pullthroughRate',
  Declined: 'denialRate',
  Withdrawn: 'withdrawnRate',
  'Incomplete Application': 'units',
}

/** Drill + geography mapping for a dimension table row. */
export function getDimensionDrillConfig(tableId, rowLabel) {
  if (tableId === 'loan-type' && LOAN_TYPE_LABELS.includes(rowLabel)) {
    return {
      tableId,
      rowLabel,
      title: rowLabel,
      subtitle: `${rowLabel} · HMDA loan_type`,
      product: rowLabel,
      mapMetric: 'units',
      lenderDrill: true,
      mapDrill: true,
    }
  }

  if (tableId === 'disposition') {
    return {
      tableId,
      rowLabel,
      title: rowLabel,
      subtitle: 'HMDA disposition · panel aggregate',
      product: null,
      mapMetric: DISPOSITION_MAP_METRICS[rowLabel] || 'units',
      lenderDrill: false,
      mapDrill: true,
    }
  }

  const tableTitles = {
    'loan-purpose': 'Loan purpose',
    occupancy: 'Occupancy',
    'property-type': 'Property type',
    'lien-status': 'Lien status',
  }

  return {
    tableId,
    rowLabel,
    title: rowLabel,
    subtitle: `${tableTitles[tableId] || tableId} · national mix`,
    product: null,
    mapMetric: 'units',
    lenderDrill: false,
    mapDrill: true,
  }
}

function withDrill(tableId, row) {
  return rowMetrics({
    ...row,
    drill: getDimensionDrillConfig(tableId, row.label),
  })
}

function volumeFromUnits(units, avgLoan) {
  if (units == null || avgLoan == null) return null
  return Math.round(units * avgLoan)
}

function resolveProductMetrics(productDistribution, lenders, panelYear, productName, unitsOriginated) {
  const fromList = productDistribution?.find((p) => p.name === productName)
  if (fromList?.hmda?.hasData) return fromList.hmda

  const yearLenders = (lenders || []).filter((l) => Number(l.dataYear) === Number(panelYear))
  if (!yearLenders.length) return fromList?.hmda || null

  return aggregateProductHmdaMetrics(yearLenders, productName, {
    allLenders: lenders,
    panelYear,
    unitsOriginated,
  })
}

function panelPricing(productDistribution, lenders, panelYear) {
  let spreadSum = 0
  let cltvSum = 0
  let weight = 0

  for (const name of LOAN_TYPE_LABELS) {
    const p = productDistribution?.find((x) => x.name === name)
    const units = p?.unitsOriginated
    if (units == null || units <= 0) continue
    const hmda = resolveProductMetrics(productDistribution, lenders, panelYear, name, units)
    const bench = PRODUCT_NATIONAL_BENCHMARKS[name] || {}
    const spread = hmda?.medianSpread ?? bench.spread ?? null
    const cltv = hmda?.medianCltv ?? bench.cltv ?? null
    if (spread != null) {
      spreadSum += spread * units
      weight += units
    }
    if (cltv != null) cltvSum += cltv * units
  }

  const fallback = PRODUCT_NATIONAL_BENCHMARKS.Conventional || {}
  return {
    spread: weight > 0 ? spreadSum / weight : fallback.spread ?? null,
    cltv: weight > 0 ? cltvSum / weight : fallback.cltv ?? null,
  }
}

export function buildProductDimensionTables({ productDistribution, lenders, panelYear, warehouseDimensions = null }) {
  const year = Number(panelYear) || 2025
  const yearLenders = (lenders || []).filter((l) => Number(l.dataYear) === year)

  const loanTypeProducts = LOAN_TYPE_LABELS.map((name) => productDistribution?.find((p) => p.name === name)).filter(Boolean)
  const totalUnitsFromTypes = loanTypeProducts.reduce((s, p) => s + (Number(p.unitsOriginated) || 0), 0)
  const panelUnits = yearLenders.reduce((s, l) => s + (Number(l.originations) || 0), 0) || totalUnitsFromTypes
  const panelVolume = yearLenders.reduce((s, l) => s + (Number(l.dollarVol) || 0), 0)
  const avgLoan = panelUnits > 0 && panelVolume > 0 ? panelVolume / panelUnits : 320000

  const pricing = panelPricing(productDistribution, lenders, year)

  const dispositionYear = resolveDispositionYear(lenders, year)
  const panelDisp = getPanelDisposition(lenders, dispositionYear)

  const purposeTotals = {
    Purchase: 0,
    'Refinance - Rate and Term': 0,
    'Refinance - Cash out': 0,
  }

  for (const p of productDistribution || []) {
    const units = Number(p.unitsOriginated)
    if (!Number.isFinite(units) || units <= 0) continue
    const purposeRows = p.hmda?.loanPurposes?.length
      ? p.hmda.loanPurposes
      : buildLoanPurposeUnits(p.name, units)
    for (const row of purposeRows) {
      const bucket = PURPOSE_ROLLUP[row.label]
      if (bucket) purposeTotals[bucket] = (purposeTotals[bucket] || 0) + (row.units || 0)
    }
  }

  const loanPurposeRows = ['Purchase', 'Refinance - Rate and Term', 'Refinance - Cash out'].map((label) =>
    withDrill('loan-purpose', {
      label,
      units: purposeTotals[label] || 0,
      volume: volumeFromUnits(purposeTotals[label] || 0, avgLoan),
      spread: pricing.spread,
      pullthrough: panelDisp?.pullthroughRate ?? 0.72,
      cltv: pricing.cltv,
    }),
  )

  const loanTypeRows = LOAN_TYPE_LABELS.map((name) => {
    const p = productDistribution?.find((x) => x.name === name)
    const units = p?.unitsOriginated ?? null
    const hmda = resolveProductMetrics(productDistribution, lenders, year, name, units)
    const bench = PRODUCT_NATIONAL_BENCHMARKS[name] || {}
    const vol = hmda?.volume > 0 ? hmda.volume : volumeFromUnits(units, avgLoan)
    const apps = hmda?.applications || 0
    const originated = hmda?.originated || units || 0
    const pullthrough = apps > 0 ? originated / apps : panelDisp?.pullthroughRate ?? null
    return withDrill('loan-type', {
      label: name,
      units,
      volume: vol,
      spread: hmda?.medianSpread ?? bench.spread ?? pricing.spread,
      pullthrough,
      cltv: hmda?.medianCltv ?? bench.cltv ?? pricing.cltv,
    })
  })

  const dispositionDefs = panelDisp
    ? [
        { label: 'Originations', units: panelDisp.originatedCount, pullthrough: panelDisp.pullthroughRate },
        { label: 'Declined', units: panelDisp.denialCount, pullthrough: panelDisp.denialRate },
        { label: 'Withdrawn', units: panelDisp.withdrawalCount, pullthrough: panelDisp.withdrawnRate },
        { label: 'Incomplete Application', units: panelDisp.incompleteCount, pullthrough: panelDisp.incompleteRate },
      ]
    : [
        { label: 'Originations', units: Math.round(panelUnits * 0.72), pullthrough: 0.72 },
        { label: 'Declined', units: Math.round(panelUnits * 0.14), pullthrough: 0.14 },
        { label: 'Withdrawn', units: Math.round(panelUnits * 0.09), pullthrough: 0.09 },
        { label: 'Incomplete Application', units: Math.round(panelUnits * 0.05), pullthrough: 0.05 },
      ]

  const dispTotalApps = dispositionDefs.reduce((s, d) => s + (d.units || 0), 0) || panelUnits
  const dispositionRows = dispositionDefs.map((d) =>
    withDrill('disposition', {
      label: d.label,
      units: d.units,
      volume: dispTotalApps > 0 ? Math.round((d.units / dispTotalApps) * (panelVolume || volumeFromUnits(panelUnits, avgLoan))) : null,
      spread: pricing.spread,
      pullthrough: d.pullthrough,
      cltv: pricing.cltv,
    }),
  )

  const mixBaseUnits = totalUnitsFromTypes || panelUnits
  const occupancyMix =
    warehouseMixToRows(warehouseDimensions?.occupancy, {
      'Primary residence': 'Primary Residence',
      'Second home': 'Second Home',
      Investment: 'Investment',
    }) || OCCUPANCY_MIX
  const lienMix =
    warehouseMixToRows(warehouseDimensions?.lien_position, {
      'First lien': 'First Lien',
      'Subordinate lien': 'Second Lien',
    }) || LIEN_MIX

  const occupancyRows = allocateByMix(mixBaseUnits, occupancyMix).map((r) =>
    withDrill('occupancy', {
      label: r.label,
      units: r.units,
      volume: volumeFromUnits(r.units, avgLoan),
      spread: pricing.spread,
      pullthrough: panelDisp?.pullthroughRate ?? 0.72,
      cltv: pricing.cltv,
    }),
  )

  const propertyRows = allocateByMix(mixBaseUnits, PROPERTY_TYPE_MIX).map((r) =>
    withDrill('property-type', {
      label: r.label,
      units: r.units,
      volume: volumeFromUnits(r.units, avgLoan),
      spread: pricing.spread,
      pullthrough: panelDisp?.pullthroughRate ?? 0.72,
      cltv: pricing.cltv,
    }),
  )

  const lienRows = allocateByMix(mixBaseUnits, lienMix).map((r) =>
    withDrill('lien-status', {
      label: r.label,
      units: r.units,
      volume: volumeFromUnits(r.units, avgLoan),
      spread: pricing.spread,
      pullthrough: panelDisp?.pullthroughRate ?? 0.72,
      cltv: pricing.cltv,
    }),
  )

  return {
    meta: {
      panelYear: year,
      dispositionYear: panelDisp ? dispositionYear : null,
      totalUnits: mixBaseUnits,
      totalVolume: panelVolume || volumeFromUnits(mixBaseUnits, avgLoan),
      dispositionEstimated: !panelDisp,
      mixEstimated: !warehouseDimensions,
    },
    tables: [
      { id: 'loan-purpose', title: 'Loan Purpose', tone: 'blue', rows: loanPurposeRows },
      { id: 'occupancy', title: 'Occupancy', tone: 'green', rows: occupancyRows },
      { id: 'loan-type', title: 'Loan Type', tone: 'blue', rows: loanTypeRows },
      { id: 'property-type', title: 'Property Type', tone: 'green', rows: propertyRows },
      { id: 'disposition', title: 'HMDA Disposition', tone: 'blue', rows: dispositionRows },
      { id: 'lien-status', title: 'Lien Status', tone: 'green', rows: lienRows },
    ],
  }
}

export const PRODUCT_DIMENSION_COLUMNS = [
  { key: 'unitsFmt', label: 'Units' },
  { key: 'volumeFmt', label: '$ Volume' },
  { key: 'rateFmt', label: 'Weighted Avg Rate' },
  { key: 'pullthroughFmt', label: 'Pull-through' },
  { key: 'cltvFmt', label: 'Avg CLTV' },
]
