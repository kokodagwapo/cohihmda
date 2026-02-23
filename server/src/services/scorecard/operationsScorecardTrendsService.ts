/**
 * Operations Scorecard Trends Service
 *
 * Builds the full operations trends payload (actors with monthly metrics,
 * tierSummary, kpis) for GET /api/scorecard/operations-trends.
 * Matches the response shape expected by the frontend (OperationScorecardTrendsView).
 */

import type { Pool } from "pg";
import {
  getVMaxDate,
  formatDateForSQL,
  buildChannelWhereClause,
  isActorMissing,
  OPERATIONS_ACTOR_CONFIGS,
  assignTiersByCumulativeValue,
  calcLoanComplexity,
  type ActorConfig,
  type TTSTier,
  type LoanComplexityData,
} from "../../utils/scorecard-utils.js";
import { getStaffingUnitTargets } from "../../utils/staffingUnitTargets.js";

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Format date as "Jan-2026" for display and as month keys in response */
function formatMonthKeyDisplay(date: Date): string {
  return `${MONTH_NAMES[date.getMonth()]}-${date.getFullYear()}`;
}

const OPS_WEIGHTS = { unit: 0.7, turnTime: 0.15, complexity: 0.15 };

export interface OperationsTrendsOptions {
  actorType: string;
  monthsCount: number;
  channelGroup?: string;
}

export interface OperationsTrendsResult {
  actors: any[];
  months: string[];
  totals: Record<string, { unitsOutput: number; outputVsTarget: number; volumeOutput: number }>;
  tierSummary: {
    top: TierSummaryItem;
    second: TierSummaryItem;
    bottom: TierSummaryItem;
  };
  kpis: {
    targetUnitsPerMonth: number;
    avgUnitsOutput: number;
    avgVolumeOutput: number;
    avgLoanComplexityScore: number;
    avgDays: number;
  };
  dateRange: { start: string; end: string; monthsIncluded: number };
}

interface TierSummaryItem {
  tier: "top" | "second" | "bottom";
  count: number;
  totalUnits: number;
  percentOfTotal: number;
  avgUnitsPerMonth: number;
  avgDaysPerUnit: number;
}

interface ActorMonthData {
  unitsOutput: number;
  volumeOutput: number;
  turnTimes: number[];
  complexityScores: number[];
  approvedLoans: number;
  totalDecisions: number;
  seenLoanNumbers: Set<string>;
}

interface ActorAggregation {
  name: string;
  totalUnits: number;
  totalVolume: number;
  allTurnTimes: number[];
  allComplexityScores: number[];
  months: Map<string, ActorMonthData>;
  seenLoanNumbers: Set<string>;
}

export async function getOperationsScorecardTrends(
  tenantPool: Pool,
  options: OperationsTrendsOptions
): Promise<OperationsTrendsResult> {
  const { actorType, monthsCount, channelGroup } = options;
  const targets = await getStaffingUnitTargets(tenantPool);
  const targetUnits =
    actorType === "processor"
      ? targets.processor
      : actorType === "underwriter"
        ? targets.underwriter
        : actorType === "closer"
          ? targets.closer
          : targets.other;
  const config: ActorConfig = OPERATIONS_ACTOR_CONFIGS[actorType];

  const vMaxDate = await getVMaxDate(tenantPool);
  const effectiveEndDate = new Date(vMaxDate);
  const effectiveStartDate = new Date(
    vMaxDate.getFullYear(),
    vMaxDate.getMonth() - monthsCount,
    1
  );

  const channelClause = buildChannelWhereClause(channelGroup);
  const startDateStr = formatDateForSQL(effectiveStartDate);
  const endDateStr = formatDateForSQL(effectiveEndDate);

  const monthsList: string[] = [];
  for (let i = 0; i < monthsCount; i++) {
    const d = new Date(vMaxDate);
    d.setMonth(d.getMonth() - i);
    monthsList.push(formatMonthKeyDisplay(d));
  }

  const loansResult = await tenantPool.query(
    `
    SELECT 
      loan_id, COALESCE(loan_number, loan_id::text) as loan_number,
      loan_amount, loan_type, loan_purpose, current_loan_status, channel,
      processor, underwriter, closer,
      submitted_to_processing_date, submitted_to_underwriting_date,
      processing_date, approval_date, closing_date, disbursement_date,
      funding_date, application_date, fico_score, ltv_ratio, be_dti_ratio,
      occupancy_type, borr_self_employed
    FROM loans
    WHERE ${config.outputDateField} IS NOT NULL
      AND ${config.outputDateField} >= $1
      AND ${config.outputDateField} < $2
      AND ${config.actorColumn} IS NOT NULL
      AND TRIM(${config.actorColumn}) != ''
      AND UPPER(TRIM(${config.actorColumn})) != '99-MISSING'
      ${channelClause}
    `,
    [startDateStr, endDateStr]
  );

  const outputLoans = loansResult.rows;

  const calcTurnTime = (l: any): number | null => {
    const startDate = l[config.turnTimeStartField];
    const endDate = l[config.turnTimeEndField];
    if (!startDate || !endDate) return null;
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
    const days = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    return days > 0 ? days : null;
  };

  const toLoanComplexityData = (l: any): LoanComplexityData => ({
    loan_type: l.loan_type,
    loan_purpose: l.loan_purpose,
    loan_amount: l.loan_amount != null && l.loan_amount !== "" ? parseFloat(l.loan_amount) : undefined,
    fico_score: l.fico_score != null && l.fico_score !== "" ? parseInt(String(l.fico_score), 10) : undefined,
    ltv_ratio: l.ltv_ratio != null && l.ltv_ratio !== "" ? parseFloat(l.ltv_ratio) : undefined,
    be_dti_ratio: l.be_dti_ratio != null && l.be_dti_ratio !== "" ? parseFloat(l.be_dti_ratio) : undefined,
    occupancy_type: l.occupancy_type,
    borr_self_employed: l.borr_self_employed,
    non_qm: l.non_qm,
  });

  const actorMap = new Map<string, ActorAggregation>();

  for (const l of outputLoans) {
    const actorName = l[config.actorColumn];
    if (isActorMissing(actorName)) continue;

    const loanNumber = String(l.loan_number || l.loan_id);
    const outputDate = new Date(l[config.outputDateField]);
    const monthKey = formatMonthKeyDisplay(outputDate);

    const loanAmount = parseFloat(l.loan_amount) || 0;
    const turnTime = calcTurnTime(l);
    const complexity = calcLoanComplexity(toLoanComplexityData(l));

    if (!actorMap.has(actorName)) {
      actorMap.set(actorName, {
        name: actorName,
        totalUnits: 0,
        totalVolume: 0,
        allTurnTimes: [],
        allComplexityScores: [],
        months: new Map(),
        seenLoanNumbers: new Set(),
      });
    }

    const actor = actorMap.get(actorName)!;
    if (!actor.months.has(monthKey)) {
      actor.months.set(monthKey, {
        unitsOutput: 0,
        volumeOutput: 0,
        turnTimes: [],
        complexityScores: [],
        approvedLoans: 0,
        totalDecisions: 0,
        seenLoanNumbers: new Set(),
      });
    }

    const monthData = actor.months.get(monthKey)!;
    if (!monthData.seenLoanNumbers.has(loanNumber)) {
      monthData.seenLoanNumbers.add(loanNumber);
      monthData.unitsOutput++;
    }
    if (!actor.seenLoanNumbers.has(loanNumber)) {
      actor.seenLoanNumbers.add(loanNumber);
      actor.totalUnits++;
    }

    actor.totalVolume += loanAmount;
    if (turnTime !== null) actor.allTurnTimes.push(turnTime);
    actor.allComplexityScores.push(complexity);
    monthData.volumeOutput += loanAmount;
    if (turnTime !== null) monthData.turnTimes.push(turnTime);
    monthData.complexityScores.push(complexity);

    const status = (l.current_loan_status || "").toUpperCase();
    if (status.includes("APPROV") || status.includes("ORIGINATED") || status.includes("FUNDED")) {
      monthData.approvedLoans++;
      monthData.totalDecisions++;
    } else if (status.includes("DENIED") || status.includes("DECLINED")) {
      monthData.totalDecisions++;
    }
  }

  const actors = Array.from(actorMap.values()).filter((a) => a.totalUnits > 0);
  const actorCount = actors.length;

  if (actorCount === 0) {
    return {
      actors: [],
      months: monthsList,
      totals: {},
      tierSummary: {
        top: { tier: "top", count: 0, totalUnits: 0, percentOfTotal: 0, avgUnitsPerMonth: 0, avgDaysPerUnit: 0 },
        second: { tier: "second", count: 0, totalUnits: 0, percentOfTotal: 0, avgUnitsPerMonth: 0, avgDaysPerUnit: 0 },
        bottom: { tier: "bottom", count: 0, totalUnits: 0, percentOfTotal: 0, avgUnitsPerMonth: 0, avgDaysPerUnit: 0 },
      },
      kpis: {
        targetUnitsPerMonth: targetUnits,
        avgUnitsOutput: 0,
        avgVolumeOutput: 0,
        avgLoanComplexityScore: 100,
        avgDays: 0,
      },
      dateRange: {
        start: effectiveStartDate.toISOString(),
        end: effectiveEndDate.toISOString(),
        monthsIncluded: monthsCount,
      },
    };
  }

  const totalUnits = actors.reduce((sum, a) => sum + a.totalUnits, 0);
  const totalVolume = actors.reduce((sum, a) => sum + a.totalVolume, 0);
  const avgUnitsPerActor = totalUnits / actorCount;

  let totalInverseTurnTime = 0;
  let turnTimeActorCount = 0;
  actors.forEach((a) => {
    if (a.allTurnTimes.length > 0) {
      const avgTurnTime = a.allTurnTimes.reduce((s, t) => s + t, 0) / a.allTurnTimes.length;
      if (avgTurnTime > 0) {
        totalInverseTurnTime += 1 / avgTurnTime;
        turnTimeActorCount++;
      }
    }
  });
  const avgInverseTurnTime = turnTimeActorCount > 0 ? totalInverseTurnTime / turnTimeActorCount : 0;

  const allTurnTimes = actors.flatMap((a) => a.allTurnTimes);
  const avgTurnTimeForKPI = allTurnTimes.length > 0
    ? allTurnTimes.reduce((s, t) => s + t, 0) / allTurnTimes.length
    : 0;

  const avgComplexity =
    actors.reduce((sum, a) => {
      if (a.allComplexityScores.length === 0) return sum;
      return sum + a.allComplexityScores.reduce((s, c) => s + c, 0) / a.allComplexityScores.length;
    }, 0) / actorCount;

  const actorsWithMetrics = actors.map((a) => {
    const actorAvgTurnTime = a.allTurnTimes.length > 0
      ? a.allTurnTimes.reduce((s, t) => s + t, 0) / a.allTurnTimes.length
      : 0;
    const actorAvgComplexity = a.allComplexityScores.length > 0
      ? a.allComplexityScores.reduce((s, c) => s + c, 0) / a.allComplexityScores.length
      : 100;

    const unitRating = avgUnitsPerActor > 0 ? (a.totalUnits / avgUnitsPerActor) * 100 : 100;
    let turnTimeRating = 100;
    if (actorAvgTurnTime > 0 && avgInverseTurnTime > 0) {
      turnTimeRating = ((1 / actorAvgTurnTime) / avgInverseTurnTime) * 100;
    }
    const complexityRating = avgComplexity > 0 ? (actorAvgComplexity / avgComplexity) * 100 : 100;
    const ttsScore =
      unitRating * OPS_WEIGHTS.unit +
      turnTimeRating * OPS_WEIGHTS.turnTime +
      complexityRating * OPS_WEIGHTS.complexity;

    const monthsData: Record<string, any> = {};
    for (const monthKey of monthsList) {
      const md = a.months.get(monthKey);
      if (md) {
        const monthAvgDays = md.turnTimes.length > 0
          ? md.turnTimes.reduce((s, t) => s + t, 0) / md.turnTimes.length
          : 0;
        const monthAvgComplexity = md.complexityScores.length > 0
          ? md.complexityScores.reduce((s, c) => s + c, 0) / md.complexityScores.length
          : 0;
        const conversionPercent = md.totalDecisions > 0 ? (md.approvedLoans / md.totalDecisions) * 100 : 0;
        monthsData[monthKey] = {
          unitsOutput: md.unitsOutput,
          outputVsTarget: md.unitsOutput - targetUnits,
          avgDays: Math.round(monthAvgDays * 10) / 10,
          conversionPercent: Math.round(conversionPercent * 10) / 10,
          loanComplexityScore: Math.round(monthAvgComplexity * 10) / 10,
          volumeOutput: Math.round(md.volumeOutput),
        };
      } else {
        monthsData[monthKey] = {
          unitsOutput: 0,
          outputVsTarget: -targetUnits,
          avgDays: 0,
          conversionPercent: 0,
          loanComplexityScore: 0,
          volumeOutput: 0,
        };
      }
    }

    return {
      id: a.name.replace(/\s+/g, "-").toLowerCase(),
      name: a.name,
      totalUnits: a.totalUnits,
      ttsScore: Math.round(ttsScore * 10) / 10,
      tier: "bottom" as TTSTier, // Placeholder; assigned by percentile after sort (match Operations Scorecard)
      months: monthsData,
    };
  });

  actorsWithMetrics.sort((a, b) => b.ttsScore - a.ttsScore);

  const totalUnitsForTiers = actorsWithMetrics.reduce((s, a) => s + a.totalUnits, 0);
  const byValue = [...actorsWithMetrics].sort((a, b) => b.totalUnits - a.totalUnits);
  const actorsWithTiers = assignTiersByCumulativeValue(
    byValue,
    totalUnitsForTiers,
    (a) => a.totalUnits
  );
  actorsWithTiers.sort((a, b) => b.ttsScore - a.ttsScore); // table order by TTS

  const totals: Record<string, { unitsOutput: number; outputVsTarget: number; volumeOutput: number }> = {};
  for (const monthKey of monthsList) {
    let monthUnits = 0;
    let monthVolume = 0;
    for (const actor of actorsWithTiers) {
      const md = actor.months[monthKey];
      if (md) {
        monthUnits += md.unitsOutput;
        monthVolume += md.volumeOutput;
      }
    }
    totals[monthKey] = {
      unitsOutput: monthUnits,
      outputVsTarget: monthUnits - targetUnits * actorCount,
      volumeOutput: monthVolume,
    };
  }

  const createTierSummary = (tierActors: typeof actorsWithTiers): TierSummaryItem => {
    if (tierActors.length === 0) {
      return { tier: "bottom", count: 0, totalUnits: 0, percentOfTotal: 0, avgUnitsPerMonth: 0, avgDaysPerUnit: 0 };
    }
    const tierUnits = tierActors.reduce((sum, a) => {
      return sum + Object.values(a.months).reduce((s: number, m: any) => s + (m.unitsOutput || 0), 0);
    }, 0);
    const avgDays =
      tierActors.reduce((sum, a) => {
        const actorData = actorMap.get(a.name);
        if (!actorData || actorData.allTurnTimes.length === 0) return sum;
        return sum + actorData.allTurnTimes.reduce((s, t) => s + t, 0) / actorData.allTurnTimes.length;
      }, 0) /
      Math.max(1, tierActors.filter((a) => (actorMap.get(a.name)?.allTurnTimes.length ?? 0) > 0).length);
    return {
      tier: tierActors[0]?.tier ?? "bottom",
      count: tierActors.length,
      totalUnits: tierUnits,
      percentOfTotal: totalUnits > 0 ? Math.round((tierUnits / totalUnits) * 1000) / 10 : 0,
      avgUnitsPerMonth: Math.round((tierUnits / monthsCount / tierActors.length) * 10) / 10,
      avgDaysPerUnit: Math.round(avgDays * 10) / 10,
    };
  };

  const topActors = actorsWithTiers.filter((a) => a.tier === "top");
  const secondActors = actorsWithTiers.filter((a) => a.tier === "second");
  const bottomActors = actorsWithTiers.filter((a) => a.tier === "bottom");

  const tierSummary = {
    top: { ...createTierSummary(topActors), tier: "top" as const },
    second: { ...createTierSummary(secondActors), tier: "second" as const },
    bottom: { ...createTierSummary(bottomActors), tier: "bottom" as const },
  };

  const avgMonthlyUnits = Math.round(totalUnits / monthsCount);
  const avgMonthlyVolume = Math.round(totalVolume / monthsCount);
  const kpis = {
    targetUnitsPerMonth: targetUnits,
    avgUnitsOutput: avgMonthlyUnits,
    avgVolumeOutput: avgMonthlyVolume,
    avgLoanComplexityScore: Math.round(avgComplexity * 10) / 10,
    avgDays: Math.round(avgTurnTimeForKPI * 10) / 10,
  };

  return {
    actors: actorsWithTiers,
    months: monthsList,
    totals,
    tierSummary,
    kpis,
    dateRange: {
      start: effectiveStartDate.toISOString(),
      end: effectiveEndDate.toISOString(),
      monthsIncluded: monthsCount,
    },
  };
}
