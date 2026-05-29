/** Register a modern map pin image on the Mapbox map instance. */
export function registerGeoMapPin(map, imageId = 'hmda-geo-pin') {
  if (map.hasImage(imageId)) return imageId

  const w = 32
  const h = 42
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return imageId

  const cx = w / 2
  const cy = h - 6
  const r = 11

  ctx.clearRect(0, 0, w, h)
  ctx.shadowColor = 'rgba(15, 23, 42, 0.25)'
  ctx.shadowBlur = 4
  ctx.shadowOffsetY = 2

  ctx.beginPath()
  ctx.arc(cx, cy - 14, r, Math.PI, 0, false)
  ctx.quadraticCurveTo(cx + r, cy - 2, cx, cy)
  ctx.quadraticCurveTo(cx - r, cy - 2, cx - r, cy - 14)
  ctx.closePath()
  ctx.fillStyle = '#4f46e5'
  ctx.fill()

  ctx.shadowColor = 'transparent'
  ctx.beginPath()
  ctx.arc(cx, cy - 14, 4.5, 0, Math.PI * 2)
  ctx.fillStyle = '#ffffff'
  ctx.fill()

  const imageData = ctx.getImageData(0, 0, w, h)
  map.addImage(imageId, imageData, { pixelRatio: 2 })
  return imageId
}
