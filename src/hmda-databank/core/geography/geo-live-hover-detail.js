/** Hover card payload for live satellite / aircraft tracks. */

export function buildLiveTrackHoverDetail(feature, layerId) {
  const p = feature?.properties || {}
  const isSat = layerId === 'geo-satellites-circle' || p.trackKind === 'satellite'
  const isMil =
    String(p.category || '').toLowerCase().includes('military') ||
    String(p.acType || '').toLowerCase().includes('military')

  const lines = []
  const push = (rowKey, k, v) => lines.push({ rowKey, k, v })

  if (isSat) {
    push('category', 'Type', 'Satellite')
    push('units', 'Mission', p.category || 'Orbiting spacecraft')
    if (p.norad) push('volume', 'NORAD ID', String(p.norad))
    if (p.altitudeKm != null) push('avgLoan', 'Altitude', `~${p.altitudeKm} km`)
    push('demographics', 'Source', 'CelesTrak TLE · SGP4 propagation')
  } else {
    push('category', 'Type', p.acType || 'Aircraft')
    if (p.callsign && p.callsign !== '—') push('units', 'Callsign', p.callsign)
    if (p.icao24) push('volume', 'ICAO24', String(p.icao24).toUpperCase())
    if (p.originCountry) push('medianIncome', 'Country', p.originCountry)
    if (p.altitudeLabel) push('avgLoan', 'Altitude', p.altitudeLabel)
    if (p.speedLabel) push('denialRate', 'Speed', p.speedLabel)
    if (p.heading != null) push('pullthroughRate', 'Heading', `${p.heading}°`)
    push('demographics', 'Source', 'OpenSky Network · ADS-B (live)')
  }

  return {
    title: p.name || (isSat ? 'Satellite' : 'Aircraft'),
    subtitle: p.subtitle || (isSat ? 'Low Earth orbit' : 'Airborne'),
    lines,
    primaryLabel: isSat ? 'Track' : 'Status',
    primaryValue: isSat ? 'On orbit' : 'Airborne',
    kind: isSat ? 'satellite' : 'aircraft',
    geoLevelLabel: isSat ? (isMil ? 'Military satellite' : 'Satellite') : isMil ? 'Military aircraft' : 'Aircraft',
    topLenders: [],
    modelNote: 'Positions are approximate live estimates, not HMDA data.',
    navigateLabel: null,
    featureKey: `live:${p.trackId || p.name}`,
  }
}
