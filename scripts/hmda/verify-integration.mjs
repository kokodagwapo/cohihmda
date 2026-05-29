#!/usr/bin/env node
/**
 * Verify native HMDA integration artifacts (run from cohi-hmda root).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..', '..')

let passed = 0
let failed = 0

function ok(msg) {
  console.log(`  ✓ ${msg}`)
  passed += 1
}
function fail(msg) {
  console.error(`  ✗ ${msg}`)
  failed += 1
}

console.log('HMDA native integration verification\n')

const fileChecks = [
  ['src/hmda-databank/HmdaDataBankPage.tsx', 'HmdaDataBankPage'],
  ['src/hmda-databank/context/HmdaAuthBridge.tsx', 'HmdaAuthBridge'],
  ['src/hmda-databank/core/MortgageLenderDashboard.jsx', 'MortgageLenderDashboard'],
  ['src/hmda-databank/services/hmdaApi.js', 'hmdaApi'],
  ['server/hmda/routes.mjs', 'server HMDA routes'],
  ['server/src/routes/hmda.ts', 'hmda route registrar'],
  ['public/data/hmda/hmda-years-manifest.json', 'static data manifest'],
]

for (const [rel, label] of fileChecks) {
  if (fs.existsSync(path.join(ROOT, rel))) ok(label)
  else fail(`${label} missing (${rel})`)
}

const vite = fs.readFileSync(path.join(ROOT, 'vite.config.ts'), 'utf8')
if (vite.includes('@hmda')) ok('Vite @hmda alias')
else fail('Vite @hmda alias')

if (vite.includes('vendor-mapbox')) ok('Vite mapbox chunk split')
else fail('Vite mapbox chunk split')

const app = fs.readFileSync(path.join(ROOT, 'src/App.tsx'), 'utf8')
if (app.includes('path="search"') || app.includes("path='search'")) ok('Nested /hmda routes')
else fail('Nested /hmda routes')

const hmdaData = fs.readFileSync(path.join(ROOT, 'src/pages/HmdaData.tsx'), 'utf8')
if (hmdaData.includes('<Outlet />')) ok('HmdaData shell uses Outlet')
else fail('HmdaData shell uses Outlet')

const nav = fs.readFileSync(path.join(ROOT, 'src/components/layout/Navigation.tsx'), 'utf8')
if (nav.includes('hmda: "/hmda"')) ok('Navigation HMDA link')
else fail('Navigation HMDA link')

if (nav.includes('topTieringMenuGroups.compliance.items')) ok('Navigation compliance section')
else fail('Navigation compliance section')

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
if (pkg.dependencies?.['mapbox-gl']) ok('mapbox-gl dependency')
else fail('mapbox-gl dependency')

const hmdaScripts = [
  'scripts/hmda/paths.mjs',
  'scripts/hmda/fetch-hmda-mlar-insights.mjs',
  'scripts/hmda/export-hmda-enriched.mjs',
  'scripts/hmda/build-hmda-years-manifest.mjs',
  'scripts/hmda/build-geo-drilldown-hmda.mjs',
  'scripts/hmda/build-geo-map-summary.mjs',
  'scripts/hmda/build-geo-tract-features.mjs',
  'scripts/hmda/build-geo-map-enrichment.mjs',
  'scripts/hmda/build-hmda-lender-pages.mjs',
  'scripts/hmda/build-hmda-products-summary.mjs',
  'scripts/hmda/admin-refresh-pipeline.mjs',
]
for (const rel of hmdaScripts) {
  if (fs.existsSync(path.join(ROOT, rel))) ok(`HMDA script ${path.basename(rel)}`)
  else fail(`HMDA script missing (${rel})`)
}

if (pkg.scripts?.['hmda:refresh']) ok('npm run hmda:refresh')
else fail('npm run hmda:refresh script')

try {
  const pathsUrl = pathToFileURL(path.join(ROOT, 'scripts/hmda/paths.mjs')).href
  const { HMDA_DATA_DIR, HMDA_MLAR_DIR } = await import(pathsUrl)
  if (HMDA_DATA_DIR.includes('public') && HMDA_DATA_DIR.includes('hmda')) ok('paths.mjs HMDA_DATA_DIR')
  else fail('paths.mjs HMDA_DATA_DIR unexpected')
  if (HMDA_MLAR_DIR.includes('hmda-mlar')) ok('paths.mjs HMDA_MLAR_DIR default')
  else fail('paths.mjs HMDA_MLAR_DIR unexpected')
} catch (e) {
  fail(`paths.mjs import: ${e.message}`)
}

const total = passed + failed
console.log(`\n${passed}/${total} checks passed`)
process.exit(failed > 0 ? 1 : 0)
