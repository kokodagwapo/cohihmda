import { PRODUCT_DIMENSION_COLUMNS } from './hmdaProductDimensionTables.js'

export default function HmdaDimensionDrillMetricsTable({ categoryLabel, row, className = '' }) {
  if (!row) return null

  return (
    <div
      className={`hmda-dimension-drill-metrics ${className}`.trim()}
      style={{
        gridTemplateColumns: `minmax(120px, 1.2fr) repeat(${PRODUCT_DIMENSION_COLUMNS.length}, minmax(72px, 1fr))`,
        '--hmda-pdim-row-cols': `minmax(120px, 1.2fr) repeat(${PRODUCT_DIMENSION_COLUMNS.length}, minmax(72px, 1fr))`,
      }}
    >
      <div className="hmda-dimension-drill-metrics__head" aria-hidden="true">
        <span className="hmda-product-dimension-table__head-cell hmda-product-dimension-table__head-cell--category">
          Category
        </span>
        {PRODUCT_DIMENSION_COLUMNS.map((col) => (
          <span key={col.key} className="hmda-product-dimension-table__head-cell">
            {col.label}
          </span>
        ))}
      </div>
      <div className="hmda-dimension-drill-metrics__row">
        <span className="hmda-product-dimension-table__category">{categoryLabel}</span>
        {PRODUCT_DIMENSION_COLUMNS.map((col) => (
          <span key={col.key} className="hmda-product-dimension-metric">
            <span className="hmda-product-dimension-metric__value hmda-mono">{row[col.key]}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
