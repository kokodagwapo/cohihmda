/**
 * Pipeline Analysis Service
 * Weekly snapshots on a configurable weekday (Mon–Fri): active units/volume/LO count and percent change.
 *
 * A loan is counted as "active" on snapshot date D as follows:
 * - Active loans (current_loan_status = 'Active Loan'): application_date < D (snapshot date is after application).
 * - Non-active loans (any other current_loan_status): application_date <= D and we use only current_status_date
 *   for the end date — loan is active on D if current_status_date IS NULL OR current_status_date > D.
 */

import pg from "pg";

/** Snapshot day of week: 1 = Monday, 2 = Tuesday, ... 5 = Friday. */
export type SnapshotDayOfWeek = 1 | 2 | 3 | 4 | 5;

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

/** Compute active units, volume, and distinct LO count for a single snapshot date. */
export async function computeSnapshotForDate(
  pool: pg.Pool,
  snapshotDate: Date
): Promise<{ activeUnits: number; activeVolume: number; activeLoCount: number }> {
  const dateStr = formatDateForSql(snapshotDate);
  const sql = `
    WITH active_loans AS (
      SELECT l.loan_amount,
             COALESCE(l.loan_officer_id::text, NULLIF(TRIM(l.loan_officer), '')) AS lo_key
      FROM public.loans l
      WHERE l.application_date IS NOT NULL
        AND (l.is_archived IS NULL OR l.is_archived IS NOT TRUE)
        AND (
          (TRIM(COALESCE(l.current_loan_status, '')) = 'Active Loan'
           AND (l.application_date::date < $1::date))
          OR
          (TRIM(COALESCE(l.current_loan_status, '')) != 'Active Loan'
           AND (l.application_date::date <= $1::date)
           AND (l.current_status_date IS NULL OR (l.current_status_date::date > $1::date)))
        )
    )
    SELECT
      COUNT(*)::int AS active_units,
      COALESCE(SUM(loan_amount), 0)::double precision AS active_volume,
      COUNT(DISTINCT CASE WHEN lo_key IS NOT NULL AND lo_key <> '' THEN lo_key END)::int AS active_lo_count
    FROM active_loans
  `;
  const result = await pool.query(sql, [dateStr]);
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

/** Backfill: optionally set snapshot day, wipe table, then compute and insert all snapshots for the configured weekday. */
export async function recalculatePipelineSnapshots(
  pool: pg.Pool,
  dayOfWeek?: SnapshotDayOfWeek
): Promise<void> {
  if (dayOfWeek != null) {
    await setPipelineSnapshotDay(pool, dayOfWeek);
    await pool.query(`TRUNCATE TABLE public.pipeline_analysis_snapshots`);
  }

  const snapshotDay = await getPipelineSnapshotDay(pool);

  const rangeResult = await pool.query(
    `SELECT MIN(application_date) AS min_app FROM public.loans WHERE application_date IS NOT NULL`
  );
  const minApp = rangeResult.rows[0]?.min_app;
  if (!minApp) {
    return;
  }

  const startSnapshot = getSnapshotDateOnOrBefore(new Date(minApp), snapshotDay);
  const endSnapshot = getLatestSnapshotDateBeforeToday(snapshotDay);
  if (startSnapshot > endSnapshot) {
    return;
  }

  const dates = getSnapshotDatesInRange(startSnapshot, endSnapshot, snapshotDay);
  if (dates.length === 0) return;

  const snapshots: Array<{ snapshotDate: Date; activeUnits: number; activeVolume: number; activeLoCount: number }> = [];
  for (const d of dates) {
    const { activeUnits, activeVolume, activeLoCount } = await computeSnapshotForDate(pool, d);
    snapshots.push({ snapshotDate: d, activeUnits, activeVolume, activeLoCount });
  }

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
    const year = getYear(s.snapshotDate);
    const weekValue = getWeekValueForDay(s.snapshotDate, snapshotDay);
    const snapshotIndex = i + 1;
    const dayName = SNAPSHOT_DAY_NAMES[snapshotDay];

    await pool.query(
      `INSERT INTO public.pipeline_analysis_snapshots (
        "date", index, snapshot_weekday, year, week_value, active_units, active_volume, active_lo_count,
        weekly_pct_change_volume, monthly_pct_change_volume, annual_pct_change_volume,
        weekly_pct_change_units, monthly_pct_change_units, annual_pct_change_units,
        calculated_at
      ) VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
      ON CONFLICT ("date") DO UPDATE SET
        index = EXCLUDED.index,
        snapshot_weekday = EXCLUDED.snapshot_weekday,
        year = EXCLUDED.year,
        week_value = EXCLUDED.week_value,
        active_units = EXCLUDED.active_units,
        active_volume = EXCLUDED.active_volume,
        active_lo_count = EXCLUDED.active_lo_count,
        weekly_pct_change_volume = EXCLUDED.weekly_pct_change_volume,
        monthly_pct_change_volume = EXCLUDED.monthly_pct_change_volume,
        annual_pct_change_volume = EXCLUDED.annual_pct_change_volume,
        weekly_pct_change_units = EXCLUDED.weekly_pct_change_units,
        monthly_pct_change_units = EXCLUDED.monthly_pct_change_units,
        annual_pct_change_units = EXCLUDED.annual_pct_change_units,
        calculated_at = NOW()`,
      [
        dateStr,
        snapshotIndex,
        dayName,
        year,
        weekValue,
        s.activeUnits,
        s.activeVolume,
        s.activeLoCount,
        weeklyPctVolume,
        monthlyPctVolume,
        annualPctVolume,
        weeklyPctUnits,
        monthlyPctUnits,
        annualPctUnits,
      ]
    );
  }
}

/**
 * Incremental: if the row for the most recently completed snapshot date (for configured day) does NOT exist, compute and insert it.
 */
export async function insertPipelineSnapshotForLatestMondayIfMissing(pool: pg.Pool): Promise<void> {
  const snapshotDay = await getPipelineSnapshotDay(pool);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (today.getDay() === snapshotDay) {
    return;
  }

  const latestSnapshot = getLatestSnapshotDateBeforeToday(snapshotDay);
  const dateStr = formatDateForSql(latestSnapshot);

  const existsResult = await pool.query(
    `SELECT 1 FROM public.pipeline_analysis_snapshots WHERE "date" = $1::date`,
    [dateStr]
  );
  if (existsResult.rowCount && existsResult.rowCount > 0) {
    return;
  }

  const { activeUnits, activeVolume, activeLoCount } = await computeSnapshotForDate(pool, latestSnapshot);

  const prevWeekResult = await pool.query(
    `SELECT active_volume, active_units FROM public.pipeline_analysis_snapshots
     WHERE "date" = $1::date - INTERVAL '7 days'`,
    [dateStr]
  );
  const prevMonthResult = await pool.query(
    `SELECT active_volume, active_units FROM public.pipeline_analysis_snapshots
     WHERE "date" = $1::date - INTERVAL '28 days'`,
    [dateStr]
  );
  const prevYearResult = await pool.query(
    `SELECT active_volume, active_units FROM public.pipeline_analysis_snapshots
     WHERE "date" = $1::date - INTERVAL '364 days'`,
    [dateStr]
  );

  const prevWeekVolume = prevWeekResult.rows[0]?.active_volume != null ? Number(prevWeekResult.rows[0].active_volume) : null;
  const prevMonthVolume = prevMonthResult.rows[0]?.active_volume != null ? Number(prevMonthResult.rows[0].active_volume) : null;
  const prevYearVolume = prevYearResult.rows[0]?.active_volume != null ? Number(prevYearResult.rows[0].active_volume) : null;
  const prevWeekUnits = prevWeekResult.rows[0]?.active_units != null ? Number(prevWeekResult.rows[0].active_units) : null;
  const prevMonthUnits = prevMonthResult.rows[0]?.active_units != null ? Number(prevMonthResult.rows[0].active_units) : null;
  const prevYearUnits = prevYearResult.rows[0]?.active_units != null ? Number(prevYearResult.rows[0].active_units) : null;

  const weeklyPctVolume =
    prevWeekVolume != null && prevWeekVolume !== 0 ? ((activeVolume - prevWeekVolume) / prevWeekVolume) * 100 : null;
  const monthlyPctVolume =
    prevMonthVolume != null && prevMonthVolume !== 0 ? ((activeVolume - prevMonthVolume) / prevMonthVolume) * 100 : null;
  const annualPctVolume =
    prevYearVolume != null && prevYearVolume !== 0 ? ((activeVolume - prevYearVolume) / prevYearVolume) * 100 : null;
  const weeklyPctUnits =
    prevWeekUnits != null && prevWeekUnits !== 0 ? ((activeUnits - prevWeekUnits) / prevWeekUnits) * 100 : null;
  const monthlyPctUnits =
    prevMonthUnits != null && prevMonthUnits !== 0 ? ((activeUnits - prevMonthUnits) / prevMonthUnits) * 100 : null;
  const annualPctUnits =
    prevYearUnits != null && prevYearUnits !== 0 ? ((activeUnits - prevYearUnits) / prevYearUnits) * 100 : null;

  const year = getYear(latestSnapshot);
  const weekValue = getWeekValueForDay(latestSnapshot, snapshotDay);
  const dayName = SNAPSHOT_DAY_NAMES[snapshotDay];

  const maxIndexResult = await pool.query(
    `SELECT COALESCE(MAX(index), 0) AS mx FROM public.pipeline_analysis_snapshots`
  );
  const snapshotIndex = (maxIndexResult.rows[0]?.mx ?? 0) + 1;

  await pool.query(
    `INSERT INTO public.pipeline_analysis_snapshots (
      "date", index, snapshot_weekday, year, week_value, active_units, active_volume, active_lo_count,
      weekly_pct_change_volume, monthly_pct_change_volume, annual_pct_change_volume,
      weekly_pct_change_units, monthly_pct_change_units, annual_pct_change_units,
      calculated_at
    ) VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
    ON CONFLICT ("date") DO NOTHING`,
    [dateStr, snapshotIndex, dayName, year, weekValue, activeUnits, activeVolume, activeLoCount, weeklyPctVolume, monthlyPctVolume, annualPctVolume, weeklyPctUnits, monthlyPctUnits, annualPctUnits]
  );
}

/** Get snapshots in range for API. from/to are optional ISO date strings. */
export async function getPipelineSnapshots(
  pool: pg.Pool,
  from?: string,
  to?: string
): Promise<PipelineSnapshotRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (from) {
    params.push(from);
    conditions.push(`"date" >= $${params.length}::date`);
  }
  if (to) {
    params.push(to);
    conditions.push(`"date" <= $${params.length}::date`);
  }
  const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
  const orderClause = ` ORDER BY "date" ASC`;

  const sqlWithWeekday = `SELECT "date", index, snapshot_weekday, year, week_value, active_units, active_volume, active_lo_count,
    weekly_pct_change_volume, monthly_pct_change_volume, annual_pct_change_volume,
    weekly_pct_change_units, monthly_pct_change_units, annual_pct_change_units,
    calculated_at
    FROM public.pipeline_analysis_snapshots${whereClause}${orderClause}`;

  const sqlWithoutWeekday = `SELECT "date", index, year, week_value, active_units, active_volume, active_lo_count,
    weekly_pct_change_volume, monthly_pct_change_volume, annual_pct_change_volume,
    weekly_pct_change_units, monthly_pct_change_units, annual_pct_change_units,
    calculated_at
    FROM public.pipeline_analysis_snapshots${whereClause}${orderClause}`;

  let result: pg.QueryResult;
  try {
    result = await pool.query(sqlWithWeekday, params);
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === "42703") {
      result = await pool.query(sqlWithoutWeekday, params);
    } else {
      throw err;
    }
  }

  return result.rows.map((r) => ({
    date: r.date,
    index: r.index,
    snapshot_weekday: r.snapshot_weekday ?? "Monday",
    year: r.year,
    week_value: r.week_value,
    active_units: r.active_units,
    active_volume: Number(r.active_volume),
    active_lo_count: r.active_lo_count != null ? parseInt(r.active_lo_count, 10) || 0 : 0,
    weekly_pct_change_volume: r.weekly_pct_change_volume != null ? Number(r.weekly_pct_change_volume) : null,
    monthly_pct_change_volume: r.monthly_pct_change_volume != null ? Number(r.monthly_pct_change_volume) : null,
    annual_pct_change_volume: r.annual_pct_change_volume != null ? Number(r.annual_pct_change_volume) : null,
    weekly_pct_change_units: r.weekly_pct_change_units != null ? Number(r.weekly_pct_change_units) : null,
    monthly_pct_change_units: r.monthly_pct_change_units != null ? Number(r.monthly_pct_change_units) : null,
    annual_pct_change_units: r.annual_pct_change_units != null ? Number(r.annual_pct_change_units) : null,
    calculated_at: r.calculated_at,
  }));
}

/** Get min/max year from pipeline_analysis_snapshots for building year-range options. */
export async function getPipelineYearRange(
  pool: pg.Pool
): Promise<{ minYear: number; maxYear: number } | null> {
  const result = await pool.query(
    `SELECT MIN(year) AS min_year, MAX(year) AS max_year FROM public.pipeline_analysis_snapshots`
  );
  const row = result.rows[0];
  if (!row || row.min_year == null || row.max_year == null) return null;
  return { minYear: Number(row.min_year), maxYear: Number(row.max_year) };
}
