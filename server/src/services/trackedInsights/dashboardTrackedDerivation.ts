/**
 * Dashboard → tracked-insight alignment (plan §0).
 *
 * Shared contract for watchlist rows so dashboard-tracked items use the same
 * metric_signature / display_metadata shape as regular insights where possible.
 * When detail_data has no executable SQL, the row is explicitly marked non-evaluable.
 */

/** Matches evaluator + frontend contract for tracked insights */
export interface TrackedMetricSignature {
  sql: string;
  keyFields: string[];
  polarities?: Record<string, "higher_better" | "lower_better">;
}

/** display_metadata JSONB: aligns with agent insight hints + explicit evaluable flag */
export interface TrackedDisplayMetadata {
  keyMetricDescriptions?: Record<string, string>;
  keyMetricFormats?: Record<string, string>;
  /** Original insight bucket analogue: dashboard sentiment lane */
  original_bucket?: string;
  original_severity_score?: number | null;
  source_page_id?: string;
  source_page_name?: string;
  /** false when metric_signature.sql is empty and evaluator cannot refresh */
  evaluable?: boolean;
  non_evaluable_reason?: string;
}

export interface DeriveDashboardTrackedResult {
  metric_signature: TrackedMetricSignature;
  display_metadata: TrackedDisplayMetadata;
}

function sentimentToOriginalBucket(sentiment: string): string {
  const s = (sentiment || "").toLowerCase();
  if (s === "critical") return "critical";
  if (s === "warning") return "attention";
  if (s === "positive") return "working";
  return "context";
}

function mapSummaryFormatToKeyMetricFormat(
  fmt: string
): string | undefined {
  const allowed = new Set([
    "currency",
    "percent",
    "number",
    "days",
    "bps",
    "rate",
    "text",
  ]);
  if (allowed.has(fmt)) return fmt;
  return undefined;
}

/**
 * Derive metric_signature and display_metadata from dashboard_generated_insights.detail_data.
 * Dashboard hydrator often leaves audit.generatedSql empty — then evaluable is false (explicit).
 */
export function deriveDashboardTrackedFromDetailData(
  detailData: unknown,
  ctx: {
    sentiment: string;
    severity_score: number | null | undefined;
    page_id: string;
    page_name: string;
  }
): DeriveDashboardTrackedResult {
  const baseMeta: TrackedDisplayMetadata = {
    original_bucket: sentimentToOriginalBucket(ctx.sentiment),
    original_severity_score:
      ctx.severity_score != null ? Number(ctx.severity_score) : null,
    source_page_id: ctx.page_id,
    source_page_name: ctx.page_name,
  };

  if (!detailData || typeof detailData !== "object") {
    return {
      metric_signature: { sql: "", keyFields: [] },
      display_metadata: {
        ...baseMeta,
        evaluable: false,
        non_evaluable_reason:
          "No detail_data on dashboard insight; cannot re-query metrics automatically.",
      },
    };
  }

  const dd = detailData as Record<string, unknown>;

  // Agent-style parity if ever present on dashboard rows
  const agentSig = dd.metricSignature as
    | { sql?: string; keyFields?: string[]; polarities?: TrackedMetricSignature["polarities"] }
    | undefined;
  if (
    agentSig &&
    typeof agentSig.sql === "string" &&
    agentSig.sql.trim().length > 0 &&
    Array.isArray(agentSig.keyFields) &&
    agentSig.keyFields.length > 0
  ) {
    const descriptions: Record<string, string> = {};
    const formats: Record<string, string> = {};
    const kmDesc = dd.keyMetricDescriptions as Record<string, string> | undefined;
    const kmFmt = dd.keyMetricFormats as Record<string, string> | undefined;
    if (kmDesc) Object.assign(descriptions, kmDesc);
    if (kmFmt) Object.assign(formats, kmFmt);

    return {
      metric_signature: {
        sql: agentSig.sql.trim(),
        keyFields: agentSig.keyFields.filter((k) => typeof k === "string"),
        polarities: agentSig.polarities,
      },
      display_metadata: {
        ...baseMeta,
        keyMetricDescriptions:
          Object.keys(descriptions).length > 0 ? descriptions : undefined,
        keyMetricFormats:
          Object.keys(formats).length > 0 ? formats : undefined,
        evaluable: true,
      },
    };
  }

  const audit = dd.audit as Record<string, unknown> | undefined;
  const generatedSql =
    typeof audit?.generatedSql === "string" ? audit.generatedSql.trim() : "";

  const displayConfig = dd.displayConfig as
    | {
        summary_defs?: Array<{ key: string; label: string; format?: string }>;
        summaryMetrics?: string[];
      }
    | undefined;

  const summary = dd.summary as Record<string, unknown> | undefined;

  const keyFields: string[] = [];
  if (displayConfig?.summary_defs?.length) {
    for (const s of displayConfig.summary_defs) {
      if (s?.key && typeof s.key === "string") keyFields.push(s.key);
    }
  } else if (displayConfig?.summaryMetrics?.length) {
    keyFields.push(
      ...displayConfig.summaryMetrics.filter((k) => typeof k === "string")
    );
  } else if (summary && typeof summary === "object") {
    keyFields.push(...Object.keys(summary));
  }

  const descriptions: Record<string, string> = {};
  const formats: Record<string, string> = {};
  if (displayConfig?.summary_defs?.length) {
    for (const s of displayConfig.summary_defs) {
      if (!s?.key) continue;
      if (s.label) descriptions[s.key] = s.label;
      const mf = s.format
        ? mapSummaryFormatToKeyMetricFormat(String(s.format))
        : undefined;
      if (mf) formats[s.key] = mf;
    }
  }

  if (!generatedSql) {
    return {
      metric_signature: { sql: "", keyFields: keyFields.length ? keyFields : [] },
      display_metadata: {
        ...baseMeta,
        keyMetricDescriptions:
          Object.keys(descriptions).length > 0 ? descriptions : undefined,
        keyMetricFormats:
          Object.keys(formats).length > 0 ? formats : undefined,
        evaluable: false,
        non_evaluable_reason:
          "Dashboard insight detail has no SQL for re-evaluation; bookmark is kept but metrics will not auto-refresh until a query signature exists (phase 2 parity).",
      },
    };
  }

  return {
    metric_signature: {
      sql: generatedSql,
      keyFields: keyFields.length > 0 ? keyFields : [],
    },
    display_metadata: {
      ...baseMeta,
      keyMetricDescriptions:
        Object.keys(descriptions).length > 0 ? descriptions : undefined,
      keyMetricFormats:
        Object.keys(formats).length > 0 ? formats : undefined,
      evaluable: true,
    },
  };
}
