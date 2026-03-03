/**
 * Pipeline Analysis Service
 * Weekly snapshots on a configurable weekday (Mon–Fri): active units/volume/LO count and percent change.
 *
 * A loan is counted as "active" on snapshot date D as follows:
 * - Active loans (current_loan_status = 'Active Loan'): start_date < D (snapshot date is after start).
 * - Non-active loans (any other current_loan_status): start_date <= D and we use only current_status_date
 *   for the end date — loan is active on D if current_status_date IS NULL OR current_status_date > D.
 *
 * Archived: we exclude a loan only when it is both archived AND still active. So originated/withdrawn/denied
 * loans that are archived are still counted if they were active on the snapshot date.
 *
 * Start date is application_date, lock_date, processing_date, credit_pull_date, or submitted_to_underwriting_date
 * (configurable via start_date_field; non-application_date fields only count loans that have that date set).
 */

import pg from "pg";

/** Snapshot day of week: 1 = Monday, 2 = Tuesday, ... 5 = Friday. */
export type SnapshotDayOfWeek = 1 | 2 | 3 | 4 | 5;

/** Which date field to use as the "start" date for counting a loan in a snapshot. */
export type StartDateField =
  | "application_date"
  | "lock_date"
  | "processing_date"
  | "credit_pull_date"
  | "submitted_to_underwriting_date";

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
  /** Sum of distinct processor + closer + underwriter counts (OPs). */
  active_ops_count: number;
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

/** Compute active units, volume, distinct LO count, and OPs count (distinct processor + closer + underwriter) for a single snapshot date. */
export async function computeSnapshotForDate(
  pool: pg.Pool,
  snapshotDate: Date,
  startDateField: StartDateField = "application_date",
  filters?: PipelineSnapshotFilters | null,
  dimensionFilterClause?: string
): Promise<{ activeUnits: number; activeVolume: number; activeLoCount: number; activeOpsCount: number }> {
  const dateStr = formatDateForSql(snapshotDate);
  const useLockDate = startDateField === "lock_date";
  const useProcessingDate = startDateField === "processing_date";
  const useCreditPullDate = startDateField === "credit_pull_date";
  const useSubmittedToUwDate = startDateField === "submitted_to_underwriting_date";
  const startCol =
    useLockDate ? "l.lock_date"
    : useProcessingDate ? "l.processing_date"
    : useCreditPullDate ? "l.credit_pull_date"
    : useSubmittedToUwDate ? "l.submitted_to_underwriting_date"
    : "l.application_date";
  const startNotNull =
    useLockDate ? "l.lock_date IS NOT NULL"
    : useProcessingDate ? "l.processing_date IS NOT NULL"
    : useCreditPullDate ? "l.credit_pull_date IS NOT NULL"
    : useSubmittedToUwDate ? "l.submitted_to_underwriting_date IS NOT NULL"
    : "l.application_date IS NOT NULL";

  const conditions: string[] = [
    startNotNull,
    "(l.is_archived IS NULL OR l.is_archived IS NOT TRUE OR TRIM(COALESCE(l.current_loan_status, '')) <> 'Active Loan')",
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
             COALESCE(l.loan_officer_id::text, NULLIF(TRIM(l.loan_officer), '')) AS lo_key,
             NULLIF(TRIM(l.processor), '') AS processor,
             NULLIF(TRIM(l.underwriter), '') AS underwriter,
             NULLIF(TRIM(l.closer), '') AS closer
      FROM public.loans l
      WHERE ${whereClause}
    )
    SELECT
      COUNT(*)::int AS active_units,
      COALESCE(SUM(loan_amount), 0)::double precision AS active_volume,
      COUNT(DISTINCT CASE WHEN lo_key IS NOT NULL AND lo_key <> '' THEN lo_key END)::int AS active_lo_count,
      ((SELECT COUNT(DISTINCT processor) FROM active_loans WHERE processor IS NOT NULL)
       + (SELECT COUNT(DISTINCT underwriter) FROM active_loans WHERE underwriter IS NOT NULL)
       + (SELECT COUNT(DISTINCT closer) FROM active_loans WHERE closer IS NOT NULL))::int AS active_ops_count
    FROM active_loans
  `;
  const result = await pool.query(sql, params);
  const row = result.rows[0];
  return {
    activeUnits: row ? parseInt(row.active_units, 10) || 0 : 0,
    activeVolume: row ? Number(row.active_volume) || 0 : 0,
    activeLoCount: row ? parseInt(row.active_lo_count, 10) || 0 : 0,
    activeOpsCount: row ? parseInt(row.active_ops_count, 10) || 0 : 0,
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
          : startDateField === "credit_pull_date"
            ? "credit_pull_date"
            : startDateField === "submitted_to_underwriting_date"
              ? "submitted_to_underwriting_date"
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

  const snapshots: Array<{ snapshotDate: Date; activeUnits: number; activeVolume: number; activeLoCount: number; activeOpsCount: number }> = [];
  for (const d of dates) {
    const { activeUnits, activeVolume, activeLoCount, activeOpsCount } = await computeSnapshotForDate(
      pool,
      d,
      startDateField,
      filters,
      dimensionFilterClause,
    );
    snapshots.push({ snapshotDate: d, activeUnits, activeVolume, activeLoCount, activeOpsCount });
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
      active_ops_count: s.activeOpsCount,
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

/** Row shape for pipeline loan detail table. */
export interface PipelineLoanDetailRow {
  loan_id: string;
  loan_number: string | null;
  loan_amount: number | null;
  loan_type: string | null;
  loan_purpose: string | null;
  current_loan_status: string | null;
  start_date: string | null;
  current_status_date: string | null;
  fico_score: number | null;
  ltv_ratio: number | null;
  be_dti_ratio: number | null;
  loan_officer: string | null;
  processor: string | null;
  underwriter: string | null;
  closer: string | null;
}

/**
 * Get loans whose [start date field] falls within [from, to], with same filters as snapshots.
 * Used for the pipeline analysis loan detail table.
 * @deprecated Use getPipelineLoansActiveInRange so the list matches all loans counted in pipeline snapshots.
 */
export async function getPipelineLoansInRange(
  pool: pg.Pool,
  from: string,
  to: string,
  startDateField: StartDateField = "application_date",
  filters?: PipelineSnapshotFilters | null,
  dimensionFilterClause?: string
): Promise<PipelineLoanDetailRow[]> {
  const useLockDate = startDateField === "lock_date";
  const useProcessingDate = startDateField === "processing_date";
  const useCreditPullDate = startDateField === "credit_pull_date";
  const useSubmittedToUwDate = startDateField === "submitted_to_underwriting_date";
  const startCol =
    useLockDate ? "l.lock_date"
    : useProcessingDate ? "l.processing_date"
    : useCreditPullDate ? "l.credit_pull_date"
    : useSubmittedToUwDate ? "l.submitted_to_underwriting_date"
    : "l.application_date";
  const startNotNull =
    useLockDate ? "l.lock_date IS NOT NULL"
    : useProcessingDate ? "l.processing_date IS NOT NULL"
    : useCreditPullDate ? "l.credit_pull_date IS NOT NULL"
    : useSubmittedToUwDate ? "l.submitted_to_underwriting_date IS NOT NULL"
    : "l.application_date IS NOT NULL";

  const conditions: string[] = [
    startNotNull,
    "(l.is_archived IS NULL OR l.is_archived IS NOT TRUE OR TRIM(COALESCE(l.current_loan_status, '')) <> 'Active Loan')",
    `((${startCol})::date >= $1::date AND (${startCol})::date <= $2::date)`,
  ];
  const params: unknown[] = [from, to];
  let nextParam = 3;
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
    nextParam++;
  }

  const whereClause = conditions.join(" AND ") + (dimensionFilterClause ?? "");
  const sql = `
    SELECT
      l.loan_id,
      l.loan_number,
      l.loan_amount,
      l.loan_type,
      l.loan_purpose,
      l.current_loan_status,
      (${startCol})::date::text AS start_date,
      l.current_status_date::text AS current_status_date,
      l.fico_score,
      l.ltv_ratio,
      l.be_dti_ratio,
      l.loan_officer,
      l.processor,
      l.underwriter,
      l.closer
    FROM public.loans l
    WHERE ${whereClause}
    ORDER BY (${startCol})::date DESC NULLS LAST, l.loan_id
  `;
  const result = await pool.query(sql, params);
  return result.rows.map((r: Record<string, unknown>) => ({
    loan_id: String(r.loan_id ?? ""),
    loan_number: r.loan_number != null ? String(r.loan_number) : null,
    loan_amount: r.loan_amount != null ? Number(r.loan_amount) : null,
    loan_type: r.loan_type != null ? String(r.loan_type) : null,
    loan_purpose: r.loan_purpose != null ? String(r.loan_purpose) : null,
    current_loan_status: r.current_loan_status != null ? String(r.current_loan_status) : null,
    start_date: r.start_date != null ? String(r.start_date) : null,
    current_status_date: r.current_status_date != null ? String(r.current_status_date) : null,
    fico_score: r.fico_score != null ? Number(r.fico_score) : null,
    ltv_ratio: r.ltv_ratio != null ? Number(r.ltv_ratio) : null,
    be_dti_ratio: r.be_dti_ratio != null ? Number(r.be_dti_ratio) : null,
    loan_officer: r.loan_officer != null ? String(r.loan_officer) : null,
    processor: r.processor != null ? String(r.processor) : null,
    underwriter: r.underwriter != null ? String(r.underwriter) : null,
    closer: r.closer != null ? String(r.closer) : null,
  }));
}

/**
 * Get all loans that are active on at least one snapshot date in [from, to].
 * Uses the same "active on snapshot date D" logic as computeSnapshotForDate, so the list
 * matches exactly the loans that are counted in the pipeline analysis (units/volume/LO/OPs).
 * Snapshot dates are computed from the configured snapshot day (e.g. first Monday of 2025, etc.).
 * When snapshotDatesOverride is provided (non-empty), only those dates are used instead of all dates in [from, to].
 */
export async function getPipelineLoansActiveInRange(
  pool: pg.Pool,
  from: string,
  to: string,
  startDateField: StartDateField = "application_date",
  filters?: PipelineSnapshotFilters | null,
  dimensionFilterClause?: string,
  snapshotDatesOverride?: string[] | null
): Promise<PipelineLoanDetailRow[]> {
  let dateStrings: string[];
  if (snapshotDatesOverride != null && snapshotDatesOverride.length > 0) {
    dateStrings = snapshotDatesOverride.filter((d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.trim()));
    if (dateStrings.length === 0) return [];
  } else {
    const snapshotDay = await getPipelineSnapshotDay(pool);
    const startDate = new Date(from);
    const endDate = new Date(to);
    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(0, 0, 0, 0);
    const dates = getSnapshotDatesInRange(startDate, endDate, snapshotDay);
    if (dates.length === 0) return [];
    dateStrings = dates.map((d) => formatDateForSql(d));
  }

  const useLockDate = startDateField === "lock_date";
  const useProcessingDate = startDateField === "processing_date";
  const useCreditPullDate = startDateField === "credit_pull_date";
  const useSubmittedToUwDate = startDateField === "submitted_to_underwriting_date";
  const startCol =
    useLockDate ? "l.lock_date"
    : useProcessingDate ? "l.processing_date"
    : useCreditPullDate ? "l.credit_pull_date"
    : useSubmittedToUwDate ? "l.submitted_to_underwriting_date"
    : "l.application_date";
  const startNotNull =
    useLockDate ? "l.lock_date IS NOT NULL"
    : useProcessingDate ? "l.processing_date IS NOT NULL"
    : useCreditPullDate ? "l.credit_pull_date IS NOT NULL"
    : useSubmittedToUwDate ? "l.submitted_to_underwriting_date IS NOT NULL"
    : "l.application_date IS NOT NULL";

  const conditions: string[] = [
    startNotNull,
    "(l.is_archived IS NULL OR l.is_archived IS NOT TRUE OR TRIM(COALESCE(l.current_loan_status, '')) <> 'Active Loan')",
    `EXISTS (
      SELECT 1 FROM unnest($1::text[]) AS d
      WHERE (
        (TRIM(COALESCE(l.current_loan_status, '')) = 'Active Loan' AND (${startCol})::date < (d::date))
        OR
        (TRIM(COALESCE(l.current_loan_status, '')) != 'Active Loan'
         AND (${startCol})::date <= (d::date)
         AND (l.current_status_date IS NULL OR l.current_status_date::date > (d::date)))
      )
    )`,
  ];
  const params: unknown[] = [dateStrings];
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
    nextParam++;
  }

  const whereClause = conditions.join(" AND ") + (dimensionFilterClause ?? "");
  const sql = `
    SELECT
      l.loan_id,
      l.loan_number,
      l.loan_amount,
      l.loan_type,
      l.loan_purpose,
      l.current_loan_status,
      (${startCol})::date::text AS start_date,
      l.current_status_date::text AS current_status_date,
      l.fico_score,
      l.ltv_ratio,
      l.be_dti_ratio,
      l.loan_officer,
      l.processor,
      l.underwriter,
      l.closer
    FROM public.loans l
    WHERE ${whereClause}
    ORDER BY (${startCol})::date DESC NULLS LAST, l.loan_id
  `;
  const result = await pool.query(sql, params);
  return result.rows.map((r: Record<string, unknown>) => ({
    loan_id: String(r.loan_id ?? ""),
    loan_number: r.loan_number != null ? String(r.loan_number) : null,
    loan_amount: r.loan_amount != null ? Number(r.loan_amount) : null,
    loan_type: r.loan_type != null ? String(r.loan_type) : null,
    loan_purpose: r.loan_purpose != null ? String(r.loan_purpose) : null,
    current_loan_status: r.current_loan_status != null ? String(r.current_loan_status) : null,
    start_date: r.start_date != null ? String(r.start_date) : null,
    current_status_date: r.current_status_date != null ? String(r.current_status_date) : null,
    fico_score: r.fico_score != null ? Number(r.fico_score) : null,
    ltv_ratio: r.ltv_ratio != null ? Number(r.ltv_ratio) : null,
    be_dti_ratio: r.be_dti_ratio != null ? Number(r.be_dti_ratio) : null,
    loan_officer: r.loan_officer != null ? String(r.loan_officer) : null,
    processor: r.processor != null ? String(r.processor) : null,
    underwriter: r.underwriter != null ? String(r.underwriter) : null,
    closer: r.closer != null ? String(r.closer) : null,
  }));
}

/** 30-year fixed loan_program match: contains "30 year fixed" or "30 yr fixed" (case-insensitive). */
const LOAN_PROGRAM_30_YEAR_FIXED_CONDITION = `(
  LOWER(COALESCE(l.loan_program, '')) LIKE '%30 year fixed%'
  OR LOWER(COALESCE(l.loan_program, '')) LIKE '%30 yr fixed%'
)`;

/**
 * Compute weighted average interest rate for 30-year fixed loans active on each snapshot date.
 * Formula: sum(interest_rate * loan_amount) / sum(loan_amount) per date.
 * Returns one entry per snapshot date; weighted_avg_rate is null when no qualifying loans.
 */
export async function getPipeline30YearFixedWeightedRates(
  pool: pg.Pool,
  from: string,
  to: string,
  startDateField: StartDateField = "application_date",
  filters?: PipelineSnapshotFilters | null,
  dimensionFilterClause?: string,
  snapshotDatesOverride?: string[] | null
): Promise<Array<{ date: string; weighted_avg_rate: number | null }>> {
  let dateStrings: string[];
  if (snapshotDatesOverride != null && snapshotDatesOverride.length > 0) {
    dateStrings = snapshotDatesOverride.filter((d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.trim()));
    if (dateStrings.length === 0) return [];
  } else {
    const snapshotDay = await getPipelineSnapshotDay(pool);
    const startDate = new Date(from);
    const endDate = new Date(to);
    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(0, 0, 0, 0);
    const dates = getSnapshotDatesInRange(startDate, endDate, snapshotDay);
    if (dates.length === 0) return [];
    dateStrings = dates.map((d) => formatDateForSql(d));
  }

  const useLockDate = startDateField === "lock_date";
  const useProcessingDate = startDateField === "processing_date";
  const useCreditPullDate = startDateField === "credit_pull_date";
  const useSubmittedToUwDate = startDateField === "submitted_to_underwriting_date";
  const startCol =
    useLockDate ? "l.lock_date"
    : useProcessingDate ? "l.processing_date"
    : useCreditPullDate ? "l.credit_pull_date"
    : useSubmittedToUwDate ? "l.submitted_to_underwriting_date"
    : "l.application_date";
  const startNotNull =
    useLockDate ? "l.lock_date IS NOT NULL"
    : useProcessingDate ? "l.processing_date IS NOT NULL"
    : useCreditPullDate ? "l.credit_pull_date IS NOT NULL"
    : useSubmittedToUwDate ? "l.submitted_to_underwriting_date IS NOT NULL"
    : "l.application_date IS NOT NULL";

  const baseConditions: string[] = [
    startNotNull,
    "(l.is_archived IS NULL OR l.is_archived IS NOT TRUE OR TRIM(COALESCE(l.current_loan_status, '')) <> 'Active Loan')",
    "l.interest_rate IS NOT NULL AND l.interest_rate > 0 AND l.interest_rate <= 15",
    "l.loan_amount IS NOT NULL AND l.loan_amount > 0",
    LOAN_PROGRAM_30_YEAR_FIXED_CONDITION,
  ];
  let nextParam = 1;
  if (filters?.loanTypes != null && filters.loanTypes.length > 0) {
    baseConditions.push(`l.loan_type = ANY($${nextParam}::text[])`);
    nextParam++;
  }
  if (filters?.loanPurposes != null && filters.loanPurposes.length > 0) {
    baseConditions.push(`l.loan_purpose = ANY($${nextParam}::text[])`);
    nextParam++;
  }
  if (filters?.branches != null && filters.branches.length > 0) {
    baseConditions.push(`l.branch = ANY($${nextParam}::text[])`);
    nextParam++;
  }
  const baseWhere = baseConditions.join(" AND ") + (dimensionFilterClause ?? "");
  const baseParams: unknown[] = [];
  if (filters?.loanTypes?.length) baseParams.push(filters.loanTypes);
  if (filters?.loanPurposes?.length) baseParams.push(filters.loanPurposes);
  if (filters?.branches?.length) baseParams.push(filters.branches);

  const results: Array<{ date: string; weighted_avg_rate: number | null }> = [];
  for (const dateStr of dateStrings) {
    const conditions = [
      baseWhere,
      `(
        (TRIM(COALESCE(l.current_loan_status, '')) = 'Active Loan' AND (${startCol})::date < $${nextParam}::date)
        OR
        (TRIM(COALESCE(l.current_loan_status, '')) != 'Active Loan'
         AND (${startCol})::date <= $${nextParam}::date
         AND (l.current_status_date IS NULL OR l.current_status_date::date > $${nextParam}::date))
      )`,
    ].join(" AND ");
    const params = [...baseParams, dateStr];
    const sql = `
      SELECT
        SUM(l.interest_rate * l.loan_amount)::double precision / NULLIF(SUM(l.loan_amount), 0) AS weighted_avg_rate
      FROM public.loans l
      WHERE ${conditions}
    `;
    const result = await pool.query(sql, params);
    const row = result.rows[0];
    const rate = row?.weighted_avg_rate != null && Number.isFinite(Number(row.weighted_avg_rate))
      ? Number(row.weighted_avg_rate)
      : null;
    results.push({ date: dateStr, weighted_avg_rate: rate });
  }
  return results;
}
