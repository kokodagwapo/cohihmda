/** Demo session helper — Coheus bridge does not use SaaS demo auth. */
export function buildDemoSessionUser(partial = {}) {
  const email = String(partial.email || 'demo.analyst@local.coheus.test').trim().toLowerCase()
  return {
    email,
    firstName: 'Demo',
    lastName: 'Analyst',
    authProvider: 'demo',
    ...partial,
  }
}
