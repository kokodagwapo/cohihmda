/**
 * Resolve institution list for MLAR batch jobs (live FFIEC filers API or static JSON fallback).
 */
import fs from 'node:fs'
import path from 'node:path'
import https from 'node:https'
import { HMDA_DATA_DIR } from './paths.mjs'
import { FFIEC_USER_AGENT } from './ffiec-probe.mjs'

export function loadFilersFromStatic(year) {
  const y = Number(year)
  const candidates = [
    path.join(HMDA_DATA_DIR, `hmda-lenders-${y}-only.json`),
    path.join(HMDA_DATA_DIR, 'lenders-from-hmda.json'),
  ]
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue
    try {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'))
      const rows = Array.isArray(raw?.lenders) ? raw.lenders : Array.isArray(raw) ? raw : []
      const filtered = rows.filter((r) => Number(r.dataYear) === y)
      const filers = filtered
        .map((r) => ({ lei: String(r.lei || '').trim(), name: r.name || '' }))
        .filter((f) => f.lei)
      if (filers.length) return filers
    } catch {
      /* try next */
    }
  }
  return []
}

export function fetchFilersFromFfiec(year) {
  const url = `https://ffiec.cfpb.gov/v2/data-browser-api/view/filers?years=${Number(year) || 2025}`
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: { accept: 'application/json', 'user-agent': FFIEC_USER_AGENT },
          timeout: 20_000,
        },
        (res) => {
          if (res.statusCode !== 200) {
            res.resume()
            return reject(new Error(`filers HTTP ${res.statusCode}`))
          }
          let chunks = ''
          res.setEncoding('utf8')
          res.on('data', (c) => (chunks += c))
          res.on('end', () => {
            try {
              const j = JSON.parse(chunks)
              resolve(Array.isArray(j.institutions) ? j.institutions : [])
            } catch (e) {
              reject(e)
            }
          })
        },
      )
      .on('error', reject)
  })
}

/** Live FFIEC filers list, then static LEI roster from public/data/hmda/. */
export async function resolveFilersForYear(year) {
  try {
    const live = await fetchFilersFromFfiec(year)
    if (live.length) {
      console.log(`[hmda-filers] ${live.length} filers from FFIEC Data Browser API`)
      return { filers: live, source: 'ffiec-api' }
    }
  } catch (e) {
    console.warn(`[hmda-filers] FFIEC filers API: ${e.message}`)
  }
  const staticFilers = loadFilersFromStatic(year)
  if (staticFilers.length) {
    console.warn(
      `[hmda-filers] Using ${staticFilers.length} filers from static JSON (FFIEC filers API unavailable for ${year})`,
    )
    return { filers: staticFilers, source: 'static-json' }
  }
  throw new Error(
    `No filers for ${year}: FFIEC filers API failed and no static lender JSON found under public/data/hmda/`,
  )
}
