/** Mapbox geography hover/click — priority pick (live → tract → county → state). */

import { ensureTractMarkerImages } from './geo-tract-marker-image.js'

export const GEO_INTERACTIVE_LAYERS = ['geo-tracts-circle', 'geo-counties-fill', 'geo-states-fill']

export const GEO_STATE_PINS_LAYER_ID = 'geo-state-pins-circle'

/** Prefer states at USA zoom so tract dots do not block state hover. */
export function geoInteractiveLayersForZoom(zoom) {
  const z = Number.isFinite(zoom) ? zoom : 4
  if (z < 6) return [GEO_STATE_PINS_LAYER_ID, GEO_TRACTS_GLOBE_LAYER_ID, 'geo-states-fill']
  if (z < 8) return [GEO_STATE_PINS_LAYER_ID, 'geo-counties-fill', 'geo-states-fill']
  return [GEO_STATE_PINS_LAYER_ID, ...GEO_INTERACTIVE_LAYERS]
}

export const GEO_TRACTS_SOURCE_ID = 'geo-tracts'
export const GEO_TRACTS_LAYER_ID = 'geo-tracts-circle'
export const GEO_TRACTS_GLOBE_LAYER_ID = 'geo-tracts-globe-dots'

/** @param {string} layerId */
export function isTractLayerId(layerId) {
  return layerId === GEO_TRACTS_LAYER_ID || layerId === GEO_TRACTS_GLOBE_LAYER_ID
}

export const GEO_LIVE_LAYERS = []

/** @param {import('mapbox-gl').Map} map */
export function getActiveInteractiveLayerIds(map) {
  return GEO_INTERACTIVE_LAYERS.filter((id) => Boolean(map.getLayer(id)))
}

/**
 * Topmost feature at pointer; live layers beat geography when provided.
 * @param {import('mapbox-gl').Map} map
 * @param {{ x: number, y: number }} point
 * @param {string[]} [priorityLayers]
 */
function pickRadiusForLayer(layerId, zoom = 4) {
  if (layerId === GEO_STATE_PINS_LAYER_ID) return 18
  if (layerId.startsWith('geo-iss')) return 18
  if (layerId.startsWith('geo-satellites') || layerId.startsWith('geo-aircraft')) return 14
  if (layerId === 'geo-states-fill') {
    if (zoom < 4) return 28
    if (zoom < 6) return 20
    return 12
  }
  if (isTractLayerId(layerId)) {
    if (zoom < 4) return 32
    if (zoom < 6) return 26
    if (zoom < 9) return 20
    return 16
  }
  return 10
}

/** Keep tract dots above choropleth fills; lender state pins above tract dots when present. */
export function syncTractLayerOrder(map) {
  if (!map?.getLayer) return
  try {
    if (map.getLayer(GEO_TRACTS_GLOBE_LAYER_ID)) map.moveLayer(GEO_TRACTS_GLOBE_LAYER_ID)
    if (map.getLayer(GEO_TRACTS_LAYER_ID)) map.moveLayer(GEO_TRACTS_LAYER_ID)
    if (map.getLayer(GEO_STATE_PINS_LAYER_ID)) map.moveLayer(GEO_STATE_PINS_LAYER_ID)
  } catch {
    /* layer not ready */
  }
}

/**
 * Show/hide tract dots once the Mapbox layer exists (react-map-gl mounts async).
 * @param {import('mapbox-gl').Map} map
 * @param {boolean} show
 * @param {{ featureCount?: number }} [opts]
 * @returns {() => void} cleanup
 */
export function applyTractLayerVisibility(map, show, { featureCount = 0 } = {}) {
  if (!map) return () => {}
  const visible = show && featureCount > 0
  let cancelled = false
  let pendingIdle = null

  const apply = () => {
    if (cancelled) return
    if (!map.isStyleLoaded?.() || !map.getLayer?.(GEO_TRACTS_LAYER_ID)) {
      pendingIdle = apply
      map.once('idle', apply)
      return
    }
    try {
      map.setLayoutProperty(GEO_TRACTS_LAYER_ID, 'visibility', visible ? 'visible' : 'none')
      if (visible) syncTractLayerOrder(map)
    } catch {
      /* layer not ready */
    }
  }

  apply()
  return () => {
    cancelled = true
    if (pendingIdle) map.off('idle', pendingIdle)
  }
}

/**
 * Imperative tract layer — react-map-gl z-order on globe + terrain is unreliable.
 * @param {import('mapbox-gl').Map} map
 * @param {{ enabled?: boolean, geojson?: GeoJSON.FeatureCollection, layout?: Record<string, unknown>, paint?: Record<string, unknown> }} opts
 */
export function syncTractLayerImperative(map, { enabled = false, geojson = null, layout = {}, paint = {} } = {}) {
  try {
    const styleLoaded = Boolean(map?.isStyleLoaded?.())
    if (!styleLoaded) {
      map?.once?.('idle', () => syncTractLayerImperative(map, { enabled, geojson, layout, paint }))
      return false
    }

    const hasSource = Boolean(map.getSource(GEO_TRACTS_SOURCE_ID))
    const hasLayer = Boolean(map.getLayer(GEO_TRACTS_LAYER_ID))

    if (!enabled || !geojson?.features?.length) {
      if (hasLayer) map.removeLayer(GEO_TRACTS_LAYER_ID)
      if (hasSource) map.removeSource(GEO_TRACTS_SOURCE_ID)
      return true
    }

    ensureTractMarkerImages(map)

    if (!hasSource) {
      map.addSource(GEO_TRACTS_SOURCE_ID, {
        type: 'geojson',
        data: geojson,
        promoteId: 'tractId',
      })
    } else {
      const src = map.getSource(GEO_TRACTS_SOURCE_ID)
      src?.setData?.(geojson)
    }

    if (!hasLayer) {
      map.addLayer({
        id: GEO_TRACTS_LAYER_ID,
        type: 'symbol',
        source: GEO_TRACTS_SOURCE_ID,
        layout,
        paint,
      })
    } else {
      for (const [key, value] of Object.entries(layout)) {
        map.setLayoutProperty(GEO_TRACTS_LAYER_ID, key, value)
      }
      for (const [key, value] of Object.entries(paint)) {
        map.setPaintProperty(GEO_TRACTS_LAYER_ID, key, value)
      }
    }

    syncTractLayerOrder(map)
    return true
  } catch (err) {
    return false
  }
}

export function pickTopGeoFeature(map, point, priorityLayers = [], zoom) {
  const z = Number.isFinite(zoom) ? zoom : map.getZoom?.() ?? 4

  for (const layerId of priorityLayers) {
    if (!map.getLayer(layerId)) continue
    const radius = pickRadiusForLayer(layerId, z)
    const hits = map.queryRenderedFeatures(point, { layers: [layerId], radius })
    if (hits?.[0]) return { feature: hits[0], layerId }
  }

  const geoLayers = geoInteractiveLayersForZoom(z)
  for (const layerId of geoLayers) {
    if (!map.getLayer(layerId)) continue
    const radius = pickRadiusForLayer(layerId, z)
    const hits = map.queryRenderedFeatures(point, { layers: [layerId], radius })
    if (hits?.[0]) return { feature: hits[0], layerId }
  }
  return null
}

/**
 * @param {GeoJSON.Feature} feature
 * @param {string} layerId
 */
export function featureStateTarget(feature, layerId) {
  const p = feature?.properties || {}
  if (layerId === 'geo-states-fill' && p.state) return { source: 'geo-states', id: p.state }
  if (layerId === 'geo-counties-fill' && p.fips) return { source: 'geo-counties', id: p.fips }
  if (isTractLayerId(layerId) && p.tractId) return { source: 'geo-tracts', id: p.tractId }
  return null
}

function safeSetFeatureState(map, target, state) {
  if (!map || !target?.source || target.id == null) return
  try {
    map.setFeatureState(target, state)
  } catch {
    /* source/layer not ready or id missing */
  }
}

function hoverFeatureKey(feature, layerId) {
  const p = feature?.properties || {}
  if (GEO_LIVE_LAYERS.includes(layerId)) return `live:${p.trackId || p.name || p.icao24}`
  if (layerId === GEO_STATE_PINS_LAYER_ID) return `state-pin:${p.state}`
  if (isTractLayerId(layerId)) return `tract:${p.tractId || p.censusTract}`
  if (layerId === 'geo-counties-fill') return `county:${p.fips}`
  return `state:${p.state}`
}

/**
 * @param {import('mapbox-gl').Map} map
 * @param {{
 *   priorityLayers?: string[],
 *   onHover?: (feature: GeoJSON.Feature, layerId: string) => void,
 *   onMapPointerMove?: () => void,
 *   onHoverEnd?: () => void,
 *   onFeatureClick?: (feature: GeoJSON.Feature, layerId: string) => void,
 *   onMapClickEmpty?: () => void,
 * }} handlers
 */
export function bindGeographyFeatureInteractions(map, handlers) {
  if (!map?.on) return () => {}

  let highlightTarget = null
  let lastHoverKey = null
  const priorityLayers = handlers.priorityLayers || []

  const clearHighlight = () => {
    if (highlightTarget) {
      safeSetFeatureState(map, highlightTarget, { highlight: false })
      highlightTarget = null
    }
    try {
      map.getCanvas().style.cursor = ''
    } catch {
      /* ignore */
    }
  }

  const applyHighlight = (feature, layerId) => {
    const target = featureStateTarget(feature, layerId)
    if (!target) {
      try {
        map.getCanvas().style.cursor = 'pointer'
      } catch {
        /* ignore */
      }
      return
    }
    if (highlightTarget && (highlightTarget.source !== target.source || highlightTarget.id !== target.id)) {
      safeSetFeatureState(map, highlightTarget, { highlight: false })
      highlightTarget = null
    }
    if (!highlightTarget) {
      safeSetFeatureState(map, target, { highlight: true })
      highlightTarget = target
    }
    try {
      map.getCanvas().style.cursor = 'pointer'
    } catch {
      /* ignore */
    }
  }

  let moveRaf = 0
  let pendingMoveEvent = null

  const flushMove = () => {
    moveRaf = 0
    const e = pendingMoveEvent
    pendingMoveEvent = null
    if (!e) return

    const hit = pickTopGeoFeature(map, e.point, priorityLayers, map.getZoom?.())
    if (!hit) {
      if (lastHoverKey != null) {
        clearHighlight()
        lastHoverKey = null
        handlers.onHoverEnd?.()
      }
      return
    }

    applyHighlight(hit.feature, hit.layerId)
    handlers.onMapPointerMove?.()
    const key = hoverFeatureKey(hit.feature, hit.layerId)
    if (key !== lastHoverKey) {
      lastHoverKey = key
      handlers.onHover?.(hit.feature, hit.layerId)
    }
  }

  const onMove = (e) => {
    pendingMoveEvent = e
    if (moveRaf) return
    moveRaf = requestAnimationFrame(flushMove)
  }

  const onLeave = () => {
    clearHighlight()
    lastHoverKey = null
    handlers.onHoverEnd?.()
  }

  const onClick = (e) => {
    const hit = pickTopGeoFeature(map, e.point, priorityLayers, map.getZoom?.())
    if (hit) handlers.onFeatureClick?.(hit.feature, hit.layerId)
    else handlers.onMapClickEmpty?.()
  }

  map.on('mousemove', onMove)
  map.on('mouseleave', onLeave)
  map.on('click', onClick)

  return () => {
    if (moveRaf) cancelAnimationFrame(moveRaf)
    moveRaf = 0
    pendingMoveEvent = null
    clearHighlight()
    lastHoverKey = null
    map.off('mousemove', onMove)
    map.off('mouseleave', onLeave)
    map.off('click', onClick)
  }
}

/** @param {import('mapbox-gl').Map} map */
export function syncStateSelectionFeatureState(map, stateCode) {
  if (!map?.setFeatureState) return
  const source = 'geo-states'
  try {
    const features = map.querySourceFeatures(source) || []
    for (const f of features) {
      const id = f.properties?.state
      if (!id) continue
      safeSetFeatureState(map, { source, id }, { selected: false })
    }
  } catch {
    /* querySourceFeatures unavailable until tiles loaded */
  }
  if (stateCode) safeSetFeatureState(map, { source, id: stateCode }, { selected: true })
}
