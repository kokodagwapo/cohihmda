/**
 * Lightweight FFIEC reachability check for local refresh scripts.
 */
import https from 'node:https'

export const FFIEC_USER_AGENT =
  'coheus-site/1.0 (HMDA FFIEC proxy; https://ffiec.cfpb.gov/documentation/category/developer-apis)'

/** @returns {Promise<{ ok: boolean, status: number|null, reason: string|null }>} */
export function probeFfiecFilers(year = 2025) {
  const url = `https://ffiec.cfpb.gov/v2/data-browser-api/view/filers?years=${Number(year) || 2025}`
  return new Promise((resolve) => {
    const req = https.get(
      url,
      {
        headers: { accept: 'application/json', 'user-agent': FFIEC_USER_AGENT },
        timeout: 20_000,
      },
      (res) => {
        res.resume()
        if (res.statusCode === 200) {
          resolve({ ok: true, status: 200, reason: null })
          return
        }
        resolve({
          ok: false,
          status: res.statusCode ?? null,
          reason:
            res.statusCode === 403
              ? 'FFIEC returned HTTP 403 Access Denied from this network'
              : res.statusCode === 400
                ? `FFIEC Data Browser filers API does not serve ${Number(year) || 2025} yet (HTTP 400)`
                : `FFIEC filers endpoint returned HTTP ${res.statusCode}`,
        })
      },
    )
    req.on('timeout', () => {
      req.destroy()
      resolve({ ok: false, status: null, reason: 'FFIEC filers probe timed out' })
    })
    req.on('error', (err) => {
      resolve({ ok: false, status: null, reason: err.message || 'FFIEC filers probe failed' })
    })
  })
}
