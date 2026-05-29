/**
 * Mapbox Geocoding API — forward search (browser; uses public Mapbox token).
 * https://docs.mapbox.com/api/search/geocoding/
 *
 * Uses US bias, optional map-center proximity, and prefers full `address` hits when the query looks like a street address.
 */

/** Continental US bias when no map center is available */
export const GEOCODE_USA_PROXIMITY = [-98.35, 39.5]

function pickBestGeocodeFeature(features, query) {
  if (!features?.length) return null
  const q = String(query || '').trim()
  // Prefer centroid of street addresses when user typed a leading street number (house-level accuracy).
  const looksLikeStreetAddress = /^\s*\d+\s+\S/.test(q)
  if (looksLikeStreetAddress) {
    const addr = features.find((f) => Array.isArray(f.place_type) && f.place_type.includes('address'))
    if (addr?.center) return addr
  }
  return features[0]
}

/**
 * @param {string} query
 * @param {string} accessToken
 * @param {{ proximity?: [number, number] }} [options] proximity `[lng, lat]` improves ranking near the map viewport
 */
export async function geocodeAddress(query, accessToken, options = {}) {
  const q = String(query || '').trim()
  const token = String(accessToken || '').trim()
  if (!q || !token) return null

  const proximity = Array.isArray(options.proximity) && options.proximity.length >= 2 ? options.proximity : GEOCODE_USA_PROXIMITY

  const qs = new URLSearchParams({
    access_token: token,
    limit: '5',
    types: 'address,place,locality,neighborhood,postcode,district,region,poi',
    country: 'us',
    language: 'en',
    proximity: `${proximity[0]},${proximity[1]}`,
  })
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?${qs}`

  try {
    const r = await fetch(url)
    if (!r.ok) return null
    const data = await r.json()
    const f = pickBestGeocodeFeature(data?.features, q)
    if (!f?.center || !Array.isArray(f.center) || f.center.length < 2) return null
    const [lng, lat] = f.center
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
    return {
      lng,
      lat,
      placeName: String(f.place_name || f.text || q),
    }
  } catch {
    return null
  }
}
