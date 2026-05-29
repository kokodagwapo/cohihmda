#!/usr/bin/env node
/**
 * Runtime smoke test for native HMDA integration (backend + static assets).
 * Usage: node scripts/hmda/smoke-test.mjs [--base http://localhost:3001] [--frontend http://localhost:5000]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..', '..')

const args = process.argv.slice(2)
function arg(name, fallback) {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const API_BASE = arg('--base', 'http://localhost:3001').replace(/\/$/, '')
const FE_BASE = arg('--frontend', 'http://localhost:5000').replace(/\/$/, '')

let passed = 0
let failed = 0
const failures = []

function ok(msg) {
  console.log(`  ✓ ${msg}`)
  passed += 1
}
function fail(msg, detail = '') {
  const line = detail ? `${msg}: ${detail}` : msg
  console.error(`  ✗ ${line}`)
  failures.push(line)
  failed += 1
}

async function getJson(url, { expectStatus = 200, minBytes = 0 } = {}) {
  const res = await fetch(url, { redirect: 'follow' })
  const text = await res.text()
  if (res.status !== expectStatus) {
    throw new Error(`HTTP ${res.status} (expected ${expectStatus})`)
  }
  if (text.length < minBytes) {
    throw new Error(`body too small (${text.length} bytes)`)
  }
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function headOk(url) {
  const res = await fetch(url, { method: 'GET', redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res
}

console.log('HMDA smoke test\n')
console.log(`  API:      ${API_BASE}`)
console.log(`  Frontend: ${FE_BASE}\n`)

// --- Static files on disk ---
const manifestPath = path.join(ROOT, 'public', 'data', 'hmda', 'hmda-years-manifest.json')
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  if (manifest?.lenderYears?.length || (manifest?.years && typeof manifest.years === 'object')) {
    ok(`manifest on disk (${manifest.lenderYears?.length ?? Object.keys(manifest.years).length} lender years)`)
  } else fail('manifest on disk has lender years')
} else {
  fail('hmda-years-manifest.json missing on disk')
}

// --- API ---
try {
  const meta = await getJson(`${API_BASE}/api/hmda/meta`)
  if (meta.dataSource === 'static') ok(`meta dataSource=static`)
  else fail('meta dataSource', String(meta.dataSource))
  if (Array.isArray(meta.years) && meta.years.length > 0) ok(`meta years (${meta.years.length})`)
  else fail('meta years array empty')
} catch (e) {
  fail('GET /api/hmda/meta', e.message)
}

try {
  const years = await getJson(`${API_BASE}/api/hmda/years?anchor=2025&lookback=4`)
  if (years?.available?.length || years?.lenderYearsAvailable?.length) ok('years endpoint')
  else fail('years endpoint', 'no available years')
} catch (e) {
  fail('GET /api/hmda/years', e.message)
}

try {
  const manifest = await getJson(`${API_BASE}/api/hmda/lenders/manifest?years=2025`)
  if (manifest?.recordCount > 1000) {
    ok(`lenders manifest (${manifest.recordCount} lenders)`)
  } else {
    fail('lenders manifest', `recordCount=${manifest?.recordCount}`)
  }
} catch (e) {
  fail('GET /api/hmda/lenders/manifest', e.message)
}

try {
  const query = await getJson(`${API_BASE}/api/hmda/lenders/query?years=2025&page=0&pageSize=5`)
  if (Array.isArray(query?.lenders) && query.lenders.length > 0) ok(`lenders query (${query.lenders.length} rows, total ${query.total ?? '?'})`)
  else fail('lenders query', 'empty lenders')
} catch (e) {
  fail('GET /api/hmda/lenders/query', e.message)
}

try {
  const suggest = await getJson(`${API_BASE}/api/hmda/lenders/suggest?q=wells&years=2025`)
  if (Array.isArray(suggest?.lenders) && suggest.lenders.length > 0) ok(`lenders suggest (${suggest.lenders.length} hits)`)
  else fail('lenders suggest', 'no matches for wells')
} catch (e) {
  fail('GET /api/hmda/lenders/suggest', e.message)
}

try {
  const products = await getJson(`${API_BASE}/api/hmda/products/summary?years=2025`)
  if (products?.products || products?.meta) ok('products summary')
  else fail('products summary', 'unexpected shape')
} catch (e) {
  fail('GET /api/hmda/products/summary', e.message)
}

try {
  const geo = await getJson(`${API_BASE}/api/hmda/geo/drilldown?year=2025`, { minBytes: 1000 })
  if (geo?.states || geo?.byState || typeof geo === 'object') ok('geo drilldown 2025')
  else fail('geo drilldown', 'unexpected shape')
} catch (e) {
  fail('GET /api/hmda/geo/drilldown', e.message)
}

try {
  const stats = await getJson(`${API_BASE}/api/hmda/warehouse/stats`)
  ok(`warehouse stats (ready=${Boolean(stats?.ready)})`)
} catch (e) {
  fail('GET /api/hmda/warehouse/stats', e.message)
}

// --- Static JSON (Vite dev server serves public/) ---
for (const rel of [
  '/data/hmda/hmda-years-manifest.json',
  '/data/hmda/geo-map-summary-2025.json',
  '/data/hmda/hmda-lenders-2025-pages/page-0.json',
]) {
  try {
    await headOk(`${FE_BASE}${rel}`)
    ok(`static ${rel}`)
  } catch (e) {
    fail(`static ${rel}`, e.message)
  }
}

// --- Admin route auth gate ---
try {
  const res = await fetch(`${API_BASE}/api/admin/hmda-data/status?years=2025`)
  if (res.status === 401 || res.status === 403) ok('admin status requires auth (401/403)')
  else fail('admin status auth gate', `HTTP ${res.status}`)
} catch (e) {
  fail('GET /api/admin/hmda-data/status', e.message)
}

// --- Frontend shell ---
try {
  const res = await headOk(`${FE_BASE}/`)
  ok(`frontend home (${res.status})`)
} catch (e) {
  fail('frontend home', e.message)
}

try {
  const res = await fetch(`${FE_BASE}/hmda/lenders`, { redirect: 'follow' })
  const html = await res.text()
  if (res.ok && (html.includes('root') || html.includes('<!DOCTYPE html'))) ok('frontend /hmda/lenders SPA route')
  else fail('frontend /hmda/lenders', `HTTP ${res.status}`)
} catch (e) {
  fail('frontend /hmda/lenders', e.message)
}

const total = passed + failed
console.log(`\n${passed}/${total} checks passed`)
if (failed > 0) {
  console.error('\nFailures:')
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
