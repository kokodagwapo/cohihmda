/**
 * Staffing unit targets (units per month per role)
 * Used by Financial Modeling Sandbox and Operations Scorecard
 */

import type { Pool } from "pg";

const DEFAULT_TARGETS = {
  processor: 25,
  underwriter: 45,
  closer: 85,
  other: 85,
} as const;

export type StaffingUnitTargets = {
  processor: number;
  underwriter: number;
  closer: number;
  other: number;
};

/**
 * Load staffing unit targets from tenant DB (staffing_unit_targets table).
 * Returns defaults (25, 45, 85, 85) if table missing or empty.
 */
export async function getStaffingUnitTargets(
  tenantPool: Pool
): Promise<StaffingUnitTargets> {
  try {
    const result = await tenantPool.query(
      `SELECT role_key, units_per_month FROM public.staffing_unit_targets`
    );
    const map: Record<string, number> = { ...DEFAULT_TARGETS };
    for (const row of result.rows) {
      const key = String(row.role_key).toLowerCase();
      const val = parseInt(row.units_per_month, 10);
      if (key in map && !isNaN(val) && val > 0) map[key] = val;
    }
    return {
      processor: map.processor ?? DEFAULT_TARGETS.processor,
      underwriter: map.underwriter ?? DEFAULT_TARGETS.underwriter,
      closer: map.closer ?? DEFAULT_TARGETS.closer,
      other: map.other ?? DEFAULT_TARGETS.other,
    };
  } catch {
    return { ...DEFAULT_TARGETS };
  }
}
