import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, ChevronDown, ExternalLink, List, MapPin, Plane, Satellite, X } from 'lucide-react'
import { nmlsConsumerAccessCompanyUrl } from '@hmda/utils/hmdaFfiecLive.js'
import { GEO_DATA_SOURCES } from './geo-hover-detail.js'
import {
  geoKindIcon,
  incomeBracketIcon,
  LENDERS_SECTION_ICON,
  TRACTS_SECTION_ICON,
  primaryMetricIcon,
  statRowIcon,
} from './geo-hover-card-icons.js'
import GeoMapLegendAccordion from './GeoMapLegendAccordion.jsx'

function fmtLenderVol(n) {
  const v = Number(n) || 0
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `$${Math.round(v / 1e3)}K`
  return `$${v.toLocaleString()}`
}

function formatTractLabel(code) {
  const s = String(code || '')
  if (s.length > 8) return `Tract …${s.slice(-7)}`
  return `Tract ${s}`
}

function HoverIconWell({ Icon, tone, size = 'md', className = '' }) {
  return (
    <span
      className={`hmda-geo-hover-card__icon-well hmda-geo-hover-card__icon-well--${tone} hmda-geo-hover-card__icon-well--${size}${className ? ` ${className}` : ''}`}
      aria-hidden
    >
      <Icon size={size === 'lg' ? 16 : size === 'sm' ? 12 : 14} strokeWidth={2.25} />
    </span>
  )
}

function TractLocation({ lng, lat }) {
  if (lng == null || lat == null || !Number.isFinite(lng) || !Number.isFinite(lat)) return null
  const fmt = (v, pos, neg) => `${Math.abs(v).toFixed(4)}° ${v >= 0 ? pos : neg}`
  return (
    <div className="hmda-geo-hover-card__tract-location" aria-label="Tract centroid coordinates">
      <span className="hmda-geo-hover-card__tract-location-flag" aria-hidden>🇺🇸</span>
      <span className="hmda-geo-hover-card__tract-location-coords">
        {fmt(lat, 'N', 'S')}&thinsp;·&thinsp;{fmt(lng, 'E', 'W')}
      </span>
    </div>
  )
}

function GeoEmptyState() {
  return (
    <div className="hmda-geo-hover-card__empty">
      <HoverIconWell Icon={MapPin} tone="slate" size="md" />
      <p className="hmda-geo-hover-card__empty-title">Hover the map</p>
            <p className="hmda-geo-hover-card__empty-hint">Hover or click a state, county, or tract marker</p>
    </div>
  )
}

export default function GeoHoverCard({
  hover,
  liveHover = null,
  legend = null,
  onNavigateToLenders,
  onMouseEnterCard,
  onMouseLeaveCard,
  onClose,
}) {
  const [statsOpen, setStatsOpen] = useState(true)
  const [lendersOpen, setLendersOpen] = useState(false)
  const [tractsOpen, setTractsOpen] = useState(false)
  const [legendOpen, setLegendOpen] = useState(false)
  const active = liveHover || hover

  /** Collapse accordions only when changing state (not county ↔ tract flicker on the same state). */
  const accordionScopeKey = useMemo(() => {
    if (!active) return null
    if (liveHover) return liveHover.featureKey ?? 'live'
    if (active.stateCode) return `st:${active.stateCode}`
    return active.featureKey ?? null
  }, [liveHover, active])

  const accordionScopeRef = useRef(accordionScopeKey)

  useEffect(() => {
    if (accordionScopeKey === accordionScopeRef.current) return
    accordionScopeRef.current = accordionScopeKey
    setStatsOpen(Boolean(active?.lines?.length))
    setLendersOpen(false)
    setTractsOpen(true)
  }, [accordionScopeKey, active?.lines?.length])

  const pinCard = () => onMouseEnterCard?.()

  const stopPropagationOnly = (e) => {
    e.stopPropagation()
  }

  const onCardPointerDown = (e) => {
    e.stopPropagation()
    const interactive = e.target.closest('button, a, input, select, textarea, [role="button"]')
    if (!interactive) e.preventDefault()
  }

  const toggleSection =
    (setter) =>
    (e) => {
      stopPropagationOnly(e)
      pinCard()
      setter((open) => !open)
    }

  const handleClose = (e) => {
    e.preventDefault()
    e.stopPropagation()
    onClose?.(active?.featureKey)
  }

  const handleNavigate = () => {
    if (!hover) return
    onNavigateToLenders?.({
      state: hover.stateCode,
      countyFips: hover.countyFips,
      censusTract: hover.censusTract,
    })
    onClose?.(hover.featureKey)
  }

  const panelLabel = liveHover
    ? `${liveHover.title} live track`
    : hover
      ? `${hover.title} geography details`
      : 'Geography map inspector'

  return (
    <div
      className="hmda-geo-hover-card hmda-geo-hover-card--dock hmda-geo-hover-card--inspector"
      role="region"
      aria-label={panelLabel}
      aria-live="polite"
      onMouseEnter={(e) => {
        e.stopPropagation()
        onMouseEnterCard?.()
      }}
      onMouseLeave={onMouseLeaveCard}
      onPointerDown={onCardPointerDown}
    >
      {liveHover ? (
        <>
          <header className="hmda-geo-hover-card__head">
            {(() => {
              const isSat = liveHover.kind === 'satellite'
              const tone = isSat ? 'cyan' : 'blue'
              const LiveIcon = isSat ? Satellite : Plane
              return <HoverIconWell Icon={LiveIcon} tone={tone} size="lg" />
            })()}
            <div className="hmda-geo-hover-card__title-block">
              <span
                className={`hmda-geo-hover-card__badge hmda-geo-hover-card__badge--${liveHover.kind === 'satellite' ? 'satellite' : 'aircraft'}`}
              >
                {liveHover.geoLevelLabel}
              </span>
              <h3 className="hmda-geo-hover-card__title">{liveHover.title}</h3>
              {liveHover.subtitle ? <p className="hmda-geo-hover-card__subtitle">{liveHover.subtitle}</p> : null}
            </div>
            <button
              type="button"
              className="hmda-geo-hover-card__close"
              onClick={handleClose}
              onMouseDown={(e) => e.stopPropagation()}
              aria-label="Close live track details"
              title="Close"
            >
              <X size={15} strokeWidth={2.25} aria-hidden />
            </button>
          </header>
          <div className="hmda-geo-hover-card__scroll">
            <div className="hmda-geo-hover-card__hero">
              {(() => {
                const isSat = liveHover.kind === 'satellite'
                const LiveIcon = isSat ? Satellite : Plane
                return <HoverIconWell Icon={LiveIcon} tone={isSat ? 'cyan' : 'blue'} size="md" />
              })()}
              <div className="hmda-geo-hover-card__hero-body">
                <span className="hmda-geo-hover-card__hero-label">{liveHover.primaryLabel}</span>
                <span className="hmda-geo-hover-card__hero-value">{liveHover.primaryValue}</span>
              </div>
            </div>
            {liveHover.lines?.length ? (
              <dl className="hmda-geo-hover-card__stats">
                {liveHover.lines.map((row) => {
                  const rowMeta = statRowIcon(row.rowKey)
                  const RowIcon = rowMeta.Icon
                  return (
                    <div key={row.rowKey || row.k} className="hmda-geo-hover-card__stat">
                      <HoverIconWell Icon={RowIcon} tone={rowMeta.tone} size="sm" />
                      <div className="hmda-geo-hover-card__stat-body">
                        <dt className="hmda-geo-hover-card__stat-label">{row.k}</dt>
                        <dd className="hmda-geo-hover-card__stat-values">
                          <span className="hmda-geo-hover-card__stat-v">{row.v}</span>
                        </dd>
                      </div>
                    </div>
                  )
                })}
              </dl>
            ) : null}
            {liveHover.modelNote ? <p className="hmda-geo-hover-card__footnote">{liveHover.modelNote}</p> : null}
          </div>
        </>
      ) : hover ? (
        <>
          <header className="hmda-geo-hover-card__head">
            {(() => {
              const kindMeta = geoKindIcon(hover.kind)
              return <HoverIconWell Icon={kindMeta.Icon} tone={kindMeta.tone} size="lg" />
            })()}
            <div className="hmda-geo-hover-card__title-block">
              <div className="hmda-geo-hover-card__badges">
                {hover.lenderFocusName ? (
                  <span className="hmda-geo-hover-card__badge hmda-geo-hover-card__badge--lender-focus">
                    Lender map
                  </span>
                ) : null}
                <span className={`hmda-geo-hover-card__badge hmda-geo-hover-card__badge--${hover.kind}`}>
                  {hover.geoLevelLabel}
                </span>
              </div>
              <h3 className="hmda-geo-hover-card__title">{hover.title}</h3>
              {hover.subtitle ? <p className="hmda-geo-hover-card__subtitle">{hover.subtitle}</p> : null}
            </div>
            <button
              type="button"
              className="hmda-geo-hover-card__close"
              onClick={handleClose}
              onMouseDown={(e) => e.stopPropagation()}
              aria-label="Close geography details"
              title="Close"
            >
              <X size={15} strokeWidth={2.25} aria-hidden />
            </button>
          </header>
          <div className="hmda-geo-hover-card__scroll">
            {hover.kind === 'tract' ? (
              <TractLocation lng={hover.tractLng} lat={hover.tractLat} />
            ) : null}

            {hover.incomeBracket ? (
              <div
                className={`hmda-geo-hover-card__income hmda-geo-hover-card__income--${hover.incomeBracket.tone || 'slate'}`}
              >
                {(() => {
                  const incMeta = incomeBracketIcon(hover.incomeBracket.tone || 'slate')
                  return <HoverIconWell Icon={incMeta.Icon} tone={incMeta.tone} size="sm" />
                })()}
                <div className="hmda-geo-hover-card__income-body">
                  <span className="hmda-geo-hover-card__income-label">{hover.incomeBracket.band}</span>
                  {hover.incomeBracket.detail ? (
                    <span className="hmda-geo-hover-card__income-detail">{hover.incomeBracket.detail}</span>
                  ) : null}
                </div>
              </div>
            ) : null}

            {(() => {
              const heroMeta = primaryMetricIcon(hover.primaryMetricId)
              return (
                <div className="hmda-geo-hover-card__hero">
                  <HoverIconWell Icon={heroMeta.Icon} tone={heroMeta.tone} size="md" />
                  <div className="hmda-geo-hover-card__hero-body">
                    <span className="hmda-geo-hover-card__hero-label">{hover.primaryLabel}</span>
                    <span className="hmda-geo-hover-card__hero-value">{hover.primaryValue}</span>
                    {hover.lenderInsightsLoading ? (
                      <span className="hmda-geo-hover-card__hero-lender" style={{ opacity: 0.7 }}>
                        Loading state breakdown…
                      </span>
                    ) : hover.lenderTractNote ? (
                      <span className="hmda-geo-hover-card__hero-lender">{hover.lenderTractNote}</span>
                    ) : null}
                  </div>
                </div>
              )
            })()}

            {hover.topCensusTracts?.length ? (
              <section className="hmda-geo-hover-card__tracts">
                <button
                  type="button"
                  className="hmda-geo-hover-card__lenders-toggle"
                  aria-expanded={tractsOpen}
                  onMouseDown={stopPropagationOnly}
                  onClick={toggleSection(setTractsOpen)}
                >
                  <HoverIconWell Icon={TRACTS_SECTION_ICON.Icon} tone={TRACTS_SECTION_ICON.tone} size="sm" />
                  <span className="hmda-geo-hover-card__lenders-toggle-text">
                    <span className="hmda-geo-hover-card__lenders-toggle-label">
                      Top {hover.topCensusTracts.length} census tracts
                    </span>
                    <span className="hmda-geo-hover-card__lenders-toggle-hint">
                      {hover.kind === 'county' ? 'By originated loan count in county' : 'Statewide HMDA drilldown'}
                    </span>
                  </span>
                  <ChevronDown
                    size={16}
                    strokeWidth={2.25}
                    className={`hmda-geo-hover-card__lenders-chevron${tractsOpen ? ' is-open' : ''}`}
                    aria-hidden
                  />
                </button>

                {tractsOpen ? (
                  <ol className="hmda-geo-hover-card__tract-list">
                    {hover.topCensusTracts.map((t, idx) => (
                      <li key={`${t.countyFips}-${t.censusTract}`}>
                        <span className="hmda-geo-hover-card__lender-rank">{idx + 1}</span>
                        <div className="hmda-geo-hover-card__lender-main">
                          <span className="hmda-geo-hover-card__lender-name">{formatTractLabel(t.censusTract)}</span>
                          <span className="hmda-geo-hover-card__lender-meta">
                            {t.countyName}
                            {hover.kind === 'state' ? ` · ${t.countyFips?.slice(-3) || ''}` : ''}
                            {' · '}
                            {t.units.toLocaleString()} loans · {fmtLenderVol(t.volume)}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : null}
              </section>
            ) : null}

            {hover.lines?.length ? (
              <section className="hmda-geo-hover-card__tracts">
                <button
                  type="button"
                  className="hmda-geo-hover-card__lenders-toggle"
                  aria-expanded={statsOpen}
                  onMouseDown={stopPropagationOnly}
                  onClick={toggleSection(setStatsOpen)}
                >
                  <HoverIconWell Icon={List} tone="sky" size="sm" />
                  <span className="hmda-geo-hover-card__lenders-toggle-text">
                    <span className="hmda-geo-hover-card__lenders-toggle-label">Area metrics</span>
                    <span className="hmda-geo-hover-card__lenders-toggle-hint">
                      {hover.lines.length} data points
                    </span>
                  </span>
                  <ChevronDown
                    size={16}
                    strokeWidth={2.25}
                    className={`hmda-geo-hover-card__lenders-chevron${statsOpen ? ' is-open' : ''}`}
                    aria-hidden
                  />
                </button>
                {statsOpen ? (
                  <dl className="hmda-geo-hover-card__stats">
                    {hover.lines.map((row) => {
                      const rowMeta = statRowIcon(row.rowKey)
                      const RowIcon = rowMeta.Icon
                      return (
                        <div key={row.rowKey || row.k} className="hmda-geo-hover-card__stat">
                          <HoverIconWell Icon={RowIcon} tone={rowMeta.tone} size="sm" />
                          <div className="hmda-geo-hover-card__stat-body">
                            <dt className="hmda-geo-hover-card__stat-label">{row.k}</dt>
                            <dd className="hmda-geo-hover-card__stat-values">
                              <span className="hmda-geo-hover-card__stat-v">{row.v}</span>
                              {row.source ? <span className="hmda-geo-hover-card__stat-src">{row.source}</span> : null}
                            </dd>
                          </div>
                        </div>
                      )
                    })}
                  </dl>
                ) : null}
              </section>
            ) : null}

            {hover.tractAttribution ? (
              <p className="hmda-geo-hover-card__tract-note">{hover.tractAttribution}</p>
            ) : null}

            {hover.topLenders?.length ? (
              <section className="hmda-geo-hover-card__lenders">
                <button
                  type="button"
                  className="hmda-geo-hover-card__lenders-toggle"
                  aria-expanded={lendersOpen}
                  onMouseDown={stopPropagationOnly}
                  onClick={toggleSection(setLendersOpen)}
                >
                  <HoverIconWell Icon={LENDERS_SECTION_ICON.Icon} tone={LENDERS_SECTION_ICON.tone} size="sm" />
                  <span className="hmda-geo-hover-card__lenders-toggle-text">
                    <span className="hmda-geo-hover-card__lenders-toggle-label">
                      Top {hover.topLenders.length} lenders
                    </span>
                    <span className="hmda-geo-hover-card__lenders-toggle-hint">HMDA originated share</span>
                  </span>
                  <ChevronDown
                    size={16}
                    strokeWidth={2.25}
                    className={`hmda-geo-hover-card__lenders-chevron${lendersOpen ? ' is-open' : ''}`}
                    aria-hidden
                  />
                </button>

                {lendersOpen ? (
                  <>
                    <ol className="hmda-geo-hover-card__lender-list">
                      {hover.topLenders.map((l) => {
                        const nmlsUrl = l.nmls ? nmlsConsumerAccessCompanyUrl(l.nmls) : null
                        return (
                          <li key={`${l.id}-${l.rank}`}>
                            <span className="hmda-geo-hover-card__lender-rank">{l.rank}</span>
                            <div className="hmda-geo-hover-card__lender-main">
                              {nmlsUrl ? (
                                <a
                                  href={nmlsUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="hmda-geo-hover-card__lender-name"
                                >
                                  {l.name}
                                </a>
                              ) : (
                                <span className="hmda-geo-hover-card__lender-name">{l.name}</span>
                              )}
                              <span className="hmda-geo-hover-card__lender-meta">
                                {l.sharePct}% · {l.units.toLocaleString()} loans · {fmtLenderVol(l.volume)}
                                {l.estimated ? ' · est.' : ''}
                              </span>
                            </div>
                          </li>
                        )
                      })}
                    </ol>
                    <button type="button" className="hmda-geo-hover-card__nav-btn" onClick={handleNavigate}>
                      {hover.navigateLabel}
                      <ArrowRight size={14} aria-hidden />
                    </button>
                  </>
                ) : null}
              </section>
            ) : null}

            <footer className="hmda-geo-hover-card__sources">
              <div className="hmda-geo-hover-card__source-links">
                {GEO_DATA_SOURCES.map((s) => (
                  <a key={s.id} href={s.href} target="_blank" rel="noopener noreferrer" title={s.note}>
                    {s.label}
                    <ExternalLink size={10} aria-hidden />
                  </a>
                ))}
              </div>
              {hover.modelNote ? <p className="hmda-geo-hover-card__footnote">{hover.modelNote}</p> : null}
            </footer>
          </div>
        </>
      ) : (
        <>
          <header className="hmda-geo-hover-card__head hmda-geo-hover-card__head--empty">
            <HoverIconWell Icon={MapPin} tone="slate" size="lg" />
            <div className="hmda-geo-hover-card__title-block">
              <h3 className="hmda-geo-hover-card__title">Map inspector</h3>
              <p className="hmda-geo-hover-card__subtitle">Hover a state, county, or tract</p>
            </div>
            <button
              type="button"
              className="hmda-geo-hover-card__close"
              onClick={handleClose}
              onMouseDown={(e) => e.stopPropagation()}
              aria-label="Close map inspector"
              title="Close"
            >
              <X size={15} strokeWidth={2.25} aria-hidden />
            </button>
          </header>
          <div className="hmda-geo-hover-card__scroll hmda-geo-hover-card__scroll--empty">
            <GeoEmptyState />
          </div>
        </>
      )}

      {legend ? (
        <GeoMapLegendAccordion
          metric={legend.metric}
          min={legend.min}
          max={legend.max}
          year={legend.year}
          mapSelectedState={legend.mapSelectedState}
          open={legendOpen}
          onToggle={() => setLegendOpen((o) => !o)}
        />
      ) : null}
    </div>
  )
}
