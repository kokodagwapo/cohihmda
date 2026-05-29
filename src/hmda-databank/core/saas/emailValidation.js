/** Personal / consumer domains — not exhaustive; extend server-side for enforcement. */
export const PERSONAL_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'icloud.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'mail.com',
  'gmx.com',
  'live.com',
  'msn.com',
])

export function domainFromEmail(email) {
  const s = String(email || '')
    .trim()
    .toLowerCase()
  const at = s.lastIndexOf('@')
  if (at === -1 || at === s.length - 1) return ''
  return s.slice(at + 1).trim()
}

export function isPersonalEmailDomain(email) {
  const d = domainFromEmail(email)
  return d ? PERSONAL_EMAIL_DOMAINS.has(d) : false
}

export function isLikelyWorkEmail(email) {
  const s = String(email || '').trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return false
  return !isPersonalEmailDomain(s)
}
