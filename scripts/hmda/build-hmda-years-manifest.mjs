#!/usr/bin/env node
/**
 * Scan static HMDA artifacts and write hmda-years-manifest.json.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { HMDA_DATA_DIR } from './paths.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA = HMDA_DATA_DIR
const OUT = path.join(DATA, 'hmda-years-manifest.json')

const LAR_DETAIL_MAX_YEAR = Number(process.env.HMDA_LAR_DETAIL_MAX_YEAR || 2025)
const ANCHOR_YEAR = Number(process.env.HMDA_ANCHOR_YEAR || process.env.HMDA_DEFAULT_ANCHOR_YEAR || 2025)

function readJson(rel, fallback = null) {
  const p = path.join(DATA, rel)
  if (!fs.existsSync(p)) return fallback
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    return fallback
  }
}

function lenderYearsFromMaster() {
  const raw = readJson('lenders-from-hmda.json', [])
  const rows = Array.isArray(raw?.lenders) ? raw.lenders : Array.isArray(raw) ? raw : []
  const counts = new Map()
  for (const row of rows) {
    const y = Number(row?.dataYear)
    if (!Number.isFinite(y)) continue
    counts.set(y, (counts.get(y) || 0) + 1)
  }
  return counts
}

function geoYearsFromDrilldown() {
  const drill = readJson('geo-drilldown-from-hmda.json', {})
  return Object.keys(drill || {})
    .filter((k) => /^\d{4}$/.test(k))
    .sort((a, b) => Number(b) - Number(a))
}

function countyMetricsYears() {
  if (!fs.existsSync(path.join(DATA, 'geo-map'))) return []
  return fs
    .readdirSync(path.join(DATA, 'geo-map'))
    .filter((f) => /^county-metrics-\d{4}\.json$/.test(f))
    .map((f) => Number(f.match(/\d{4}/)[0]))
    .filter((y) => {
      const body = readJson(`geo-map/county-metrics-${y}.json`, {})
      return Number(body?.meta?.countyCount || Object.keys(body?.counties || {}).length) > 0
    })
    .sort((a, b) => b - a)
}

function tractYears() {
  const manifest = readJson('geo-map/tracts/manifest.json', {})
  const years = manifest?.years
  if (Array.isArray(years) && years.length) {
    return years.map(String).filter((y) => /^\d{4}$/.test(y)).sort((a, b) => Number(b) - Number(a))
  }
  const dir = path.join(DATA, 'geo-map/tracts')
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{4}$/.test(d.name))
    .map((d) => d.name)
    .sort((a, b) => Number(b) - Number(a))
}

function productSummaryYears() {
  if (!fs.existsSync(DATA)) return []
  return fs
    .readdirSync(DATA)
    .filter((f) => /^hmda-products-summary-\d{4}\.json$/.test(f))
    .map((f) => Number(f.match(/\d{4}/)[0]))
    .sort((a, b) => b - a)
}

function hasPaginatedPages(year) {
  const pagesDir = path.join(DATA, `hmda-lenders-${year}-pages`)
  if (!fs.existsSync(pagesDir)) return year === 2025 && fs.existsSync(path.join(DATA, 'hmda-lenders-2025-pages'))
  return fs.readdirSync(pagesDir).some((f) => /^page-\d+\.json$/.test(f))
}

function nearestGeoYear(want, geoYears) {
  const pref = Number(want)
  const sorted = [...geoYears].map(Number).sort((a, b) => b - a)
  const hit = sorted.find((y) => y <= pref && geoYears.includes(String(y)))
  return hit != null ? hit : sorted[0] ?? null
}

function main() {
  const lenderCounts = lenderYearsFromMaster()
  const lenderYears = [...lenderCounts.keys()].sort((a, b) => b - a)
  const geoYears = geoYearsFromDrilldown()
  const countyYears = countyMetricsYears()
  const tractYearsList = tractYears()
  const productYears = productSummaryYears()

  const allYears = [...new Set([
    ...lenderYears,
    ...geoYears.map(Number),
    ...countyYears,
    ...tractYearsList.map(Number),
    ...productYears,
    ANCHOR_YEAR,
  ])].sort((a, b) => b - a)

  const years = {}
  for (const y of allYears) {
    const ys = String(y)
    const hasLenders = lenderCounts.has(y)
    const hasGeo = geoYears.includes(ys)
    const hasCounty = countyYears.includes(y)
    const hasTracts = tractYearsList.includes(ys)
    const hasProducts = productYears.includes(y) || hasLenders
    const geoFallbackYear = hasGeo ? null : nearestGeoYear(y, geoYears)
    const tractFallbackYear = hasTracts ? null : nearestGeoYear(y, tractYearsList)
    const larDetail = Math.min(y, LAR_DETAIL_MAX_YEAR)
    years[ys] = {
      lenders: hasLenders,
      lenderCount: lenderCounts.get(y) || 0,
      geo: hasGeo,
      geoFallbackYear,
      countyMetrics: hasCounty,
      tracts: hasTracts,
      tractFallbackYear,
      products: hasProducts,
      larDetail,
      paginatedPages: hasPaginatedPages(y),
      partial: hasLenders && (!hasGeo || larDetail < y),
    }
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    anchorYear: ANCHOR_YEAR,
    larDetailMaxYear: LAR_DETAIL_MAX_YEAR,
    lenderYears: lenderYears.map(String),
    geoYears,
    tractYears: tractYearsList,
    productYears: productYears.map(String),
    partialYears: Object.entries(years)
      .filter(([, v]) => v.partial)
      .map(([k]) => k)
      .sort((a, b) => Number(b) - Number(a)),
    years,
  }

  fs.mkdirSync(DATA, { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(manifest, null, 2))
  console.log('[hmda-years-manifest]', OUT)
  console.log('  lender years:', manifest.lenderYears.join(', '))
  console.log('  geo years:', manifest.geoYears.join(', '))
  console.log('  partial:', manifest.partialYears.join(', ') || '(none)')
}

main()
