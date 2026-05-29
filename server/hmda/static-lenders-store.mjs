import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { useHmdaWarehouse, isWarehouseReady } from './data-source.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')

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

/** @type {Map<string, { meta: object, lenders: object[], loadedAt: number }>} */
const cache = new Map()

function resolveLenderJsonPath(year) {
  const y = Number(year) || 2025
  if (y === 2025) {
    return path.join(ROOT, 'public/data/hmda/hmda-lenders-2025-only.json')
  }
  return path.join(ROOT, 'public/data/hmda/lenders-from-hmda.json')
}

function normalizeRows(raw) {
  if (Array.isArray(raw)) return raw
  if (Array.isArray(raw?.lenders)) return raw.lenders
  return []
}

async function loadLenderPackStatic(year = 2025) {
  const key = `static|${year}`
  const hit = cache.get(key)
  if (hit) return hit

  const filePath = resolveLenderJsonPath(year)
  if (!fs.existsSync(filePath)) {
    throw new Error(`Static lender JSON missing: ${filePath}`)
  }

  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  const all = normalizeRows(raw)
  const lenders = all.filter((l) => Number(l.dataYear) === Number(year))
  const pack = {
    meta: {
      ...(raw?.meta || {}),
      dataYear: Number(year),
      recordCount: lenders.length,
      sourcePath: path.relative(ROOT, filePath),
      source: 'static JSON',
    },
    lenders,
    loadedAt: Date.now(),
  }
  cache.set(key, pack)
  return pack
}

export async function loadLenderPack(year = 2025) {
  if (useHmdaWarehouse() && (await isWarehouseReady())) {
    const key = `db|${year}`
    const hit = cache.get(key)
    if (hit && Date.now() - hit.loadedAt < 120000) return hit
    const { loadLenderPackFromDb } = await import('./lender-warehouse-store.mjs')
    const pack = await loadLenderPackFromDb(year)
    cache.set(key, pack)
    return pack
  }
  return loadLenderPackStatic(year)
}

export async function getManifestFromPack(pack) {
  if (pack.meta?.source === 'database') {
    const { getManifestFromDb } = await import('./lender-warehouse-store.mjs')
    return getManifestFromDb(pack.meta?.dataYear)
  }
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
    dataYear: pack.meta?.dataYear,
    recordCount: lenders.length,
    etag: pack.meta?.exportedAt || String(pack.loadedAt),
    prodCounts,
    channelCounts,
    source: pack.meta?.source || 'static JSON',
  }
}

export function readPaginatedJson(relativePath) {
  const filePath = path.join(ROOT, 'public', relativePath)
  if (!fs.existsSync(filePath)) return null
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

export { ALL_PRODUCTS }
