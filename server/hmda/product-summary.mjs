import { ALL_PRODUCTS, loadLenderPack } from './static-lenders-store.mjs'
import { useHmdaWarehouse, isWarehouseReady } from './data-source.mjs'
import { ffiecNationwideAggregations } from './ffiec-client.mjs'

const HMDA_PRODUCT_LOAN_TYPE_CODE = {
  Conventional: '1',
  FHA: '2',
  VA: '3',
  USDA: '4',
}

const LOAN_TYPE_CODE_TO_PRODUCT = {
  1: 'Conventional',
  2: 'FHA',
  3: 'VA',
  4: 'USDA',
}

function sumLoanTypeUnits(members, ltCode) {
  let total = 0
  let any = false
  for (const l of members) {
    // 1) Try new 2025 structure: originationBreakdown.byProduct
    const byProd = l.originationBreakdown?.byProduct
    if (byProd) {
      for (const row of Object.values(byProd)) {
        if (String(row?.hmdaLoanType) === String(ltCode) && row?.originated != null) {
          total += Number(row.originated) || 0
          any = true
        }
      }
      continue
    }
    // 2) Fallback to older 2022–2024 structure: hmdaInsights.loanTypeSummary
    const lt = l.hmdaInsights?.loanTypeSummary?.[String(ltCode)]
    if (lt?.originated != null) {
      total += Number(lt.originated) || 0
      any = true
    }
  }
  return any ? total : null
}

async function fetchLiveLoanTypeCounts(year) {
  const yr = Number(year)
  if (!Number.isFinite(yr) || yr < 2018 || yr > 2035) return null

  const codes = ['1', '2', '3', '4']
  const out = {}
  try {
    await Promise.all(
      codes.map(async (code) => {
        const { json } = await ffiecNationwideAggregations(
          {
            years: String(yr),
            loan_types: code,
            actions_taken: '1',
          },
          { timeoutMs: 20000 },
        )
        const agg = json?.aggregations?.[0]
        const count = Number(agg?.count) || 0
        if (count > 0) {
          const product = LOAN_TYPE_CODE_TO_PRODUCT[code]
          if (product) out[product] = count
        }
      }),
    )
    return Object.keys(out).length > 0 ? out : null
  } catch (e) {
    console.warn('[HMDA product-summary] Live FFIEC loan-type fetch failed:', e?.message)
    return null
  }
}

export async function buildProductSummary(year = 2025) {
  if (useHmdaWarehouse() && (await isWarehouseReady())) {
    const { buildProductSummaryFromDb } = await import('./product-warehouse-store.mjs')
    return buildProductSummaryFromDb(year)
  }

  const pack = await loadLenderPack(year)
  const lenders = pack.lenders || []

  // Build products from static data first
  const products = ALL_PRODUCTS.map((name) => {
    const members = lenders.filter((l) => Array.isArray(l.products) && l.products.includes(name))
    const ltCode = HMDA_PRODUCT_LOAN_TYPE_CODE[name]
    const unitsOriginated = ltCode ? sumLoanTypeUnits(members, ltCode) : null
    const topLenders = [...members]
      .sort((a, b) => (Number(b.dollarVol) || 0) - (Number(a.dollarVol) || 0))
      .slice(0, 5)
      .map((l) => l.name)
    return {
      name,
      count: members.length,
      unitsOriginated,
      topLenders,
    }
  })

  // Check if any loan-type product has missing unitsOriginated
  const hasMissing = products.some(
    (p) => HMDA_PRODUCT_LOAN_TYPE_CODE[p.name] && p.unitsOriginated == null,
  )

  // If missing, fetch live nationwide counts from CFPB
  if (hasMissing) {
    const live = await fetchLiveLoanTypeCounts(year)
    if (live) {
      for (const p of products) {
        if (HMDA_PRODUCT_LOAN_TYPE_CODE[p.name] && p.unitsOriginated == null && live[p.name] != null) {
          p.unitsOriginated = live[p.name]
        }
      }
    }
  }

  const insightsBackfillCount = lenders.filter((l) => {
    const mergedFrom = Number(l.originationBreakdown?.mergedInsightsFromYear)
    if (Number.isFinite(mergedFrom) && mergedFrom > 0 && mergedFrom < Number(year)) return true
    const ry = Number(l.hmdaInsights?.reportingYear)
    return Number.isFinite(ry) && ry > 0 && ry < Number(year)
  }).length

  return {
    meta: {
      dataYear: Number(year),
      exportedAt: pack.meta?.exportedAt || null,
      recordCount: lenders.length,
      source: 'static JSON',
      liveFallback: hasMissing ? 'ffiec-nationwide' : null,
      insightsBackfillFromPriorYear: insightsBackfillCount > 0,
      insightsBackfillCount,
      insightsBackfillNote:
        insightsBackfillCount > 0
          ? `${insightsBackfillCount} lender row(s) use prior-year LAR insights for dimension metrics until native ${year} LAR is available.`
          : null,
    },
    products,
  }
}
