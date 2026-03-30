/**
 * SlideElementRenderer
 *
 * Renders individual slide elements (text, chart, table, kpi, image, metric-card, shape)
 * as React components for the slide editor preview. These mirror what the backend
 * generates in PPTX but rendered as HTML/SVG for live editing.
 */

import React from 'react';
import type {
  SlideElement,
  SlideElementConfig,
  TextElementConfig,
  ChartElementConfig,
  TableElementConfig,
  KpiElementConfig,
  MetricCardConfig,
  ImageElementConfig,
  ShapeElementConfig,
} from '@/types/reportTypes';

interface SlideElementRendererProps {
  element: SlideElement;
  isSelected?: boolean;
  onClick?: () => void;
  scale?: number;
}

export function SlideElementRenderer({
  element,
  isSelected,
  onClick,
  scale = 1,
}: SlideElementRendererProps) {
  const config = element.config;

  return (
    <div
      className={`relative w-full h-full overflow-hidden ${isSelected ? 'ring-2 ring-blue-500' : ''}`}
      onClick={onClick}
    >
      {renderByType(config, element, scale)}
    </div>
  );
}

function renderByType(config: SlideElementConfig, element: SlideElement, scale: number) {
  // Use config.type first, fall back to element.type for AI-generated definitions
  const elType = config?.type || element?.type;

  switch (elType) {
    case 'text':
      return <TextElement config={config as TextElementConfig} scale={scale} />;
    case 'chart':
      return <ChartElement config={config as ChartElementConfig} scale={scale} />;
    case 'table':
      return <TableElement config={config as TableElementConfig} scale={scale} elementHeight={element.position?.h} />;
    case 'kpi':
      return <KpiElement config={config as KpiElementConfig} scale={scale} />;
    case 'metric-card':
      return <MetricCardElement config={config as MetricCardConfig} scale={scale} />;
    case 'image':
      return <ImageElement config={config as ImageElementConfig} />;
    case 'shape':
      return <ShapeElement config={config as ShapeElementConfig} />;
    default: {
      // Attempt to infer type from config content (AI sometimes uses non-standard type names)
      const c = config as any;
      if (c?.content && typeof c.content === 'string') {
        // Has text content — render as text (covers "narrative", "heading", "bullets", "paragraph", etc.)
        return <TextElement config={{ type: 'text', content: c.content, fontSize: c.fontSize, fontWeight: c.fontWeight, color: c.color, align: c.align, bullet: c.bullet ?? (elType === 'bullets'), lineSpacing: c.lineSpacing } as TextElementConfig} scale={scale} />;
      }
      if (c?.chartType && c?.data) {
        // Has chart properties — render as chart
        return <ChartElement config={{ type: 'chart', ...c } as ChartElementConfig} scale={scale} />;
      }
      if (c?.columns && c?.data) {
        // Has table properties — render as table
        return <TableElement config={{ type: 'table', ...c } as TableElementConfig} scale={scale} elementHeight={element.position?.h} />;
      }
      if (c?.value != null && c?.label) {
        // Has KPI properties — render as KPI
        return <KpiElement config={{ type: 'kpi', ...c } as KpiElementConfig} scale={scale} />;
      }
      if (c?.metrics && Array.isArray(c.metrics)) {
        // Has metric-card properties
        return <MetricCardElement config={{ type: 'metric-card', ...c } as MetricCardConfig} scale={scale} />;
      }
      return (
        <div className="flex items-center justify-center h-full text-xs text-slate-400 p-2 text-center">
          <span>Unsupported element: {elType || 'unknown'}</span>
        </div>
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Text Element
// ---------------------------------------------------------------------------

function TextElement({ config, scale }: { config: TextElementConfig; scale: number }) {
  return (
    <div
      className="w-full h-full p-2 overflow-hidden"
      style={{
        fontSize: (config.fontSize || 12) * scale,
        fontFamily: config.fontFamily || 'inherit',
        fontWeight: config.fontWeight || 'normal',
        fontStyle: config.fontStyle || 'normal',
        color: config.color || '#1e293b',
        textAlign: config.align || 'left',
        display: 'flex',
        alignItems: config.verticalAlign === 'middle' ? 'center' :
          config.verticalAlign === 'bottom' ? 'flex-end' : 'flex-start',
        lineHeight: config.lineSpacing ? `${config.lineSpacing}em` : undefined,
      }}
    >
      {config.bullet ? (
        <ul className="list-disc pl-4">
          {(config.content || '').split('\n').map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      ) : (
        <span className="whitespace-pre-wrap">{config.content || 'Text'}</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chart Element (preview using colored bars/areas)
// ---------------------------------------------------------------------------

function ChartElement({ config, scale }: { config: ChartElementConfig; scale: number }) {
  const data = config.data || [];
  const colors = config.colors || ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];
  const xKey = config.xKey || (data[0] ? Object.keys(data[0])[0] : 'label');
  const allYKeys = config.yKeys?.length
    ? config.yKeys
    : config.yKey
    ? [config.yKey]
    : data[0] ? [Object.keys(data[0]).find((k) => k !== xKey) || 'value'] : ['value'];
  const isCombo = config.chartType === 'combo';
  const yKeys = isCombo ? allYKeys.slice(0, 2) : allYKeys;
  const yKey = yKeys[0];
  const lineKey = isCombo ? (config.lineKey || allYKeys[2]) : undefined;
  const allVals = data.flatMap((d) => yKeys.map((k) => Number(d[k]) || 0));
  const maxVal = Math.max(...allVals, 1);
  const lineVals = lineKey ? data.map((d) => Number(d[lineKey]) || 0) : [];
  const lineMax = Math.max(...lineVals, 1);
  const lineColor = config.lineColor || colors[yKeys.length % colors.length] || '#475569';

  const fmtNum = (n: number) => {
    if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    if (Number.isInteger(n)) return n.toLocaleString();
    return n.toFixed(1);
  };

  const humanLabel = (key: string) =>
    key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').replace(/^./, (s) => s.toUpperCase()).trim();

  const isPie = config.chartType === 'pie' || config.chartType === 'donut';
  const isLine = config.chartType === 'line' || config.chartType === 'area';
  const legendEntries = isCombo && lineKey
    ? [...yKeys.map((key, i) => ({ key, color: colors[i % colors.length], label: config.seriesNames?.[i] || humanLabel(key) })), { key: lineKey, color: lineColor, label: config.seriesNames?.[yKeys.length] || humanLabel(lineKey) }]
    : yKeys.map((key, i) => ({ key, color: colors[i % colors.length], label: config.seriesNames?.[i] || humanLabel(key) }));

  // Y-axis tick values (4 ticks)
  const yTicks = [0, maxVal * 0.25, maxVal * 0.5, maxVal * 0.75, maxVal];
  const rightTicks = [0, lineMax * 0.25, lineMax * 0.5, lineMax * 0.75, lineMax];

  return (
    <div className="w-full h-full flex flex-col p-2 gap-0.5">
      {config.title && (
        <div className="font-semibold truncate" style={{ fontSize: 11 * scale, color: '#1e293b' }}>
          {config.title}
        </div>
      )}

      {isPie ? (
        <div className="flex-1 flex items-center min-h-0">
          <PiePreview data={data} colors={colors} nameKey={config.nameKey || xKey} valueKey={config.valueKey || yKey} scale={scale} />
        </div>
      ) : isLine ? (
        <div className="flex-1 min-h-0">
          <LinePreview data={data} xKey={xKey} yKeys={yKeys} colors={colors} scale={scale} seriesNames={config.seriesNames} />
        </div>
      ) : (
        <div className="flex-1 flex min-h-0">
          {/* Y-axis labels */}
          <div className="flex flex-col justify-between items-end pr-1 py-0.5" style={{ width: 32 * scale }}>
            {yTicks.slice().reverse().map((v, i) => (
              <span key={i} className="text-slate-400 leading-none" style={{ fontSize: 6 * scale }}>{fmtNum(v)}</span>
            ))}
          </div>
          {/* Bars */}
          <div className="flex-1 relative">
            <div className="absolute inset-0 flex items-end gap-0.5">
              {data.slice(0, 14).map((d, i) => (
                <div key={i} className="flex-1 flex flex-col items-center justify-end h-full min-w-0">
                  <div className="flex items-end gap-px w-full h-full relative">
                    {yKeys.map((k, si) => {
                      const val = Math.max(Number(d[k]) || 0, 0);
                      const pct = maxVal > 0 ? (val / maxVal) * 100 : 0;
                      return (
                        <div key={k} className="flex-1 rounded-t relative group" style={{ height: `${pct}%`, backgroundColor: colors[si % colors.length], minHeight: val > 0 ? 2 : 0 }}>
                          {(config.showValues !== false && data.length <= 10 && !isCombo) && (
                            <div className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap text-slate-600" style={{ fontSize: 5.5 * scale }}>
                              {fmtNum(val)}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="text-slate-500 truncate w-full text-center mt-0.5 leading-tight" style={{ fontSize: Math.max(6 * scale, 5) }}>
                    {String(d[xKey] ?? '').slice(0, 12)}
                  </div>
                </div>
              ))}
            </div>
            {isCombo && lineKey && (
              <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full overflow-visible pointer-events-none">
                <polyline
                  fill="none"
                  stroke={lineColor}
                  strokeWidth={1.6}
                  points={data.slice(0, 14).map((d, i, arr) => {
                    const val = Math.max(Number(d[lineKey]) || 0, 0);
                    const x = arr.length === 1 ? 50 : (i / (arr.length - 1)) * 100;
                    const y = 100 - ((lineMax > 0 ? val / lineMax : 0) * 84 + 8);
                    return `${x},${y}`;
                  }).join(' ')}
                />
                {data.slice(0, 14).map((d, i, arr) => {
                  const val = Math.max(Number(d[lineKey]) || 0, 0);
                  const x = arr.length === 1 ? 50 : (i / (arr.length - 1)) * 100;
                  const y = 100 - ((lineMax > 0 ? val / lineMax : 0) * 84 + 8);
                  return <circle key={`${lineKey}-${i}`} cx={x} cy={y} r={1.8} fill={lineColor} />;
                })}
              </svg>
            )}
          </div>
          {isCombo && lineKey && (
            <div className="flex flex-col justify-between items-start pl-1 py-0.5" style={{ width: 32 * scale }}>
              {rightTicks.slice().reverse().map((v, i) => (
                <span key={i} className="text-slate-400 leading-none" style={{ fontSize: 6 * scale }}>{fmtNum(v)}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {data.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-xs text-slate-400">
          {config.chartType || 'bar'} chart (no data)
        </div>
      )}

      {data.length > 0 && !isPie && (
        <div className="flex items-center gap-2 flex-wrap justify-center" style={{ minHeight: 10 * scale }}>
          {legendEntries.map((entry) => (
            <div key={entry.key} className="flex items-center gap-0.5">
              <div className="rounded-sm" style={{ width: 7 * scale, height: 7 * scale, backgroundColor: entry.color }} />
              <span className="text-slate-600" style={{ fontSize: 7 * scale }}>{entry.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PiePreview({
  data,
  colors,
  nameKey,
  valueKey,
  scale = 1,
}: {
  data: Record<string, any>[];
  colors: string[];
  nameKey: string;
  valueKey: string;
  scale?: number;
}) {
  const rawTotal = data.reduce((s, d) => s + (Number(d[valueKey]) || 0), 0);
  if (rawTotal === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-slate-400">
        Pie chart (no values)
      </div>
    );
  }
  const total = rawTotal;
  let cumAngle = 0;
  const slices = data.slice(0, 8);

  return (
    <div className="flex-1 flex items-center justify-center gap-2">
      <svg viewBox="0 0 100 100" className="max-w-[100px] max-h-[100px]" style={{ flex: '0 0 auto', width: 100 * scale, height: 100 * scale }}>
        {slices.map((d, i) => {
          const val = (Number(d[valueKey]) || 0) / total;
          const startAngle = cumAngle;
          cumAngle += val * 360;
          const endAngle = cumAngle;
          const x1 = 50 + 45 * Math.cos((Math.PI / 180) * (startAngle - 90));
          const y1 = 50 + 45 * Math.sin((Math.PI / 180) * (startAngle - 90));
          const x2 = 50 + 45 * Math.cos((Math.PI / 180) * (endAngle - 90));
          const y2 = 50 + 45 * Math.sin((Math.PI / 180) * (endAngle - 90));
          const largeArc = val > 0.5 ? 1 : 0;
          return (
            <path
              key={i}
              d={`M 50 50 L ${x1} ${y1} A 45 45 0 ${largeArc} 1 ${x2} ${y2} Z`}
              fill={colors[i % colors.length]}
              stroke="white"
              strokeWidth="0.5"
            />
          );
        })}
      </svg>
      <div className="flex flex-col gap-0.5 overflow-hidden">
        {slices.map((d, i) => {
          const pct = ((Number(d[valueKey]) || 0) / total * 100).toFixed(1);
          return (
            <div key={i} className="flex items-center gap-1 min-w-0">
              <div className="rounded-sm flex-shrink-0" style={{ width: 6 * scale, height: 6 * scale, backgroundColor: colors[i % colors.length] }} />
              <span className="text-slate-600 truncate" style={{ fontSize: 6 * scale }}>{String(d[nameKey] ?? '').slice(0, 16)} ({pct}%)</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LinePreview({
  data,
  xKey,
  yKeys,
  colors,
  scale = 1,
  seriesNames,
}: {
  data: Record<string, any>[];
  xKey: string;
  yKeys: string[];
  colors: string[];
  scale?: number;
  seriesNames?: string[];
}) {
  if (data.length < 2) return <div className="text-xs text-slate-400 flex items-center justify-center flex-1">Line chart</div>;
  const allVals = data.flatMap((d) => yKeys.map((k) => Number(d[k]) || 0));
  const maxVal = Math.max(...allVals, 1);

  const fmtNum = (n: number) => {
    if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    if (Number.isInteger(n)) return n.toLocaleString();
    return n.toFixed(1);
  };

  const humanLabel = (key: string) =>
    key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').replace(/^./, (s) => s.toUpperCase()).trim();

  const padLeft = 8;
  const padRight = 2;
  const padTop = 5;
  const padBottom = 12;
  const chartW = 100 - padLeft - padRight;
  const chartH = 100 - padTop - padBottom;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 min-h-0">
        <svg viewBox="0 0 100 100" className="w-full h-full" preserveAspectRatio="none">
          {/* Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => {
            const y = padTop + chartH * (1 - pct);
            return (
              <React.Fragment key={i}>
                <line x1={padLeft} y1={y} x2={padLeft + chartW} y2={y} stroke="#e2e8f0" strokeWidth="0.3" />
                <text x={padLeft - 1} y={y + 0.5} textAnchor="end" fill="#94a3b8" fontSize="3">{fmtNum(maxVal * pct)}</text>
              </React.Fragment>
            );
          })}
          {/* X-axis labels */}
          {data.map((d, i) => {
            const x = padLeft + (i / (data.length - 1)) * chartW;
            if (data.length > 10 && i % Math.ceil(data.length / 8) !== 0 && i !== data.length - 1) return null;
            return (
              <text key={i} x={x} y={padTop + chartH + 5} textAnchor="middle" fill="#94a3b8" fontSize="2.8">
                {String(d[xKey] ?? '').slice(0, 10)}
              </text>
            );
          })}
          {/* Lines per series */}
          {yKeys.map((k, si) => {
            const points = data.map((d, i) => ({
              x: padLeft + (i / (data.length - 1)) * chartW,
              y: padTop + chartH - ((Number(d[k]) || 0) / maxVal) * chartH,
            }));
            const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
            return <path key={k} d={pathD} fill="none" stroke={colors[si % colors.length] || '#3b82f6'} strokeWidth="1.2" />;
          })}
        </svg>
      </div>
      {yKeys.length >= 1 && (
        <div className="flex items-center gap-2 flex-wrap justify-center" style={{ minHeight: 10 * scale }}>
          {yKeys.map((k, i) => (
            <div key={k} className="flex items-center gap-0.5">
              <div className="rounded-sm" style={{ width: 7 * scale, height: 7 * scale, backgroundColor: colors[i % colors.length] || '#3b82f6' }} />
              <span className="text-slate-600" style={{ fontSize: 7 * scale }}>{seriesNames?.[i] || humanLabel(k)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table Element
// ---------------------------------------------------------------------------

function TableElement({
  config,
  scale,
  elementHeight,
}: {
  config: TableElementConfig;
  scale: number;
  elementHeight?: number;
}) {
  const data = config.data || [];
  // Auto-detect columns from data keys when no columns defined
  const columns = (config.columns && config.columns.length > 0)
    ? config.columns
    : data.length > 0
    ? Object.keys(data[0]).map((key) => ({
        key,
        label: key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      }))
    : [];
  const firstColumnKey = columns[0]?.key;
  const visibleRows = (() => {
    const estimatedHeaderHeight = Math.max(0.3, ((config.fontSize || 10) + 4) / 72);
    const estimatedRowHeight = Math.max(0.22, ((config.fontSize || 9) + 3) / 72);
    const maxDataRows = Math.max(
      1,
      Math.floor(((elementHeight ?? 5.5) - estimatedHeaderHeight) / estimatedRowHeight)
    );
    if (data.length <= maxDataRows) return data;
    const lastRow = data[data.length - 1];
    const isTotalsRow =
      firstColumnKey != null &&
      String(lastRow?.[firstColumnKey] ?? '').trim().toLowerCase() === 'totals';
    return isTotalsRow && maxDataRows > 1
      ? [...data.slice(0, maxDataRows - 1), lastRow]
      : data.slice(0, maxDataRows);
  })();

  return (
    <div className="w-full h-full overflow-auto p-1">
      <table className="w-full border-collapse" style={{ fontSize: (config.fontSize || 9) * scale }}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className="px-1.5 py-1 font-semibold text-white truncate"
                style={{
                  backgroundColor: config.headerStyle?.backgroundColor || '#1e3a5f',
                  fontSize: (config.headerStyle?.fontSize || config.fontSize || 9) * scale,
                  textAlign: col.align || 'left',
                }}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row, rowIdx) => (
            <tr
              key={rowIdx}
              style={{
                backgroundColor: rowIdx % 2 === 1 ? (config.alternateRowColor || '#f8fafc') : '#ffffff',
              }}
            >
              {columns.map((col) => {
                let val = row[col.key] ?? '';
                if (col.format === 'currency' && typeof val === 'number') val = `$${val.toLocaleString()}`;
                else if (col.format === 'percent' && typeof val === 'number') val = `${val.toFixed(1)}%`;
                else if (col.format === 'ratio' && typeof val === 'number') val = val.toFixed(2);
                else if (col.format === 'days' && typeof val === 'number') val = `${Math.round(val)}d`;
                return (
                  <td key={col.key} className="px-1.5 py-0.5 truncate border-b border-slate-100" style={{ textAlign: col.align || 'left' }}>
                    {String(val)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {data.length === 0 && (
        <div className="text-xs text-slate-400 text-center py-4">Table (no data)</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPI Element
// ---------------------------------------------------------------------------

function formatKpiValue(value: unknown, format?: string): string {
  if (value == null || value === '' || value === '--') return '--';
  const num = typeof value === 'number' ? value : Number(value);
  if (isNaN(num)) return String(value);

  if (format === 'currency') {
    if (Math.abs(num) >= 1_000_000) return `$${(num / 1_000_000).toFixed(1)}M`;
    if (Math.abs(num) >= 1_000) return `$${Math.round(num / 1_000).toLocaleString()}K`;
    return `$${num.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  }
  if (format === 'percent') {
    return `${num.toFixed(1)}%`;
  }
  // Plain number: use sensible formatting
  if (Number.isInteger(num)) return num.toLocaleString();
  if (Math.abs(num) >= 100) return Math.round(num).toLocaleString();
  if (Math.abs(num) >= 10) return num.toFixed(1);
  return num.toFixed(2);
}

function KpiElement({ config, scale }: { config: KpiElementConfig; scale: number }) {
  const displayVal = formatKpiValue(config.value, config.format);

  return (
    <div className="w-full h-full rounded-lg bg-slate-50 border border-slate-200 flex flex-col items-center justify-center p-2">
      <div
        className="font-bold"
        style={{
          fontSize: (config.valueSize || 28) * scale,
          color: config.color || '#3b82f6',
        }}
      >
        {displayVal}
      </div>
      <div
        className="text-slate-600 mt-0.5"
        style={{ fontSize: (config.fontSize || 11) * scale }}
      >
        {config.label}
      </div>
      {config.change != null && (
        <div
          className="mt-0.5"
          style={{
            fontSize: 9 * scale,
            color: config.change >= 0 ? '#10b981' : '#ef4444',
          }}
        >
          {config.change >= 0 ? '\u25B2' : '\u25BC'} {Math.abs(config.change).toFixed(1)}%
          {config.changeLabel ? ` ${config.changeLabel}` : ''}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Metric Card Element
// ---------------------------------------------------------------------------

function MetricCardElement({ config, scale }: { config: MetricCardConfig; scale: number }) {
  const cols = config.columns || Math.min(config.metrics?.length || 3, 4);

  return (
    <div
      className="w-full h-full grid gap-1 p-1"
      style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
    >
      {(config.metrics || []).map((m, i) => (
        <KpiElement
          key={i}
          config={{
            type: 'kpi',
            label: m.label,
            value: m.value,
            format: m.format,
            change: m.change,
            trend: m.trend,
          }}
          scale={scale * 0.8}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Image Element
// ---------------------------------------------------------------------------

function ImageElement({ config }: { config: ImageElementConfig }) {
  if (!config.src) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-slate-50 border border-dashed border-slate-300 rounded text-xs text-slate-400">
        Image placeholder
      </div>
    );
  }

  return (
    <img
      src={config.src}
      alt={config.alt || ''}
      className="w-full h-full"
      style={{
        objectFit: config.objectFit || 'contain',
        borderRadius: config.borderRadius || 0,
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Shape Element
// ---------------------------------------------------------------------------

function ShapeElement({ config }: { config: ShapeElementConfig }) {
  const fill = config.fill || '#e2e8f0';
  const stroke = config.stroke || 'transparent';

  if (config.shapeType === 'circle') {
    return (
      <div
        className="w-full h-full rounded-full"
        style={{ backgroundColor: fill, border: `${config.strokeWidth || 1}px solid ${stroke}` }}
      />
    );
  }
  if (config.shapeType === 'line') {
    return (
      <div className="w-full h-full flex items-center">
        <div className="w-full" style={{ height: config.strokeWidth || 2, backgroundColor: config.stroke || '#64748b' }} />
      </div>
    );
  }
  return (
    <div
      className="w-full h-full"
      style={{
        backgroundColor: fill,
        border: `${config.strokeWidth || 1}px solid ${stroke}`,
        borderRadius: config.shapeType === 'roundedRect' ? 8 : 0,
      }}
    />
  );
}

export default SlideElementRenderer;
