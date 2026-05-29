import { ffiecFilers, mapPool } from './ffiec-client.mjs'

/**
 * Build lender panel rows from official FFIEC filers list.
 * @see https://ffiec.cfpb.gov/documentation/api/data-browser/ — HMDA Filers endpoint
 */
export async function buildLendersFromFilers(year, ffiecCache) {
  const { json } = await ffiecFilers({ years: year }, { cache: ffiecCache, timeoutMs: 45000 })
  const institutions = Array.isArray(json?.institutions) ? json.institutions : []

  return institutions
    .map((inst) => {
      const lei = String(inst?.lei || '').trim().toUpperCase()
      const name = String(inst?.name || '').replace(/\s+/g, ' ').trim()
      if (!lei || !name) return null
      const orig = Math.max(0, Number(inst?.count) || 0)
      const dataYear = Number(inst?.period) || year
      return {
        lei,
        name,
        orig,
        dataYear,
        conf: 88,
        databrowserSource: true,
        states: 1,
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.orig - a.orig)
}

/**
 * Fetch filers for each available year and return a combined panel (one row per LEI per year).
 * @param {number[]} years — newest first
 */
export async function buildLendersFromFilersMultiYear(years, ffiecCache) {
  const unique = [...new Set(years.map((y) => Number(y)).filter((y) => y >= 2018))].sort((a, b) => b - a)
  const chunks = await mapPool(
    unique,
    async (year) => {
      const lenders = await buildLendersFromFilers(year, ffiecCache)
      return { year, lenders }
    },
    3,
  )
  const byYear = Object.fromEntries(chunks.map((c) => [String(c.year), c.lenders]))
  const all = chunks.flatMap((c) => c.lenders)
  return { years: unique, byYear, lenders: all, count: all.length }
}
