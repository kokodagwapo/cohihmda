import { describe, it, expect } from "vitest";
import { deriveDashboardTrackedFromDetailData } from "./dashboardTrackedDerivation.js";
import { TRACKED_DASHBOARD_HANDLER_LEADERBOARD_SUBJECT } from "../insights/trackedInsightHandlers.js";

const baseCtx = {
  sentiment: "warning" as const,
  severity_score: 0.75 as number | null,
  page_id: "loan-complexity",
  page_name: "Loan Complexity",
};

/**
 * Stage 6 / Suggested Test Plan: dashboard track derivation — evaluable vs explicit non-evaluable.
 */
describe("deriveDashboardTrackedFromDetailData", () => {
  it("is evaluable when agent-style metricSignature has non-empty sql and keyFields", () => {
    const r = deriveDashboardTrackedFromDetailData(
      {
        metricSignature: {
          sql: "SELECT 1 AS units",
          keyFields: ["units"],
        },
      },
      baseCtx
    );
    expect(r.display_metadata.evaluable).toBe(true);
    expect(r.metric_signature.sql).toContain("SELECT");
    expect(r.metric_signature.keyFields).toContain("units");
  });

  it("is evaluable when audit.generatedSql is present", () => {
    const r = deriveDashboardTrackedFromDetailData(
      {
        audit: { generatedSql: "SELECT x FROM t" },
        displayConfig: {
          summary_defs: [{ key: "k1", label: "K1", format: "number" }],
        },
      },
      baseCtx
    );
    expect(r.display_metadata.evaluable).toBe(true);
    expect(r.metric_signature.sql).toBe("SELECT x FROM t");
    expect(r.metric_signature.keyFields).toContain("k1");
  });

  it("is explicitly non-evaluable when no SQL can be derived but summary keys exist", () => {
    const r = deriveDashboardTrackedFromDetailData(
      {
        summary: { waComplexity: 1.2, units: 3 },
        displayConfig: {
          summary_defs: [
            { key: "waComplexity", label: "WA complexity", format: "number" },
            { key: "units", label: "Units", format: "number" },
          ],
        },
      },
      baseCtx
    );
    expect(r.display_metadata.evaluable).toBe(false);
    expect(r.display_metadata.non_evaluable_reason).toMatch(/no SQL/i);
    expect(r.metric_signature.sql).toBe("");
    expect(r.metric_signature.keyFields.length).toBeGreaterThan(0);
  });

  it("is non-evaluable when detail_data is missing", () => {
    const r = deriveDashboardTrackedFromDetailData(null, baseCtx);
    expect(r.display_metadata.evaluable).toBe(false);
    expect(r.metric_signature.sql).toBe("");
  });

  it("derives handler refresh when audit marks handler refresh (aggregate id)", () => {
    const r = deriveDashboardTrackedFromDetailData(
      {
        audit: {
          trackedRefreshKind: "handler",
          handlerId: "dashboard:leaderboard:aggregate_summary",
        },
        displayConfig: {
          summary_defs: [
            {
              key: "averagePullThrough",
              label: "Pull-through",
              format: "percent",
            },
            { key: "totalUnits", label: "Units", format: "number" },
          ],
        },
      },
      { ...baseCtx, filter_context: { datePeriod: "ytd" } }
    );
    expect(r.display_metadata.evaluable).toBe(true);
    expect(r.metric_signature.refresh_kind).toBe("handler");
    expect(r.metric_signature.handler_id).toBe(
      "dashboard:leaderboard:aggregate_summary"
    );
    expect(r.display_metadata.filter_context_snapshot?.datePeriod).toBe("ytd");
  });

  it("derives subject handler when audit uses subject handler id", () => {
    const r = deriveDashboardTrackedFromDetailData(
      {
        audit: {
          trackedRefreshKind: "handler",
          handlerId: TRACKED_DASHBOARD_HANDLER_LEADERBOARD_SUBJECT,
        },
        displayConfig: {
          summary_defs: [
            { key: "pullThroughRate", label: "Pull-through", format: "percent" },
            { key: "loansClosed", label: "Units", format: "number" },
          ],
        },
      },
      { ...baseCtx, page_id: "leaderboard", filter_context: { datePeriod: "mtd" } }
    );
    expect(r.display_metadata.evaluable).toBe(true);
    expect(r.metric_signature.handler_id).toBe(
      TRACKED_DASHBOARD_HANDLER_LEADERBOARD_SUBJECT
    );
    expect(r.metric_signature.keyFields).toContain("pullThroughRate");
  });

  it("sets param_resolution rolling_dashboard when generatedSql has placeholders", () => {
    const r = deriveDashboardTrackedFromDetailData(
      {
        audit: {
          generatedSql: "SELECT 1 AS k WHERE d::date BETWEEN $1::date AND $2::date",
        },
        displayConfig: {
          summary_defs: [{ key: "k", label: "K", format: "number" }],
        },
      },
      baseCtx
    );
    expect(r.metric_signature.param_resolution).toBe("rolling_dashboard");
  });
});
