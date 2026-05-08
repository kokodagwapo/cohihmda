/**
 * Persist metric composer / SQL execution traces for governance (tenant DB).
 */

import pg from "pg";

export interface MetricQueryTraceInput {
  tenantId: string;
  surface: "chat" | "workbench" | "insights" | "research";
  question?: string;
  metricSpecJson?: unknown;
  composedSql?: string;
  params?: unknown[];
  accessFilterApplied?: boolean;
  validationPassed?: boolean;
  executionMs?: number;
  rowCount?: number;
  confidence?: number;
  error?: string;
}

export async function persistMetricQueryTrace(
  tenantPool: pg.Pool,
  input: MetricQueryTraceInput
): Promise<void> {
  try {
    const exists = await tenantPool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'metric_query_traces'
      ) AS exists
    `);
    if (!exists.rows[0]?.exists) return;

    await tenantPool.query(
      `INSERT INTO public.metric_query_traces (
        tenant_id_surface, question, metric_spec, composed_sql, params,
        access_filter_applied, validation_passed, execution_ms, row_count,
        confidence, error_message
      ) VALUES ($1,$2,$3::jsonb,$4,$5::jsonb,$6,$7,$8,$9,$10,$11)`,
      [
        `${input.tenantId}:${input.surface}`,
        input.question ?? null,
        JSON.stringify(input.metricSpecJson ?? null),
        input.composedSql ?? null,
        JSON.stringify(input.params ?? []),
        input.accessFilterApplied ?? null,
        input.validationPassed ?? null,
        input.executionMs ?? null,
        input.rowCount ?? null,
        input.confidence ?? null,
        input.error ?? null,
      ]
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[MetricRunTracer] persist failed:", msg);
  }
}
