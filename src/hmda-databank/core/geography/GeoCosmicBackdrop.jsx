import { useEffect, useRef, useState } from 'react'
import {
  buildComets,
  buildFallingStars,
  buildSkyTrackers,
  buildStarField,
  cosmicOpacityForView,
  paintComets,
  paintFallingStars,
  paintSkyTrackers,
  paintStars,
} from './geo-cosmic-backdrop.js'

/**
 * Deep-space layer around the Mapbox globe — Milky Way, stars, shooting stars,
 * ISS, and a few aircraft at the horizon. Fades out when the user zooms in.
 */
export default function GeoCosmicBackdrop({
  mapRef,
  mapReady,
  enabled = true,
  satelliteBasemap = false,
  detailView = false,
}) {
  const canvasRef = useRef(null)
  const foregroundCanvasRef = useRef(null)
  const rootRef = useRef(null)
  const starsRef = useRef([])
  const cometsRef = useRef(buildComets(3))
  const fallingStarsRef = useRef(buildFallingStars(14))
  const trackersRef = useRef(buildSkyTrackers())
  const sizeRef = useRef({ w: 0, h: 0 })
  const rafRef = useRef(0)
  const viewOpacityRef = useRef(1)
  const [viewOpacity, setViewOpacity] = useState(1)

  useEffect(() => {
    if (!enabled || !mapReady) return
    const map = mapRef?.current?.getMap?.()
    if (!map) return

    const sync = () => {
      const o = cosmicOpacityForView(map.getZoom(), map.getPitch(), { satelliteBasemap, detailView })
      viewOpacityRef.current = o
      setViewOpacity(o)
    }
    sync()
    map.on('move', sync)
    map.on('zoom', sync)
    map.on('pitch', sync)
    return () => {
      map.off('move', sync)
      map.off('zoom', sync)
      map.off('pitch', sync)
    }
  }, [enabled, mapReady, mapRef, satelliteBasemap, detailView])

  useEffect(() => {
    if (!enabled) return

    const canvas = canvasRef.current
    const foregroundCanvas = foregroundCanvasRef.current
    if (!canvas || !foregroundCanvas) return

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const resize = () => {
      const parent = rootRef.current
      if (!parent) return
      const w = parent.clientWidth
      const h = parent.clientHeight
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      for (const c of [canvas, foregroundCanvas]) {
        c.width = Math.floor(w * dpr)
        c.height = Math.floor(h * dpr)
        c.style.width = `${w}px`
        c.style.height = `${h}px`
      }
      sizeRef.current = { w, h }
      const count = Math.min(satelliteBasemap ? 620 : 480, Math.floor((w * h) / (satelliteBasemap ? 2800 : 3600)))
      starsRef.current = buildStarField(count, canvas.width, canvas.height)
    }

    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(rootRef.current)

    const ctx = canvas.getContext('2d')
    const fgCtx = foregroundCanvas.getContext('2d')
    if (!ctx || !fgCtx) return () => ro.disconnect()

    const t0 = performance.now()

    const frame = (now) => {
      const { w, h } = sizeRef.current
      if (!w || !h) {
        rafRef.current = requestAnimationFrame(frame)
        return
      }
      const t = (now - t0) / 1000
      const alpha = viewOpacityRef.current

      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      fgCtx.setTransform(1, 0, 0, 1, 0, 0)
      fgCtx.clearRect(0, 0, foregroundCanvas.width, foregroundCanvas.height)

      if (alpha > 0.02) {
        paintStars(ctx, starsRef.current, reducedMotion ? 0 : t, alpha, {
          w: canvas.width,
          h: canvas.height,
        })
        if (!reducedMotion) {
          paintComets(ctx, cometsRef.current, canvas.width, canvas.height, t, alpha * 0.75)
          paintFallingStars(fgCtx, fallingStarsRef.current, foregroundCanvas.width, foregroundCanvas.height, t, alpha * 0.95)
          paintSkyTrackers(fgCtx, trackersRef.current, foregroundCanvas.width, foregroundCanvas.height, t, alpha * 0.92)
        }
      }

      rafRef.current = requestAnimationFrame(frame)
    }

    rafRef.current = requestAnimationFrame(frame)

    return () => {
      ro.disconnect()
      cancelAnimationFrame(rafRef.current)
    }
  }, [enabled, satelliteBasemap])

  if (!enabled) return null

  const visible = viewOpacity > 0.01

  return (
    <div
      ref={rootRef}
      className={`hmda-geo-cosmic-backdrop${satelliteBasemap ? ' hmda-geo-cosmic-backdrop--satellite' : ''}${visible ? '' : ' hmda-geo-cosmic-backdrop--hidden'}`}
      style={{ opacity: viewOpacity }}
      aria-hidden
    >
      <div className="hmda-geo-cosmic-backdrop__stage">
        <div className="hmda-geo-cosmic-backdrop__milky-way" />
        <div className="hmda-geo-cosmic-backdrop__nebula" />
        <div className="hmda-geo-cosmic-backdrop__galaxies">
          <span className="hmda-geo-cosmic-galaxy hmda-geo-cosmic-galaxy--milky" aria-hidden />
          <span className="hmda-geo-cosmic-galaxy hmda-geo-cosmic-galaxy--a" />
          <span className="hmda-geo-cosmic-galaxy hmda-geo-cosmic-galaxy--b" />
        </div>
        <canvas ref={canvasRef} className="hmda-geo-cosmic-backdrop__canvas" />
        <canvas ref={foregroundCanvasRef} className="hmda-geo-cosmic-backdrop__foreground" />
      </div>
    </div>
  )
}
