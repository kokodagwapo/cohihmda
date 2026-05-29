import { ffiecAggregations } from './ffiec-client.mjs'

/** FFIEC Data Browser `ethnicities` filter values (derived_ethnicity). */
export const FFIEC_ETHNICITY_VALUES = [
  'Hispanic or Latino',
  'Not Hispanic or Latino',
  'Joint',
  'Ethnicity Not Available',
  'Free Form Text Only',
]

/** FFIEC Data Browser `races` filter values (derived_race). */
export const FFIEC_RACE_VALUES = [
  'American Indian or Alaska Native',
  'Asian',
  'Black or African American',
  'Native Hawaiian or Other Pacific Islander',
  'White',
  '2 or more minority races',
  'Joint',
  'Race Not Available',
  'Free Form Text Only',
]

/** FFIEC Data Browser `sexes` filter values (derived_sex). */
export const FFIEC_SEX_VALUES = ['Female', 'Male', 'Joint', 'Sex Not Available']

function countsFromAggregationRows(json, dimensionField) {
  const out = {}
  for (const r of json?.aggregations || []) {
    const k = String(r[dimensionField] ?? '').trim()
    if (!k) continue
    const c = Number(r.count) || 0
    if (c > 0) out[k] = c
  }
  return out
}

/**
 * Originated-loan applicant demographics from public FFIEC aggregations (derived_* fields).
 * @param {string} lei
 * @param {number} year
 * @param {ReturnType<import('./ffiec-client.mjs').createFfiecCache>} ffiecCache
 */
export async function fetchDemographicsOnOriginated(lei, year, ffiecCache) {
  const base = { years: year, leis: lei, actions_taken: '1' }
  const opts = { cache: ffiecCache, timeoutMs: 28000 }

  const [ethRes, raceRes, sexRes] = await Promise.all([
    ffiecAggregations({ ...base, ethnicities: FFIEC_ETHNICITY_VALUES.join(',') }, opts),
    ffiecAggregations({ ...base, races: FFIEC_RACE_VALUES.join(',') }, opts),
    ffiecAggregations({ ...base, sexes: FFIEC_SEX_VALUES.join(',') }, opts),
  ])

  return {
    ethnicity: countsFromAggregationRows(ethRes.json, 'ethnicities'),
    race: countsFromAggregationRows(raceRes.json, 'races'),
    sex: countsFromAggregationRows(sexRes.json, 'sexes'),
    databrowserSource: true,
    reportingYear: year,
  }
}
