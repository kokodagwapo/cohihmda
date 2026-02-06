/**
 * COHI Data Fetcher – loads data for selected sources (tenant DB, uploads).
 * Enforces tenantId; never returns another tenant's data.
 */

import type { SelectedSource } from "./types.js";
import { tenantDbManager } from "../../config/tenantDatabaseManager.js";
import { logDebug } from "../logger.js";

export interface FetchedDataset {
  id: string;
  rows: Record<string, unknown>[];
  meta?: { source: string; rowCount: number };
}

export async function dataFetcher(
  selectedSources: SelectedSource[],
  tenantId: string,
  _userId: string
): Promise<Record<string, FetchedDataset>> {
  const out: Record<string, FetchedDataset> = {};

  for (const src of selectedSources) {
    if (src.type === "toptiering") {
      const data = await fetchTopTieringData(tenantId, src.params as { actor?: string; startDate?: string; endDate?: string });
      out["toptiering"] = data;
    }
    if (src.type === "dashboard") {
      const data = await fetchDashboardSummary(tenantId);
      out["dashboard"] = data;
    }
    if (src.type === "upload" && src.id) {
      // Placeholder: upload store not implemented yet; return empty so responsePlanner can still run
      out[`upload_${src.id}`] = { id: src.id, rows: [], meta: { source: "upload", rowCount: 0 } };
    }
  }

  return out;
}

async function fetchTopTieringData(
  tenantId: string,
  params: { actor?: string; startDate?: string; endDate?: string }
): Promise<FetchedDataset> {
  try {
    const pool = await tenantDbManager.getTenantPool(tenantId);
    const actor = params.actor === "loan_officer" ? "loan_officer" : "branch";
    const endDate = params.endDate || new Date().toISOString().split("T")[0];
    const startDate =
      params.startDate ||
      new Date(new Date().setDate(new Date().getDate() - 90)).toISOString().split("T")[0];

    const q = `
      SELECT ${actor} AS name,
             COUNT(*) AS units,
             COALESCE(SUM(loan_amount::numeric), 0) AS volume
      FROM public.loans
      WHERE funding_date IS NOT NULL
        AND funding_date >= $1
        AND funding_date <= $2
        AND ${actor} IS NOT NULL AND ${actor} != '' AND ${actor} NOT ILIKE '99-%' AND ${actor} NOT ILIKE 'Missing'
      GROUP BY ${actor}
      ORDER BY volume DESC
      LIMIT 20
    `;
    const result = await pool.query(q, [startDate, endDate]);
    const rows = (result.rows as Record<string, unknown>[]).map((r) => ({
      ...r,
      volume: Number(r.volume),
      units: Number(r.units),
    }));
    logDebug("[Cohi] TopTiering data fetched", { tenantId, rowCount: rows.length });
    return {
      id: "toptiering",
      rows,
      meta: { source: "toptiering", rowCount: rows.length },
    };
  } catch (e) {
    logDebug("[Cohi] TopTiering fetch failed, returning empty", { tenantId, error: (e as Error).message });
    return { id: "toptiering", rows: [], meta: { source: "toptiering", rowCount: 0 } };
  }
}

async function fetchDashboardSummary(tenantId: string): Promise<FetchedDataset> {
  try {
    const pool = await tenantDbManager.getTenantPool(tenantId);
    const q = `
      SELECT
        COUNT(*) AS total_loans,
        COALESCE(SUM(loan_amount::numeric), 0) AS total_volume
      FROM public.loans
      WHERE funding_date >= (CURRENT_DATE - INTERVAL '90 days')
    `;
    const result = await pool.query(q);
    const row = result.rows[0] as Record<string, unknown>;
    const rows = [
      {
        total_loans: Number(row?.total_loans ?? 0),
        total_volume: Number(row?.total_volume ?? 0),
      },
    ];
    return { id: "dashboard", rows, meta: { source: "dashboard", rowCount: 1 } };
  } catch (e) {
    logDebug("[Cohi] Dashboard summary fetch failed", { tenantId, error: (e as Error).message });
    return { id: "dashboard", rows: [], meta: { source: "dashboard", rowCount: 0 } };
  }
}
