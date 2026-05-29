import { GULF_OF_AMERICA_LABEL } from './mapbox-config.js'

/** Globe hero through regional Gulf Coast zoom. */
export const GULF_LABEL_ZOOM_MIN = 2.4
export const GULF_LABEL_ZOOM_MAX = 7.25

/** Map center must stay in this corridor (hides when panning to interior US, coasts, or abroad). */
export const GULF_LABEL_VIEW_CORRIDOR = {
  minLng: -104,
  maxLng: -74,
  minLat: 17.5,
  maxLat: 36,
}

/**
 * Show decorative label only when zoomed to Gulf-scale and the basin is on screen.
 * @param {import('mapbox-gl').Map | null | undefined} map
 */
export function shouldShowGulfOfAmericaLabel(map) {
  if (!map?.getZoom || !map.getCenter || !map.getBounds) return false

  const zoom = map.getZoom()
  if (zoom < GULF_LABEL_ZOOM_MIN || zoom > GULF_LABEL_ZOOM_MAX) return false

  const { longitude: gLng, latitude: gLat } = GULF_OF_AMERICA_LABEL
  if (!Number.isFinite(gLng) || !Number.isFinite(gLat)) return false
  const bounds = map.getBounds()
  if (!bounds || !bounds.contains([gLng, gLat])) return false

  // At national/globe zoom, show whenever the basin is on screen (default hero view).
  if (zoom < 5) return true

  const center = map.getCenter()
  const { minLng, maxLng, minLat, maxLat } = GULF_LABEL_VIEW_CORRIDOR
  if (center.lng < minLng || center.lng > maxLng || center.lat < minLat || center.lat > maxLat) {
    return false
  }

  return true
}
