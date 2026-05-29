/** Rank HMDA lenders for map hover cards (state → county → tract), aligned with dashboard drilldown logic. */

export { dispositionSourceLabel } from './geo-hmda-disposition.js'

function normCountyFips(code) {
  const raw = String(code ?? '').replace(/\D/g, '')
  if (raw.length >= 5) return raw.slice(-5).padStart(5, '0')
  return raw.padStart(5, '0')
}

function findCountyRow(stRow, countyFips) {
  if (!stRow?.counties) return null
  const target = normCountyFips(countyFips)
  return (
    stRow.counties.find((c) => normCountyFips(c.countyCode || c.fips) === target) || null
  )
}

function lenderStateRow(lender, stateCode) {
  const breakdown = Array.isArray(lender.hmdaInsights?.stateBreakdown)
    ? lender.hmdaInsights.stateBreakdown
    : []
  return breakdown.find((s) => s && s.state === stateCode) || null
}

function baseLenderUnitsVolume(lender, stateCode) {
  const row = lenderStateRow(lender, stateCode)
  const stateOrig = row?.originated ?? 0
  const nationalOrig = lender.originations ?? lender.orig ?? 0
  const nationalVol = lender.dollarVol || 0
  const avgLoan = nationalOrig > 0 ? nationalVol / nationalOrig : 0
  const useState = stateOrig > 0
  const units = useState ? stateOrig : nationalOrig
  const volume = useState ? Math.round(stateOrig * avgLoan) : nationalVol
  return { units, volume, fromStateBreakdown: useState }
}

/**
 * @param {object[]} lenders
 * @param {number|string} panelYear
 * @param {{ state: string, countyFips?: string, censusTract?: string, geoDrilldownYear?: Record<string, object> }} ctx
 * @param {number} [limit=10]
 */
export function rankLendersForGeography(lenders, panelYear, ctx, limit = 10) {
  const state = ctx?.state
  if (!state || !Array.isArray(lenders) || !lenders.length) return []

  const year = Number(panelYear)
  const geoYear = ctx.geoDrilldownYear || {}
  const stRow = geoYear[state]
  const stateUnits = stRow?.units || 0

  const base = lenders
    .filter((l) => Number(l.dataYear) === year)
    .map((l) => {
      const { units, volume, fromStateBreakdown } = baseLenderUnitsVolume(l, state)
      return {
        id: l.id,
        name: l.name || 'Unknown',
        lei: String(l.lei || '').trim(),
        nmls: String(l.nmls || '').trim(),
        type: l.type || '',
        units,
        volume,
        fromStateBreakdown,
      }
    })
    .filter((l) => l.units > 0)

  let scale = 1
  let areaUnits = stateUnits
  let geoLevel = 'state'

  const countyFips = ctx.countyFips ? normCountyFips(ctx.countyFips) : null
  const censusTract = ctx.censusTract ? String(ctx.censusTract) : null

  if (countyFips && stRow) {
    const countyRow = findCountyRow(stRow, countyFips)
    const countyUnits = countyRow?.units || 0
    areaUnits = countyUnits
    geoLevel = 'county'
    scale = stateUnits > 0 ? countyUnits / stateUnits : 0

    if (censusTract && countyRow) {
      const tractRow = (countyRow.topCensusTracts || []).find(
        (t) => String(t?.censusTract || '') === censusTract,
      )
      const tractUnits = tractRow?.units || 0
      const countyVol = countyRow.volume || 0
      const tractVol = tractRow?.volume || 0
      areaUnits = tractUnits
      geoLevel = 'tract'
      const tractShare = countyUnits > 0 ? tractUnits / countyUnits : 0
      const volRatio = countyVol > 0 ? tractVol / countyVol : tractShare
      return finalizeRanked(
        base.map((l) => ({
          ...l,
          units: Math.round(l.units * scale * tractShare),
          volume: Math.round(l.volume * scale * volRatio),
        })),
        areaUnits,
        geoLevel,
        limit,
      )
    }
  }

  if (geoLevel === 'county') {
    return finalizeRanked(
      base.map((l) => ({
        ...l,
        units: Math.round(l.units * scale),
        volume: Math.round(l.volume * scale),
      })),
      areaUnits,
      geoLevel,
      limit,
    )
  }

  return finalizeRanked(base, areaUnits, geoLevel, limit)
}

function finalizeRanked(rows, areaUnits, geoLevel, limit) {
  const sorted = rows
    .filter((l) => l.units > 0)
    .sort((a, b) => b.units - a.units)
    .slice(0, limit)

  return sorted.map((l, i) => ({
    ...l,
    rank: i + 1,
    sharePct: areaUnits > 0 ? Math.round((l.units / areaUnits) * 1000) / 10 : 0,
    geoLevel,
    estimated: geoLevel !== 'state' || !l.fromStateBreakdown,
  }))
}