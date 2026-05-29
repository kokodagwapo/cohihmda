#!/usr/bin/env node
/**
 * Build hmda-lenders-{year}-only.json with NMLS/DBA/product/declination enrichment.
 *
 * Usage:
 *   node scripts/hmda/export-hmda-enriched.mjs
 *   node scripts/hmda/export-hmda-enriched.mjs --year=2025
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { HMDA_DATA_DIR } from './paths.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

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

const YEAR = parseYearArg()
const SRC = path.join(HMDA_DATA_DIR, 'lenders-from-hmda.json')
const OUT = path.join(HMDA_DATA_DIR, `hmda-lenders-${YEAR}-only.json`)

const HMDA_LOAN_TYPE_LABELS = {
  1: 'Conventional',
  2: 'FHA',
  3: 'VA',
  4: 'USDA',
}

const CARD_PRODUCTS = new Set(['Conventional', 'FHA', 'VA', 'USDA'])

function cleanId(v) {
  const s = String(v ?? '').trim()
  return s ? s : null
}

function parseDbaFromName(name) {
  const raw = String(name ?? '').trim()
  if (!raw) return { legalName: '', dba: null }
  const patterns = [
    /\s+dba\s+(.+)$/i,
    /\s+d\/\s*b\/\s*a\s+(.+)$/i,
    /\s+d\/b\/a\s+(.+)$/i,
    /\s+doing\s+business\s+as\s+(.+)$/i,
    /\s+t\/a\s+(.+)$/i,
    /\s+trading\s+as\s+(.+)$/i,
  ]
  for (const re of patterns) {
    const m = raw.match(re)
    if (m) {
      const dba = m[1].trim().replace(/\s+/g, ' ')
      const legalName = raw.slice(0, m.index).trim().replace(/\s*,\s*$/, '')
      return { legalName: legalName || raw, dba: dba || null }
    }
  }
  return { legalName: raw, dba: null }
}

function originatedFromLoanTypeRow(v) {
  if (v == null) return null
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.round(v))
  if (typeof v === 'object' && v.originated != null && Number.isFinite(Number(v.originated))) {
    return Math.max(0, Math.round(Number(v.originated)))
  }
  return null
}

function sumLoanTypes14(h) {
  const lt = h?.loanTypeSummary
  if (!lt || typeof lt !== 'object') return { sum: 0, hasData: false }
  let sum = 0
  let hasData = false
  for (const code of [1, 2, 3, 4]) {
    const row = lt[String(code)] ?? lt[code]
    const n = originatedFromLoanTypeRow(row)
    if (n != null) {
      hasData = true
      sum += n
    }
  }
  return { sum, hasData }
}

function extraProducts(products) {
  return (Array.isArray(products) ? products : []).filter((p) => !CARD_PRODUCTS.has(p))
}

function buildOriginationsByProduct(rowYear, insightsSource) {
  const totalOrig = Number(rowYear.orig ?? 0)
  const products = rowYear.products || []
  const out = {}
  const h = insightsSource?.hmdaInsights

  const getLt = (code) => {
    const lt = h?.loanTypeSummary
    if (!lt) return null
    const row = lt[String(code)] ?? lt[code]
    return originatedFromLoanTypeRow(row)
  }

  for (const code of [1, 2, 3, 4]) {
    const label = HMDA_LOAN_TYPE_LABELS[code]
    const n = getLt(code)
    if (n != null) out[label] = { originated: n, approximate: false, hmdaLoanType: code }
  }

  const extras = extraProducts(products)
  const { sum, hasData } = sumLoanTypes14(h)
  if (extras.length === 1 && hasData && totalOrig > 0) {
    const rem = Math.max(0, Math.round(totalOrig - sum))
    if (rem > 0) {
      const tag = extras[0]
      if (out[tag] == null) {
        out[tag] = {
          originated: rem,
          approximate: true,
          note: 'Remainder after HMDA loan_type 1–4; single extra product tag on panel.',
        }
      }
    }
  }

  for (const p of products) {
    if (out[p] == null) {
      out[p] = {
        originated: null,
        approximate: false,
        note: 'No HMDA loan_type originated count in merged insights; see row.orig for total originated units.',
      }
    }
  }

  return {
    byProduct: out,
    totalOriginatedUnits: totalOrig,
    mergedInsightsFromYear: insightsSource?.dataYear ?? null,
  }
}

function buildDeclinations(insightsSource) {
  const h = insightsSource?.hmdaInsights
  if (!h) {
    return {
      available: false,
      note: `No hmdaInsights on ${YEAR} row and no prior-year same-LEI row with insights to merge.`,
    }
  }
  return {
    available: true,
    mergedFromReportingYear: h.reportingYear ?? insightsSource.dataYear ?? null,
    totalApplications: h.totalApplications ?? null,
    deniedApplications: h.denialCount ?? null,
    withdrawnApplications: h.withdrawalCount ?? null,
    incompleteApplications: h.incompleteCount ?? null,
    approvedNotAccepted: h.approvedNotAcceptedCount ?? null,
    purchasedLoans: h.purchasedLoanCount ?? null,
    denialReasons: h.denialReasons && typeof h.denialReasons === 'object' ? h.denialReasons : {},
    denialReasonsSuppressedCount: h.denialReasonsSuppressedCount ?? null,
  }
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`Missing ${SRC} — run fetch-hmda-mlar-insights first`)
    process.exit(1)
  }

  const raw = JSON.parse(fs.readFileSync(SRC, 'utf8'))
  const all = Array.isArray(raw?.lenders) ? raw.lenders : Array.isArray(raw) ? raw : []
  const byLei = new Map()
  for (const row of all) {
    const lei = cleanId(row.lei)
    if (!lei) continue
    if (!byLei.has(lei)) byLei.set(lei, [])
    byLei.get(lei).push(row)
  }

  const pickFallback = (lei, currentYear) => {
    const rows = byLei.get(lei) || []
    return (
      rows
        .filter((r) => r !== undefined && Number(r.dataYear || 0) < currentYear)
        .sort((a, b) => Number(b.dataYear || 0) - Number(a.dataYear || 0))[0] || null
    )
  }

  const yearRows = all.filter((r) => Number(r.dataYear) === YEAR)
  const lenders = yearRows.map((row) => {
    const lei = cleanId(row.lei) || ''
    const fallback = lei ? pickFallback(lei, YEAR) : null

    const nmlsResolved = cleanId(row.nmls) || cleanId(fallback?.nmls) || null
    const { legalName, dba } = parseDbaFromName(row.name)

    const insightsForProducts = row.hmdaInsights ? row : fallback?.hmdaInsights ? fallback : null
    const originationBreakdown = buildOriginationsByProduct(row, insightsForProducts || row)

    const declinations = buildDeclinations(
      row.hmdaInsights ? row : fallback?.hmdaInsights ? fallback : null,
    )

    return {
      ...row,
      nmls: nmlsResolved ?? '',
      nmlsNumber: nmlsResolved,
      legalName,
      dba,
      originationBreakdown,
      declinations,
    }
  })

  fs.mkdirSync(HMDA_DATA_DIR, { recursive: true })
  const payload = {
    meta: {
      exportedAt: new Date().toISOString(),
      sourceFile: 'lenders-from-hmda.json',
      dataYear: YEAR,
      recordCount: lenders.length,
      description: `HMDA ${YEAR} lender panel with NMLS/DBA/product/declination enrichment.`,
    },
    lenders,
  }

  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2), 'utf8')
  const bytes = fs.statSync(OUT).size
  console.log(
    JSON.stringify(
      { out: OUT, year: YEAR, recordCount: lenders.length, bytes, mb: (bytes / 1024 / 1024).toFixed(2) },
      null,
      2,
    ),
  )
}

main()
