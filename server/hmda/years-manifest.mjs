import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { HMDA_DEFAULT_ANCHOR_YEAR } from './years-service.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MANIFEST_PATH = path.resolve(__dirname, '../../public/data/hmda/hmda-years-manifest.json')

/** @type {object|null} */
let cached = null
let cachedMtime = 0

export function loadYearsManifest() {
  try {
    if (!fs.existsSync(MANIFEST_PATH)) return null
    const stat = fs.statSync(MANIFEST_PATH)
    if (cached && stat.mtimeMs === cachedMtime) return cached
    cached = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
    cachedMtime = stat.mtimeMs
    return cached
  } catch {
    return null
  }
}

/** Merge static manifest into FFIEC year window for richer client year picker. */
export function mergeYearWindowWithManifest(window, manifest = loadYearsManifest()) {
  if (!manifest?.years) return window
  const lenderYears = (manifest.lenderYears || []).map(Number).filter(Number.isFinite)
  const geoYears = (manifest.geoYears || []).map(String)
  return {
    ...window,
    staticManifest: {
      generatedAt: manifest.generatedAt,
      anchorYear: manifest.anchorYear ?? HMDA_DEFAULT_ANCHOR_YEAR,
      larDetailMaxYear: manifest.larDetailMaxYear,
      lenderYears: manifest.lenderYears,
      geoYears: manifest.geoYears,
      tractYears: manifest.tractYears,
      partialYears: manifest.partialYears,
      years: manifest.years,
    },
    lenderYearsAvailable: lenderYears.length ? lenderYears : window.available,
    geoYearsAvailable: geoYears,
  }
}

/** Merge DataCoverageYear rows from warehouse when DB is populated. */
export async function mergeYearWindowWithWarehouse(window) {
  try {
    const { useHmdaWarehouse, isWarehouseReady } = await import('./data-source.mjs')
    if (!useHmdaWarehouse() || !(await isWarehouseReady())) return window
    const { getDataCoverageFromDb } = await import('./geo-warehouse-store.mjs')
    const coverage = await getDataCoverageFromDb()
    if (!coverage.length) return window
    const years = {}
    for (const row of coverage) {
      years[String(row.year)] = {
        lenders: row.hasLenders,
        geo: row.hasGeoState,
        geoCounty: row.hasGeoCounty,
        geoTract: row.hasGeoTract,
        larDetail: row.hasLarDetail,
        partial: row.partial,
        tractFallbackYear: row.tractFallbackYear,
        lenderCount: row.lenderCount,
      }
    }
    return {
      ...window,
      warehouseCoverage: coverage,
      lenderYearsAvailable: coverage.filter((r) => r.hasLenders).map((r) => r.year),
      geoYearsAvailable: coverage.filter((r) => r.hasGeoState).map((r) => String(r.year)),
      staticManifest: {
        ...(window.staticManifest || {}),
        source: 'database',
        years,
      },
    }
  } catch {
    return window
  }
}
