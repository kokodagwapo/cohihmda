import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTheme } from "@/components/theme-provider";
import { Printer, RotateCcw, Loader2 } from "lucide-react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import {
  useFinancialModelingBaseline,
  type FinancialModelingBaseline,
} from "@/hooks/useFinancialModelingBaseline";

// Horizontal Slider Component
interface HorizontalSliderProps {
  label: string;
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  formatValue?: (value: number) => string;
  isDarkMode?: boolean;
  hint?: string;
}

const HorizontalSlider: React.FC<HorizontalSliderProps> = ({
  label,
  value,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  formatValue,
  isDarkMode = false,
  hint,
}) => {
  const formattedValue = formatValue ? formatValue(value) : value.toString();

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value === "" ? min : parseFloat(e.target.value);
    if (!isNaN(inputValue)) {
      const newValue = Math.max(min, Math.min(max, inputValue));
      onValueChange(newValue);
    }
  };

  const handleSliderChange = (newValue: number[]) => {
    onValueChange(newValue[0]);
  };

  return (
    <Card
      className={`rounded-xl backdrop-blur-sm transition-all duration-200 ${
        isDarkMode
          ? "border-slate-700/50 bg-slate-800/70 shadow-[0_8px_24px_rgba(0,0,0,0.3)]"
          : "border-blue-200/40 bg-white shadow-[0_8px_24px_rgba(59,130,246,0.08)]"
      }`}
    >
      <CardContent className="pt-2 sm:pt-2.5 pb-2 sm:pb-2.5 px-2.5 sm:px-3 w-full">
        {/* Label, Slider, and Input in one row */}
        <div className="flex items-center justify-between gap-2 sm:gap-3">
          {/* Label */}
          <label
            className={`text-[10px] sm:text-xs font-semibold uppercase tracking-wider flex-shrink-0 max-w-[32%] sm:max-w-[35%] break-words ${
              isDarkMode ? "text-slate-400" : "text-slate-600"
            }`}
          >
            {label}
          </label>

          {/* Slider and Input Group - Aligned to right */}
          <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0 min-w-0 flex-1">
            {/* Horizontal Slider Track */}
            <div className="relative flex items-center flex-1 max-w-[140px] sm:max-w-[160px]">
              <SliderPrimitive.Root
                orientation="horizontal"
                value={[value]}
                onValueChange={handleSliderChange}
                min={min}
                max={max}
                step={step}
                className="relative flex w-full h-6 touch-none select-none items-center"
              >
                <SliderPrimitive.Track
                  className={`relative h-[2px] w-full grow overflow-hidden rounded-full ${
                    isDarkMode ? "bg-slate-700" : "bg-slate-200"
                  } shadow-inner`}
                >
                  <SliderPrimitive.Range className="absolute h-full bg-gradient-to-r from-blue-500 to-purple-500" />
                </SliderPrimitive.Track>
                <SliderPrimitive.Thumb className="block h-6 w-6 sm:h-6 sm:w-6 rounded-full border-2 border-blue-500 bg-white dark:bg-slate-800 ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 shadow-[0_4px_12px_rgba(0,0,0,0.25),0_2px_4px_rgba(0,0,0,0.15)] cursor-grab active:cursor-grabbing hover:scale-110 transition-transform touch-manipulation" />
              </SliderPrimitive.Root>
            </div>

            {/* Input Field */}
            <Input
              type="number"
              value={formattedValue}
              onChange={handleInputChange}
              onBlur={(e) => {
                const inputValue =
                  e.target.value === "" ? min : parseFloat(e.target.value);
                if (!isNaN(inputValue)) {
                  const newValue = Math.max(min, Math.min(max, inputValue));
                  onValueChange(newValue);
                }
              }}
              className={`w-16 sm:w-20 text-center !text-sm font-semibold flex-shrink-0 ${
                isDarkMode
                  ? "bg-slate-800 border-slate-700 text-white"
                  : "bg-white border-slate-300 text-slate-900"
              }`}
              min={min}
              max={max}
              step={step}
            />
          </div>
        </div>
        {hint && (
          <p className={`text-[9px] sm:text-[10px] mt-1 leading-tight ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
            {hint}
          </p>
        )}
      </CardContent>
    </Card>
  );
};

interface ProductivityData {
  role: string;
  actual: number;
  target: number;
  delta: number;
  actualCost: number;
  targetCost: number;
  savingsPerUnit: number;
  productivityImprovement: number;
}

interface EstimatedCountData {
  role: string;
  estimatedCount: number;
}

interface ProfitImprovementData {
  metric: string;
  actual: string;
  valueSelected: string;
  profitImprovement: number;
}

export interface FinancialModelingSandboxViewProps {
  selectedTenantId?: string | null;
  /** Report data to canvasDataStore for PowerPoint export. */
  onDataReady?: (payload: unknown) => void;
}

// Fallback constants when no tenant baseline data (demo/industry assumptions)
const FALLBACK_MARGIN_BP = 20;
const FALLBACK_PULL_THROUGH = 64.09;
const FALLBACK_MLO_ACTUAL = 4.5;
const FALLBACK_MARGIN_PROFIT = 932725;
const FALLBACK_PROCESSOR_ACTUAL = 32;
const FALLBACK_UNDERWRITER_ACTUAL = 14;
const FALLBACK_CLOSER_ACTUAL = 17;
const FALLBACK_OTHER_ACTUAL = 17;

// Qlik extension config: role annual salaries (used for Actual Cost = monthlyComp/actual, Target Cost = monthlyComp/target)
const ROLE_ANNUAL_SALARIES: Record<string, number> = {
  Processor: 75000,
  Underwriter: 125000,
  Closer: 85000,
  Other: 70000,
};

// Default target units (sliders) – match Qlik actualTargets / StaffingUnits (25, 45, 85, 85)
const DEFAULT_TARGET_PROCESSOR = 25;
const DEFAULT_TARGET_UNDERWRITER = 45;
const DEFAULT_TARGET_CLOSER = 85;
const DEFAULT_TARGET_OTHER = 85;

export function FinancialModelingSandboxView({ selectedTenantId, onDataReady }: FinancialModelingSandboxViewProps) {
  const { theme } = useTheme();
  const isDarkMode = theme === "dark";

  const { data: baseline, loading: baselineLoading, error: baselineError } = useFinancialModelingBaseline(
    selectedTenantId ?? undefined,
    "trailing_12" // Rolling 12 months
  );

  // Slider values; targets default to Qlik benchmark (25, 45, 85, 85)
  const [marginIncreaseBP, setMarginIncreaseBP] = useState(0);
  const [pullThroughPercent, setPullThroughPercent] = useState(FALLBACK_PULL_THROUGH);
  const [mlo, setMlo] = useState(FALLBACK_MLO_ACTUAL);
  const [processor, setProcessor] = useState(DEFAULT_TARGET_PROCESSOR);
  const [underwriter, setUnderwriter] = useState(DEFAULT_TARGET_UNDERWRITER);
  const [closer, setCloser] = useState(DEFAULT_TARGET_CLOSER);
  const [otherSupport, setOtherSupport] = useState(DEFAULT_TARGET_OTHER);

  // When baseline loads, sync margin/pull-through/MLO to actuals and role sliders to tenant targets
  useEffect(() => {
    if (!baseline) return;
    const pullThrough = baseline.pullThroughRate > 0 ? baseline.pullThroughRate : FALLBACK_PULL_THROUGH;
    const mloActual = baseline.avgUnitsPerMlo > 0 ? baseline.avgUnitsPerMlo : FALLBACK_MLO_ACTUAL;
    setMarginIncreaseBP(0); // Reset increase to 0 when baseline changes
    setPullThroughPercent(pullThrough);
    setMlo(mloActual);
    const t = baseline.targetUnits;
    if (t) {
      setProcessor(t.processor ?? DEFAULT_TARGET_PROCESSOR);
      setUnderwriter(t.underwriter ?? DEFAULT_TARGET_UNDERWRITER);
      setCloser(t.closer ?? DEFAULT_TARGET_CLOSER);
      setOtherSupport(t.other ?? DEFAULT_TARGET_OTHER);
    }
  }, [baseline]);

  const resetSliders = () => {
    const pullThrough = baseline?.pullThroughRate && baseline.pullThroughRate > 0 ? baseline.pullThroughRate : FALLBACK_PULL_THROUGH;
    const mloActual = baseline?.avgUnitsPerMlo && baseline.avgUnitsPerMlo > 0 ? baseline.avgUnitsPerMlo : FALLBACK_MLO_ACTUAL;
    setMarginIncreaseBP(0);
    setPullThroughPercent(pullThrough);
    setMlo(mloActual);
    const t = baseline?.targetUnits;
    setProcessor(t?.processor ?? DEFAULT_TARGET_PROCESSOR);
    setUnderwriter(t?.underwriter ?? DEFAULT_TARGET_UNDERWRITER);
    setCloser(t?.closer ?? DEFAULT_TARGET_CLOSER);
    setOtherSupport(t?.other ?? DEFAULT_TARGET_OTHER);
  };

  /**
   * Print results using a dedicated print window with clean, print-optimized tables.
   * Mirrors the Qlik extension's react-to-print approach: renders a dedicated print layout
   * (Productivity Improvement, Estimated Count, Additional Profit Improvements, Total)
   * in a new window with proper CSS, then triggers the browser print dialog.
   */
  const printResults = () => {
    const productivity = calculateProductivityData();
    const totalProductivitySavings = productivity.reduce(
      (sum, r) => sum + r.productivityImprovement,
      0
    );

    const profitRows: ProfitImprovementData[] = [
      {
        metric: "MLO Improvement",
        actual: baseMloActual.toFixed(1),
        valueSelected: mlo.toFixed(1),
        profitImprovement: mloImprovementDollars,
      },
      {
        metric: "Pull Through Increase",
        actual: `${basePullThroughActual.toFixed(2)}%`,
        valueSelected: `${pullThroughPercent.toFixed(2)}%`,
        profitImprovement: pullThroughImprovementDollars,
      },
      {
        metric: "Margin Improvement",
        actual: `${baseMarginActualBp} BP`,
        valueSelected: `${baseMarginActualBp + marginIncreaseBP} BP`,
        profitImprovement: Math.round(
          marginIncreaseBP > 0 ? marginIncreaseBP * marginProfitPerBp : 0
        ),
      },
    ];

    const totalRevenueIncrease = profitRows.reduce(
      (sum, r) => sum + r.profitImprovement,
      0
    );
    const totalProfitImprovement = totalProductivitySavings + totalRevenueIncrease;

    const fmtCurrency = (v: number) =>
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(v);

    const printWindow = window.open("", "_blank", "width=900,height=700");
    if (!printWindow) return;

    const html = `<!DOCTYPE html>
<html>
<head>
  <title>Proforma Slider Results</title>
  <style>
    @page { margin: 12mm; }
    body {
      font-family: Inter, Arial, Helvetica, sans-serif;
      color: #1e293b;
      margin: 0;
      padding: 24px;
      -webkit-print-color-adjust: exact;
      color-adjust: exact;
    }
    h1 { font-size: 18px; margin: 0 0 4px; }
    .subtitle { font-size: 11px; color: #64748b; margin-bottom: 20px; }
    h2 { font-size: 14px; margin: 18px 0 6px; color: #334155; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 16px; }
    th, td { border: 1px solid #e2e8f0; padding: 6px 10px; text-align: left; font-size: 12px; }
    th { background-color: #f8fafc; font-weight: 600; color: #475569; font-size: 11px; text-transform: uppercase; letter-spacing: 0.02em; }
    td { color: #334155; }
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .text-green { color: #059669; font-weight: 600; }
    .text-red { color: #dc2626; }
    .total-row td { background-color: #f1f5f9; font-weight: 700; font-size: 13px; }
    .section-header td { background-color: #f8fafc; font-weight: 600; }
    .kpi-row { display: flex; gap: 24px; margin-bottom: 16px; }
    .kpi-box { flex: 1; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 14px; }
    .kpi-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; margin-bottom: 2px; }
    .kpi-value { font-size: 20px; font-weight: 700; color: #0f172a; }
    .kpi-sub { font-size: 10px; color: #94a3b8; }
    @media print {
      body { padding: 0; }
    }
  </style>
</head>
<body>
  <h1>Financial Modeling — Proforma Results</h1>
  <div class="subtitle">Generated ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</div>

  <div class="kpi-row">
    <div class="kpi-box">
      <div class="kpi-label">Total Units Closed</div>
      <div class="kpi-value">${(totalClosedUnits ?? 0).toLocaleString()}</div>
      <div class="kpi-sub">Rolling 12 months${baseline?.dateRange?.start && baseline?.dateRange?.end ? ` · ${baseline.dateRange.start} – ${baseline.dateRange.end}` : ""}</div>
    </div>
    <div class="kpi-box">
      <div class="kpi-label">Total Dollars Closed</div>
      <div class="kpi-value">${fmtCurrency(totalClosedVolume ?? 0)}</div>
      <div class="kpi-sub">Rolling 12 months${baseline?.dateRange?.start && baseline?.dateRange?.end ? ` · ${baseline.dateRange.start} – ${baseline.dateRange.end}` : ""}</div>
    </div>
  </div>

  <h2>Productivity Improvement</h2>
  <table>
    <thead>
      <tr>
        <th>User Role</th>
        <th class="text-center">Actual</th>
        <th class="text-center">Target</th>
        <th class="text-center">Delta</th>
        <th class="text-center">Actual Cost</th>
        <th class="text-center">Target Cost</th>
        <th class="text-center">Savings/Unit</th>
        <th class="text-center">Productivity Improvement</th>
      </tr>
    </thead>
    <tbody>
      ${productivity
        .map(
          (r) => `<tr>
        <td>${r.role}</td>
        <td class="text-center">${r.actual}</td>
        <td class="text-center">${r.target}</td>
        <td class="text-center">${r.delta}</td>
        <td class="text-center">${fmtCurrency(r.actualCost)}</td>
        <td class="text-center">${fmtCurrency(r.targetCost)}</td>
        <td class="text-center text-green">${fmtCurrency(r.savingsPerUnit)}</td>
        <td class="text-center text-green">${fmtCurrency(r.productivityImprovement)}</td>
      </tr>`
        )
        .join("\n")}
      <tr class="total-row">
        <td colspan="7">Total Productivity Savings</td>
        <td class="text-center text-green">${fmtCurrency(totalProductivitySavings)}</td>
      </tr>
    </tbody>
  </table>

  <h2>Estimated Headcount</h2>
  <table style="width: auto; min-width: 220px;">
    <thead>
      <tr><th>Role</th><th class="text-center">Estimated Count</th></tr>
    </thead>
    <tbody>
      ${estimatedCountData
        .map(
          (r) => `<tr><td>${r.role}</td><td class="text-center">${r.estimatedCount}</td></tr>`
        )
        .join("\n")}
    </tbody>
  </table>

  <h2>Additional Profit Improvements</h2>
  <table>
    <thead>
      <tr>
        <th>Metric</th>
        <th class="text-center">Actual</th>
        <th class="text-center">Value Selected</th>
        <th class="text-center">Profit Improvement</th>
      </tr>
    </thead>
    <tbody>
      ${profitRows
        .map(
          (r) => `<tr>
        <td>${r.metric}</td>
        <td class="text-center">${r.actual}</td>
        <td class="text-center">${r.valueSelected}</td>
        <td class="text-center text-green">${r.profitImprovement > 0 ? fmtCurrency(r.profitImprovement) : "$0"}</td>
      </tr>`
        )
        .join("\n")}
      <tr class="total-row">
        <td colspan="3">Total Profit Improvements</td>
        <td class="text-center text-green">${fmtCurrency(totalProfitImprovement)}</td>
      </tr>
    </tbody>
  </table>
</body>
</html>`;

    printWindow.document.write(html);
    printWindow.document.close();
    // Wait for content to render before triggering print
    printWindow.onload = () => {
      printWindow.focus();
      printWindow.print();
      printWindow.onafterprint = () => printWindow.close();
    };
  };

  /**
   * PRODUCTIVITY MODELING CONSTANTS
   * ================================
   * These values are baseline assumptions used for financial modeling scenarios.
   * They represent typical industry values and should be customized based on:
   * - Actual company data from the LOS
   * - Regional/market-specific benchmarks
   * - Historical company performance
   *
   * Base Target Units (units per month per FTE):
   * - Processor: 25 units/month - Industry benchmark for loan processing capacity
   * - Underwriter: 45 units/month - Industry benchmark for underwriting throughput
   * - Closer: 85 units/month - Industry benchmark for closing capacity
   * - Other Support: 85 units/month - Combined support functions
   *
   * Sources: MBA mortgage industry benchmarks, internal modeling assumptions
   *
   * TODO: These should be configurable per tenant or fetched from company data.
   */

  // Actual units per month per FTE (Qlik formula: total output / (avg distinct per month * num months))
  // Use *PerMonthFTE when available, else fallback. Other uses same as Closer (Qlik PostCloser = Closer actual).
  const processorActual =
    baseline?.actualUnitsPerProcessorPerMonthFTE &&
    baseline.actualUnitsPerProcessorPerMonthFTE > 0
      ? Math.round(baseline.actualUnitsPerProcessorPerMonthFTE)
      : FALLBACK_PROCESSOR_ACTUAL;
  const underwriterActual =
    baseline?.actualUnitsPerUnderwriterPerMonthFTE &&
    baseline.actualUnitsPerUnderwriterPerMonthFTE > 0
      ? Math.round(baseline.actualUnitsPerUnderwriterPerMonthFTE)
      : FALLBACK_UNDERWRITER_ACTUAL;
  const closerActual =
    baseline?.actualUnitsPerCloserPerMonthFTE &&
    baseline.actualUnitsPerCloserPerMonthFTE > 0
      ? Math.round(baseline.actualUnitsPerCloserPerMonthFTE)
      : FALLBACK_CLOSER_ACTUAL;
  const otherActual = closerActual; // Qlik: PostCloser/Other uses same actual as Closer

  // Revenue/margin baseline from tenant or fallbacks
  const baseMloActual =
    baseline?.avgUnitsPerMlo && baseline.avgUnitsPerMlo > 0
      ? baseline.avgUnitsPerMlo
      : FALLBACK_MLO_ACTUAL;
  const basePullThroughActual =
    baseline?.pullThroughRate && baseline.pullThroughRate > 0
      ? baseline.pullThroughRate
      : FALLBACK_PULL_THROUGH;
  const baseMarginActualBp =
    baseline?.marginBps && baseline.marginBps > 0
      ? baseline.marginBps
      : FALLBACK_MARGIN_BP;
  const baseMarginProfit =
    baseline?.totalRevenue && baseline.totalRevenue > 0
      ? baseline.totalRevenue
      : FALLBACK_MARGIN_PROFIT;

  const marginProfitPerBp =
    baseMarginActualBp > 0 ? baseMarginProfit / baseMarginActualBp : 0;

  // Total closed units and volume in period (rolling 12 months)
  const totalClosedUnits = baseline?.fundedUnits ?? 0;
  const totalClosedVolume = baseline?.totalVolume ?? 0;
  const avgLoanSize =
    totalClosedUnits > 0 ? totalClosedVolume / totalClosedUnits : 0;
  // Raw headcount (for display). For improvement $ we use derived "effective MLOs" like Qlik so numbers match.
  const mloCount =
    baseline?.mloCount && baseline.mloCount > 0 ? baseline.mloCount : 1;
  // Qlik: numberOfMLOs = totalClosedUnits / 13 / mloUnitsActual (effective FTE). Use 13 to match Qlik dollar-for-dollar.
  const monthsForEffectiveMLOs = 13;
  const effectiveMLOs =
    baseMloActual > 0 && totalClosedUnits > 0
      ? Math.round(totalClosedUnits / monthsForEffectiveMLOs / baseMloActual)
      : mloCount;

  /**
   * MLO Improvement (Qlik formula): same effective MLO count, higher units/LO/month → extra revenue.
   * loUnitImprovement = numberOfMLOs * (sliderMLO - mloUnitsActual) * 12 * avgLoanSize * (marginBPS/10000)
   */
  const mloImprovementDollars =
    mlo > baseMloActual && avgLoanSize > 0 && baseMarginActualBp > 0
      ? Math.round(
          Math.max(1, effectiveMLOs) *
            (mlo - baseMloActual) *
            12 *
            avgLoanSize *
            (baseMarginActualBp / 10000)
        )
      : 0;

  // Debug: MLO improvement inputs (open DevTools Console to verify effectiveMLOs vs mloCount)
  useEffect(() => {
    if (baseline && (totalClosedUnits > 0 || baseMloActual > 0)) {
      const usingDerived = baseMloActual > 0 && totalClosedUnits > 0;
      console.debug("[FinancialModeling] MLO improvement", {
        source: usingDerived ? "effectiveMLOs (derived)" : "mloCount (fallback)",
        totalClosedUnits,
        baseMloActual,
        mloCount,
        effectiveMLOs,
        monthsForEffectiveMLOs,
        mloSlider: mlo,
        deltaUnits: mlo - baseMloActual,
        avgLoanSize,
        baseMarginActualBp,
        mloImprovementDollars,
      });
    }
  }, [
    baseline,
    totalClosedUnits,
    baseMloActual,
    mloCount,
    effectiveMLOs,
    mlo,
    avgLoanSize,
    baseMarginActualBp,
    mloImprovementDollars,
  ]);

  /**
   * Pull-through improvement (Qlik formula): more applications convert → more closed units → more revenue.
   * pullthroughTarget = unitsApplication * (sliderPullthrough/100) * avgLoanSize * (margin/10000), pullthroughBase = totalClosedUnits * avgLoanSize * (margin/10000).
   */
  const unitsApplication =
    basePullThroughActual > 0
      ? (totalClosedUnits * 100) / basePullThroughActual
      : 0;
  const pullThroughImprovementDollars =
    pullThroughPercent > basePullThroughActual &&
    avgLoanSize > 0 &&
    baseMarginActualBp > 0 && basePullThroughActual > 0
      ? Math.round(
          Math.max(
            0,
            unitsApplication *
              (pullThroughPercent / 100) *
              avgLoanSize *
              (baseMarginActualBp / 10000) -
              totalClosedUnits *
                avgLoanSize *
                (baseMarginActualBp / 10000)
          )
        )
      : 0;

  const calculateDeltaProfit = (
    selected: number,
    actual: number,
    profitPerPoint: number
  ) => {
    const delta = selected - actual;
    if (delta <= 0 || profitPerPoint <= 0) {
      return 0;
    }
    return Math.round(delta * profitPerPoint);
  };

  // Actual Cost = monthlyComp/actual, Target Cost = monthlyComp/target. Delta = actual - target (negative when under target). Savings/Improvement when actual < target.
  const calculateProductivityData = (): ProductivityData[] => {
    const rows: { role: string; actual: number; target: number }[] = [
      { role: "Processor", actual: processorActual, target: processor },
      { role: "Underwriter", actual: underwriterActual, target: underwriter },
      { role: "Closer", actual: closerActual, target: closer },
      { role: "Other", actual: otherActual, target: otherSupport },
    ];
    return rows.map(({ role, actual, target }) => {
      const annualSalary = ROLE_ANNUAL_SALARIES[role] ?? 0;
      const monthlyComp = annualSalary / 12;
      const delta = actual - target; // negative when actual under target
      const actualCost =
        actual > 0 ? Math.round(monthlyComp / actual) : 0;
      const targetCost =
        target > 0 ? Math.round(monthlyComp / target) : 0;
      const savingsPerUnit =
        actual > 0 && actual < target ? actualCost - targetCost : 0;
      const productivityImprovement = Math.round(
        savingsPerUnit * totalClosedUnits
      );
      return {
        role,
        actual,
        target,
        delta,
        actualCost,
        targetCost,
        savingsPerUnit,
        productivityImprovement,
      };
    });
  };

  const productivityData = calculateProductivityData();

  const estimatedCountData: EstimatedCountData[] = [
    {
      role: "MLOs",
      estimatedCount:
        baseline?.mloCount && baseline.mloCount > 0 ? baseline.mloCount : 35,
    },
    { role: "Processors", estimatedCount: 7 },
    { role: "Underwriters", estimatedCount: 7 },
    { role: "Closers", estimatedCount: 5 },
    { role: "Other", estimatedCount: 5 },
  ];

  const profitImprovementData: ProfitImprovementData[] = [
    {
      metric: "MLO Improvement",
      actual: baseMloActual.toFixed(1),
      valueSelected: mlo.toFixed(1),
      profitImprovement: mloImprovementDollars,
    },
    {
      metric: "Pull Through Increase",
      actual: `${basePullThroughActual.toFixed(2)}%`,
      valueSelected: `${pullThroughPercent.toFixed(2)}%`,
      profitImprovement: pullThroughImprovementDollars,
    },
    {
      metric: "Margin Improvement",
      actual: `${baseMarginActualBp} BP`,
      valueSelected: `${baseMarginActualBp + marginIncreaseBP} BP`,
      profitImprovement: Math.round(
        marginIncreaseBP > 0 ? marginIncreaseBP * marginProfitPerBp : 0
      ),
    },
  ];

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  useEffect(() => {
    if (!onDataReady || baselineLoading || !baseline) return;
    const fmtCur = (v: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);
    const columns = [
      { key: 'metric', label: 'Metric', align: 'left' as const },
      { key: 'actual', label: 'Actual', align: 'right' as const },
      { key: 'selected', label: 'Selected', align: 'right' as const },
      { key: 'improvement', label: 'Profit Improvement', align: 'right' as const },
    ];
    const rows = profitImprovementData.map((r) => ({
      metric: r.metric,
      actual: r.actual,
      selected: r.valueSelected,
      improvement: fmtCur(r.profitImprovement),
    }));
    onDataReady({ columns, rows, title: 'Financial Modeling Sandbox' });
  }, [onDataReady, baselineLoading, baseline, profitImprovementData]);

  if (baselineLoading) {
    return (
      <div className="w-full flex flex-col items-center justify-center py-16">
        <Loader2
          className={`h-10 w-10 animate-spin ${
            isDarkMode ? "text-slate-400" : "text-blue-600"
          }`}
        />
        <p
          className={`mt-4 text-sm ${
            isDarkMode ? "text-slate-400" : "text-slate-600"
          }`}
        >
          Loading baseline data…
        </p>
      </div>
    );
  }

  return (
    <div className="w-full">
      {baselineError && (
        <div
          className={`mb-4 rounded-lg px-4 py-2 text-sm ${
            isDarkMode
              ? "bg-red-900/30 text-red-300 border border-red-800/50"
              : "bg-red-50 text-red-700 border border-red-200"
          }`}
        >
          {baselineError} Using demo assumptions for baseline.
        </div>
      )}
      {/* Description */}
      <div className="text-center mb-4 sm:mb-6 py-3 sm:py-4 px-4 sm:px-6">
        <p
          className={`text-xs sm:text-sm ${
            isDarkMode ? "text-slate-300" : "text-slate-600"
          }`}
        >
          A dynamic workspace for target-driven lenders to compare actual
          staffing metrics against strategic targets. Explore potential cost
          savings and profit improvements in real time.
        </p>
      </div>

      {/* KPIs: Total Units Closed, Total Dollars Closed (Rolling 12 months) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mb-4 sm:mb-6">
        <Card
          className={`rounded-xl ${
            isDarkMode
              ? "border-slate-700/50 bg-slate-800/70"
              : "border-blue-200/40 bg-white"
          }`}
        >
          <CardContent className="pt-4 pb-4 px-4">
            <p
              className={`text-xs font-semibold uppercase tracking-wider mb-1 ${
                isDarkMode ? "text-slate-400" : "text-slate-500"
              }`}
            >
              Total Units Closed
            </p>
            <p
              className={`text-2xl font-bold ${
                isDarkMode ? "text-slate-100" : "text-slate-900"
              }`}
            >
              {baseline?.fundedUnits ?? 0}
            </p>
            <p className={`text-xs mt-1 ${isDarkMode ? "text-slate-500" : "text-slate-400"}`}>
              Rolling 12 months
              {baseline?.dateRange?.start && baseline?.dateRange?.end && (
                <span> · {baseline.dateRange.start} – {baseline.dateRange.end}</span>
              )}
            </p>
          </CardContent>
        </Card>
        <Card
          className={`rounded-xl ${
            isDarkMode
              ? "border-slate-700/50 bg-slate-800/70"
              : "border-blue-200/40 bg-white"
          }`}
        >
          <CardContent className="pt-4 pb-4 px-4">
            <p
              className={`text-xs font-semibold uppercase tracking-wider mb-1 ${
                isDarkMode ? "text-slate-400" : "text-slate-500"
              }`}
            >
              Total Dollars Closed
            </p>
            <p
              className={`text-2xl font-bold ${
                isDarkMode ? "text-slate-100" : "text-slate-900"
              }`}
            >
              {formatCurrency(baseline?.totalVolume ?? 0)}
            </p>
            <p className={`text-xs mt-1 ${isDarkMode ? "text-slate-500" : "text-slate-400"}`}>
              Rolling 12 months
              {baseline?.dateRange?.start && baseline?.dateRange?.end && (
                <span> · {baseline.dateRange.start} – {baseline.dateRange.end}</span>
              )}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Two-Column Layout: Sliders Left, Content Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 sm:gap-4">
        {/* Left Panel - Sliders */}
        <div className="col-span-12 lg:col-span-3 overflow-y-auto pr-1 sm:pr-2 flex flex-col px-2 sm:px-3">
          <div className="grid grid-cols-1 gap-2 sm:gap-2.5 flex-1">
            {/* Section: Revenue & Pipeline */}
            <div className={`text-[9px] sm:text-[10px] font-semibold uppercase tracking-widest px-1 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
              Revenue &amp; Pipeline
            </div>
            <HorizontalSlider
              label="Margin Increase (BP)"
              value={marginIncreaseBP}
              onValueChange={setMarginIncreaseBP}
              min={0}
              max={100}
              step={1}
              formatValue={(val) => `${val}`}
              isDarkMode={isDarkMode}
              hint={`Current: ${baseMarginActualBp} BP → With increase: ${baseMarginActualBp + marginIncreaseBP} BP`}
            />
            <HorizontalSlider
              label="Pull Through Rate (%)"
              value={pullThroughPercent}
              onValueChange={setPullThroughPercent}
              min={0}
              max={100}
              step={0.01}
              formatValue={(val) => val.toFixed(2)}
              isDarkMode={isDarkMode}
              hint={`Baseline: ${basePullThroughActual.toFixed(2)}%`}
            />
            <HorizontalSlider
              label="MLO (units/LO/month)"
              value={mlo}
              onValueChange={setMlo}
              min={0}
              max={15}
              step={0.1}
              formatValue={(val) => val.toFixed(1)}
              isDarkMode={isDarkMode}
              hint={`Baseline: ${baseMloActual.toFixed(1)} units/LO/month`}
            />

            {/* Section: Staffing Targets */}
            <div className={`text-[9px] sm:text-[10px] font-semibold uppercase tracking-widest px-1 pt-1 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
              Staffing Targets — units / month / FTE
            </div>
            <HorizontalSlider
              label="Processor"
              value={processor}
              onValueChange={setProcessor}
              min={0}
              max={100}
              step={1}
              formatValue={(val) => `${val}`}
              isDarkMode={isDarkMode}
              hint={`Actual: ${processorActual} units/mo`}
            />
            <HorizontalSlider
              label="Underwriter"
              value={underwriter}
              onValueChange={setUnderwriter}
              min={0}
              max={100}
              step={1}
              formatValue={(val) => `${val}`}
              isDarkMode={isDarkMode}
              hint={`Actual: ${underwriterActual} units/mo`}
            />
            <HorizontalSlider
              label="Closer"
              value={closer}
              onValueChange={setCloser}
              min={0}
              max={100}
              step={1}
              formatValue={(val) => `${val}`}
              isDarkMode={isDarkMode}
              hint={`Actual: ${closerActual} units/mo`}
            />
            <HorizontalSlider
              label="Other Support"
              value={otherSupport}
              onValueChange={setOtherSupport}
              min={0}
              max={100}
              step={1}
              formatValue={(val) => `${val}`}
              isDarkMode={isDarkMode}
              hint={`Actual: ${otherActual} units/mo`}
            />
          </div>

          {/* Footer Buttons */}
          <div className="flex flex-col sm:flex-row gap-2 pt-3 sm:pt-4 mt-auto">
            <Button
              onClick={resetSliders}
              className="w-full sm:flex-1 gap-1.5 sm:gap-2 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white font-light shadow-lg hover:shadow-xl transition-all duration-300 rounded-xl text-xs sm:text-sm"
              size="sm"
            >
              <RotateCcw className="h-3.5 w-3.5 sm:h-4 sm:w-4 flex-shrink-0" />
              <span className="truncate">RESET SLIDERS</span>
            </Button>
            <Button
              onClick={printResults}
              className="w-full sm:flex-1 gap-1.5 sm:gap-2 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white font-light shadow-lg hover:shadow-xl transition-all duration-300 rounded-xl text-xs sm:text-sm"
              size="sm"
            >
              <Printer className="h-3.5 w-3.5 sm:h-4 sm:w-4 flex-shrink-0" />
              <span className="truncate">PRINT RESULTS</span>
            </Button>
          </div>
        </div>

        {/* Right Panel - Tables */}
        <div className="col-span-12 lg:col-span-9 space-y-3 sm:space-y-3 overflow-y-auto">
          {/* Additional Profit Improvements Table */}
          <Card
            className={`rounded-xl backdrop-blur-sm ${
              isDarkMode
                ? "border-slate-700/50 bg-slate-800/70 shadow-[0_8px_24px_rgba(0,0,0,0.3)]"
                : "border-blue-200/40 bg-white shadow-[0_8px_24px_rgba(59,130,246,0.08)]"
            }`}
          >
            <CardHeader
              className={`border-b pb-2 ${
                isDarkMode
                  ? "border-slate-700/50 bg-gradient-to-r from-slate-800/50 to-slate-700/30"
                  : "border-blue-100/50 bg-gradient-to-r from-blue-50/30 to-purple-50/30"
              }`}
            >
              <CardTitle className="text-base font-bold">
                Additional Profit Improvements
              </CardTitle>
              <p className={`text-[10px] sm:text-xs mt-0.5 font-normal ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                Revenue impact from adjusting margin, pull-through, and MLO productivity targets
              </p>
            </CardHeader>
            <CardContent className="pt-2">
              <div className="overflow-x-auto -mx-2 sm:mx-0">
                <div className="min-w-[500px] sm:min-w-0">
                  <table className="w-full border-collapse text-xs sm:text-sm">
                    <thead>
                      <tr
                        className={`border-b-2 ${
                          isDarkMode ? "border-slate-700" : "border-slate-300"
                        }`}
                      >
                        <th
                          className={`text-left py-1.5 sm:py-2 px-2 sm:px-3 text-[10px] sm:text-xs font-semibold ${
                            isDarkMode ? "text-slate-400" : "text-slate-600"
                          }`}
                        >
                          Metric
                        </th>
                        <th
                          className={`text-center py-1.5 sm:py-2 px-2 sm:px-3 text-[10px] sm:text-xs font-semibold ${
                            isDarkMode ? "text-slate-400" : "text-slate-600"
                          }`}
                        >
                          Actual
                        </th>
                        <th
                          className={`text-center py-1.5 sm:py-2 px-2 sm:px-3 text-[10px] sm:text-xs font-semibold ${
                            isDarkMode ? "text-slate-400" : "text-slate-600"
                          }`}
                        >
                          Target (Selected)
                        </th>
                        <th
                          className={`text-center py-1.5 sm:py-2 px-2 sm:px-3 text-[10px] sm:text-xs font-semibold ${
                            isDarkMode ? "text-slate-400" : "text-slate-600"
                          }`}
                        >
                          Est. Profit Improvement
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {profitImprovementData.map((row, idx) => (
                        <tr
                          key={idx}
                          className={`border-b transition-colors ${
                            isDarkMode
                              ? "border-slate-800/50 hover:bg-slate-700/30"
                              : "border-slate-200 hover:bg-slate-50"
                          }`}
                        >
                          <td
                            className={`py-1.5 sm:py-2 px-2 sm:px-3 text-xs sm:text-sm font-medium ${
                              isDarkMode ? "text-slate-200" : "text-slate-900"
                            }`}
                          >
                            {row.metric}
                          </td>
                          <td
                            className={`py-1.5 sm:py-2 px-2 sm:px-3 text-xs sm:text-sm text-center ${
                              isDarkMode ? "text-slate-300" : "text-slate-700"
                            }`}
                          >
                            {row.actual}
                          </td>
                          <td
                            className={`py-1.5 sm:py-2 px-2 sm:px-3 text-xs sm:text-sm text-center font-semibold ${
                              isDarkMode ? "text-slate-200" : "text-slate-900"
                            }`}
                          >
                            {row.valueSelected}
                          </td>
                          <td
                            className={`py-1.5 sm:py-2 px-2 sm:px-3 text-xs sm:text-sm text-center font-semibold ${
                              row.profitImprovement > 0
                                ? "text-emerald-600 dark:text-emerald-400"
                                : isDarkMode
                                ? "text-slate-400"
                                : "text-slate-500"
                            }`}
                          >
                            {row.profitImprovement > 0
                              ? formatCurrency(row.profitImprovement)
                              : "$0"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Tables Section */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-3">
            {/* Productivity Improvement Table */}
            <div className="lg:col-span-2">
              <Card
                className={`rounded-xl backdrop-blur-sm ${
                  isDarkMode
                    ? "border-slate-700/50 bg-slate-800/70 shadow-[0_8px_24px_rgba(0,0,0,0.3)]"
                    : "border-blue-200/40 bg-white shadow-[0_8px_24px_rgba(59,130,246,0.08)]"
                }`}
              >
                <CardHeader
                  className={`border-b pb-2 ${
                    isDarkMode
                      ? "border-slate-700/50 bg-gradient-to-r from-slate-800/50 to-slate-700/30"
                      : "border-blue-100/50 bg-gradient-to-r from-blue-50/30 to-purple-50/30"
                  }`}
                >
                  <CardTitle className="text-base font-bold">
                    Productivity Improvement
                  </CardTitle>
                  <p className={`text-[10px] sm:text-xs mt-0.5 font-normal ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                    Actual &amp; Target values represent units per month per FTE. Cost = monthly compensation / units.
                  </p>
                </CardHeader>
                <CardContent className="pt-2">
                  <div className="overflow-x-auto -mx-2 sm:mx-0 max-h-[600px] overflow-y-auto">
                    <div className="min-w-[600px] sm:min-w-0">
                      <table className="w-full border-collapse text-xs sm:text-sm">
                        <thead className="sticky top-0 z-10">
                          <tr
                            className={`border-b-2 ${
                              isDarkMode
                                ? "border-slate-700 bg-slate-800/70"
                                : "border-slate-300 bg-white"
                            }`}
                          >
                            <th
                              className={`text-left py-1.5 sm:py-2 px-2 sm:px-3 text-[10px] sm:text-xs font-semibold ${
                                isDarkMode ? "text-slate-400" : "text-slate-600"
                              }`}
                            >
                              User Role
                            </th>
                            <th
                              className={`text-center py-1.5 sm:py-2 px-2 sm:px-3 text-[10px] sm:text-xs font-semibold ${
                                isDarkMode ? "text-slate-400" : "text-slate-600"
                              }`}
                            >
                              Actual (units/mo)
                            </th>
                            <th
                              className={`text-center py-1.5 sm:py-2 px-2 sm:px-3 text-[10px] sm:text-xs font-semibold ${
                                isDarkMode ? "text-slate-400" : "text-slate-600"
                              }`}
                            >
                              Target (units/mo)
                            </th>
                            <th
                              className={`text-center py-1.5 sm:py-2 px-2 sm:px-3 text-[10px] sm:text-xs font-semibold ${
                                isDarkMode ? "text-slate-400" : "text-slate-600"
                              }`}
                            >
                              Delta
                            </th>
                            <th
                              className={`text-center py-1.5 sm:py-2 px-2 sm:px-3 text-[10px] sm:text-xs font-semibold ${
                                isDarkMode ? "text-slate-400" : "text-slate-600"
                              }`}
                            >
                              Actual Cost/Unit
                            </th>
                            <th
                              className={`text-center py-1.5 sm:py-2 px-2 sm:px-3 text-[10px] sm:text-xs font-semibold ${
                                isDarkMode ? "text-slate-400" : "text-slate-600"
                              }`}
                            >
                              Target Cost/Unit
                            </th>
                            <th
                              className={`text-center py-1.5 sm:py-2 px-2 sm:px-3 text-[10px] sm:text-xs font-semibold ${
                                isDarkMode ? "text-slate-400" : "text-slate-600"
                              }`}
                            >
                              Savings/Unit
                            </th>
                            <th
                              className={`text-center py-1.5 sm:py-2 px-2 sm:px-3 text-[10px] sm:text-xs font-semibold ${
                                isDarkMode ? "text-slate-400" : "text-slate-600"
                              }`}
                            >
                              Est. Improvement
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {productivityData.map((row, idx) => (
                            <tr
                              key={idx}
                              className={`border-b transition-colors ${
                                isDarkMode
                                  ? "border-slate-800/50 hover:bg-slate-700/30"
                                  : "border-slate-200 hover:bg-slate-50"
                              }`}
                            >
                              <td
                                className={`py-1.5 sm:py-2 px-2 sm:px-3 text-xs sm:text-sm font-medium ${
                                  isDarkMode
                                    ? "text-slate-200"
                                    : "text-slate-900"
                                }`}
                              >
                                {row.role}
                              </td>
                              <td
                                className={`py-1.5 sm:py-2 px-2 sm:px-3 text-xs sm:text-sm text-center ${
                                  isDarkMode
                                    ? "text-slate-300"
                                    : "text-slate-700"
                                }`}
                              >
                                {row.actual}
                              </td>
                              <td
                                className={`py-1.5 sm:py-2 px-2 sm:px-3 text-xs sm:text-sm text-center font-semibold ${
                                  isDarkMode
                                    ? "text-slate-200"
                                    : "text-slate-900"
                                }`}
                              >
                                {row.target}
                              </td>
                              <td
                                className={`py-1.5 sm:py-2 px-2 sm:px-3 text-xs sm:text-sm text-center ${
                                  row.delta >= 0
                                    ? "text-emerald-600 dark:text-emerald-400"
                                    : "text-red-600 dark:text-red-400"
                                }`}
                              >
                                {row.delta >= 0 ? "+" : ""}
                                {row.delta}
                              </td>
                              <td
                                className={`py-1.5 sm:py-2 px-2 sm:px-3 text-xs sm:text-sm text-center ${
                                  isDarkMode
                                    ? "text-slate-300"
                                    : "text-slate-700"
                                }`}
                              >
                                {formatCurrency(row.actualCost)}
                              </td>
                              <td
                                className={`py-1.5 sm:py-2 px-2 sm:px-3 text-xs sm:text-sm text-center ${
                                  isDarkMode
                                    ? "text-slate-300"
                                    : "text-slate-700"
                                }`}
                              >
                                {formatCurrency(row.targetCost)}
                              </td>
                              <td
                                className={`py-1.5 sm:py-2 px-2 sm:px-3 text-xs sm:text-sm text-center font-semibold text-emerald-600 dark:text-emerald-400`}
                              >
                                {formatCurrency(row.savingsPerUnit)}
                              </td>
                              <td
                                className={`py-1.5 sm:py-2 px-2 sm:px-3 text-xs sm:text-sm text-center font-semibold text-emerald-600 dark:text-emerald-400`}
                              >
                                {formatCurrency(row.productivityImprovement)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Estimated Count Table */}
            <div>
              <Card
                className={`rounded-xl backdrop-blur-sm ${
                  isDarkMode
                    ? "border-slate-700/50 bg-slate-800/70 shadow-[0_8px_24px_rgba(0,0,0,0.3)]"
                    : "border-blue-200/40 bg-white shadow-[0_8px_24px_rgba(59,130,246,0.08)]"
                }`}
              >
                <CardHeader
                  className={`border-b pb-2 ${
                    isDarkMode
                      ? "border-slate-700/50 bg-gradient-to-r from-slate-800/50 to-slate-700/30"
                      : "border-blue-100/50 bg-gradient-to-r from-blue-50/30 to-purple-50/30"
                  }`}
                >
                  <CardTitle className="text-base font-bold">
                    Estimated Count
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-2">
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-xs sm:text-sm">
                      <thead>
                        <tr
                          className={`border-b-2 ${
                            isDarkMode ? "border-slate-700" : "border-slate-300"
                          }`}
                        >
                          <th
                            className={`text-left py-1.5 sm:py-2 px-2 sm:px-3 text-[10px] sm:text-xs font-semibold ${
                              isDarkMode ? "text-slate-400" : "text-slate-600"
                            }`}
                          >
                            Role
                          </th>
                          <th
                            className={`text-center py-1.5 sm:py-2 px-2 sm:px-3 text-[10px] sm:text-xs font-semibold ${
                              isDarkMode ? "text-slate-400" : "text-slate-600"
                            }`}
                          >
                            Estimated Count
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {estimatedCountData.map((row, idx) => (
                          <tr
                            key={idx}
                            className={`border-b transition-colors ${
                              isDarkMode
                                ? "border-slate-800/50 hover:bg-slate-700/30"
                                : "border-slate-200 hover:bg-slate-50"
                            }`}
                          >
                            <td
                              className={`py-1.5 sm:py-2 px-2 sm:px-3 text-xs sm:text-sm font-medium ${
                                isDarkMode ? "text-slate-200" : "text-slate-900"
                              }`}
                            >
                              {row.role}
                            </td>
                            <td
                              className={`py-1.5 sm:py-2 px-2 sm:px-3 text-xs sm:text-sm text-center font-semibold ${
                                isDarkMode ? "text-slate-200" : "text-slate-900"
                              }`}
                            >
                              {row.estimatedCount}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
