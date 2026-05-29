import { ffiecFilers } from './ffiec-client.mjs'

/** Modern HMDA (post-2018 rule) — FFIEC Data Browser lower bound. */
export const HMDA_MODERN_MIN_YEAR = 2018

/** Default panel anchor + lookback (2025 and previous 10 calendar years). */
export const HMDA_DEFAULT_ANCHOR_YEAR = 2025
export const HMDA_DEFAULT_LOOKBACK_YEARS = 10

/**
 * Calendar years from anchor backward (inclusive).
 * @param {number} anchorYear
 * @param {number} lookback — number of years before anchor (10 → 11 years total)
 */
export function buildRequestedYearRange(anchorYear = HMDA_DEFAULT_ANCHOR_YEAR, lookback = HMDA_DEFAULT_LOOKBACK_YEARS) {
  const anchor = Number(anchorYear) || HMDA_DEFAULT_ANCHOR_YEAR
  const n = Math.max(0, Math.min(30, Number(lookback) || HMDA_DEFAULT_LOOKBACK_YEARS))
  const years = []
  for (let y = anchor; y > anchor - n - 1; y -= 1) {
    years.push(y)
  }
  return years
}

/**
 * Probe FFIEC filers endpoint to see which years return data (cached).
 * @param {number[]} candidates — newest first
 * @param {ReturnType<import('./ffiec-client.mjs').createFfiecCache>} ffiecCache
 */
export async function discoverAvailableYears(candidates, ffiecCache) {
  const available = []
  const unavailable = []

  await Promise.all(
    candidates.map(async (year) => {
      try {
        const { json } = await ffiecFilers({ years: year }, { cache: ffiecCache, timeoutMs: 20000 })
        const count = Array.isArray(json?.institutions) ? json.institutions.length : 0
        if (count > 0) {
          available.push({ year, count })
        } else {
          unavailable.push({ year, reason: 'empty filers list' })
        }
      } catch (e) {
        unavailable.push({ year, reason: String(e?.message || e).slice(0, 200) })
      }
    }),
  )

  available.sort((a, b) => b.year - a.year)
  unavailable.sort((a, b) => b.year - a.year)
  return {
    available: available.map((r) => r.year),
    availableDetail: available,
    unavailable,
  }
}

/**
 * Resolve years for anchor + lookback: prefer live FFIEC, include anchor in requested even if pending.
 * @param {number} anchorYear
 * @param {number} lookback
 * @param {ReturnType<import('./ffiec-client.mjs').createFfiecCache>} ffiecCache
 */
export async function resolveHmdaYearWindow(anchorYear, lookback, ffiecCache) {
  const requested = buildRequestedYearRange(anchorYear, lookback)
  const probeFrom = Math.max(HMDA_MODERN_MIN_YEAR, Math.min(...requested))
  const probeTo = Math.max(...requested)
  const candidates = []
  for (let y = probeTo; y >= probeFrom; y -= 1) candidates.push(y)

  const discovered = await discoverAvailableYears(candidates, ffiecCache)
  const preModern = requested.filter((y) => y < HMDA_MODERN_MIN_YEAR).map((y) => ({
    year: y,
    reason: 'Pre-2018 HMDA not served by FFIEC Data Browser API (use legacy HMDA files)',
  }))

  const unavailable = [
    ...preModern,
    ...discovered.unavailable.filter((u) => requested.includes(u.year)),
  ]

  return {
    anchorYear: Number(anchorYear) || HMDA_DEFAULT_ANCHOR_YEAR,
    lookback: Number(lookback) || HMDA_DEFAULT_LOOKBACK_YEARS,
    requested,
    available: discovered.available,
    availableDetail: discovered.availableDetail,
    unavailable,
    modernMinYear: HMDA_MODERN_MIN_YEAR,
    note:
      'FFIEC Data Browser API covers modern HMDA (2018+). Years before 2018 and not-yet-published filing years appear in requested but may be unavailable until CFPB enables them or you deploy static MLAR extracts.',
  }
}
