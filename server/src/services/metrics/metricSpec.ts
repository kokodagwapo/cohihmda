/**
 * MetricSpec — planner output contract for deterministic SQL composition.
 * Validated with Zod before composeMetricSql / execution.
 */

import { z } from "zod";

export const metricWindowSchema = z.enum([
  "this_quarter",
  "last_quarter",
  "ytd",
  "last_90_days",
  "this_month",
  "last_month",
  "all_time",
  "custom",
]);

export type MetricWindow = z.infer<typeof metricWindowSchema>;

export const metricComparisonSchema = z.enum([
  "none",
  "segment",
  "prior_period",
  "mom",
  "yoy",
]);

export type MetricComparison = z.infer<typeof metricComparisonSchema>;

/** Allowed GROUP BY dimensions aligned with metricsService GroupByField */
export const dimensionSchema = z.enum([
  "loan_officer",
  "branch",
  "processor",
  "underwriter",
  "channel",
  "investor",
  "loan_type",
  "loan_purpose",
  "occupancy_type",
  "account_executive",
]);

export type MetricDimension = z.infer<typeof dimensionSchema>;

export const metricSpecSchema = z
  .object({
    /** Primary metric ids from METRICS_CATALOG */
    metricIds: z.array(z.string().min(1)).min(1).max(8),
    /** Optional breakdown dimensions */
    dimensions: z.array(dimensionSchema).max(3).optional().default([]),
    window: metricWindowSchema.optional().default("all_time"),
    /** Custom window — required when window === 'custom' */
    customRange: z
      .object({
        start: z.string(),
        end: z.string(),
      })
      .optional(),
    comparison: metricComparisonSchema.optional().default("none"),
    /** Structured filters passed to metrics additionalFilters */
    filters: z.record(z.string(), z.unknown()).optional(),
    topN: z.number().int().min(1).max(50).optional(),
    sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
    /** Pull-through segmented comparison — uses canonical segmented PT builder */
    pullThroughSegment: z.enum(["branch", "loan_officer"]).optional(),
    /** True when planner cannot map to catalog / composer */
    unsupported: z.boolean().optional(),
    unsupportedReason: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.window === "custom") {
      if (
        !data.customRange?.start ||
        !data.customRange?.end
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "customRange.start and customRange.end required when window is custom",
        });
      }
    }
    if (data.unsupported && !data.unsupportedReason?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "unsupportedReason required when unsupported is true",
      });
    }
  });

export type MetricSpec = z.infer<typeof metricSpecSchema>;

export function parseMetricSpec(raw: unknown): MetricSpec {
  return metricSpecSchema.parse(raw);
}

export function safeParseMetricSpec(raw: unknown): {
  success: true;
  data: MetricSpec;
} | {
  success: false;
  error: z.ZodError;
} {
  const r = metricSpecSchema.safeParse(raw);
  if (r.success) return { success: true, data: r.data };
  return { success: false, error: r.error };
}

/** Semantic contract extensions on catalog definitions (optional per metric). */
export type MetricGrain =
  | "loan"
  | "actor"
  | "branch"
  | "time_bucket"
  | "portfolio";

export type MetricCohortType = "completed" | "funded" | "active" | "all";

export type MetricOutputUnit =
  | "percentage"
  | "currency"
  | "count"
  | "days"
  | "ratio"
  | "other";

export interface MetricSemanticContract {
  grain?: MetricGrain;
  allowedDimensions?: MetricDimension[];
  /** Keys matching buildWhereClause in metricsService */
  requiredFilters?: string[];
  cohortType?: MetricCohortType;
  validWindows?: MetricWindow[];
  defaultComparisons?: MetricComparison[];
  confidenceRules?: {
    minRows?: number;
    maxDataAgeDays?: number;
  };
  outputUnit?: MetricOutputUnit;
}
