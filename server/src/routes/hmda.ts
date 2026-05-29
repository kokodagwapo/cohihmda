import type { Express } from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

/** Resolve Mapbox public token from env (pk. only). */
function getMapboxPublicToken(): string | null {
  const candidates = [
    process.env.MAPBOX_ACCESS_TOKEN,
    process.env.MAPBOX_PUBLIC_TOKEN,
    process.env.VITE_MAPBOX_ACCESS_TOKEN,
  ]
  for (const raw of candidates) {
    const t = String(raw || '').trim()
    if (t.startsWith('pk.')) return t
  }
  return null
}

/**
 * Mount HMDA DataBank API routes (ported from hmda/server/hmda).
 * Static JSON fallback reads from public/data/hmda/.
 */
export function registerHmdaRoutes(app: Express): void {
  try {
    const routesPath = path.resolve(__dirname, '../../hmda/routes.mjs')
    const { registerHmdaDataRoutes } = require(routesPath) as {
      registerHmdaDataRoutes: (app: Express) => void
    }
    registerHmdaDataRoutes(app)
    console.log('✅ HMDA DataBank API routes mounted at /api/hmda/*')
  } catch (err) {
    console.warn('⚠️ HMDA API routes not mounted:', (err as Error)?.message)
  }

  app.get('/api/mapbox-config', (_req, res) => {
    const token = getMapboxPublicToken()
    if (!token) {
      return res.status(404).json({
        error:
          'No Mapbox public token (pk.) on server. Set MAPBOX_ACCESS_TOKEN or VITE_MAPBOX_ACCESS_TOKEN.',
      })
    }
    res.set('Cache-Control', 'private, no-store')
    res.json({ token })
  })
}
