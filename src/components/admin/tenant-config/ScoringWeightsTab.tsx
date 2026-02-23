/**
 * Scoring Weights Tab
 * Manage TopTiering scorecard weights and loan complexity components
 */

import { useState, useMemo, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BarChart3,
  Calculator,
  Save,
  RotateCcw,
  Loader2,
  TrendingUp,
  TrendingDown,
  Minus,
  Info,
  HelpCircle,
  AlertCircle,
  Target,
  Trash2,
  Plus,
} from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Progress } from "@/components/ui/progress";
import { useAdminTenant } from "@/contexts/AdminTenantContext";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";

export interface StaffingUnitTargetsState {
  processor: number;
  underwriter: number;
  closer: number;
  other: number;
}

interface ScoringWeightsTabProps {
  weights: Record<string, any[]>;
  complexityComponents: Record<string, any[]>;
  staffingUnitTargets?: StaffingUnitTargetsState | null;
  onRefresh: () => void;
}

const SCORECARD_METRICS = {
  sales: [
    {
      name: "volume",
      label: "Volume",
      description: "Total loan volume (dollar amount funded)",
    },
    {
      name: "margin",
      label: "Margin (Revenue BPS)",
      description: "Revenue as basis points of loan amount",
    },
    {
      name: "unit",
      label: "Units",
      description: "Number of loans funded",
    },
    {
      name: "pull_through",
      label: "Pull-Through %",
      description: "Percentage of applications that convert to funded loans",
    },
    {
      name: "turn_time",
      label: "Turn Time",
      description: "Days from application to close (lower is better)",
    },
    {
      name: "concession",
      label: "Concession",
      description: "Price concessions given to borrower (lower is better)",
    },
  ],
  operations: [
    {
      name: "units",
      label: "Units",
      description: "Number of loans processed (70% weight)",
    },
    {
      name: "turn_time",
      label: "Turn Time",
      description:
        "Processing efficiency - days to complete (15% weight, lower is better)",
    },
    {
      name: "complexity",
      label: "Loan Complexity",
      description:
        "Difficulty of loans handled (15% weight, higher = harder loans)",
    },
  ],
};

// Complexity component metadata: order, labels, and whether they use range_min/range_max
const COMPLEXITY_COMPONENT_META: Array<{
  component: string;
  label: string;
  isRangeBased: boolean;
}> = [
  { component: "loan_type", label: "Loan Type", isRangeBased: false },
  { component: "loan_purpose", label: "Loan Purpose", isRangeBased: false },
  { component: "loan_amount", label: "Loan Amount", isRangeBased: true },
  { component: "fico", label: "FICO Score", isRangeBased: true },
  { component: "ltv", label: "LTV Ratio", isRangeBased: true },
  { component: "dti", label: "DTI Ratio", isRangeBased: true },
  { component: "occupancy", label: "Occupancy Type", isRangeBased: false },
  { component: "employment", label: "Employment Type", isRangeBased: false },
  { component: "non_qm", label: "Non-QM Loan", isRangeBased: false },
];

const DEFAULT_STAFFING_TARGETS: StaffingUnitTargetsState = {
  processor: 25,
  underwriter: 45,
  closer: 85,
  other: 85,
};

export function ScoringWeightsTab({
  weights,
  complexityComponents,
  staffingUnitTargets,
  onRefresh,
}: ScoringWeightsTabProps) {
  const { toast } = useToast();
  const { isTenantAdmin, selectedTenantId } = useAdminTenant();
  const [activeTab, setActiveTab] = useState("sales");
  const [saving, setSaving] = useState(false);
  const [editedWeights, setEditedWeights] = useState<
    Record<string, Record<string, number>>
  >({});
  const [editedComplexity, setEditedComplexity] = useState<
    Record<string, number>
  >({});
  const [editedRange, setEditedRange] = useState<
    Record<string, { range_min?: number; range_max?: number }>
  >({});
  const [savingComplexity, setSavingComplexity] = useState(false);
  const [addingRange, setAddingRange] = useState<{
    component: string;
    condition_value: string;
    range_min: number;
    range_max: number;
    weight: number;
  } | null>(null);
  const [deletingCondition, setDeletingCondition] = useState<string | null>(null);
  const [unitTargetsDraft, setUnitTargetsDraft] =
    useState<StaffingUnitTargetsState>(DEFAULT_STAFFING_TARGETS);
  const [savingUnitTargets, setSavingUnitTargets] = useState(false);

  useEffect(() => {
    if (staffingUnitTargets) setUnitTargetsDraft(staffingUnitTargets);
  }, [staffingUnitTargets]);

  // Default weights when no database configuration exists
  const DEFAULT_WEIGHTS: Record<string, Record<string, number>> = {
    sales: {
      volume: 0.2,
      margin: 0.2,
      unit: 0.2,
      pull_through: 0.2,
      turn_time: 0.2,
      concession: 0.2,
    },
    operations: {
      units: 0.7,
      turn_time: 0.15,
      complexity: 0.15,
    },
  };

  // Get weight value: edited > database > default
  const getWeightValue = (
    scorecardType: string,
    metricName: string
  ): number => {
    // First check if user has edited this weight
    if (editedWeights[scorecardType]?.[metricName] !== undefined) {
      return editedWeights[scorecardType][metricName];
    }
    // Then check database values
    const weightList = weights[scorecardType] || [];
    const weight = weightList.find((w: any) => w.metric_name === metricName);
    if (weight?.weight !== undefined) {
      return parseFloat(weight.weight);
    }
    // Fall back to defaults
    return DEFAULT_WEIGHTS[scorecardType]?.[metricName] ?? 0;
  };

  const handleWeightChange = (
    scorecardType: string,
    metricName: string,
    value: number
  ) => {
    setEditedWeights((prev) => ({
      ...prev,
      [scorecardType]: {
        ...(prev[scorecardType] || {}),
        [metricName]: value,
      },
    }));
  };

  const getTotalWeight = (scorecardType: string): number => {
    const metrics =
      SCORECARD_METRICS[scorecardType as keyof typeof SCORECARD_METRICS] || [];
    return metrics.reduce(
      (sum, m) => sum + getWeightValue(scorecardType, m.name),
      0
    );
  };

  const handleSaveWeights = async (scorecardType: string) => {
    const metrics =
      SCORECARD_METRICS[scorecardType as keyof typeof SCORECARD_METRICS] || [];
    const weightsToSave = metrics.map((m) => ({
      metric_name: m.name,
      weight: getWeightValue(scorecardType, m.name),
      description: m.description,
    }));

    // Validate at least one weight is non-zero
    const total = weightsToSave.reduce((sum, w) => sum + w.weight, 0);
    if (total <= 0) {
      toast({
        title: "Validation Error",
        description: "At least one weight must be greater than zero",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      const tenantParam = selectedTenantId
        ? `?tenant_id=${selectedTenantId}`
        : "";
      await api.request(
        `/api/tenant-config/scoring-weights/${scorecardType}${tenantParam}`,
        {
          method: "PUT",
          body: JSON.stringify({ weights: weightsToSave }),
        }
      );
      toast({
        title: "Success",
        description: "Scoring weights saved successfully",
      });
      // Clear edited state for this scorecard
      setEditedWeights((prev) => {
        const newState = { ...prev };
        delete newState[scorecardType];
        return newState;
      });
      onRefresh();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to save weights",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleResetWeights = (scorecardType: string) => {
    setEditedWeights((prev) => {
      const newState = { ...prev };
      delete newState[scorecardType];
      return newState;
    });
  };

  const hasChanges = (scorecardType: string): boolean => {
    return (
      !!editedWeights[scorecardType] &&
      Object.keys(editedWeights[scorecardType]).length > 0
    );
  };

  const renderScorecardWeights = (scorecardType: "sales" | "operations") => {
    const metrics = SCORECARD_METRICS[scorecardType];
    const total = getTotalWeight(scorecardType);
    const isValid = total > 0; // Just need at least one weight > 0

    return (
      <div className="space-y-6">
        {/* Weight sum info */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="font-light text-slate-600 dark:text-slate-400">
              Total Weight
            </span>
            <span
              className={`font-medium ${
                isValid ? "text-slate-700 dark:text-slate-300" : "text-red-600"
              }`}
            >
              {(total * 100).toFixed(0)}%
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Weights are relative — the score formula normalizes by the sum.
          </p>
          {!isValid && (
            <p className="text-xs text-red-600">
              At least one weight must be greater than zero.
            </p>
          )}
        </div>

        {/* Weight Sliders */}
        <div className="space-y-6">
          {metrics.map((metric) => {
            const value = getWeightValue(scorecardType, metric.name);
            return (
              <div key={metric.name} className="space-y-3">
                <div className="flex justify-between items-center">
                  <div>
                    <Label className="font-medium">{metric.label}</Label>
                    <p className="text-xs text-slate-500">
                      {metric.description}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      value={(value * 100).toFixed(0)}
                      onChange={(e) =>
                        handleWeightChange(
                          scorecardType,
                          metric.name,
                          parseFloat(e.target.value) / 100 || 0
                        )
                      }
                      className="w-20 text-right"
                      min={0}
                      max={100}
                    />
                    <span className="text-sm text-slate-500">%</span>
                  </div>
                </div>
                <Slider
                  value={[value * 100]}
                  onValueChange={([v]) =>
                    handleWeightChange(scorecardType, metric.name, v / 100)
                  }
                  max={100}
                  step={5}
                  className="w-full"
                />
              </div>
            );
          })}
        </div>

        {/* Action Buttons */}
        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button
            variant="outline"
            onClick={() => handleResetWeights(scorecardType)}
            disabled={!hasChanges(scorecardType)}
            className="font-light"
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Reset
          </Button>
          <Button
            onClick={() => handleSaveWeights(scorecardType)}
            disabled={saving || !isValid}
            className="font-light"
          >
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            <Save className="h-4 w-4 mr-2" />
            Save Weights
          </Button>
        </div>
      </div>
    );
  };

  // Get complexity weight in points (edited or from DB; DB stores decimal)
  const getComplexityWeight = (
    component: string,
    condition: string
  ): number => {
    const key = `${component}_${condition}`;
    if (editedComplexity[key] !== undefined) {
      return editedComplexity[key];
    }
    const componentData = complexityComponents[component] || [];
    const found = componentData.find(
      (c: any) => c.condition_value === condition
    );
    if (found && found.weight != null) {
      return Number(found.weight) * 100;
    }
    return 0;
  };

  const getRangeMin = (component: string, condition: string): number | null => {
    const key = `${component}_${condition}`;
    if (editedRange[key]?.range_min !== undefined) return editedRange[key].range_min!;
    const componentData = complexityComponents[component] || [];
    const found = componentData.find((c: any) => c.condition_value === condition);
    return found?.range_min != null ? Number(found.range_min) : null;
  };

  const getRangeMax = (component: string, condition: string): number | null => {
    const key = `${component}_${condition}`;
    if (editedRange[key]?.range_max !== undefined) return editedRange[key].range_max!;
    const componentData = complexityComponents[component] || [];
    const found = componentData.find((c: any) => c.condition_value === condition);
    return found?.range_max != null ? Number(found.range_max) : null;
  };

  const handleComplexityWeightChange = (
    component: string,
    condition: string,
    value: number
  ) => {
    const key = `${component}_${condition}`;
    setEditedComplexity((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleRangeChange = (
    component: string,
    condition: string,
    field: "range_min" | "range_max",
    value: number | null
  ) => {
    const key = `${component}_${condition}`;
    setEditedRange((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] || {}),
        [field]: value ?? undefined,
      },
    }));
  };

  const hasComplexityChanges = (): boolean => {
    return (
      Object.keys(editedComplexity).length > 0 ||
      Object.keys(editedRange).length > 0 ||
      addingRange != null
    );
  };

  const handleResetComplexity = () => {
    setEditedComplexity({});
    setEditedRange({});
    setAddingRange(null);
  };

  const handleAddRange = (component: string) => {
    setAddingRange({
      component,
      condition_value: "",
      range_min: 0,
      range_max: 100,
      weight: 0,
    });
  };

  const handleCreateRange = async () => {
    if (!addingRange) return;
    const tenantParam = selectedTenantId ? `?tenant_id=${selectedTenantId}` : "";
    setSavingComplexity(true);
    try {
      await api.request(
        `/api/tenant-config/complexity/${addingRange.component}/condition${tenantParam}`,
        {
          method: "POST",
          body: JSON.stringify({
            condition_value: addingRange.condition_value,
            weight: addingRange.weight / 100,
            range_min: addingRange.range_min,
            range_max: addingRange.range_max,
          }),
        }
      );
      toast({ title: "Success", description: "Range added." });
      setAddingRange(null);
      onRefresh();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to add range",
        variant: "destructive",
      });
    } finally {
      setSavingComplexity(false);
    }
  };

  const handleDeleteCondition = async (component: string, conditionValue: string) => {
    const tenantParam = selectedTenantId ? `?tenant_id=${selectedTenantId}` : "";
    setDeletingCondition(`${component}_${conditionValue}`);
    try {
      await api.request(
        `/api/tenant-config/complexity/${component}/${encodeURIComponent(conditionValue)}${tenantParam}`,
        { method: "DELETE" }
      );
      toast({ title: "Success", description: "Condition removed." });
      onRefresh();
    } catch (error: any) {
      toast({
        title: "Error",
        description: (error as Error).message || "Failed to delete",
        variant: "destructive",
      });
    } finally {
      setDeletingCondition(null);
    }
  };

  const handleSaveComplexity = async () => {
    setSavingComplexity(true);
    try {
      const tenantParam = selectedTenantId ? `?tenant_id=${selectedTenantId}` : "";

      for (const meta of COMPLEXITY_COMPONENT_META) {
        const rows = complexityComponents[meta.component] || [];
        if (rows.length === 0) continue;

        const values: Array<{
          condition_value: string;
          weight: number;
          range_min?: number | null;
          range_max?: number | null;
        }> = rows.map((row: any) => {
          const w = getComplexityWeight(meta.component, row.condition_value);
          const out: (typeof values)[0] = {
            condition_value: row.condition_value,
            weight: w / 100,
          };
          if (meta.isRangeBased) {
            out.range_min = getRangeMin(meta.component, row.condition_value);
            out.range_max = getRangeMax(meta.component, row.condition_value);
          }
          return out;
        });

        await api.request(
          `/api/tenant-config/complexity/${meta.component}${tenantParam}`,
          {
            method: "PUT",
            body: JSON.stringify({ values }),
          }
        );
      }

      toast({
        title: "Success",
        description: "Loan complexity weights saved successfully",
      });
      setEditedComplexity({});
      setEditedRange({});
      onRefresh();
    } catch (error: any) {
      toast({
        title: "Error",
        description: (error as Error).message || "Failed to save complexity weights",
        variant: "destructive",
      });
    } finally {
      setSavingComplexity(false);
    }
  };

  // Example complexity score (first condition per component summed)
  const exampleComplexityScore = useMemo(() => {
    let sum = 100;
    for (const meta of COMPLEXITY_COMPONENT_META) {
      const rows = complexityComponents[meta.component] || [];
      const first = rows[0];
      if (first) sum += getComplexityWeight(meta.component, first.condition_value);
    }
    return sum;
  }, [editedComplexity, complexityComponents]);

  const renderComplexityComponents = () => {
    return (
      <div className="space-y-6">
        {/* Explanation Card */}
        <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
          <div className="flex gap-3">
            <Info className="h-5 w-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
            <div className="space-y-2">
              <h4 className="font-medium text-blue-900 dark:text-blue-100">
                What is Loan Complexity Score?
              </h4>
              <p className="text-sm text-blue-800 dark:text-blue-200">
                The Loan Complexity Score measures how difficult a loan is to
                process. It starts at a<strong> baseline of 100</strong> and
                adds/subtracts points based on loan characteristics.
              </p>
              <p className="text-sm text-blue-800 dark:text-blue-200">
                <strong>How it affects Operations TTS:</strong> Operations staff
                who handle more complex loans get credit for the extra
                difficulty. The complexity score is weighted at{" "}
                <strong>15%</strong> of their Operations TTS (Top Tier Score).
              </p>
              <p className="text-sm text-blue-700 dark:text-blue-300 italic">
                Example: An underwriter processing government loans with low
                FICO borrowers will have a higher complexity rating, which
                boosts their TTS compared to someone processing only simple
                conventional loans.
              </p>
            </div>
          </div>
        </div>

        {/* Score Interpretation */}
        <div className="p-4 bg-slate-50 dark:bg-slate-800/30 rounded-lg">
          <h4 className="font-medium mb-3 flex items-center gap-2">
            Score Interpretation
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <HelpCircle className="h-4 w-4 text-slate-400" />
                </TooltipTrigger>
                <TooltipContent>
                  <p className="max-w-xs">
                    Scores are relative to the baseline of 100. Higher = more
                    complex.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </h4>
          <div className="grid grid-cols-4 gap-4 text-sm">
            <div className="text-center p-3 bg-green-100 dark:bg-green-900/30 rounded-lg">
              <div className="text-2xl font-light text-green-600">90-99</div>
              <div className="text-slate-600 dark:text-slate-400 text-xs">
                Simple
              </div>
            </div>
            <div className="text-center p-3 bg-slate-100 dark:bg-slate-700/50 rounded-lg">
              <div className="text-2xl font-light text-slate-600">100</div>
              <div className="text-slate-600 dark:text-slate-400 text-xs">
                Baseline
              </div>
            </div>
            <div className="text-center p-3 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
              <div className="text-2xl font-light text-amber-600">101-115</div>
              <div className="text-slate-600 dark:text-slate-400 text-xs">
                Moderate
              </div>
            </div>
            <div className="text-center p-3 bg-red-100 dark:bg-red-900/30 rounded-lg">
              <div className="text-2xl font-light text-red-600">116+</div>
              <div className="text-slate-600 dark:text-slate-400 text-xs">
                Complex
              </div>
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-3 text-center">
            Example score (sum of first condition per factor):{" "}
            <strong>{exampleComplexityScore}</strong> points
          </p>
        </div>

        {/* Editable Complexity Weights */}
        <div className="space-y-4">
          <h4 className="font-medium text-slate-900 dark:text-white">
            Complexity Factors
          </h4>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Adjust the point values for each loan characteristic. Positive
            values increase complexity, negative values decrease it. For range-based
            factors you can edit boundaries and add or remove ranges.
          </p>

          {COMPLEXITY_COMPONENT_META.map((meta) => {
            const rows = complexityComponents[meta.component] || [];
            return (
              <div
                key={meta.component}
                className="border rounded-lg p-4 space-y-3"
              >
                <h5 className="font-medium text-slate-800 dark:text-slate-200">
                  {meta.label}
                </h5>
                <div className="grid gap-3">
                  {rows.map((row: any) => {
                    const conditionValue = row.condition_value;
                    const weight = getComplexityWeight(meta.component, conditionValue);
                    const key = `${meta.component}_${conditionValue}`;
                    const isModified = editedComplexity[key] !== undefined;
                    const isDeleting =
                      deletingCondition === key;

                    return (
                      <div
                        key={conditionValue}
                        className="flex flex-wrap items-center gap-4"
                      >
                        <div className="flex-1 min-w-0 flex flex-wrap items-center gap-3">
                          {meta.isRangeBased && (
                            <>
                              <div className="flex items-center gap-1">
                                <Label className="text-xs whitespace-nowrap">Min</Label>
                                <Input
                                  type="number"
                                  className="w-24 h-8 text-sm"
                                  value={
                                    getRangeMin(meta.component, conditionValue) ??
                                    ""
                                  }
                                  onChange={(e) =>
                                    handleRangeChange(
                                      meta.component,
                                      conditionValue,
                                      "range_min",
                                      e.target.value === ""
                                        ? null
                                        : parseFloat(e.target.value)
                                    )
                                  }
                                />
                              </div>
                              <div className="flex items-center gap-1">
                                <Label className="text-xs whitespace-nowrap">Max</Label>
                                <Input
                                  type="number"
                                  className="w-24 h-8 text-sm"
                                  value={
                                    getRangeMax(meta.component, conditionValue) ??
                                    ""
                                  }
                                  onChange={(e) =>
                                    handleRangeChange(
                                      meta.component,
                                      conditionValue,
                                      "range_max",
                                      e.target.value === ""
                                        ? null
                                        : parseFloat(e.target.value)
                                    )
                                  }
                                />
                              </div>
                            </>
                          )}
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                              {row.description || conditionValue}
                            </span>
                            {isModified && (
                              <Badge variant="secondary" className="text-xs">
                                Modified
                              </Badge>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Slider
                            value={[weight]}
                            onValueChange={([v]) =>
                              handleComplexityWeightChange(
                                meta.component,
                                conditionValue,
                                v
                              )
                            }
                            min={-20}
                            max={20}
                            step={5}
                            className="w-32"
                          />
                          <div className="w-16 text-right">
                            <span
                              className={`font-mono text-sm ${
                                weight > 0
                                  ? "text-red-600"
                                  : weight < 0
                                    ? "text-green-600"
                                    : "text-slate-500"
                              }`}
                            >
                              {weight > 0 ? "+" : ""}
                              {weight}
                            </span>
                          </div>
                          {weight > 0 ? (
                            <TrendingUp className="h-4 w-4 text-red-500" />
                          ) : weight < 0 ? (
                            <TrendingDown className="h-4 w-4 text-green-500" />
                          ) : (
                            <Minus className="h-4 w-4 text-slate-400" />
                          )}
                          {meta.isRangeBased && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-slate-500 hover:text-red-600"
                              disabled={isDeleting}
                              onClick={() =>
                                handleDeleteCondition(meta.component, conditionValue)
                              }
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {meta.isRangeBased && (
                    addingRange?.component === meta.component ? (
                      <div className="flex flex-wrap items-center gap-2 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border">
                        <Input
                          placeholder="Label (e.g. 500K-1M)"
                          className="w-32"
                          value={addingRange.condition_value}
                          onChange={(e) =>
                            setAddingRange((p) =>
                              p ? { ...p, condition_value: e.target.value } : null
                            )
                          }
                        />
                        <Input
                          type="number"
                          placeholder="Min"
                          className="w-20"
                          value={addingRange.range_min || ""}
                          onChange={(e) =>
                            setAddingRange((p) =>
                              p
                                ? {
                                    ...p,
                                    range_min: e.target.value === "" ? 0 : parseFloat(e.target.value),
                                  }
                                : null
                            )
                          }
                        />
                        <Input
                          type="number"
                          placeholder="Max"
                          className="w-20"
                          value={addingRange.range_max || ""}
                          onChange={(e) =>
                            setAddingRange((p) =>
                              p
                                ? {
                                    ...p,
                                    range_max: e.target.value === "" ? 0 : parseFloat(e.target.value),
                                  }
                                : null
                            )
                          }
                        />
                        <Input
                          type="number"
                          placeholder="Points"
                          className="w-16"
                          value={addingRange.weight || ""}
                          onChange={(e) =>
                            setAddingRange((p) =>
                              p
                                ? {
                                    ...p,
                                    weight: e.target.value === "" ? 0 : parseFloat(e.target.value),
                                  }
                                : null
                            )
                          }
                        />
                        <Button
                          size="sm"
                          onClick={handleCreateRange}
                          disabled={
                            !addingRange.condition_value || savingComplexity
                          }
                        >
                          Add
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setAddingRange(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1"
                        onClick={() => handleAddRange(meta.component)}
                      >
                        <Plus className="h-4 w-4" />
                        Add range
                      </Button>
                    )
                  )}
                </div>
                {rows.length === 0 && !meta.isRangeBased && (
                  <p className="text-xs text-slate-500">
                    No conditions configured. Seed data is set in tenant migration.
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {/* Action Buttons */}
        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button
            variant="outline"
            onClick={handleResetComplexity}
            disabled={!hasComplexityChanges()}
            className="font-light"
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Reset
          </Button>
          <Button
            onClick={handleSaveComplexity}
            disabled={savingComplexity || !hasComplexityChanges()}
            className="font-light"
          >
            {savingComplexity && (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            )}
            <Save className="h-4 w-4 mr-2" />
            Save Complexity Weights
          </Button>
        </div>
      </div>
    );
  };

  const handleSaveUnitTargets = async () => {
    setSavingUnitTargets(true);
    try {
      const tenantParam =
        !isTenantAdmin && selectedTenantId
          ? `?tenant_id=${selectedTenantId}`
          : "";
      await api.request(
        `/api/tenant-config/staffing-unit-targets${tenantParam}`,
        {
          method: "PUT",
          body: JSON.stringify(unitTargetsDraft),
        }
      );
      toast({ title: "Saved", description: "Unit targets updated." });
      onRefresh();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to save unit targets",
        variant: "destructive",
      });
    } finally {
      setSavingUnitTargets(false);
    }
  };

  const renderUnitTargetsTab = () => {
    const roles: (keyof StaffingUnitTargetsState)[] = [
      "processor",
      "underwriter",
      "closer",
      "other",
    ];
    const labels: Record<keyof StaffingUnitTargetsState, string> = {
      processor: "Processor",
      underwriter: "Underwriter",
      closer: "Closer",
      other: "Other",
    };
    return (
      <div className="space-y-6">
        <p className="text-sm text-slate-600 dark:text-slate-400 font-light">
          Set monthly unit targets per role. Used by Financial Modeling and
          Operations Scorecard.
        </p>
        <div className="grid gap-4 max-w-md">
          {roles.map((role) => (
            <div key={role} className="flex items-center gap-4">
              <Label className="w-28 font-light">{labels[role]}</Label>
              <Input
                type="number"
                min={1}
                value={unitTargetsDraft[role]}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v) && v > 0)
                    setUnitTargetsDraft((prev) => ({ ...prev, [role]: v }));
                }}
                className="max-w-24"
              />
              <span className="text-sm text-slate-500">units/month</span>
            </div>
          ))}
        </div>
        <div className="flex justify-end pt-4 border-t">
          <Button
            onClick={handleSaveUnitTargets}
            disabled={savingUnitTargets}
            className="font-light"
          >
            {savingUnitTargets && (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            )}
            <Save className="h-4 w-4 mr-2" />
            Save
          </Button>
        </div>
      </div>
    );
  };

  return (
    <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
      <CardHeader>
        <CardTitle className="text-lg font-thin text-slate-900 dark:text-white flex items-center gap-2">
          <BarChart3 className="h-5 w-5" />
          Scoring Weights
        </CardTitle>
        <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
          Configure TopTiering scorecard weights and loan complexity
          calculations
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-4 mb-6">
            <TabsTrigger value="sales" className="font-light">
              <TrendingUp className="h-4 w-4 mr-2" />
              Sales Scorecard
            </TabsTrigger>
            <TabsTrigger value="operations" className="font-light">
              <Calculator className="h-4 w-4 mr-2" />
              Operations Scorecard
            </TabsTrigger>
            <TabsTrigger value="complexity" className="font-light">
              <BarChart3 className="h-4 w-4 mr-2" />
              Loan Complexity
            </TabsTrigger>
            <TabsTrigger value="unit-targets" className="font-light">
              <Target className="h-4 w-4 mr-2" />
              Unit Targets
            </TabsTrigger>
          </TabsList>

          <TabsContent value="sales">
            {renderScorecardWeights("sales")}
          </TabsContent>

          <TabsContent value="operations">
            {renderScorecardWeights("operations")}
          </TabsContent>

          <TabsContent value="complexity">
            {renderComplexityComponents()}
          </TabsContent>

          <TabsContent value="unit-targets">
            {renderUnitTargetsTab()}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
