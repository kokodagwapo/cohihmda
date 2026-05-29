/** Seeded PRNG for stable star fields across resizes. */
export function mulberry32(seed) {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

/** @param {number} count @param {number} w @param {number} h */
export function buildStarField(count, w, h, seed = 0x5a7e) {
  const rnd = mulberry32(seed)
  const stars = []
  for (let i = 0; i < count; i++) {
    stars.push({
      x: rnd() * w,
      y: rnd() * h,
      r: rnd() * 1.8 + 0.35,
      phase: rnd() * Math.PI * 2,
      twinkle: 0.4 + rnd() * 0.6,
      drift: 0.35 + rnd() * 0.65,
      hue: rnd() > 0.86 ? 220 : rnd() > 0.72 ? 45 : 0,
    })
  }
  return stars
}

/** Minimum vertical fraction — keeps ISS / aircraft below the map toolbar. */
export const COSMIC_TOOLBAR_SAFE_Y = 0.11

const METEOR_DIRECTIONS = ['north', 'south', 'east', 'west', 'nw', 'ne', 'sw', 'se']

/** @param {number} count */
export function buildFallingStars(count = 12, seed = 0xf411) {
  const rnd = mulberry32(seed)
  const stars = []
  for (let i = 0; i < count; i++) {
    stars.push({
      direction: METEOR_DIRECTIONS[i % METEOR_DIRECTIONS.length],
      startT: rnd(),
      speed: 0.07 + rnd() * 0.13,
      phase: rnd(),
      length: 38 + rnd() * 76,
      width: 0.65 + rnd() * 0.85,
      hue: rnd() > 0.35 ? 210 : 45,
      skew: (rnd() - 0.5) * 0.35,
    })
  }
  return stars
}

/** @param {number} count */
export function buildComets(count = 2, seed = 0xc0be) {
  const rnd = mulberry32(seed)
  const comets = []
  for (let i = 0; i < count; i++) {
    comets.push({
      /** 0–1 start along top/left edge band */
      startT: rnd(),
      /** diagonal direction in radians */
      angle: -0.55 - rnd() * 0.35,
      speed: 0.06 + rnd() * 0.05,
      phase: rnd(),
      tail: 48 + rnd() * 56,
      core: 1.2 + rnd() * 0.8,
      hue: rnd() > 0.5 ? 195 : 42,
    })
  }
  return comets
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {ReturnType<typeof buildStarField>} stars
 * @param {number} t seconds
 * @param {number} globalAlpha
 */
export function paintStars(ctx, stars, t, globalAlpha = 1, viewport = { w: 0, h: 0 }) {
  const { w = 0, h = 0 } = viewport
  const driftX = w ? Math.sin(t * 0.018) * w * 0.014 + Math.sin(t * 0.006) * w * 0.006 : 0
  const driftY = h ? Math.cos(t * 0.014) * h * 0.01 + Math.cos(t * 0.005) * h * 0.004 : 0

  for (const s of stars) {
    const flicker = 0.58 + s.twinkle * (0.42 + 0.42 * Math.sin(t * 1.6 + s.phase))
    const a = Math.min(1, flicker * globalAlpha)
    const px = w ? ((s.x + driftX * s.drift) % w + w) % w : s.x
    const py = h ? ((s.y + driftY * s.drift) % h + h) % h : s.y
    if (s.hue === 220) {
      ctx.fillStyle = `rgba(186, 210, 255, ${a})`
    } else if (s.hue === 45) {
      ctx.fillStyle = `rgba(255, 236, 200, ${a})`
    } else {
      ctx.fillStyle = `rgba(255, 255, 255, ${a})`
    }
    ctx.beginPath()
    ctx.arc(px, py, s.r, 0, Math.PI * 2)
    ctx.fill()
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {ReturnType<typeof buildComets>} comets
 * @param {number} w
 * @param {number} h
 * @param {number} t seconds
 * @param {number} globalAlpha
 */
export function paintComets(ctx, comets, w, h, t, globalAlpha = 1) {
  for (const c of comets) {
    const cycle = (t * c.speed + c.phase) % 1
    if (cycle < 0.08 || cycle > 0.92) continue

    const travel = (cycle - 0.08) / 0.84
    const startX = -0.12 * w + c.startT * w * 1.24
    const startY = h * (0.05 + c.startT * 0.35)
    const dist = Math.hypot(w, h) * 0.95
    const x = startX + Math.cos(c.angle) * dist * travel
    const y = startY + Math.sin(c.angle) * dist * travel

    const tailX = x - Math.cos(c.angle) * c.tail
    const tailY = y - Math.sin(c.angle) * c.tail

    const grad = ctx.createLinearGradient(tailX, tailY, x, y)
    const color = c.hue === 195 ? '180, 230, 255' : '255, 220, 160'
    grad.addColorStop(0, `rgba(${color}, 0)`)
    grad.addColorStop(0.55, `rgba(${color}, ${0.35 * globalAlpha})`)
    grad.addColorStop(1, `rgba(255, 255, 255, ${0.92 * globalAlpha})`)

    ctx.strokeStyle = grad
    ctx.lineWidth = c.core
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(tailX, tailY)
    ctx.lineTo(x, y)
    ctx.stroke()

    ctx.fillStyle = `rgba(255, 255, 255, ${globalAlpha})`
    ctx.beginPath()
    ctx.arc(x, y, c.core + 0.6, 0, Math.PI * 2)
    ctx.fill()
  }
}

function meteorEndpoints(m, w, h) {
  const t = m.startT
  const safe = h * COSMIC_TOOLBAR_SAFE_Y
  const cx = w * 0.5
  const skew = m.skew || 0

  switch (m.direction) {
    case 'north':
      return {
        x0: w * (0.12 + t * 0.76),
        y0: safe * 0.35,
        x1: w * (0.18 + (1 - t) * 0.64) + skew * w * 0.08,
        y1: h * 0.96,
      }
    case 'south':
      return {
        x0: w * (0.88 - t * 0.76),
        y0: h * 0.94,
        x1: w * (0.14 + t * 0.72) + skew * w * 0.08,
        y1: safe,
      }
    case 'east':
      return {
        x0: w * 1.04,
        y0: safe + t * (h * 0.68 - safe),
        x1: -w * 0.04,
        y1: h * (0.16 + (1 - t) * 0.58),
      }
    case 'west':
      return {
        x0: -w * 0.04,
        y0: safe + (1 - t) * (h * 0.68 - safe),
        x1: w * 1.04,
        y1: h * (0.16 + t * 0.58),
      }
    case 'nw':
      return { x0: w * (0.02 + t * 0.2), y0: safe * 0.4, x1: w * 0.98, y1: h * 0.96 }
    case 'ne':
      return { x0: w * (0.98 - t * 0.2), y0: safe * 0.4, x1: w * 0.02, y1: h * 0.96 }
    case 'sw':
      return { x0: w * (0.04 + t * 0.18), y0: h * 0.95, x1: w * 0.96, y1: safe }
    case 'se':
      return { x0: w * (0.96 - t * 0.18), y0: h * 0.95, x1: w * 0.04, y1: safe }
    default:
      return {
        x0: cx + (t - 0.5) * w * 0.3,
        y0: safe,
        x1: cx - (t - 0.5) * w * 0.3,
        y1: h * 0.9,
      }
  }
}

/**
 * Fast streaks (shooting stars) — cross the globe from N/S/E/W and diagonals.
 * @param {CanvasRenderingContext2D} ctx
 * @param {ReturnType<typeof buildFallingStars>} meteors
 */
export function paintFallingStars(ctx, meteors, w, h, t, globalAlpha = 1) {
  for (const m of meteors) {
    const cycle = (t * m.speed + m.phase) % 1
    if (cycle < 0.1 || cycle > 0.42) continue

    const u = (cycle - 0.1) / 0.32
    const { x0, y0, x1, y1 } = meteorEndpoints(m, w, h)
    const x = x0 + (x1 - x0) * u
    const y = y0 + (y1 - y0) * u
    const dx = x1 - x0
    const dy = y1 - y0
    const len = Math.hypot(dx, dy) || 1
    const tailX = x - (dx / len) * m.length
    const tailY = y - (dy / len) * m.length

    const grad = ctx.createLinearGradient(tailX, tailY, x, y)
    const rgb = m.hue === 210 ? '200, 230, 255' : '255, 248, 220'
    grad.addColorStop(0, `rgba(${rgb}, 0)`)
    grad.addColorStop(0.65, `rgba(${rgb}, ${0.62 * globalAlpha})`)
    grad.addColorStop(1, `rgba(255, 255, 255, ${0.98 * globalAlpha})`)

    ctx.strokeStyle = grad
    ctx.lineWidth = m.width
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(tailX, tailY)
    ctx.lineTo(x, y)
    ctx.stroke()
  }
}

/** Decorative ISS + aircraft — paths sit below the toolbar, over the visible globe. */
export function buildSkyTrackers(seed = 0x155) {
  const rnd = mulberry32(seed)
  const safeY = COSMIC_TOOLBAR_SAFE_Y
  return {
    iss: {
      phase: rnd(),
      speed: 0.008,
      cx: 0.5,
      cy: 0.5,
      rx: 0.36,
      ry: 0.2,
      tilt: -0.22 + rnd() * 0.12,
      minY: safeY + 0.02,
    },
    aircraft: [
      { phase: rnd(), speed: 0.011, y: safeY + 0.02 + rnd() * 0.04, dir: 1, scale: 1.12 },
      { phase: rnd(), speed: 0.0095, y: safeY + 0.08 + rnd() * 0.05, dir: -1, scale: 0.98 },
      { phase: rnd(), speed: 0.0088, y: 0.42 + rnd() * 0.12, dir: 1, scale: 0.94 },
      { phase: rnd(), speed: 0.0092, y: 0.68 + rnd() * 0.14, dir: -1, scale: 0.9 },
    ],
  }
}

function paintIss(ctx, iss, w, h, t, globalAlpha) {
  const cycle = (t * iss.speed + iss.phase) % 1
  const a = cycle * Math.PI * 2 + iss.tilt
  const x = w * (iss.cx + Math.cos(a) * iss.rx)
  let y = h * (iss.cy + Math.sin(a) * iss.ry)
  const minY = h * (iss.minY ?? COSMIC_TOOLBAR_SAFE_Y)
  if (y < minY) y = minY + (minY - y) * 0.15

  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(a + Math.PI * 0.5)
  ctx.globalAlpha = globalAlpha * 0.96

  ctx.fillStyle = 'rgba(255,255,255,0.95)'
  ctx.fillRect(-22, -2, 44, 4)
  ctx.fillStyle = 'rgba(186,210,255,0.98)'
  ctx.fillRect(-5, -5, 10, 10)
  ctx.strokeStyle = 'rgba(255,255,255,0.65)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.arc(0, 0, 12, 0, Math.PI * 2)
  ctx.stroke()

  ctx.fillStyle = `rgba(255,255,255,${0.35 * globalAlpha})`
  ctx.font = '600 8px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('ISS', 0, -16)

  ctx.restore()
}

function paintAircraft(ctx, ac, w, h, t, globalAlpha) {
  const u = (t * ac.speed + ac.phase) % 1
  const x = ac.dir > 0 ? w * (-0.06 + u * 1.12) : w * (1.06 - u * 1.12)
  const y = h * ac.y

  ctx.save()
  ctx.translate(x, y)
  ctx.scale(ac.scale * (ac.dir < 0 ? -1 : 1), ac.scale)
  ctx.globalAlpha = globalAlpha * 0.82

  ctx.strokeStyle = `rgba(255,255,255,${0.28 * globalAlpha})`
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.moveTo(-8, 0)
  ctx.lineTo(-36, 0)
  ctx.stroke()

  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  ctx.beginPath()
  ctx.moveTo(11, 0)
  ctx.lineTo(-6, -4.5)
  ctx.lineTo(-3.5, 0)
  ctx.lineTo(-6, 4.5)
  ctx.closePath()
  ctx.fill()

  ctx.restore()
}

/**
 * @param {ReturnType<typeof buildSkyTrackers>} trackers
 */
export function paintSkyTrackers(ctx, trackers, w, h, t, globalAlpha = 1) {
  if (!trackers || globalAlpha < 0.04) return
  paintIss(ctx, trackers.iss, w, h, t, globalAlpha)
  for (const ac of trackers.aircraft || []) {
    paintAircraft(ctx, ac, w, h, t, globalAlpha)
  }
}

/** Globe / hero visibility: fade cosmic overlay before regional zoom so the basemap stays sharp. */
export function cosmicOpacityForView(zoom, pitch, { satelliteBasemap = false, detailView = false } = {}) {
  if (detailView) return 0

  const z = Number(zoom) || 3
  const p = Number(pitch) || 0
  let o = 1

  if (satelliteBasemap) {
    if (z >= 6.2) o = 0
    else if (z >= 4.8) o = (6.2 - z) / 1.4
    else o = 1
  } else if (z >= 6.5) o = 0
  else if (z >= 4.8) o = (6.5 - z) / 1.7
  else o = 1

  const pitchFactor = Math.min(1, Math.max(0.45, p / 38))
  const pitchScale = satelliteBasemap ? 0.72 + pitchFactor * 0.28 : 0.55 + pitchFactor * 0.45
  return Math.max(0, Math.min(1, o * pitchScale))
}
