import { useEffect, useMemo, useState } from 'react'
import {
  buildProductDimensionTables,
  PRODUCT_DIMENSION_COLUMNS,
} from './hmdaProductDimensionTables.js'
import { fetchProductDimensions } from '@hmda/services/hmdaApi.js'

export default function HmdaProductDimensionTables({
  productDistribution,
  lenders,
  panelYear,
  isMobile = false,
  onRowDrill,
  lenderContext = null,
  onClearLenderContext,
}) {
  const [warehouseDimensions, setWarehouseDimensions] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetchProductDimensions({ year: panelYear })
      .then((res) => {
        if (!cancelled && res?.dimensions) setWarehouseDimensions(res.dimensions)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [panelYear])

  const model = useMemo(
    () =>
      buildProductDimensionTables({
        productDistribution,
        lenders,
        panelYear,
        warehouseDimensions,
      }),
    [productDistribution, lenders, panelYear, warehouseDimensions],
  )

  const fmtUnitsShort = (n) => {
    if (!n || !Number.isFinite(n)) return '—'
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
    return String(Math.round(n))
  }

  return (
    <div className="hmda-product-dimension-wrap">
      {/* Lender context banner */}
      {lenderContext && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: '10px', padding: '10px 14px', borderRadius: '12px', marginBottom: '16px',
          background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.18)',
          animation: 'rise 0.3s ease',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
            <div style={{
              width: '30px', height: '30px', borderRadius: '8px', flexShrink: 0,
              background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.22)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#4F46E5', fontSize: '11px', fontWeight: 800,
            }}>
              {lenderContext.name?.slice(0, 2) || '??'}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {lenderContext.name}
              </div>
              <div style={{ fontSize: '10px', color: '#64748b', fontWeight: 500, letterSpacing: '0.04em' }}>
                {lenderContext.originations ? `${fmtUnitsShort(lenderContext.originations)} originated · ` : ''}HMDA {panelYear} · lender view
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClearLenderContext}
            style={{
              border: 'none', background: 'rgba(15,23,42,0.05)', borderRadius: '8px',
              padding: '5px 10px', cursor: 'pointer', fontSize: '11px', fontWeight: 600,
              color: '#64748b', whiteSpace: 'nowrap', flexShrink: 0,
              display: 'flex', alignItems: 'center', gap: '4px',
            }}
            title="Switch back to market-wide view"
          >
            ← Market view
          </button>
        </div>
      )}

      <div
        className="hmda-product-dimension-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, minmax(0, 1fr))',
          gap: '20px',
          marginBottom: '24px',
        }}
      >
        {model.tables.map((table, index) => (
          <article
            key={table.id}
            className={`hmda-product-dimension-card hmda-product-dimension-card--${table.tone} hmda-product-dimension-card--clean`}
            style={{ animation: 'rise 0.5s ease both', animationDelay: `${index * 0.05}s` }}
          >
            <header className="hmda-product-dimension-card__header">
              <h4 className="hmda-product-dimension-card__title hmda-heading-2">{table.title}</h4>
            </header>

            <div className="hmda-product-dimension-table-scroll">
              <div
                className="hmda-product-dimension-table"
                style={{
                  gridTemplateColumns: `minmax(148px, 1.35fr) repeat(${PRODUCT_DIMENSION_COLUMNS.length}, minmax(72px, 1fr)) 28px`,
                  '--hmda-pdim-row-cols': `minmax(148px, 1.35fr) repeat(${PRODUCT_DIMENSION_COLUMNS.length}, minmax(72px, 1fr)) 28px`,
                }}
              >
                <div className="hmda-product-dimension-table__head" aria-hidden="true">
                  <span className="hmda-product-dimension-table__head-cell hmda-product-dimension-table__head-cell--category">
                    Category
                  </span>
                  {PRODUCT_DIMENSION_COLUMNS.map((col) => (
                    <span key={col.key} className="hmda-product-dimension-table__head-cell">
                      {col.label}
                    </span>
                  ))}
                  <span className="hmda-product-dimension-table__head-cell hmda-product-dimension-table__head-cell--action" />
                </div>

                <div className="hmda-product-dimension-table__body">
                  {table.rows.map((row) => (
                    <button
                      key={`${table.id}-${row.label}`}
                      type="button"
                      className="hmda-product-dimension-table__row"
                      aria-label={`View ${row.label} on geography map`}
                      onClick={() => onRowDrill?.({ table, row })}
                    >
                      <span className="hmda-product-dimension-table__category">{row.label}</span>
                      {PRODUCT_DIMENSION_COLUMNS.map((col) => (
                        <span key={col.key} className="hmda-product-dimension-metric">
                          <span className="hmda-product-dimension-metric__value hmda-mono">{row[col.key]}</span>
                        </span>
                      ))}
                      <span className="hmda-product-dimension-table__action" aria-hidden>
                        <span className="hmda-product-dimension-table__chev">›</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </article>
        ))}
      </div>
      <p className="hmda-product-dimension-footnote">
        {lenderContext ? `${lenderContext.name} · ` : ''}HMDA {model.meta.panelYear}
        {model.meta.dispositionYear && model.meta.dispositionYear !== model.meta.panelYear
          ? ` · disposition from HMDA ${model.meta.dispositionYear} LAR`
          : ''}
        {model.meta.dispositionEstimated ? ' · disposition estimated from national panel rates' : ''}
        {model.meta.mixEstimated ? ' · occupancy, property type, and lien rows use national HMDA mix applied to originated units' : ''}
        {model.meta.totalUnits ? ` · ${model.meta.totalUnits.toLocaleString()} originated units basis` : ''}
        {' · Click any row to open it on the geography map.'}
      </p>
    </div>
  )
}
