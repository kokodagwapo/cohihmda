const AVG_LOAN = 350000

function inferInstitutionType(name, type) {
  const t = String(type || '').trim()
  if (t) return t
  const n = String(name || '').toLowerCase()
  if (n.includes('credit union')) return 'Credit Union'
  if (n.includes('bank')) return 'Bank'
  return 'IMB'
}

function inferChannel(name) {
  const n = String(name || '').toLowerCase()
  if (n.includes('wholesale') || n.includes(' correspondent')) return 'wholesale'
  if (n.includes('correspondent')) return 'correspondent'
  return 'retail'
}

function sortValue(row, field) {
  if (field === 'dollarVol') {
    return Number(row.dollarVol ?? row.orig * AVG_LOAN) || 0
  }
  if (field === 'originations' || field === 'units') return Number(row.orig) || 0
  if (field === 'name') return String(row.name || '').toLowerCase()
  if (field === 'states') return Number(row.states) || 0
  if (field === 'confidence') return Number(row.conf) || 0
  return Number(row[field]) || 0
}

export function filterLenderRows(rows, filters = {}) {
  let r = rows
  const q = String(filters.q || '').trim().toLowerCase()
  if (q) {
    r = r.filter((l) => {
      const products = Array.isArray(l.products) ? l.products : []
      return (
        String(l.name || '').toLowerCase().includes(q) ||
        String(l.nmls || '').includes(q) ||
        String(l.lei || '').toLowerCase().includes(q) ||
        String(l.type || '').toLowerCase().includes(q) ||
        String(l.channel || inferChannel(l.name)).toLowerCase().includes(q) ||
        products.some((p) => String(p).toLowerCase().includes(q))
      )
    })
  }
  if (filters.typeF && filters.typeF !== 'all') {
    r = r.filter((l) => inferInstitutionType(l.name, l.type) === filters.typeF)
  }
  if (filters.statusF && filters.statusF !== 'all') {
    r = r.filter((l) => {
      const conf = Number(l.conf) || 0
      const status = conf >= 90 ? 'verified' : conf >= 75 ? 'partial' : 'pending'
      return status === filters.statusF
    })
  }
  if (filters.channelF && filters.channelF !== 'all') {
    r = r.filter((l) => inferChannel(l.name) === filters.channelF)
  }
  if (filters.prodF && filters.prodF !== 'all') {
    r = r.filter((l) => Array.isArray(l.products) && l.products.includes(filters.prodF))
  }
  return r
}

export function sortLenderRows(rows, sortField = 'dollarVol', sortDir = 'desc') {
  const asc = sortDir === 'asc'
  return [...rows].sort((a, b) => {
    const av = sortValue(a, sortField)
    const bv = sortValue(b, sortField)
    if (typeof av === 'string') {
      if (av < bv) return asc ? -1 : 1
      if (av > bv) return asc ? 1 : -1
      return 0
    }
    if (av < bv) return asc ? -1 : 1
    if (av > bv) return asc ? 1 : -1
    return 0
  })
}

export function paginateRows(rows, page = 0, pageSize = 20) {
  const p = Math.max(0, Number(page) || 0)
  const size = Math.max(1, Math.min(100, Number(pageSize) || 20))
  const start = p * size
  return {
    page: p,
    pageSize: size,
    total: rows.length,
    totalPages: Math.max(1, Math.ceil(rows.length / size)),
    lenders: rows.slice(start, start + size),
  }
}

export function queryLenderRows(allRows, params = {}) {
  const filtered = filterLenderRows(allRows, params)
  const sorted = sortLenderRows(filtered, params.sort || 'dollarVol', params.dir || 'desc')
  return paginateRows(sorted, params.page, params.pageSize)
}

export function suggestLenderRows(allRows, q, limit = 8) {
  const term = String(q || '').trim().toLowerCase()
  if (term.length < 2) return []
  const matches = filterLenderRows(allRows, { q: term })
  const sorted = sortLenderRows(matches, 'dollarVol', 'desc')
  return sorted.slice(0, Math.max(1, Math.min(20, Number(limit) || 8)))
}
