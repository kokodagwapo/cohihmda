/** Mapbox Studio embed — johndia / cmpbtr2va002s01qheo941p0k */
export const MAPBOX_STYLE_ID = 'cmpbtr2va002s01qheo941p0k'
export const MAPBOX_STYLE_OWNER = 'johndia'

/** Canonical HMDA Geography basemap (Mapbox Studio). */
export const MAPBOX_DEFAULT_STYLE = `mapbox://styles/${MAPBOX_STYLE_OWNER}/${MAPBOX_STYLE_ID}`

/** Default HMDA Geography basemap — Mapbox Streets (readable labels + road network). */
export const MAPBOX_GEOGRAPHY_STREETS_STYLE = 'mapbox://styles/mapbox/streets-v12'

/** @deprecated alias — use MAPBOX_GEOGRAPHY_STREETS_STYLE */
export const MAPBOX_GEOGRAPHY_LIGHT_STYLE = MAPBOX_GEOGRAPHY_STREETS_STYLE

/** Fallback when a custom Studio style is rejected. */
export const MAPBOX_GEOGRAPHY_LIGHT_FALLBACK_STYLE = MAPBOX_GEOGRAPHY_STREETS_STYLE

/** @deprecated alias — use MAPBOX_GEOGRAPHY_LIGHT_STYLE */
export const MAPBOX_FALLBACK_LIGHT_STYLE = MAPBOX_GEOGRAPHY_LIGHT_STYLE

/** Satellite + labels — opt-in via VITE_MAPBOX_GEOGRAPHY_STYLE_URL. */
export const MAPBOX_GEOGRAPHY_SATELLITE_STYLE = 'mapbox://styles/mapbox/satellite-streets-v12'

/** Max street-level zoom (Mapbox GL cap) — enables finest imagery + building footprints. */
export const GEO_MAP_MAX_ZOOM = 22

/** Globe overview minimum zoom. */
export const GEO_MAP_MIN_ZOOM = 1.2

/** JWT/base64url-safe; allows "=" padding in rare token shapes */
export const MAPBOX_PK_RE = /^pk\.[A-Za-z0-9._=~-]{20,}$/

function peelEnvQuotes(raw) {
  let t = String(raw || '').trim()
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) {
    t = t.slice(1, -1).trim()
  }
  return t
}

function normalizePublicPk(raw) {
  const t = peelEnvQuotes(raw)
  return MAPBOX_PK_RE.test(t) ? t : ''
}

/** Build injects __APP_MAPBOX_PUBLIC_TOKEN__ when only MAPBOX_PUBLIC_TOKEN is in .env (non-VITE_ keys are not on import.meta.env). */

/** Geography map style: optional `VITE_MAPBOX_STYLE_URL` override; otherwise branded Studio style above. */
export function resolveMapboxStyle() {
  const fromEnv = peelEnvQuotes(import.meta.env.VITE_MAPBOX_STYLE_URL || '')
  if (fromEnv.startsWith('mapbox://styles/')) return fromEnv
  return MAPBOX_DEFAULT_STYLE
}

/**
 * HMDA Geography basemap: optional `VITE_MAPBOX_GEOGRAPHY_STYLE_URL` only (not `VITE_MAPBOX_STYLE_URL`),
 * else Mapbox streets-v12.
 */
export function resolveGeographyBasemapStyle() {
  const geo = peelEnvQuotes(import.meta.env.VITE_MAPBOX_GEOGRAPHY_STYLE_URL || '')
  if (geo.startsWith('mapbox://styles/')) return geo
  return MAPBOX_GEOGRAPHY_STREETS_STYLE
}

export function isGeographyStreetsStyle(styleUrl) {
  const s = String(styleUrl || '')
  return /\/streets(-v\d+)?$/i.test(s) || /\/streets\b/i.test(s)
}

export function isGeographySatelliteStyle(styleUrl) {
  return /satellite/i.test(String(styleUrl || ''))
}

export function isGeographyLightStyle(styleUrl) {
  const s = String(styleUrl || '')
  return (
    isGeographyStreetsStyle(s) ||
    /\/light(-v\d+)?$/i.test(s) ||
    /\/light\b/i.test(s) ||
    /\/outdoors(-v\d+)?$/i.test(s) ||
    /\/outdoors\b/i.test(s)
  )
}

/** Theme for `syncMapboxOverlays` — satellite imagery reads better with non-light extrusion colors. */
export function overlayThemeFromBasemapStyle(styleUrl) {
  return /satellite/i.test(String(styleUrl || '')) ? 'satellite' : 'light'
}

export function resolveMapboxPublicToken() {
  const fromVite =
    normalizePublicPk(import.meta.env.VITE_MAPBOX_ACCESS_TOKEN) ||
    normalizePublicPk(import.meta.env.VITE_MAPBOX_PUBLIC_TOKEN)
  if (fromVite) return fromVite
  return normalizePublicPk(
    typeof __APP_MAPBOX_PUBLIC_TOKEN__ !== 'undefined' ? __APP_MAPBOX_PUBLIC_TOKEN__ : ''
  )
}

/** Same view as Mapbox Studio embed preview hash #2/38/-34 (overridden by fitUsa on load). */
export const MAPBOX_EMBED_PREVIEW_VIEW = {
  longitude: -34,
  latitude: 38,
  zoom: 2,
  pitch: 0,
  bearing: 0,
}

/** National tract layer threshold (matches `useGeoTractLayer`). */
export const GEO_TRACT_NATIONAL_MIN_ZOOM = 4.8

/** Zoom when enabling tracts — first comfortable overview, not too tight. */
export const GEO_TRACT_OVERVIEW_ZOOM = 4.92

/** Smooth ease duration when flying to tract overview (ms). */
export const GEO_TRACT_OVERVIEW_EASE_MS = 2600

/**
 * Wide globe — starting frame before the load fly-in (continental US visible as a globe).
 */
export const USA_GLOBE_INTRO_VIEW = {
  longitude: -99.0,
  latitude: 36.6,
  zoom: 2.15,
  pitch: 62,
  bearing: -6,
}

/**
 * Default Geography hero — 3D national overview (reference: Texas-forward framing, full CONUS).
 * Used on load (after intro), Home, and Reset.
 */
export const USA_GLOBE_DEFAULT_VIEW = {
  longitude: -99.0,
  latitude: 36.6,
  zoom: GEO_TRACT_OVERVIEW_ZOOM,
  pitch: 52,
  bearing: -6,
}

/** Cinematic fly-in from wide globe to hero framing on first map load (ms). */
export const USA_GLOBE_INTRO_DURATION_MS = 6500

/** @deprecated alias — use USA_GLOBE_DEFAULT_VIEW */
export const USA_MAP_VIEW = { ...USA_GLOBE_DEFAULT_VIEW }

/** Pitch/bearing for Home / reset (same as default globe hero). */
export const USA_MAP_CAMERA = {
  pitch: USA_GLOBE_DEFAULT_VIEW.pitch,
  bearing: USA_GLOBE_DEFAULT_VIEW.bearing,
}

/** True when the map camera is close to the default USA globe hero framing. */
export function isNearUsaGlobeDefaultView(map, view = USA_GLOBE_DEFAULT_VIEW) {
  if (!map?.getCenter) return false
  const c = map.getCenter()
  const z = map.getZoom()
  const p = map.getPitch()
  const b = map.getBearing()
  return (
    Math.abs(c.lng - view.longitude) < 2.5 &&
    Math.abs(c.lat - view.latitude) < 2.5 &&
    Math.abs(z - view.zoom) < 0.45 &&
    Math.abs(p - view.pitch) < 5 &&
    Math.abs(b - view.bearing) < 6
  )
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** One-time cinematic fly-in from deep globe to USA hero framing. */
export function playUsaGlobeIntroAnimation(map, { onComplete } = {}) {
  if (!map) return

  const finish = () => onComplete?.()
  const target = USA_GLOBE_DEFAULT_VIEW

  if (prefersReducedMotion()) {
    map.jumpTo({
      center: [target.longitude, target.latitude],
      zoom: target.zoom,
      pitch: target.pitch,
      bearing: target.bearing,
    })
    finish()
    return
  }

  const intro = USA_GLOBE_INTRO_VIEW
  map.jumpTo({
    center: [intro.longitude, intro.latitude],
    zoom: intro.zoom,
    pitch: intro.pitch,
    bearing: intro.bearing,
  })

  map.flyTo({
    center: [target.longitude, target.latitude],
    zoom: target.zoom,
    pitch: target.pitch,
    bearing: target.bearing,
    duration: USA_GLOBE_INTRO_DURATION_MS,
    curve: 1.06,
    speed: 0.5,
    essential: true,
  })

  map.once('moveend', finish)
}

/** Decorative water-body label (Gulf of America basin). */
export const GULF_OF_AMERICA_LABEL = {
  longitude: -90.4,
  latitude: 25.6,
}
