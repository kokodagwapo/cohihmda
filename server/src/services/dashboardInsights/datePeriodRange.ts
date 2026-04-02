/**
 * Shared date-window helpers for dashboard insights (company scorecard period keys).
 * Used by the company scorecard adapter and tracked-insight rolling param resolution.
 */

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toYmdLocal(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function startOfMonthLocal(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/**
 * Resolve filter_context.datePeriod for Company Scorecard (l13m | l12m | ytd | y_YYYY).
 * Aligns with `companyScorecardAdapter` period semantics.
 */
export function computeCompanyScorecardPeriodDateRange(
  datePeriod: string,
  now: Date = new Date()
): { start: string; end: string; periodLabel: string } {
  const end = toYmdLocal(now);
  const currentYear = now.getFullYear();

  if (datePeriod === "l13m") {
    const start = startOfMonthLocal(
      new Date(now.getFullYear(), now.getMonth() - 13, now.getDate())
    );
    return { start: toYmdLocal(start), end, periodLabel: "Last 13 Months" };
  }
  if (datePeriod === "l12m") {
    const start = startOfMonthLocal(
      new Date(now.getFullYear(), now.getMonth() - 12, now.getDate())
    );
    return { start: toYmdLocal(start), end, periodLabel: "Last 12 Months" };
  }
  if (datePeriod === "ytd") {
    return {
      start: `${currentYear}-01-01`,
      end,
      periodLabel: `Current Year YTD (${currentYear})`,
    };
  }

  if (datePeriod.startsWith("y_")) {
    const yr = Number(datePeriod.slice(2));
    if (Number.isFinite(yr) && yr > 1900) {
      return {
        start: `${yr}-01-01`,
        end: `${yr}-12-31`,
        periodLabel: `Full Year ${yr}`,
      };
    }
  }

  return {
    start: `${currentYear}-01-01`,
    end,
    periodLabel: `Current Year YTD (${currentYear})`,
  };
}
