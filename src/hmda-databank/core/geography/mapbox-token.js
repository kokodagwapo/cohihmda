import { MAPBOX_PK_RE, resolveMapboxPublicToken } from './mapbox-config.js'

/** Browser-local override when no pk. token is available from env or /api/mapbox-config */
export const MAPBOX_LS_KEY = 'hmda_mapbox_access_token'

function isPlaceholderMapboxToken(token) {
  const lower = String(token || '').trim().toLowerCase()
  return (
    lower.includes('your_mapbox') ||
    lower.includes('your-mapbox') ||
    lower.includes('example') ||
    lower.includes('placeholder')
  )
}

export function isMapboxPublicToken(token) {
  const t = String(token || '').trim()
  return !isPlaceholderMapboxToken(t) && MAPBOX_PK_RE.test(t)
}

export function isMapboxSecretToken(token) {
  return /^sk\.[a-zA-Z0-9._-]{20,}$/.test(String(token || '').trim())
}

/** Sync read: .env (VITE_* or MAPBOX_PUBLIC_TOKEN via build inject) or browser localStorage — pk. only. */
export function readMapboxToken() {
  const viteAccess = String(import.meta.env.VITE_MAPBOX_ACCESS_TOKEN || '').trim()
  if (viteAccess && isMapboxSecretToken(viteAccess)) return { token: '', source: 'env-sk-rejected' }
  const vitePublic = String(import.meta.env.VITE_MAPBOX_PUBLIC_TOKEN || '').trim()
  if (vitePublic && isMapboxSecretToken(vitePublic)) return { token: '', source: 'env-sk-rejected' }

  const fromEnv = resolveMapboxPublicToken()
  if (fromEnv) return { token: fromEnv, source: 'env' }
  try {
    const fromLs = String(localStorage.getItem(MAPBOX_LS_KEY) || '').trim()
    if (fromLs && isMapboxPublicToken(fromLs)) return { token: fromLs, source: 'local' }
  } catch {
    /* private mode */
  }
  return { token: '', source: null }
}

/** Load pk. token from server (.env / Replit Secrets via server.mjs). */
export async function fetchMapboxTokenFromServer() {
  try {
    const r = await fetch('/api/mapbox-config', { credentials: 'same-origin' })
    if (!r.ok) {
      if (import.meta.env.DEV) {
        console.warn(
          `[HMDA Geography] GET /api/mapbox-config returned ${r.status}. ` +
            'Set MAPBOX_PUBLIC_TOKEN or VITE_MAPBOX_ACCESS_TOKEN in cohi/.env (real pk. token, not placeholder).',
        )
      }
      return { token: '', source: null }
    }
    const data = await r.json()
    const token = String(data?.token || '').trim()
    if (isMapboxPublicToken(token)) return { token, source: 'server' }
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('[HMDA Geography] /api/mapbox-config unavailable:', err)
    }
  }
  return { token: '', source: null }
}

export function saveMapboxToken(token) {
  const t = String(token || '').trim()
  if (t && !isMapboxPublicToken(t)) {
    throw new Error('Mapbox map requires a public token (pk.), not a secret token (sk.).')
  }
  localStorage.setItem(MAPBOX_LS_KEY, t)
  return t
}

export function clearMapboxToken() {
  localStorage.removeItem(MAPBOX_LS_KEY)
}

export function isValidMapboxToken(token) {
  return isMapboxPublicToken(token)
}

export function envMapboxLine(token) {
  return `VITE_MAPBOX_ACCESS_TOKEN=${token.trim()}`
}
