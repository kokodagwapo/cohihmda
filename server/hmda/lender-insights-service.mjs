import { createInterface } from 'readline'
import { Readable } from 'stream'
import { ffiecAggregations, mapPool } from './ffiec-client.mjs'
import { US_STATE_CODES } from './us-states.mjs'
import { fetchDemographicsOnOriginated } from './ffiec-demographics.mjs'
import {
  buildInsightsFromFfiecAggregationRows,
  mergeDemographicsIntoInsights,
  mergeLoanTypeSummaryIntoInsights,
  mergeMedianPricingIntoInsights,
  mergeStateBreakdownIntoInsights,
} from './ffiec-insights-build.mjs'

const ACTIONS_ALL = '1,2,3,4,5,6,7,8'
const LOAN_TYPES = ['1', '2', '3', '4']

/** Max originated loans before skipping CSV median stream (large filers). */
const CSV_MEDIAN_MAX_ORIG = Math.max(
  0,
  parseInt(String(process.env.HMDA_CSV_MEDIAN_MAX_ORIG || '600000'), 10) || 600000,
)

function parseCsvLine(line) {
  const out = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else inQ = false
      } else cur += ch
    } else if (ch === '"') inQ = true
    else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

function parseSpread(raw) {
  const s = String(raw || '').trim()
  if (!s || s === 'NA' || s === 'Exempt') return null
  const v = parseFloat(s)
  if (!Number.isFinite(v) || v < -5 || v > 20) return null
  return Math.round(v * 1000) / 1000
}

function parseTermMonths(raw) {
  const s = String(raw || '').trim()
  if (!s || s === 'NA' || s === 'Exempt') return null
  const v = parseInt(s, 10)
  if (!Number.isFinite(v) || v <= 0 || v > 600) return null
  return v
}

function parseInterestRate(raw) {
  const s = String(raw || '').trim()
  if (!s || s === 'NA' || s === 'Exempt') return null
  const v = parseFloat(s)
  if (!Number.isFinite(v) || v < 1.5 || v > 15) return null
  return Math.round(v * 1000) / 1000
}

function parseCltv(raw) {
  const s = String(raw || '').trim()
  if (!s || s === 'NA' || s === 'Exempt') return null
  const v = parseFloat(s)
  if (!Number.isFinite(v) || v < 0 || v > 200) return null
  return Math.round(v * 10) / 10
}

function parseDti(raw) {
  const s = String(raw || '').trim()
  if (!s || s === 'NA' || s === 'Exempt') return null
  const v = parseFloat(s)
  if (!Number.isFinite(v) || v < 0 || v > 80) return null
  return Math.round(v * 10) / 10
}

function medianSortedFloat(arr) {
  if (!arr.length) return null
  arr.sort((a, b) => a - b)
  const m = Math.floor(arr.length / 2)
  const med = arr.length % 2 ? arr[m] : (arr[m - 1] + arr[m]) / 2
  return Math.round(med * 1000) / 1000
}

function medianSortedMonths(arr) {
  if (!arr.length) return null
  arr.sort((a, b) => a - b)
  const m = Math.floor(arr.length / 2)
  const med = arr.length % 2 ? arr[m] : (arr[m - 1] + arr[m]) / 2
  return Math.round(med)
}

async function streamMediansFromOfficialCsv(lei, year, timeoutMs) {
  const u = new URL('https://ffiec.cfpb.gov/v2/data-browser-api/view/csv')
  u.searchParams.set('leis', lei)
  u.searchParams.set('years', String(year))
  u.searchParams.set('actions_taken', '1')

  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs)
  let res
  try {
    res = await fetch(u.toString(), {
      headers: { Accept: 'text/csv, text/plain, */*', 'User-Agent': 'coheus-site/1.0 (HMDA FFIEC proxy)' },
      signal: controller.signal,
    })
  } finally {
    clearTimeout(t)
  }
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`CSV ${res.status} ${text.slice(0, 200)}`)
  }
  if (!res.body) throw new Error('no CSV body')

  const nodeReadable = Readable.fromWeb(res.body)
  const rl = createInterface({ input: nodeReadable, crlfDelay: Infinity })

  let lineNo = 0
  let idxSpread = -1
  let idxTerm = -1
  let idxRate = -1
  let idxCltv = -1
  let idxDti = -1
  let idxLoanType = -1
  const spreads = []
  const terms = []
  const rates = []
  const cltvs = []
  const dtis = []
  const loanTypeCounts = new Map()

  for await (const line of rl) {
    if (!line.trim()) continue
    lineNo++
    const cols = parseCsvLine(line)
    if (lineNo === 1) {
      idxSpread = cols.indexOf('rate_spread')
      idxTerm = cols.indexOf('loan_term')
      idxRate = cols.indexOf('interest_rate')
      idxCltv = cols.indexOf('combined_loan_to_value_ratio')
      idxDti = cols.indexOf('debt_to_income_ratio')
      idxLoanType = cols.indexOf('loan_type')
      if (idxSpread < 0 || idxTerm < 0) {
        throw new Error('CSV missing rate_spread or loan_term column')
      }
      continue
    }
    const sp = parseSpread(cols[idxSpread])
    const tm = parseTermMonths(cols[idxTerm])
    if (sp != null) spreads.push(sp)
    if (tm != null) terms.push(tm)
    if (idxRate >= 0) {
      const ir = parseInterestRate(cols[idxRate])
      if (ir != null) rates.push(ir)
    }
    if (idxCltv >= 0) {
      const cv = parseCltv(cols[idxCltv])
      if (cv != null) cltvs.push(cv)
    }
    if (idxDti >= 0) {
      const dv = parseDti(cols[idxDti])
      if (dv != null) dtis.push(dv)
    }
    if (idxLoanType >= 0) {
      const code = String(cols[idxLoanType] ?? '').trim()
      if (code && code !== 'NA' && code !== 'Exempt' && /^\d+$/.test(code)) {
        loanTypeCounts.set(code, (loanTypeCounts.get(code) || 0) + 1)
      }
    }
  }

  const loanTypeSummary =
    loanTypeCounts.size > 0
      ? Object.fromEntries(
          [...loanTypeCounts.entries()].map(([k, v]) => [k, { applications: v, originated: v, dollarVolume: 0 }]),
        )
      : null

  return {
    originatedMedianRateSpread: medianSortedFloat(spreads),
    originatedMedianLoanTermMonths: medianSortedMonths(terms),
    originatedMedianInterestRate: medianSortedFloat(rates),
    originatedMedianCltv: medianSortedFloat(cltvs),
    originatedMedianDti: medianSortedFloat(dtis),
    spreadSampleSize: spreads.length,
    termSampleSize: terms.length,
    interestRateSampleSize: rates.length,
    loanTypeSummary,
  }
}

async function fetchLoanTypeSummary(lei, year, ffiecCache) {
  if (Number(year) > FFIEC_API_STATE_MAX_YEAR) return {}
  const results = await Promise.all(
    LOAN_TYPES.map(async (lt) => {
      try {
        const { json } = await ffiecAggregations(
          { years: year, leis: lei, actions_taken: ACTIONS_ALL, loan_types: lt },
          { cache: ffiecCache, timeoutMs: 25000 },
        )
        let applications = 0
        let originated = 0
        for (const r of json?.aggregations || []) {
          const c = Number(r?.count) || 0
          applications += c
          if (String(r?.actions_taken ?? '').trim() === '1') originated += c
        }
        return [lt, { applications, originated }]
      } catch {
        return [lt, { applications: 0, originated: 0 }]
      }
    }),
  )
  const summary = {}
  for (const [lt, counts] of results) {
    const applications = Math.max(0, Math.round(Number(counts?.applications) || 0))
    const originated = Math.max(0, Math.round(Number(counts?.originated) || 0))
    if (applications > 0 || originated > 0) {
      summary[lt] = { applications, originated, dollarVolume: 0 }
    }
  }
  return summary
}

/**
 * Stream FFIEC LAR CSV once and bucket originated counts + volume by state.
 * Replaces 51 per-state aggregation calls with a single HTTP request.
 * @param {string} lei
 * @param {number} year
 * @param {number} timeoutMs
 * @returns {Promise<Array<{ state: string, originated: number, volume: number, applications: number }>>}
 */
async function streamStateBreakdownFromOfficialCsv(lei, year, timeoutMs) {
  const numYear = Number(year)
  let csvUrl

  if (numYear > FFIEC_API_STATE_MAX_YEAR) {
    // For years beyond the FFIEC Data Browser range, use the per-institution MLAR text file
    // published at https://ffiec.cfpb.gov/data-publication/modified-lar/<year>
    csvUrl = `https://ffiec.cfpb.gov/file/modifiedLar/year/${numYear}/institution/${lei}/txt/header`
  } else {
    const u = new URL('https://ffiec.cfpb.gov/v2/data-browser-api/view/csv')
    u.searchParams.set('leis', lei)
    u.searchParams.set('years', String(year))
    u.searchParams.set('actions_taken', '1')
    csvUrl = u.toString()
  }

  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs)
  let res
  try {
    res = await fetch(csvUrl, {
      headers: { Accept: 'text/plain, text/csv, */*', 'User-Agent': 'coheus-site/1.0 (HMDA FFIEC proxy)' },
      signal: controller.signal,
    })
  } finally {
    clearTimeout(t)
  }
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`CSV state breakdown ${res.status} ${text.slice(0, 200)}`)
  }
  if (!res.body) throw new Error('no CSV body')

  const nodeReadable = Readable.fromWeb(res.body)
  const rl = createInterface({ input: nodeReadable, crlfDelay: Infinity })

  let lineNo = 0
  let idxState = -1
  let idxAmount = -1
  let idxAction = -1
  const byState = new Map()
  // MLAR files use pipe ('|') as delimiter; Data Browser CSV uses comma.
  const isMlar = numYear > FFIEC_API_STATE_MAX_YEAR

  for await (const line of rl) {
    if (!line.trim()) continue
    lineNo++
    if (lineNo === 1) {
      const cols = isMlar ? line.split('|') : parseCsvLine(line)
      idxState = cols.indexOf(isMlar ? 'state_code' : 'state_code')
      idxAmount = cols.indexOf(isMlar ? 'loan_amount' : 'loan_amount')
      idxAction = cols.indexOf(isMlar ? 'action_taken' : 'action_taken')
      if (idxState < 0) throw new Error(`CSV missing state_code column (${isMlar ? 'MLAR' : 'DataBrowser'})`)
      continue
    }
    const cols = isMlar ? line.split('|') : parseCsvLine(line)
    // For MLAR, only count originated loans (action_taken = 1)
    if (isMlar && idxAction >= 0) {
      const action = parseInt(cols[idxAction], 10)
      if (action !== 1) continue
    }
    const st = String(cols[idxState] ?? '').trim().toUpperCase()
    if (!/^[A-Z]{2}$/.test(st)) continue
    const amt = idxAmount >= 0 ? Number(cols[idxAmount]) : 0
    const entry = byState.get(st) || { state: st, originated: 0, volume: 0 }
    entry.originated += 1
    if (Number.isFinite(amt) && amt > 0) entry.volume += amt
    byState.set(st, entry)
  }

  return [...byState.values()]
    .map((row) => ({ ...row, applications: row.originated }))
    .sort((a, b) => b.originated - a.originated)
}

/** Fallback: per-state FFIEC aggregations (slow — 51 calls). Used only when CSV stream fails. */
async function fetchStateBreakdownPerStateAggregations(lei, year, ffiecCache) {
  const pairs = await mapPool(
    US_STATE_CODES,
    async (state) => {
      try {
        const { json } = await ffiecAggregations(
          { years: year, leis: lei, states: state, actions_taken: '1' },
          { cache: ffiecCache, timeoutMs: 20000 },
        )
        const row = json?.aggregations?.[0]
        const originated = Math.max(0, Number(row?.count) || 0)
        const volume = Math.max(0, Number(row?.sum) || 0)
        return originated > 0 ? { state, originated, volume, applications: originated } : null
      } catch {
        return null
      }
    },
    10,
  )
  return pairs
    .filter(Boolean)
    .sort((a, b) => b.originated - a.originated)
}

const STATE_CSV_MAX_ORIG = Math.max(
  0,
  parseInt(String(process.env.HMDA_CSV_STATE_BREAKDOWN_MAX_ORIG || '600000'), 10) || 600000,
)
const STATE_CSV_TIMEOUT_MS = Math.max(
  10000,
  parseInt(String(process.env.HMDA_CSV_STATE_BREAKDOWN_TIMEOUT_MS || '60000'), 10) || 60000,
)

/** Max year the FFIEC Data Browser API supports for per-state aggregation queries. */
const FFIEC_API_STATE_MAX_YEAR = 2024

async function fetchStateBreakdown(lei, year, ffiecCache, totalOriginated = 0) {
  // For years beyond the FFIEC Data Browser range, or when FFIEC returned no originated
  // count (API 400), always attempt the official LAR CSV which covers all filed years.
  const beyondFfiec = Number(year) > FFIEC_API_STATE_MAX_YEAR
  const trycsv = beyondFfiec || (totalOriginated > 0 && totalOriginated <= STATE_CSV_MAX_ORIG)
  if (trycsv) {
    try {
      const csvRows = await streamStateBreakdownFromOfficialCsv(lei, year, STATE_CSV_TIMEOUT_MS)
      if (csvRows.length > 0) return csvRows
    } catch (e) {
      if (beyondFfiec) {
        console.warn(`[HMDA] CSV state breakdown failed for ${lei}/${year}: ${e?.message}`)
        return []
      }
      console.warn(`[HMDA] CSV state breakdown failed for ${lei}/${year}: ${e?.message}; falling back to per-state aggregations`)
    }
  }
  if (beyondFfiec) return []
  return fetchStateBreakdownPerStateAggregations(lei, year, ffiecCache)
}

/**
 * @param {string} lei
 * @param {number} year
 * @param {ReturnType<import('./ffiec-client.mjs').createFfiecCache>} ffiecCache
 * @param {{ includeStates?: boolean, includeMedians?: boolean, includeDemographics?: boolean }} [opts]
 */
async function buildLenderInsightsForLeiYear(lei, year, ffiecCache, opts) {
  const { includeStates = false, includeMedians = false, includeDemographics = false } = opts
  const beyondFfiec = Number(year) > FFIEC_API_STATE_MAX_YEAR

  let aggregationJson = null
  try {
    const { json } = await ffiecAggregations(
      { years: year, leis: lei, actions_taken: ACTIONS_ALL },
      { cache: ffiecCache, timeoutMs: 30000 },
    )
    aggregationJson = json
  } catch (e) {
    if (!beyondFfiec) throw e
    // For years beyond the FFIEC Data Browser range, swallow the API error and
    // proceed with empty aggregations so we can still pull state data from the CSV.
    console.warn(`[HMDA] FFIEC aggregation unavailable for ${lei}/${year} (beyond API range): ${e?.message}`)
  }

  let insights = buildInsightsFromFfiecAggregationRows(aggregationJson?.aggregations || [], year)
  const loanTypeSummary = await fetchLoanTypeSummary(lei, year, ffiecCache)
  insights = mergeLoanTypeSummaryIntoInsights(insights, loanTypeSummary)

  if (includeStates) {
    // When FFIEC API returned no data (e.g. year > FFIEC_API_STATE_MAX_YEAR), pass a
    // non-zero sentinel so fetchStateBreakdown tries the CSV.
    const totalOrig = Number(insights?.totalOriginated) || (beyondFfiec ? 1 : 0)
    const stateBreakdown = await fetchStateBreakdown(lei, year, ffiecCache, totalOrig)
    insights = mergeStateBreakdownIntoInsights(insights, stateBreakdown)
    // When FFIEC aggregation was unavailable, derive totalOriginated from state CSV sum.
    if (beyondFfiec && (!insights.totalOriginated) && stateBreakdown.length > 0) {
      const csvTotal = stateBreakdown.reduce((s, r) => s + (Number(r.originated) || 0), 0)
      if (csvTotal > 0) insights = { ...insights, totalOriginated: csvTotal }
    }
  }

  if (includeMedians && (insights.totalOriginated || 0) > 0 && (insights.totalOriginated || 0) <= CSV_MEDIAN_MAX_ORIG) {
    try {
      const timeoutMs = Math.min(
        120000,
        Math.max(15000, parseInt(String(process.env.HMDA_CSV_MEDIAN_TIMEOUT_MS || '90000'), 10) || 90000),
      )
      const medians = await streamMediansFromOfficialCsv(lei, year, timeoutMs)
      insights = mergeMedianPricingIntoInsights(insights, medians)
    } catch (e) {
      insights = {
        ...insights,
        csvMedianError: String(e?.message || e).slice(0, 200),
      }
    }
  }

  if (includeDemographics && (insights.totalOriginated || 0) > 0) {
    try {
      const demographics = await fetchDemographicsOnOriginated(lei, year, ffiecCache)
      insights = mergeDemographicsIntoInsights(insights, demographics)
    } catch (e) {
      insights = {
        ...insights,
        demographicsFetchError: String(e?.message || e).slice(0, 200),
      }
    }
  }

  return insights
}

export async function buildLenderInsightsForLei(lei, year, ffiecCache, opts = {}) {
  return buildLenderInsightsForLeiYear(lei, year, ffiecCache, opts)
}

/**
 * @param {string[]} leis
 * @param {number} year
 * @param {ReturnType<import('./ffiec-client.mjs').createFfiecCache>} ffiecCache
 * @param {{ includeStates?: boolean, includeMedians?: boolean }} [opts]
 */
export async function buildLenderInsightsBatch(leis, year, ffiecCache, opts = {}) {
  const out = {}
  await mapPool(
    leis,
    async (lei) => {
      try {
        out[lei] = await buildLenderInsightsForLei(lei, year, ffiecCache, opts)
      } catch (e) {
        out[lei] = { error: String(e?.message || e).slice(0, 240) }
      }
    },
    3,
  )
  return out
}
