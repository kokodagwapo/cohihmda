/** Mapbox Streets composite overlay layers (buildings, POI, ZIP) — synced imperatively on the map instance. */

export const MAPBOX_OVERLAY_LAYER_IDS = [
  'hmda-ol-buildings',
  'hmda-ol-shops',
  'hmda-ol-hospitals',
  'hmda-ol-zip-line',
  'hmda-ol-zip-label',
]

export const DEFAULT_MAP_OVERLAYS = {
  state: true,
  county: false,
  tract: false,
  zip: false,
  buildings: false,
  shops: false,
  hospitals: false,
}

/** Toggle definitions for the geography map UI */
export const MAP_OVERLAY_OPTIONS = [
  { id: 'state', label: 'State boundaries', shortLabel: 'St', group: 'boundary' },
  { id: 'county', label: 'Counties', shortLabel: 'Cnty', group: 'boundary' },
  { id: 'tract', label: 'Census tracts', shortLabel: 'Tr', group: 'boundary' },
  { id: 'zip', label: 'ZIP codes', shortLabel: 'ZIP', group: 'boundary' },
  { id: 'buildings', label: '3D buildings', shortLabel: '3D', group: 'places' },
]

const SHOP_FILTER = [
  'any',
  ['in', ['get', 'maki'], ['literal', ['shop', 'grocery', 'clothing-store', 'convenience', 'pharmacy', 'beer', 'wine']]],
  ['in', ['get', 'class'], ['literal', ['shop', 'grocery', 'commercial', 'store', 'food_and_drink']]],
]

const HOSPITAL_FILTER = [
  'any',
  ['in', ['get', 'maki'], ['literal', ['hospital', 'clinic', 'doctor', 'pharmacy']]],
  ['in', ['get', 'class'], ['literal', ['hospital', 'clinic', 'doctor', 'pharmacy', 'medical']]],
]

function compositeSource(map) {
  const style = map.getStyle()
  if (!style?.sources) return ensureStreetsCompositeSource(map)
  if (style.sources.composite) return 'composite'
  const hit = Object.keys(style.sources).find((k) => style.sources[k]?.url?.includes('mapbox.mapbox-streets'))
  if (hit) return hit
  return ensureStreetsCompositeSource(map)
}

/** Satellite / custom styles may omit composite — add Mapbox Streets v8 for 3D buildings. */
function ensureStreetsCompositeSource(map) {
  if (!map?.addSource) return 'composite'
  if (map.getSource('composite')) return 'composite'
  if (map.getSource('hmda-streets-composite')) return 'hmda-streets-composite'
  try {
    map.addSource('hmda-streets-composite', {
      type: 'vector',
      url: 'mapbox://mapbox.mapbox-streets-v8',
    })
    return 'hmda-streets-composite'
  } catch {
    return 'composite'
  }
}

function firstSymbolLayerId(map) {
  const layers = map.getStyle()?.layers || []
  for (const layer of layers) {
    if (layer.type === 'symbol' && layer.layout?.['text-field']) return layer.id
  }
  return undefined
}

function upsertLayer(map, spec, beforeId) {
  const { id } = spec
  if (map.getLayer(id)) {
    map.removeLayer(id)
  }
  try {
    map.addLayer(spec, beforeId)
  } catch {
    try {
      map.addLayer(spec)
    } catch {
      /* style not ready */
    }
  }
}

function layerSpecs(source, theme = 'light') {
  const light = theme !== 'dark' && theme !== 'satellite'
  return {
    buildings: {
      id: 'hmda-ol-buildings',
      source,
      'source-layer': 'building',
      type: 'fill-extrusion',
      minzoom: 10.5,
      filter: ['==', ['get', 'extrude'], 'true'],
      paint: {
        'fill-extrusion-color': light
          ? [
              'interpolate',
              ['linear'],
              ['get', 'height'],
              0,
              '#e2e8f0',
              50,
              '#c7d2fe',
              200,
              '#818cf8',
            ]
          : [
              'interpolate',
              ['linear'],
              ['get', 'height'],
              0,
              '#e2e8f0',
              50,
              '#c7d2fe',
              200,
              '#a5b4fc',
            ],
        'fill-extrusion-height': [
          'interpolate',
          ['linear'],
          ['zoom'],
          10.5,
          0,
          12,
          ['*', ['coalesce', ['get', 'height'], 8], 0.35],
          14,
          ['coalesce', ['get', 'height'], 12],
          18,
          ['coalesce', ['get', 'height'], 16],
        ],
        'fill-extrusion-base': ['coalesce', ['get', 'min_height'], 0],
        'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.55, 14, 0.88, 18, 0.92],
      },
    },
    shops: {
      id: 'hmda-ol-shops',
      source,
      'source-layer': 'poi_label',
      type: 'circle',
      minzoom: 11,
      filter: SHOP_FILTER,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 3, 16, 7],
        'circle-color': '#fbbf24',
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#ffffff',
        'circle-opacity': 0.92,
      },
    },
    hospitals: {
      id: 'hmda-ol-hospitals',
      source,
      'source-layer': 'poi_label',
      type: 'circle',
      minzoom: 9,
      filter: HOSPITAL_FILTER,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 4, 16, 9],
        'circle-color': '#f87171',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
        'circle-opacity': 0.95,
      },
    },
    zipLine: {
      id: 'hmda-ol-zip-line',
      source,
      'source-layer': 'postal_code',
      type: 'line',
      minzoom: 7,
      paint: {
        'line-color': light ? '#d97706' : '#fcd34d',
        'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.4, 12, 1.8],
        'line-opacity': 0.85,
        'line-dasharray': [2, 1.5],
      },
    },
    zipLabel: {
      id: 'hmda-ol-zip-label',
      source,
      'source-layer': 'postal_code',
      type: 'symbol',
      minzoom: 9,
      layout: {
        'text-field': ['coalesce', ['get', 'ref'], ['get', 'name_en'], ['get', 'name']],
        'text-size': ['interpolate', ['linear'], ['zoom'], 9, 9, 14, 12],
        'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
        'text-allow-overlap': false,
        'text-padding': 2,
      },
      paint: light
        ? {
            'text-color': '#92400e',
            'text-halo-color': '#ffffff',
            'text-halo-width': 1.4,
          }
        : {
            'text-color': '#fef9c3',
            'text-halo-color': 'rgba(15, 23, 42, 0.85)',
            'text-halo-width': 1.2,
          },
    },
  }
}

/**
 * Add/remove Mapbox vector overlays. HMDA state/county/tract toggles are handled in React layers.
 * @param {import('mapbox-gl').Map} map
 * @param {Record<string, boolean>} overlays
 * @param {{ beforeId?: string, theme?: 'light' | 'dark' | 'satellite' }} options
 */
export function syncMapboxOverlays(map, overlays, { beforeId, theme = 'light' } = {}) {
  if (!map?.isStyleLoaded?.()) return

  const source = compositeSource(map)
  const specs = layerSpecs(source, theme)

  for (const id of MAPBOX_OVERLAY_LAYER_IDS) {
    if (map.getLayer(id)) map.removeLayer(id)
  }

  const anchor = beforeId && map.getLayer(beforeId) ? beforeId : undefined

  if (overlays.buildings) upsertLayer(map, specs.buildings, anchor)
  if (overlays.zip) {
    upsertLayer(map, specs.zipLine, anchor)
    upsertLayer(map, specs.zipLabel, anchor)
  }
  if (overlays.shops) upsertLayer(map, specs.shops, anchor)
  if (overlays.hospitals) upsertLayer(map, specs.hospitals, anchor)
  return true
}

export function removeMapboxOverlays(map) {
  if (!map?.getStyle) return
  for (const id of MAPBOX_OVERLAY_LAYER_IDS) {
    if (map.getLayer(id)) map.removeLayer(id)
  }
}
