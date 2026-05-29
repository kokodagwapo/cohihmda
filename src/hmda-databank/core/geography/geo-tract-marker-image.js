/** Map pin images for census tract markers (Mapbox symbol layer). */

export const TRACT_MARKER_ID = 'hmda-tract-marker'
export const TRACT_MARKER_HIGHLIGHT_ID = 'hmda-tract-marker-hi'

function drawPin(ctx, w, h, fill) {
  const cx = w / 2
  const headY = h * 0.34
  const r = w * 0.26

  ctx.clearRect(0, 0, w, h)
  ctx.beginPath()
  ctx.moveTo(cx, h - 2)
  ctx.quadraticCurveTo(cx - r * 1.05, headY + r * 0.55, cx - r, headY)
  ctx.arc(cx, headY, r, Math.PI, 0, false)
  ctx.quadraticCurveTo(cx + r * 1.05, headY + r * 0.55, cx, h - 2)
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.95)'
  ctx.lineWidth = 1.75
  ctx.stroke()

  ctx.beginPath()
  ctx.arc(cx, headY, r * 0.34, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  ctx.fill()
}

/**
 * Register default + highlight tract pin sprites on the map (idempotent).
 * @param {import('mapbox-gl').Map} map
 */
export function ensureTractMarkerImages(map) {
  if (!map?.addImage) return false
  if (map.hasImage(TRACT_MARKER_ID) && map.hasImage(TRACT_MARKER_HIGHLIGHT_ID)) return true

  try {
    const w = 32
    const h = 42
    const specs = [
      [TRACT_MARKER_ID, '#f59e0b'],
      [TRACT_MARKER_HIGHLIGHT_ID, '#4338ca'],
    ]
    for (const [id, fill] of specs) {
      if (map.hasImage(id)) continue
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) return false
      drawPin(ctx, w, h, fill)
      const imageData = ctx.getImageData(0, 0, w, h)
      map.addImage(id, imageData, { pixelRatio: 2 })
    }
    return true
  } catch {
    return false
  }
}

/**
 * Register a pin sprite for a specific hex color (idempotent).
 * Returns the image id for use in `icon-image` expressions.
 * @param {import('mapbox-gl').Map} map
 * @param {string} color - hex color string
 */
export function ensureTractMarkerColorImage(map, color) {
  if (!map?.addImage) return TRACT_MARKER_ID
  const id = `hmda-tract-marker-${String(color).replace(/[^a-fA-F0-9]/g, '')}`
  if (map.hasImage(id)) return id
  try {
    const w = 32
    const h = 42
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return TRACT_MARKER_ID
    drawPin(ctx, w, h, color)
    const imageData = ctx.getImageData(0, 0, w, h)
    map.addImage(id, imageData, { pixelRatio: 2 })
    return id
  } catch {
    return TRACT_MARKER_ID
  }
}

export function tractPointerSymbolLayout() {
  return {
    'icon-image': TRACT_MARKER_ID,
    'icon-size': [
      'case',
      ['boolean', ['feature-state', 'highlight'], false],
      ['interpolate', ['linear'], ['zoom'], 4, 0.58, 7, 0.71, 10, 0.83, 14, 0.94],
      ['interpolate', ['linear'], ['zoom'], 4, 0.5, 7, 0.62, 10, 0.72, 14, 0.82],
    ],
    'icon-allow-overlap': true,
    'icon-ignore-placement': true,
    'icon-anchor': 'bottom',
    'icon-pitch-alignment': 'map',
  }
}

export function tractPointerSymbolPaint() {
  return {
    'icon-opacity': [
      'interpolate',
      ['linear'],
      ['zoom'],
      4,
      0.88,
      10,
      0.96,
      14,
      1,
    ],
  }
}
