/** Hide Mapbox "Gulf of Mexico" water labels; custom marker shows "Gulf of America". */

const GULF_NAMES = ['Gulf of Mexico', 'Golfo de México', 'Golfo de Mexico']

const GULF_MEXICO_MATCH = [
  '!',
  [
    'any',
    ...GULF_NAMES.flatMap((n) => [
      ['==', ['get', 'name_en'], n],
      ['==', ['get', 'name'], n],
      ['==', ['get', 'name:en'], n],
      ['==', ['get', 'name:es'], n],
    ]),
  ],
]

function safeMergeFilter(existing) {
  if (!existing) return GULF_MEXICO_MATCH
  if (Array.isArray(existing) && existing[0] === 'all') return [...existing, GULF_MEXICO_MATCH]
  return ['all', existing, GULF_MEXICO_MATCH]
}

function filterAlreadyPatched(map, layerId) {
  try {
    const f = map.getFilter(layerId)
    if (!f) return false
    const s = JSON.stringify(f)
    return s.includes('Gulf of Mexico') || s.includes('Golfo de M')
  } catch {
    return true
  }
}

/**
 * Replace the layer's text-field with an expression that blanks out features whose
 * name matches any Gulf of Mexico variant. This is a belt-and-braces approach in
 * addition to the layer filter, since some Mapbox styles use composite labels where
 * filters by feature name do not always remove the label glyphs.
 */
function blankGulfTextField(map, layer) {
  if (!layer?.layout?.['text-field']) return
  const original = layer.layout['text-field']
  const tag = '__hmda_gulf_blanked__'
  // Avoid re-wrapping
  if (typeof original === 'object' && JSON.stringify(original).includes(tag)) return

  const guarded = [
    'case',
    [
      'any',
      ...GULF_NAMES.flatMap((n) => [
        ['==', ['get', 'name_en'], n],
        ['==', ['get', 'name'], n],
        ['==', ['coalesce', ['get', 'name:en'], ''], n],
        ['==', ['coalesce', ['get', 'name:es'], ''], n],
      ]),
    ],
    /* tag */ ['concat', '', tag.slice(0, 0), ''],
    original,
  ]

  try {
    map.setLayoutProperty(layer.id, 'text-field', guarded)
  } catch {
    /* some styles disallow runtime layout overrides */
  }
}

/**
 * @param {import('mapbox-gl').Map} map
 */
export function suppressGulfOfMexicoBasemapLabels(map) {
  if (!map?.getStyle?.() || !map.isStyleLoaded?.()) return

  const style = map.getStyle()
  for (const layer of style.layers || []) {
    if (layer.type !== 'symbol') continue
    const layout = layer.layout || {}
    if (!layout['text-field']) continue

    if (!filterAlreadyPatched(map, layer.id)) {
      try {
        map.setFilter(layer.id, safeMergeFilter(map.getFilter(layer.id)))
      } catch {
        /* ignore — some layers disallow runtime filter changes */
      }
    }
  }
}

/**
 * @param {import('mapbox-gl').Map} map
 */
export function bindGulfOfMexicoLabelSuppression(map) {
  if (!map || map._hmdaGulfLabelSuppressionBound) return
  map._hmdaGulfLabelSuppressionBound = true

  let scheduled = false
  const run = () => {
    scheduled = false
    try {
      suppressGulfOfMexicoBasemapLabels(map)
    } catch (err) {
      console.warn('[HmdaGeographyMapbox] Gulf label suppression skipped', err)
    }
  }
  const schedule = () => {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(run)
  }

  if (map.isStyleLoaded?.()) schedule()
  map.on('styledata', schedule)
  map.on('sourcedata', schedule)
  map.on('idle', schedule)
}
