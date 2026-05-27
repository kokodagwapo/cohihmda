/**
 * Client-side detection of snapshot metrics repeated across timeframe rows.
 */

const TIMEFRAME_PERIOD_COLUMNS = new Set([
  "timeframe",
  "period",
  "window",
  "date_range",
  "time_window",
  "comparison_period",
]);

export function detectSnapshotColumnsInTimeframeTable(
  fields: string[],
  rows: Record<string, unknown>[],
): string[] {
  const periodField = fields.find((f) =>
    TIMEFRAME_PERIOD_COLUMNS.has(f.toLowerCase()),
  );
  if (!periodField || rows.length < 2) return [];

  const distinctPeriods = new Set(
    rows.map((r) => String(r[periodField] ?? "").trim()),
  );
  if (distinctPeriods.size < 2) return [];

  const snapshotCols: string[] = [];
  for (const field of fields) {
    if (field === periodField) continue;
    const values = rows.map((r) => r[field]);
    if (values.length < 2) continue;
    const first = values[0];
    if (first == null) continue;
    if (!values.every((v) => v === first)) continue;

    const fl = field.toLowerCase();
    if (
      /active|stale/.test(fl) &&
      (fl.includes("loan") || fl.includes("volume") || fl.includes("rate"))
    ) {
      snapshotCols.push(field);
    }
  }
  return snapshotCols;
}
