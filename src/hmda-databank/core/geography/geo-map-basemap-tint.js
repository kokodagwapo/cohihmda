/**
 * Colorful 3D globe styling — vivid ocean, multi-hue land, cyan horizon.
 * No terrain DEM (keeps census tract load fast).
 */

const OCEAN = {
  shallow: '#5ec8f5',
  mid: '#1aa3e8',
  deep: '#0c8bd6',
  abyss: '#075985',
}

const LAND = {
  base: '#d4e4c4',
  grass: '#9bc77a',
  crop: '#d4c878',
  scrub: '#c4b088',
  forest: '#4a7c59',
  park: '#6b9b5a',
  sand: '#e8d8a8',
  urban: '#d8d4cc',
}

const SKY = '#bfe9ff'

const WATER_LAYER_RE = /^(water|water-shadow|water-depth|water-pattern|ocean|waterway)/i
const LAND_LAYER_RE = /^(land|landcover|landuse|national-park|park)/i
const CLUTTER_SYMBOL_RE = /poi-label|transit|airport|ferry|golf|commercial|education|medical|park-label|motorway-junction/i

const LANDCOVER_COLOR_EXPR = [
  'match',
  ['get', 'class'],
  'wood',
  LAND.forest,
  'grass',
  LAND.grass,
  'crop',
  LAND.crop,
  'scrub',
  LAND.scrub,
  'snow',
  '#eef4fa',
  'ice',
  '#dce8f4',
  'sand',
  LAND.sand,
  'rock',
  '#a89888',
  'wetland',
  '#5a9a88',
  LAND.base,
]

function safePaint(map, layerId, prop, value) {
  try {
    if (map.getLayer(layerId)) map.setPaintProperty(layerId, prop, value)
  } catch {
    /* layer may not support property */
  }
}

function safeLayout(map, layerId, prop, value) {
  try {
    if (map.getLayer(layerId)) map.setLayoutProperty(layerId, prop, value)
  } catch {
    /* ignore */
  }
}

/** @param {import('mapbox-gl').Map} map */
export function applyModernLightBasemapTint(map) {
  if (!map?.isStyleLoaded?.() || !map.getStyle) return false

  safePaint(map, 'background', 'background-color', SKY)

  for (const layer of map.getStyle()?.layers || []) {
    const { id, type } = layer
    if (!id) continue

    if (type === 'fill' && WATER_LAYER_RE.test(id)) {
      safePaint(map, id, 'fill-color', [
        'interpolate',
        ['linear'],
        ['zoom'],
        0,
        OCEAN.shallow,
        2,
        OCEAN.mid,
        5,
        OCEAN.deep,
        9,
        OCEAN.abyss,
      ])
      safePaint(map, id, 'fill-opacity', 0.98)
      continue
    }

    if (type === 'line' && /waterway|water-line|river|stream/i.test(id)) {
      safePaint(map, id, 'line-color', OCEAN.mid)
      safePaint(map, id, 'line-opacity', 0.65)
      continue
    }

    if (type === 'fill' && id === 'landcover') {
      safePaint(map, id, 'fill-color', LANDCOVER_COLOR_EXPR)
      safePaint(map, id, 'fill-opacity', 0.92)
      continue
    }

    if (type === 'fill' && LAND_LAYER_RE.test(id)) {
      let landColor = LAND.base
      if (/park|national/i.test(id)) landColor = LAND.park
      else if (/urban|residential|commercial/i.test(id)) landColor = LAND.urban
      safePaint(map, id, 'fill-color', landColor)
      safePaint(map, id, 'fill-opacity', 0.9)
      continue
    }

    if (type === 'fill' && /building/i.test(id)) {
      safePaint(map, id, 'fill-color', '#c8c2ba')
      safePaint(map, id, 'fill-opacity', [
        'interpolate',
        ['linear'],
        ['zoom'],
        0,
        0,
        12,
        0,
        14,
        0.38,
      ])
    }

    if (type === 'line' && /road|street|bridge|tunnel|path/i.test(id) && !/label|case|shield/i.test(id)) {
      safePaint(map, id, 'line-opacity', [
        'interpolate',
        ['linear'],
        ['zoom'],
        3,
        0,
        8,
        0.22,
        12,
        0.48,
      ])
    }

    if (type === 'symbol' && CLUTTER_SYMBOL_RE.test(id)) {
      safeLayout(map, id, 'visibility', 'none')
    }
  }

  return true
}

/** Cyan horizon fog for the colorful 3D globe. */
export function modernLightGlobeFog() {
  return {
    range: [-1, 2.4],
    color: 'rgb(168, 228, 255)',
    'high-color': 'rgb(14, 165, 233)',
    'horizon-blend': 0.14,
    'space-color': 'rgb(191, 233, 255)',
    'star-intensity': 0,
  }
}
