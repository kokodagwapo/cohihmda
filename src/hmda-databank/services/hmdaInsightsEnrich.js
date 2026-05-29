/**

 * Client-side batch enrichment of lender rows from FFIEC lender-insights API.

 */

import {

  hmdaInsightsMatchesYear,

  larDetailYearForPanel,

  mergeLenderInsightsIntoRow,

  selectHmdaInsightsForLenderRow,

} from '@hmda/utils/hmdaFfiecLive.js'

import { fetchLenderInsightsBatch, fetchStaticHmdaLenders } from '@hmda/services/hmdaApi.js'

function larEnrichAttempted(lender, larYear) {

  return Number(lender?.insightsEnrichLarYear) === Number(larYear) && lender?.insightsEnrichAttemptedAt != null

}



function markEnrichAttempted(row, larYear) {

  return {

    ...row,

    insightsEnrichLarYear: larYear,

    insightsEnrichAttemptedAt: Date.now(),

  }

}



/** @param {object[]} lenders */

export function lendersNeedingInsights(lenders, limit = 120) {

  return [...lenders]

    .filter((l) => {

      const lei = String(l.lei || '').trim()

      if (!/^[A-Z0-9]{20}$/.test(lei)) return false

      const larYear = larDetailYearForPanel(l.dataYear)

      if (larEnrichAttempted(l, larYear)) return false

      const h = selectHmdaInsightsForLenderRow(l)

      if (!h) return true

      const hasLt = h.loanTypeSummary && Object.keys(h.loanTypeSummary).length > 0

      const hasApps = (h.totalApplications || 0) > 0

      return !hasLt || !hasApps

    })

    .sort((a, b) => (b.originations || b.units || 0) - (a.originations || a.units || 0))

    .slice(0, limit)

}



/**

 * Merge static JSON insights into API lender rows (by LEI + year, then prior year).

 * @param {object[]} apiLenders

 * @param {object[]} staticLenders

 */

export function mergeStaticInsightsIntoLenders(apiLenders, staticLenders) {

  if (!Array.isArray(staticLenders) || staticLenders.length === 0) return apiLenders

  const byKey = new Map()

  for (const row of staticLenders) {

    const lei = String(row?.lei || '').trim().toUpperCase()

    if (!lei) continue

    const y = Number(row.dataYear) || 0

    byKey.set(`${lei}|${y}`, row)

  }

  return apiLenders.map((l) => {

    const lei = String(l.lei || '').trim().toUpperCase()

    const y = Number(l.dataYear) || 0

    const st = byKey.get(`${lei}|${y}`)

    if (!st?.hmdaInsights) return l

    if (!hmdaInsightsMatchesYear(st.hmdaInsights, y)) return l

    return mergeLenderInsightsIntoRow(

      {

        ...l,

        nmls: l.nmls || st.nmls,

        products: l.products?.length ? l.products : st.products,

        fico: l.fico ?? st.fico,

        ltv: l.ltv ?? st.ltv,

        dti: l.dti ?? st.dti,

        branches: l.branches ?? st.branches,

        dollarVol: l.dollarVol ?? st.dollarVol,

      },

      st.hmdaInsights,

    )

  })

}



/** Max LEIs per `/lender-insights` request (server cap is 8). */

const BATCH_SIZE = 8



/**

 * Background-enrich lenders from FFIEC (loan_type product units + disposition counts).

 * @param {object[]} lenders - pool to pick from (e.g. visible page only)

 * @param {number} year - FFIEC LAR reporting year (use larDetailYearForPanel(panelYear))

 * @param {(updater: (prev: object[]) => object[]) => void} setLenders

 * @param {{ limit?: number }} [opts]

 */

export async function enrichLendersFromFfiecApi(lenders, year, setLenders, opts = {}) {

  const limit = opts.limit ?? 100

  const queue = lendersNeedingInsights(lenders, limit)

  if (queue.length === 0) return



  for (let i = 0; i < queue.length; i += BATCH_SIZE) {

    const batch = queue.slice(i, i + BATCH_SIZE)

    const leis = batch.map((l) => String(l.lei).trim().toUpperCase())

    const leiSet = new Set(leis)

    try {

      const body = await fetchLenderInsightsBatch({

        year,

        leis,

        states: false,

        medians: false,

      })

      const map = body?.insights || {}

      setLenders((prev) =>

        prev.map((l) => {

          const lei = String(l.lei || '').trim().toUpperCase()

          if (!leiSet.has(lei)) return l

          const ins = map[lei]

          if (!ins || ins.error) return markEnrichAttempted(l, year)

          return markEnrichAttempted(mergeLenderInsightsIntoRow(l, ins), year)

        }),

      )

    } catch (e) {

      console.warn('[HMDA] insights batch failed:', e?.message)

      setLenders((prev) =>

        prev.map((l) => {

          const lei = String(l.lei || '').trim().toUpperCase()

          return leiSet.has(lei) ? markEnrichAttempted(l, year) : l

        }),

      )

    }

  }

}



/**

 * Full insights for one lender (modal): states + medians when volume allows.

 */

export async function fetchFullLenderInsights(lei, year, { includeMedians = true, includeDemographics = true } = {}) {

  const body = await fetchLenderInsightsBatch({

    year,

    leis: [lei],

    states: true,

    medians: includeMedians,

    demographics: includeDemographics,

  })

  return body?.insights?.[lei] || null

}

/** State breakdown for geography map — batched, no medians (faster). */
export async function fetchMapLenderInsightsBatch(leis, year) {
  const list = [...new Set((leis || []).map((s) => String(s).trim().toUpperCase()).filter((lei) => /^[A-Z0-9]{20}$/.test(lei)))]
  if (!list.length) return {}
  const out = {}
  for (let i = 0; i < list.length; i += BATCH_SIZE) {
    const chunk = list.slice(i, i + BATCH_SIZE)
    try {
      const body = await fetchLenderInsightsBatch({
        year,
        leis: chunk,
        states: true,
        medians: false,
        demographics: false,
      })
      const map = body?.insights || {}
      for (const lei of chunk) {
        if (map[lei] && !map[lei].error) out[lei] = map[lei]
      }
    } catch (e) {
      console.warn('[HMDA] map insights chunk failed:', e?.message)
    }
  }
  return out
}



/** Load static lenders file and merge into rows when deployed. */

export async function hydrateLendersWithStaticInsights(lenders) {

  try {

    const staticPack = await fetchStaticHmdaLenders()

    if (staticPack?.lenders?.length) {

      return mergeStaticInsightsIntoLenders(lenders, staticPack.lenders)

    }

  } catch {

    /* optional */

  }

  return lenders

}


