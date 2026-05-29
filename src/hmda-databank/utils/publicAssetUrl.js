/**
 * Resolve URLs for files in /public (e.g. public/data/*.json).
 * Uses Vite's import.meta.env.BASE_URL so hosts under a subpath (Amplify, S3 website prefix) load assets correctly.
 */
export function hmdaDataPrefix() {
  const raw = String(import.meta.env.VITE_HMDA_DATA_PREFIX || 'data/').trim()
  return raw.endsWith('/') ? raw : `${raw}/`
}

export function publicAssetUrl(relativePath) {
  const raw = import.meta.env.BASE_URL || '/'
  const base = raw.endsWith('/') ? raw : `${raw}/`
  const p = String(relativePath).replace(/^\//, '')
  const dataPrefix = hmdaDataPrefix()
  if (p.startsWith('data/') && dataPrefix !== 'data/') {
    return `${base}${dataPrefix}${p.slice('data/'.length)}`
  }
  return `${base}${p}`
}

/** Relative path under /public for the full multi-year HMDA lender panel JSON. */
export function hmdaLendersJsonRelativePath() {
  const v = String(import.meta.env.VITE_HMDA_LENDERS_VERSION || '').trim()
  const prefix = hmdaDataPrefix()
  const rel = v ? `lenders-from-hmda.json?v=${encodeURIComponent(v)}` : 'lenders-from-hmda.json'
  return `${prefix}${rel}`
}

/**
 * Fast bootstrap slice for a given filing year.
 * Each file is ~6–20MB vs the full 29MB multi-year panel, reducing year-switch cost by ~4×.
 * Falls back to the full panel path when no per-year file exists.
 */
export function hmdaLendersBootstrapJsonRelativePath(year) {
  const v = String(import.meta.env.VITE_HMDA_LENDERS_VERSION || '').trim()
  const yr = Number(year) || 2025
  const qs = v ? `?v=${encodeURIComponent(v)}` : ''
  const prefix = hmdaDataPrefix()
  // Per-year slices exist for 2022–2025.
  if (yr >= 2022 && yr <= 2025) {
    return `${prefix}hmda-lenders-${yr}-only.json${qs}`
  }
  // Fallback to full panel for other years.
  return `${prefix}lenders-from-hmda.json${qs}`
}

export function geoMapSummaryRelativePath(year = '2025') {
  return `${hmdaDataPrefix()}geo-map-summary-${year}.json`
}

export function geoDrilldownFullRelativePath() {
  return `${hmdaDataPrefix()}geo-drilldown-from-hmda.json`
}
