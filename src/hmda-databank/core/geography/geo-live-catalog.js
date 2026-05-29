/** Curated live tracks — NORAD catalog numbers for CelesTrak GP fetch. */

export const LIVE_SATELLITE_CATALOG = [
  { id: 'iss', norad: 25544, name: 'International Space Station', category: 'Space station' },
  { id: 'hubble', norad: 20580, name: 'Hubble Space Telescope', category: 'Science' },
  { id: 'noaa20', norad: 43013, name: 'NOAA-20', category: 'Weather / Earth obs' },
  { id: 'landsat8', norad: 39084, name: 'Landsat 8', category: 'Earth observation' },
  { id: 'goes16', norad: 41866, name: 'GOES-16', category: 'Weather' },
  { id: 'starlink', norad: 44713, name: 'Starlink (representative)', category: 'Communications' },
  { id: 'usa224', norad: 37348, name: 'USA 224', category: 'Military (classified)' },
  { id: 'nrol82', norad: 52066, name: 'NROL-82', category: 'Military / reconnaissance' },
]

/** Rough military aircraft callsign / country heuristics (ADS-B via OpenSky). */
const MIL_CALLSIGN = /^(RCH|REACH|EVAC|NINJA|IRON|HAWK|BOXER|JAKE|VIPER|MOOSE|NAVY|USAF|CNV|BAF|RAF|RFR|RCH|CFC|QID|SAM|EXEC|GORDO|DUKE|EVAC|SPAR|HOMER|NCHO|CNV|CNV|ATLAS|EVAC)/i
const MIL_ICAO_PREFIX = /^(ae|ad|43c|3c6|3c7|3c8|3c9|3ca|3cb|3cc|3cd|3ce|3cf|3d0|3d1)/i

export function classifyAircraft(icao24, callsign, originCountry, category) {
  const cs = String(callsign || '').trim()
  const icao = String(icao24 || '').toLowerCase()
  const country = String(originCountry || '').toLowerCase()

  if (MIL_CALLSIGN.test(cs) || MIL_ICAO_PREFIX.test(icao)) {
    return 'Military'
  }
  if (category === 10 || category === 'MIL') return 'Military'
  if (country.includes('military') || country === 'unknown' && MIL_CALLSIGN.test(cs)) {
    return 'Military'
  }
  if (cs.match(/^(UAL|DAL|AAL|SWA|JBU|ASA|FFT|SKW|RPA|EDV|ENY)/)) return 'Commercial airline'
  if (cs.match(/^(N[0-9]|C-[A-Z])/i)) return 'General aviation'
  if (cs) return 'Aircraft'
  return 'Aircraft'
}
