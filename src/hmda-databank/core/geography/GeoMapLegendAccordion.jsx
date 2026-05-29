import { ChevronDown, CircleDot, Layers, MousePointer2 } from 'lucide-react'
import { formatMetricValue, metricLegendGradientCss } from './geo-map-metrics.js'
import { primaryMetricIcon } from './geo-hover-card-icons.js'

function LegendIconWell({ Icon, tone }) {
  return (
    <span
      className={`hmda-geo-hover-card__icon-well hmda-geo-hover-card__icon-well--${tone} hmda-geo-hover-card__icon-well--sm`}
      aria-hidden
    >
      <Icon size={12} strokeWidth={2.25} />
    </span>
  )
}

const LEGEND_KEYS = [
  {
    id: 'fill',
    Icon: Layers,
    tone: 'indigo',
    label: (metric) => `State color — darker = higher ${metric.shortLabel || metric.label.toLowerCase()}`,
  },
  {
    id: 'dot',
    Icon: CircleDot,
    tone: 'violet',
    label: () => 'Dot size — more originated loans in that state',
  },
  {
    id: 'hover',
    Icon: MousePointer2,
    tone: 'sky',
    label: () => 'Hover map to update details · zoom for counties & tracts',
  },
]

export default function GeoMapLegendAccordion({ metric, min, max, year, mapSelectedState, open, onToggle }) {
  const metricMeta = primaryMetricIcon(metric?.id)
  const MetricIcon = metricMeta.Icon
  const regionLabel = mapSelectedState ? mapSelectedState : 'USA'

  return (
    <section
      className={`hmda-geo-mapbox-legend hmda-geo-mapbox-legend--dock hmda-geo-mapbox-legend--accordion${open ? ' is-open' : ''}`}
      role="region"
      aria-label="Map legend"
    >
      <button
        type="button"
        className="hmda-geo-mapbox-legend__toggle"
        aria-expanded={open}
        onClick={onToggle}
      >
        <LegendIconWell Icon={MetricIcon} tone={metricMeta.tone} />
        <span className="hmda-geo-mapbox-legend__toggle-text">
          <span className="hmda-geo-mapbox-legend__toggle-label">Map legend</span>
          <span className="hmda-geo-mapbox-legend__toggle-hint">
            {metric?.label} · HMDA {year} · {regionLabel}
          </span>
        </span>
        <ChevronDown
          size={16}
          strokeWidth={2.25}
          className="hmda-geo-mapbox-legend__chevron"
          aria-hidden
        />
      </button>

      <div className="hmda-geo-mapbox-legend__panel" aria-hidden={!open}>
        <div className="hmda-geo-mapbox-legend__panel-inner">
          <div
            className="hmda-geo-mapbox-legend__bar"
            data-metric={metric?.id}
            style={{ background: metricLegendGradientCss(metric?.id) }}
            aria-hidden
          />
          <div className="hmda-geo-mapbox-legend__ends">
            <span>Low</span>
            <span>{formatMetricValue(metric, min)}</span>
            <span>{formatMetricValue(metric, max)}</span>
            <span>High</span>
          </div>
          <ul className="hmda-geo-mapbox-legend__keys">
            {LEGEND_KEYS.map((item) => (
              <li key={item.id}>
                <LegendIconWell Icon={item.Icon} tone={item.tone} />
                <span>{item.label(metric)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
