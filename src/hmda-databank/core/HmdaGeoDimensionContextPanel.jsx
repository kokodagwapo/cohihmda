import HmdaDimensionDrillMetricsTable from './HmdaDimensionDrillMetricsTable.jsx'

export default function HmdaGeoDimensionContextPanel({ context, onClear }) {
  if (!context) return null

  const metricsRow = context.metrics
    ? {
        unitsFmt: context.metrics.unitsFmt,
        volumeFmt: context.metrics.volumeFmt,
        rateFmt: context.metrics.rateFmt,
        pullthroughFmt: context.metrics.pullthroughFmt,
        cltvFmt: context.metrics.cltvFmt,
      }
    : null

  return (
    <section className="hmda-geo-dimension-context-panel" role="status" aria-live="polite">
      <header className="hmda-geo-dimension-context-panel__header">
        <div>
          <div className="hmda-product-dimension-drill-modal__eyebrow">{context.tableTitle}</div>
          <h3 className="hmda-geo-dimension-context-panel__title hmda-heading-2">{context.rowLabel}</h3>
          {context.subtitle ? (
            <p className="hmda-product-dimension-drill-modal__subtitle">{context.subtitle}</p>
          ) : null}
        </div>
        <button type="button" className="hmda-geo-dimension-context-panel__clear" onClick={onClear}>
          Clear
        </button>
      </header>

      {metricsRow ? (
        <div className="hmda-geo-dimension-context-panel__body">
          <HmdaDimensionDrillMetricsTable categoryLabel={context.rowLabel} row={metricsRow} />
        </div>
      ) : null}
    </section>
  )
}
