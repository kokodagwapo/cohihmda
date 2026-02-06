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

// Default complexity components with conditions and default weights
// These match the hardcoded values in calcLoanComplexity()
const DEFAULT_COMPLEXITY_CONFIG = [
  {
    component: "loan_type",
    label: "Loan Type",
    conditions: [
      {
        value: "government",
        label: "Government (FHA, VA, USDA)",
        defaultWeight: 10,
        description:
          "Government loans require more documentation and have stricter guidelines",
      },
      {
        value: "conventional",
        label: "Conventional",
        defaultWeight: 0,
        description: "Standard conventional loans",
      },
    ],
  },
  {
    component: "loan_purpose",
    label: "Loan Purpose",
    conditions: [
      {
        value: "purchase",
        label: "Purchase",
        defaultWeight: 5,
        description:
          "Purchase transactions involve more parties and tighter timelines",
      },
      {
        value: "refinance",
        label: "Refinance",
        defaultWeight: 0,
        description: "Standard refinance transactions",
      },
    ],
  },
  {
    component: "fico",
    label: "FICO Score",
    conditions: [
      {
        value: "poor",
        label: "Poor (< 680)",
        defaultWeight: 10,
        description:
          "Lower credit scores require additional documentation and risk assessment",
      },
      {
        value: "fair",
        label: "Fair (680-719)",
        defaultWeight: 0,
        description: "Average credit range",
      },
      {
        value: "good",
        label: "Good (720-759)",
        defaultWeight: 0,
        description: "Good credit range",
      },
      {
        value: "excellent",
        label: "Excellent (760+)",
        defaultWeight: -5,
        description: "Excellent credit can simplify processing",
      },
    ],
  },
  {
    component: "ltv",
    label: "LTV Ratio",
    conditions: [
      {
        value: "high",
        label: "High LTV (> 80%)",
        defaultWeight: 5,
        description: "Higher LTV loans may require PMI and additional review",
      },
      {
        value: "standard",
        label: "Standard (≤ 80%)",
        defaultWeight: 0,
        description: "Standard LTV range",
      },
    ],
  },
  {
    component: "dti",
    label: "DTI Ratio",
    conditions: [
      {
        value: "high",
        label: "High DTI (> 43%)",
        defaultWeight: 5,
        description: "Higher DTI ratios require additional income verification",
      },
      {
        value: "standard",
        label: "Standard (≤ 43%)",
        defaultWeight: 0,
        description: "Standard DTI range",
      },
    ],
  },
  {
    component: "occupancy",
    label: "Occupancy Type",
    conditions: [
      {
        value: "investment",
        label: "Investment Property",
        defaultWeight: 5,
        description: "Investment properties have stricter requirements",
      },
      {
        value: "second_home",
        label: "Second Home",
        defaultWeight: 5,
        description: "Second homes require additional documentation",
      },
      {
        value: "primary",
        label: "Primary Residence",
        defaultWeight: 0,
        description: "Standard primary residence",
      },
    ],
  },
  {
    component: "employment",
    label: "Employment Type",
    conditions: [
      {
        value: "self_employed",
        label: "Self-Employed",
        defaultWeight: 5,
        description:
          "Self-employed borrowers require additional income documentation",
      },
      {
        value: "w2",
        label: "W-2 Employee",
        defaultWeight: 0,
        description: "Standard W-2 employment",
      },
    ],
  },
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
  const [savingComplexity, setSavingComplexity] = useState(false);
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

  // Get complexity weight value (edited or from props or default)
  const getComplexityWeight = (
    component: string,
    condition: string
  ): number => {
    const key = `${component}_${condition}`;
    if (editedComplexity[key] !== undefined) {
      return editedComplexity[key];
    }
    // Check props from database
    const componentData = complexityComponents[component] || [];
    const found = componentData.find(
      (c: any) => c.condition_value === condition
    );
    if (found) {
      return found.weight * 100; // Convert from decimal to points
    }
    // Fall back to default
    const defaultConfig = DEFAULT_COMPLEXITY_CONFIG.find(
      (c) => c.component === component
    );
    const defaultCondition = defaultConfig?.conditions.find(
      (c) => c.value === condition
    );
    return defaultCondition?.defaultWeight ?? 0;
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

  const hasComplexityChanges = (): boolean => {
    return Object.keys(editedComplexity).length > 0;
  };

  const handleResetComplexity = () => {
    setEditedComplexity({});
  };

  const handleSaveComplexity = async () => {
    setSavingComplexity(true);
    try {
      // Group changes by component
      const changesByComponent: Record<
        string,
        Array<{ condition_value: string; weight: number }>
      > = {};

      for (const config of DEFAULT_COMPLEXITY_CONFIG) {
        const values: Array<{ condition_value: string; weight: number }> = [];
        for (const condition of config.conditions) {
          const weight = getComplexityWeight(config.component, condition.value);
          values.push({
            condition_value: condition.value,
            weight: weight / 100, // Convert from points to decimal
          });
        }
        changesByComponent[config.component] = values;
      }

      // Save each component
      const tenantParam = selectedTenantId
        ? `?tenant_id=${selectedTenantId}`
        : "";
      for (const [componentName, values] of Object.entries(
        changesByComponent
      )) {
        await api.request(
          `/api/tenant-config/complexity/${componentName}${tenantParam}`,
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
      onRefresh();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to save complexity weights",
        variant: "destructive",
      });
    } finally {
      setSavingComplexity(false);
    }
  };

  // Calculate example complexity score based on current weights
  const exampleComplexityScore = useMemo(() => {
    // Example: Government loan, Purchase, Poor FICO, High LTV = high complexity
    const govLoan = getComplexityWeight("loan_type", "government");
    const purchase = getComplexityWeight("loan_purpose", "purchase");
    const poorFico = getComplexityWeight("fico", "poor");
    const highLtv = getComplexityWeight("ltv", "high");
    return 100 + govLoan + purchase + poorFico + highLtv;
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
            Example complex loan (Gov + Purchase + Poor FICO + High LTV):{" "}
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
            values increase complexity, negative values decrease it.
          </p>

          {DEFAULT_COMPLEXITY_CONFIG.map((config) => (
            <div
              key={config.component}
              className="border rounded-lg p-4 space-y-3"
            >
              <h5 className="font-medium text-slate-800 dark:text-slate-200">
                {config.label}
              </h5>
              <div className="grid gap-3">
                {config.conditions.map((condition) => {
                  const weight = getComplexityWeight(
                    config.component,
                    condition.value
                  );
                  const isModified =
                    editedComplexity[
                      `${config.component}_${condition.value}`
                    ] !== undefined;

                  return (
                    <div
                      key={condition.value}
                      className="flex items-center gap-4"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                            {condition.label}
                          </span>
                          {isModified && (
                            <Badge variant="secondary" className="text-xs">
                              Modified
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 truncate">
                          {condition.description}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Slider
                          value={[weight]}
                          onValueChange={([v]) =>
                            handleComplexityWeightChange(
                              config.component,
                              condition.value,
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
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
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
