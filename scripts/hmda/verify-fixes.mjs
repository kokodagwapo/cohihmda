#!/usr/bin/env node
/**
 * Verify native HMDA integration artifacts (run from cohi-hmda root).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..', '..')
const DATA = path.join(ROOT, 'public', 'data', 'hmda')

let passed = 0
let failed = 0

function ok(msg) {
  console.log(`  ✓ ${msg}`)
  passed += 1
}
function fail(msg, detail = '') {
  console.error(`  ✗ ${msg}${detail ? `: ${detail}` : ''}`)
  failed += 1
}

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel))
}

console.log('HMDA native fix verification\n')

// Native UI + geography
if (exists('src/hmda-databank/core/hooks/useGeographyTabAnalytics.js')) {
  ok('useGeographyTabAnalytics.js (native)')
} else {
  fail('useGeographyTabAnalytics.js (native)')
}

const summaryPath = path.join(DATA, 'geo-map-summary-2025.json')
if (fs.existsSync(summaryPath)) ok('geo-map-summary-2025.json')
else console.warn('  ~ geo-map-summary-2025.json missing (run npm run hmda:geo:map-summary)')

const publicAssetUrl = path.join(ROOT, 'src/hmda-databank/utils/publicAssetUrl.js')
if (fs.existsSync(publicAssetUrl)) {
  const src = fs.readFileSync(publicAssetUrl, 'utf8')
  if (src.includes('VITE_HMDA_DATA_PREFIX')) ok('publicAssetUrl supports VITE_HMDA_DATA_PREFIX')
  else fail('publicAssetUrl supports VITE_HMDA_DATA_PREFIX')
}

const tractPipeline = path.join(ROOT, 'src/hmda-databank/core/geography/geo-tract-pipeline.js')
if (fs.existsSync(tractPipeline)) {
  const src = fs.readFileSync(tractPipeline, 'utf8')
  if (src.includes('FETCH_CACHE_MAX') && src.includes('fetchCacheOrder')) ok('geo-tract-pipeline LRU cache')
  else fail('geo-tract-pipeline LRU cache')
  if (!src.includes('cap * lenderFocusList.length')) ok('multi-lender cap not multiplied by lender count')
  else fail('multi-lender cap not multiplied by lender count')
}

const hmdaDataTsx = path.join(ROOT, 'src/pages/HmdaData.tsx')
if (fs.existsSync(hmdaDataTsx)) {
  const src = fs.readFileSync(hmdaDataTsx, 'utf8')
  if (src.includes("tail === 'lenders'") && src.includes('/hmda/search')) {
    ok('HmdaData.tsx section tabs via pathname')
  } else fail('HmdaData.tsx section tabs via pathname')
  if (src.includes('HmdaEmbedShellProvider') && !src.includes('VITE_HMDA_USE_IFRAME')) {
    ok('HmdaData.tsx native embed shell (no iframe fallback)')
  } else fail('HmdaData.tsx native embed shell (no iframe fallback)')
}

// Refresh pipeline scripts
for (const rel of [
  'scripts/hmda/paths.mjs',
  'scripts/hmda/admin-refresh-pipeline.mjs',
  'scripts/hmda/build-hmda-lender-pages.mjs',
  'scripts/hmda/build-hmda-products-summary.mjs',
  'scripts/hmda/build-geo-map-enrichment.mjs',
]) {
  if (exists(rel)) ok(path.basename(rel))
  else fail(`missing ${rel}`)
}

if (exists('public/hmda-app')) {
  fail('public/hmda-app removed (legacy embed)')
} else {
  ok('public/hmda-app removed (legacy embed)')
}

const total = passed + failed
console.log(`\n${passed}/${total} checks passed`)
process.exit(failed > 0 ? 1 : 0)
