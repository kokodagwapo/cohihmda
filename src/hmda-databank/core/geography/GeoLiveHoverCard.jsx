import { Plane, Satellite, X } from 'lucide-react'

export default function GeoLiveHoverCard({
  hover,
  onMouseEnterCard,
  onMouseLeaveCard,
  onClose,
}) {
  if (!hover) return null

  const isSat = hover.kind === 'satellite'
  const Icon = isSat ? Satellite : Plane

  const handleClose = (e) => {
    e.preventDefault()
    e.stopPropagation()
    onClose?.(hover.featureKey)
  }

  return (
    <div
      className="hmda-geo-hover-card hmda-geo-hover-card--dock hmda-geo-hover-card--live"
      role="region"
      aria-label={`${hover.title} live track`}
      aria-live="polite"
      onMouseEnter={(e) => {
        e.stopPropagation()
        onMouseEnterCard?.()
      }}
      onMouseLeave={onMouseLeaveCard}
    >
      <header className="hmda-geo-hover-card__head">
        <div className="hmda-geo-hover-card__title-block">
          <span className={`hmda-geo-hover-card__badge hmda-geo-hover-card__badge--${isSat ? 'satellite' : 'aircraft'}`}>
            {hover.geoLevelLabel}
          </span>
          <h3 className="hmda-geo-hover-card__title">{hover.title}</h3>
          {hover.subtitle ? <p className="hmda-geo-hover-card__subtitle">{hover.subtitle}</p> : null}
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
        <div className="hmda-geo-hover-card__hero hmda-geo-hover-card__hero--live">
          <span className="hmda-geo-hover-card__live-icon" aria-hidden>
            <Icon size={17} strokeWidth={2} />
          </span>
          <div>
            <span className="hmda-geo-hover-card__hero-label">{hover.primaryLabel}</span>
            <span className="hmda-geo-hover-card__hero-value">{hover.primaryValue}</span>
          </div>
        </div>

        {hover.lines?.length ? (
          <dl className="hmda-geo-hover-card__stats">
            {hover.lines.map((row) => (
              <div key={row.rowKey || row.k} className="hmda-geo-hover-card__stat">
                <dt>{row.k}</dt>
                <dd>
                  <span className="hmda-geo-hover-card__stat-v">{row.v}</span>
                </dd>
              </div>
            ))}
          </dl>
        ) : null}

        {hover.modelNote ? <p className="hmda-geo-hover-card__footnote">{hover.modelNote}</p> : null}
      </div>
    </div>
  )
}
