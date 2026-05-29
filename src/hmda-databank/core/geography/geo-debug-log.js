const DEBUG = import.meta.env.DEV && import.meta.env.VITE_GEO_DEBUG === 'true'

export function geoDebugLog(...args) {
  if (DEBUG) console.log('[GeoMap]', ...args)
}

export function geoDebugLogLayout(...args) {
  if (DEBUG) console.log('[GeoMap:layout]', ...args)
}
