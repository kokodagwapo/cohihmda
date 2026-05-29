import { geoCentroid } from 'd3-geo'
import { feature } from 'topojson-client'
import { publicAssetUrl } from '@hmda/utils/publicAssetUrl.js'
import statesTopo from 'us-atlas/states-10m.json'
import countiesTopo from 'us-atlas/counties-10m.json'

const FIPS_TO_STATE = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT', '10': 'DE',
  '11': 'DC', '12': 'FL', '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA',
  '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME', '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN',
  '28': 'MS', '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH', '34': 'NJ', '35': 'NM',
  '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI',
  '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT', '51': 'VA', '53': 'WA',
  '54': 'WV', '55': 'WI', '56': 'WY',
}

const STATE_TO_ST_FIPS = Object.fromEntries(
  Object.entries(FIPS_TO_STATE).map(([fips, st]) => [st, fips]),
)

/** Normalize HMDA county codes to 5-digit FIPS for us-atlas join. */
export function normalizeCountyFips5(stateCode, countyCode) {
  const digits = String(countyCode ?? '').replace(/\D/g, '')
  if (digits.length >= 5) return digits.slice(-5).padStart(5, '0')
  const stFips = STATE_TO_ST_FIPS[stateCode]
  if (stFips && digits.length > 0) return `${stFips}${digits.padStart(3, '0')}`
  return digits.padStart(5, '0')
}

export const STATE_MEDIAN_INCOME = {
  AL: 59269, AK: 86370, AZ: 72581, AR: 56335, CA: 91905, CO: 90235, CT: 91665, DE: 81301,
  DC: 101027, FL: 71333, GA: 74255, HI: 95390, ID: 70919, IL: 81860, IN: 67177, IA: 69982,
  KS: 68925, KY: 60683, LA: 58229, ME: 69398, MD: 98316, MA: 96960, MI: 67786, MN: 85853,
  MS: 52873, MO: 65370, MT: 67875, NE: 71846, NV: 74255, NH: 92923, NJ: 99980, NM: 59436,
  NY: 82095, NC: 67567, ND: 71846, OH: 65724, OK: 62208, OR: 80172, PA: 73090, RI: 81855,
  SC: 63218, SD: 69392, TN: 66787, TX: 75780, UT: 89244, VT: 78061, VA: 89931, WA: 94805,
  WV: 55948, WI: 71899, WY: 72495,
}

let _statesFc = null
let _countiesFc = null

export function getUsStatesGeoJson() {
  if (!_statesFc) {
    _statesFc = feature(statesTopo, statesTopo.objects.states)
    _statesFc.features.forEach((f) => {
      const fips = String(f.id).padStart(2, '0')
      f.properties = {
        ...f.properties,
        fips,
        state: FIPS_TO_STATE[fips] || null,
      }
    })
  }
  return _statesFc
}

export function getUsCountiesGeoJson() {
  if (!_countiesFc) {
    _countiesFc = feature(countiesTopo, countiesTopo.objects.counties)
    _countiesFc.features.forEach((f) => {
      const fips = String(f.id).padStart(5, '0')
      const stFips = fips.slice(0, 2)
      f.properties = {
        ...f.properties,
        fips,
        state: FIPS_TO_STATE[stFips] || null,
      }
    })
  }
  return _countiesFc
}

/** Resolve county label from enrichment or `public/data/county-fips-names.json` keys (`ST-###`). */
export function countyDisplayName(stateCode, fips, extra = {}, countyNames = {}) {
  if (extra?.name) return extra.name
  const suffix = String(fips || '').slice(-3)
  if (stateCode && suffix) {
    const key = `${stateCode}-${suffix}`
    if (countyNames[key]) return countyNames[key]
  }
  return null
}

import { inheritStateDisposition } from './geo-hmda-disposition.js'

function applyDispositionProps(props, disposition) {
  if (!disposition) return props
  return {
    ...props,
    denialRate: disposition.denialRate,
    withdrawnRate: disposition.withdrawnRate,
    pullthroughRate: disposition.pullthroughRate,
    incompleteRate: disposition.incompleteRate ?? null,
    falloutRate: disposition.falloutRate ?? null,
    dispositionSource: disposition.dispositionSource,
  }
}

/** Merge HMDA state rows + optional county enrichment into state GeoJSON. */
export function buildStatesWithMetrics(
  geoStateData,
  countyEnrichment = null,
  dispositionCtx = null,
) {
  const dispositionByState = dispositionCtx?.byState || {}
  const nationalDisposition = dispositionCtx?.national || null
  const base = getUsStatesGeoJson()
  const byState = Object.fromEntries((geoStateData || []).map((s) => [s.state, s]))
  const features = base.features.map((f) => {
    const st = f.properties.state
    const row = byState[st]
    const units = row?.loanUnits || 0
    const volume = row?.volume || 0
    const avgLoan = units > 0 ? Math.round(volume / units) : 0
    const medianIncome = STATE_MEDIAN_INCOME[st] || 72000
    const stateDisposition =
      dispositionByState[st] || inheritStateDisposition(st, dispositionByState, nationalDisposition)
    let floodRisk = 25
    let wildfireRisk = 15
    let compositeRisk = 22
    if (countyEnrichment?.counties && st) {
      const countyRows = Object.values(countyEnrichment.counties).filter((c) => c.state === st)
      if (countyRows.length) {
        floodRisk = Math.round(countyRows.reduce((a, c) => a + (c.floodRisk || 0), 0) / countyRows.length)
        wildfireRisk = Math.round(countyRows.reduce((a, c) => a + (c.wildfireRisk || 0), 0) / countyRows.length)
        compositeRisk = Math.round(countyRows.reduce((a, c) => a + (c.compositeRisk || 0), 0) / countyRows.length)
      }
    }
    return {
      ...f,
      id: st,
      properties: applyDispositionProps(
        {
          ...f.properties,
          units,
          volume,
          avgLoan,
          medianIncome,
          countyCount: row?.countyCount || 0,
          floodRisk,
          wildfireRisk,
          compositeRisk,
          diversityScore: row?.diversityScore ?? null,
          minorityShare:  row?.minorityShare  ?? null,
        },
        stateDisposition,
      ),
    }
  })
  return { type: 'FeatureCollection', features }
}

/** Counties for one state with merged metrics. */
export function buildCountiesForState(
  stateCode,
  geoDrilldownYear,
  countyEnrichment,
  countyNames = {},
  dispositionCtx = null,
) {
  const dispositionByState = dispositionCtx?.byState || {}
  const nationalDisposition = dispositionCtx?.national || null
  const stateDisposition = inheritStateDisposition(stateCode, dispositionByState, nationalDisposition)
  const base = getUsCountiesGeoJson()
  const stRow = geoDrilldownYear?.[stateCode]
  const countyByFips = Object.fromEntries(
    (stRow?.counties || []).map((c) => [
      normalizeCountyFips5(stateCode, c.countyCode || c.fips),
      c,
    ]),
  )
  const enrich = countyEnrichment?.counties || {}

  const features = base.features
    .filter((f) => f.properties.state === stateCode)
    .map((f) => {
      const fips = f.properties.fips
      const hmda = countyByFips[fips]
      const extra = enrich[fips] || {}
      const units = hmda?.units ?? extra.units ?? 0
      const volume = hmda?.volume ?? extra.volume ?? 0
      const avgLoan = units > 0 ? Math.round(volume / units) : extra.avgLoan ?? 0
      return {
        ...f,
        id: fips,
        properties: applyDispositionProps(
          {
            ...f.properties,
            name: countyDisplayName(stateCode, fips, extra, countyNames),
            units,
            volume,
            avgLoan,
            medianIncome: extra.medianIncome ?? STATE_MEDIAN_INCOME[stateCode] ?? 72000,
            floodRisk: extra.floodRisk,
            wildfireRisk: extra.wildfireRisk,
            compositeRisk: extra.compositeRisk,
            tractCount: (hmda?.topCensusTracts || []).length,
          },
          stateDisposition,
        ),
      }
    })
  return { type: 'FeatureCollection', features }
}

/** Top HMDA census tracts for hover cards (state-wide or within one county). */
export function collectTopCensusTracts(
  stateCode,
  geoDrilldownYear,
  { countyFips = null, limit = 8, countyNames = {} } = {},
) {
  const stRow = geoDrilldownYear?.[stateCode]
  if (!stRow?.counties?.length) return []

  const tracts = []
  for (const county of stRow.counties) {
    const fips = normalizeCountyFips5(stateCode, county.countyCode || county.fips)
    if (countyFips && fips !== countyFips) continue
    const countyName = countyDisplayName(stateCode, fips, {}, countyNames)
    for (const t of county.topCensusTracts || []) {
      const code = String(t.censusTract || '')
      if (!code) continue
      tracts.push({
        censusTract: code,
        countyFips: fips,
        countyName: countyName || `County ${fips.slice(-3)}`,
        units: Number(t.units) || 0,
        volume: Number(t.volume) || 0,
      })
    }
  }

  tracts.sort((a, b) => b.units - a.units || b.volume - a.volume)
  return tracts.slice(0, limit)
}

/** Max tract dots on the Mapbox layer (national cap). */
export const CENSUS_TRACT_DOT_CAP = 6000

export const STATE_TRACT_DOT_CAP = 2200

/** Max tract dots inside the viewport at county/metro zoom (real centroids — no overlap blob). */
export const VIEWPORT_TRACT_DOT_CAP = 2600

/** Official tract point geography (not HMDA volumes). */
export const CENSUS_TRACT_GAZETTEER_SOURCE = {
  id: 'census-gazetteer-tracts',
  label: 'U.S. Census Bureau',
  href: 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2020_Gazetteer/2020_National_Gazetteer_Files.zip',
  note: '2020 National Gazetteer — census tract internal points (GEOID11)',
}

/* ── Real census tract centroids from Census Bureau Gazetteer ── */
let _tractCentroids = null
let _tractCentroidsPromise = null

/** Normalize an HMDA tract code (e.g. "482015430.05") to an 11-digit Census GEOID. */
export function normalizeTractGeoid(code) {
  const s = String(code || '').replace('.', '').replace(/\D/g, '')
  return s.length >= 11 ? s.slice(-11) : s.padStart(11, '0')
}

/** Parse 11-digit Census tract GEOID into state / county / tract parts. */
export function parseTractGeoid(geoid) {
  const s = String(geoid || '').replace(/\D/g, '').padStart(11, '0')
  const stateFips = s.slice(0, 2)
  const stateCode = FIPS_TO_STATE[stateFips]
  if (!stateCode) return null
  return {
    geoid: s,
    stateCode,
    countyFips: s.slice(0, 5),
    censusTract: s.slice(5),
  }
}

/** Fast lookup of HMDA tract activity by Census GEOID. */
export function buildHmdaTractLookup(geoDrilldownYear) {
  const lookup = new Map()
  if (!geoDrilldownYear || typeof geoDrilldownYear !== 'object') return lookup
  for (const [stateCode, stRow] of Object.entries(geoDrilldownYear)) {
    if (!/^[A-Z]{2}$/.test(stateCode)) continue
    for (const county of stRow.counties || []) {
      const fips = normalizeCountyFips5(stateCode, county.countyCode || county.fips)
      for (const tract of county.topCensusTracts || []) {
        const geoid = normalizeTractGeoid(tract.censusTract)
        if (lookup.has(geoid)) continue
        lookup.set(geoid, {
          stateCode,
          countyFips: fips,
          censusTract: String(tract.censusTract || ''),
          units: Number(tract.units) || 0,
          volume: Number(tract.volume) || 0,
        })
      }
    }
  }
  return lookup
}

function pointInBounds(lng, lat, bounds, paddingDeg = 0.1) {
  if (!bounds) return true
  return (
    lng >= bounds.west - paddingDeg &&
    lng <= bounds.east + paddingDeg &&
    lat >= bounds.south - paddingDeg &&
    lat <= bounds.north + paddingDeg
  )
}

/**
 * Census tract pointer dots from Gazetteer centroids (all tracts, evenly subsampled when capped).
 * Optional HMDA enrichment for units/volume on tracts present in drilldown data.
 */
export function buildTractPointsFromCentroids(
  centroids,
  geoDrilldownYear,
  countyEnrichment,
  countyNames = {},
  dispositionCtx = null,
  { stateFilter = null, lenderStates = null, cap = CENSUS_TRACT_DOT_CAP, bounds = null } = {},
) {
  if (!centroids || typeof centroids !== 'object') {
    return { type: 'FeatureCollection', features: [] }
  }

  const lookup = buildHmdaTractLookup(geoDrilldownYear)
  const dispositionByState = dispositionCtx?.byState || {}
  const nationalDisposition = dispositionCtx?.national || null
  const enrich = countyEnrichment?.counties || {}
  const stFipsPrefix = stateFilter ? STATE_TO_ST_FIPS[stateFilter] : null
  const lenderFipsSet = lenderStates?.length
    ? new Set(lenderStates.map((st) => STATE_TO_ST_FIPS[st]).filter(Boolean))
    : null

  const matched = []
  for (const [geoid, coords] of Object.entries(centroids)) {
    if (stFipsPrefix && !String(geoid).startsWith(stFipsPrefix)) continue
    if (lenderFipsSet && !lenderFipsSet.has(String(geoid).slice(0, 2))) continue
    if (!Array.isArray(coords) || coords.length < 2) continue
    const lng = Number(coords[0])
    const lat = Number(coords[1])
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue
    if (!pointInBounds(lng, lat, bounds)) continue
    matched.push([geoid, lng, lat])
  }

  let picked = matched
  if (picked.length > cap) {
    const stride = Math.ceil(picked.length / cap)
    const subsampled = []
    for (let i = 0; i < picked.length; i += stride) subsampled.push(picked[i])
    picked = subsampled
  }

  const features = picked.map(([geoid, lng, lat]) => {
    const parsed = parseTractGeoid(geoid)
    if (!parsed) return null
    const { stateCode, countyFips, censusTract } = parsed
    const hmda = lookup.get(parsed.geoid)
    const extra = enrich[countyFips] || {}
    const u = hmda?.units ?? 0
    const v = hmda?.volume ?? 0
    const tractId = `${stateCode}-${censusTract}`
    const stateDisposition = inheritStateDisposition(
      stateCode,
      dispositionByState,
      nationalDisposition,
    )
    return {
      type: 'Feature',
      id: tractId,
      properties: applyDispositionProps(
        {
          tractId,
          censusTract,
          geoid: parsed.geoid,
          countyFips,
          countyName: countyDisplayName(stateCode, countyFips, extra, countyNames),
          state: stateCode,
          units: u,
          volume: v,
          avgLoan: u > 0 ? Math.round(v / u) : 0,
          medianIncome: extra.medianIncome ?? STATE_MEDIAN_INCOME[stateCode] ?? null,
          floodRisk: extra.floodRisk ?? null,
          wildfireRisk: extra.wildfireRisk ?? null,
          compositeRisk: extra.compositeRisk ?? null,
          hasRealCentroid: true,
        },
        stateDisposition,
      ),
      geometry: { type: 'Point', coordinates: [lng, lat] },
    }
  })

  return {
    type: 'FeatureCollection',
    features: features.filter(Boolean),
  }
}

/**
 * Async loader — fetches /data/tract-centroids.json once and caches it.
 * Returns the lookup map { geoid: [lng, lat] } or {} on failure.
 */
export function loadTractCentroids() {
  if (_tractCentroids) return Promise.resolve(_tractCentroids)
  if (_tractCentroidsPromise) return _tractCentroidsPromise
  _tractCentroidsPromise = fetch(publicAssetUrl('data/tract-centroids.json'))
    .then((r) => r.json())
    .then((data) => {
      _tractCentroids = data
      return data
    })
    .catch((err) => {
      console.warn(
        `[Tracts] Could not load tract-centroids.json (${CENSUS_TRACT_GAZETTEER_SOURCE.label}):`,
        err.message,
      )
      _tractCentroids = {}
      return {}
    })
  return _tractCentroidsPromise
}

let _countyCentroidsByFips = null

function getCountyCentroidsByFips() {
  if (!_countyCentroidsByFips) {
    _countyCentroidsByFips = {}
    for (const cf of getUsCountiesGeoJson().features) {
      const fips = cf.properties.fips
      const coords = cf.geometry?.coordinates
      if (!coords) continue
      let ring = coords
      if (cf.geometry.type === 'MultiPolygon') ring = coords[0]?.[0]
      else if (cf.geometry.type === 'Polygon') ring = coords[0]
      if (!ring?.length) continue
      let sx = 0
      let sy = 0
      for (const [x, y] of ring) {
        sx += x
        sy += y
      }
      _countyCentroidsByFips[fips] = [sx / ring.length, sy / ring.length]
    }
  }
  return _countyCentroidsByFips
}

function collectTractFeaturesForState(
  stateCode,
  geoDrilldownYear,
  countyEnrichment,
  countyNames,
  dispositionCtx,
  centroids = null,
) {
  const dispositionByState = dispositionCtx?.byState || {}
  const nationalDisposition = dispositionCtx?.national || null
  const stateDisposition = inheritStateDisposition(stateCode, dispositionByState, nationalDisposition)
  const stRow = geoDrilldownYear?.[stateCode]
  if (!stRow?.counties) return []

  const countyCentroids = getCountyCentroidsByFips()
  const enrich = countyEnrichment?.counties || {}
  const features = []

  for (const county of stRow.counties) {
    const fips = normalizeCountyFips5(stateCode, county.countyCode || county.fips)
    const extra = enrich[fips] || {}
    const [cx, cy] = countyCentroids[fips] || [-98, 39]
    for (const tract of county.topCensusTracts || []) {
      const code = String(tract.censusTract || '')
      const geoid = normalizeTractGeoid(code)
      const realCoords = centroids?.[geoid]
      let coordinates
      if (realCoords) {
        coordinates = realCoords
      } else {
        let h = 0
        for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) >>> 0
        const dx = ((h & 0xff) / 255 - 0.5) * 0.06
        const dy = (((h >> 8) & 0xff) / 255 - 0.5) * 0.04
        coordinates = [cx + dx, cy + dy]
      }
      const u = tract.units || 0
      const v = tract.volume || 0
      const tractId = `${stateCode}-${code || fips}`
      features.push({
        type: 'Feature',
        id: tractId,
        properties: applyDispositionProps(
          {
            tractId,
            censusTract: code,
            geoid,
            countyFips: fips,
            countyName: countyDisplayName(stateCode, fips, extra, countyNames),
            state: stateCode,
            units: u,
            volume: v,
            avgLoan: u > 0 ? Math.round(v / u) : 0,
            medianIncome: extra.medianIncome ?? STATE_MEDIAN_INCOME[stateCode] ?? null,
            floodRisk: extra.floodRisk ?? null,
            wildfireRisk: extra.wildfireRisk ?? null,
            compositeRisk: extra.compositeRisk ?? null,
            hasRealCentroid: !!realCoords,
          },
          stateDisposition,
        ),
        geometry: { type: 'Point', coordinates },
      })
    }
  }
  return features
}

/** Census tract points for one state using real Census Bureau centroids when available. */
export function buildTractPoints(
  stateCode,
  geoDrilldownYear,
  countyEnrichment,
  countyNames = {},
  dispositionCtx = null,
  centroids = null,
) {
  const features = collectTractFeaturesForState(
    stateCode,
    geoDrilldownYear,
    countyEnrichment,
    countyNames,
    dispositionCtx,
    centroids,
  )
  return { type: 'FeatureCollection', features: features.slice(0, STATE_TRACT_DOT_CAP) }
}

/**
 * Census tract dots for all states (or one state when `stateFilter` is set).
 * Uses real Census Bureau Gazetteer centroids when `centroids` lookup is provided.
 * Sorted by HMDA units/volume; capped for Mapbox performance.
 */
export function buildAllTractPoints(
  geoDrilldownYear,
  countyEnrichment,
  countyNames = {},
  dispositionCtx = null,
  { stateFilter = null, lenderStates = null, cap = CENSUS_TRACT_DOT_CAP, centroids = null, bounds = null } = {},
) {
  if (centroids && Object.keys(centroids).length > 0) {
    return buildTractPointsFromCentroids(
      centroids,
      geoDrilldownYear,
      countyEnrichment,
      countyNames,
      dispositionCtx,
      { stateFilter, lenderStates, cap, bounds },
    )
  }

  if (!geoDrilldownYear || typeof geoDrilldownYear !== 'object') {
    return { type: 'FeatureCollection', features: [] }
  }

  const stateCodes = stateFilter
    ? [stateFilter]
    : Object.keys(geoDrilldownYear).filter((k) => /^[A-Z]{2}$/.test(k))

  let features = []
  for (const stateCode of stateCodes) {
    features = features.concat(
      collectTractFeaturesForState(
        stateCode,
        geoDrilldownYear,
        countyEnrichment,
        countyNames,
        dispositionCtx,
        centroids,
      ),
    )
  }

  features.sort(
    (a, b) =>
      (b.properties?.units || 0) - (a.properties?.units || 0) ||
      (b.properties?.volume || 0) - (a.properties?.volume || 0),
  )

  const limit = stateFilter ? Math.min(cap, STATE_TRACT_DOT_CAP) : cap
  const sliced = features.slice(0, limit)
  return { type: 'FeatureCollection', features: sliced }
}

/** Keep tract dots inside the current map viewport so county zoom shows distinct points, not a state-wide blob. */
export function filterTractFeaturesToBounds(features, bounds, { paddingDeg = 0.12 } = {}) {
  if (!bounds || !Array.isArray(features) || !features.length) return features
  const west = bounds.west - paddingDeg
  const east = bounds.east + paddingDeg
  const south = bounds.south - paddingDeg
  const north = bounds.north + paddingDeg
  return features.filter((f) => {
    const coords = f.geometry?.coordinates
    if (!coords || coords.length < 2) return false
    const [lng, lat] = coords
    return lng >= west && lng <= east && lat >= south && lat <= north
  })
}

/** Continental US bounds (lower 48 only). */
export const CONUS_BOUNDS = [
  [-124.85, 24.4],
  [-66.9, 49.45],
]

function walkBounds(coords, acc) {
  if (typeof coords[0] === 'number') {
    acc[0] = Math.min(acc[0], coords[0])
    acc[1] = Math.min(acc[1], coords[1])
    acc[2] = Math.max(acc[2], coords[0])
    acc[3] = Math.max(acc[3], coords[1])
    return acc
  }
  for (const c of coords) walkBounds(c, acc)
  return acc
}

let _usaFullBounds = null

/** SW/NE bounds for all 50 states (incl. AK, HI) from Census state geometries. */
export function getUsaFullBounds() {
  if (!_usaFullBounds) {
    const acc = [Infinity, Infinity, -Infinity, -Infinity]
    for (const f of getUsStatesGeoJson().features) {
      if (f?.geometry?.coordinates) walkBounds(f.geometry.coordinates, acc)
    }
    _usaFullBounds = [
      [acc[0], acc[1]],
      [acc[2], acc[3]],
    ]
  }
  return _usaFullBounds
}

/** Pin markers at state centroids (HMDA activity). */
export function buildStateMarkers(geoStateData, metricField = 'volume') {
  const states = getUsStatesGeoJson()
  const byState = Object.fromEntries((geoStateData || []).map((s) => [s.state, s]))
  const maxUnits = Math.max(1, ...(geoStateData || []).map((s) => s.loanUnits || 0))

  const features = states.features
    .map((f) => {
      const st = f.properties.state
      const row = byState[st]
      if (!row?.loanUnits) return null
      let coords
      try {
        coords = geoCentroid(f)
      } catch {
        return null
      }
      if (!Number.isFinite(coords[0]) || !Number.isFinite(coords[1])) return null
      const metricValue = row[metricField] ?? row.volume ?? row.loanUnits ?? 0
      return {
        type: 'Feature',
        properties: {
          state: st,
          loanUnits: row.loanUnits,
          volume: row.volume,
          avgLoan: row.volume && row.loanUnits ? Math.round(row.volume / row.loanUnits) : 0,
          intensity: (row.loanUnits || 0) / maxUnits,
          metricValue,
          lenderFiltered: Boolean(row.lenderFiltered),
        },
        geometry: { type: 'Point', coordinates: coords },
      }
    })
    .filter(Boolean)

  return { type: 'FeatureCollection', features }
}

/** SW/NE bounds for a GeoJSON feature (state/county polygon). */
export function getFeatureBounds(feature) {
  const acc = [Infinity, Infinity, -Infinity, -Infinity]
  const geom = feature?.geometry
  if (!geom?.coordinates) return null
  walkBounds(geom.coordinates, acc)
  if (!Number.isFinite(acc[0])) return null
  return [
    [acc[0], acc[1]],
    [acc[2], acc[3]],
  ]
}

export function metricExtent(geojson, metricId, metricField) {
  let min = Infinity
  let max = -Infinity
  for (const f of geojson?.features || []) {
    const v = f.properties?.[metricField]
    if (v == null || !Number.isFinite(Number(v))) continue
    const n = Number(v)
    if (n < min) min = n
    if (n > max) max = n
  }
  if (!Number.isFinite(min)) return { min: 0, max: 1 }
  if (min === max) return { min: min * 0.9 || 0, max: max * 1.1 || 1 }
  return { min, max }
}
