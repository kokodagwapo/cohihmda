#!/usr/bin/env node
/**
 * Split hmda-lenders-{year}-only.json into paginated static pages + manifest.
 *
 * Usage:
 *   node scripts/hmda/build-hmda-lender-pages.mjs
 *   node scripts/hmda/build-hmda-lender-pages.mjs --year=2025
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { HMDA_DATA_DIR } from './paths.mjs'
import { sortLenderRows } from '../../server/hmda/lender-query.mjs'
import { getManifestFromPack } from '../../server/hmda/static-lenders-store.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PAGE_SIZE = 20

function parseYearArg() {
  const fromEnv = Number(process.env.HMDA_ANCHOR_YEAR)
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--year=(\d{4})$/)
    if (m) return Number(m[1])
    if (/^\d{4}$/.test(arg)) return Number(arg)
  }
  if (Number.isFinite(fromEnv) && fromEnv >= 2018) return fromEnv
  return 2025
}

async function main() {
  const YEAR = parseYearArg()
  const sourcePath = path.join(HMDA_DATA_DIR, `hmda-lenders-${YEAR}-only.json`)
  const pagesDir = path.join(HMDA_DATA_DIR, `hmda-lenders-${YEAR}-pages`)
  const manifestPath = path.join(HMDA_DATA_DIR, `hmda-lenders-${YEAR}-manifest.json`)

  if (!fs.existsSync(sourcePath)) {
    console.error('Missing source:', sourcePath, '— run export-hmda-enriched first')
    process.exit(1)
  }

  const raw = JSON.parse(fs.readFileSync(sourcePath, 'utf8'))
  const lenders = Array.isArray(raw?.lenders) ? raw.lenders : Array.isArray(raw) ? raw : []
  const sorted = sortLenderRows(lenders, 'originations', 'desc')
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))

  fs.mkdirSync(pagesDir, { recursive: true })

  for (let page = 0; page < totalPages; page += 1) {
    const start = page * PAGE_SIZE
    const slice = sorted.slice(start, start + PAGE_SIZE).map((row, idx) => ({
      ...row,
      rank: start + idx + 1,
    }))
    const outPath = path.join(pagesDir, `page-${page}.json`)
    fs.writeFileSync(
      outPath,
      JSON.stringify({
        meta: {
          dataYear: YEAR,
          page,
          pageSize: PAGE_SIZE,
          total: sorted.length,
          totalPages,
          exportedAt: raw?.meta?.exportedAt || null,
        },
        lenders: slice,
      }),
    )
  }

  const pack = {
    meta: raw?.meta || { dataYear: YEAR, recordCount: sorted.length },
    lenders: sorted,
    loadedAt: Date.now(),
  }
  const manifest = {
    ...(await getManifestFromPack(pack)),
    pageSize: PAGE_SIZE,
    totalPages,
    pagesPath: `data/hmda/hmda-lenders-${YEAR}-pages`,
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  console.log(
    `[lender-pages] Wrote ${totalPages} pages (${sorted.length} lenders), manifest for ${YEAR}`,
  )
}

await main()
