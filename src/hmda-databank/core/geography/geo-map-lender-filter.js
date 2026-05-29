/**
 * Map geography filtered to one HMDA reporter (LEI).
 * State totals: FFIEC Data Browser (official). Tract dots: market HMDA tract
 * counts × lender share of state originated volume (estimate when tract-level LEI data unavailable).
 */

/** @param {string} q */
/** @param {object[]} lenders */
/** @param {number|string} year */
export function resolveMapLenderFromSearch(q, lenders, year) {
  const term = String(q || '').trim().toLowerCase()
  if (!term || term.length < 2) return null
  const yearNum = Number(year) || 2024
  const pool = (lenders || []).filter((l) => Number(l.dataYear) === yearNum)
  if (!pool.length) return null

  const exact = pool.find((l) => String(l.name || '').trim().toLowerCase() === term)
  if (exact) return exact

  const tokens = term.split(/\s+/).filter(Boolean)
  const byTokens = pool.filter((l) => {
    const n = String(l.name || '').toLowerCase()
    return tokens.every((t) => n.includes(t))
  })
  if (byTokens.length === 1) return byTokens[0]

  const starts = pool.filter((l) => String(l.name || '').toLowerCase().startsWith(term))
  if (starts.length === 1) return starts[0]

  const incl = pool.filter((l) => String(l.name || '').toLowerCase().includes(term))
  if (incl.length === 0) return null
  return incl.sort((a, b) => (b.originations || b.units || 0) - (a.originations || a.units || 0))[0]
}

/** Sum FFIEC state breakdown originated counts for one lender. */
export function sumLenderStateOriginated(insights) {
  return (insights?.stateBreakdown || []).reduce(
    (sum, row) => sum + Math.max(0, Number(row?.originated) || 0),
    0,
  )
}

/** States with at least one originated loan in the lender breakdown. */
export function lenderActiveStateCodes(insights) {
  return (insights?.stateBreakdown || [])
    .filter((row) => Number(row?.originated) > 0)
    .map((row) => String(row.state || '').trim().toUpperCase())
    .filter((st) => /^[A-Z]{2}$/.test(st))
}

/** Market originated totals by state from geo drilldown year object. */
export function marketUnitsByStateFromGeoYear(geoYear) {
  const out = {}
  if (!geoYear || typeof geoYear !== 'object') return out
  for (const [st, row] of Object.entries(geoYear)) {
    if (!/^[A-Z]{2}$/.test(st)) continue
    let units = Number(row?.units) || 0
    let volume = Number(row?.volume) || 0
    if (!units && Array.isArray(row?.counties)) {
      for (const c of row.counties) {
        units += Number(c.units) || 0
        volume += Number(c.volume) || 0
      }
    }
    out[st] = { units, volume }
  }
  return out
}

/**
 * Replace state choropleth metrics with lender originated counts (FFIEC state breakdown).
 * @param {object[]} marketGeoStateData
 * @param {{ stateBreakdown?: { state: string, originated?: number, volume?: number }[] }} insights
 */
export function buildGeoStateDataForLender(marketGeoStateData, insights) {
  const breakdown = insights?.stateBreakdown || []
  const byState = Object.fromEntries(
    breakdown.map((r) => [String(r.state || '').trim().toUpperCase(), r]),
  )
  const marketByState = Object.fromEntries((marketGeoStateData || []).map((s) => [s.state, s]))
  const allStates = new Set([
    ...Object.keys(marketByState),
    ...lenderActiveStateCodes(insights),
  ])

  const rows = [...allStates].map((state) => {
    const market = marketByState[state] || { state, loanUnits: 0, volume: 0, countyCount: 0 }
    const row = byState[state]
    const loanUnits = Math.round(Number(row?.originated) || 0)
    const volume = Math.round(Number(row?.volume) || 0)
    return {
      ...market,
      state,
      loanUnits,
      volume,
      lenderFiltered: loanUnits > 0,
    }
  })

  const maxUnits = Math.max(1, ...rows.map((r) => r.loanUnits))
  return rows
    .map((r) => ({
      ...r,
      density: r.loanUnits ? Math.round((r.loanUnits / maxUnits) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.loanUnits - a.loanUnits)
}

/**
 * Scale tract dot units/volume by lender's share of market originations in each state.
 * @param {GeoJSON.FeatureCollection} tractFc
 * @param {{ stateBreakdown?: { state: string, originated?: number }[] }} insights
 * @param {Record<string, { units: number, volume: number }>} marketByState
 */
export function applyLenderShareToTractFeatures(tractFc, insights, marketByState) {
  const breakdown = insights?.stateBreakdown || []
  const lenderByState = Object.fromEntries(
    breakdown.map((r) => {
      const st = String(r.state || '').trim().toUpperCase()
      return [st, Math.max(0, Number(r.originated) || 0)]
    }),
  )

  const baseUnitsByState = {}
  const tractCountByState = {}
  for (const f of tractFc?.features || []) {
    const st = String(f.properties?.state || '').trim().toUpperCase()
    if (!st) continue
    tractCountByState[st] = (tractCountByState[st] || 0) + 1
    baseUnitsByState[st] = (baseUnitsByState[st] || 0) + (Number(f.properties?.units) || 0)
  }

  const features = (tractFc?.features || [])
    .map((f) => {
      const st = String(f.properties?.state || '').trim().toUpperCase()
      const lenderOrig = lenderByState[st] || 0
      if (lenderOrig <= 0) return null

      const baseUnits = Number(f.properties?.units) || 0
      const baseVol = Number(f.properties?.volume) || 0
      const stateBaseSum = baseUnitsByState[st] || 0
      const marketUnits = marketByState[st]?.units || 0

      let units
      let volume
      let lenderSharePct

      if (stateBaseSum > 0 && baseUnits > 0) {
        const scale = lenderOrig / stateBaseSum
        units = Math.max(1, Math.round(baseUnits * scale))
        volume =
          baseVol > 0
            ? Math.round(baseVol * scale)
            : Math.round(units * (baseVol / Math.max(1, baseUnits) || 280000))
        lenderSharePct =
          marketUnits > 0 ? Math.min(100, (lenderOrig / marketUnits) * 100) : (lenderOrig / stateBaseSum) * 100
      } else if (marketUnits > 0 && baseUnits > 0) {
        const share = Math.min(1, lenderOrig / marketUnits)
        units = Math.max(1, Math.round(baseUnits * share))
        volume =
          baseVol > 0 ? Math.round(baseVol * share) : Math.round(units * (baseVol / Math.max(1, baseUnits) || 280000))
        lenderSharePct = share * 100
      } else {
        const n = tractCountByState[st] || 1
        units = Math.max(1, Math.round(lenderOrig / n))
        volume = Math.round(units * (baseVol / Math.max(1, baseUnits) || 280000))
        lenderSharePct = marketUnits > 0 ? Math.min(100, (lenderOrig / marketUnits) * 100) : null
      }

      return {
        ...f,
        properties: {
          ...f.properties,
          units,
          volume,
          lenderEst: true,
          lenderShare: lenderSharePct != null ? Math.round(lenderSharePct * 10) / 10 : null,
        },
      }
    })
    .filter(Boolean)

  return { type: 'FeatureCollection', features }
}
