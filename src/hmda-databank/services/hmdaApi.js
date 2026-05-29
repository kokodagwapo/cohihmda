/**
 * Client for Coheus HMDA API (FFIEC Data Browser proxy + static fallbacks).
 * @see https://ffiec.cfpb.gov/documentation/category/developer-apis
 */

import {
  publicAssetUrl,
  hmdaLendersJsonRelativePath,
  hmdaLendersBootstrapJsonRelativePath,
  geoMapSummaryRelativePath,
  geoDrilldownFullRelativePath,
} from '@hmda/utils/publicAssetUrl.js'

const API_PREFIX = String(import.meta.env.VITE_HMDA_API_BASE || '').replace(/\/$/, '')

/** Default: 2025 + previous 10 calendar years (matches server). */
export const HMDA_DEFAULT_ANCHOR_YEAR = 2025
export const HMDA_DEFAULT_LOOKBACK_YEARS = 10

/** Calendar years for anchor + lookback (2025 down through 2015). */
export function buildHmdaRequestedYears(
  anchor = HMDA_DEFAULT_ANCHOR_YEAR,
  lookback = HMDA_DEFAULT_LOOKBACK_YEARS,
) {
  const a = Number(anchor) || HMDA_DEFAULT_ANCHOR_YEAR
  const n = Math.max(0, Math.min(30, Number(lookback) || HMDA_DEFAULT_LOOKBACK_YEARS))
  const years = []
  for (let y = a; y > a - n - 1; y -= 1) years.push(y)
  return years
}

/** Add static MLAR rows for filing years not returned by the live FFIEC API (e.g. 2025). */
export function appendStaticLendersForMissingYears(apiLenders, staticLenders, requestedYears) {
  if (!Array.isArray(staticLenders) || staticLenders.length === 0) return apiLenders
  const want = new Set((requestedYears || []).map((y) => Number(y)))
  const have = new Set(apiLenders.map((l) => Number(l.dataYear)))
  const extra = staticLenders.filter((l) => {
    const y = Number(l.dataYear)
    return want.has(y) && !have.has(y)
  })
  return extra.length ? [...apiLenders, ...extra] : apiLenders
}

function apiUrl(path) {
  const p = path.startsWith('/') ? path : `/${path}`
  return API_PREFIX ? `${API_PREFIX}${p}` : p
}

async function fetchJson(url, opts = {}) {
  const startedAt = performance.now()
  const res = await fetch(url, {
    ...opts,
    headers: { Accept: 'application/json', ...(opts.headers || {}) },
  })
  const ms = Math.round(performance.now() - startedAt)
  const path = (() => {
    try { const u = new URL(url, window.location.origin); return `${u.pathname}${u.search}` } catch { return String(url).slice(0, 160) }
  })()
  const shouldLog =
    path.includes('/api/hmda') ||
    path.includes('/data/hmda') ||
    path.includes('/data/geo-drilldown') ||
    path.includes('/data/geo-map') ||
    path.includes('/api/mapbox-config')
  if (shouldLog) {
  }
  if (!res.ok) {
    const err = new Error(`${url} HTTP ${res.status}`)
    err.status = res.status
    throw err
  }
  const parseStartedAt = performance.now()
  const json = await res.json()
  if (shouldLog) {
  }
  return json
}

async function fetchJsonWithTimeout(url, opts = {}, timeoutMs = 8000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchJson(url, { ...opts, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

const FALLBACK_REQUESTED_YEARS = buildHmdaRequestedYears()

/** @returns {Promise<{ source: 'api' | 'static', meta?: object, years?: number[], yearsRequested?: number[], staticManifest?: object }>} */
export async function fetchHmdaMeta() {
  try {
    const meta = await fetchJson(apiUrl('/api/hmda/meta'), { cache: 'default' })
    return { source: 'api', ...meta }
  } catch {
    let staticManifest = null
    try {
      staticManifest = await fetchJson(publicAssetUrl('data/hmda-years-manifest.json'), { cache: 'default' })
    } catch {
      staticManifest = null
    }
    const lenderYears = staticManifest?.lenderYears?.map(Number).filter(Number.isFinite)
    const years = lenderYears?.length ? lenderYears : FALLBACK_REQUESTED_YEARS
    return {
      source: 'static',
      years,
      yearsRequested: years,
      staticManifest,
      larDetailMaxYear: staticManifest?.larDetailMaxYear,
    }
  }
}

/** Which years in anchor+lookback are live on FFIEC. */
export async function fetchHmdaYearWindow(opts = {}) {
  const anchor = opts.anchor ?? HMDA_DEFAULT_ANCHOR_YEAR
  const lookback = opts.lookback ?? HMDA_DEFAULT_LOOKBACK_YEARS
  return fetchJson(apiUrl(`/api/hmda/years?anchor=${anchor}&lookback=${lookback}`), { cache: 'default' })
}

/** All lender rows for every available year in the window (LEI × year panel). */
export async function fetchHmdaLendersMulti(opts = {}) {
  const anchor = opts.anchor ?? HMDA_DEFAULT_ANCHOR_YEAR
  const lookback = opts.lookback ?? HMDA_DEFAULT_LOOKBACK_YEARS
  return fetchJsonWithTimeout(
    apiUrl(`/api/hmda/lenders/multi?anchor=${anchor}&lookback=${lookback}`),
    { cache: 'default' },
    12000,
  )
}

/** When true, attempt live FFIEC lender API after static JSON (prod default; dev opt-in). */
export function isHmdaLendersLiveEnabled() {
  return (
    import.meta.env.VITE_HMDA_LENDERS_LIVE === '1' ||
    (import.meta.env.PROD && import.meta.env.VITE_HMDA_LENDERS_LIVE !== '0')
  )
}

function normalizeStaticLenderRows(raw) {
  if (Array.isArray(raw)) return raw
  if (Array.isArray(raw?.lenders)) return raw.lenders
  return []
}

/**
 * Fast bootstrap slice from a per-year static JSON (~6–20MB per year vs ~29MB full panel).
 * Per-year files exist for 2022–2025, eliminating the need to load the full panel when
 * the user switches years.
 * @param {number|string} [preferredYear]
 */
export async function fetchStaticHmdaLendersBootstrap(preferredYear = HMDA_DEFAULT_ANCHOR_YEAR) {
  const year = Number(preferredYear) || HMDA_DEFAULT_ANCHOR_YEAR

  // Try the per-year slice file first — much smaller than the full panel.
  try {
    const path = hmdaLendersBootstrapJsonRelativePath(year)
    const raw = await fetchJson(publicAssetUrl(path), { cache: 'default' })
    const lenders = normalizeStaticLenderRows(raw)
    if (lenders.length > 0) {
      return {
        source: 'static',
        lenders,
        meta: {
          ...(raw?.meta || {}),
          bootstrap: true,
          year,
          source: 'static JSON',
          path,
        },
        yearsRequested: [String(year)],
        yearsAvailable: [year],
      }
    }
  } catch {
    /* per-year file missing; fall through to full panel */
  }

  // Fallback: load the full panel and filter (only needed for years without a per-year file).
  const full = await fetchStaticHmdaLenders()
  if (!full?.lenders?.length) return null
  const slice = full.lenders.filter((l) => Number(l.dataYear) === year)
  if (!slice.length) return null
  return {
    source: 'static',
    lenders: slice,
    meta: { bootstrap: true, year, source: 'static JSON slice' },
    yearsRequested: [String(year)],
    yearsAvailable: [year],
  }
}

async function fetchHmdaLendersBootstrapFromApi(preferredYear = HMDA_DEFAULT_ANCHOR_YEAR) {
  const anchor = Number(preferredYear) || HMDA_DEFAULT_ANCHOR_YEAR
  const tryYears = [anchor, 2024, 2023, 2022].filter((y, i, arr) => y >= 2018 && arr.indexOf(y) === i)

  for (const year of tryYears) {
    try {
      const body = await fetchJsonWithTimeout(
        apiUrl(`/api/hmda/lenders?years=${year}`),
        { cache: 'default' },
        4000,
      )
      if (Array.isArray(body?.lenders) && body.lenders.length > 0) {
        return {
          source: 'api',
          lenders: body.lenders,
          meta: { ...(body.meta || {}), bootstrap: true, year },
          yearsRequested: [String(year)],
          yearsAvailable: [year],
        }
      }
    } catch (e) {
      console.warn(`[HMDA API] bootstrap lenders failed for ${year}:`, e?.message)
    }
  }

  return null
}

/**
 * Fast first paint — static single-year JSON first; API only when static missing and live mode on.
 */
export async function fetchHmdaLendersBootstrap(preferredYear = HMDA_DEFAULT_ANCHOR_YEAR) {
  const staticBoot = await fetchStaticHmdaLendersBootstrap(preferredYear)
  if (staticBoot?.lenders?.length) return staticBoot

  if (!isHmdaLendersLiveEnabled()) return null
  return fetchHmdaLendersBootstrapFromApi(preferredYear)
}

/**
 * Full multi-year lender panel — static JSON first; live FFIEC only when enabled and static missing.
 * @param {number|string} [preferredYear] — anchor year for the window (default 2025)
 */
export async function fetchHmdaLenders(preferredYear = HMDA_DEFAULT_ANCHOR_YEAR) {
  const anchor = Number(preferredYear) || HMDA_DEFAULT_ANCHOR_YEAR
  const requestedYears = buildHmdaRequestedYears(anchor, HMDA_DEFAULT_LOOKBACK_YEARS)

  const staticPack = await fetchStaticHmdaLenders()
  const staticResult = staticPack?.lenders?.length
    ? {
        ...staticPack,
        yearsRequested: requestedYears,
        meta: { ...(staticPack.meta || {}), yearsRequested: requestedYears },
      }
    : null

  if (staticResult) return staticResult

  if (!isHmdaLendersLiveEnabled()) {
    throw new Error('Lender data unavailable (static JSON missing)')
  }

  try {
    const body = await fetchHmdaLendersMulti({ anchor, lookback: HMDA_DEFAULT_LOOKBACK_YEARS })
    if (Array.isArray(body?.lenders) && body.lenders.length > 0) {
      const req =
        body.meta?.yearsRequested?.map(Number).filter(Boolean) || requestedYears
      let lenders = appendStaticLendersForMissingYears(body.lenders, staticPack?.lenders, req)
      if (staticPack?.lenders?.length) {
        const { mergeStaticInsightsIntoLenders } = await import('@hmda/services/hmdaInsightsEnrich.js')
        lenders = mergeStaticInsightsIntoLenders(lenders, staticPack.lenders)
      }
      return {
        source: staticPack?.lenders?.length ? 'api+static' : 'api',
        lenders,
        meta: { ...body.meta, yearsRequested: req },
        yearsAvailable: body.meta?.years,
        yearsRequested: req,
      }
    }
  } catch (e) {
    console.warn('[HMDA API] multi-year lenders failed:', e?.message)
  }

  const tryYears = [anchor, 2024, 2023, 2022].filter((y, i, arr) => y >= 2018 && arr.indexOf(y) === i)

  for (const year of tryYears) {
    try {
      const body = await fetchJsonWithTimeout(
        apiUrl(`/api/hmda/lenders?years=${year}`),
        { cache: 'default' },
        4000,
      )
      if (Array.isArray(body?.lenders) && body.lenders.length > 0) {
        let lenders = appendStaticLendersForMissingYears(body.lenders, staticPack?.lenders, requestedYears)
        if (staticPack?.lenders?.length) {
          const { mergeStaticInsightsIntoLenders } = await import('@hmda/services/hmdaInsightsEnrich.js')
          lenders = mergeStaticInsightsIntoLenders(lenders, staticPack.lenders)
        }
        return {
          source: staticPack?.lenders?.length ? 'api+static' : 'api',
          lenders,
          meta: {
            ...body.meta,
            yearsRequested: requestedYears,
            years: body.meta?.years || [year],
          },
          yearsRequested: requestedYears,
          yearsAvailable: body.meta?.years || [year],
        }
      }
    } catch (e) {
      console.warn(`[HMDA API] lenders fetch failed for ${year}:`, e?.message)
    }
  }

  if (staticPack?.lenders?.length) {
    return {
      ...staticPack,
      yearsRequested: requestedYears,
      meta: { ...(staticPack.meta || {}), yearsRequested: requestedYears },
    }
  }

  throw new Error('Lender data unavailable (FFIEC API and static JSON both failed)')
}

/** Multi-year geography drilldown from FFIEC. */
export async function fetchGeoDrilldownMulti(opts = {}) {
  const anchor = opts.anchor ?? HMDA_DEFAULT_ANCHOR_YEAR
  const lookback = opts.lookback ?? HMDA_DEFAULT_LOOKBACK_YEARS
  return fetchJsonWithTimeout(apiUrl(`/api/hmda/geo/drilldown/multi?anchor=${anchor}&lookback=${lookback}`), {
    cache: 'default',
  })
}

/** Merge year slices into a drilldown object (keeps static county/tract rows when present). */
export function mergeGeoDrilldownPayload(base, incoming, { preferIncomingTotals = false } = {}) {
  if (!incoming) return base || null
  if (!base) return incoming
  const merged = { ...base, meta: { ...(base.meta || {}), ...(incoming.meta || {}) } }
  for (const key of Object.keys(incoming)) {
    if (!/^\d{4}$/.test(key)) continue
    if (!merged[key]) {
      merged[key] = incoming[key]
      continue
    }
    const incomingStates = incoming[key]
    merged[key] = { ...merged[key] }
    for (const [st, row] of Object.entries(incomingStates)) {
      if (!merged[key][st]) {
        merged[key][st] = row
        continue
      }
      const prev = merged[key][st]
      merged[key][st] = {
        ...prev,
        units: preferIncomingTotals ? (row.units ?? prev.units) : (prev.units ?? row.units),
        volume: preferIncomingTotals ? (row.volume ?? prev.volume) : (prev.volume ?? row.volume),
        counties:
          Array.isArray(prev.counties) && prev.counties.length > 0 ? prev.counties : row.counties,
      }
    }
  }
  return merged
}

/** Single filing year from FFIEC (state totals; county/tract from static merge when available). */
export async function fetchGeoDrilldownYear(year = HMDA_DEFAULT_ANCHOR_YEAR) {
  const y = Number(year) || HMDA_DEFAULT_ANCHOR_YEAR
  return fetchJsonWithTimeout(apiUrl(`/api/hmda/geo/drilldown?years=${y}`), { cache: 'default' })
}

/** Hydrate one filing year from FFIEC into an existing drilldown bundle (e.g. static + 2025 live). */
export async function hydrateGeoDrilldownYear(base, year = HMDA_DEFAULT_ANCHOR_YEAR) {
  const y = Number(year) || HMDA_DEFAULT_ANCHOR_YEAR
  try {
    const liveYear = await fetchGeoDrilldownYear(y)
    if (!liveYear) return base || null
    return mergeGeoDrilldownPayload(base, liveYear, { preferIncomingTotals: true })
  } catch {
    return base || null
  }
}

/** Slim state-level map summary (~100–300 KB) for fast initial geography paint. */
export async function fetchGeoMapSummaryStatic(preferredYear = HMDA_DEFAULT_ANCHOR_YEAR) {
  const y = String(Number(preferredYear) || HMDA_DEFAULT_ANCHOR_YEAR)
  try {
    const summary = await fetchJson(publicAssetUrl(geoMapSummaryRelativePath(y)), { cache: 'default' })
    if (summary?.[y] && typeof summary[y] === 'object') {
      return { source: 'static-summary', data: summary, partial: true }
    }
  } catch {
    /* optional */
  }
  return null
}

/** Full county/tract drilldown JSON (~7 MB) — lazy-loaded after map summary. */
export async function fetchGeoDrilldownFullStatic() {
  const staticUrl = publicAssetUrl(geoDrilldownFullRelativePath())
  try {
    const staticGeo = await fetchJson(staticUrl, { cache: 'default' })
    if (staticGeo) return { source: 'static-full', data: staticGeo, partial: false }
  } catch {
    /* optional */
  }
  return null
}

/** Fast path: slim map summary first, then API; full drilldown deferred. */
export async function fetchGeoDrilldownStatic(preferredYear = HMDA_DEFAULT_ANCHOR_YEAR) {
  const y = Number(preferredYear) || HMDA_DEFAULT_ANCHOR_YEAR
  const summaryFast = await fetchGeoMapSummaryStatic(y)
  if (summaryFast?.data) return summaryFast

  const staticUrl = publicAssetUrl(geoDrilldownFullRelativePath())
  const loadStatic = async () => {
    try {
      const staticGeo = await fetchJson(staticUrl, { cache: 'default' })
      if (staticGeo) return staticGeo
    } catch {
      /* optional */
    }
    return null
  }
  const preferStatic = y >= 2025
  if (preferStatic) {
    const staticGeo = await loadStatic()
    if (staticGeo) return { source: 'static', data: staticGeo, partial: false }
  }
  try {
    const liveYear = await fetchGeoDrilldownYear(y)
    if (liveYear) return { source: 'api', data: liveYear, partial: false }
  } catch {
    /* fallback to static */
  }
  const staticGeo = await loadStatic()
  if (staticGeo) return { source: 'static', data: staticGeo, partial: false }
  return null
}

/** Geography drilldown — prefers API/warehouse; static MLAR merge is opt-in for legacy deployments. */
export async function fetchGeoDrilldown(preferredYear = HMDA_DEFAULT_ANCHOR_YEAR) {
  const anchor = Number(preferredYear) || HMDA_DEFAULT_ANCHOR_YEAR

  let live = null
  try {
    live = await fetchGeoDrilldownMulti({ anchor, lookback: HMDA_DEFAULT_LOOKBACK_YEARS })
  } catch (e) {
    console.warn('[HMDA API] multi-year geo failed:', e?.message)
  }

  if (!live) {
    const tryYears = [anchor, 2024, 2023, 2022].filter((y, i, arr) => y >= 2018 && arr.indexOf(y) === i)
    for (const year of tryYears) {
      try {
        live = await fetchJsonWithTimeout(apiUrl(`/api/hmda/geo/drilldown?years=${year}`), { cache: 'default' })
        if (live) break
      } catch (e) {
        console.warn(`[HMDA API] geo live fetch failed for ${year}:`, e?.message)
        live = null
      }
    }
  }

  let staticGeo = null
  const staticMergeEnabled = import.meta.env.VITE_HMDA_GEO_STATIC_MERGE === '1'
  if (staticMergeEnabled || !live) {
    try {
      staticGeo = await fetchJson(publicAssetUrl(geoDrilldownFullRelativePath()), { cache: 'default' })
    } catch {
      /* static geo optional */
    }
  }

  if (live && staticGeo) {
    const merged = mergeGeoDrilldownPayload(live, staticGeo)
    merged.meta = {
      ...(merged.meta || {}),
      mergedWithStatic: true,
      staticNote:
        'County and census tract drilldown from deployed MLAR extract; state totals from FFIEC API.',
    }
    return { source: 'api+static', data: merged }
  }

  if (live) {
    return { source: 'api', data: live }
  }

  if (staticGeo) {
    return { source: 'static', data: staticGeo }
  }

  throw new Error('Geography data unavailable (API and static file both failed)')
}

export async function fetchLenderFfiecAggregations({ year, lei, actionsTaken = '1,2,3,4,5,6,7,8' }) {
  const params = new URLSearchParams({
    years: String(year),
    leis: String(lei).trim().toUpperCase(),
    actions_taken: actionsTaken,
  })
  return fetchJson(apiUrl(`/api/hmda/ffiec/aggregations?${params}`), { cache: 'default' })
}

export async function fetchLenderInsightsBatch({ year, leis, states = false, medians = false, demographics = false }) {
  const list = (leis || []).map((s) => String(s).trim().toUpperCase()).filter(Boolean)
  if (list.length === 0) throw new Error('No LEIs provided')
  const params = new URLSearchParams({
    years: String(year),
    leis: list.join(','),
    states: states ? '1' : '0',
    medians: medians ? '1' : '0',
    demographics: demographics ? '1' : '0',
  })
  return fetchJson(apiUrl(`/api/hmda/ffiec/lender-insights?${params}`), { cache: 'default' })
}

export async function fetchStaticHmdaLenders() {
  try {
    const path = hmdaLendersJsonRelativePath()
    const raw = await fetchJson(publicAssetUrl(path), { cache: 'default' })
    const lenders = normalizeStaticLenderRows(raw)
    return { source: 'static', lenders, meta: { source: 'static JSON', path } }
  } catch {
    return null
  }
}

export async function fetchWarehouseStats() {
  try {
    return await fetchJson(apiUrl('/api/hmda/warehouse/stats'), { cache: 'default' })
  } catch {
    return { ready: false, source: 'static' }
  }
}

export async function fetchLenderQuarterHistory({ lei, year }) {
  if (!lei) return { quarters: [] }
  try {
    const params = new URLSearchParams({ lei: String(lei).trim().toUpperCase(), years: String(year) })
    return await fetchJson(apiUrl(`/api/hmda/lenders/quarters?${params}`), { cache: 'default' })
  } catch {
    return { quarters: [] }
  }
}

export async function fetchProductDimensions({ year, lei = null }) {
  try {
    const params = new URLSearchParams({ years: String(year) })
    if (lei) params.set('lei', String(lei).trim().toUpperCase())
    return await fetchJson(apiUrl(`/api/hmda/products/dimensions?${params}`), { cache: 'default' })
  } catch {
    return { dimensions: {} }
  }
}

export async function probeHmdaApi() {
  try {
    const meta = await fetchHmdaMeta()
    return meta.source === 'api'
  } catch {
    return false
  }
}
