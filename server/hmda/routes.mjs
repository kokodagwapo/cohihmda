import {
  createFfiecCache,
  ffiecAggregations,
  ffiecFilers,
  HMDA_API_YEARS,
  HMDA_DEFAULT_ANCHOR_YEAR,
  HMDA_DEFAULT_LOOKBACK_YEARS,
  parseYearParam,
  validateLei,
} from './ffiec-client.mjs'
import { buildLendersFromFilers, buildLendersFromFilersMultiYear } from './lenders-service.mjs'
import { buildMultiYearGeoDrilldown, buildStateGeoForYear, buildStateSummary, wrapGeoDrilldown } from './geo-service.mjs'
import { buildLenderInsightsBatch } from './lender-insights-service.mjs'
import { resolveHmdaYearWindow } from './years-service.mjs'
import { loadYearsManifest, mergeYearWindowWithManifest, mergeYearWindowWithWarehouse } from './years-manifest.mjs'
import { getManifestFromPack, loadLenderPack } from './static-lenders-store.mjs'
import { queryLenderRows, suggestLenderRows } from './lender-query.mjs'
import { buildProductSummary } from './product-summary.mjs'
import { registerLenderRegistryRoutes } from './lender-registry.mjs'
import { useHmdaWarehouse, isWarehouseReady } from './data-source.mjs'
import { buildCountyGeoForState, buildTractGeoQuery } from './geo-service.mjs'

const HMDA_FFIRC_CACHE_MS = Math.min(
  86400000,
  Math.max(60000, parseInt(String(process.env.HMDA_FFIRC_CACHE_MS || `${6 * 3600 * 1000}`), 10) || 6 * 3600 * 1000),
)

/** @type {ReturnType<typeof createFfiecCache>} */
let ffiecCache
/** @type {Map<string, Promise<unknown>>} */
const inflight = new Map()

function getCache() {
  if (!ffiecCache) ffiecCache = createFfiecCache(HMDA_FFIRC_CACHE_MS)
  return ffiecCache
}

function cacheHeader(res, cacheKey, cache) {
  const maxAge = cache?.cacheControlMaxAge?.(cacheKey) ?? Math.floor(HMDA_FFIRC_CACHE_MS / 1000)
  res.set('Cache-Control', `public, max-age=${maxAge}`)
}

function dedupe(key, fn) {
  if (inflight.has(key)) return inflight.get(key)
  const p = Promise.resolve()
    .then(fn)
    .finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

/**
 * Register HMDA Data Browser proxy routes on the Express app.
 * @param {import('express').Express} app
 */
function parseLookback(raw) {
  const n = parseInt(String(raw ?? '').trim(), 10)
  if (!Number.isFinite(n) || n < 0) return HMDA_DEFAULT_LOOKBACK_YEARS
  return Math.min(30, n)
}

export function registerHmdaDataRoutes(app) {
  registerLenderRegistryRoutes(app)
  app.get('/api/hmda/meta', async (_req, res) => {
    try {
      const window = await dedupe('meta|years', () =>
        resolveHmdaYearWindow(HMDA_DEFAULT_ANCHOR_YEAR, HMDA_DEFAULT_LOOKBACK_YEARS, getCache()),
      )
      res.set('Cache-Control', 'public, max-age=3600')
      const manifest = loadYearsManifest()
      const mergedWindow = mergeYearWindowWithManifest(window, manifest)
      const withWarehouse = await mergeYearWindowWithWarehouse(mergedWindow)
      res.json({
        source: 'FFIEC HMDA Data Browser API',
        docs: 'https://ffiec.cfpb.gov/documentation/category/developer-apis',
        platform: 'https://github.com/cfpb/hmda-platform',
        years: withWarehouse.lenderYearsAvailable?.length ? withWarehouse.lenderYearsAvailable : window.available,
        yearsRequested: window.requested,
        yearsUnavailable: window.unavailable,
        yearWindow: withWarehouse,
        staticManifest: withWarehouse.staticManifest || null,
        endpoints: {
          years: '/api/hmda/years?anchor=2025&lookback=10',
          lenders: '/api/hmda/lenders?years=YYYY',
          lendersManifest: '/api/hmda/lenders/manifest?years=2025',
          lendersQuery: '/api/hmda/lenders/query?years=2025&page=0&pageSize=20',
          lendersSuggest: '/api/hmda/lenders/suggest?q=…',
          lendersQuarters: '/api/hmda/lenders/quarters?lei=…&years=2025',
          productsSummary: '/api/hmda/products/summary?years=2025',
          productDimensions: '/api/hmda/products/dimensions?lei=…&years=2025',
          syncCheck: '/api/hmda/sync/check?years=2025',
          lendersMulti: '/api/hmda/lenders/multi?anchor=2025&lookback=10',
          geoDrilldown: '/api/hmda/geo/drilldown?years=YYYY',
          geoDrilldownMulti: '/api/hmda/geo/drilldown/multi?anchor=2025&lookback=10',
          geoState: '/api/hmda/geo/state/:state?years=YYYY',
          geoCounty: '/api/hmda/geo/county?years=YYYY&state=CA',
          geoTract: '/api/hmda/geo/tract?years=YYYY&state=CA',
          warehouseStats: '/api/hmda/warehouse/stats',
          filers: '/api/hmda/ffiec/filers?years=YYYY',
          aggregations: '/api/hmda/ffiec/aggregations?years=YYYY&leis=…',
          lenderInsights: '/api/hmda/ffiec/lender-insights?years=YYYY&leis=…&states=0|1&medians=0|1',
        },
        dataSource: useHmdaWarehouse() ? 'database' : 'static',
      })
    } catch (e) {
      res.set('Cache-Control', 'public, max-age=300')
      res.json({
        source: 'FFIEC HMDA Data Browser API',
        years: HMDA_API_YEARS,
        yearsRequested: HMDA_API_YEARS,
        error: e.message,
      })
    }
  })

  /** Discover which years in anchor+lookback window are on the public FFIEC API. */
  app.get('/api/hmda/years', async (req, res) => {
    try {
      const anchor = parseYearParam(req.query.anchor, HMDA_DEFAULT_ANCHOR_YEAR)
      const lookback = parseLookback(req.query.lookback)
      const cacheKey = `years|${anchor}|${lookback}`
      const window = await dedupe(cacheKey, () => resolveHmdaYearWindow(anchor, lookback, getCache()))
      cacheHeader(res, cacheKey, getCache())
      res.json(await mergeYearWindowWithWarehouse(mergeYearWindowWithManifest(window)))
    } catch (e) {
      console.error('[HMDA years API]', e.message)
      res.status(502).json({ error: e.message || 'Failed to resolve HMDA years' })
    }
  })

  /**
   * Lender panel for anchor year + lookback (2025 and previous 10 years by default).
   * Returns all rows where FFIEC has filers data (currently 2018–2024).
   */
  app.get('/api/hmda/lenders/multi', async (req, res) => {
    try {
      const anchor = parseYearParam(req.query.anchor, HMDA_DEFAULT_ANCHOR_YEAR)
      const lookback = parseLookback(req.query.lookback)
      const cacheKey = `lenders|multi|${anchor}|${lookback}`
      const payload = await dedupe(cacheKey, async () => {
        const window = await resolveHmdaYearWindow(anchor, lookback, getCache())
        if (window.available.length === 0) {
          throw new Error('No HMDA filing years available from FFIEC for this window')
        }
        const multi = await buildLendersFromFilersMultiYear(window.available, getCache())
        return {
          meta: {
            source: 'FFIEC HMDA Data Browser API',
            anchorYear: anchor,
            lookback,
            years: multi.years,
            yearsRequested: window.requested,
            yearsUnavailable: window.unavailable,
            count: multi.count,
            live: true,
          },
          lenders: multi.lenders,
          byYear: multi.byYear,
        }
      })
      cacheHeader(res, cacheKey, getCache())
      res.json(payload)
    } catch (e) {
      console.error('[HMDA lenders multi API]', e.message)
      res.status(502).json({ error: e.message || 'Failed to load multi-year lenders from FFIEC' })
    }
  })

  /** Lender panel — static JSON when FFIEC unavailable; live filers list otherwise. */
  app.get('/api/hmda/lenders', async (req, res) => {
    try {
      const requestedYear = parseYearParam(req.query.years, HMDA_DEFAULT_ANCHOR_YEAR)
      const cacheKey = `lenders|${requestedYear}`
      const payload = await dedupe(cacheKey, async () => {
        const window = await resolveHmdaYearWindow(requestedYear, 0, getCache())
        const ffiecServesYear = window.available?.includes(Number(requestedYear))
        if (ffiecServesYear) {
          try {
            const lenders = await buildLendersFromFilers(requestedYear, getCache())
            return {
              meta: {
                source: 'FFIEC HMDA Data Browser API',
                year: requestedYear,
                requestedYear,
                fallbackApplied: false,
                count: lenders.length,
                live: true,
              },
              lenders,
            }
          } catch (e) {
            console.warn('[HMDA lenders API] FFIEC filers failed, trying static JSON:', e.message)
          }
        }
        const pack = await loadLenderPack(requestedYear)
        return {
          meta: {
            source: pack.meta?.source || 'static JSON',
            year: requestedYear,
            requestedYear,
            exportedAt: pack.meta?.exportedAt || null,
            fallbackApplied: !ffiecServesYear,
            count: pack.lenders?.length || 0,
            live: false,
          },
          lenders: pack.lenders || [],
        }
      })
      cacheHeader(res, cacheKey, getCache())
      res.json(payload)
    } catch (e) {
      console.error('[HMDA lenders API]', e.message)
      res.status(502).json({ error: e.message || 'Failed to load lenders' })
    }
  })

  /** Manifest for paginated lender panel (facet counts, etag for morning sync). */
  app.get('/api/hmda/lenders/manifest', async (req, res) => {
    try {
      const year = parseYearParam(req.query.years, HMDA_DEFAULT_ANCHOR_YEAR)
      const cacheKey = `lenders|manifest|${year}`
      const body = await dedupe(cacheKey, async () => {
        if (useHmdaWarehouse() && (await isWarehouseReady())) {
          const { getManifestFromDb } = await import('./lender-warehouse-store.mjs')
          return getManifestFromDb(year)
        }
        const pack = await loadLenderPack(year)
        return getManifestFromPack(pack)
      })
      res.set('Cache-Control', 'public, max-age=3600')
      res.json(body)
    } catch (e) {
      console.error('[HMDA lenders manifest]', e.message)
      res.status(502).json({ error: e.message || 'Failed to load lender manifest' })
    }
  })

  /** Paginated lender query — filter, sort, page over warehouse or static JSON pack. */
  app.get('/api/hmda/lenders/query', async (req, res) => {
    try {
      const year = parseYearParam(req.query.years, HMDA_DEFAULT_ANCHOR_YEAR)
      const page = Math.max(0, parseInt(String(req.query.page || '0'), 10) || 0)
      const pageSize = Math.max(1, Math.min(100, parseInt(String(req.query.pageSize || '20'), 10) || 20))
      const cacheKey = `lenders|query|${year}|${page}|${pageSize}|${req.url.split('?')[1] || ''}`
      const body = await dedupe(cacheKey, async () => {
        const params = {
          q: req.query.q,
          typeF: req.query.typeF,
          statusF: req.query.statusF,
          channelF: req.query.channelF,
          prodF: req.query.prodF,
          sort: req.query.sort || 'dollarVol',
          dir: req.query.dir || 'desc',
          page,
          pageSize,
        }
        let result
        let source = 'static JSON'
        let exportedAt = null
        if (useHmdaWarehouse() && (await isWarehouseReady())) {
          const { queryLenderRowsFromDb } = await import('./lender-warehouse-store.mjs')
          result = await queryLenderRowsFromDb(year, params)
          source = 'database'
        } else {
          const pack = await loadLenderPack(year)
          result = queryLenderRows(pack.lenders, params)
          exportedAt = pack.meta?.exportedAt || null
        }
        const rankOffset = result.page * result.pageSize
        const lenders = result.lenders.map((row, idx) => ({
          ...row,
          rank: rankOffset + idx + 1,
        }))
        return {
          meta: {
            dataYear: year,
            exportedAt,
            source,
          },
          ...result,
          lenders,
        }
      })
      res.set('Cache-Control', 'public, max-age=300')
      res.json(body)
    } catch (e) {
      console.error('[HMDA lenders query]', e.message)
      res.status(502).json({ error: e.message || 'Failed to query lenders' })
    }
  })

  /** Typeahead suggest over lender names, NMLS, LEI. */
  app.get('/api/hmda/lenders/suggest', async (req, res) => {
    try {
      const year = parseYearParam(req.query.years, HMDA_DEFAULT_ANCHOR_YEAR)
      const q = String(req.query.q || '').trim()
      const limit = Math.max(1, Math.min(20, parseInt(String(req.query.limit || '8'), 10) || 8))
      if (q.length < 2) {
        res.set('Cache-Control', 'public, max-age=60')
        return res.json({ lenders: [] })
      }
      let lenders
      if (useHmdaWarehouse() && (await isWarehouseReady())) {
        const { suggestLenderRowsFromDb } = await import('./lender-warehouse-store.mjs')
        lenders = await suggestLenderRowsFromDb(year, q, limit)
      } else {
        const pack = await loadLenderPack(year)
        lenders = suggestLenderRows(pack.lenders, q, limit)
      }
      res.set('Cache-Control', 'public, max-age=120')
      res.json({ lenders, q, limit })
    } catch (e) {
      console.error('[HMDA lenders suggest]', e.message)
      res.status(502).json({ error: e.message || 'Failed to suggest lenders' })
    }
  })

  /** Quarterly lender history from warehouse (replaces client estimators). */
  app.get('/api/hmda/lenders/quarters', async (req, res) => {
    try {
      const year = parseYearParam(req.query.years, HMDA_DEFAULT_ANCHOR_YEAR)
      const lei = String(req.query.lei || '').trim().toUpperCase()
      if (!validateLei(lei)) {
        return res.status(400).json({ error: 'Invalid LEI' })
      }
      if (!useHmdaWarehouse() || !(await isWarehouseReady())) {
        return res.json({ meta: { source: 'unavailable' }, quarters: [] })
      }
      const { getQuarterHistoryFromDb } = await import('./lender-warehouse-store.mjs')
      const quarters = await getQuarterHistoryFromDb(lei, year)
      res.set('Cache-Control', 'public, max-age=3600')
      res.json({ meta: { source: 'database', year, lei }, quarters })
    } catch (e) {
      console.error('[HMDA lenders quarters]', e.message)
      res.status(502).json({ error: e.message || 'Failed to load quarter history' })
    }
  })

  /** Product mix summary for Products tab (no full lender panel download). */
  app.get('/api/hmda/products/summary', async (req, res) => {
    try {
      const year = parseYearParam(req.query.years, HMDA_DEFAULT_ANCHOR_YEAR)
      const cacheKey = `products|summary|${year}`
      const body = await dedupe(cacheKey, () => buildProductSummary(year))
      res.set('Cache-Control', 'public, max-age=3600')
      res.json(body)
    } catch (e) {
      console.error('[HMDA products summary]', e.message)
      res.status(502).json({ error: e.message || 'Failed to build product summary' })
    }
  })

  /** Product dimension facts (occupancy, purpose, lien) from warehouse. */
  app.get('/api/hmda/products/dimensions', async (req, res) => {
    try {
      const year = parseYearParam(req.query.years, HMDA_DEFAULT_ANCHOR_YEAR)
      const lei = String(req.query.lei || '').trim().toUpperCase()
      if (lei && !validateLei(lei)) {
        return res.status(400).json({ error: 'Invalid LEI' })
      }
      if (!useHmdaWarehouse() || !(await isWarehouseReady())) {
        return res.json({ meta: { source: 'unavailable' }, dimensions: {} })
      }
      const { getProductDimensionsForLenderFromDb } = await import('./product-warehouse-store.mjs')
      const { getNationalProductDimensionsFromDb } = await import('./lender-warehouse-store.mjs')
      if (lei) {
        const dimensions = await getProductDimensionsForLenderFromDb(lei, year)
        return res.json({ meta: { source: 'database', year, lei }, dimensions })
      }
      const [occupancy, purpose, lien_position] = await Promise.all([
        getNationalProductDimensionsFromDb(year, 'occupancy'),
        getNationalProductDimensionsFromDb(year, 'purpose'),
        getNationalProductDimensionsFromDb(year, 'lien_position'),
      ])
      res.set('Cache-Control', 'public, max-age=3600')
      res.json({
        meta: { source: 'database', year, scope: 'national' },
        dimensions: { occupancy, purpose, lien_position },
      })
    } catch (e) {
      console.error('[HMDA products dimensions]', e.message)
      res.status(502).json({ error: e.message || 'Failed to load product dimensions' })
    }
  })

  /** Warehouse stats — lender counts, coverage years. */
  app.get('/api/hmda/warehouse/stats', async (_req, res) => {
    try {
      if (!useHmdaWarehouse() || !(await isWarehouseReady())) {
        return res.json({ ready: false, source: 'static' })
      }
      const { getWarehousePrisma } = await import('./warehouse-prisma.mjs')
      const { getDataCoverageFromDb } = await import('./geo-warehouse-store.mjs')
      const prisma = getWarehousePrisma()
      const [lenderCount, coverage] = await Promise.all([
        prisma.lenderYearFact.count(),
        getDataCoverageFromDb(),
      ])
      res.set('Cache-Control', 'public, max-age=300')
      res.json({
        ready: true,
        source: 'database',
        lenderYearFacts: lenderCount,
        coverage,
      })
    } catch (e) {
      console.error('[HMDA warehouse stats]', e.message)
      res.status(502).json({ error: e.message || 'Failed to load warehouse stats' })
    }
  })

  /** Morning sync — compare static export timestamp vs live FFIEC meta. */
  app.get('/api/hmda/sync/check', async (req, res) => {
    try {
      const year = parseYearParam(req.query.years, HMDA_DEFAULT_ANCHOR_YEAR)
      const pack = await loadLenderPack(year)
      const staticExportedAt = pack.meta?.exportedAt || null
      let liveUpdatedAt = null
      let liveAvailable = false
      try {
        const window = await resolveHmdaYearWindow(year, 0, getCache())
        liveAvailable = window.available.includes(Number(year))
        liveUpdatedAt = staticExportedAt
      } catch {
        /* FFIEC probe optional */
      }
      res.set('Cache-Control', 'public, max-age=300')
      res.json({
        dataYear: year,
        staticExportedAt,
        liveUpdatedAt,
        liveAvailable,
        changed: false,
        source: 'static JSON',
      })
    } catch (e) {
      console.error('[HMDA sync check]', e.message)
      res.status(502).json({ error: e.message || 'Sync check failed' })
    }
  })

  /** Multi-year geography drilldown (state totals per filing year). */
  app.get('/api/hmda/geo/drilldown/multi', async (req, res) => {
    try {
      const anchor = parseYearParam(req.query.anchor, HMDA_DEFAULT_ANCHOR_YEAR)
      const lookback = parseLookback(req.query.lookback)
      const cacheKey = `geo|multi|${anchor}|${lookback}`
      const body = await dedupe(cacheKey, async () => {
        const window = await resolveHmdaYearWindow(anchor, lookback, getCache())
        if (window.available.length === 0) {
          throw new Error('No HMDA filing years available from FFIEC for this window')
        }
        const data = await buildMultiYearGeoDrilldown(window.available, getCache())
        return {
          ...data,
          meta: {
            ...data.meta,
            anchorYear: anchor,
            lookback,
            yearsRequested: window.requested,
            yearsUnavailable: window.unavailable,
          },
        }
      })
      res.set('Cache-Control', `public, max-age=${Math.floor(HMDA_FFIRC_CACHE_MS / 1000)}`)
      res.json(body)
    } catch (e) {
      console.error('[HMDA geo multi drilldown API]', e.message)
      res.status(502).json({ error: e.message || 'Failed to build multi-year geo drilldown' })
    }
  })

  /** Geography drilldown — state-level originated totals from FFIEC (county/tract from static merge when present). */
  app.get('/api/hmda/geo/drilldown', async (req, res) => {
    try {
      const year = parseYearParam(req.query.years, 2024)
      const cacheKey = `geo|${year}`
      const body = await dedupe(cacheKey, async () => {
        const byState = await buildStateGeoForYear(year, getCache())
        return wrapGeoDrilldown(year, byState)
      })
      res.set('Cache-Control', `public, max-age=${Math.floor(HMDA_FFIRC_CACHE_MS / 1000)}`)
      res.json(body)
    } catch (e) {
      console.error('[HMDA geo drilldown API]', e.message)
      res.status(502).json({ error: e.message || 'Failed to build geo drilldown from FFIEC' })
    }
  })

  app.get('/api/hmda/geo/state/:state', async (req, res) => {
    try {
      const year = parseYearParam(req.query.years, 2024)
      const summary = await buildStateSummary(year, req.params.state, getCache())
      if (!summary) return res.status(400).json({ error: 'Invalid state code' })
      res.set('Cache-Control', `public, max-age=${Math.floor(HMDA_FFIRC_CACHE_MS / 1000)}`)
      res.json({ year, ...summary })
    } catch (e) {
      console.error('[HMDA geo state API]', e.message)
      res.status(502).json({ error: e.message || 'Failed to load state geo from FFIEC' })
    }
  })

  /** County drilldown from warehouse. */
  app.get('/api/hmda/geo/county', async (req, res) => {
    try {
      const year = parseYearParam(req.query.years, 2024)
      const state = String(req.query.state || '').trim().toUpperCase()
      if (!state) return res.status(400).json({ error: 'state query param required' })
      const counties = await buildCountyGeoForState(year, state)
      res.set('Cache-Control', 'public, max-age=3600')
      res.json({ year, state, counties, meta: { source: useHmdaWarehouse() ? 'database' : 'static' } })
    } catch (e) {
      console.error('[HMDA geo county API]', e.message)
      res.status(502).json({ error: e.message || 'Failed to load county geo' })
    }
  })

  /** Tract points from warehouse. */
  app.get('/api/hmda/geo/tract', async (req, res) => {
    try {
      const year = parseYearParam(req.query.years, 2024)
      const state = req.query.state ? String(req.query.state).trim().toUpperCase() : null
      const countyFips = req.query.countyFips ? String(req.query.countyFips) : null
      const limit = Math.max(1, Math.min(20000, parseInt(String(req.query.limit || '5000'), 10) || 5000))
      const geojson = await buildTractGeoQuery({ year, stateCode: state, countyFips, limit })
      res.set('Cache-Control', 'public, max-age=3600')
      res.json({ year, state, countyFips, geojson, meta: { source: useHmdaWarehouse() ? 'database' : 'static' } })
    } catch (e) {
      console.error('[HMDA geo tract API]', e.message)
      res.status(502).json({ error: e.message || 'Failed to load tract geo' })
    }
  })

  app.get('/api/hmda/ffiec/filers', async (req, res) => {
    try {
      const year = parseYearParam(req.query.years, 2024)
      const { json, cacheKey } = await ffiecFilers({ years: year }, { cache: getCache() })
      cacheHeader(res, cacheKey, getCache())
      res.json({ ...json, _meta: { year } })
    } catch (e) {
      console.error('[HMDA filers proxy]', e.message)
      res.status(502).json({ error: e.message || 'FFIEC filers proxy failed' })
    }
  })

  /**
   * Per-LEI HMDA insights: action_taken, loan_type product counts, optional state breakdown & CSV medians.
   * Public FFIEC Data Browser API — same source as ffiec.cfpb.gov.
   */
  app.get('/api/hmda/ffiec/lender-insights', async (req, res) => {
    try {
      const years = String(req.query.years || '').trim()
      const leisRaw = String(req.query.leis || '').trim()
      const year = parseYearParam(years, 0)
      if (!years || year < 2017) {
        return res.status(400).json({ error: 'Invalid years (use YYYY)' })
      }
      const leisList = leisRaw
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
      if (leisList.length === 0 || leisList.length > 8) {
        return res.status(400).json({ error: 'Provide 1–8 comma-separated LEIs' })
      }
      for (const lei of leisList) {
        if (!validateLei(lei)) {
          return res.status(400).json({ error: 'Invalid LEI format' })
        }
      }
      const includeStates = String(req.query.states || '0').trim() === '1'
      const includeMedians = String(req.query.medians || '0').trim() === '1'
      const includeDemographics = String(req.query.demographics || '0').trim() === '1'
      const cacheKey = `insights|${year}|${leisList.join(',')}|s${includeStates}|m${includeMedians}|d${includeDemographics}`
      const payload = await dedupe(cacheKey, async () => {
        const insights = await buildLenderInsightsBatch(leisList, year, getCache(), {
          includeStates,
          includeMedians,
          includeDemographics,
        })
        return {
          meta: {
            source: 'FFIEC HMDA Data Browser API',
            year,
            count: leisList.length,
            includeStates,
            includeMedians,
            includeDemographics,
          },
          insights,
        }
      })
      cacheHeader(res, cacheKey, getCache())
      res.json(payload)
    } catch (e) {
      console.error('[HMDA lender insights]', e.message)
      res.status(e.status === 502 ? 502 : 500).json({ error: e.message || 'Lender insights failed' })
    }
  })

  /** Per-LEI disposition counts — existing live modal path. */
  app.get('/api/hmda/ffiec/aggregations', async (req, res) => {
    try {
      const years = String(req.query.years || '').trim()
      const leisRaw = String(req.query.leis || '').trim()
      const actions_taken = String(req.query.actions_taken || '1,2,3,4,5,6,7,8').trim()
      const year = parseYearParam(years, 0)
      if (!years || year < 2017) {
        return res.status(400).json({ error: 'Invalid years (use YYYY)' })
      }
      if (!/^[\d,]+$/.test(actions_taken) || actions_taken.length > 48) {
        return res.status(400).json({ error: 'Invalid actions_taken' })
      }
      const leisList = leisRaw
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
      if (leisList.length === 0 || leisList.length > 25) {
        return res.status(400).json({ error: 'Provide 1–25 comma-separated LEIs' })
      }
      for (const lei of leisList) {
        if (!validateLei(lei)) {
          return res.status(400).json({ error: 'Invalid LEI format' })
        }
      }

      const { json, cacheKey } = await ffiecAggregations(
        { years, leis: leisList.join(','), actions_taken },
        { cache: getCache(), timeoutMs: 20000 },
      )
      cacheHeader(res, cacheKey, getCache())
      res.json(json)
    } catch (e) {
      console.error('[HMDA FFIEC aggregations]', e.message)
      res.status(e.status === 502 ? 502 : 500).json({ error: e.message || 'Proxy failed' })
    }
  })
}
