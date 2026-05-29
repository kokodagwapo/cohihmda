import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Banknote,
  Check,
  ChevronDown,
  Droplets,
  Flame,
  Hash,
  PieChart,
  Scale,
  ShieldAlert,
  ShieldX,
  Undo2,
  Wallet,
} from 'lucide-react'
import { GEO_MAP_METRICS, GEO_MAP_DEFAULT_METRIC, metricById } from './geo-map-metrics.js'

const METRIC_ICON_META = {
  volume: { Icon: Banknote, tone: 'indigo' },
  units: { Icon: Hash, tone: 'sky' },
  avgLoan: { Icon: Scale, tone: 'violet' },
  medianIncome: { Icon: Wallet, tone: 'cyan' },
  denialRate: { Icon: ShieldX, tone: 'rose' },
  withdrawnRate: { Icon: Undo2, tone: 'amber' },
  pullthroughRate: { Icon: PieChart, tone: 'emerald' },
  floodRisk: { Icon: Droplets, tone: 'blue' },
  wildfireRisk: { Icon: Flame, tone: 'orange' },
  compositeRisk: { Icon: ShieldAlert, tone: 'slate' },
}

function metricIconMeta(id) {
  return METRIC_ICON_META[id] || METRIC_ICON_META.volume
}

const METRIC_GROUPS = [
  {
    label: 'Production',
    ids: ['volume', 'units', 'avgLoan'],
  },
  {
    label: 'Income (ACS proxy)',
    ids: ['medianIncome'],
  },
  {
    label: 'Outcomes',
    ids: ['denialRate', 'withdrawnRate', 'pullthroughRate'],
  },
  {
    label: 'Hazard',
    ids: ['floodRisk', 'wildfireRisk', 'compositeRisk'],
  },
]

export default function GeoMetricPicker({ value, onChange }) {
  const anchorRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState(null)

  const current = metricById(value || GEO_MAP_DEFAULT_METRIC)
  const currentIcon = metricIconMeta(current.id)
  const CurrentIcon = currentIcon.Icon

  const updateMenuPos = useCallback(() => {
    const el = anchorRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setMenuPos({
      top: rect.bottom + 8,
      left: rect.left,
      minWidth: Math.max(rect.width, 248),
    })
  }, [])

  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null)
      return
    }
    updateMenuPos()
    window.addEventListener('resize', updateMenuPos)
    window.addEventListener('scroll', updateMenuPos, true)
    return () => {
      window.removeEventListener('resize', updateMenuPos)
      window.removeEventListener('scroll', updateMenuPos, true)
    }
  }, [open, updateMenuPos])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onClick = (e) => {
      const t = e.target
      if (!(t instanceof Node)) return
      if (anchorRef.current?.contains(t)) return
      if (t instanceof Element && t.closest('[data-hmda-geo-metric-menu]')) return
      setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    const t = window.setTimeout(() => document.addEventListener('click', onClick), 0)
    return () => {
      document.removeEventListener('keydown', onKey)
      window.clearTimeout(t)
      document.removeEventListener('click', onClick)
    }
  }, [open])

  const pick = (id) => {
    onChange?.(id)
    setOpen(false)
  }

  const menu =
    open && menuPos && typeof document !== 'undefined'
      ? createPortal(
          <div
            data-hmda-geo-metric-menu
            className="hmda-geo-metric-menu"
            role="listbox"
            aria-label="Choropleth metric"
            style={{
              position: 'fixed',
              top: menuPos.top,
              left: menuPos.left,
              minWidth: menuPos.minWidth,
              zIndex: 10100,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="hmda-geo-metric-menu__header">
              <span>Choropleth metric</span>
            </div>
            <div className="hmda-geo-metric-menu__body">
              {METRIC_GROUPS.map((group) => {
                const items = GEO_MAP_METRICS.filter((m) => group.ids.includes(m.id))
                if (!items.length) return null
                return (
                  <div key={group.label} className="hmda-geo-metric-menu__group">
                    <span className="hmda-geo-metric-menu__group-label">{group.label}</span>
                    {items.map((m) => {
                      const selected = m.id === current.id
                      const { Icon, tone } = metricIconMeta(m.id)
                      return (
                        <button
                          key={m.id}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          className={`hmda-geo-metric-menu__item${selected ? ' is-selected' : ''}`}
                          data-metric-tone={tone}
                          onClick={() => pick(m.id)}
                        >
                          <span
                            className={`hmda-geo-metric-menu__icon-well hmda-geo-metric-menu__icon-well--${tone}`}
                            aria-hidden
                          >
                            <Icon size={14} strokeWidth={2.25} />
                          </span>
                          <span className="hmda-geo-metric-menu__item-label">{m.label}</span>
                          {selected ? (
                            <span className="hmda-geo-metric-menu__check" aria-hidden>
                              <Check size={13} strokeWidth={2.75} />
                            </span>
                          ) : null}
                        </button>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>,
          document.body,
        )
      : null

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={`hmda-geo-metric-trigger${open ? ' is-open' : ''}`}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Metric: ${current.label}`}
      >
        <span className={`hmda-geo-metric-trigger__glyph-well hmda-geo-metric-trigger__glyph-well--${currentIcon.tone}`} aria-hidden>
          <CurrentIcon size={14} className="hmda-geo-metric-trigger__icon" />
        </span>
        <span className="hmda-geo-metric-trigger__label">{current.shortLabel || current.label}</span>
        <ChevronDown size={14} aria-hidden className="hmda-geo-metric-trigger__chev" />
      </button>
      {menu}
    </>
  )
}
