/**
 * Precompute per-state census tract GeoJSON for the geography map (Tier 3).
 * Bakes Gazetteer centroids + HMDA drilldown units/volume + county enrichment.
 *
 * Output: public/data/geo-map/tracts/{year}/{ST}.json
 *         public/data/geo-map/tracts/{year}/_national-top.json
 *         public/data/geo-map/tracts/manifest.json
 *
 * Usage: node scripts/build-geo-tract-features.mjs [year ...]
 * npm:   npm run hmda:geo:tracts
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { HMDA_DATA_DIR } from './paths.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CENTROIDS_PATH = path.join(HMDA_DATA_DIR, 'tract-centroids.json')
const DRILLDOWN_PATH = path.join(HMDA_DATA_DIR, 'geo-drilldown-from-hmda.json')
const OUT_ROOT = path.join(HMDA_DATA_DIR, 'geo-map/tracts')

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

const STATE_MEDIAN_INCOME = {
  AL: 59269, AK: 86370, AZ: 72581, AR: 56335, CA: 91905, CO: 90235, CT: 91665, DE: 81301,
  DC: 101027, FL: 71333, GA: 74255, HI: 95390, ID: 70919, IL: 81860, IN: 67177, IA: 69982,
  KS: 68925, KY: 60683, LA: 58229, ME: 69398, MD: 98316, MA: 96960, MI: 67786, MN: 85853,
  MS: 52873, MO: 65370, MT: 67875, NE: 71846, NV: 74255, NH: 92923, NJ: 99980, NM: 59436,
  NY: 82095, NC: 67567, ND: 71846, OH: 65724, OK: 62208, OR: 80172, PA: 73090, RI: 81855,
  SC: 63218, SD: 69392, TN: 66787, TX: 75780, UT: 89244, VT: 78061, VA: 89931, WA: 94805,
  WV: 55948, WI: 71899, WY: 72495,
}

const NATIONAL_TOP_CAP = 2000

function normalizeTractGeoid(code) {
  const s = String(code || '').replace('.', '').replace(/\D/g, '')
  return s.length >= 11 ? s.slice(-11) : s.padStart(11, '0')
}

function normalizeCountyFips5(stateCode, countyCode) {
  const digits = String(countyCode ?? '').replace(/\D/g, '')
  if (digits.length >= 5) return digits.slice(-5).padStart(5, '0')
  const stFips = STATE_TO_ST_FIPS[stateCode]
  if (stFips && digits.length > 0) return `${stFips}${digits.padStart(3, '0')}`
  return digits.padStart(5, '0')
}

function buildHmdaTractLookup(geoDrilldownYear) {
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

function loadCountyEnrichment(year) {
  const p = path.join(HMDA_DATA_DIR, `geo-map/county-metrics-${year}.json`)
  if (!fs.existsSync(p)) return { counties: {} }
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    return { counties: {} }
  }
}

function countyDisplayName(stateCode, countyFips, extra, countyNames) {
  const tail = String(countyFips || '').slice(-3)
  const fromNames = countyNames?.[`${stateCode}${tail}`] || countyNames?.[countyFips]
  if (fromNames) return fromNames
  if (extra?.name) return extra.name
  return `County ${tail}`
}

function buildStateFeatures(stateCode, centroids, lookup, enrich, countyNames) {
  const stFips = STATE_TO_ST_FIPS[stateCode]
  if (!stFips) return []
  const counties = enrich?.counties || {}
  const features = []

  for (const [geoid, coords] of Object.entries(centroids)) {
    if (!String(geoid).startsWith(stFips)) continue
    if (!Array.isArray(coords) || coords.length < 2) continue
    const lng = Number(coords[0])
    const lat = Number(coords[1])
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue

    const s = String(geoid).replace(/\D/g, '').padStart(11, '0')
    const countyFips = s.slice(0, 5)
    const censusTract = s.slice(5)
    const hmda = lookup.get(s)
    const extra = counties[countyFips] || {}
    const u = hmda?.units ?? 0
    const v = hmda?.volume ?? 0
    const tractId = `${stateCode}-${censusTract}`

    features.push({
      type: 'Feature',
      id: tractId,
      properties: {
        tractId,
        censusTract,
        geoid: s,
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
      geometry: { type: 'Point', coordinates: [lng, lat] },
    })
  }

  features.sort((a, b) => (b.properties.units || 0) - (a.properties.units || 0))
  return features
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(data))
}

function main() {
  const argvYears = process.argv.slice(2).map(Number).filter((y) => y >= 2018 && y <= 2030)
  const drilldown = JSON.parse(fs.readFileSync(DRILLDOWN_PATH, 'utf8'))
  const drilldownYears = Object.keys(drilldown).filter((k) => /^\d{4}$/.test(k)).map(Number)
  const years = argvYears.length ? argvYears : drilldownYears.sort((a, b) => b - a)

  const centroids = JSON.parse(fs.readFileSync(CENTROIDS_PATH, 'utf8'))
  let countyNames = {}
  const namesPath = path.join(HMDA_DATA_DIR, 'county-fips-names.json')
  if (fs.existsSync(namesPath)) {
    countyNames = JSON.parse(fs.readFileSync(namesPath, 'utf8'))
  }

  const manifest = {
    builtAt: new Date().toISOString(),
    nationalTopCap: NATIONAL_TOP_CAP,
    years: years.map(String),
    states: Object.values(FIPS_TO_STATE).sort(),
    files: {},
  }

  for (const year of years) {
    const yearKey = String(year)
    const geoYear = drilldown[yearKey]
    if (!geoYear) {
      console.warn(`Skip ${yearKey}: no drilldown slice`)
      continue
    }

    const lookup = buildHmdaTractLookup(geoYear)
    const enrich = loadCountyEnrichment(year)
    manifest.files[yearKey] = { states: {}, nationalTop: 0 }

    const nationalPool = []

    for (const stateCode of manifest.states) {
      const features = buildStateFeatures(stateCode, centroids, lookup, enrich, countyNames)
      const outPath = path.join(OUT_ROOT, yearKey, `${stateCode}.json`)
      writeJson(outPath, { type: 'FeatureCollection', features })
      manifest.files[yearKey].states[stateCode] = features.length

      for (const f of features) {
        if ((f.properties.units || 0) > 0) nationalPool.push(f)
      }
    }

    nationalPool.sort((a, b) => (b.properties.units || 0) - (a.properties.units || 0))
    const nationalTop = nationalPool.slice(0, NATIONAL_TOP_CAP)
    writeJson(path.join(OUT_ROOT, yearKey, '_national-top.json'), {
      type: 'FeatureCollection',
      features: nationalTop,
    })
    manifest.files[yearKey].nationalTop = nationalTop.length
    console.log(`${yearKey}: ${manifest.states.length} states, national-top ${nationalTop.length}`)
  }

  writeJson(path.join(OUT_ROOT, 'manifest.json'), manifest)
  console.log('Wrote', path.join(OUT_ROOT, 'manifest.json'))
}

main()
