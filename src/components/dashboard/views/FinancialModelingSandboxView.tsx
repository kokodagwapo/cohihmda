import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTheme } from "@/components/theme-provider";
import { Printer, RotateCcw } from "lucide-react";
import * as SliderPrimitive from "@radix-ui/react-slider";

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

export function FinancialModelingSandboxView() {
  const { theme } = useTheme();
  const isDarkMode = theme === "dark";

  // Slider values - matching the image
  const [marginIncreaseBP, setMarginIncreaseBP] = useState(20);
  const [pullThroughPercent, setPullThroughPercent] = useState(64.09);
  const [mlo, setMlo] = useState(3);
  const [processor, setProcessor] = useState(100);
  const [underwriter, setUnderwriter] = useState(100);
  const [closer, setCloser] = useState(85);
  const [otherSupport, setOtherSupport] = useState(85);

  const resetSliders = () => {
    setMarginIncreaseBP(20);
    setPullThroughPercent(64.09);
    setMlo(3);
    setProcessor(100);
    setUnderwriter(100);
    setCloser(85);
    setOtherSupport(85);
  };

  const printResults = () => {
    window.print();
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

  // Base target units per month (industry benchmarks)
  const BASE_TARGET_PROCESSOR = 25; // Units/month target for processors
  const BASE_TARGET_UNDERWRITER = 45; // Units/month target for underwriters
  const BASE_TARGET_CLOSER = 85; // Units/month target for closers
  const BASE_TARGET_OTHER = 85; // Units/month target for other support

  // Actual performance values (baseline scenario)
  const processorActual = 24;
  const processorActualCost = 260; // Cost per unit ($)
  const processorBaseTargetCost = 250; // Target cost per unit at base productivity
  const processorBaseSavings = 10; // Savings per unit at base ($)
  const processorBaseImprovement = 20400; // Total improvement at base ($)

  const underwriterActual = 22;
  const underwriterActualCost = 473;
  const underwriterBaseTargetCost = 231;
  const underwriterBaseSavings = 242;
  const underwriterBaseImprovement = 493680;

  const closerActual = 33;
  const closerActualCost = 215;
  const closerBaseTargetCost = 83;
  const closerBaseSavings = 132;
  const closerBaseImprovement = 269280;

  const otherActual = 33;
  const otherActualCost = 177;
  const otherBaseTargetCost = 69;
  const otherBaseSavings = 108;
  const otherBaseImprovement = 220320;

  // Revenue/margin baseline values
  const baseMloActual = 4.5; // MLO actual performance (loans/month)
  const basePullThroughActual = 64.09; // Pull-through rate (%)
  const baseMarginActualBp = 20; // Margin in basis points
  const baseMarginProfit = 932725; // Total margin profit at baseline ($)

  const marginProfitPerBp = baseMarginProfit / baseMarginActualBp;
  const mloProfitPerPoint = baseMarginProfit / baseMloActual;
  const pullThroughProfitPerPoint = baseMarginProfit / basePullThroughActual;

  const calculateTargetCost = (
    baseTargetCost: number,
    baseTarget: number,
    target: number
  ) => {
    if (target <= 0) {
      return 0;
    }
    return Math.round((baseTargetCost * baseTarget) / target);
  };

  const calculateImprovement = (
    baseImprovement: number,
    savingsPerUnit: number,
    baseSavings: number
  ) => {
    if (baseSavings <= 0) {
      return 0;
    }
    return Math.round((baseImprovement * savingsPerUnit) / baseSavings);
  };

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

  const calculateProductivityData = (): ProductivityData[] => {
    // Calculate target cost based on ratio of target to base target
    // Uses BASE_TARGET_* constants defined above (industry benchmarks)
    const processorTargetCost = calculateTargetCost(
      processorBaseTargetCost,
      BASE_TARGET_PROCESSOR,
      processor
    );
    const processorSavingsPerUnit =
      processor > 0 ? processorActualCost - processorTargetCost : 0;
    const processorImprovement =
      processor > 0
        ? calculateImprovement(
            processorBaseImprovement,
            processorSavingsPerUnit,
            processorBaseSavings
          )
        : 0;

    const underwriterTargetCost = calculateTargetCost(
      underwriterBaseTargetCost,
      BASE_TARGET_UNDERWRITER,
      underwriter
    );
    const underwriterSavingsPerUnit =
      underwriter > 0 ? underwriterActualCost - underwriterTargetCost : 0;
    const underwriterImprovement =
      underwriter > 0
        ? calculateImprovement(
            underwriterBaseImprovement,
            underwriterSavingsPerUnit,
            underwriterBaseSavings
          )
        : 0;

    const closerTargetCost = calculateTargetCost(
      closerBaseTargetCost,
      BASE_TARGET_CLOSER,
      closer
    );
    const closerSavingsPerUnit =
      closer > 0 ? closerActualCost - closerTargetCost : 0;
    const closerImprovement =
      closer > 0
        ? calculateImprovement(
            closerBaseImprovement,
            closerSavingsPerUnit,
            closerBaseSavings
          )
        : 0;

    const otherTargetCost = calculateTargetCost(
      otherBaseTargetCost,
      BASE_TARGET_OTHER,
      otherSupport
    );
    const otherSavingsPerUnit =
      otherSupport > 0 ? otherActualCost - otherTargetCost : 0;
    const otherImprovement =
      otherSupport > 0
        ? calculateImprovement(
            otherBaseImprovement,
            otherSavingsPerUnit,
            otherBaseSavings
          )
        : 0;

    return [
      {
        role: "Processor",
        actual: processorActual,
        target: processor,
        delta: processor - processorActual,
        actualCost: processorActualCost,
        targetCost: processorTargetCost,
        savingsPerUnit: processorSavingsPerUnit,
        productivityImprovement: processorImprovement,
      },
      {
        role: "Underwriter",
        actual: underwriterActual,
        target: underwriter,
        delta: underwriter - underwriterActual,
        actualCost: underwriterActualCost,
        targetCost: underwriterTargetCost,
        savingsPerUnit: underwriterSavingsPerUnit,
        productivityImprovement: underwriterImprovement,
      },
      {
        role: "Closer",
        actual: closerActual,
        target: closer,
        delta: closer - closerActual,
        actualCost: closerActualCost,
        targetCost: closerTargetCost,
        savingsPerUnit: closerSavingsPerUnit,
        productivityImprovement: closerImprovement,
      },
      {
        role: "Other",
        actual: otherActual,
        target: otherSupport,
        delta: otherSupport - otherActual,
        actualCost: otherActualCost,
        targetCost: otherTargetCost,
        savingsPerUnit: otherSavingsPerUnit,
        productivityImprovement: otherImprovement,
      },
    ];
  };

  const productivityData = calculateProductivityData();

  const estimatedCountData: EstimatedCountData[] = [
    { role: "MLOs", estimatedCount: 35 },
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
      profitImprovement: calculateDeltaProfit(
        mlo,
        baseMloActual,
        mloProfitPerPoint
      ),
    },
    {
      metric: "Pull Through Increase",
      actual: `${basePullThroughActual.toFixed(2)}%`,
      valueSelected: `${pullThroughPercent.toFixed(2)}%`,
      profitImprovement: calculateDeltaProfit(
        pullThroughPercent,
        basePullThroughActual,
        pullThroughProfitPerPoint
      ),
    },
    {
      metric: "Margin Improvement",
      actual: `${baseMarginActualBp} BP`,
      valueSelected: `${marginIncreaseBP} BP`,
      profitImprovement: Math.round(
        Math.max(0, marginIncreaseBP) * marginProfitPerBp
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

  return (
    <div className="w-full">
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

      {/* Two-Column Layout: Sliders Left, Content Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 sm:gap-4">
        {/* Left Panel - Sliders */}
        <div className="col-span-12 lg:col-span-3 overflow-y-auto pr-1 sm:pr-2 flex flex-col px-2 sm:px-3">
          <div className="grid grid-cols-1 gap-2 sm:gap-2.5 flex-1">
            <HorizontalSlider
              label="Margin Increase BP"
              value={marginIncreaseBP}
              onValueChange={setMarginIncreaseBP}
              min={0}
              max={100}
              step={1}
              formatValue={(val) => `${val}`}
              isDarkMode={isDarkMode}
            />
            <HorizontalSlider
              label="Pull through %"
              value={pullThroughPercent}
              onValueChange={setPullThroughPercent}
              min={0}
              max={100}
              step={0.01}
              formatValue={(val) => val.toFixed(2)}
              isDarkMode={isDarkMode}
            />
            <HorizontalSlider
              label="MLO"
              value={mlo}
              onValueChange={setMlo}
              min={0}
              max={10}
              step={0.1}
              formatValue={(val) => val.toFixed(1)}
              isDarkMode={isDarkMode}
            />
            <HorizontalSlider
              label="Processor"
              value={processor}
              onValueChange={setProcessor}
              min={0}
              max={100}
              step={1}
              formatValue={(val) => `${val}`}
              isDarkMode={isDarkMode}
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
            />
            <HorizontalSlider
              label="Other Support Employees"
              value={otherSupport}
              onValueChange={setOtherSupport}
              min={0}
              max={100}
              step={1}
              formatValue={(val) => `${val}`}
              isDarkMode={isDarkMode}
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
                              Actual
                            </th>
                            <th
                              className={`text-center py-1.5 sm:py-2 px-2 sm:px-3 text-[10px] sm:text-xs font-semibold ${
                                isDarkMode ? "text-slate-400" : "text-slate-600"
                              }`}
                            >
                              Target
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
                              Actual Cost
                            </th>
                            <th
                              className={`text-center py-1.5 sm:py-2 px-2 sm:px-3 text-[10px] sm:text-xs font-semibold ${
                                isDarkMode ? "text-slate-400" : "text-slate-600"
                              }`}
                            >
                              Target Cost
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
                              Productivity Improvement
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
                          Additional Profit Improvements
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
                          Value Selected
                        </th>
                        <th
                          className={`text-center py-1.5 sm:py-2 px-2 sm:px-3 text-[10px] sm:text-xs font-semibold ${
                            isDarkMode ? "text-slate-400" : "text-slate-600"
                          }`}
                        >
                          Profit Improvement
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
        </div>
      </div>
    </div>
  );
}
