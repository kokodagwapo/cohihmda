import { getWarehousePrisma } from './warehouse-prisma.mjs'
import { dbRowToClientLender } from './lender-row-mapper.mjs'
import { filterLenderRows, queryLenderRows, sortLenderRows, suggestLenderRows } from './lender-query.mjs'

const ALL_PRODUCTS = [
  'Conventional',
  'FHA',
  'VA',
  'USDA',
  'Non-QM',
  'Jumbo',
  'HELOC',
  'Construction',
]

async function fetchYearLenders(year) {
  const prisma = getWarehousePrisma()
  const y = Number(year)
  const rows = await prisma.lenderYearFact.findMany({
    where: { year: y },
    include: {
      lender: true,
    },
    orderBy: { dollarVolume: 'desc' },
  })

  const leis = rows.map((r) => r.lei)
  const [productFacts, stateFacts] = await Promise.all([
    prisma.lenderProductFact.findMany({ where: { year: y, lei: { in: leis } } }),
    prisma.lenderStateFact.findMany({ where: { year: y, lei: { in: leis } } }),
  ])

  const productsByLei = new Map()
  for (const pf of productFacts) {
    if (!productsByLei.has(pf.lei)) productsByLei.set(pf.lei, [])
    productsByLei.get(pf.lei).push(pf)
  }
  const statesByLei = new Map()
  for (const sf of stateFacts) {
    if (!statesByLei.has(sf.lei)) statesByLei.set(sf.lei, [])
    statesByLei.get(sf.lei).push(sf)
  }

  return rows.map((yf) =>
    dbRowToClientLender(yf.lender, yf, {
      productFacts: productsByLei.get(yf.lei) || [],
      stateFacts: statesByLei.get(yf.lei) || [],
    }),
  )
}

export async function loadLenderPackFromDb(year = 2025) {
  const prisma = getWarehousePrisma()
  const y = Number(year)
  const lenders = await fetchYearLenders(y)
  const coverage = await prisma.dataCoverageYear.findUnique({ where: { year: y } })
  return {
    meta: {
      dataYear: y,
      recordCount: lenders.length,
      exportedAt: coverage?.exportedAt?.toISOString?.() || null,
      source: 'database',
    },
    lenders,
    loadedAt: Date.now(),
  }
}

export async function getManifestFromDb(year = 2025) {
  const pack = await loadLenderPackFromDb(year)
  const lenders = pack.lenders || []
  const prodCounts = { all: lenders.length }
  for (const p of ALL_PRODUCTS) {
    prodCounts[p] = lenders.filter((l) => Array.isArray(l.products) && l.products.includes(p)).length
  }
  const channelCounts = { all: lenders.length }
  for (const ch of ['retail', 'wholesale', 'correspondent']) {
    channelCounts[ch] = lenders.filter((l) => String(l.channel || '').toLowerCase() === ch).length
  }
  return {
    exportedAt: pack.meta?.exportedAt || null,
    dataYear: Number(year),
    recordCount: lenders.length,
    etag: pack.meta?.exportedAt || String(pack.loadedAt),
    prodCounts,
    channelCounts,
    source: 'database',
  }
}

export async function queryLenderRowsFromDb(year, params = {}) {
  const lenders = await fetchYearLenders(year)
  return queryLenderRows(lenders, params)
}

export async function suggestLenderRowsFromDb(year, q, limit = 8) {
  const lenders = await fetchYearLenders(year)
  return suggestLenderRows(lenders, q, limit)
}

export async function getLenderCountForYear(year) {
  const prisma = getWarehousePrisma()
  return prisma.lenderYearFact.count({ where: { year: Number(year) } })
}

export async function getQuarterHistoryFromDb(lei, year) {
  const prisma = getWarehousePrisma()
  const rows = await prisma.lenderQuarterFact.findMany({
    where: { lei: String(lei).toUpperCase(), year: Number(year) },
    orderBy: { quarter: 'asc' },
  })
  return rows.map((r) => ({
    year: r.year,
    quarter: r.quarter,
    originations: r.originations,
    dollarVolume: r.dollarVolume != null ? Number(r.dollarVolume) : null,
    avgRate: r.avgRate,
  }))
}

export async function getProductDimensionsFromDb(lei, year) {
  const prisma = getWarehousePrisma()
  const rows = await prisma.lenderProductDimension.findMany({
    where: { lei: String(lei).toUpperCase(), year: Number(year) },
  })
  const out = {}
  for (const r of rows) {
    if (!out[r.dimension]) out[r.dimension] = []
    out[r.dimension].push({ bucket: r.bucket, originations: r.originations })
  }
  return out
}

export async function getNationalProductDimensionsFromDb(year, dimension) {
  const prisma = getWarehousePrisma()
  const rows = await prisma.lenderProductDimension.groupBy({
    by: ['bucket'],
    where: { year: Number(year), dimension },
    _sum: { originations: true },
  })
  const total = rows.reduce((s, r) => s + (r._sum.originations || 0), 0) || 1
  const out = {}
  for (const r of rows) {
    out[r.bucket] = (r._sum.originations || 0) / total
  }
  return out
}

export { ALL_PRODUCTS, sortLenderRows, filterLenderRows }
