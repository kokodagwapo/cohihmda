import type { Pool } from "pg";
import type {
  DashboardInsight,
  DashboardPageContext,
  SupportingData,
  SupportingDataByPeriodRow,
} from "./types.js";
import type { EvidenceIntent } from "./evidenceProfiles.js";
import { selectDefaultEvidenceIntent } from "./evidenceProfileSelector.js";
import { executeEvidenceIntent, type EvidenceQueryProvider } from "./evidenceQueryExecutor.js";
import { queryCreditRiskDrilldownLoans } from "../metrics/metricsService.js";

type CreditRiskPeriodApplicationData = {
  kpis?: {
    units?: number;
    volume?: number;
    wac?: number;
    waFico?: number;
    waLtv?: number;
    waDti?: number;
  };
  creditRiskStory?: {
    conventionalQualifiedPercent?: number;
    governmentQualifiedPercent?: number;
  };
  distributions?: {
    fico?: Array<{ range?: string; units?: number; percentage?: number; volume?: number }>;
    ltv?: Array<{ range?: string; units?: number; percentage?: number; volume?: number }>;
    dti?: Array<{ range?: string; units?: number; percentage?: number; volume?: number }>;
  };
  loanMix?: {
    byType?: Array<{
      category?: string;
      units?: number;
      unitsPercent?: number;
      volume?: number;
      volumePercent?: number;
      wac?: number;
      waFico?: number;
      waLtv?: number;
      waDti?: number;
    }>;
    byPurpose?: Array<{
      category?: string;
      units?: number;
      unitsPercent?: number;
      volume?: number;
      volumePercent?: number;
      wac?: number;
      waFico?: number;
      waLtv?: number;
      waDti?: number;
    }>;
    byOccupancy?: Array<{
      category?: string;
      units?: number;
      unitsPercent?: number;
      volume?: number;
      volumePercent?: number;
      wac?: number;
      waFico?: number;
      waLtv?: number;
      waDti?: number;
    }>;
  };
};

type CreditRiskPeriodData = {
  periodLabel?: string;
  dateRange?: string;
  byApplicationType?: Record<string, CreditRiskPeriodApplicationData>;
};

const supportingDataCache = new WeakMap<
  DashboardPageContext,
  Map<string, Promise<SupportingData | undefined>>
>();

function toUpperPeriod(value: string): string {
  const raw = String(value).trim();
  if (/^y_\d{4}$/i.test(raw)) return raw.toUpperCase();
  return raw.toUpperCase();
}

function parseDateRange(raw?: string): { start: string; end: string } | null {
  if (!raw || typeof raw !== "string") return null;
  const parts = raw.split("to").map((p) => p.trim());
  if (parts.length !== 2) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(parts[0]) || !/^\d{4}-\d{2}-\d{2}$/.test(parts[1])) return null;
  return { start: parts[0], end: parts[1] };
}

function resolveDateFieldAndFilters(applicationType: string): {
  dateField: string;
  additionalFilters: Record<string, unknown>;
} {
  if (applicationType === "Funded Production") {
    return { dateField: "funding_date", additionalFilters: {} };
  }
  if (applicationType === "Lost Opportunities") {
    return { dateField: "any_date", additionalFilters: { withdrawn_filter: true } };
  }
  if (applicationType === "All Loans") {
    return { dateField: "any_date", additionalFilters: {} };
  }
  return { dateField: "application_date", additionalFilters: {} };
}

function getPrimaryRef(insight: DashboardInsight) {
  return insight.evidence_refs?.find((r) => r.role === "primary") ?? insight.evidence_refs?.[0];
}

function getFocusPeriodKey(datePeriod?: string): string | undefined {
  return datePeriod ? toUpperPeriod(datePeriod) : undefined;
}

function getPeriodRank(period: string): number {
  const p = period.toUpperCase();
  if (p === "L13M") return 1;
  if (p === "L12M") return 2;
  if (p === "YTD") return 3;
  const y = p.match(/^Y_(\d{4})$/);
  if (y) return 10000 - Number(y[1]);
  return 99999;
}

function getOrderedPeriods(
  byPeriod: Record<string, CreditRiskPeriodData>,
  focusPeriod?: string
): Array<[string, CreditRiskPeriodData]> {
  const entries = Object.entries(byPeriod).sort((a, b) => getPeriodRank(a[0]) - getPeriodRank(b[0]));
  if (!focusPeriod) return entries;
  const idx = entries.findIndex(([k]) => k === focusPeriod);
  if (idx <= 0) return entries;
  const [focused] = entries.splice(idx, 1);
  return [focused, ...entries];
}

function inferWidgetAndTargetFromInsight(
  insight: DashboardInsight,
  baseWidgetId?: string,
  baseTargetLabel?: string
): { widgetId?: string; targetLabel?: string } {
  if (baseWidgetId && (baseTargetLabel || baseWidgetId === "credit-risk-kpi-cards" || baseWidgetId === "credit-risk-story-panel")) {
    return { widgetId: baseWidgetId, targetLabel: baseTargetLabel };
  }
  const text = `${insight.headline} ${insight.understory}`.toLowerCase();
  const clean = (s: string) => s.replace(/\s+/g, "");

  // Distribution intent inference
  if (text.includes("dti")) {
    const m = insight.headline.match(/(>50\.00|43\.01-50\.00|36\.01-43\.00|28\.01-36\.00|0\.01-28\.00|Values<=0)/i);
    const target = m?.[1] ?? (text.includes("> 50") || text.includes("over 50") ? ">50.00" : undefined);
    return { widgetId: "credit-risk-dti-distribution", targetLabel: target };
  }
  if (text.includes("ltv")) {
    const m = insight.headline.match(/(>100|90\.01-100\.00|80\.01-90\.00|75\.01-80\.00|60\.01-75\.00|0\.01-60\.00|0-Values)/i);
    const target =
      m?.[1] ??
      (text.includes("over 90") || text.includes("> 90") ? "90.01-100.00" : undefined);
    return { widgetId: "credit-risk-ltv-distribution", targetLabel: target };
  }
  if (text.includes("fico")) {
    const m = insight.headline.match(/(800-850|750-799|680-749|620-679|580-619|<580|Missing\/Invalid)/i);
    return { widgetId: "credit-risk-fico-distribution", targetLabel: m?.[1] ? clean(m[1]) : undefined };
  }
  if (
    text.includes("loan type") ||
    text.includes("loan purpose") ||
    text.includes("occupancy") ||
    text.includes("fha") ||
    text.includes("conventional")
  ) {
    return { widgetId: "credit-risk-loan-mix-table", targetLabel: baseTargetLabel };
  }
  return { widgetId: baseWidgetId, targetLabel: baseTargetLabel };
}

type CohortMetrics = {
  units: number;
  volume: number;
  unitsPercent: number;
  volumePercent: number;
  waFico: number;
  waLtv: number;
  waDti: number;
  originatedPercent: number;
  deniedPercent: number;
  withdrawnPercent: number;
  activePercent: number;
};

type CohortStatusPercents = Pick<
  CohortMetrics,
  "originatedPercent" | "deniedPercent" | "withdrawnPercent" | "activePercent"
>;

function toDateExpr(dateField: string): string {
  if (dateField === "funding_date") return "DATE(l.funding_date)";
  if (dateField === "application_date") return "DATE(l.application_date)";
  return "DATE(COALESCE(l.application_date, l.funding_date, l.started_date, l.closing_date, l.lock_date))";
}

function getCohortFilterSql(
  widgetId: string,
  targetLabel: string,
  loanMixDimension?: string
): { clause: string; params: unknown[] } {
  const target = String(targetLabel).trim();
  if (!target) return { clause: "", params: [] };

  if (widgetId === "credit-risk-dti-distribution") {
    if (target === ">50.00") return { clause: "l.be_dti_ratio IS NOT NULL AND l.be_dti_ratio > 50", params: [] };
    if (target === "Values<=0") return { clause: "(l.be_dti_ratio IS NULL OR l.be_dti_ratio <= 0)", params: [] };
    const m = target.match(/^([\d.]+)-([\d.]+)$/);
    if (m) return { clause: "l.be_dti_ratio IS NOT NULL AND l.be_dti_ratio > $3 AND l.be_dti_ratio <= $4", params: [Number(m[1]), Number(m[2])] };
  }
  if (widgetId === "credit-risk-ltv-distribution") {
    if (target === ">100") return { clause: "l.ltv_ratio IS NOT NULL AND l.ltv_ratio > 100", params: [] };
    if (target === "0-Values") return { clause: "(l.ltv_ratio IS NULL OR l.ltv_ratio <= 0)", params: [] };
    const m = target.match(/^([\d.]+)-([\d.]+)$/);
    if (m) return { clause: "l.ltv_ratio IS NOT NULL AND l.ltv_ratio > $3 AND l.ltv_ratio <= $4", params: [Number(m[1]), Number(m[2])] };
  }
  if (widgetId === "credit-risk-fico-distribution") {
    if (target === "<580") return { clause: "l.fico_score IS NOT NULL AND l.fico_score >= 350 AND l.fico_score < 580", params: [] };
    if (target === "Missing/Invalid") return { clause: "(l.fico_score IS NULL OR l.fico_score < 350)", params: [] };
    const m = target.match(/^(\d+)-(\d+)$/);
    if (m) return { clause: "l.fico_score >= $3 AND l.fico_score <= $4", params: [Number(m[1]), Number(m[2])] };
  }
  if (widgetId === "credit-risk-loan-mix-table") {
    const col =
      loanMixDimension === "loan_purpose"
        ? "loan_purpose"
        : loanMixDimension === "occupancy"
          ? "occupancy_type"
          : "loan_type";
    return { clause: `COALESCE(NULLIF(TRIM(l.${col}::text), ''), 'Other') = $3`, params: [target] };
  }
  return { clause: "", params: [] };
}

function inferLoanMixDimension(
  byPeriod: Record<string, CreditRiskPeriodData>,
  applicationType: string,
  targetLabel?: string,
  preferred?: string
): "loan_type" | "loan_purpose" | "occupancy" {
  if (preferred === "loan_type" || preferred === "loan_purpose" || preferred === "occupancy") {
    return preferred;
  }
  const target = (targetLabel || "").trim();
  if (!target) return "loan_type";
  for (const [, period] of Object.entries(byPeriod)) {
    const app = period.byApplicationType?.[applicationType];
    if (!app?.loanMix) continue;
    if (app.loanMix.byType?.some((r) => r.category === target)) return "loan_type";
    if (app.loanMix.byPurpose?.some((r) => r.category === target)) return "loan_purpose";
    if (app.loanMix.byOccupancy?.some((r) => r.category === target)) return "occupancy";
  }
  return "loan_type";
}

async function queryCohortMetricsForPeriod(
  tenantPool: Pool,
  periodData: CreditRiskPeriodData,
  intent: EvidenceIntent
): Promise<CohortMetrics | null> {
  const parsed = parseDateRange(periodData.dateRange);
  if (!parsed) return null;
  const appType = intent.applicationType || "Applications Taken";
  const { dateField, additionalFilters } = resolveDateFieldAndFilters(appType);
  const dateExpr = toDateExpr(dateField);
  const widgetId = intent.widgetId || "";
  const target = intent.targetLabel || "";
  const cohortFilter = getCohortFilterSql(widgetId, target, intent.loanMixDimension);
  if (!cohortFilter.clause) return null;

  const withdrawnOnly =
    Boolean((additionalFilters as { withdrawn_filter?: unknown }).withdrawn_filter);

  const statusClause = withdrawnOnly
    ? "AND (l.current_loan_status ILIKE '%withdraw%' OR l.current_loan_status ILIKE '%not accepted%' OR l.current_loan_status ILIKE '%incomp%')"
    : "";

  const query = `
    WITH base AS (
      SELECT
        l.loan_amount,
        l.fico_score,
        l.ltv_ratio,
        l.be_dti_ratio,
        l.current_loan_status,
        l.loan_type,
        l.loan_purpose,
        l.occupancy_type
      FROM public.loans l
      WHERE ${dateExpr} BETWEEN $1::date AND $2::date
        ${statusClause}
    ),
    cohort AS (
      SELECT * FROM base l WHERE ${cohortFilter.clause}
    ),
    totals AS (
      SELECT COUNT(*)::float AS total_units, COALESCE(SUM(loan_amount),0)::float AS total_volume FROM base
    )
    SELECT
      COUNT(*)::int AS units,
      COALESCE(SUM(c.loan_amount), 0)::float AS volume,
      ROUND((COUNT(*) * 100.0 / NULLIF((SELECT total_units FROM totals), 0))::numeric, 1) AS units_percent,
      ROUND((COALESCE(SUM(c.loan_amount), 0) * 100.0 / NULLIF((SELECT total_volume FROM totals), 0))::numeric, 1) AS volume_percent,
      ROUND(
        SUM(CASE WHEN c.fico_score >= 350 AND c.fico_score <= 900 THEN c.fico_score * c.loan_amount ELSE 0 END) /
        NULLIF(SUM(CASE WHEN c.fico_score >= 350 AND c.fico_score <= 900 THEN c.loan_amount ELSE 0 END), 0)::numeric, 0
      ) AS wa_fico,
      ROUND(
        SUM(CASE WHEN c.ltv_ratio >= 0 AND c.ltv_ratio <= 110 THEN c.ltv_ratio * c.loan_amount ELSE 0 END) /
        NULLIF(SUM(CASE WHEN c.ltv_ratio >= 0 AND c.ltv_ratio <= 110 THEN c.loan_amount ELSE 0 END), 0)::numeric, 1
      ) AS wa_ltv,
      ROUND(
        SUM(CASE WHEN c.be_dti_ratio >= 0 AND c.be_dti_ratio <= 70 THEN c.be_dti_ratio * c.loan_amount ELSE 0 END) /
        NULLIF(SUM(CASE WHEN c.be_dti_ratio >= 0 AND c.be_dti_ratio <= 70 THEN c.loan_amount ELSE 0 END), 0)::numeric, 1
      ) AS wa_dti,
      ROUND(
        COUNT(
          CASE
            WHEN c.current_loan_status ILIKE '%originated%'
              OR c.current_loan_status ILIKE '%purchased%'
              OR c.current_loan_status ILIKE '%funded%'
            THEN 1
          END
        ) * 100.0 /
        NULLIF(COUNT(*), 0)::numeric, 1
      ) AS originated_percent,
      ROUND(
        COUNT(CASE WHEN c.current_loan_status ILIKE '%denied%' OR c.current_loan_status ILIKE '%declin%' THEN 1 END) * 100.0 /
        NULLIF(COUNT(*), 0)::numeric, 1
      ) AS denied_percent,
      ROUND(
        COUNT(
          CASE
            WHEN c.current_loan_status ILIKE '%withdraw%'
              OR c.current_loan_status ILIKE '%not accepted%'
              OR c.current_loan_status ILIKE '%incomp%'
              OR c.current_loan_status ILIKE '%cancel%'
            THEN 1
          END
        ) * 100.0 /
        NULLIF(COUNT(*), 0)::numeric, 1
      ) AS withdrawn_percent,
      ROUND(
        COUNT(CASE WHEN c.current_loan_status ILIKE '%active%' THEN 1 END) * 100.0 /
        NULLIF(COUNT(*), 0)::numeric, 1
      ) AS active_percent
    FROM cohort c
  `;

  const params = [parsed.start, parsed.end, ...cohortFilter.params];
  try {
    const result = await tenantPool.query(query, params);
    const row = result.rows[0];
    if (!row) return null;
    return {
      units: Number(row.units) || 0,
      volume: Number(row.volume) || 0,
      unitsPercent: Number(row.units_percent) || 0,
      volumePercent: Number(row.volume_percent) || 0,
      waFico: Number(row.wa_fico) || 0,
      waLtv: Number(row.wa_ltv) || 0,
      waDti: Number(row.wa_dti) || 0,
      originatedPercent: Number(row.originated_percent) || 0,
      deniedPercent: Number(row.denied_percent) || 0,
      withdrawnPercent: Number(row.withdrawn_percent) || 0,
      activePercent: Number(row.active_percent) || 0,
    };
  } catch (error) {
    // Some tenant schemas can miss optional categorical columns used by loan-mix filters.
    // In that case, keep evidence generation alive and fall back to context-based values.
    const code = (error as { code?: string } | undefined)?.code;
    if (code === "42703") return null;
    throw error;
  }
}

async function queryCohortStatusPercentsFromDrilldown(
  tenantPool: Pool,
  periodData: CreditRiskPeriodData,
  intent: EvidenceIntent,
  resolvedLoanMixDimension?: "loan_type" | "loan_purpose" | "occupancy",
  resolvedTargetLabel?: string
): Promise<CohortStatusPercents | null> {
  if (!intent.widgetId) return null;
  const parsed = parseDateRange(periodData.dateRange);
  if (!parsed) return null;
  const appType = intent.applicationType || "Applications Taken";
  const { dateField, additionalFilters } = resolveDateFieldAndFilters(appType);
  const filterValue = (resolvedTargetLabel ?? intent.targetLabel ?? "").trim();
  if (!filterValue) return null;

  const filterType =
    intent.widgetId === "credit-risk-fico-distribution"
      ? "fico"
      : intent.widgetId === "credit-risk-ltv-distribution"
        ? "ltv"
        : intent.widgetId === "credit-risk-dti-distribution"
          ? "dti"
          : intent.widgetId === "credit-risk-loan-mix-table"
            ? (resolvedLoanMixDimension === "loan_purpose"
                ? "loan_purpose"
                : resolvedLoanMixDimension === "occupancy"
                  ? "occupancy_type"
                  : "loan_type")
            : null;
  if (!filterType) return null;

  const loans = await queryCreditRiskDrilldownLoans(tenantPool, {
    dateRange: parsed,
    dateField,
    additionalFilters,
    filterType,
    filterValue,
  });
  if (!loans.length) return null;

  const total = loans.length;
  const statusOf = (s: unknown) => String(s ?? "").toLowerCase();
  const originated = loans.filter((l) => {
    const s = statusOf(l.status);
    return s.includes("originated") || s.includes("purchased") || s.includes("funded");
  }).length;
  const denied = loans.filter((l) => {
    const s = statusOf(l.status);
    return s.includes("denied") || s.includes("declin");
  }).length;
  const withdrawn = loans.filter((l) => {
    const s = statusOf(l.status);
    return (
      s.includes("withdraw") ||
      s.includes("not accepted") ||
      s.includes("incomp") ||
      s.includes("cancel")
    );
  }).length;
  const active = loans.filter((l) => statusOf(l.status).includes("active")).length;

  const pct = (n: number) => Number(((n * 100) / total).toFixed(1));
  return {
    originatedPercent: pct(originated),
    deniedPercent: pct(denied),
    withdrawnPercent: pct(withdrawn),
    activePercent: pct(active),
  };
}

export function selectCreditRiskEvidenceIntent(
  insight: DashboardInsight
): EvidenceIntent {
  const base = selectDefaultEvidenceIntent({
    pageId: "credit-risk-management",
    insight,
  });
  const inferred = inferWidgetAndTargetFromInsight(insight, base.widgetId, base.targetLabel);
  const widgetId = inferred.widgetId ?? "";
  const targetLabel = inferred.targetLabel;
  const detailMode =
    typeof insight.filter_context?.evidenceMode === "string"
      ? String(insight.filter_context.evidenceMode)
      : undefined;

  if (detailMode === "cohort_detail" && targetLabel) {
    return { ...base, profile: "cohort_detail" };
  }
  if (
    widgetId === "credit-risk-fico-distribution" ||
    widgetId === "credit-risk-ltv-distribution" ||
    widgetId === "credit-risk-dti-distribution"
  ) {
    return { ...base, profile: "cohort_period_trend" };
  }
  if (widgetId === "credit-risk-loan-mix-table") {
    return { ...base, profile: "cohort_period_trend" };
  }
  if (
    (widgetId === "credit-risk-kpi-cards" || widgetId === "credit-risk-story-panel") &&
    !targetLabel
  ) {
    return { ...base, profile: "cohort_kpis" };
  }
  if (targetLabel) {
    return { ...base, widgetId, targetLabel, profile: "cohort_period_trend" };
  }
  return { ...base, widgetId, targetLabel, profile: "cohort_kpis" };
}

function buildAggregateContext(
  intent: EvidenceIntent,
  pageContext: DashboardPageContext
): SupportingData | undefined {
  const byPeriod = pageContext.data?.by_time_period as Record<string, CreditRiskPeriodData> | undefined;
  if (!byPeriod || typeof byPeriod !== "object") return undefined;
  const appType = intent.applicationType || "Applications Taken";
  const focusPeriod = getFocusPeriodKey(intent.datePeriod);
  const rows = getOrderedPeriods(byPeriod, focusPeriod)
    .map(([period, data]) => {
      const appData = data.byApplicationType?.[appType];
      if (!appData) return null;
      const k = appData.kpis;
      const s = appData.creditRiskStory;
      return {
        period,
        periodLabel: data.periodLabel ?? period,
        applicationType: appType,
        totalUnits: k?.units ?? 0,
        totalVolume: k?.volume ?? 0,
        wac: k?.wac ?? 0,
        waFico: k?.waFico ?? 0,
        waLtv: k?.waLtv ?? 0,
        waDti: k?.waDti ?? 0,
        conventionalQualifiedPercent: s?.conventionalQualifiedPercent ?? 0,
        governmentQualifiedPercent: s?.governmentQualifiedPercent ?? 0,
      };
    })
    .filter(Boolean) as Array<Record<string, unknown>>;

  if (rows.length === 0) return undefined;
  return {
    profile: "aggregate_context",
    byPeriod: rows as SupportingDataByPeriodRow[],
    summary: rows[0] as Record<string, number | string>,
  };
}

function buildCohortTrendFromContext(
  intent: EvidenceIntent,
  pageContext: DashboardPageContext,
  tenantPool?: Pool
): Promise<SupportingData | undefined> | SupportingData | undefined {
  const byPeriod = pageContext.data?.by_time_period as Record<string, CreditRiskPeriodData> | undefined;
  if (!byPeriod || typeof byPeriod !== "object") return undefined;
  const appType = intent.applicationType || "Applications Taken";
  const target = (intent.targetLabel || "").trim();
  const widgetId = intent.widgetId || "";
  const focusPeriod = getFocusPeriodKey(intent.datePeriod);
  const periods = getOrderedPeriods(byPeriod, focusPeriod);
  const inferredLoanMixDim =
    widgetId === "credit-risk-loan-mix-table"
      ? inferLoanMixDimension(byPeriod, appType, target, intent.loanMixDimension)
      : undefined;

  const canQueryMetrics = !!tenantPool && typeof (tenantPool as { query?: unknown }).query === "function";
  const buildRows = async () => {
    const rows: Array<Record<string, unknown>> = [];
    for (const [period, data] of periods) {
      const appData = data.byApplicationType?.[appType];
      if (!appData) continue;
      const k = appData.kpis;

      if (
        widgetId === "credit-risk-fico-distribution" ||
        widgetId === "credit-risk-ltv-distribution" ||
        widgetId === "credit-risk-dti-distribution"
      ) {
        const arr =
          widgetId === "credit-risk-fico-distribution"
            ? appData.distributions?.fico
            : widgetId === "credit-risk-ltv-distribution"
              ? appData.distributions?.ltv
              : appData.distributions?.dti;
        if (!Array.isArray(arr)) continue;
        const bucket = target ? arr.find((x) => x.range === target) : arr[0];
        if (!bucket) continue;
        const effectiveTarget = bucket.range ?? target;
        const cohortMetrics = canQueryMetrics && effectiveTarget
          ? await queryCohortMetricsForPeriod(tenantPool, data, {
              ...intent,
              targetLabel: effectiveTarget,
            })
          : null;
        rows.push({
          period,
          periodLabel: data.periodLabel ?? period,
          isFocusPeriod: focusPeriod === period,
          applicationType: appType,
          cohortDimension:
            widgetId === "credit-risk-fico-distribution"
              ? "fico"
              : widgetId === "credit-risk-ltv-distribution"
                ? "ltv"
                : "dti",
          bucketLabel: bucket.range ?? target,
          totalUnits: cohortMetrics?.units ?? bucket.units ?? 0,
          unitsPercent: cohortMetrics?.unitsPercent ?? bucket.percentage ?? 0,
          totalVolume: cohortMetrics?.volume ?? bucket.volume ?? 0,
          volumePercent:
            cohortMetrics?.volumePercent ??
            ((k?.volume ?? 0) > 0
              ? Number((((bucket.volume ?? 0) * 100) / (k?.volume ?? 1)).toFixed(1))
              : 0),
          waFico: cohortMetrics?.waFico ?? 0,
          waLtv: cohortMetrics?.waLtv ?? 0,
          waDti: cohortMetrics?.waDti ?? 0,
          originatedPercent: cohortMetrics?.originatedPercent ?? 0,
          deniedPercent: cohortMetrics?.deniedPercent ?? 0,
          withdrawnPercent: cohortMetrics?.withdrawnPercent ?? 0,
          activePercent: cohortMetrics?.activePercent ?? 0,
        });
        continue;
      }

      if (widgetId === "credit-risk-loan-mix-table") {
        const dim = inferredLoanMixDim ?? "loan_type";
        const arr =
          dim === "loan_purpose"
            ? appData.loanMix?.byPurpose
            : dim === "occupancy"
              ? appData.loanMix?.byOccupancy
              : appData.loanMix?.byType;
        if (!Array.isArray(arr) || arr.length === 0) continue;
        const item = target ? arr.find((x) => x.category === target) : arr[0];
        if (!item) continue;
        const effectiveTarget = item.category ?? target;
        let cohortMetrics = canQueryMetrics && effectiveTarget
          ? await queryCohortMetricsForPeriod(tenantPool, data, {
              ...intent,
              loanMixDimension: dim,
              targetLabel: effectiveTarget,
            })
          : null;
        const drilldownPercents = canQueryMetrics && effectiveTarget
          ? await queryCohortStatusPercentsFromDrilldown(
              tenantPool,
              data,
              intent,
              dim,
              effectiveTarget
            )
          : null;
        if (drilldownPercents) {
          // Use drilldown-based status rates (same filtering engine as page modal/data path).
          if (cohortMetrics) {
            cohortMetrics = {
              ...cohortMetrics,
              ...drilldownPercents,
            };
          } else {
            cohortMetrics = {
              units: item.units ?? 0,
              volume: item.volume ?? 0,
              unitsPercent: item.unitsPercent ?? 0,
              volumePercent: item.volumePercent ?? 0,
              waFico: item.waFico ?? 0,
              waLtv: item.waLtv ?? 0,
              waDti: item.waDti ?? 0,
              ...drilldownPercents,
            };
          }
        }
        rows.push({
          period,
          periodLabel: data.periodLabel ?? period,
          isFocusPeriod: focusPeriod === period,
          applicationType: appType,
          cohortDimension: dim,
          bucketLabel: item.category ?? target,
          totalUnits: cohortMetrics?.units ?? item.units ?? 0,
          unitsPercent: cohortMetrics?.unitsPercent ?? item.unitsPercent ?? 0,
          totalVolume: cohortMetrics?.volume ?? item.volume ?? 0,
          volumePercent: cohortMetrics?.volumePercent ?? item.volumePercent ?? 0,
          wac: item.wac ?? 0,
          waFico: cohortMetrics?.waFico ?? item.waFico ?? 0,
          waLtv: cohortMetrics?.waLtv ?? item.waLtv ?? 0,
          waDti: cohortMetrics?.waDti ?? item.waDti ?? 0,
          originatedPercent: cohortMetrics?.originatedPercent ?? 0,
          deniedPercent: cohortMetrics?.deniedPercent ?? 0,
          withdrawnPercent: cohortMetrics?.withdrawnPercent ?? 0,
          activePercent: cohortMetrics?.activePercent ?? 0,
        });
        continue;
      }
    }

    if (rows.length === 0) return undefined;
    return {
      profile: "cohort_period_trend",
      target: { type: intent.targetType, label: intent.targetLabel },
      byPeriod: rows as SupportingDataByPeriodRow[],
      summary: rows[0] as Record<string, number | string>,
    } as SupportingData;
  };

  return buildRows();
}

async function buildCohortDetail(
  intent: EvidenceIntent,
  tenantPool: Pool,
  pageContext: DashboardPageContext
): Promise<SupportingData | undefined> {
  if (!intent.targetLabel || !intent.widgetId) return undefined;
  const byPeriod = pageContext.data?.by_time_period as Record<string, CreditRiskPeriodData> | undefined;
  if (!byPeriod || typeof byPeriod !== "object") return undefined;
  const appType = intent.applicationType || "Applications Taken";
  const periodKey = toUpperPeriod(intent.datePeriod || "YTD");
  const periodData = byPeriod[periodKey];
  const parsed = parseDateRange(periodData?.dateRange);
  if (!parsed) return undefined;
  const { dateField, additionalFilters } = resolveDateFieldAndFilters(appType);

  const filterType =
    intent.widgetId === "credit-risk-fico-distribution"
      ? "fico"
      : intent.widgetId === "credit-risk-ltv-distribution"
        ? "ltv"
        : intent.widgetId === "credit-risk-dti-distribution"
          ? "dti"
          : intent.widgetId === "credit-risk-loan-mix-table"
            ? (intent.loanMixDimension === "loan_purpose"
                ? "loan_purpose"
                : intent.loanMixDimension === "occupancy"
                  ? "occupancy_type"
                  : "loan_type")
            : null;
  if (!filterType) return undefined;

  const loans = await queryCreditRiskDrilldownLoans(tenantPool, {
    dateRange: parsed,
    dateField,
    additionalFilters,
    filterType,
    filterValue: intent.targetLabel,
  });
  if (!loans.length) return undefined;
  const detailRows = loans.slice(0, 250).map((l) => ({
    loanNumber: l.loan_number ?? l.id,
    borrower: l.borrower,
    officer: l.officer,
    loanAmount: l.amountValue,
    currentLoanStatus: l.status ?? "",
    currentMilestone: l.currentMilestone ?? "",
    ficoScore: l.ficoScore,
    ltvRatio: l.ltvRatio,
    dtiRatio: l.dtiRatio,
    applicationDate: l.applicationDate ?? "",
    closingDate: l.closingDate ?? "",
  }));

  const totalVolume = detailRows.reduce((sum, r) => sum + (Number(r.loanAmount) || 0), 0);
  const validFico = detailRows.filter((r) => typeof r.ficoScore === "number");
  const validLtv = detailRows.filter((r) => typeof r.ltvRatio === "number");
  const validDti = detailRows.filter((r) => typeof r.dtiRatio === "number");
  const avg = (rows: Array<Record<string, unknown>>, key: string) =>
    rows.length
      ? Number((rows.reduce((s, r) => s + (Number(r[key]) || 0), 0) / rows.length).toFixed(1))
      : 0;

  return {
    profile: "cohort_detail",
    target: { type: intent.targetType, label: intent.targetLabel },
    detailRows,
    summary: {
      totalUnits: detailRows.length,
      totalVolume,
      waFico: avg(validFico, "ficoScore"),
      waLtv: avg(validLtv, "ltvRatio"),
      waDti: avg(validDti, "dtiRatio"),
    },
  };
}

const creditRiskProvider: EvidenceQueryProvider = {
  async execute(intent, context) {
    if (intent.profile === "cohort_detail") {
      const detail = await buildCohortDetail(intent, context.tenantPool, context.pageContext);
      if (detail) return detail;
      // Fallback if detail query does not resolve.
      return buildCohortTrendFromContext(intent, context.pageContext);
    }
    if (intent.profile === "cohort_period_trend") {
      const trend = await buildCohortTrendFromContext(intent, context.pageContext, context.tenantPool);
      if (trend) return trend;
      return buildAggregateContext(intent, context.pageContext);
    }
    if (intent.profile === "cohort_kpis") {
      const agg = buildAggregateContext(intent, context.pageContext);
      if (!agg) return undefined;
      return { ...agg, profile: "cohort_kpis" };
    }
    return buildAggregateContext(intent, context.pageContext);
  },
};

export async function buildCreditRiskSupportingDataForInsight(
  pageContext: DashboardPageContext,
  insight: DashboardInsight,
  tenantPool: Pool
): Promise<SupportingData | undefined> {
  const intent = selectCreditRiskEvidenceIntent(insight);
  const cacheKey = JSON.stringify({
    profile: intent.profile,
    widgetId: intent.widgetId ?? "",
    targetType: intent.targetType ?? "",
    targetLabel: intent.targetLabel ?? "",
    applicationType: intent.applicationType ?? "",
    datePeriod: intent.datePeriod ?? "",
    loanMixDimension: intent.loanMixDimension ?? "",
  });

  let byContext = supportingDataCache.get(pageContext);
  if (!byContext) {
    byContext = new Map<string, Promise<SupportingData | undefined>>();
    supportingDataCache.set(pageContext, byContext);
  }

  const cached = byContext.get(cacheKey);
  if (cached) return cached;

  const promise = executeEvidenceIntent(
    intent,
    {
      tenantPool,
      pageContext,
    },
    creditRiskProvider
  );
  byContext.set(cacheKey, promise);
  return promise;
}
