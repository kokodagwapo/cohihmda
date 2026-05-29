import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { HmdaNavAuth } from '../saas/HmdaNavAuth.jsx'
import '../hmda-executive-premium.css'
import { DEMO_INCOME_INTELLIGENCE_PAYLOAD, DEMO_PREMIUM_LEI } from './income-intelligence-demo-data.js'
import { listLivePremiumFeatures, PREMIUM_FEATURE_SURFACES } from './premium-entitlements.js'

const IC = { back: '←' }

function fmtShare(v) {
  if (v == null || Number.isNaN(Number(v))) return '—'
  return `${(Number(v) * 100).toFixed(1)}%`
}

function fmtRate(v) {
  if (v == null || Number.isNaN(Number(v))) return '—'
  return `${(Number(v) * 100).toFixed(1)}%`
}

function Section({ id, title, children }) {
  return (
    <section id={id} style={{ marginBottom: 24 }}>
      <h3 className="hmda-heading-2" style={{ fontSize: 15, marginBottom: 10, color: '#0f172a' }}>
        {title}
      </h3>
      {children}
    </section>
  )
}

function DataTable({ rows, columns }) {
  if (!rows?.length) return null
  return (
    <div style={{ overflowX: 'auto', borderRadius: 12, border: '1px solid rgba(15,23,42,0.08)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: 'rgba(15,23,42,0.04)' }}>
            {columns.map((c) => (
              <th key={c.key} style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 700, color: '#475569' }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ borderTop: '1px solid rgba(15,23,42,0.06)' }}>
              {columns.map((c) => (
                <td key={c.key} style={{ padding: '10px 12px', color: '#334155' }}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function MiniTable({ id, title, rows, columns }) {
  if (!rows?.length) return null
  return (
    <Section id={id} title={title}>
      <DataTable rows={rows} columns={columns} />
    </Section>
  )
}

function Stat({ label, value }) {
  return (
    <div style={{ padding: '12px 14px', borderRadius: 12, background: 'rgba(15,23,42,0.04)' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: '#0f172a' }}>{value}</div>
    </div>
  )
}

/**
 * Premium: Income & Market Fit — `/api/premium/hmda/income-intelligence`
 */
export default function IncomeIntelligencePanel() {
  const [lei, setLei] = useState('')
  const [year, setYear] = useState('2025')
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [demoClientOnly, setDemoClientOnly] = useState(false)
  const [showRaw, setShowRaw] = useState(false)
  const [features, setFeatures] = useState(null)
  const [execSummary, setExecSummary] = useState('')
  const [alerts, setAlerts] = useState([])
  const [alertName, setAlertName] = useState('')
  const [watchlists, setWatchlists] = useState([])
  const [actionMsg, setActionMsg] = useState('')

  useEffect(() => {
    if (import.meta.env.VITE_HMDA_AUTH_DEMO !== '1') return
    setDemoClientOnly(true)
    setLei(DEMO_PREMIUM_LEI)
    setYear(String(DEMO_INCOME_INTELLIGENCE_PAYLOAD.year))
    setData(DEMO_INCOME_INTELLIGENCE_PAYLOAD)
    setErr('')
  }, [])

  useEffect(() => {
    fetch('/api/premium/access/features', { credentials: 'include' })
      .then((r) => r.json())
      .then((j) => setFeatures(j.features || {}))
      .catch(() => setFeatures({}))
  }, [])

  useEffect(() => {
    if (demoClientOnly) return
    fetch('/api/premium/auth/me', { credentials: 'include' })
      .then((r) => r.json())
      .then((j) => {
        const orgLei = j?.user?.organization?.lei
        if (orgLei && /^[A-Z0-9]{20}$/.test(String(orgLei).toUpperCase())) {
          setLei(String(orgLei).toUpperCase())
        }
      })
      .catch(() => {})
  }, [demoClientOnly])

  const runFetch = useCallback(async () => {
    const q = lei.trim().toUpperCase()
    if (!/^[A-Z0-9]{20}$/.test(q)) {
      setErr('Enter a valid 20-character LEI.')
      return
    }
    setLoading(true)
    setErr('')
    setActionMsg('')
    try {
      const r = await fetch(
        `/api/premium/hmda/income-intelligence?${new URLSearchParams({ lei: q, year })}`,
        { credentials: 'include' },
      )
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`)
      setData(j)
    } catch (e) {
      setErr(e.message || 'Request failed')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [lei, year])

  const autoLoadOnce = useRef(false)
  useEffect(() => {
    if (demoClientOnly || autoLoadOnce.current || !lei) return
    if (!/^[A-Z0-9]{20}$/.test(lei.trim().toUpperCase())) return
    autoLoadOnce.current = true
    runFetch()
  }, [lei, demoClientOnly, runFetch])

  const exportJson = useCallback(async () => {
    const q = lei.trim().toUpperCase()
    if (!/^[A-Z0-9]{20}$/.test(q)) return
    setActionMsg('Exporting…')
    try {
      const r = await fetch('/api/premium/exports/income-intelligence', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lei: q, year: parseInt(year, 10), format: 'json' }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.error || 'Export failed')
      }
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `income-intelligence-${q}-${year}.json`
      a.click()
      URL.revokeObjectURL(url)
      setActionMsg('JSON export downloaded.')
    } catch (e) {
      setActionMsg(e.message)
    }
  }, [lei, year])

  const runExecutiveSummary = useCallback(async () => {
    const q = lei.trim().toUpperCase()
    if (!/^[A-Z0-9]{20}$/.test(q)) return
    setActionMsg('Generating summary…')
    try {
      const r = await fetch('/api/premium/ai/executive-summary', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lei: q, year: parseInt(year, 10) }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Summary failed')
      setExecSummary(j.summary || '')
      setActionMsg('Executive summary ready.')
    } catch (e) {
      setActionMsg(e.message)
    }
  }, [lei, year])

  const loadAlerts = useCallback(async () => {
    try {
      const r = await fetch('/api/premium/alerts', { credentials: 'include' })
      const j = await r.json().catch(() => ({}))
      if (r.ok) setAlerts(j.items || [])
    } catch {
      /* ignore */
    }
  }, [])

  const createAlert = useCallback(async () => {
    if (!alertName.trim()) return
    try {
      const r = await fetch('/api/premium/alerts', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: alertName,
          metricKey: 'denial_rate_low_ami',
          threshold: { band: '<80%', maxRate: 0.18 },
        }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.error || 'Could not create alert')
      }
      setAlertName('')
      loadAlerts()
      setActionMsg('Alert rule saved.')
    } catch (e) {
      setActionMsg(e.message)
    }
  }, [alertName, loadAlerts])

  const loadWatchlists = useCallback(async () => {
    try {
      const r = await fetch('/api/premium/org/watchlists', { credentials: 'include' })
      const j = await r.json().catch(() => ({}))
      if (r.ok) setWatchlists(j.items || [])
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    if (features?.smartAlerts) loadAlerts()
    if (features?.watchlists) loadWatchlists()
  }, [features, loadAlerts, loadWatchlists])

  const upgradeRequired = data?.upgradeRequired === true
  const bands = Array.isArray(data?.incomeToAmiBands) ? data.incomeToAmiBands : []
  const tracts = Array.isArray(data?.tractIncomePenetration) ? data.tractIncomePenetration : []
  const denials = Array.isArray(data?.denialByIncomeBand) ? data.denialByIncomeBand : []
  const cards = Array.isArray(data?.signalCards) ? data.signalCards : []
  const opportunities = Array.isArray(data?.opportunityRankings) ? data.opportunityRankings : []
  const community = data?.communityReachDashboard
  const peerShare = Array.isArray(data?.peerShareIncomeBand) ? data.peerShareIncomeBand : []
  const stress = data?.incomeStressSignal
  const liveFeatures = listLivePremiumFeatures(features || {})

  return (
    <div className="hmda-premium-exec hmda-route-shell" data-hmda-theme="light" data-hmda-sprinkle="1" style={{ minHeight: '100vh', paddingBottom: 48 }}>
      <header
        className="hmda-ds-hero-toolbar"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '14px 20px',
          borderBottom: '1px solid rgba(15,23,42,0.08)',
          flexWrap: 'wrap',
        }}
      >
        <Link to="/" style={{ textDecoration: 'none', fontWeight: 700, color: '#0f172a' }}>
          {IC.back} HMDA DataBank
        </Link>
        <span style={{ fontWeight: 800, letterSpacing: '-0.02em', color: '#0f172a' }}>Income &amp; Market Fit</span>
        <div style={{ marginLeft: 'auto' }}>
          <HmdaNavAuth dk={false} accent="#6366f1" surface="#fff" border="rgba(15,23,42,0.12)" textMuted="#64748b" isMobile={false} />
        </div>
      </header>

      <div style={{ maxWidth: 1040, margin: '0 auto', padding: '24px 20px 0' }}>
        <h1 className="hmda-heading-1" style={{ fontSize: 'clamp(1.35rem, 3vw, 1.75rem)', marginBottom: 8 }}>
          Income &amp; Market Fit Intelligence
        </h1>
        <p style={{ color: '#64748b', marginBottom: 16, lineHeight: 1.55, maxWidth: 820 }}>
          Compare origination and denial mix against FFIEC-style income context. Data loads from your organization snapshot,
          public ETL cache, or live computation from the HMDA lender panel (
          <code style={{ fontSize: 12 }}>npm run premium:etl:income-fit</code>).
        </p>

        {features && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
            {liveFeatures.map((f) => (
              <span
                key={f.key}
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '4px 10px',
                  borderRadius: 999,
                  background: 'rgba(99,102,241,0.12)',
                  color: '#4338ca',
                }}
              >
                {f.label}
              </span>
            ))}
            {PREMIUM_FEATURE_SURFACES.fhfaOverlay.status === 'phase2' && (
              <span style={{ fontSize: 11, color: '#94a3b8' }}>FHFA overlay: Phase 2</span>
            )}
          </div>
        )}

        {demoClientOnly ? (
          <p style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 12, background: 'rgba(99,102,241,0.12)', color: '#3730a3', fontSize: 13, fontWeight: 600 }}>
            Client demo mode — use <code style={{ fontSize: 12 }}>npm run premium:seed-demo</code> for API-backed snapshots.
          </p>
        ) : null}

        {upgradeRequired ? (
          <div className="hmda-ds-surface" style={{ padding: 16, borderRadius: 14, marginBottom: 20, border: '1px solid rgba(251,191,36,0.45)', background: 'rgba(254,252,232,0.95)' }}>
            <p style={{ fontWeight: 800, color: '#854d0e', marginBottom: 8 }}>Subscription required</p>
            <Link to="/billing" className="hmda-header-cmd hmda-header-cmd--primary" style={{ textDecoration: 'none' }}>
              Open billing
            </Link>
          </div>
        ) : null}

        <div className="hmda-ds-surface" style={{ padding: 16, borderRadius: 16, marginBottom: 20 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, fontWeight: 600 }}>
              LEI
              <input value={lei} onChange={(e) => setLei(e.target.value.toUpperCase())} maxLength={20} className="hmda-saas-input" style={{ minWidth: 240 }} placeholder="20-character LEI" />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, fontWeight: 600 }}>
              Year
              <select value={year} onChange={(e) => setYear(e.target.value)} className="hmda-saas-input">
                {['2025', '2024', '2023', '2022'].map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </label>
            <button type="button" className="hmda-header-cmd hmda-header-cmd--primary" onClick={runFetch} disabled={loading || demoClientOnly}>
              {loading ? 'Loading…' : demoClientOnly ? 'Demo loaded' : 'Load intelligence'}
            </button>
            {data && (
              <button type="button" className="hmda-header-cmd" onClick={exportJson} disabled={demoClientOnly}>
                Export JSON
              </button>
            )}
            {data && features?.aiExecutiveSummary && (
              <button type="button" className="hmda-header-cmd" onClick={runExecutiveSummary} disabled={demoClientOnly}>
                Executive summary
              </button>
            )}
          </div>
          {err ? <p style={{ color: '#b91c1c', marginTop: 12 }}>{err}</p> : null}
          {actionMsg ? <p style={{ color: '#475569', marginTop: 8, fontSize: 13 }}>{actionMsg}</p> : null}
        </div>

        {execSummary ? (
          <div className="hmda-ds-surface" style={{ padding: 16, borderRadius: 14, marginBottom: 20, whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.55, color: '#334155' }}>
            <strong style={{ display: 'block', marginBottom: 8, color: '#0f172a' }}>Executive summary</strong>
            {execSummary}
          </div>
        ) : null}

        {data && (
          <div className="hmda-ds-surface" style={{ padding: 22, borderRadius: 16 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'baseline', marginBottom: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#64748b' }}>LEI</span>
              <code style={{ fontSize: 14 }}>{data.lei}</code>
              {data.lenderName ? <span style={{ fontSize: 14, color: '#334155' }}>{data.lenderName}</span> : null}
              <span style={{ fontSize: 13, fontWeight: 700, color: '#64748b', marginLeft: 12 }}>Year</span>
              <span style={{ fontSize: 14, fontWeight: 700 }}>{data.year}</span>
              {data.dataAsOf ? (
                <span style={{ marginLeft: 'auto', fontSize: 11, color: '#94a3b8' }}>
                  Data as of {new Date(data.dataAsOf).toLocaleDateString()}
                </span>
              ) : null}
            </div>

            <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.55, marginBottom: 8 }}>{data.methodology}</p>
            {Array.isArray(data.sources) && data.sources.length > 0 && (
              <p style={{ fontSize: 11, color: '#94a3b8', marginBottom: 20 }}>Sources: {data.sources.join(' · ')}</p>
            )}

            {cards.length > 0 && (
              <Section title="Executive signal cards">
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {cards.map((c, i) => (
                    <li key={i} style={{ padding: '12px 14px', borderRadius: 12, background: c.severity === 'warning' ? 'rgba(251,191,36,0.15)' : 'rgba(99,102,241,0.1)', marginBottom: 8 }}>
                      <strong style={{ display: 'block', marginBottom: 4 }}>{c.title}</strong>
                      <span style={{ fontSize: 14, color: '#334155' }}>{c.body}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            <MiniTable
              id="ami-bands"
              title="Borrower income vs market (AMI bands)"
              rows={bands}
              columns={[
                { key: 'b', label: 'Band', render: (r) => r.band },
                { key: 'o', label: 'Originated share', render: (r) => fmtShare(r.originatedShare) },
                { key: 'm', label: 'Market / peer share', render: (r) => fmtShare(r.marketShareHint ?? r.peerShareByIncomeBand) },
              ]}
            />

            <MiniTable
              title="Tract income penetration"
              rows={tracts}
              columns={[
                { key: 'c', label: 'Category', render: (r) => r.category },
                { key: 's', label: 'Share', render: (r) => fmtShare(r.share) },
              ]}
            />

            <MiniTable
              title="Income-band denial analysis"
              rows={denials}
              columns={[
                { key: 'b', label: 'Band', render: (r) => r.band },
                { key: 'd', label: 'Denial rate', render: (r) => fmtRate(r.denialRate) },
                { key: 't', label: 'Top reasons', render: (r) => (Array.isArray(r.topReasons) && r.topReasons.length ? r.topReasons.join(', ') : '—') },
              ]}
            />

            {opportunities.length > 0 && (
              <Section id="opportunity" title="Income opportunity map (ranked geographies)">
                <DataTable
                  rows={opportunities}
                  columns={[
                    { key: 'r', label: '#', render: (r) => r.rank },
                    { key: 'g', label: 'Geography', render: (r) => `${r.name}, ${r.state}` },
                    { key: 's', label: 'Lender share', render: (r) => fmtShare(r.lenderShare) },
                    { key: 'f', label: 'Income fit', render: (r) => fmtShare(r.incomeFitScore) },
                    { key: 'o', label: 'Opportunity', render: (r) => (r.opportunityScore != null ? r.opportunityScore.toFixed(2) : '—') },
                    { key: 'd', label: 'Driver', render: (r) => r.driver },
                  ]}
                />
              </Section>
            )}

            {community && (
              <Section id="community-reach" title="Community reach dashboard">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12, marginBottom: 10 }}>
                  <Stat label="Affordable AMI share" value={fmtShare(community.affordableAmiBandShare)} />
                  <Stat label="Low/mod tract share" value={fmtShare(community.lowModerateTractShare)} />
                  <Stat label="States active" value={community.statesActive ?? '—'} />
                </div>
                <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.5 }}>{community.narrative}</p>
              </Section>
            )}

            {peerShare.length > 0 && (
              <Section id="peer-share" title="Peer share by income band">
                <DataTable
                  rows={peerShare}
                  columns={[
                    { key: 'b', label: 'Band', render: (r) => r.band },
                    { key: 'l', label: 'Lender', render: (r) => fmtShare(r.lenderShare) },
                    { key: 'm', label: 'Market', render: (r) => fmtShare(r.marketShare) },
                  ]}
                />
              </Section>
            )}

            {stress && (
              <Section title="Income stress signal">
                <p style={{ fontSize: 14, color: '#334155' }}>
                  <strong>{stress.label}</strong> (score {stress.score}) — overall denial{' '}
                  {fmtRate(stress.inputs?.overallDenialRate)}, low-AMI denial {fmtRate(stress.inputs?.lowAmiBandDenialRate)}.
                </p>
              </Section>
            )}

            {features?.smartAlerts && (
              <Section id="alerts" title="Smart alerts">
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                  <input className="hmda-saas-input" placeholder="Alert name" value={alertName} onChange={(e) => setAlertName(e.target.value)} style={{ minWidth: 200 }} />
                  <button type="button" className="hmda-header-cmd" onClick={createAlert}>Add denial spike rule</button>
                </div>
                {alerts.length > 0 ? (
                  <ul style={{ fontSize: 13, color: '#475569', paddingLeft: 18 }}>
                    {alerts.map((a) => (
                      <li key={a.id}>{a.name} — {a.metricKey}</li>
                    ))}
                  </ul>
                ) : (
                  <p style={{ fontSize: 13, color: '#94a3b8' }}>No alert rules yet.</p>
                )}
              </Section>
            )}

            {features?.watchlists && (
              <Section id="watchlists" title="Watchlists">
                {watchlists.length > 0 ? (
                  <ul style={{ fontSize: 13, paddingLeft: 18 }}>
                    {watchlists.map((w) => (
                      <li key={w.id}>{w.name} ({(w.lenderIds || []).length} lenders)</li>
                    ))}
                  </ul>
                ) : (
                  <p style={{ fontSize: 13, color: '#94a3b8' }}>Create watchlists via POST /api/premium/org/watchlists.</p>
                )}
              </Section>
            )}

            <button type="button" className="hmda-header-cmd" style={{ marginTop: 8 }} onClick={() => setShowRaw((v) => !v)}>
              {showRaw ? 'Hide' : 'Show'} raw JSON
            </button>
            {showRaw ? (
              <pre style={{ marginTop: 12, fontSize: 11, overflow: 'auto', maxHeight: 360, background: '#0f172a08', padding: 12, borderRadius: 10 }}>
                {JSON.stringify(data, null, 2)}
              </pre>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
