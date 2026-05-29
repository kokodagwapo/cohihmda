/** @param {unknown} drilldown */
export function geoDrilldownYearHasData(drilldown, yearKey) {
  const yk = String(yearKey ?? '')
  if (!/^\d{4}$/.test(yk)) return false
  const slice = drilldown?.[yk]
  if (!slice || typeof slice !== 'object') return false
  return Object.keys(slice).some((k) => k !== 'meta' && Number(slice[k]?.units ?? 0) > 0)
}

/** Sorted descending list of HMDA years with state-level units in geo drilldown JSON. */
export function listGeoDrilldownYears(drilldown) {
  if (!drilldown || typeof drilldown !== 'object') return []
  return Object.keys(drilldown)
    .filter((k) => /^\d{4}$/.test(k) && geoDrilldownYearHasData(drilldown, k))
    .sort((a, b) => Number(b) - Number(a))
}

/** Toolbar year picker: anchor filing year plus any years present in drilldown data. */
export function listGeoMapYearOptions(drilldown, anchorYear = '2025') {
  const anchor = String(anchorYear ?? '2025')
  const set = new Set(listGeoDrilldownYears(drilldown))
  if (/^\d{4}$/.test(anchor)) set.add(anchor)
  return [...set].sort((a, b) => Number(b) - Number(a))
}

/**
 * Map toolbar / choropleth year: honor explicit user selection when data exists;
 * otherwise pick the nearest available filing year (geo JSON often lags lender panel).
 */
export function resolveGeoMapDisplayYear(drilldown, selectedYear, fallbackYear) {
  const want = String(selectedYear ?? fallbackYear ?? '2025')
  if (geoDrilldownYearHasData(drilldown, want)) return want
  if (selectedYear != null && String(selectedYear).trim() === want) return want
  return resolveGeoDrilldownYear(drilldown, want)
}

/** Pick a year key present in geo-drilldown-from-hmda.json (may lag panelYear). */
export function resolveGeoDrilldownYear(drilldown, panelYear) {
  const want = String(panelYear ?? '2025')
  if (!drilldown || typeof drilldown !== 'object') return want
  if (geoDrilldownYearHasData(drilldown, want)) return want
  const sorted = listGeoDrilldownYears(drilldown)
  const pref = Number(want)
  const notAfter = sorted.filter((y) => Number(y) <= pref)
  const pool = notAfter.length ? notAfter : sorted
  const hit = pool.find((y) => geoDrilldownYearHasData(drilldown, y))
  return hit || sorted.find((y) => geoDrilldownYearHasData(drilldown, y)) || want
}
