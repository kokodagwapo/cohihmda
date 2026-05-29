/**
 * Warm-cache geography route assets before the map mounts (Tier 3 preload).
 */
import { publicAssetUrl, geoMapSummaryRelativePath, geoDrilldownFullRelativePath } from '@hmda/utils/publicAssetUrl.js'
import { preloadTractAssets } from './geo-tract-pipeline.js'

const warmed = new Set()

function prefetchUrl(url, as = 'fetch') {
  if (typeof document === 'undefined' || warmed.has(url)) return
  warmed.add(url)
  const link = document.createElement('link')
  link.rel = 'prefetch'
  link.as = as
  link.href = url
  document.head.appendChild(link)
}

/** Prefetch slim map summary by default; full drilldown only when explicitly requested. */
export function preloadGeographyAssets(preferredYear = '2025', opts = {}) {
  const year = String(preferredYear || '2025')
  const includeGeoDrilldown = opts.includeGeoDrilldown === true
  const includeGeoSummary = opts.includeGeoSummary !== false
  const includeCountyNames = opts.includeCountyNames !== false
  const includeCountyMetrics = opts.includeCountyMetrics === true
  const includeTracts = opts.includeTracts === true

  if (includeGeoSummary) prefetchUrl(publicAssetUrl(geoMapSummaryRelativePath(year)))
  if (includeGeoDrilldown) prefetchUrl(publicAssetUrl(geoDrilldownFullRelativePath()))
  if (includeCountyNames) prefetchUrl(publicAssetUrl('data/county-fips-names.json'))
  if (includeCountyMetrics) prefetchUrl(publicAssetUrl(`data/geo-map/county-metrics-${year}.json`))
  prefetchUrl(publicAssetUrl('data/geo-map/tracts/manifest.json'))
  if (includeTracts) {
    preloadTractAssets(year, { includeNational: opts.includeNationalTracts !== false })
  }

  import('./HmdaGeographyMapbox.jsx').catch(() => {})
}

/** Lazy prefetch full drilldown when user opens county/state modal. */
export function preloadFullGeoDrilldown() {
  prefetchUrl(publicAssetUrl(geoDrilldownFullRelativePath()))
}
