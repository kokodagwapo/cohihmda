import { useHmdaWarehouse, isWarehouseReady } from './data-source.mjs'
import { ffiecAggregations, mapPool } from './ffiec-client.mjs'
import { US_STATE_CODES } from './us-states.mjs'

/**
 * State-level originated totals for multiple years (FFIEC aggregations).
 * @param {number[]} years — newest first
 */
export async function buildMultiYearGeoDrilldown(years, ffiecCache) {
  if (useHmdaWarehouse() && (await isWarehouseReady())) {
    const { loadMultiYearGeoFromDb } = await import('./geo-warehouse-store.mjs')
    return loadMultiYearGeoFromDb(years)
  }

  const unique = [...new Set(years.map((y) => Number(y)).filter((y) => y >= 2018))].sort((a, b) => b - a)
  const chunks = await mapPool(
    unique,
    async (year) => {
      const byState = await buildStateGeoForYear(year, ffiecCache)
      return wrapGeoDrilldown(year, byState)
    },
    2,
  )
  const out = {
    meta: {
      source: 'FFIEC HMDA Data Browser API',
      years: unique,
      live: true,
      note: 'Per-year state originated totals (action_taken=1). County/tract layers require static MLAR drilldown when deployed.',
    },
  }
  for (const chunk of chunks) {
    const y = chunk.meta?.year ?? Object.keys(chunk).find((k) => /^\d{4}$/.test(k))
    if (y && chunk[String(y)]) out[String(y)] = chunk[String(y)]
  }
  return out
}

/**
 * Fetch originated loan units + volume for every state via FFIEC aggregations.
 * Cached server-side; ~51 upstream calls per cache miss.
 */
export async function buildStateGeoForYear(year, ffiecCache) {
  if (useHmdaWarehouse() && (await isWarehouseReady())) {
    const { loadGeoDrilldownFromDb } = await import('./geo-warehouse-store.mjs')
    const chunk = await loadGeoDrilldownFromDb(year)
    return chunk[String(year)] || {}
  }

  const pairs = await mapPool(
    US_STATE_CODES,
    async (state) => {
      try {
        const { json } = await ffiecAggregations(
          { years: year, states: state, actions_taken: '1' },
          { cache: ffiecCache, timeoutMs: 20000 },
        )
        const row = json?.aggregations?.[0]
        return [
          state,
          {
            units: Math.max(0, Number(row?.count) || 0),
            volume: Math.max(0, Number(row?.sum) || 0),
            counties: [],
          },
        ]
      } catch {
        return [state, { units: 0, volume: 0, counties: [] }]
      }
    },
    8,
  )

  return Object.fromEntries(pairs)
}

/** Shape compatible with `geo-drilldown-from-hmda.json` consumers. */
export function wrapGeoDrilldown(year, byState) {
  return {
    meta: {
      source: useHmdaWarehouse() ? 'database' : 'FFIEC HMDA Data Browser API',
      note: 'State/county originated totals (action_taken=1). Census tract drilldown requires MLAR extract or static geo-drilldown file.',
      apiDocs: 'https://ffiec.cfpb.gov/documentation/api/data-browser/',
      live: !useHmdaWarehouse(),
      topCountiesPerState: null,
      topTractsPerCounty: 12,
    },
    [String(year)]: byState,
  }
}

/** Single-state summary + optional county rows from static merge. */
export async function buildStateSummary(year, stateCode, ffiecCache) {
  const st = String(stateCode || '').trim().toUpperCase()
  if (!US_STATE_CODES.includes(st)) return null

  if (useHmdaWarehouse() && (await isWarehouseReady())) {
    const { getWarehousePrisma } = await import('./warehouse-prisma.mjs')
    const prisma = getWarehousePrisma()
    const stateRow = await prisma.geoStateYear.findUnique({
      where: { year_stateCode: { year: Number(year), stateCode: st } },
    })
    if (stateRow) {
      return {
        state: st,
        units: stateRow.units,
        volume: Number(stateRow.volume),
      }
    }
  }

  const { json } = await ffiecAggregations(
    { years: year, states: st, actions_taken: '1' },
    { cache: ffiecCache, timeoutMs: 20000 },
  )
  const row = json?.aggregations?.[0]
  return {
    state: st,
    units: Math.max(0, Number(row?.count) || 0),
    volume: Math.max(0, Number(row?.sum) || 0),
  }
}

export async function buildCountyGeoForState(year, stateCode) {
  if (useHmdaWarehouse() && (await isWarehouseReady())) {
    const { loadCountyGeoFromDb } = await import('./geo-warehouse-store.mjs')
    return loadCountyGeoFromDb(year, stateCode)
  }
  return []
}

export async function buildTractGeoQuery(params) {
  if (useHmdaWarehouse() && (await isWarehouseReady())) {
    const { loadTractGeoFromDb } = await import('./geo-warehouse-store.mjs')
    return loadTractGeoFromDb(params)
  }
  return { type: 'FeatureCollection', features: [] }
}
