const AVG_LOAN_FALLBACK = 380000

function parseProductsJson(raw) {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function parseExtraJson(raw) {
  if (!raw) return {}
  try {
    return JSON.parse(raw) || {}
  } catch {
    return {}
  }
}

/** Map warehouse DB row to legacy client lender row shape. */
export function dbRowToClientLender(lender, yearFact, { productFacts = [], stateFacts = [] } = {}) {
  const extra = parseExtraJson(yearFact?.extraJson)
  const products = parseProductsJson(yearFact?.productsJson)
  const orig = Number(yearFact?.originations) || 0
  const dollarVol =
    yearFact?.dollarVolume != null
      ? Number(yearFact.dollarVolume)
      : orig * (Number(yearFact?.avgLoanAmount) || AVG_LOAN_FALLBACK)

  const byProduct = {}
  for (const pf of productFacts) {
    byProduct[pf.loanType] = {
      originated: pf.originations,
      approximate: pf.approximate,
      hmdaLoanType: extra.loanTypeCodes?.[pf.loanType] ?? null,
    }
  }

  const stateBreakdown = stateFacts.map((sf) => ({
    state: sf.stateCode,
    originated: sf.originations,
    volume: sf.dollarVolume != null ? Number(sf.dollarVolume) : null,
  }))

  return {
    lei: lender.lei,
    name: lender.legalName,
    legalName: lender.legalName,
    nmls: lender.nmls || '',
    nmlsNumber: lender.nmls || '',
    type: lender.institutionType || 'IMB',
    dataYear: Number(yearFact?.year),
    orig,
    originations: orig,
    dollarVol,
    branches: extra.branches ?? null,
    states: yearFact?.stateCount ?? stateFacts.length,
    fico: extra.fico ?? null,
    ltv: extra.ltv ?? null,
    dti: extra.dti ?? null,
    rate: yearFact?.rate ?? null,
    hmdaRate: extra.hmdaRate ?? null,
    rateSource: yearFact?.rateSource || null,
    products,
    conf: yearFact?.confidence ?? 90,
    channel: yearFact?.channel || 'retail',
    status: yearFact?.status || 'verified',
    website: lender.website || extra.website || null,
    websiteVerified: lender.websiteVerified || false,
    originationBreakdown: Object.keys(byProduct).length
      ? { byProduct, totalOriginatedUnits: orig, mergedInsightsFromYear: extra.mergedInsightsFromYear ?? null }
      : extra.originationBreakdown ?? null,
    hmdaInsights: stateBreakdown.length
      ? { stateBreakdown, reportingYear: Number(yearFact?.year) }
      : extra.hmdaInsights ?? null,
    declinations: extra.declinations ?? null,
    quarterHistory: extra.quarterHistory ?? null,
  }
}

export function clientLenderToDbRows(row) {
  const lei = String(row.lei || '').trim().toUpperCase()
  if (!lei) return null
  const year = Number(row.dataYear) || 2025
  const orig = Number(row.orig ?? row.originations) || 0
  const dollarVol = Number(row.dollarVol) || orig * AVG_LOAN_FALLBACK

  const lender = {
    lei,
    legalName: String(row.legalName || row.name || '').trim() || lei,
    nmls: String(row.nmls || row.nmlsNumber || '').trim() || null,
    institutionType: row.type || null,
    website: row.website || null,
    websiteVerified: Boolean(row.websiteVerified),
  }

  const yearFact = {
    lei,
    year,
    originations: orig,
    dollarVolume: BigInt(Math.round(dollarVol)),
    avgLoanAmount: orig > 0 ? Math.round(dollarVol / orig) : null,
    channel: row.channel || null,
    status: row.status || null,
    confidence: Number(row.conf) || null,
    stateCount: Number(row.states) || null,
    productsJson: JSON.stringify(Array.isArray(row.products) ? row.products : []),
    rate: row.rate != null ? Number(row.rate) : null,
    rateSource: row.rateSource || null,
    extraJson: JSON.stringify({
      branches: row.branches ?? null,
      fico: row.fico ?? null,
      ltv: row.ltv ?? null,
      dti: row.dti ?? null,
      hmdaRate: row.hmdaRate ?? null,
      declinations: row.declinations ?? null,
      originationBreakdown: row.originationBreakdown ?? null,
      hmdaInsights: row.hmdaInsights ?? null,
      mergedInsightsFromYear: row.originationBreakdown?.mergedInsightsFromYear ?? null,
      quarterHistory: row.quarterHistory ?? null,
      website: row.website ?? null,
    }),
  }

  const productFacts = []
  const byProduct = row.originationBreakdown?.byProduct
  if (byProduct && typeof byProduct === 'object') {
    for (const [loanType, info] of Object.entries(byProduct)) {
      if (info?.originated == null) continue
      productFacts.push({
        lei,
        year,
        loanType,
        originations: Math.max(0, Math.round(Number(info.originated))),
        dollarVolume: null,
        approximate: Boolean(info.approximate),
      })
    }
  } else {
    const lt = row.hmdaInsights?.loanTypeSummary
    if (lt && typeof lt === 'object') {
      const codeMap = { 1: 'Conventional', 2: 'FHA', 3: 'VA', 4: 'USDA' }
      for (const [code, info] of Object.entries(lt)) {
        const loanType = codeMap[code]
        if (!loanType || info?.originated == null) continue
        productFacts.push({
          lei,
          year,
          loanType,
          originations: Math.max(0, Math.round(Number(info.originated))),
          dollarVolume: null,
          approximate: false,
        })
      }
    }
  }

  const stateFacts = []
  const sb = row.hmdaInsights?.stateBreakdown
  if (Array.isArray(sb)) {
    for (const s of sb) {
      if (!s?.state) continue
      stateFacts.push({
        lei,
        year,
        stateCode: String(s.state).toUpperCase(),
        originations: Math.max(0, Number(s.originated ?? s.units) || 0),
        dollarVolume: s.volume != null ? BigInt(Math.round(Number(s.volume))) : null,
      })
    }
  }

  return { lender, yearFact, productFacts, stateFacts }
}
