/**
 * Pipeline Analysis Service
 * Weekly snapshots on a configurable weekday (Mon–Fri): active units/volume/LO count and percent change.
 *
 * A loan is counted as "active" on snapshot date D as follows:
 * - Active loans (current_loan_status = 'Active Loan'): start_date < D (snapshot date is after start).
 * - Non-active loans (any other current_loan_status): start_date <= D and we use only current_status_date
 *   for the end date — loan is active on D if current_status_date IS NULL OR current_status_date > D.
 *
 * Start date is either application_date, lock_date, or processing_date (configurable via start_date_field;
 * lock_date / processing_date only count loans that have that date set).
 */

import pg from "pg";

/** Snapshot day of week: 1 = Monday, 2 = Tuesday, ... 5 = Friday. */
export type SnapshotDayOfWeek = 1 | 2 | 3 | 4 | 5;

/** Which date field to use as the "start" date for counting a loan in a snapshot. */
export type StartDateField = "application_date" | "lock_date" | "processing_date";

/** Optional filters applied before counting (all selected = no filter). When any is present, snapshots are computed on the fly. */
export interface PipelineSnapshotFilters {
  loanTypes?: string[];
  loanPurposes?: string[];
  branches?: string[];
}

export function hasPipelineFilters(f: PipelineSnapshotFilters | null | undefined): boolean {
  if (!f) return false;
  return (
    (f.loanTypes != null && f.loanTypes.length > 0) ||
    (f.loanPurposes != null && f.loanPurposes.length > 0) ||
    (f.branches != null && f.branches.length > 0)
  );
}

const SNAPSHOT_DAY_NAMES: Record<SnapshotDayOfWeek, string> = {
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
};

export interface PipelineSnapshotRow {
  date: string;
  index: number;
  snapshot_weekday: string;
  year: number;
  week_value: number;
  active_units: number;
  active_volume: number;
  active_lo_count: number;
  weekly_pct_change_volume: number | null;
  monthly_pct_change_volume: number | null;
  annual_pct_change_volume: number | null;
  weekly_pct_change_units: number | null;
  monthly_pct_change_units: number | null;
  annual_pct_change_units: number | null;
  calculated_at: string | null;
}

/** Get snapshot day of week from config (1=Mon .. 5=Fri). Default 1 if table missing or empty. */
export async function getPipelineSnapshotDay(pool: pg.Pool): Promise<SnapshotDayOfWeek> {
  try {
    const r = await pool.query(
      `SELECT snapshot_day_of_week FROM public.pipeline_analysis_config WHERE id = 1`
    );
    const n = r.rows[0]?.snapshot_day_of_week;
    if (n >= 1 && n <= 5) return n as SnapshotDayOfWeek;
    // Row missing: insert default so setPipelineSnapshotDay can upsert later
    await pool.query(
      `INSERT INTO public.pipeline_analysis_config (id, snapshot_day_of_week) VALUES (1, 1) ON CONFLICT (id) DO NOTHING`
    );
  } catch {
    // table may not exist yet
  }
  return 1;
}

/** Set snapshot day of week (1–5). Ensures config row exists (upsert). Caller should then run full recalc. */
export async function setPipelineSnapshotDay(pool: pg.Pool, dayOfWeek: SnapshotDayOfWeek): Promise<void> {
  await pool.query(
    `INSERT INTO public.pipeline_analysis_config (id, snapshot_day_of_week) VALUES (1, $1)
     ON CONFLICT (id) DO UPDATE SET snapshot_day_of_week = EXCLUDED.snapshot_day_of_week`,
    [dayOfWeek]
  );
}

/** Get all dates in [start,end] that fall on the given weekday. getDay(): 0=Sun, 1=Mon, ... 5=Fri. */
export function getSnapshotDatesInRange(startDate: Date, endDate: Date, dayOfWeek: SnapshotDayOfWeek): Date[] {
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);
  const targetDay = dayOfWeek as number; // 1=Mon .. 5=Fri matches getDay()
  const out: Date[] = [];
  const cursor = new Date(start);
  while (cursor.getDay() !== targetDay) {
    cursor.setDate(cursor.getDate() + 1);
    if (cursor > end) return out;
  }
  while (cursor <= end) {
    out.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 7);
  }
  return out;
}

/** Get the most recent snapshot date (given weekday) strictly before today. */
export function getLatestSnapshotDateBeforeToday(dayOfWeek: SnapshotDayOfWeek): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(today);
  const day = d.getDay();
  const target = dayOfWeek as number;
  const daysBack = day === target ? 7 : day < target ? 7 - target + day : day - target;
  d.setDate(d.getDate() - daysBack);
  return d;
}

/** Return the snapshot date (given weekday) on or before the given date. */
function getSnapshotDateOnOrBefore(d: Date, dayOfWeek: SnapshotDayOfWeek): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay();
  const target = dayOfWeek as number;
  let daysBack = day - target;
  if (daysBack < 0) daysBack += 7;
  x.setDate(x.getDate() - daysBack);
  return x;
}

/** Get all Mondays between start and end (inclusive). Kept for backward compatibility; prefer getSnapshotDatesInRange. */
export function getMondaysInRange(startDate: Date, endDate: Date): Date[] {
  return getSnapshotDatesInRange(startDate, endDate, 1);
}

/** Get the most recent Monday strictly before today. Kept for backward compatibility. */
export function getLatestMondayBeforeToday(): Date {
  return getLatestSnapshotDateBeforeToday(1);
}

/** Return Monday on or before the given date. */
function getMondayOnOrBefore(d: Date): Date {
  return getSnapshotDateOnOrBefore(d, 1);
}

/** Get distinct loan_type, loan_purpose, branch from loans (for filter dropdowns). Excludes archived. */
export async function getPipelineFilterOptions(
  pool: pg.Pool
): Promise<{ loanTypes: string[]; loanPurposes: string[]; branches: string[] }> {
  const [typesRes, purposesRes, branchesRes] = await Promise.all([
    pool.query<{ loan_type: string }>(
      `SELECT DISTINCT loan_type FROM public.loans WHERE (is_archived IS NULL OR is_archived IS NOT TRUE) AND loan_type IS NOT NULL AND TRIM(loan_type) <> '' ORDER BY loan_type`
    ),
    pool.query<{ loan_purpose: string }>(
      `SELECT DISTINCT loan_purpose FROM public.loans WHERE (is_archived IS NULL OR is_archived IS NOT TRUE) AND loan_purpose IS NOT NULL AND TRIM(loan_purpose) <> '' ORDER BY loan_purpose`
    ),
    pool.query<{ branch: string }>(
      `SELECT DISTINCT branch FROM public.loans WHERE (is_archived IS NULL OR is_archived IS NOT TRUE) AND branch IS NOT NULL AND TRIM(branch) <> '' ORDER BY branch`
    ),
  ]);
  return {
    loanTypes: typesRes.rows.map((r) => String(r.loan_type).trim()),
    loanPurposes: purposesRes.rows.map((r) => String(r.loan_purpose).trim()),
    branches: branchesRes.rows.map((r) => String(r.branch).trim()),
  };
}

/** Compute active units, volume, and distinct LO count for a single snapshot date. */
export async function computeSnapshotForDate(
  pool: pg.Pool,
  snapshotDate: Date,
  startDateField: StartDateField = "application_date",
  filters?: PipelineSnapshotFilters | null,
  dimensionFilterClause?: string
): Promise<{ activeUnits: number; activeVolume: number; activeLoCount: number }> {
  const dateStr = formatDateForSql(snapshotDate);
  const useLockDate = startDateField === "lock_date";
  const useProcessingDate = startDateField === "processing_date";
  const startCol =
    useLockDate ? "l.lock_date"
    : useProcessingDate ? "l.processing_date"
    : "l.application_date";
  const startNotNull =
    useLockDate ? "l.lock_date IS NOT NULL"
    : useProcessingDate ? "l.processing_date IS NOT NULL"
    : "l.application_date IS NOT NULL";

  const conditions: string[] = [
    startNotNull,
    "(l.is_archived IS NULL OR l.is_archived IS NOT TRUE)",
    `(
      (TRIM(COALESCE(l.current_loan_status, '')) = 'Active Loan'
       AND ((${startCol})::date < $1::date))
      OR
      (TRIM(COALESCE(l.current_loan_status, '')) != 'Active Loan'
       AND ((${startCol})::date <= $1::date)
       AND (l.current_status_date IS NULL OR (l.current_status_date::date > $1::date)))
    )`,
  ];
  const params: unknown[] = [dateStr];
  let nextParam = 2;
  if (filters?.loanTypes != null && filters.loanTypes.length > 0) {
    conditions.push(`l.loan_type = ANY($${nextParam}::text[])`);
    params.push(filters.loanTypes);
    nextParam++;
  }
  if (filters?.loanPurposes != null && filters.loanPurposes.length > 0) {
    conditions.push(`l.loan_purpose = ANY($${nextParam}::text[])`);
    params.push(filters.loanPurposes);
    nextParam++;
  }
  if (filters?.branches != null && filters.branches.length > 0) {
    conditions.push(`l.branch = ANY($${nextParam}::text[])`);
    params.push(filters.branches);
  }

  const whereClause = conditions.join(" AND ") + (dimensionFilterClause ?? "");
  const sql = `
    WITH active_loans AS (
      SELECT l.loan_amount,
             COALESCE(l.loan_officer_id::text, NULLIF(TRIM(l.loan_officer), '')) AS lo_key
      FROM public.loans l
      WHERE ${whereClause}
    )
    SELECT
      COUNT(*)::int AS active_units,
      COALESCE(SUM(loan_amount), 0)::double precision AS active_volume,
      COUNT(DISTINCT CASE WHEN lo_key IS NOT NULL AND lo_key <> '' THEN lo_key END)::int AS active_lo_count
    FROM active_loans
  `;
  const result = await pool.query(sql, params);
  const row = result.rows[0];
  return {
    activeUnits: row ? parseInt(row.active_units, 10) || 0 : 0,
    activeVolume: row ? Number(row.active_volume) || 0 : 0,
    activeLoCount: row ? parseInt(row.active_lo_count, 10) || 0 : 0,
  };
}

function formatDateForSql(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getYear(d: Date): number {
  return d.getFullYear();
}

/** First occurrence of the given weekday (1=Mon .. 5=Fri) on or after Jan 1 of the year. */
function getFirstSnapshotDateOfYear(year: number, dayOfWeek: SnapshotDayOfWeek): Date {
  const jan1 = new Date(year, 0, 1);
  const target = dayOfWeek as number;
  const day = jan1.getDay();
  let daysToAdd = target - day;
  if (daysToAdd < 0) daysToAdd += 7;
  const first = new Date(jan1);
  first.setDate(jan1.getDate() + daysToAdd);
  return first;
}

/** First Monday on or after Jan 1 of the given year. */
function getFirstMondayOfYear(year: number): Date {
  return getFirstSnapshotDateOfYear(year, 1);
}

/**
 * Ordinal of the snapshot weekday within its calendar year: 1 = first such day of the year, etc.
 */
function getWeekValueForDay(d: Date, dayOfWeek: SnapshotDayOfWeek): number {
  const y = d.getFullYear();
  const first = getFirstSnapshotDateOfYear(y, dayOfWeek);
  const diffTime = d.getTime() - first.getTime();
  const diffDays = Math.round(diffTime / 86400000);
  if (diffDays < 0) return 1;
  const weekNo = Math.floor(diffDays / 7) + 1;
  return Math.min(weekNo, 53);
}

/** Week value for Monday (backward compat). */
function getWeekValue(d: Date): number {
  return getWeekValueForDay(d, 1);
}

/** Backfill: when day_of_week is provided, only update snapshot day config (no table). All snapshot data is computed live. */
export async function recalculatePipelineSnapshots(
  pool: pg.Pool,
  dayOfWeek?: SnapshotDayOfWeek
): Promise<void> {
  if (dayOfWeek != null) {
    await setPipelineSnapshotDay(pool, dayOfWeek);
  }
}

/**
 * No-op: pipeline snapshots are 100% live from loans. Kept for API compatibility (e.g. losSyncScheduler).
 */
export async function insertPipelineSnapshotForLatestMondayIfMissing(pool: pg.Pool): Promise<void> {
  void pool;
}

/** Get snapshots in range for API. from/to are optional ISO date strings. All snapshots are computed live from loans (no table). */
export async function getPipelineSnapshots(
  pool: pg.Pool,
  from?: string,
  to?: string,
  startDateField: StartDateField = "application_date",
  filters?: PipelineSnapshotFilters | null,
  dimensionFilterClause?: string
): Promise<PipelineSnapshotRow[]> {
  return getPipelineSnapshotsComputed(pool, from, to, startDateField, filters ?? undefined, dimensionFilterClause);
}

/** Compute snapshots on the fly from loans. Used for all snapshot requests (100% live, no table). */
async function getPipelineSnapshotsComputed(
  pool: pg.Pool,
  from?: string,
  to?: string,
  startDateField: StartDateField = "lock_date",
  filters?: PipelineSnapshotFilters,
  dimensionFilterClause?: string
): Promise<PipelineSnapshotRow[]> {
  const snapshotDay = await getPipelineSnapshotDay(pool);
  const dayName = SNAPSHOT_DAY_NAMES[snapshotDay];

  let startDate: Date;
  let endDate: Date;
  if (from && to) {
    startDate = new Date(from);
    endDate = new Date(to);
  } else {
    const startCol =
      startDateField === "lock_date"
        ? "lock_date"
        : startDateField === "processing_date"
          ? "processing_date"
          : "application_date";
    const rangeResult = await pool.query(
      `SELECT MIN(${startCol}) AS min_d FROM public.loans WHERE ${startCol} IS NOT NULL`
    );
    const minD = rangeResult.rows[0]?.min_d;
    if (!minD) return [];
    startDate = getSnapshotDateOnOrBefore(new Date(minD), snapshotDay);
    endDate = getLatestSnapshotDateBeforeToday(snapshotDay);
    if (startDate > endDate) return [];
  }
  startDate.setHours(0, 0, 0, 0);
  endDate.setHours(0, 0, 0, 0);
  const endSnapshot = getLatestSnapshotDateBeforeToday(snapshotDay);
  if (endDate > endSnapshot) endDate = new Date(endSnapshot);

  const dates = getSnapshotDatesInRange(startDate, endDate, snapshotDay);
  if (dates.length === 0) return [];

  const snapshots: Array<{ snapshotDate: Date; activeUnits: number; activeVolume: number; activeLoCount: number }> = [];
  for (const d of dates) {
    const { activeUnits, activeVolume, activeLoCount } = await computeSnapshotForDate(
      pool,
      d,
      startDateField,
      filters,
      dimensionFilterClause,
    );
    snapshots.push({ snapshotDate: d, activeUnits, activeVolume, activeLoCount });
  }

  const rows: PipelineSnapshotRow[] = [];
  for (let i = 0; i < snapshots.length; i++) {
    const s = snapshots[i];
    const prevWeekVolume = i >= 1 ? snapshots[i - 1].activeVolume : null;
    const prevMonthVolume = i >= 4 ? snapshots[i - 4].activeVolume : null;
    const prevYearVolume = i >= 52 ? snapshots[i - 52].activeVolume : null;
    const prevWeekUnits = i >= 1 ? snapshots[i - 1].activeUnits : null;
    const prevMonthUnits = i >= 4 ? snapshots[i - 4].activeUnits : null;
    const prevYearUnits = i >= 52 ? snapshots[i - 52].activeUnits : null;

    const weeklyPctVolume =
      prevWeekVolume != null && prevWeekVolume !== 0
        ? ((s.activeVolume - prevWeekVolume) / prevWeekVolume) * 100
        : null;
    const monthlyPctVolume =
      prevMonthVolume != null && prevMonthVolume !== 0
        ? ((s.activeVolume - prevMonthVolume) / prevMonthVolume) * 100
        : null;
    const annualPctVolume =
      prevYearVolume != null && prevYearVolume !== 0
        ? ((s.activeVolume - prevYearVolume) / prevYearVolume) * 100
        : null;
    const weeklyPctUnits =
      prevWeekUnits != null && prevWeekUnits !== 0
        ? ((s.activeUnits - prevWeekUnits) / prevWeekUnits) * 100
        : null;
    const monthlyPctUnits =
      prevMonthUnits != null && prevMonthUnits !== 0
        ? ((s.activeUnits - prevMonthUnits) / prevMonthUnits) * 100
        : null;
    const annualPctUnits =
      prevYearUnits != null && prevYearUnits !== 0
        ? ((s.activeUnits - prevYearUnits) / prevYearUnits) * 100
        : null;

    const dateStr = formatDateForSql(s.snapshotDate);
    rows.push({
      date: dateStr,
      index: i + 1,
      snapshot_weekday: dayName,
      year: getYear(s.snapshotDate),
      week_value: getWeekValueForDay(s.snapshotDate, snapshotDay),
      active_units: s.activeUnits,
      active_volume: s.activeVolume,
      active_lo_count: s.activeLoCount,
      weekly_pct_change_volume: weeklyPctVolume,
      monthly_pct_change_volume: monthlyPctVolume,
      annual_pct_change_volume: annualPctVolume,
      weekly_pct_change_units: weeklyPctUnits,
      monthly_pct_change_units: monthlyPctUnits,
      annual_pct_change_units: annualPctUnits,
      calculated_at: null,
    });
  }
  return rows;
}

/** Get min/max year from loans (application_date) for building year-range options. No table. */
export async function getPipelineYearRange(
  pool: pg.Pool
): Promise<{ minYear: number; maxYear: number } | null> {
  const result = await pool.query(
    `SELECT MIN(application_date) AS min_d, MAX(application_date) AS max_d FROM public.loans WHERE application_date IS NOT NULL`
  );
  const row = result.rows[0];
  if (!row || row.min_d == null || row.max_d == null) return null;
  const minYear = new Date(row.min_d).getFullYear();
  const maxYear = new Date(row.max_d).getFullYear();
  return { minYear, maxYear };
}
