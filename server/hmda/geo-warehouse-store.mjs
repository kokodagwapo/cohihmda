import { getWarehousePrisma } from './warehouse-prisma.mjs'

export async function loadGeoDrilldownFromDb(year) {
  const prisma = getWarehousePrisma()
  const y = Number(year)
  const states = await prisma.geoStateYear.findMany({ where: { year: y } })
  const counties = await prisma.geoCountyYear.findMany({ where: { year: y } })

  const countiesByState = new Map()
  for (const c of counties) {
    if (!countiesByState.has(c.stateCode)) countiesByState.set(c.stateCode, [])
    countiesByState.get(c.stateCode).push({
      countyCode: c.countyFips,
      fips: c.countyFips,
      units: c.units,
      volume: Number(c.volume),
      topCensusTracts: [],
    })
  }

  const byState = {}
  for (const s of states) {
    byState[s.stateCode] = {
      units: s.units,
      volume: Number(s.volume),
      counties: countiesByState.get(s.stateCode) || [],
    }
  }

  return {
    meta: {
      source: 'database',
      year: y,
      live: false,
      note: 'State/county totals from HMDA warehouse. Tract drilldown via /api/hmda/geo/tract.',
    },
    [String(y)]: byState,
  }
}

export async function loadMultiYearGeoFromDb(years) {
  const unique = [...new Set(years.map((y) => Number(y)).filter((y) => y >= 2018))].sort((a, b) => b - a)
  const out = {
    meta: {
      source: 'database',
      years: unique,
      live: false,
    },
  }
  for (const y of unique) {
    const chunk = await loadGeoDrilldownFromDb(y)
    out[String(y)] = chunk[String(y)]
  }
  return out
}

export async function loadCountyGeoFromDb(year, stateCode) {
  const prisma = getWarehousePrisma()
  const st = String(stateCode || '').trim().toUpperCase()
  const rows = await prisma.geoCountyYear.findMany({
    where: { year: Number(year), stateCode: st },
    orderBy: { units: 'desc' },
  })
  return rows.map((r) => ({
    countyCode: r.countyFips,
    fips: r.countyFips,
    units: r.units,
    volume: Number(r.volume),
  }))
}

export async function loadTractGeoFromDb({ year, stateCode, countyFips, limit = 5000 }) {
  const prisma = getWarehousePrisma()
  const where = { year: Number(year) }
  if (stateCode) where.stateCode = String(stateCode).toUpperCase()
  if (countyFips) where.countyFips = String(countyFips).replace(/\D/g, '').padStart(5, '0')

  const rows = await prisma.geoTractYear.findMany({
    where,
    take: Math.max(1, Math.min(20000, Number(limit) || 5000)),
    orderBy: { units: 'desc' },
  })

  return {
    type: 'FeatureCollection',
    features: rows.map((r) => ({
      type: 'Feature',
      geometry:
        r.lng != null && r.lat != null
          ? { type: 'Point', coordinates: [r.lng, r.lat] }
          : null,
      properties: {
        state: r.stateCode,
        countyFips: r.countyFips,
        censusTract: r.censusTract,
        units: r.units,
        volume: Number(r.volume),
      },
    })),
  }
}

export async function getDataCoverageFromDb() {
  const prisma = getWarehousePrisma()
  return prisma.dataCoverageYear.findMany({ orderBy: { year: 'desc' } })
}

export async function upsertDataCoverageYear(row) {
  const prisma = getWarehousePrisma()
  return prisma.dataCoverageYear.upsert({
    where: { year: row.year },
    create: row,
    update: row,
  })
}
