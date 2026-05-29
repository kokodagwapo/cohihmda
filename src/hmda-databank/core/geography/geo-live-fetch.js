/** Client fetch helpers for live satellite tracks and OpenSky aircraft states. */

export async function fetchSatelliteGeoJson() {
  const res = await fetch('/api/geo/satellites', { headers: { Accept: 'application/json' } })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `Satellite fetch failed (${res.status})`)
  }
  const json = await res.json()
  return json.geojson || { type: 'FeatureCollection', features: [] }
}

/**
 * @param {{ lamin: number, lomin: number, lamax: number, lomax: number }} bbox
 */
export async function fetchOpenSkyStates(bbox) {
  const qs = new URLSearchParams({
    lamin: String(bbox.lamin),
    lomin: String(bbox.lomin),
    lamax: String(bbox.lamax),
    lomax: String(bbox.lomax),
  })
  const res = await fetch(`/api/geo/opensky/states?${qs}`, { headers: { Accept: 'application/json' } })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `OpenSky fetch failed (${res.status})`)
  }
  return res.json()
}
