import { classifyAircraft } from './geo-live-catalog.js'

function fmtAlt(meters) {
  if (meters == null || !Number.isFinite(Number(meters))) return '—'
  const ft = Math.round(Number(meters) * 3.28084)
  if (ft >= 10000) return `${(ft / 1000).toFixed(1)}k ft`
  return `${ft.toLocaleString()} ft`
}

function fmtSpeed(ms) {
  if (ms == null || !Number.isFinite(Number(ms))) return '—'
  const kts = Number(ms) * 1.94384
  return `${Math.round(kts)} kts`
}

/**
 * OpenSky state vectors → GeoJSON (airborne only).
 * @param {object} payload — { states: [...] }
 */
export function openSkyStatesToGeoJson(payload) {
  const states = payload?.states
  if (!Array.isArray(states)) return { type: 'FeatureCollection', features: [] }

  const features = []
  for (const row of states) {
    if (!row || row.length < 8) continue
    const icao24 = row[0]
    const callsign = String(row[1] || '').trim() || null
    const origin = row[2]
    const lon = row[5]
    const lat = row[6]
    const baro = row[7]
    const onGround = row[8]
    const velocity = row[9]
    const heading = row[10]
    const geoAlt = row[13]
    const category = row[17]

    if (onGround || lat == null || lon == null) continue

    const acType = classifyAircraft(icao24, callsign, origin, category)
    const isMilitary = acType === 'Military'
    const id = icao24 || callsign || `ac-${features.length}`
    const altM = geoAlt ?? baro

    features.push({
      type: 'Feature',
      id,
      properties: {
        trackId: id,
        trackKind: 'aircraft',
        icao24,
        callsign: callsign || '—',
        acType,
        isMilitary,
        originCountry: origin || '—',
        altitudeLabel: fmtAlt(altM),
        speedLabel: fmtSpeed(velocity),
        heading: heading != null && Number.isFinite(Number(heading)) ? Math.round(Number(heading)) : null,
        name: callsign || icao24?.toUpperCase() || 'Unknown aircraft',
        category: acType,
        subtitle: [acType, origin, fmtAlt(altM)].filter(Boolean).join(' · '),
      },
      geometry: { type: 'Point', coordinates: [lon, lat] },
    })
  }

  return { type: 'FeatureCollection', features: features.slice(0, 2500) }
}
