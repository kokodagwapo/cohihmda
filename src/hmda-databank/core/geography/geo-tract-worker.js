/**
 * Web Worker: viewport filter, cap, and lender-share overlay for prebuilt tract GeoJSON.
 */
import { applyLenderShareToTractFeatures } from './geo-map-lender-filter.js'

function pointInBounds(lng, lat, bounds, paddingDeg = 0.08) {
  if (!bounds) return true
  return (
    lng >= bounds.west - paddingDeg &&
    lng <= bounds.east + paddingDeg &&
    lat >= bounds.south - paddingDeg &&
    lat <= bounds.north + paddingDeg
  )
}

function filterTractFeatures(features, { bounds = null, cap = Infinity } = {}) {
  let list = features || []
  if (bounds) {
    list = list.filter((f) => {
      const c = f?.geometry?.coordinates
      if (!Array.isArray(c) || c.length < 2) return false
      return pointInBounds(Number(c[0]), Number(c[1]), bounds)
    })
  }
  if (list.length > cap) {
    list = [...list].sort((a, b) => (b.properties?.units || 0) - (a.properties?.units || 0))
    const stride = Math.ceil(list.length / cap)
    const subsampled = []
    for (let i = 0; i < list.length; i += stride) subsampled.push(list[i])
    list = subsampled.slice(0, cap)
  }
  return { type: 'FeatureCollection', features: list }
}

function filterTractFeaturesPerState(features, { bounds = null, cap = Infinity, minPerState = 1 } = {}) {
  const byState = {}
  for (const f of features || []) {
    const st = f?.properties?.state
    if (!st) continue
    const c = f?.geometry?.coordinates
    if (bounds) {
      if (!Array.isArray(c) || c.length < 2) continue
      if (!pointInBounds(Number(c[0]), Number(c[1]), bounds)) continue
    }
    if (!byState[st]) byState[st] = []
    byState[st].push(f)
  }

  const states = Object.keys(byState)
  if (!states.length) return { type: 'FeatureCollection', features: [] }

  const stateWeight = (st) =>
    byState[st].reduce((sum, feat) => sum + (Number(feat.properties?.units) || 0), 0)
  const totalWeight = states.reduce((sum, st) => sum + stateWeight(st), 0) || states.length

  const merged = []
  for (const st of states) {
    let stateFeats = [...byState[st]].sort(
      (a, b) => (b.properties?.units || 0) - (a.properties?.units || 0),
    )
    const weight = stateWeight(st)
    let stateCap = Math.max(minPerState, Math.round((weight / totalWeight) * cap))
    stateCap = Math.min(stateCap, stateFeats.length)
    if (stateFeats.length > stateCap) {
      const stride = Math.ceil(stateFeats.length / stateCap)
      const subsampled = []
      for (let i = 0; i < stateFeats.length; i += stride) subsampled.push(stateFeats[i])
      stateFeats = subsampled.slice(0, stateCap)
    }
    merged.push(...stateFeats)
  }

  return { type: 'FeatureCollection', features: merged.slice(0, cap) }
}

self.onmessage = (event) => {
  const { id, type, payload } = event.data || {}
  try {
    let result
    if (type === 'FILTER') {
      result = filterTractFeatures(payload?.features, {
        bounds: payload?.bounds ?? null,
        cap: payload?.cap ?? Infinity,
      })
    } else if (type === 'LENDER_OVERLAY') {
      const overlaid = applyLenderShareToTractFeatures(
        { type: 'FeatureCollection', features: payload?.features || [] },
        payload?.insights ?? null,
        payload?.marketByState ?? {},
      )
      result = filterTractFeaturesPerState(overlaid.features, {
        bounds: payload?.bounds ?? null,
        cap: payload?.cap ?? Infinity,
      })
    } else {
      throw new Error(`Unknown worker message type: ${type}`)
    }
    self.postMessage({ id, ok: true, result })
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message || err) })
  }
}
