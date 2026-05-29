import { validateLei } from './ffiec-client.mjs'

const GLEIF_BASE = 'https://api.gleif.org/api/v1/lei-records'
const FDIC_INSTITUTIONS = 'https://api.fdic.gov/banks/institutions'
const cache = new Map()
const CACHE_MS = 6 * 60 * 60 * 1000

function normalizeNameKey(name) {
  return String(name || '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+(LLC|INC|CORP|CORPORATION|CO|COMPANY|LTD|LP|NA|N\.A\.|BANK|BANCORP|MORTGAGE|FINANCIAL|SERVICES)\.?$/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function formatGleifAddress(addr) {
  if (!addr || typeof addr !== 'object') return null
  const parts = [
    ...(Array.isArray(addr.addressLines) ? addr.addressLines : []),
    [addr.city, addr.region, addr.postalCode].filter(Boolean).join(', '),
    addr.country || '',
  ].filter(Boolean)
  return parts.length ? parts.join(', ') : null
}

function extractPhoneFromAddresses(...addresses) {
  for (const addr of addresses) {
    const lines = addr?.addressLines
    if (!Array.isArray(lines)) continue
    const match = lines.join(' ').match(/(\+?\d[\d\s().-]{7,}\d)/)
    if (match) return match[1].trim()
  }
  return null
}

async function fetchGleifRecord(lei) {
  const res = await fetch(`${GLEIF_BASE}/${encodeURIComponent(lei)}`, {
    headers: { Accept: 'application/vnd.api+json' },
    signal: AbortSignal.timeout(12000),
  })
  if (!res.ok) throw new Error(`GLEIF ${res.status}`)
  const data = await res.json()
  const ent = data?.data?.attributes?.entity || {}
  const legalAddress = ent.legalAddress || null
  const hqAddress = ent.headquartersAddress || null
  const legalName =
    typeof ent.legalName === 'object' && ent.legalName?.name
      ? ent.legalName.name
      : ent.legalName || null
  const otherNames = Array.isArray(ent.otherNames) ? ent.otherNames : []
  const dba =
    otherNames.find((n) => /DBA|TRADE|BUSINESS/i.test(String(n.type || '')))?.name ||
    otherNames[0]?.name ||
    null
  return {
    source: 'GLEIF',
    legalName,
    dba,
    legalAddress,
    hqAddress,
    legalAddressText: formatGleifAddress(legalAddress),
    hqAddressText: formatGleifAddress(hqAddress),
    phone: extractPhoneFromAddresses(legalAddress, hqAddress),
  }
}

async function fetchFdicInstitution(name) {
  const key = normalizeNameKey(name)
  if (!key || key.length < 4) return null
  const filter = encodeURIComponent(`NAME:"${String(name).replace(/"/g, '').slice(0, 120)}"`)
  const url = `${FDIC_INSTITUTIONS}?filters=${filter}&fields=NAME,CERT,WEBADDR,ADDRESS,CITY,STALP,ZIP,ACTIVE,OFFDOM&limit=5&format=json`
  const res = await fetch(url, { signal: AbortSignal.timeout(12000) })
  if (!res.ok) return null
  const body = await res.json()
  const rows = Array.isArray(body?.data) ? body.data : []
  if (!rows.length) return null
  const scored = rows
    .map((row) => {
      const d = row?.data || row || {}
      const rowName = String(d.NAME || '')
      const rowKey = normalizeNameKey(rowName)
      let score = 0
      if (rowKey === key) score += 100
      else if (rowKey.includes(key) || key.includes(rowKey)) score += 60
      else if (rowKey.split(' ')[0] === key.split(' ')[0]) score += 20
      if (String(d.ACTIVE || '').toUpperCase() === '1') score += 10
      return { d, score }
    })
    .sort((a, b) => b.score - a.score)
  const best = scored[0]?.d
  if (!best || scored[0].score < 20) return null
  const addressParts = [best.ADDRESS, best.CITY, best.STALP, best.ZIP].filter(Boolean)
  return {
    source: 'FDIC',
    name: best.NAME || null,
    cert: best.CERT != null ? String(best.CERT) : null,
    website: best.WEBADDR ? String(best.WEBADDR).trim() : null,
    addressText: addressParts.length ? addressParts.join(', ') : null,
    branchCount: best.OFFDOM != null && Number.isFinite(Number(best.OFFDOM)) ? Number(best.OFFDOM) : null,
    active: String(best.ACTIVE || '') === '1',
  }
}

function buildSearchLinks(name) {
  const q = encodeURIComponent(`${String(name || '').trim()} mortgage`)
  return {
    google: `https://www.google.com/search?q=${q}`,
    bing: `https://www.bing.com/search?q=${q}`,
  }
}

function buildNmlsLink(nmls) {
  const id = String(nmls || '').replace(/\D/g, '').trim()
  if (!id) return null
  return {
    id,
    url: `https://www.nmlsconsumeraccess.org/EntityDetails.aspx/COMPANY/${id}`,
    source: 'NMLS Consumer Access',
  }
}

export async function buildLenderRegistryPayload({ lei, name, type, nmls, website, websiteVerified, branchCount, branchSource, states }) {
  const search = buildSearchLinks(name)
  const nmlsLink = buildNmlsLink(nmls)
  const payload = {
    hmda: {
      source: 'HMDA',
      lei: lei || null,
      name: name || null,
      states: states != null && Number.isFinite(Number(states)) ? Number(states) : null,
      branchCount: branchCount != null && Number.isFinite(Number(branchCount)) ? Number(branchCount) : null,
      branchSource: branchSource || null,
      institutionType: type || null,
    },
    gleif: null,
    fdic: null,
    ncua: null,
    nmls: nmlsLink,
    website: website
      ? { url: String(website).trim(), verified: !!websiteVerified, source: 'Company website' }
      : null,
    search,
  }

  const instType = String(type || '').toLowerCase()
  if (instType.includes('credit union')) {
    payload.ncua = {
      source: branchSource?.startsWith('NCUA') ? 'NCUA' : 'NCUA (member registry)',
      branchCount: payload.hmda.branchCount,
      note: 'Credit union branch counts from NCUA call report data when available in the lender file.',
    }
  }

  const tasks = []
  if (lei && validateLei(lei)) {
    tasks.push(
      fetchGleifRecord(lei)
        .then((gleif) => {
          payload.gleif = gleif
        })
        .catch(() => {
          payload.gleif = { source: 'GLEIF', error: 'Unavailable' }
        }),
    )
  }
  if (instType.includes('bank') || instType.includes('depository')) {
    tasks.push(
      fetchFdicInstitution(name)
        .then((fdic) => {
          payload.fdic = fdic
          if (fdic?.website && !payload.website) {
            payload.website = { url: fdic.website, verified: false, source: 'FDIC' }
          }
        })
        .catch(() => {}),
    )
  }
  await Promise.all(tasks)
  return payload
}

export function registerLenderRegistryRoutes(app) {
  app.get('/api/hmda/lender-registry', async (req, res) => {
    try {
      const lei = String(req.query.lei || '')
        .trim()
        .toUpperCase()
      const name = String(req.query.name || '').trim()
      const type = String(req.query.type || '').trim()
      const nmls = String(req.query.nmls || '').trim()
      const website = String(req.query.website || '').trim()
      const websiteVerified = String(req.query.websiteVerified || '') === '1'
      const branchCountRaw = req.query.branchCount
      const branchSource = String(req.query.branchSource || '').trim()
      const statesRaw = req.query.states

      if (!lei && !name) {
        return res.status(400).json({ error: 'Provide lei and/or name' })
      }
      if (lei && !validateLei(lei)) {
        return res.status(400).json({ error: 'Invalid LEI format' })
      }

      const cacheKey = [lei, name, type, nmls, website, branchCountRaw, branchSource, statesRaw].join('|')
      const hit = cache.get(cacheKey)
      if (hit && Date.now() - hit.at < CACHE_MS) {
        res.set('Cache-Control', 'public, max-age=3600')
        return res.json(hit.data)
      }

      const data = await buildLenderRegistryPayload({
        lei: lei || null,
        name,
        type,
        nmls,
        website: website || null,
        websiteVerified,
        branchCount: branchCountRaw != null ? Number(branchCountRaw) : null,
        branchSource: branchSource || null,
        states: statesRaw != null ? Number(statesRaw) : null,
      })
      cache.set(cacheKey, { at: Date.now(), data })
      res.set('Cache-Control', 'public, max-age=3600')
      res.json(data)
    } catch (e) {
      console.error('[HMDA lender registry]', e.message)
      res.status(500).json({ error: e.message || 'Registry lookup failed' })
    }
  })
}
