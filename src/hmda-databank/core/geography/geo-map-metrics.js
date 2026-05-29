/** Metric definitions for Mapbox geography choropleth + tooltips. */

export const GEO_MAP_DEFAULT_METRIC = 'units'

export const GEO_MAP_METRICS = [
  { id: 'volume', label: 'Loan volume', shortLabel: 'Vol', format: 'currency', field: 'volume' },
  { id: 'units', label: 'Loan units', shortLabel: 'Units', format: 'number', field: 'units' },
  { id: 'avgLoan', label: 'Avg loan size', shortLabel: 'Avg', format: 'currency', field: 'avgLoan' },
  { id: 'medianIncome', label: 'Median household income (ACS proxy)', shortLabel: 'Inc', format: 'currency', field: 'medianIncome' },
  { id: 'denialRate', label: 'Denial rate', shortLabel: 'Deny', format: 'percent', field: 'denialRate' },
  { id: 'withdrawnRate', label: 'Withdrawn rate', shortLabel: 'W/D', format: 'percent', field: 'withdrawnRate' },
  { id: 'pullthroughRate', label: 'Origination share', shortLabel: 'Orig', format: 'percent', field: 'pullthroughRate' },
  { id: 'floodRisk', label: 'Flood risk index', shortLabel: 'Flood', format: 'score', field: 'floodRisk' },
  { id: 'wildfireRisk', label: 'Wildfire risk index', shortLabel: 'Fire', format: 'score', field: 'wildfireRisk' },
  { id: 'compositeRisk', label: 'Composite hazard', shortLabel: 'Haz', format: 'score', field: 'compositeRisk' },
]

export function metricById(id) {
  return (
    GEO_MAP_METRICS.find((m) => m.id === id) ||
    GEO_MAP_METRICS.find((m) => m.id === GEO_MAP_DEFAULT_METRIC) ||
    GEO_MAP_METRICS[0]
  )
}

export function formatMetricValue(metric, value) {
  if (value == null || Number.isNaN(Number(value))) return '—'
  const n = Number(value)
  switch (metric?.format) {
    case 'currency':
      if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
      if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
      if (n >= 1e3) return `$${Math.round(n / 1e3)}K`
      return `$${n.toLocaleString()}`
    case 'percent':
      return `${(n * 100).toFixed(1)}%`
    case 'score':
      return `${Math.round(n)}/100`
    default:
      return n.toLocaleString()
  }
}

/**
 * Choropleth ramps — vivid hues on the 3D globe + teal ocean basemap.
 */
export function metricColorStops(metricId, min, max) {
  const span = Math.max(1, max - min)
  const t1 = min + span * 0.33
  const t2 = min + span * 0.66
  if (metricId === 'medianIncome') {
    return [
      min, '#e0f2fe',
      t1, '#38bdf8',
      t2, '#0284c7',
      max, '#0c4a6e',
    ]
  }
  if (metricId.includes('Risk') || metricId === 'denialRate' || metricId === 'withdrawnRate') {
    return [
      min, '#ecfdf5',
      t1, '#fde047',
      t2, '#fb923c',
      max, '#e11d48',
    ]
  }
  if (metricId === 'pullthroughRate') {
    return [
      min, '#fce7f3',
      t1, '#fde047',
      t2, '#4ade80',
      max, '#059669',
    ]
  }
  return [
    min, '#e0f2fe',
    t1, '#67e8f9',
    t2, '#6366f1',
    max, '#4338ca',
  ]
}

/** CSS gradient for the floating legend (hue-aligned with `metricColorStops`). */
export function metricLegendGradientCss(metricId) {
  const s = metricColorStops(metricId, 0, 1)
  const c0 = s[1]
  const c1 = s[3]
  const c2 = s[5]
  const c3 = s[7]
  return `linear-gradient(90deg, ${c0} 0%, ${c1} 34%, ${c2} 68%, ${c3} 100%)`
}

export function getMetricValue(props, metricId) {
  if (!props) return null
  const m = metricById(metricId)
  const v = props[m.field]
  return v != null ? Number(v) : null
}
