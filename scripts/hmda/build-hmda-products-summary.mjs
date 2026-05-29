#!/usr/bin/env node
/**
 * Build hmda-products-summary-{year}.json for each year in lenders-from-hmda.json.
 *
 * Usage: node scripts/hmda/build-hmda-products-summary.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { HMDA_DATA_DIR } from './paths.mjs'
import { buildProductSummary } from '../../server/hmda/product-summary.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function main() {
  const masterPath = path.join(HMDA_DATA_DIR, 'lenders-from-hmda.json')
  if (!fs.existsSync(masterPath)) {
    console.error('Missing', masterPath)
    process.exit(1)
  }
  const raw = JSON.parse(fs.readFileSync(masterPath, 'utf8'))
  const rows = Array.isArray(raw?.lenders) ? raw.lenders : Array.isArray(raw) ? raw : []
  const years = [...new Set(rows.map((r) => Number(r?.dataYear)).filter(Number.isFinite))].sort(
    (a, b) => b - a,
  )

  for (const year of years) {
    const summary = await buildProductSummary(year)
    const outPath = path.join(HMDA_DATA_DIR, `hmda-products-summary-${year}.json`)
    fs.writeFileSync(outPath, JSON.stringify(summary, null, 2))
    console.log('[products-summary]', outPath, summary.products?.length || 0, 'products')
  }
}

await main()
