#!/usr/bin/env node
/**
 * Build slim state-level geo map summaries from geo-drilldown-from-hmda.json.
 *
 * Usage:
 *   node scripts/hmda/build-geo-map-summary.mjs
 *   node scripts/hmda/build-geo-map-summary.mjs 2025
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { HMDA_DATA_DIR } from './paths.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DRILL_PATH = path.join(HMDA_DATA_DIR, 'geo-drilldown-from-hmda.json')
const OUT_DIR = HMDA_DATA_DIR

function slimYearSlice(yearObj) {
  if (!yearObj || typeof yearObj !== 'object') return {}
  const out = {}
  for (const [st, row] of Object.entries(yearObj)) {
    if (!/^[A-Z]{2}$/.test(st)) continue
    out[st] = {
      units: Number(row.units) || 0,
      volume: Number(row.volume) || 0,
      countyCount: Array.isArray(row.counties) ? row.counties.length : 0,
    }
  }
  return out
}

function main() {
  if (!fs.existsSync(DRILL_PATH)) {
    console.error(`Missing ${DRILL_PATH} — run build-geo-drilldown-hmda first`)
    process.exit(1)
  }
  const drill = JSON.parse(fs.readFileSync(DRILL_PATH, 'utf8'))
  const yearKeys = Object.keys(drill).filter((k) => /^\d{4}$/.test(k))
  const filterYears = process.argv.slice(2).filter((y) => /^\d{4}$/.test(y))
  const targets = filterYears.length ? filterYears : yearKeys

  for (const year of targets) {
    const slice = slimYearSlice(drill[year])
    const outPath = path.join(OUT_DIR, `geo-map-summary-${year}.json`)
    const payload = {
      meta: {
        year,
        source: 'geo-drilldown-from-hmda.json',
        generatedAt: new Date().toISOString(),
        stateCount: Object.keys(slice).length,
      },
      [year]: slice,
    }
    fs.writeFileSync(outPath, JSON.stringify(payload))
    const kb = Math.round(fs.statSync(outPath).size / 1024)
    console.log(`Wrote ${outPath} (${kb} KB, ${Object.keys(slice).length} states)`)
  }
}

main()
