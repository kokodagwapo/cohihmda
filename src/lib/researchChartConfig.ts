import type { EvidenceItem } from "@/hooks/useResearchSession";
import { isSqlEvidence } from "@/hooks/useResearchSession";
import { humanizeKey, inferFormat, agentFormatToFieldFormat } from "@/lib/researchEvidenceExport";

export interface ResolvedChartConfig {
  chartType:
    | "bar"
    | "horizontal_bar"
    | "line"
    | "area"
    | "pie"
    | "donut"
    | "stacked_bar"
    | "grouped_bar"
    | "histogram"
    | "scatter";
  xKey: string;
  yKey: string;
  yKeys?: string[];
  isStacked: boolean;
  isMultiSeries: boolean;
  data: Record<string, unknown>[];
  title: string;
  xLabel?: string;
  yLabel?: string;
}

function isStrictlyNumeric(value: unknown): boolean {
  if (typeof value === "number") return !isNaN(value);
  if (typeof value === "boolean") return false;
  const cleaned = String(value).replace(/[$,%\s]/g, "").trim();
  if (cleaned === "") return false;
  return !isNaN(Number(cleaned));
}

function scoreLabelCandidates(
  fields: string[],
  rows: Record<string, any>[],
): Array<{ field: string; uniqueCount: number; score: number }> {
  const BOOL_VALS = new Set(["true", "false", "0", "1", "yes", "no", "t", "f"]);
  return fields
    .map((f) => {
      const lower = f.toLowerCase();
      if (/^(has_|is_|flag_|sort_)/.test(lower)) return null;
      const values = rows.map((r) => r[f]).filter((v) => v != null);
      if (values.length === 0) return null;
      // A field qualifies as a label candidate if at least one value is a
      // non-numeric string (strict check — "90D", "YTD" are non-numeric here).
      const isText = values.some((v) => typeof v === "string" && !isStrictlyNumeric(v));
      if (!isText) return null;
      const unique = new Set(values.map((v) => String(v)));
      if ([...unique].every((v) => BOOL_VALS.has(v.toLowerCase()))) return null;
      if (unique.size < 2) return null;
      const c = unique.size;
      const score = c >= 3 && c <= 15 ? 100 : c === 2 ? 50 : c > 15 && c <= rows.length * 0.8 ? 30 : 10;
      return { field: f, uniqueCount: c, score };
    })
    .filter(Boolean) as Array<{ field: string; uniqueCount: number; score: number }>;
}

// ── Helper: identify numeric fields ─────────────────────────────────────────

function getNumericFields(fields: string[], rows: Record<string, any>[]): string[] {
  return fields.filter((f) => {
    const sample = rows.find((r) => r[f] != null);
    if (!sample) return false;
    const raw = sample[f];
    // Use strict check so "90D", "YTD" etc. are not treated as numeric.
    return isStrictlyNumeric(raw);
  });
}

// ── Shared data-normalisation helpers ────────────────────────────────────────

/**
 * Aggregate rows so there is exactly one entry per unique x-value.
 * All numeric value keys are summed within each group.
 * Rows are expected to already have rawLabel applied to xKey.
 */
function aggregateByX(
  rows: Record<string, any>[],
  xKey: string,
  valueKeys: string[],
): Record<string, any>[] {
  const agg = new Map<string, Record<string, any>>();
  for (const row of rows) {
    const x = String(row[xKey] ?? "");
    if (!agg.has(x)) {
      const entry: Record<string, any> = { [xKey]: x };
      for (const k of valueKeys) entry[k] = 0;
      agg.set(x, entry);
    }
    const entry = agg.get(x)!;
    for (const k of valueKeys) {
      entry[k] = (entry[k] ?? 0) + parseNumeric(row[k]);
    }
  }
  return [...agg.values()];
}

/**
 * Pivot long-format rows to wide format.
 * Each unique xKey value becomes one row; each unique seriesKey value becomes a
 * column containing the parsed numeric value from valueKey.
 *
 * Returns null when the pivot produces fewer than 2 distinct x-categories or
 * when no series values are actually present in the data.
 */
function pivotLongToWide(
  rows: Record<string, any>[],
  xKey: string,
  seriesKey: string,
  valueKey: string,
): { data: Record<string, any>[]; seriesValues: string[] } | null {
  const seriesValues = [...new Set(rows.map(r => String(r[seriesKey] ?? "")))].slice(0, 6);
  if (seriesValues.length === 0) return null;
  const categories = [...new Set(rows.map(r => String(r[xKey] ?? "")))];
  if (categories.length < 2) return null;
  const pivotMap: Record<string, Record<string, any>> = {};
  for (const cat of categories) pivotMap[cat] = { [xKey]: rawLabel(cat) };
  for (const row of rows) {
    const cat = String(row[xKey] ?? "");
    const ser = String(row[seriesKey] ?? "");
    if (seriesValues.includes(ser)) {
      pivotMap[cat][ser] = parseNumeric(row[valueKey]);
    }
  }
  const data = Object.values(pivotMap);
  // Require at least one series column with non-zero data across rows
  const populated = seriesValues.filter(sv => data.some(d => d[sv] !== 0 && d[sv] !== undefined));
  if (populated.length === 0) return null;
  return { data, seriesValues: populated };
}

/**
 * Guarantee that data has at most one entry per x-value.
 * If duplicates are found, falls back to aggregateByX (summing all valueKeys).
 * This is the universal safety net applied at the output boundary of
 * evidenceToChartConfig so no path can produce duplicate x-labels.
 */
function ensureUniqueX(
  data: Record<string, any>[],
  xKey: string,
  valueKeys: string[],
): Record<string, any>[] {
  const seen = new Set<string>();
  let hasDupes = false;
  for (const d of data) {
    const x = String(d[xKey] ?? "");
    if (seen.has(x)) { hasDupes = true; break; }
    seen.add(x);
  }
  if (!hasDupes) return data;
  return aggregateByX(data, xKey, valueKeys);
}

// ── Core adapter: evidence → resolved config ─────────────────────────────────
/**
 * _computeConfig — inner implementation (never call directly).
 *
 * Priority order:
 *  1. Agent-provided chartHint: uses explicit axis keys + chart type.
 *     When data has duplicate x-values and a categorical series candidate
 *     exists, pivots to grouped_bar first (richer chart). Duplicate removal
 *     is NOT done here — the outer evidenceToChartConfig wrapper handles it.
 *  2. Multi-series fallback: 2+ numeric fields → grouped_bar.
 *  3. Duplicate-label fallback: pivot via second categorical field.
 *  4. Single-series fallback: best label + best numeric value.
 */
function _computeConfig(evidence: EvidenceItem): ResolvedChartConfig | null {
  if (!isSqlEvidence(evidence)) return null;
  const { fields, rows, chartHint, columnFormats } = evidence;
  if (rows.length < 2) return null;

  const agentFmts = columnFormats || {};
  const numericFields = getNumericFields(fields, rows);

  // ── PATH 1: agent-provided chartHint ──────────────────────────────────────
  if (chartHint) {
    const hintType = chartHint.type ?? 'bar';
    const xKey = chartHint.xKey ?? chartHint.nameKey ?? fields.find(f => !numericFields.includes(f)) ?? fields[0];
    const yKey = chartHint.yKey ?? chartHint.valueKey ?? numericFields[0];
    const yKeys = chartHint.yKeys?.filter(k => fields.includes(k) && numericFields.includes(k));
    const isMulti = (yKeys?.length ?? 0) > 1;
    const isStacked = hintType === 'stacked_bar';
    const chartType = hintType === 'stacked_bar' ? 'stacked_bar'
      : hintType === 'grouped_bar' ? 'grouped_bar'
      : hintType === 'histogram' ? 'histogram'
      : hintType === 'scatter' ? 'scatter'
      : hintType;

    // Pass-through for histogram and scatter (data is raw rows, not transformed)
    if (chartType === 'histogram' || chartType === 'scatter') {
      return {
        chartType,
        xKey: xKey ?? fields[0],
        yKey: yKey ?? numericFields[0],
        yKeys: undefined,
        isStacked: false,
        isMultiSeries: false,
        data: rows.slice(0, 500),
        title: `${humanizeKey(xKey ?? fields[0])} distribution`,
        xLabel: chartHint.xLabel,
        yLabel: chartHint.yLabel,
      };
    }

    const titleYLabel = isMulti
      ? (yKeys ?? []).map(k => humanizeKey(k)).join(", ")
      : humanizeKey(yKey ?? numericFields[0]);
    const titleXLabel = humanizeKey(xKey ?? fields[0]);

    // ── Opportunistic pivot: long-format → grouped_bar ───────────────────────
    // When raw data has more rows than unique x-values (any hint type), try to
    // pivot using a categorical series dimension before falling back to the
    // universal ensureUniqueX aggregator.  This gives a richer grouped chart
    // instead of summing everything together.
    const uniqueRawX = new Set(rows.slice(0, 30).map(r => String(r[xKey] ?? "")));
    const totalRows = Math.min(rows.length, 30);
    if (uniqueRawX.size < totalRows) {
      const actualYKey = yKey ?? numericFields[0];
      const seriesCandidates = fields.filter(f => {
        if (f === xKey || numericFields.includes(f)) return false;
        const vals = rows.map(r => r[f]).filter(v => v != null);
        return vals.some(v => typeof v === "string" && !isStrictlyNumeric(v));
      });
      for (const seriesField of seriesCandidates) {
        const result = pivotLongToWide(rows.slice(0, 30), xKey, seriesField, actualYKey);
        if (result) {
          const { data: pivotData, seriesValues } = result;
          const avgLen = pivotData.reduce((s, d) => s + String(d[xKey]).length, 0) / pivotData.length;
          return {
            chartType: pivotData.length > 10 || avgLen > 18 ? 'horizontal_bar' : 'grouped_bar',
            xKey,
            yKey: seriesValues[0],
            yKeys: seriesValues,
            isStacked: false,
            isMultiSeries: true,
            data: pivotData,
            title: `${humanizeKey(actualYKey)} by ${humanizeKey(xKey)} (by ${humanizeKey(seriesField)})`,
            xLabel: chartHint.xLabel,
            yLabel: chartHint.yLabel,
          };
        }
      }
      // No pivot field found → fall through; ensureUniqueX will aggregate
    }

    // Standard row mapping — ensureUniqueX deduplicates the result
    const data = rows.slice(0, 30).map((row) => {
      const entry: Record<string, any> = {};
      entry[xKey] = rawLabel(row[xKey]);
      if (isMulti && yKeys) {
        for (const k of yKeys) entry[k] = parseNumeric(row[k]);
      } else if (yKey) {
        entry[yKey] = parseNumeric(row[yKey]);
      }
      for (const f of fields) {
        if (!(f in entry)) entry[f] = row[f];
      }
      return entry;
    });

    const uniqueX = new Set(data.map(d => d[xKey]));
    if (uniqueX.size < 2) return null;

    return {
      chartType,
      xKey,
      yKey: yKey ?? numericFields[0],
      yKeys: isMulti ? yKeys : undefined,
      isStacked,
      isMultiSeries: isMulti,
      data,
      title: `${titleYLabel} by ${titleXLabel}`,
      xLabel: chartHint.xLabel,
      yLabel: chartHint.yLabel,
    };
  }

  // ── PATH 2–4: auto-detection fallback ────────────────────────────────────

  const labelCandidates = scoreLabelCandidates(fields, rows);
  labelCandidates.sort((a, b) => b.score - a.score);
  const labelField = labelCandidates[0]?.field;
  if (!labelField || numericFields.length === 0) return null;

  // PATH 2: multiple numeric fields → grouped_bar
  if (numericFields.length >= 2) {
    const preferredYKeys = numericFields.slice(0, 6);
    const data = rows.slice(0, 30).map((row) => {
      const entry: Record<string, any> = {};
      entry[labelField] = rawLabel(row[labelField]);
      for (const k of preferredYKeys) entry[k] = parseNumeric(row[k]);
      return entry;
    });

    const uniqueLabels = new Set(data.map(d => d[labelField]));
    if (uniqueLabels.size < 2) return null;

    // ensureUniqueX handles dedup; avgLen computed after dedup for layout decision
    const avgLen = data.reduce((s, d) => s + String(d[labelField]).length, 0) / data.length;
    const isHoriz = data.length > 10 || avgLen > 18;

    return {
      chartType: isHoriz ? 'horizontal_bar' : 'grouped_bar',
      xKey: labelField,
      yKey: preferredYKeys[0],
      yKeys: preferredYKeys,
      isStacked: false,
      isMultiSeries: true,
      data,
      title: `${preferredYKeys.map(k => humanizeKey(k)).join(", ")} by ${humanizeKey(labelField)}`,
    };
  }

  // PATH 3: duplicate labels + second categorical → client-side pivot
  const bestField = numericFields.find((f) =>
    /rate|count|total|amount|revenue|avg|sum|percent|volume/i.test(f)
  ) ?? numericFields[0];

  const labelValues = rows.map(r => String(r[labelField] ?? ""));
  const hasDuplicateLabels = labelValues.length !== new Set(labelValues).size;

  if (hasDuplicateLabels) {
    const otherCategoricals = labelCandidates.slice(1);
    const seriesField = otherCategoricals[0]?.field;
    if (seriesField) {
      const seriesValues = [...new Set(rows.map(r => String(r[seriesField] ?? "")))].slice(0, 6);
      const categories = [...new Set(rows.map(r => String(r[labelField] ?? "")))];
      const pivot: Record<string, Record<string, any>> = {};
      for (const cat of categories) pivot[cat] = { [labelField]: cat };
      for (const row of rows) {
        const cat = String(row[labelField] ?? "");
        const ser = String(row[seriesField] ?? "");
        if (seriesValues.includes(ser)) {
          pivot[cat][ser] = parseNumeric(row[bestField]);
        }
      }
      const pivotData = Object.values(pivot);
      const uniqueLabelsAfterPivot = new Set(pivotData.map(d => d[labelField]));
      if (uniqueLabelsAfterPivot.size >= 2) {
        const avgLen = pivotData.reduce((s, d) => s + String(d[labelField]).length, 0) / pivotData.length;
        const isHoriz = pivotData.length > 10 || avgLen > 18;
        return {
          chartType: isHoriz ? 'horizontal_bar' : 'grouped_bar',
          xKey: labelField,
          yKey: seriesValues[0],
          yKeys: seriesValues,
          isStacked: false,
          isMultiSeries: true,
          data: pivotData,
          title: `${humanizeKey(bestField)} by ${humanizeKey(labelField)} (grouped by ${humanizeKey(seriesField)})`,
        };
      }
    }
  }

  // PATH 4: single-series fallback
  // ensureUniqueX will aggregate any surviving duplicates (e.g. PATH 3 fell
  // through because there was no second categorical field).
  const data = rows.slice(0, 30).map((row) => {
    const entry: Record<string, any> = {};
    entry[labelField] = rawLabel(row[labelField]);
    entry[bestField] = parseNumeric(row[bestField]);
    for (const f of fields) {
      if (!(f in entry)) entry[f] = row[f];
    }
    return entry;
  });

  const uniqueLabels4 = new Set(data.map(d => d[labelField]));
  if (uniqueLabels4.size < 2) return null;

  const labelFieldLower = labelField.toLowerCase();
  const sampleLabel = String(data[0]?.[labelField] ?? "");
  const isTimeSeries =
    /date|month|quarter|year|period/.test(labelFieldLower) || /^\d{4}-\d{2}/.test(sampleLabel);
  const avgLabelLength = data.reduce((s, d) => s + String(d[labelField]).length, 0) / data.length;
  const isHorizontal = data.length > 12 || avgLabelLength > 20;

  const inferredType = isTimeSeries ? 'line' : isHorizontal ? 'horizontal_bar' : 'bar';

  const bestFormat = agentFormatToFieldFormat(agentFmts[bestField]) || inferFormat(bestField);
  void bestFormat;

  return {
    chartType: inferredType,
    xKey: labelField,
    yKey: bestField,
    isStacked: false,
    isMultiSeries: false,
    data,
    title: `${humanizeKey(bestField)} by ${humanizeKey(labelField)}`,
  };
}

function rawLabel(v: unknown): string {
  if (v == null) return "N/A";
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v);
  return s.length > 22 ? s.substring(0, 19) + "…" : s;
}

function parseNumeric(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  return parseFloat(String(v).replace(/[$,%]/g, "")) || 0;
}
export function evidenceToChartConfig(
  evidence: EvidenceItem,
): ResolvedChartConfig | null {
  const config = _computeConfig(evidence);
  if (!config) return null;
  const allValueKeys = config.yKeys ?? [config.yKey];
  config.data = ensureUniqueX(config.data, config.xKey, allValueKeys);
  if (config.data.length < 2) return null;
  return config;
}

export function canExportChart(evidence: EvidenceItem): boolean {
  return evidenceToChartConfig(evidence) != null;
}
