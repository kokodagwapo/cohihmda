/**
 * FFIEC HMDA Data Browser API client (official public source).
 * @see https://ffiec.cfpb.gov/documentation/api/data-browser/
 * @see https://github.com/cfpb/hmda-platform
 */

export const FFIEC_DATA_BROWSER_BASE = 'https://ffiec.cfpb.gov/v2/data-browser-api/view'

/**
 * Default year window: 2025 + previous 10 calendar years (requested range).
 * Live availability is resolved via `/api/hmda/years` (FFIEC currently returns 2018–2024).
 */
export const HMDA_DEFAULT_ANCHOR_YEAR = 2025
export const HMDA_DEFAULT_LOOKBACK_YEARS = 10

/** Newest-first list for docs/fallback when discovery has not run. */
export const HMDA_API_YEARS = [2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015]

const USER_AGENT = 'coheus-site/1.0 (HMDA FFIEC proxy; https://ffiec.cfpb.gov/documentation/category/developer-apis)'

/** @param {number} ttlMs */
export function createFfiecCache(ttlMs = 6 * 3600 * 1000) {
  /** @type {Map<string, { body: unknown, exp: number }>} */
  const map = new Map()
  return {
    get(key) {
      const hit = map.get(key)
      if (!hit || hit.exp <= Date.now()) return null
      return hit.body
    },
    set(key, body) {
      map.set(key, { body, exp: Date.now() + ttlMs })
    },
    cacheControlMaxAge(key) {
      const hit = map.get(key)
      if (!hit) return 0
      return Math.max(0, Math.floor((hit.exp - Date.now()) / 1000))
    },
  }
}

/**
 * @param {string} endpoint - e.g. `aggregations`, `filers`, `nationwide/aggregations`
 * @param {Record<string, string | number | undefined>} params
 * @param {{ cache?: ReturnType<typeof createFfiecCache>, timeoutMs?: number, signal?: AbortSignal }} [opts]
 */
export async function ffiecDataBrowserFetch(endpoint, params = {}, opts = {}) {
  const { cache, timeoutMs = 25000, signal } = opts
  const clean = Object.entries(params)
    .filter(([, v]) => v != null && String(v).trim() !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => [k, String(v).trim()])

  const cacheKey = `${endpoint}|${clean.map(([k, v]) => `${k}=${v}`).join('&')}`
  if (cache) {
    const hit = cache.get(cacheKey)
    if (hit) return { json: hit, cacheKey, fromCache: true, cacheMaxAge: cache.cacheControlMaxAge(cacheKey) }
  }

  const u = new URL(`${FFIEC_DATA_BROWSER_BASE}/${endpoint}`)
  for (const [k, v] of clean) u.searchParams.set(k, v)

  const controller = new AbortController()
  const onAbort = () => controller.abort()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  const t = setTimeout(() => controller.abort(), timeoutMs)

  let res
  try {
    res = await fetch(u.toString(), {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: controller.signal,
    })
  } finally {
    clearTimeout(t)
    if (signal) signal.removeEventListener('abort', onAbort)
  }

  const text = await res.text()
  if (!res.ok) {
    const err = new Error(`FFIEC HTTP ${res.status}`)
    err.status = res.status
    err.body = text.slice(0, 600)
    throw err
  }

  let json
  try {
    json = JSON.parse(text)
  } catch {
    const err = new Error('Invalid JSON from FFIEC')
    err.status = 502
    throw err
  }

  if (json?.errorType || (json?.message && !json?.aggregations && !json?.institutions)) {
    const err = new Error(json.message || json.errorType || 'FFIEC API error')
    err.status = 502
    err.ffiec = json
    throw err
  }

  if (cache) cache.set(cacheKey, json)
  return {
    json,
    cacheKey,
    fromCache: false,
    cacheMaxAge: cache ? Math.floor((cache.map?.get?.(cacheKey)?.exp - Date.now()) / 1000) : 0,
  }
}

export async function ffiecAggregations(params, opts) {
  return ffiecDataBrowserFetch('aggregations', params, opts)
}

export async function ffiecNationwideAggregations(params, opts) {
  return ffiecDataBrowserFetch('nationwide/aggregations', params, opts)
}

export async function ffiecFilers(params, opts) {
  return ffiecDataBrowserFetch('filers', params, opts)
}

/** Run async tasks with bounded concurrency. */
export async function mapPool(items, fn, concurrency = 6) {
  const results = new Array(items.length)
  let i = 0
  async function worker() {
    while (i < items.length) {
      const idx = i++
      results[idx] = await fn(items[idx], idx)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return results
}

export function parseYearParam(raw, fallback = 2024) {
  const y = parseInt(String(raw || '').trim(), 10)
  if (!/^\d{4}$/.test(String(raw || '').trim()) || !Number.isFinite(y)) return fallback
  if (y < 2018 || y > 2035) return fallback
  return y
}

export function validateLei(lei) {
  return /^[A-Z0-9]{20}$/.test(String(lei || '').trim().toUpperCase())
}
