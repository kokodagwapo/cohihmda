import {
  satellite as sat,
  json2satrec,
  propagate,
  gstime,
  eciToGeodetic,
  degreesLat,
  degreesLong,
} from 'satellite.js'
import { LIVE_SATELLITE_CATALOG } from './geo-live-catalog.js'

/**
 * @param {Array<{ norad: number, name: string, category: string, id: string, tleLine1: string, tleLine2: string }>} entries
 * @param {Date} [when]
 */
export function satellitesToGeoJson(entries, when = new Date()) {
  const features = []
  const t = when

  for (const entry of entries || []) {
    if (!entry?.tleLine1 || !entry?.tleLine2) continue
    try {
      const satrec = json2satrec(entry.tleLine1, entry.tleLine2)
      const pv = propagate(satrec, t)
      if (!pv?.position) continue
      const gmst = gstime(t)
      const gd = eciToGeodetic(pv.position, gmst)
      const lat = degreesLat(gd.latitude)
      const lng = degreesLong(gd.longitude)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
      const altKm = (gd.height || 0).toFixed(0)
      const isMilitary = String(entry.category || '').toLowerCase().includes('military')
      features.push({
        type: 'Feature',
        id: entry.id,
        properties: {
          trackId: entry.id,
          trackKind: 'satellite',
          name: entry.name,
          category: entry.category,
          isMilitary,
          norad: entry.norad,
          altitudeKm: Number(altKm),
          subtitle: `NORAD ${entry.norad} · ~${altKm} km altitude`,
        },
        geometry: { type: 'Point', coordinates: [lng, lat] },
      })
    } catch {
      /* bad TLE */
    }
  }

  return { type: 'FeatureCollection', features }
}

export { LIVE_SATELLITE_CATALOG }
