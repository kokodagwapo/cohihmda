import { useMemo } from 'react'

const INST_TYPE_DEFS = [
  { k: 'IMB', label: 'IMB', color: '#0033A0', match: (t) => t === 'IMB' || (!t || (t !== 'Bank' && t !== 'Credit Union' && t !== 'CU')) },
  { k: 'Bank', label: 'Depository', color: '#00A651', match: (t) => t === 'Bank' },
  { k: 'Credit Union', label: 'Credit Union', color: '#38bdf8', match: (t) => t === 'Credit Union' || t === 'CU' },
]

function lenderUnits(l) {
  return Number(l.originations ?? l.orig ?? 0) || 0
}

function lenderVolume(l) {
  return Number(l.dollarVol || 0) || 0
}

function rankValue(l, rankBy) {
  if (rankBy === 'units') return lenderUnits(l)
  if (rankBy === 'avg') {
    const u = lenderUnits(l)
    return u > 0 ? lenderVolume(l) / u : 0
  }
  return lenderVolume(l)
}

function normalizeInstKey(type) {
  if (type === 'Bank') return 'Bank'
  if (type === 'Credit Union' || type === 'CU') return 'Credit Union'
  return 'IMB'
}

/**
 * Geography tab analytics — computed only when tab is active.
 * Uses year-scoped lender slice (not full multi-year LENDERS on every pan).
 */
export function useGeographyTabAnalytics({
  tab,
  lenders,
  panelYear,
  geoLenderRankBy,
  geoTopNLimit,
  geoMapLender,
  mapLenderFocusList,
  geoStateData,
  geoSupportTypeDrill,
}) {
  return useMemo(() => {
    if (tab !== 'geography') return null

    const year = Number(panelYear)
    const geoYearLenders = (lenders || []).filter((l) => Number(l.dataYear) === year)

    let geoTotalVol = 0
    let geoTotalUnits = 0
    for (const l of geoYearLenders) {
      geoTotalVol += lenderVolume(l)
      geoTotalUnits += lenderUnits(l)
    }
    const geoLenderCount = geoYearLenders.length
    const geoAvgLoan = geoTotalUnits > 0 ? Math.round(geoTotalVol / geoTotalUnits) : 0

    const instTypeTotals = INST_TYPE_DEFS.map((def) => {
      const members = geoYearLenders.filter((l) => def.match(l.type))
      const vol = members.reduce((s, l) => s + lenderVolume(l), 0)
      return { ...def, vol, count: members.length, members }
    }).filter((t) => t.vol > 0 || t.count > 0)

    const instTotalVol = instTypeTotals.reduce((s, t) => s + t.vol, 0) || geoTotalVol
    const instTypes = instTypeTotals.map(({ k, label, color }) => ({ k, label, color }))

    const drillKey = geoSupportTypeDrill && geoSupportTypeDrill !== 'all' ? geoSupportTypeDrill : null
    const selectedTypeMeta = drillKey
      ? instTypeTotals.find((t) => t.k === drillKey) || null
      : null
    const selectedTypeMembers = selectedTypeMeta?.members || []

    let geoVisibleLenders = geoYearLenders
    if (drillKey) {
      const def = INST_TYPE_DEFS.find((d) => d.k === drillKey)
      if (def) geoVisibleLenders = geoYearLenders.filter((l) => def.match(l.type))
    }

    if (geoMapLender?.lei) {
      const lei = String(geoMapLender.lei).trim().toUpperCase()
      const focused = geoVisibleLenders.filter((l) => String(l.lei || '').trim().toUpperCase() === lei)
      if (focused.length) geoVisibleLenders = focused
    } else if (Array.isArray(mapLenderFocusList) && mapLenderFocusList.length > 0) {
      const leis = new Set(mapLenderFocusList.map((x) => String(x.lei || '').trim().toUpperCase()).filter(Boolean))
      if (leis.size) {
        geoVisibleLenders = geoVisibleLenders.filter((l) => leis.has(String(l.lei || '').trim().toUpperCase()))
      }
    }

    const geoRankVal = (l) => rankValue(l, geoLenderRankBy)

    const sorted = [...geoVisibleLenders].sort((a, b) => geoRankVal(b) - geoRankVal(a))
    const limit = Math.max(1, Number(geoTopNLimit) || 40)
    const geoTopLendersCapped = sorted.slice(0, limit)
    const geoTopMaxVal = geoTopLendersCapped.length
      ? Math.max(...geoTopLendersCapped.map((l) => geoRankVal(l)), 1)
      : 1

    const loanTypeMap = {}
    for (const l of geoYearLenders) {
      const lts = l.hmdaInsights?.loanTypeSummary
      if (!lts || typeof lts !== 'object') continue
      for (const [k, v] of Object.entries(lts)) {
        const n = typeof v === 'object' && v != null ? Number(v.originated ?? v.units ?? 0) : Number(v)
        if (n > 0) loanTypeMap[k] = (loanTypeMap[k] || 0) + n
      }
    }
    const loanTypeSorted = Object.entries(loanTypeMap).sort((a, b) => b[1] - a[1])
    const loanTypeTotal = loanTypeSorted.reduce((s, [, v]) => s + v, 0)

    const topStatesByVol = [...(geoStateData || [])]
      .filter((s) => (s.volume || 0) > 0)
      .sort((a, b) => (b.volume || 0) - (a.volume || 0))
      .slice(0, 10)

    const topStatesByUnits = [...(geoStateData || [])]
      .filter((s) => (s.loanUnits || 0) > 0)
      .sort((a, b) => (b.loanUnits || 0) - (a.loanUnits || 0))
      .slice(0, 10)

    return {
      geoYearLenders,
      geoTotalVol,
      geoTotalUnits,
      geoAvgLoan,
      geoLenderCount,
      geoVisibleLenders,
      geoRankVal,
      geoTopLendersCapped,
      geoTopMaxVal,
      instTypes,
      instTypeTotals,
      instTotalVol,
      selectedTypeMeta: selectedTypeMeta
        ? { k: selectedTypeMeta.k, label: selectedTypeMeta.label, color: selectedTypeMeta.color }
        : null,
      selectedTypeMembers,
      loanTypeSorted,
      loanTypeTotal,
      topStatesByVol,
      topStatesByUnits,
    }
  }, [
    tab,
    lenders,
    panelYear,
    geoLenderRankBy,
    geoTopNLimit,
    geoMapLender,
    mapLenderFocusList,
    geoStateData,
    geoSupportTypeDrill,
  ])
}

export { normalizeInstKey }
