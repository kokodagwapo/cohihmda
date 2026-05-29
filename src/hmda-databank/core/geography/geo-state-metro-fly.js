import { geoContains } from 'd3-geo'

/** Primary metro fly-to target per state (lng/lat WGS84). */
export const STATE_METRO_FLY_TARGETS = {
  AL: { label: 'Birmingham', longitude: -86.8025, latitude: 33.5207 },
  AK: { label: 'Anchorage', longitude: -149.9003, latitude: 61.2181 },
  AZ: { label: 'Phoenix', longitude: -112.074, latitude: 33.4484 },
  AR: { label: 'Little Rock', longitude: -92.2896, latitude: 34.7465 },
  CA: { label: 'Los Angeles', longitude: -118.2437, latitude: 34.0522 },
  CO: { label: 'Denver', longitude: -104.9903, latitude: 39.7392 },
  CT: { label: 'Hartford', longitude: -72.6851, latitude: 41.7658 },
  DE: { label: 'Wilmington', longitude: -75.5398, latitude: 39.7391 },
  DC: { label: 'Washington', longitude: -77.0369, latitude: 38.9072 },
  FL: { label: 'Miami', longitude: -80.1918, latitude: 25.7617 },
  GA: { label: 'Atlanta', longitude: -84.388, latitude: 33.749 },
  HI: { label: 'Honolulu', longitude: -157.8583, latitude: 21.3069 },
  ID: { label: 'Boise', longitude: -116.2023, latitude: 43.615 },
  IL: { label: 'Chicago', longitude: -87.6298, latitude: 41.8781 },
  IN: { label: 'Indianapolis', longitude: -86.1581, latitude: 39.7684 },
  IA: { label: 'Des Moines', longitude: -93.6091, latitude: 41.5868 },
  KS: { label: 'Kansas City', longitude: -94.5786, latitude: 39.0997 },
  KY: { label: 'Louisville', longitude: -85.7585, latitude: 38.2527 },
  LA: { label: 'New Orleans', longitude: -90.0715, latitude: 29.9511 },
  ME: { label: 'Portland', longitude: -70.2568, latitude: 43.6591 },
  MD: { label: 'Baltimore', longitude: -76.6122, latitude: 39.2904 },
  MA: { label: 'Boston', longitude: -71.0589, latitude: 42.3601 },
  MI: { label: 'Detroit', longitude: -83.0458, latitude: 42.3314 },
  MN: { label: 'Minneapolis', longitude: -93.265, latitude: 44.9778 },
  MS: { label: 'Jackson', longitude: -90.1848, latitude: 32.2988 },
  MO: { label: 'St. Louis', longitude: -90.1994, latitude: 38.627 },
  MT: { label: 'Billings', longitude: -108.5007, latitude: 45.7833 },
  NE: { label: 'Omaha', longitude: -95.9345, latitude: 41.2565 },
  NV: { label: 'Las Vegas', longitude: -115.1398, latitude: 36.1699 },
  NH: { label: 'Manchester', longitude: -71.5376, latitude: 42.9956 },
  NJ: { label: 'Newark', longitude: -74.1724, latitude: 40.7357 },
  NM: { label: 'Albuquerque', longitude: -106.6504, latitude: 35.0844 },
  NY: { label: 'New York City', longitude: -74.006, latitude: 40.7128 },
  NC: { label: 'Charlotte', longitude: -80.8431, latitude: 35.2271 },
  ND: { label: 'Fargo', longitude: -96.7898, latitude: 46.8772 },
  OH: { label: 'Columbus', longitude: -82.9988, latitude: 39.9612 },
  OK: { label: 'Oklahoma City', longitude: -97.5164, latitude: 35.4676 },
  OR: { label: 'Portland', longitude: -122.6765, latitude: 45.5152 },
  PA: { label: 'Philadelphia', longitude: -75.1652, latitude: 39.9526 },
  RI: { label: 'Providence', longitude: -71.4128, latitude: 41.824 },
  SC: { label: 'Charleston', longitude: -79.9311, latitude: 32.7765 },
  SD: { label: 'Sioux Falls', longitude: -96.7311, latitude: 43.546 },
  TN: { label: 'Nashville', longitude: -86.7816, latitude: 36.1627 },
  TX: { label: 'Houston', longitude: -95.3698, latitude: 29.7604 },
  UT: { label: 'Salt Lake City', longitude: -111.891, latitude: 40.7608 },
  VT: { label: 'Burlington', longitude: -73.2121, latitude: 44.4759 },
  VA: { label: 'Richmond', longitude: -77.436, latitude: 37.5407 },
  WA: { label: 'Seattle', longitude: -122.3321, latitude: 47.6062 },
  WV: { label: 'Charleston', longitude: -81.6326, latitude: 38.3498 },
  WI: { label: 'Milwaukee', longitude: -87.9065, latitude: 43.0389 },
  WY: { label: 'Cheyenne', longitude: -104.8202, latitude: 41.14 },
}

const DEFAULT_METRO = STATE_METRO_FLY_TARGETS.KS

/** Camera for 3D buildings at metro scale. */
export const METRO_3D_FLY_CAMERA = {
  zoom: 16.8,
  pitch: 58,
  bearing: -28,
  duration: 2400,
  curve: 1.28,
}

export function stateCodeAtLngLat(statesGeo, lng, lat) {
  if (!statesGeo?.features?.length || !Number.isFinite(lng) || !Number.isFinite(lat)) return null
  const point = [lng, lat]
  for (const f of statesGeo.features) {
    try {
      if (geoContains(f, point)) return f.properties?.state || null
    } catch {
      /* ignore malformed rings */
    }
  }
  return null
}

/** Resolve state from selection, hover, or map center. */
export function resolveStateCodeForMetroFly({ mapSelectedState, hoverStateCode, lng, lat, statesGeo } = {}) {
  if (mapSelectedState) return mapSelectedState
  if (hoverStateCode) return hoverStateCode
  return stateCodeAtLngLat(statesGeo, lng, lat)
}

export function getStateMetroFlyTarget(stateCode) {
  const code = String(stateCode || '').toUpperCase()
  return STATE_METRO_FLY_TARGETS[code] || DEFAULT_METRO
}
