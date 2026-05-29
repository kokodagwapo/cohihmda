import { nmlsConsumerAccessCompanyUrl } from '@hmda/utils/hmdaFfiecLive.js'

function buildNmlsLink(nmls) {
  const id = String(nmls || '').replace(/\D/g, '').trim()
  if (!id) return null
  return {
    id,
    url: nmlsConsumerAccessCompanyUrl(id),
    source: 'NMLS Consumer Access',
  }
}

/** Merge API payload with lender-row hints (website, branches) when registry sources are sparse. */
export function mergeRegistryWithLenderRow(registry, lender, { websiteUrl, websiteVerified } = {}) {
  const base = registry && typeof registry === 'object' ? { ...registry } : {}
  const nmls = buildNmlsLink(lender?.nmls)
  if (nmls) base.nmls = { ...(base.nmls || {}), ...nmls }

  const verifiedSite =
    (websiteVerified && websiteUrl) ||
    (base.website?.verified && base.website?.url) ||
    (lender?.websiteVerified && lender?.website) ||
    null

  if (verifiedSite) {
    base.website = {
      url: String(verifiedSite).trim(),
      verified: true,
      source: base.website?.source || 'Company website',
    }
  } else if (lender?.website) {
    base.website = {
      url: String(lender.website).trim(),
      verified: !!lender.websiteVerified,
      source: 'Company website',
    }
  }

  base.hmda = {
    ...(base.hmda || {}),
    source: 'HMDA',
    lei: lender?.lei || base.hmda?.lei || null,
    name: lender?.name || base.hmda?.name || null,
    states: lender?.states ?? base.hmda?.states ?? null,
    branchCount: lender?.branchCount ?? base.hmda?.branchCount ?? null,
    branchSource: lender?.branchSource || base.hmda?.branchSource || null,
    institutionType: lender?.type || base.hmda?.institutionType || null,
  }

  return base
}

export async function fetchLenderRegistry(params = {}) {
  const qs = new URLSearchParams()
  if (params.lei) qs.set('lei', params.lei)
  if (params.name) qs.set('name', params.name)
  if (params.type) qs.set('type', params.type)
  if (params.nmls) qs.set('nmls', String(params.nmls))
  if (params.website) qs.set('website', params.website)
  if (params.websiteVerified) qs.set('websiteVerified', '1')
  if (params.branchCount != null) qs.set('branchCount', String(params.branchCount))
  if (params.branchSource) qs.set('branchSource', params.branchSource)
  if (params.states != null) qs.set('states', String(params.states))

  const res = await fetch(`/api/hmda/lender-registry?${qs}`, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`Registry HTTP ${res.status}`)
  return res.json()
}
