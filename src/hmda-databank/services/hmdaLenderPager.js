/**
 * Paginated lender panel — API first, static page files fallback, full JSON only when filtering offline.
 */
import { publicAssetUrl } from '@hmda/utils/publicAssetUrl.js'
import { HMDA_DEFAULT_ANCHOR_YEAR } from '@hmda/services/hmdaApi.js'

const API_PREFIX = String(import.meta.env.VITE_HMDA_API_BASE || '').replace(/\/$/, '')

/** @type {Map<string, { rows: object[], exportedAt: string|null }>} */
const fullStaticCache = new Map()

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
  const path = (() => {
    try { const u = new URL(url, window.location.origin); return `${u.pathname}${u.search}` } catch { return String(url).slice(0, 160) }
  })()
  if (!res.ok) {
    const err = new Error(`${url} HTTP ${res.status}`)
    err.status = res.status
    throw err
  }
  const parseStartedAt = performance.now()
  const json = await res.json()
  return json
}

export function hasActiveLenderFilters(params = {}) {
  return Boolean(
    String(params.q || '').trim() ||
      (params.typeF && params.typeF !== 'all') ||
      (params.statusF && params.statusF !== 'all') ||
      (params.channelF && params.channelF !== 'all') ||
      (params.prodF && params.prodF !== 'all'),
  )
}

function isDefaultBrowseQuery(params = {}) {
  const sort = params.sort || 'originations'
  return (
    !hasActiveLenderFilters(params) &&
    (sort === 'originations' || sort === 'units') &&
    (params.dir || 'desc') === 'desc'
  )
}

function normalizeRows(raw) {
  if (Array.isArray(raw?.lenders)) return raw.lenders
  if (Array.isArray(raw)) return raw
  return []
}

function resolveStaticYear(params = {}) {
  return String(params.years ?? HMDA_DEFAULT_ANCHOR_YEAR)
}

function staticSingleYearJsonPath(year) {
  const y = String(year)
  if (y === String(HMDA_DEFAULT_ANCHOR_YEAR)) {
    return 'data/hmda-lenders-2025-only.json'
  }
  return 'data/lenders-from-hmda.json'
}

function staticPagesDirForYear(year) {
  const y = String(year)
  if (y === '2025') return 'data/hmda-lenders-2025-pages'
  const generic = `data/hmda-lenders-${y}-pages`
  return generic
}

function staticManifestPathForYear(year) {
  const y = String(year)
  if (y === '2025') return 'data/hmda-lenders-2025-manifest.json'
  return `data/hmda-lenders-${y}-manifest.json`
}

async function loadFullStaticRows(year) {
  const y = resolveStaticYear({ years: year })
  const hit = fullStaticCache.get(y)
  if (hit?.rows?.length) return hit

  const raw = await fetchJson(publicAssetUrl(staticSingleYearJsonPath(y)), { cache: 'default' })
  let rows = normalizeRows(raw)
  if (y !== String(HMDA_DEFAULT_ANCHOR_YEAR)) {
    rows = rows.filter((l) => Number(l.dataYear) === Number(y))
  }
  const pack = {
    rows,
    exportedAt: raw?.meta?.exportedAt || null,
  }
  fullStaticCache.set(y, pack)
  return pack
}

async function queryViaStaticPages(params) {
  const year = resolveStaticYear(params)
  const page = Math.max(0, Number(params.page) || 0)
  const pagesDir = staticPagesDirForYear(year)

  if (year !== '2025') {
    try {
      const raw = await fetchJson(publicAssetUrl(`${pagesDir}/page-${page}.json`), { cache: 'default' })
      if (Number(raw?.meta?.dataYear) === Number(year)) {
        return {
          source: 'static-page',
          page: raw.meta?.page ?? page,
          pageSize: raw.meta?.pageSize ?? params.pageSize ?? 20,
          total: raw.meta?.total ?? raw.lenders?.length ?? 0,
          totalPages: raw.meta?.totalPages ?? 1,
          lenders: normalizeRows(raw),
          meta: raw.meta || {},
        }
      }
    } catch {
      /* fall through to full static query */
    }
    return queryViaStaticFull(params)
  }

  const raw = await fetchJson(publicAssetUrl(`${pagesDir}/page-${page}.json`), { cache: 'default' })
  return {
    source: 'static-page',
    page: raw.meta?.page ?? page,
    pageSize: raw.meta?.pageSize ?? params.pageSize ?? 20,
    total: raw.meta?.total ?? raw.lenders?.length ?? 0,
    totalPages: raw.meta?.totalPages ?? 1,
    lenders: normalizeRows(raw),
    meta: raw.meta || {},
  }
}

async function queryViaStaticFull(params) {
  const { queryLenderRows } = await import('@hmda/services/hmdaLenderQuery.js')
  const year = resolveStaticYear(params)
  const pack = await loadFullStaticRows(year)
  const result = queryLenderRows(pack.rows, { ...params, years: year })
  const rankOffset = result.page * result.pageSize
  return {
    source: 'static-full',
    ...result,
    lenders: result.lenders.map((row, idx) => ({ ...row, rank: rankOffset + idx + 1 })),
    meta: { exportedAt: pack.exportedAt, dataYear: year },
  }
}

async function buildStaticManifestFromRows(year, rows, exportedAt) {
  const { ALL_PRODUCTS } = await import('@hmda/services/hmdaLenderQuery.js').catch(() => ({ ALL_PRODUCTS: [] }))
  const prodCounts = { all: rows.length }
  for (const p of ['Conventional', 'FHA', 'VA', 'USDA', 'Non-QM', 'Jumbo', 'HELOC', 'Construction']) {
    prodCounts[p] = rows.filter((l) => Array.isArray(l.products) && l.products.includes(p)).length
  }
  return {
    source: 'static-derived',
    exportedAt,
    dataYear: Number(year),
    recordCount: rows.length,
    etag: exportedAt || String(Date.now()),
    prodCounts,
    channelCounts: { all: rows.length },
  }
}

/**
 * @param {object} params
 * @returns {Promise<object>}
 */
export async function fetchLenderManifest(params = {}) {
  const year = params.years ?? HMDA_DEFAULT_ANCHOR_YEAR
  try {
    const body = await fetchJson(apiUrl(`/api/hmda/lenders/manifest?years=${year}`), { cache: 'default' })
    return { source: 'api', ...body }
  } catch {
    const manifestPaths = [staticManifestPathForYear(year)]
    for (const rel of manifestPaths) {
      try {
        const body = await fetchJson(publicAssetUrl(rel), { cache: 'default' })
        if (Number(body?.dataYear) === Number(year) || !body?.dataYear) {
          return { source: 'static', ...body, dataYear: Number(body.dataYear || year) }
        }
      } catch {
        /* try next */
      }
    }
    const pack = await loadFullStaticRows(year)
    return buildStaticManifestFromRows(year, pack.rows, pack.exportedAt)
  }
}

export async function fetchLenderQuery(params = {}) {
  const year = params.years ?? HMDA_DEFAULT_ANCHOR_YEAR
  const qs = new URLSearchParams({
    years: String(year),
    page: String(Math.max(0, Number(params.page) || 0)),
    pageSize: String(params.pageSize ?? 20),
    sort: params.sort || 'dollarVol',
    dir: params.dir || 'desc',
  })
  if (params.q) qs.set('q', params.q)
  if (params.typeF && params.typeF !== 'all') qs.set('typeF', params.typeF)
  if (params.statusF && params.statusF !== 'all') qs.set('statusF', params.statusF)
  if (params.channelF && params.channelF !== 'all') qs.set('channelF', params.channelF)
  if (params.prodF && params.prodF !== 'all') qs.set('prodF', params.prodF)

  try {
    const body = await fetchJson(apiUrl(`/api/hmda/lenders/query?${qs}`), { cache: 'default' })
    return { source: 'api', ...body }
  } catch {
    if (isDefaultBrowseQuery(params)) {
      return queryViaStaticPages(params)
    }
    return queryViaStaticFull(params)
  }
}

export async function fetchLenderSuggest(params = {}) {
  const year = params.years ?? HMDA_DEFAULT_ANCHOR_YEAR
  const q = String(params.q || '').trim()
  if (q.length < 2) return []
  const limit = params.limit ?? 8
  try {
    const body = await fetchJson(
      apiUrl(`/api/hmda/lenders/suggest?years=${year}&q=${encodeURIComponent(q)}&limit=${limit}`),
      { cache: 'default' },
    )
    return body.lenders || []
  } catch {
    const pack = await loadFullStaticRows(year)
    const { suggestLenderRows } = await import('@hmda/services/hmdaLenderQuery.js')
    return suggestLenderRows(pack.rows, q, limit)
  }
}

function productSummaryMatchesYear(body, year) {
  const y = Number(year)
  return Boolean(body?.products?.length) && Number(body?.meta?.dataYear) === y
}

export async function fetchProductSummary(params = {}) {
  const year = String(params.years ?? HMDA_DEFAULT_ANCHOR_YEAR)
  try {
    const body = await fetchJson(apiUrl(`/api/hmda/products/summary?years=${year}`), { cache: 'default' })
    if (!productSummaryMatchesYear(body, year)) {
      throw new Error(`Product summary year mismatch (expected ${year})`)
    }
    return { source: 'api', ...body }
  } catch {
    const staticPaths = [`data/hmda-products-summary-${year}.json`]
    for (const rel of staticPaths) {
      try {
        const body = await fetchJson(publicAssetUrl(rel), { cache: 'default' })
        if (productSummaryMatchesYear(body, year)) {
          return { source: 'static', ...body }
        }
      } catch {
        /* try next static path */
      }
    }
    return null
  }
}

export async function fetchHmdaSyncCheck(params = {}) {
  const year = params.years ?? HMDA_DEFAULT_ANCHOR_YEAR
  try {
    return await fetchJson(apiUrl(`/api/hmda/sync/check?years=${year}`), { cache: 'default' })
  } catch {
    const manifest = await fetchLenderManifest({ years: year })
    return {
      dataYear: year,
      staticExportedAt: manifest.exportedAt || null,
      changed: false,
      source: manifest.source || 'static',
    }
  }
}

export function clearLenderPagerCache() {
  fullStaticCache.clear()
}
