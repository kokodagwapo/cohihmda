import HmdaDimensionDrillMetricsTable from './HmdaDimensionDrillMetricsTable.jsx'

export default function HmdaProductDimensionDrillModal({
  drill,
  tableTitle,
  onClose,
  onViewLenders,
  onViewMap,
  closeIcon,
}) {
  if (!drill?.row) return null

  const { row, config } = drill

  return (
    <div
      className="overlay-enter hmda-modal-overlay hmda-modal-dimension-drill"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="hmda-product-dimension-drill-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="hmda-dimension-drill-title"
      >
        <header className="hmda-product-dimension-drill-modal__header">
          <div>
            <div className="hmda-product-dimension-drill-modal__eyebrow">{tableTitle}</div>
            <h2 id="hmda-dimension-drill-title" className="hmda-product-dimension-drill-modal__title hmda-heading-2">
              {config.title}
            </h2>
            <p className="hmda-product-dimension-drill-modal__subtitle">{config.subtitle}</p>
          </div>
          <button
            type="button"
            className="hmda-product-dimension-drill-modal__close"
            onClick={onClose}
            aria-label="Close"
          >
            {closeIcon}
          </button>
        </header>

        <div className="hmda-product-dimension-drill-modal__body">
          <HmdaDimensionDrillMetricsTable categoryLabel={config.title} row={row} />
        </div>

        {(config.lenderDrill || config.mapDrill) && (
          <div className="hmda-product-dimension-drill-modal__actions">
            {config.lenderDrill ? (
              <button type="button" className="hmda-dimension-drill-action-link" onClick={onViewLenders}>
                View lenders
              </button>
            ) : null}
            {config.mapDrill ? (
              <button type="button" className="hmda-dimension-drill-action-link hmda-dimension-drill-action-link--primary" onClick={onViewMap}>
                View on geography map
                <span aria-hidden="true">→</span>
              </button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
