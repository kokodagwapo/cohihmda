/**
 * Onboarding Panel
 *
 * Full-featured onboarding UI with three sections:
 *  - Top: Analysis summary cards (field matches, quality flags, revenue fields)
 *  - Middle: Field swap recommendations table with accept/reject
 *  - Bottom: Interactive chat with the onboarding agent
 */

import { useState, useRef, useEffect, useMemo } from "react";
import {
  useOnboardingAnalysis,
  type FieldSwapRecommendation,
  type SuggestedAdditionalField,
  type ChatMessage,
  type AnalysisPhase,
} from "@/hooks/useOnboardingAnalysis";
import { renderMarkdownText } from "@/utils/renderMarkdown";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import {
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Info,
  Send,
  Loader2,
  ArrowRight,
  RotateCcw,
  Zap,
  Database,
  DollarSign,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  Check,
  X,
  Bot,
  User,
  Wrench,
  MessageSquare,
  Plus,
} from "lucide-react";

// ============================================================================
// Props
// ============================================================================

interface OnboardingPanelProps {
  connectionId: string;
  tenantId: string;
  connectionName?: string;
  onComplete?: () => void;
}

// ============================================================================
// Phase Progress
// ============================================================================

const PHASE_ORDER: AnalysisPhase[] = [
  "discovery",
  "sampling",
  "analyzing",
  "matching",
  "quality_check",
  "complete",
];

const PHASE_LABELS: Record<AnalysisPhase, string> = {
  idle: "Ready",
  discovery: "Discovering Fields",
  sampling: "Sampling Loans",
  analyzing: "Building Context",
  matching: "AI Matching",
  quality_check: "Quality Check",
  complete: "Complete",
  error: "Error",
};

function getPhaseProgress(phase: AnalysisPhase): number {
  const idx = PHASE_ORDER.indexOf(phase);
  if (idx === -1) return 0;
  return Math.round(((idx + 1) / PHASE_ORDER.length) * 100);
}

// ============================================================================
// Sub-Components
// ============================================================================

function ConfidenceBadge({ confidence }: { confidence: number }) {
  if (confidence >= 85)
    return (
      <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-0 text-xs">
        High ({confidence}%)
      </Badge>
    );
  if (confidence >= 60)
    return (
      <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border-0 text-xs">
        Medium ({confidence}%)
      </Badge>
    );
  return (
    <Badge className="bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 border-0 text-xs">
      Low ({confidence}%)
    </Badge>
  );
}

function inferFieldDataType(fieldId: string, description: string): string {
  const lower = (fieldId + " " + description).toLowerCase();
  if (/date|milestone|started|due/.test(lower)) return "date";
  if (/amount|price|cost|fee|credit|margin/.test(lower)) return "currency";
  if (/rate|percent|ratio|ltv|cltv|dti/.test(lower)) return "percentage";
  if (/locked|flag|indicator|boolean|is_/.test(lower)) return "boolean";
  if (/count|number|score|months|years|days/.test(lower)) return "number";
  return "string";
}

function SeverityIcon({ severity }: { severity: string }) {
  switch (severity) {
    case "critical":
      return <AlertCircle className="h-4 w-4 text-red-500" />;
    case "warning":
      return <AlertTriangle className="h-4 w-4 text-amber-500" />;
    default:
      return <Info className="h-4 w-4 text-blue-500" />;
  }
}

// ============================================================================
// Main Component
// ============================================================================

export function OnboardingPanel({
  connectionId,
  tenantId,
  connectionName,
  onComplete,
}: OnboardingPanelProps) {
  const { toast } = useToast();

  const {
    analysis,
    analysisPhase,
    analysisMessage,
    isAnalyzing,
    startAnalysis,
    chatMessages,
    isChatLoading,
    sendMessage,
    phase,
    error,
    appliedActions,
    reset,
  } = useOnboardingAnalysis(connectionId, tenantId);

  // Field swap selection state
  const [selectedSwaps, setSelectedSwaps] = useState<Set<string>>(new Set());
  const [showSwapTable, setShowSwapTable] = useState(true);
  const [showRevenueFields, setShowRevenueFields] = useState(false);
  const [showAdditionalFields, setShowAdditionalFields] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auto-select high-confidence swaps when analysis completes
  useEffect(() => {
    if (analysis?.fieldSwapRecommendations) {
      const highConf = new Set<string>();
      for (const rec of analysis.fieldSwapRecommendations) {
        if (rec.confidence >= 85) highConf.add(rec.coheusAlias);
      }
      setSelectedSwaps(highConf);
    }
  }, [analysis]);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  // Computed stats
  const stats = useMemo(() => {
    if (!analysis) return null;
    const highConf = analysis.fieldSwapRecommendations.filter(
      (r) => r.confidence >= 85
    ).length;
    const medConf = analysis.fieldSwapRecommendations.filter(
      (r) => r.confidence >= 60 && r.confidence < 85
    ).length;
    const lowConf = analysis.fieldSwapRecommendations.filter(
      (r) => r.confidence < 60
    ).length;
    const criticalFlags = analysis.dataQualityFlags.filter(
      (f) => f.severity === "critical"
    ).length;
    return {
      total: analysis.fieldSwapRecommendations.length,
      highConf,
      medConf,
      lowConf,
      revenue: analysis.revenueFieldCandidates.length,
      additional: analysis.suggestedAdditionalFields.length,
      qualityFlags: analysis.dataQualityFlags.length,
      criticalFlags,
    };
  }, [analysis]);

  // ── Handlers ──

  const handleSelectAll = () => {
    if (!analysis) return;
    setSelectedSwaps(
      new Set(analysis.fieldSwapRecommendations.map((r) => r.coheusAlias))
    );
  };

  const handleSelectHighConfidence = () => {
    if (!analysis) return;
    setSelectedSwaps(
      new Set(
        analysis.fieldSwapRecommendations
          .filter((r) => r.confidence >= 85)
          .map((r) => r.coheusAlias)
      )
    );
  };

  const handleSelectNone = () => setSelectedSwaps(new Set());

  const handleToggleSwap = (alias: string) => {
    setSelectedSwaps((prev) => {
      const next = new Set(prev);
      if (next.has(alias)) next.delete(alias);
      else next.add(alias);
      return next;
    });
  };

  const handleApplySelected = () => {
    if (selectedSwaps.size === 0) return;
    const swapList = analysis!.fieldSwapRecommendations
      .filter((r) => selectedSwaps.has(r.coheusAlias))
      .map((r) => `${r.coheusAlias} -> ${r.recommendedFieldId}`)
      .join(", ");

    sendMessage(
      `Please apply these ${selectedSwaps.size} field swaps: ${swapList}`
    );
    toast({
      title: "Applying field swaps",
      description: `Sending ${selectedSwaps.size} swap(s) to the agent...`,
    });
  };

  const handleSendChat = () => {
    if (!chatInput.trim()) return;
    sendMessage(chatInput);
    setChatInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendChat();
    }
  };

  const chatInputRef = useRef<HTMLInputElement>(null);

  const handleDiscussField = (rec: FieldSwapRecommendation) => {
    const msg = `I want to discuss the "${rec.coheusAlias}" mapping. You're recommending ${rec.recommendedFieldId} but I'm not sure that's right. Can you check what data is actually in that field vs the current mapping?`;
    setChatInput(msg);
    chatInputRef.current?.focus();
  };

  const handleAddAdditionalField = async (field: SuggestedAdditionalField) => {
    const dataType = inferFieldDataType(field.fieldId, field.description);
    const tenantParam = tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : "";

    try {
      await api.request<{ field: any; message?: string }>(
        `/api/tenant-config/additional-fields${tenantParam}`,
        {
          method: "POST",
          body: JSON.stringify({
            losConnectionId: connectionId,
            losFieldId: field.fieldId,
            displayName: field.description,
            dataType,
            description: field.reason || null,
            includeInRag: true,
          }),
        }
      );
      toast({
        title: "Field added",
        description: `${field.description} (${field.fieldId}) added as ${dataType}. Run a sync to populate.`,
      });
    } catch (err: any) {
      const msg = err?.message || "Failed to add field";
      if (msg.includes("already defined") || msg.includes("already exists")) {
        toast({ title: "Already exists", description: `${field.fieldId} is already defined.`, variant: "destructive" });
      } else {
        toast({ title: "Error", description: msg, variant: "destructive" });
      }
    }
  };

  // ── Render: Idle State ──
  if (phase === "idle") {
    return (
      <Card className="border-slate-200 dark:border-slate-700">
        <CardContent className="py-12 text-center">
          <Sparkles className="h-12 w-12 text-indigo-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-slate-900 dark:text-white mb-2">
            AI-Powered Onboarding Analysis
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-6 max-w-md mx-auto font-light">
            Analyze your Encompass schema with AI to automatically detect field
            mappings, revenue formulas, and data quality issues.
          </p>
          <div className="flex items-center gap-3 justify-center">
            <Button onClick={() => startAnalysis()} size="lg">
              <Zap className="h-4 w-4 mr-2" />
              Run Onboarding Analysis
            </Button>
            <Button
              onClick={() => startAnalysis("fullLoan")}
              size="lg"
              variant="outline"
              title="Experimental: fetch full loans via GET /v1/loans/{id} instead of batched Pipeline calls"
            >
              <Zap className="h-4 w-4 mr-2" />
              Full-Loan Mode
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Render: Analyzing State ──
  if (phase === "analyzing") {
    return (
      <Card className="border-slate-200 dark:border-slate-700">
        <CardContent className="py-12">
          <div className="max-w-lg mx-auto">
            <div className="flex items-center gap-3 mb-6">
              <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />
              <h3 className="text-lg font-medium text-slate-900 dark:text-white">
                {PHASE_LABELS[analysisPhase]}
              </h3>
            </div>
            <Progress
              value={getPhaseProgress(analysisPhase)}
              className="mb-4"
            />
            <p className="text-sm text-slate-500 dark:text-slate-400 font-light">
              {analysisMessage}
            </p>
            {error && (
              <div className="mt-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm">
                {error}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Render: Error State ──
  if (phase === "error" && !analysis) {
    return (
      <Card className="border-red-200 dark:border-red-800">
        <CardContent className="py-12 text-center">
          <AlertCircle className="h-12 w-12 text-red-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-red-700 dark:text-red-300 mb-2">
            Analysis Failed
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4 font-light">
            {error || "An unexpected error occurred."}
          </p>
          <div className="flex gap-3 justify-center">
            <Button variant="outline" onClick={reset}>
              <RotateCcw className="h-4 w-4 mr-2" />
              Reset
            </Button>
            <Button onClick={startAnalysis}>
              <Zap className="h-4 w-4 mr-2" />
              Try Again
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Render: Chat Phase (analysis complete) ──
  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      {analysis && stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card className="border-slate-200 dark:border-slate-700">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Database className="h-4 w-4 text-indigo-500" />
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  Field Matches
                </span>
              </div>
              <div className="text-2xl font-semibold text-slate-900 dark:text-white">
                {stats.total}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 font-light mt-1">
                <span className="text-emerald-600">{stats.highConf} high</span>
                {" / "}
                <span className="text-amber-600">{stats.medConf} med</span>
                {" / "}
                <span className="text-red-600">{stats.lowConf} low</span>
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200 dark:border-slate-700">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <DollarSign className="h-4 w-4 text-green-500" />
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  Revenue Fields
                </span>
              </div>
              <div className="text-2xl font-semibold text-slate-900 dark:text-white">
                {stats.revenue}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 font-light mt-1">
                Detected candidates
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200 dark:border-slate-700">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="h-4 w-4 text-purple-500" />
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  Additional Fields
                </span>
              </div>
              <div className="text-2xl font-semibold text-slate-900 dark:text-white">
                {stats.additional}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 font-light mt-1">
                Suggested custom fields
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200 dark:border-slate-700">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <ShieldAlert className="h-4 w-4 text-amber-500" />
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  Quality Flags
                </span>
              </div>
              <div className="text-2xl font-semibold text-slate-900 dark:text-white">
                {stats.qualityFlags}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 font-light mt-1">
                {stats.criticalFlags > 0 ? (
                  <span className="text-red-600">
                    {stats.criticalFlags} critical
                  </span>
                ) : (
                  "No critical issues"
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Analysis Summary */}
      {analysis?.summary && (
        <Card className="border-slate-200 dark:border-slate-700">
          <CardContent className="p-4">
            <p className="text-sm text-slate-700 dark:text-slate-300 font-light">
              {analysis.summary}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Field Swap Recommendations Table */}
      {analysis && analysis.fieldSwapRecommendations.length > 0 && (
        <Card className="border-slate-200 dark:border-slate-700">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle
                className="text-sm font-medium text-slate-900 dark:text-white flex items-center gap-2 cursor-pointer"
                onClick={() => setShowSwapTable(!showSwapTable)}
              >
                <ArrowRight className="h-4 w-4" />
                Field Swap Recommendations ({selectedSwaps.size}/
                {analysis.fieldSwapRecommendations.length} selected)
                {showSwapTable ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </CardTitle>
              {showSwapTable && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs"
                    onClick={handleSelectHighConfidence}
                  >
                    High confidence
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs"
                    onClick={handleSelectAll}
                  >
                    Select all
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs"
                    onClick={handleSelectNone}
                  >
                    Clear
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleApplySelected}
                    disabled={selectedSwaps.size === 0 || isChatLoading}
                  >
                    <Check className="h-3 w-3 mr-1" />
                    Apply {selectedSwaps.size}
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          {showSwapTable && (
            <CardContent className="pt-0">
              <div className="max-h-[400px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white dark:bg-slate-900 z-10">
                    <tr className="text-left text-xs text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-700">
                      <th className="pb-2 pr-2 w-8"></th>
                      <th className="pb-2 pr-4">Coheus Alias</th>
                      <th className="pb-2 pr-4">Recommended Field</th>
                      <th className="pb-2 pr-4">Confidence</th>
                      <th className="pb-2 pr-4">Population</th>
                      <th className="pb-2 pr-4">Reasoning</th>
                      <th className="pb-2 w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.fieldSwapRecommendations.map((rec) => (
                      <tr
                        key={rec.coheusAlias}
                        className="border-b border-slate-50 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                      >
                        <td className="py-2 pr-2">
                          <Checkbox
                            checked={selectedSwaps.has(rec.coheusAlias)}
                            onCheckedChange={() =>
                              handleToggleSwap(rec.coheusAlias)
                            }
                          />
                        </td>
                        <td className="py-2 pr-4 font-medium text-slate-900 dark:text-white">
                          {rec.coheusAlias}
                        </td>
                        <td className="py-2 pr-4">
                          <code className="text-xs bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded">
                            {rec.recommendedFieldId}
                          </code>
                        </td>
                        <td className="py-2 pr-4">
                          <ConfidenceBadge confidence={rec.confidence} />
                        </td>
                        <td className="py-2 pr-4 text-slate-600 dark:text-slate-400">
                          {rec.currentPopulation.toFixed(0)}%
                        </td>
                        <td className="py-2 pr-4">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="text-xs text-slate-500 dark:text-slate-400 truncate block max-w-[200px] cursor-help">
                                  {rec.reasoning}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent
                                side="left"
                                className="max-w-sm text-xs"
                              >
                                <p>{rec.reasoning}</p>
                                {rec.sampleValues.length > 0 && (
                                  <p className="mt-1 text-slate-400">
                                    Samples: {rec.sampleValues.join(", ")}
                                  </p>
                                )}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </td>
                        <td className="py-2">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={() => handleDiscussField(rec)}
                                >
                                  <MessageSquare className="h-3.5 w-3.5 text-slate-400 hover:text-indigo-500" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="left" className="text-xs">
                                Discuss this field with the agent
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* Revenue Field Candidates */}
      {analysis && analysis.revenueFieldCandidates.length > 0 && (
        <Card className="border-slate-200 dark:border-slate-700">
          <CardHeader className="pb-3">
            <CardTitle
              className="text-sm font-medium text-slate-900 dark:text-white flex items-center gap-2 cursor-pointer"
              onClick={() => setShowRevenueFields(!showRevenueFields)}
            >
              <DollarSign className="h-4 w-4" />
              Revenue Field Candidates ({analysis.revenueFieldCandidates.length})
              {showRevenueFields ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </CardTitle>
          </CardHeader>
          {showRevenueFields && (
            <CardContent className="pt-0">
              <div className="max-h-[300px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white dark:bg-slate-900">
                    <tr className="text-left text-xs text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-700">
                      <th className="pb-2 pr-4">Field ID</th>
                      <th className="pb-2 pr-4">Description</th>
                      <th className="pb-2 pr-4">Role</th>
                      <th className="pb-2">Population</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.revenueFieldCandidates.map((rev) => (
                      <tr
                        key={rev.fieldId}
                        className="border-b border-slate-50 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                      >
                        <td className="py-2 pr-4">
                          <code className="text-xs bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded">
                            {rev.fieldId}
                          </code>
                        </td>
                        <td className="py-2 pr-4 text-slate-700 dark:text-slate-300 font-light">
                          {rev.fieldDescription}
                        </td>
                        <td className="py-2 pr-4">
                          <Badge className="bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 border-0 text-xs">
                            {rev.detectedRole}
                          </Badge>
                        </td>
                        <td className="py-2 text-slate-600 dark:text-slate-400">
                          {rev.populationRate.toFixed(0)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* Suggested Additional Fields */}
      {analysis && analysis.suggestedAdditionalFields.length > 0 && (
        <Card className="border-slate-200 dark:border-slate-700">
          <CardHeader className="pb-3">
            <CardTitle
              className="text-sm font-medium text-slate-900 dark:text-white flex items-center gap-2 cursor-pointer"
              onClick={() => setShowAdditionalFields(!showAdditionalFields)}
            >
              <Sparkles className="h-4 w-4" />
              Suggested Additional Fields ({analysis.suggestedAdditionalFields.length})
              {showAdditionalFields ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </CardTitle>
          </CardHeader>
          {showAdditionalFields && (
            <CardContent className="pt-0">
              <p className="text-xs text-slate-400 dark:text-slate-500 mb-2 italic">
                "Not sampled" means the field wasn't included in the discovery extract — it may still be well-populated in your Encompass instance. Click + to add a field to your analytics schema.
              </p>
              <div className="max-h-[300px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white dark:bg-slate-900">
                    <tr className="text-left text-xs text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-700">
                      <th className="pb-2 pr-4">Field ID</th>
                      <th className="pb-2 pr-4">Description</th>
                      <th className="pb-2 pr-4">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger className="underline decoration-dotted cursor-help">
                              Sample %
                            </TooltipTrigger>
                            <TooltipContent className="text-xs max-w-xs">
                              Population rate from the discovery sample extract.
                              0% means the field wasn't in the sample — it may still be populated in Encompass.
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </th>
                      <th className="pb-2 pr-4">Reason</th>
                      <th className="pb-2 w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.suggestedAdditionalFields.map((field) => (
                      <tr
                        key={field.fieldId}
                        className="border-b border-slate-50 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                      >
                        <td className="py-2 pr-4">
                          <code className="text-xs bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded">
                            {field.fieldId}
                          </code>
                        </td>
                        <td className="py-2 pr-4 text-slate-700 dark:text-slate-300 font-light">
                          {field.description}
                        </td>
                        <td className="py-2 pr-4 text-slate-600 dark:text-slate-400">
                          {field.populationRate < 0 ? (
                            <span className="text-slate-400 italic">not sampled</span>
                          ) : field.populationRate === 0 ? (
                            <span className="text-amber-500">0%</span>
                          ) : (
                            `${field.populationRate.toFixed(0)}%`
                          )}
                        </td>
                        <td className="py-2 pr-4">
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            {field.reason}
                          </span>
                        </td>
                        <td className="py-2">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={() => handleAddAdditionalField(field)}
                                  disabled={isChatLoading}
                                >
                                  <Plus className="h-3.5 w-3.5 text-slate-400 hover:text-emerald-500" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="left" className="text-xs">
                                Add this field to your analytics schema
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* Data Quality Flags */}
      {analysis && analysis.dataQualityFlags.length > 0 && (
        <Card className="border-slate-200 dark:border-slate-700">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-slate-900 dark:text-white flex items-center gap-2">
              <ShieldAlert className="h-4 w-4" />
              Data Quality Flags
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-2">
              {analysis.dataQualityFlags.map((flag, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/30"
                >
                  <SeverityIcon severity={flag.severity} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-900 dark:text-white">
                      {flag.field}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 font-light">
                      {flag.issue}
                    </div>
                    <div className="text-xs text-indigo-600 dark:text-indigo-400 mt-0.5">
                      {flag.recommendation}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Chat Interface */}
      <Card className="border-slate-200 dark:border-slate-700">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-slate-900 dark:text-white flex items-center gap-2">
            <Bot className="h-4 w-4" />
            Onboarding Assistant
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {/* Chat Messages */}
          <ScrollArea className="h-[300px] mb-3">
            <div className="space-y-3 pr-3">
              {/* Welcome message */}
              {chatMessages.length === 0 && analysis && (
                <div className="flex gap-2">
                  <div className="shrink-0 h-6 w-6 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center">
                    <Bot className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                  </div>
                  <div className="text-sm text-slate-600 dark:text-slate-400 font-light">
                    Analysis complete! I found {analysis.fieldSwapRecommendations.length} field
                    matches, {analysis.revenueFieldCandidates.length} revenue field candidates,
                    and {analysis.dataQualityFlags.length} quality flags. You can review the
                    recommendations above or ask me questions about your configuration. Try:
                    <ul className="mt-2 space-y-1 text-xs text-indigo-600 dark:text-indigo-400">
                      <li>&bull; "Apply all high-confidence field swaps"</li>
                      <li>&bull; "What should my revenue formula be?"</li>
                      <li>&bull; "Set up scoring weights for sales"</li>
                      <li>&bull; "Tell me about the CTC date issue"</li>
                    </ul>
                  </div>
                </div>
              )}

              {chatMessages.map((msg) => (
                <ChatBubble key={msg.id} message={msg} />
              ))}

              {isChatLoading && (
                <div className="flex gap-2 items-center">
                  <div className="shrink-0 h-6 w-6 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center">
                    <Loader2 className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400 animate-spin" />
                  </div>
                  <span className="text-xs text-slate-400 italic">
                    Thinking...
                  </span>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>
          </ScrollArea>

          {/* Chat Input */}
          <div className="flex gap-2">
            <Input
              ref={chatInputRef}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your configuration..."
              disabled={isChatLoading}
              className="flex-1 text-sm font-light"
            />
            <Button
              size="sm"
              onClick={handleSendChat}
              disabled={!chatInput.trim() || isChatLoading}
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>

          {/* Quick actions */}
          {appliedActions.length > 0 && (
            <div className="mt-3 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <CheckCircle2 className="h-3 w-3 text-emerald-500" />
              {appliedActions.length} action(s) applied
              {onComplete && (
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto text-xs"
                  onClick={onComplete}
                >
                  Done
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Reset Button */}
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={reset} className="text-xs">
          <RotateCcw className="h-3 w-3 mr-1" />
          Start Over
        </Button>
      </div>
    </div>
  );
}

// ============================================================================
// Chat Bubble
// ============================================================================

function ChatBubble({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex gap-2 justify-end">
        <div className="bg-indigo-50 dark:bg-indigo-900/30 rounded-lg px-3 py-2 max-w-[80%]">
          <p className="text-sm text-slate-900 dark:text-white font-light">
            {message.content}
          </p>
        </div>
        <div className="shrink-0 h-6 w-6 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center">
          <User className="h-3.5 w-3.5 text-slate-600 dark:text-slate-400" />
        </div>
      </div>
    );
  }

  if (message.role === "system" && message.actionCard) {
    const card = message.actionCard;
    return (
      <div className="flex gap-2">
        <div className="shrink-0 h-6 w-6 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
          <Wrench className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg px-3 py-2 max-w-[80%]">
          <div className="flex items-center gap-2 mb-1">
            <Badge className="bg-emerald-100 text-emerald-700 border-0 text-xs">
              {card.status}
            </Badge>
            <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
              {card.tool.replace(/_/g, " ")}
            </span>
          </div>
          <p className="text-sm text-slate-700 dark:text-slate-300 font-light">
            {card.description}
          </p>
        </div>
      </div>
    );
  }

  if (message.role === "system" && message.toolResult) {
    return (
      <div className="flex gap-2">
        <div className="shrink-0 h-6 w-6 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center">
          <Database className="h-3.5 w-3.5 text-slate-600 dark:text-slate-400" />
        </div>
        <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg px-3 py-1.5 max-w-[80%]">
          <p className="text-xs text-slate-500 dark:text-slate-400 italic">
            {message.content}
          </p>
        </div>
      </div>
    );
  }

  // Assistant message — render with markdown support
  // Guard: if the LLM leaked raw JSON, extract just the human-readable message
  let displayContent = message.content;
  if (displayContent.trimStart().startsWith("{")) {
    try {
      const parsed = JSON.parse(displayContent);
      if (parsed.message) displayContent = parsed.message;
    } catch {
      // Multiple JSON objects concatenated — extract all "message" fields
      const msgs: string[] = [];
      const re = /"message"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
      let m;
      while ((m = re.exec(displayContent)) !== null) {
        const decoded = m[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
        if (decoded.length > 20) msgs.push(decoded);
      }
      if (msgs.length > 0) displayContent = msgs[msgs.length - 1];
    }
  }

  return (
    <div className="flex gap-2">
      <div className="shrink-0 h-6 w-6 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center">
        <Bot className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
      </div>
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 max-w-[80%] text-sm text-slate-700 dark:text-slate-300 font-light">
        {renderMarkdownText(displayContent)}
      </div>
    </div>
  );
}
