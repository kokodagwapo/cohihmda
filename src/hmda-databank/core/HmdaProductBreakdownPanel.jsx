import { buildLoanPurposeUnits } from './productHmdaMetrics.js'

function fmtPct(num, den) {
  if (!den || den <= 0 || num == null) return '—'
  return `${((100 * num) / den).toFixed(1)}%`
}

function fmtDollarCompact(n) {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`
  return `$${Math.round(n).toLocaleString()}`
}

function OutcomeBar({ label, count, total, color, c }) {
  const pct = total > 0 ? (100 * count) / total : 0
  return (
    <div className="hmda-product-outcome">
      <div className="hmda-product-outcome__head">
        <span className="hmda-product-outcome__label">{label}</span>
        <span className="hmda-product-outcome__value" style={{ color: c.text2 }}>
          {count.toLocaleString()}
          <span className="hmda-product-outcome__pct">{fmtPct(count, total)}</span>
        </span>
      </div>
      <div className="hmda-product-outcome__track">
        <div className="hmda-product-outcome__fill" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
      </div>
    </div>
  )
}

export default function HmdaProductBreakdownPanel({ metrics, productName, accent, c, dk, compact = false }) {
  if (!metrics) return null

  const totalApps = metrics.applications || 0
  const hasOutcomes = totalApps > 0
  const purposeRows =
    metrics.loanPurposes?.length > 0
      ? metrics.loanPurposes
      : metrics.purposeUnitsTotal > 0
        ? buildLoanPurposeUnits(productName, metrics.purposeUnitsTotal)
        : []

  return (
    <div className={`hmda-product-breakdown${compact ? ' hmda-product-breakdown--compact' : ''}`}>
      <div className="hmda-product-breakdown__section">
        <div className="hmda-product-breakdown__title">Loan type</div>
        {metrics.loanTypeLabel ? (
          <div className="hmda-product-breakdown__pill-row">
            <span className="hmda-product-breakdown__pill" style={{ borderColor: `${accent}44`, color: accent, background: `${accent}12` }}>
              HMDA {metrics.loanTypeCode} · {metrics.loanTypeLabel}
            </span>
          </div>
        ) : (
          <div className="hmda-product-breakdown__muted">Derived tag — not a single HMDA loan_type bucket</div>
        )}
      </div>

      <div className="hmda-product-breakdown__section hmda-product-breakdown__section--origination">
        {purposeRows.length > 0 ? (
          <>
            <div className="hmda-product-breakdown__title">Loan purpose</div>
            <div className="hmda-product-breakdown__pill-row">
              {purposeRows.map((p) => (
                <span key={p.label} className="hmda-product-breakdown__pill hmda-product-breakdown__pill--neutral">
                  <span className="hmda-product-breakdown__pill-label">{p.label}</span>
                  <span className="hmda-product-breakdown__pill-units">{p.units.toLocaleString()}</span>
                </span>
              ))}
            </div>
            <div className="hmda-product-breakdown__note">
              Originated units by HMDA loan_purpose mix for {productName}
              {metrics.purposeUnitsTotal ? ` (${metrics.purposeUnitsTotal.toLocaleString()} total)` : ''}
              {metrics.purposeFromPanelOrig
                ? ' — estimated from panel origination counts and national purpose shares.'
                : ' — allocated from loan_type originated totals and national purpose shares.'}
            </div>
          </>
        ) : metrics.typicalPurposes?.length > 0 ? (
          <>
            <div className="hmda-product-breakdown__title">Loan purpose</div>
            <div className="hmda-product-breakdown__muted">No originated unit total yet — purpose breakdown appears when loan_type units load.</div>
          </>
        ) : null}

        {hasOutcomes ? (
          <div className="hmda-product-breakdown__subsection">
            <div className="hmda-product-breakdown__subtitle">HMDA disposition & pull-through</div>
            <div className="hmda-product-breakdown__outcomes">
              <OutcomeBar label="Originated" count={metrics.originated} total={totalApps} color={c.success || '#059669'} c={c} />
              <OutcomeBar label="Denied" count={metrics.denied} total={totalApps} color={c.danger || '#dc2626'} c={c} />
              <OutcomeBar label="Withdrawn" count={metrics.withdrawn} total={totalApps} color="#f59e0b" c={c} />
              <OutcomeBar label="Incomplete" count={metrics.incomplete} total={totalApps} color={dk ? '#94a3b8' : '#64748b'} c={c} />
            </div>
            <div className="hmda-product-breakdown__pullthrough" style={{ borderColor: `${accent}33`, background: `${accent}10` }}>
              <span className="hmda-product-breakdown__pullthrough-label">Pull-through (origination share)</span>
              <strong style={{ color: accent }}>{metrics.pullthrough != null ? fmtPct(metrics.originated, totalApps) : '—'}</strong>
            </div>
            {metrics.dispositionEstimated ? (
              <div className="hmda-product-breakdown__note">
                Disposition counts estimated from panel LAR rates
                {metrics.dispositionYear ? ` (HMDA ${metrics.dispositionYear})` : ''}
                {metrics.approximate ? ` and ${productName} origination volume.` : '.'}
              </div>
            ) : metrics.approximate ? (
              <div className="hmda-product-breakdown__note">Disposition allocated by product share within each lender (approx. for {productName}).</div>
            ) : null}
          </div>
        ) : purposeRows.length > 0 ? (
          <div className="hmda-product-breakdown__subsection">
            <div className="hmda-product-breakdown__subtitle">HMDA disposition & pull-through</div>
            <div className="hmda-product-breakdown__muted">No FFIEC LAR application mix yet for this product in {productName} lenders.</div>
          </div>
        ) : null}
      </div>

      <div className="hmda-product-breakdown__section">
        <div className="hmda-product-breakdown__title">Demographics & income</div>
        <div className="hmda-product-breakdown__stat-grid">
          <div className="hmda-product-breakdown__stat">
            <span className="hmda-product-breakdown__stat-label">Median spread</span>
            <strong>
              {metrics.medianSpread != null
                ? `${metrics.medianSpread >= 0 ? '+' : ''}${metrics.medianSpread.toFixed(2)}%`
                : '—'}
            </strong>
          </div>
          <div className="hmda-product-breakdown__stat">
            <span className="hmda-product-breakdown__stat-label">Median DTI</span>
            <strong>{metrics.medianDti != null ? `${metrics.medianDti}%` : '—'}</strong>
          </div>
          <div className="hmda-product-breakdown__stat">
            <span className="hmda-product-breakdown__stat-label">Median CLTV</span>
            <strong>{metrics.medianCltv != null ? `${metrics.medianCltv}%` : '—'}</strong>
          </div>
          <div className="hmda-product-breakdown__stat">
            <span className="hmda-product-breakdown__stat-label">Median income</span>
            <strong>{metrics.medianIncome != null ? fmtDollarCompact(metrics.medianIncome) : '—'}</strong>
          </div>
        </div>
        <div className="hmda-product-breakdown__note">
          Weighted by product origination share across lenders with FFIEC LAR data. Spread / DTI / CLTV from originated loans (action_taken = 1).
          {metrics.benchmarksUsed ? ' Values blend lender LAR medians with product-level HMDA benchmarks when direct LAR fields are unavailable.' : ''}
          {metrics.incomeIsProxy && !metrics.benchmarksUsed ? ' Income uses ACS state medians weighted by origination geography.' : ''}
        </div>
      </div>
    </div>
  )
}
