/**
 * Client pipeline for prebuilt per-state tract GeoJSON + Web Worker filtering.
 */
import { publicAssetUrl } from '@hmda/utils/publicAssetUrl.js'
import {
  applyLenderShareToTractFeatures,
  lenderActiveStateCodes,
} from './geo-map-lender-filter.js'
import {
  CENSUS_TRACT_DOT_CAP,
  STATE_TRACT_DOT_CAP,
  VIEWPORT_TRACT_DOT_CAP,
} from './geo-map-features.js'

/** @type {Worker | null} */
let worker = null
/** Simple LRU cache for parsed state tract JSON (max 5 resolved FeatureCollections in memory). */
const FETCH_CACHE_MAX = 5
const fetchCache = new Map() // key → Promise<object|null>
const fetchCacheOrder = [] // insertion-order keys for LRU eviction

function cachePut(key, promise) {
  if (fetchCache.has(key)) return
  fetchCache.set(key, promise)
  fetchCacheOrder.push(key)
  if (fetchCacheOrder.length > FETCH_CACHE_MAX) {
    const evict = fetchCacheOrder.shift()
    fetchCache.delete(evict)
  }
}

const MAX_LENDER_TRACT_STATES = 8  // was 14 — reduces concurrent multi-state fetches
const STATE_FETCH_CONCURRENCY = 2  // was 4 — less main-thread parse contention

async function mapWithConcurrency(items, fn, concurrency = STATE_FETCH_CONCURRENCY) {
  const results = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return results
}

function getWorker() {
  if (typeof Worker === 'undefined') return null
  if (!worker) {
    worker = new Worker(new URL('./geo-tract-worker.js', import.meta.url), { type: 'module' })
  }
  return worker
}

function workerRequest(type, payload) {
  const w = getWorker()
  if (!w) {
    return Promise.resolve(filterTractsMainThread(payload?.features, payload))
  }
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return new Promise((resolve, reject) => {
    const onMessage = (event) => {
      if (event.data?.id !== id) return
      w.removeEventListener('message', onMessage)
      w.removeEventListener('error', onError)
      if (event.data.ok) resolve(event.data.result)
      else reject(new Error(event.data.error || 'tract worker failed'))
    }
    const onError = (err) => {
      w.removeEventListener('message', onMessage)
      w.removeEventListener('error', onError)
      reject(err)
    }
    w.addEventListener('message', onMessage)
    w.addEventListener('error', onError)
    w.postMessage({ id, type, payload })
  })
}

function pointInBounds(lng, lat, bounds, paddingDeg = 0.08) {
  if (!bounds) return true
  return (
    lng >= bounds.west - paddingDeg &&
    lng <= bounds.east + paddingDeg &&
    lat >= bounds.south - paddingDeg &&
    lat <= bounds.north + paddingDeg
  )
}

function filterTractsMainThread(features, { bounds = null, cap = Infinity, perState = false } = {}) {
  if (perState) {
    return filterTractFeaturesPerState(features, { bounds, cap })
  }
  let list = features || []
  if (bounds) {
    list = list.filter((f) => {
      const c = f?.geometry?.coordinates
      if (!Array.isArray(c) || c.length < 2) return false
      return pointInBounds(Number(c[0]), Number(c[1]), bounds)
    })
  }
  if (list.length > cap) {
    list = [...list].sort((a, b) => (b.properties?.units || 0) - (a.properties?.units || 0))
    const stride = Math.ceil(list.length / cap)
    const subsampled = []
    for (let i = 0; i < list.length; i += stride) subsampled.push(list[i])
    list = subsampled.slice(0, cap)
  }
  return { type: 'FeatureCollection', features: list }
}

/** Cap tract markers per state so small-lender states are not dropped by national subsampling. */
export function filterTractFeaturesPerState(features, { bounds = null, cap = Infinity, minPerState = 1 } = {}) {
  const byState = {}
  for (const f of features || []) {
    const st = String(f?.properties?.state || '').trim().toUpperCase()
    if (!st) continue
    const c = f?.geometry?.coordinates
    if (bounds) {
      if (!Array.isArray(c) || c.length < 2) continue
      if (!pointInBounds(Number(c[0]), Number(c[1]), bounds)) continue
    }
    if (!byState[st]) byState[st] = []
    byState[st].push(f)
  }

  const states = Object.keys(byState)
  if (!states.length) return { type: 'FeatureCollection', features: [] }

  const stateWeight = (st) =>
    byState[st].reduce((sum, f) => sum + (Number(f.properties?.units) || 0), 0)
  const totalWeight = states.reduce((sum, st) => sum + stateWeight(st), 0) || states.length

  const merged = []
  for (const st of states) {
    let stateFeats = [...byState[st]].sort(
      (a, b) => (b.properties?.units || 0) - (a.properties?.units || 0),
    )
    const weight = stateWeight(st)
    let stateCap = Math.max(
      minPerState,
      Math.round((weight / totalWeight) * cap),
    )
    stateCap = Math.min(stateCap, stateFeats.length)
    if (stateFeats.length > stateCap) {
      const stride = Math.ceil(stateFeats.length / stateCap)
      const subsampled = []
      for (let i = 0; i < stateFeats.length; i += stride) subsampled.push(stateFeats[i])
      stateFeats = subsampled.slice(0, stateCap)
    }
    merged.push(...stateFeats)
  }

  return { type: 'FeatureCollection', features: merged.slice(0, cap) }
}

/** @type {string[] | null} */
let manifestYears = null

async function availableTractYears() {
  if (manifestYears) return manifestYears
  const manifest = await fetchTractJson('data/geo-map/tracts/manifest.json')
  manifestYears = Array.isArray(manifest?.years) ? manifest.years.map(String) : ['2024', '2023', '2022']
  return manifestYears
}

/** Map panel year to nearest prebuilt tract asset year (never a newer filing year). */
async function resolveTractAssetYear(panelYear) {
  const want = String(panelYear || '2024')
  const years = await availableTractYears()
  if (years.includes(want)) return want

  const pref = Number(want)
  const notAfter = years.filter((y) => Number(y) <= pref).sort((a, b) => Number(b) - Number(a))
  if (notAfter[0]) return notAfter[0]

  // Manifest may lag behind on-disk tiles after a single-year geo rebuild.
  const direct = await fetchTractJson(`data/geo-map/tracts/${want}/_national-top.json`)
  if (direct?.features?.length) return want

  return years.sort((a, b) => Number(a) - Number(b))[0] || want
}

async function fetchTractJson(relativePath) {
  if (fetchCache.has(relativePath)) return fetchCache.get(relativePath)
  const p = fetch(publicAssetUrl(relativePath), { cache: 'default' })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
  cachePut(relativePath, p)
  return p
}

/** Preload manifest + national sample for a filing year. */
export function preloadTractAssets(year, { includeNational = true } = {}) {
  availableTractYears().then((years) => {
    const y = years.includes(String(year)) ? String(year) : years[0]
    if (includeNational && y) fetchTractJson(`data/geo-map/tracts/${y}/_national-top.json`)
  })
  fetchTractJson('data/geo-map/tracts/manifest.json')
}

/** Fetch prebuilt national-top tract layer (~2k highest-volume tracts). */
export async function fetchNationalTractSample(year) {
  const assetYear = await resolveTractAssetYear(year)
  return fetchTractJson(`data/geo-map/tracts/${assetYear}/_national-top.json`)
}

/** Fetch prebuilt full-state tract FeatureCollection. */
export async function fetchStateTractFeatures(year, stateCode) {
  const st = String(stateCode || '').trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(st)) return null
  const assetYear = await resolveTractAssetYear(year)
  return fetchTractJson(`data/geo-map/tracts/${assetYear}/${st}.json`)
}

/** Load tract markers for each state where the lender has FFIEC originated volume. */
export async function fetchLenderActiveStateTracts(year, stateBreakdown) {
  const active = (stateBreakdown || []).filter((row) => Number(row?.originated) > 0)
  if (!active.length) return null

  const ranked = [...active].sort(
    (a, b) => Number(b.originated) - Number(a.originated) || Number(b.volume) - Number(a.volume),
  )
  const toLoad = ranked.slice(0, MAX_LENDER_TRACT_STATES)
  const chunks = await mapWithConcurrency(toLoad, async (row) => {
    const st = String(row.state || '').trim().toUpperCase()
    const fc = await fetchStateTractFeatures(year, st)
    return fc?.features || []
  })

  const features = chunks.flat()
  if (!features.length) return null
  return { type: 'FeatureCollection', features }
}

/** @deprecated Use fetchLenderActiveStateTracts — kept for callers that pre-cap by market share. */
export async function fetchLenderBreakdownTracts(year, stateBreakdown, cap = CENSUS_TRACT_DOT_CAP) {
  const fc = await fetchLenderActiveStateTracts(year, stateBreakdown)
  if (!fc?.features?.length) return null
  const active = (stateBreakdown || []).filter((row) => Number(row?.originated) > 0)
  const totalOrig = active.reduce((sum, row) => sum + Number(row.originated), 0)
  const byState = {}
  for (const f of fc.features) {
    const st = String(f.properties?.state || '').trim().toUpperCase()
    if (!st) continue
    if (!byState[st]) byState[st] = []
    byState[st].push(f)
  }
  const features = []
  for (const row of active) {
    const st = String(row.state || '').trim().toUpperCase()
    const stateFeats = byState[st] || []
    if (!stateFeats.length) continue
    const share = Number(row.originated) / Math.max(1, totalOrig)
    const stateCap = Math.max(2, Math.min(stateFeats.length, Math.round(share * cap)))
    features.push(...stateFeats.slice(0, stateCap))
  }
  if (!features.length) return null
  return { type: 'FeatureCollection', features }
}

export function resolveTractCap({ mapZoom, mapSelectedState, inViewport }) {
  if (inViewport) return VIEWPORT_TRACT_DOT_CAP
  if (mapSelectedState && mapZoom >= 6.5) return STATE_TRACT_DOT_CAP
  return CENSUS_TRACT_DOT_CAP
}

/**
 * Load + filter tracts for the current map view using worker when available.
 * @param {object} opts
 * @param {number|string} opts.year
 * @param {number} opts.mapZoom
 * @param {string|null} opts.stateCode - selected or hovered state
 * @param {object|null} opts.bounds - { west, south, east, north }
 * @param {object|null} opts.lenderFocus - { insights, marketByState } (single-lender legacy)
 * @param {Array|null} opts.lenderFocusList - [{ lei, color, insights, marketByState }, ...] multi-lender
 * @param {boolean} [opts.lenderFocusPending] - LEI selected but FFIEC breakdown not loaded yet
 */
export async function buildTractLayerGeoJson(opts) {
  const year = String(opts.year || '2024')
  const mapZoom = Number(opts.mapZoom) || 0
  const stateCode = opts.stateCode ? String(opts.stateCode).toUpperCase() : null
  const inViewport = Boolean(opts.bounds) && mapZoom >= 7
  const cap = resolveTractCap({
    mapZoom,
    mapSelectedState: stateCode,
    inViewport,
  })

  const lenderFocusList = Array.isArray(opts.lenderFocusList) && opts.lenderFocusList.length > 0
    ? opts.lenderFocusList
    : null

  const lenderFocus = lenderFocusList ? null : opts.lenderFocus
  const lenderBreakdown = lenderFocus?.insights?.stateBreakdown

  if (opts.lenderFocusPending) {
    return { type: 'FeatureCollection', features: [] }
  }

  // Multi-lender path: union active states, per-lender share scaling, tagged with lenderColor
  if (lenderFocusList) {
    // Pending if any lender hasn't loaded insights yet
    if (lenderFocusList.some((l) => !l.insights?.stateBreakdown?.length)) {
      return { type: 'FeatureCollection', features: [] }
    }

    const allActiveStates = new Set()
    for (const lItem of lenderFocusList) {
      for (const st of lenderActiveStateCodes(lItem.insights)) allActiveStates.add(st)
    }

    if (stateCode && !allActiveStates.has(stateCode)) {
      return { type: 'FeatureCollection', features: [] }
    }

    let statesToLoad = stateCode ? [stateCode] : [...allActiveStates]
    if (!stateCode && statesToLoad.length > MAX_LENDER_TRACT_STATES) {
      const weight = new Map()
      for (const lItem of lenderFocusList) {
        for (const row of lItem.insights?.stateBreakdown || []) {
          const st = String(row.state || '').trim().toUpperCase()
          if (!st) continue
          weight.set(st, (weight.get(st) || 0) + Number(row.originated) || 0)
        }
      }
      statesToLoad = [...allActiveStates]
        .sort((a, b) => (weight.get(b) || 0) - (weight.get(a) || 0))
        .slice(0, MAX_LENDER_TRACT_STATES)
    }
    const stateFeaturesMap = {}
    await mapWithConcurrency(statesToLoad, async (st) => {
      const fc = await fetchStateTractFeatures(year, st)
      if (fc?.features?.length) stateFeaturesMap[st] = fc.features
    })

    const allFeatures = []
    for (const lItem of lenderFocusList) {
      const activeStates = new Set(lenderActiveStateCodes(lItem.insights))
      for (const st of activeStates) {
        if (stateCode && st !== stateCode) continue
        const stateFeats = stateFeaturesMap[st]
        if (!stateFeats?.length) continue
        const fc = applyLenderShareToTractFeatures(
          { type: 'FeatureCollection', features: stateFeats },
          lItem.insights,
          lItem.marketByState || {},
        )
        for (const f of fc.features || []) {
          if (!f) continue
          allFeatures.push({
            ...f,
            properties: { ...f.properties, lenderColor: lItem.color, lenderLei: lItem.lei },
          })
        }
      }
    }

    if (!allFeatures.length) return { type: 'FeatureCollection', features: [] }

    // Hard global cap — prevents compare-mode melt with 3+ lenders
    const payload = { features: allFeatures, bounds: inViewport ? opts.bounds : null, cap: Math.min(3000, cap) }
    try {
      return await workerRequest('FILTER', payload)
    } catch {
      return filterTractsMainThread(allFeatures, payload)
    }
  }

  if (lenderBreakdown?.length) {
    const activeStates = new Set(lenderActiveStateCodes(lenderFocus.insights))

    if (stateCode && !activeStates.has(stateCode)) {
      return { type: 'FeatureCollection', features: [] }
    }

    let features = []
    if (stateCode && mapZoom >= 6.5) {
      const fc = await fetchStateTractFeatures(year, stateCode)
      features = fc?.features || []
    } else {
      const fc = await fetchLenderActiveStateTracts(year, lenderBreakdown)
      features = fc?.features || []
    }

    if (!features.length) {
      return buildTractLayerLegacyFallback({
        ...opts,
        geoYear: opts.geoYear,
        countyEnrichment: opts.countyEnrichment,
        countyNames: opts.countyNames,
        lenderFocus: opts.lenderFocus,
      })
    }

    const payload = {
      features,
      bounds: inViewport ? opts.bounds : null,
      cap,
    }

    try {
      return await workerRequest('LENDER_OVERLAY', {
        ...payload,
        insights: lenderFocus.insights,
        marketByState: lenderFocus.marketByState || {},
      })
    } catch {
      const overlaid = applyLenderShareToTractFeatures(
        { type: 'FeatureCollection', features: payload.features },
        lenderFocus.insights,
        lenderFocus.marketByState || {},
      )
      return filterTractsMainThread(overlaid.features, { ...payload, perState: true })
    }
  }

  let baseFc = null
  if (stateCode && mapZoom >= 6.5) {
    baseFc = await fetchStateTractFeatures(year, stateCode)
  }
  if (!baseFc?.features?.length) {
    baseFc = await fetchNationalTractSample(year)
  }
  if (!baseFc?.features?.length) {
    return buildTractLayerLegacyFallback({
      ...opts,
      geoYear: opts.geoYear,
      countyEnrichment: opts.countyEnrichment,
      countyNames: opts.countyNames,
      lenderFocus: opts.lenderFocus,
    })
  }

  const payload = {
    features: baseFc.features,
    bounds: inViewport ? opts.bounds : null,
    cap,
  }

  try {
    return await workerRequest('FILTER', payload)
  } catch {
    return filterTractsMainThread(payload.features, payload)
  }
}

/** Legacy path when prebuilt tract assets are missing (dev without `npm run hmda:geo:tracts`). */
async function buildTractLayerLegacyFallback(opts) {
  const { loadTractCentroids, buildAllTractPoints } = await import('./geo-map-features.js')
  const centroids = await loadTractCentroids()
  if (!centroids || !Object.keys(centroids).length) return null

  const mapZoom = Number(opts.mapZoom) || 0
  const stateCode = opts.stateCode ? String(opts.stateCode).toUpperCase() : null
  const inViewport = Boolean(opts.bounds) && mapZoom >= 7
  const cap = resolveTractCap({
    mapZoom,
    mapSelectedState: stateCode,
    inViewport,
  })

  const built = buildAllTractPoints(
    opts.geoYear || {},
    opts.countyEnrichment || null,
    opts.countyNames || {},
    null,
    {
      centroids,
      stateFilter: stateCode && mapZoom >= 6 ? stateCode : null,
      cap,
      bounds: inViewport ? opts.bounds : null,
    },
  )

  let fc = { type: 'FeatureCollection', features: built.features || [] }
  if (opts.lenderFocus?.insights?.stateBreakdown?.length) {
    fc = applyLenderShareToTractFeatures(
      fc,
      opts.lenderFocus.insights,
      opts.lenderFocus.marketByState || {},
    )
    fc = filterTractFeaturesPerState(fc.features, {
      bounds: inViewport ? opts.bounds : null,
      cap,
    })
  }
  return fc
}
