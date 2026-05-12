import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import { useNavigate, Link } from "react-router-dom";
import {
  getDashboardInsightPath,
  getDashboardInsightNavigateState,
} from "@/lib/dashboardInsightRoutes";
import { motion, AnimatePresence } from "framer-motion";
import {
  Zap,
  RefreshCw,
  Sparkles,
  ChevronRight,
  ChevronLeft,
  MessageSquare,
  AlertCircle,
  AlertTriangle,
  Info,
  CheckCircle2,
  TrendingUp,
  ChevronsDownUp,
  ChevronsUpDown,
  RotateCw,
  RotateCcw,
  Plus,
  X,
  ThumbsUp,
  ThumbsDown,
  MessageSquareText,
  Send,
  Tag,
  Bookmark,
  Bot,
  Loader2,
  FlaskConical,
  Telescope,
  ExternalLink,
  Trash2,
  Play,
  Pencil,
  ChevronDown,
} from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { useCohiData, CohiInsight } from "@/hooks/useCohiData";
import { useTenantLosLastSyncedAt } from "@/hooks/useTenantLosLastSyncedAt";
import {
  formatDataLastSyncedLine,
  formatEstimatedNextSyncLine,
  formatEstimatedNextSyncTooltip,
  getEstimatedNextSyncAt,
} from "@/utils/losSyncDisplay";
import { useJobStatus } from "@/hooks/useJobStatus";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { JobProgress } from "@/components/ui/JobProgress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CohiBriefingControl } from "@/components/cohi/CohiBriefingControl";
import { InsightDetailModal } from "./InsightDetailModal";
import { DashboardInsightEvidenceModal, type DashboardInsightEvidenceModalInsight } from "./DashboardInsightEvidenceModal";
import { TrackedInsightsWatchlist } from "./TrackedInsightsWatchlist";
import { FindingDrillDown } from "@/components/research/FindingDrillDown";
import { InsightChat } from "./InsightChat";
import { DataQualityImpactBlock } from "./DataQualityImpactBlock";
import { getInsightDataQuality } from "@/lib/insightDataQuality";
import { ExportMenu } from "@/components/common/ExportMenu";
import type { ExportData } from "@/utils/exportUtils";
import type { Finding } from "@/hooks/useResearchSession";

// ============================================================================
// Go to dashboard page (for escalated dashboard insights)
// ============================================================================

/** Map Cohi insight (from API) to the shape expected by DashboardInsightEvidenceModal */
function CohiInsightToEvidenceModalInsight(
  i: CohiInsight
): DashboardInsightEvidenceModalInsight {
  const typeToSentiment = (
    t: string
  ): "positive" | "warning" | "critical" | "neutral" => {
    if (t === "critical" || t === "error") return "critical";
    if (t === "warning") return "warning";
    if (t === "success") return "positive";
    return "neutral";
  };
  return {
    headline: i.headline ?? i.message ?? "",
    understory: i.understory ?? "",
    understory_bullets: i.understory_bullets,
    sentiment: typeToSentiment(i.type ?? "info"),
    severity_score: i.severity_score ?? 0,
    what_changed: i.what_changed ?? "",
    why: i.why ?? "",
    business_impact: i.business_impact ?? "",
    risk_if_ignored: i.risk_if_ignored ?? "",
    recommended_action: i.recommended_action ?? "",
    owner: i.owner ?? "",
    sourcePageId: i.sourcePageId ?? "",
    sourcePageName: i.sourcePageName ?? "",
    filter_context: i.filter_context ?? {},
    evidence_refs: i.evidence_refs,
    cited_numbers: i.cited_numbers,
    supporting_data: i.supporting_data,
  };
}

function getInsightBullets(i: CohiInsight): string[] {
  if (Array.isArray(i.understory_bullets) && i.understory_bullets.length > 0) {
    return i.understory_bullets;
  }
  const fallback = i.understory || i.reasoning;
  return fallback ? [fallback] : [];
}

function shouldRenderBulletedUnderstory(i: CohiInsight): boolean {
  return getInsightBullets(i).length > 1;
}

function GoToDashboardPageButton({
  sourcePageId,
  sourcePageName,
  filterContext,
}: {
  sourcePageId: string;
  sourcePageName: string;
  filterContext?: Record<string, unknown>;
}) {
  const navigate = useNavigate();
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const path = getDashboardInsightPath(sourcePageId);
    const state = getDashboardInsightNavigateState(sourcePageId, filterContext);
    navigate(path, { state: Object.keys(state).length > 0 ? state : undefined });
  };
  return (
    <button
      type="button"
      onClick={handleClick}
      className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
    >
      Go to {sourcePageName}
      <ChevronRight className="w-3 h-3" />
    </button>
  );
}

// ============================================================================
// Bucket configuration
// ============================================================================

interface BucketConfig {
  id: string;
  label: string;
  icon: React.ElementType;
  gradient: string;
  borderColor: string;
  bgColor: string;
  bgColorDark: string;
  iconColor: string;
  badgeBg: string;
  badgeText: string;
  dotColor: string;
  stripColor: string;
  emptyMessage: string;
}

const BUCKET_ORDER: BucketConfig[] = [
  {
    id: "critical",
    label: "Immediate Action Required",
    icon: AlertCircle,
    gradient: "from-rose-500 to-red-600",
    borderColor: "border-rose-200/70 dark:border-rose-800/50",
    bgColor: "bg-rose-50/60",
    bgColorDark: "dark:bg-rose-950/20",
    iconColor: "text-rose-600 dark:text-rose-400",
    badgeBg: "bg-rose-100 dark:bg-rose-900/40",
    badgeText: "text-rose-700 dark:text-rose-300",
    dotColor: "bg-rose-500",
    stripColor: "border-l-rose-500",
    emptyMessage: "No immediate action items detected",
  },
  {
    id: "attention",
    label: "Monitor Closely",
    icon: AlertTriangle,
    gradient: "from-amber-400 to-orange-500",
    borderColor: "border-amber-200/70 dark:border-amber-800/50",
    bgColor: "bg-amber-50/60",
    bgColorDark: "dark:bg-amber-950/20",
    iconColor: "text-amber-600 dark:text-amber-400",
    badgeBg: "bg-amber-100 dark:bg-amber-900/40",
    badgeText: "text-amber-700 dark:text-amber-300",
    dotColor: "bg-amber-400",
    stripColor: "border-l-amber-400",
    emptyMessage: "Nothing flagged for close monitoring",
  },
  {
    id: "working",
    label: "Strategic Review",
    icon: CheckCircle2,
    gradient: "from-blue-500 to-indigo-600",
    borderColor: "border-blue-200/70 dark:border-blue-800/50",
    bgColor: "bg-blue-50/60",
    bgColorDark: "dark:bg-blue-950/20",
    iconColor: "text-blue-600 dark:text-blue-400",
    badgeBg: "bg-blue-100 dark:bg-blue-900/40",
    badgeText: "text-blue-700 dark:text-blue-300",
    dotColor: "bg-blue-500",
    stripColor: "border-l-blue-500",
    emptyMessage: "No strategic review items flagged",
  },
  {
    id: "context",
    label: "Informational",
    icon: TrendingUp,
    gradient: "from-slate-400 to-slate-500",
    borderColor: "border-slate-200/70 dark:border-slate-700/50",
    bgColor: "bg-slate-50/60",
    bgColorDark: "dark:bg-slate-900/30",
    iconColor: "text-slate-500 dark:text-slate-400",
    badgeBg: "bg-slate-100 dark:bg-slate-800/50",
    badgeText: "text-slate-600 dark:text-slate-400",
    dotColor: "bg-slate-400",
    stripColor: "border-l-slate-300 dark:border-l-slate-600",
    emptyMessage: "No informational insights available",
  },
];

// ============================================================================
// Functional category tabs
// ============================================================================

interface CategoryTab {
  id: string;
  label: string;
  emptyTitle: string;
  emptyBody: string;
}

const CATEGORY_TABS: CategoryTab[] = [
  {
    id: "all",
    label: "All",
    emptyTitle: "No insights available",
    emptyBody: "Insights will appear once live data is available for this tenant.",
  },
  {
    id: "operations",
    label: "Operations",
    emptyTitle: "No Operations insights",
    emptyBody: "Pipeline velocity, cycle time, and operational throughput insights will appear here when generated.",
  },
  {
    id: "sales",
    label: "Sales",
    emptyTitle: "No Sales insights",
    emptyBody: "Loan officer performance, conversion trends, and lost opportunity insights will appear here when generated.",
  },
  {
    id: "finance",
    label: "Finance",
    emptyTitle: "No Finance insights",
    emptyBody: "Margin, lock risk, revenue exposure, and financial health insights will appear here when generated.",
  },
  {
    id: "secondary_marketing",
    label: "Secondary Marketing",
    emptyTitle: "No Secondary Marketing insights",
    emptyBody: "Product strategy, rate lock behavior, and capital markets positioning insights will appear here when generated.",
  },
  {
    id: "compliance",
    label: "Compliance",
    emptyTitle: "No Compliance insights",
    emptyBody: "TRID timing, fair lending signals, and regulatory risk insights will appear here when generated.",
  },
  {
    id: "data_quality",
    label: "Data Quality",
    emptyTitle: "No data-quality flags on insights",
    emptyBody:
      "When the AI detects a concrete data reliability issue tied to an insight, it appears here. Regenerate insights to re-evaluate, or open Data Quality for portfolio-level checks.",
  },
];

// ============================================================================
// Props
// ============================================================================

interface UserMyInsightPrompt {
  id: string;
  title: string;
  prompt_text: string;
  specifiers?: Record<string, unknown> | null;
  schedule: "batch" | "on_demand";
  enabled: boolean;
}

/** Loans table column metadata from GET /api/loans/schema */
interface LoanColumnMeta {
  name: string;
  type: string;
  nullable: boolean;
  displayName: string;
  category: string;
}

interface PromptSpecifierRow {
  id: string;
  column: string;
  values: string[];
  options: string[];
  optionsLoading: boolean;
  optionsError: string | null;
}

function createEmptySpecifierRow(): PromptSpecifierRow {
  return {
    id: `sr-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    column: "",
    values: [],
    options: [],
    optionsLoading: false,
    optionsError: null,
  };
}

function specifiersObjectFromRows(rows: PromptSpecifierRow[]): Record<string, unknown> {
  const out: Record<string, string[]> = {};
  for (const r of rows) {
    const key = r.column.trim();
    if (!key || r.values.length === 0) continue;
    const set = new Set(out[key] ?? []);
    for (const v of r.values) set.add(v);
    out[key] = Array.from(set);
  }
  return out;
}

function rowsFromSpecifiersObject(spec: Record<string, unknown> | null | undefined): PromptSpecifierRow[] {
  if (!spec || typeof spec !== "object") return [];
  const rows: PromptSpecifierRow[] = [];
  for (const [k, v] of Object.entries(spec)) {
    if (v === undefined || v === null) continue;
    const row = createEmptySpecifierRow();
    if (Array.isArray(v)) {
      const vals = v.map((x) => String(x)).filter((s) => s.length > 0);
      if (!vals.length) continue;
      rows.push({ ...row, column: k, values: vals });
    } else if (["string", "number", "boolean"].includes(typeof v)) {
      rows.push({ ...row, column: k, values: [String(v)] });
    } else {
      rows.push({ ...row, column: k, values: [JSON.stringify(v)] });
    }
  }
  return rows;
}

function summarizeSpecifierValues(values: string[]): string {
  if (values.length === 0) return "Choose values…";
  if (values.length === 1) {
    const s = values[0];
    return s.length > 44 ? `${s.slice(0, 42)}…` : s;
  }
  return `${values.length} selected`;
}

interface CohiPromptsCardProps {
  dateFilter: "today" | "mtd" | "ytd" | "custom";
  onDataAvailabilityChange?: (hasData: boolean) => void;
  onOpenCohiPanel?: () => void;
  briefingContext?: {
    dialogues?: Array<{ message: string; type: string; priority: string }>;
    funnelStory?: {
      conversionRates: any;
      falloutData: any;
      lostRevenue: any;
    };
    userName?: string;
  };
  selectedTenantId?: string | null;
  selectedChannel?: string | null;
  /** Report data to canvasDataStore for PowerPoint export. */
  onDataReady?: (payload: unknown) => void;
}

// ============================================================================
// Bucket Lane sub-component — shows one insight at a time, auto-rotates,
// expandable to show all insights in the section
// ============================================================================

// ============================================================================
// Feedback tags
// ============================================================================
const FEEDBACK_TAGS = [
  { id: "inaccurate", label: "Inaccurate" },
  { id: "not_useful", label: "Not Useful" },
  { id: "misleading", label: "Misleading" },
  { id: "duplicate", label: "Duplicate" },
  { id: "great", label: "Great Insight" },
  { id: "actionable", label: "Actionable" },
];

// Canonical source keys -> chip labels.
// Aliases below keep backward-compat with insights already persisted in the DB.
const SOURCE_CHIP_LABELS: Record<string, string> = {
  // --- canonical keys ---
  pipeline: "Pipeline",
  performance: "Performance",
  lock_risk: "Lock Expiration",
  closing_risk: "Closing Risk",
  conversion: "Conversion",
  lost_opportunity: "Lost Opportunity",
  predictions: "Forecast",
  market_news: "Market & News",
  compliance: "Compliance",
  revenue: "Revenue & Margin",
  credit_risk: "Credit Risk",
  operations: "Operations",
  behavior: "For you",
  custom_prompt: "Your prompt",
  // --- legacy / alias keys (kept for already-persisted insights) ---
  pipeline_velocity: "Pipeline",
  officer_performance: "Performance",
  personnel: "Performance",
  conversion_trends: "Conversion",
  lock_expiration: "Lock Expiration",
  trid_risk: "Closing Risk",
  trid: "Closing Risk",
  margin: "Revenue & Margin",
  product_breakdown: "Revenue & Margin",
  tiering: "Performance",
  comparisons: "Performance",
  condition_backlog: "Operations",
  funnel: "Pipeline",
  loan_funnel: "Pipeline",
  historical: "Operations",
  knowledge_base: "Operations",
  agent_coverage: "Operations",
  industry_news: "Market & News",
  leaderboard: "Performance",
  business_overview: "Performance",
  risk_cross_tab: "Credit Risk",
  dashboard_insights: "Dashboard Insight",
  other: "Insight",
};

function getInsightChipLabel(insight: CohiInsight): string {
  const source = (insight.source || "").trim().toLowerCase();
  return SOURCE_CHIP_LABELS[source] ?? "Insight";
}

const FUNCTIONAL_CATEGORY_LABELS: Record<string, string> = {
  operations: "Operations",
  sales: "Sales",
  finance: "Finance",
  secondary_marketing: "Secondary Marketing",
  compliance: "Compliance",
};

/** Primary domain chip: functional_category when set, else source-based chip. */
function getPrimaryCategoryChipLabel(insight: CohiInsight): string {
  const fc = (insight.functional_category || "").trim().toLowerCase();
  if (fc && FUNCTIONAL_CATEGORY_LABELS[fc]) {
    return FUNCTIONAL_CATEGORY_LABELS[fc];
  }
  return getInsightChipLabel(insight);
}

function iconForInsightType(type: string) {
  switch (type) {
    case "success":
      return CheckCircle2;
    case "warning":
      return AlertTriangle;
    case "error":
    case "critical":
      return AlertCircle;
    default:
      return Info;
  }
}

/** Map GET /api/dashboard/insights/my to CohiInsight (source `my` for detail API). */
function mapMyInsightsResponse(data: { insights?: Record<string, unknown>[] }): CohiInsight[] {
  if (!data.insights?.length) return [];
  return data.insights.map((insight: any) => ({
    insightId: insight.id ?? insight.insightId,
    type: (insight.type || "info") as CohiInsight["type"],
    icon: iconForInsightType(insight.type || "info"),
    message: insight.headline || insight.message || "",
    priority: (insight.priority || "standard") as CohiInsight["priority"],
    reasoning: insight.understory || insight.reasoning || "",
    source: "my",
    bucket: insight.bucket,
    headline: insight.headline,
    understory: insight.understory,
    understory_bullets: Array.isArray(insight.understory_bullets) ? insight.understory_bullets : undefined,
    severity_score: insight.severity_score,
    bucketPriority: insight.bucketPriority,
    impact: insight.impact,
    evidence: insight.evidence,
    what_changed: insight.what_changed,
    why: insight.why,
    business_impact: insight.business_impact,
    risk_if_ignored: insight.risk_if_ignored,
    recommended_action: insight.recommended_action,
    owner: insight.owner,
    generation_method: insight.generation_method,
    detail_data: insight.detail_data || null,
    functional_category: insight.functional_category ?? null,
    profile_relevance:
      typeof insight.profile_relevance === "string" && insight.profile_relevance.trim()
        ? insight.profile_relevance.trim()
        : null,
    fromCustomPrompt:
      insight.source === "custom_prompt" || insight.insight_origin === "custom_prompt",
  }));
}

interface BucketLaneProps {
  config: BucketConfig;
  insights: CohiInsight[];
  onInsightClick: (insight: CohiInsight) => void;
  isDrillable: (insight: CohiInsight) => boolean;
  /** When non-null, overrides the local expanded state (driven by parent "Expand All / Collapse All"). */
  globalExpanded?: boolean | null;
  /** Bumped each time the global toggle fires, ensuring the effect re-runs even if the boolean value stays the same. */
  expandToggleKey?: number;
  /** Admin-only: refresh this bucket */
  onRefreshBucket?: () => Promise<void>;
  /** Admin-only: generate more insights for this bucket (appends) */
  onGenerateMore?: () => Promise<void>;
  /** Admin-only: delete a single insight */
  onDeleteInsight?: (insightId: number) => Promise<void>;
  /** Submit feedback (thumbs up/down + optional tags/comment) on an insight — visible to all users */
  onSubmitFeedback?: (insightId: number, rating: -1 | 1, tags?: string[], comment?: string) => Promise<boolean>;
  /** Deep-dive an insight in the workbench (admin only) */
  onInvestigate?: (insightId: number) => void;
  /** Whether this insight is already on the watchlist */
  isTracked?: (insight: CohiInsight) => boolean;
  /** Toggle track/untrack on the watchlist */
  onToggleTrack?: (insight: CohiInsight) => void;
  /** Whether the user is a platform admin */
  isAdmin?: boolean;
}

function BucketLane({
  config,
  insights,
  onInsightClick,
  isDrillable,
  globalExpanded,
  expandToggleKey,
  onRefreshBucket,
  onGenerateMore,
  onDeleteInsight,
  onSubmitFeedback,
  onInvestigate,
  isTracked,
  onToggleTrack,
  isAdmin,
}: BucketLaneProps) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedInsightIdx, setSelectedInsightIdx] = useState<number | null>(
    null
  );
  const [isPaused, setIsPaused] = useState(false);
  const [isBucketRefreshing, setIsBucketRefreshing] = useState(false);
  const [isGeneratingMore, setIsGeneratingMore] = useState(false);

  // Feedback state: tracks ratings per insight in this session
  const [feedbackMap, setFeedbackMap] = useState<Record<number, { rating: -1 | 1; submitted: boolean }>>({});
  // Which insight currently has the feedback popover open
  const [feedbackPopoverInsightId, setFeedbackPopoverInsightId] = useState<number | null>(null);
  const [feedbackTags, setFeedbackTags] = useState<string[]>([]);
  const [feedbackComment, setFeedbackComment] = useState("");
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  // Handle quick thumbs click
  const handleQuickRating = useCallback(async (insightId: number, rating: -1 | 1) => {
    // Set optimistic state
    setFeedbackMap(prev => ({ ...prev, [insightId]: { rating, submitted: false } }));
    // Open popover for optional tags/comment
    setFeedbackPopoverInsightId(insightId);
    setFeedbackTags([]);
    setFeedbackComment("");
  }, []);

  // Submit full feedback (with optional tags + comment)
  const handleSubmitFeedback = useCallback(async (insightId: number) => {
    const entry = feedbackMap[insightId];
    if (!entry || !onSubmitFeedback) return;
    setFeedbackSubmitting(true);
    const success = await onSubmitFeedback(insightId, entry.rating, feedbackTags, feedbackComment);
    if (success) {
      setFeedbackMap(prev => ({ ...prev, [insightId]: { ...prev[insightId], submitted: true } }));
    }
    setFeedbackSubmitting(false);
    setFeedbackPopoverInsightId(null);
    setFeedbackTags([]);
    setFeedbackComment("");
  }, [feedbackMap, feedbackTags, feedbackComment, onSubmitFeedback]);

  // Sync local expanded state when parent toggles "Expand All / Collapse All"
  useEffect(() => {
    if (globalExpanded !== undefined && globalExpanded !== null) {
      setIsExpanded(globalExpanded);
      if (!globalExpanded) setSelectedInsightIdx(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalExpanded, expandToggleKey]);

  // Auto-rotate through insights every 8 seconds (only when collapsed & not paused)
  useEffect(() => {
    if (isExpanded || isPaused || insights.length <= 1) return;
    const timer = setInterval(() => {
      setActiveIdx((prev) => (prev + 1) % insights.length);
    }, 8000);
    return () => clearInterval(timer);
  }, [isExpanded, isPaused, insights.length]);

  // Reset active index when insights change
  useEffect(() => {
    setActiveIdx(0);
    setSelectedInsightIdx(null);
  }, [insights.length]);

  const goNext = () =>
    setActiveIdx((prev) => (prev + 1) % insights.length);
  const goPrev = () =>
    setActiveIdx((prev) => (prev - 1 + insights.length) % insights.length);

  const BucketIcon = config.icon;
  const current = insights[activeIdx];

  // Render a single insight row
  const renderInsightRow = (
    insight: CohiInsight,
    idx: number,
    showUnderstory: boolean
  ) => {
    const canDrill = isDrillable(insight);
    const isSelected = selectedInsightIdx === idx;
    const shouldShowUnderstory = showUnderstory || isSelected;
    const bullets = getInsightBullets(insight);
    const renderAsBulletList = shouldRenderBulletedUnderstory(insight);
    const primaryLabel = getPrimaryCategoryChipLabel(insight);
    const dqMeta = getInsightDataQuality(insight.detail_data);
    const insightFeedback = insight.insightId ? feedbackMap[insight.insightId] : null;
    const isPopoverOpen = feedbackPopoverInsightId === insight.insightId;

    return (
      <div
        key={idx}
        className="group/insight cursor-pointer relative"
        data-testid="insight-card"
        aria-expanded={shouldShowUnderstory}
        onClick={() => {
          if (isSelected && canDrill) {
            onInsightClick(insight);
          } else {
            setSelectedInsightIdx(isSelected ? null : idx);
          }
        }}
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
      >
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-start gap-2.5 flex-wrap">
              <span
                className={`inline-flex items-center rounded-lg px-2.5 py-1 text-[11px] font-semibold leading-none transition-all duration-200 ease-out origin-left transform-gpu group-hover/insight:scale-[1.04] group-hover/insight:px-3 group-hover/insight:shadow-sm ${config.badgeBg} ${config.badgeText}`}
              >
                {primaryLabel}
              </span>
              {dqMeta?.flagged && (
                <span className="inline-flex items-center rounded-lg px-2.5 py-1 text-[11px] font-semibold leading-none bg-amber-100 dark:bg-amber-900/40 text-amber-900 dark:text-amber-200 ring-1 ring-amber-200/80 dark:ring-amber-800/60">
                  Data quality
                </span>
              )}
              {insight.fromCustomPrompt && (
                <span className="inline-flex items-center rounded-lg px-2.5 py-1 text-[11px] font-semibold leading-none bg-indigo-100 dark:bg-indigo-900/40 text-indigo-900 dark:text-indigo-200 ring-1 ring-indigo-200/80 dark:ring-indigo-800/60">
                  Custom Insight
                </span>
              )}
              <p
                className="flex-1 min-w-[220px] text-[13px] sm:text-sm text-slate-900 dark:text-white font-medium leading-snug"
                data-testid="insight-headline"
              >
                {insight.headline || insight.message}
              </p>
            </div>
            {insight.profile_relevance?.trim() && (
              <p
                className="mt-1.5 text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 leading-snug border-l-2 border-blue-300/80 dark:border-blue-600/50 pl-2.5"
                data-testid="insight-profile-relevance"
              >
                <span className="font-semibold text-slate-600 dark:text-slate-300">Why you&apos;re seeing this</span>
                <span className="font-normal"> — {insight.profile_relevance}</span>
              </p>
            )}
            {insight.source === "dashboard_insights" && insight.sourcePageId && insight.sourcePageName && (
              <GoToDashboardPageButton
                sourcePageId={insight.sourcePageId}
                sourcePageName={insight.sourcePageName}
                filterContext={insight.filter_context}
              />
            )}
          </div>
          {/* Feedback + action buttons — wrapped in Popover so the comment form
              portals to document.body and is never clipped by overflow-hidden ancestors */}
          {insight.insightId && (
            <Popover
              open={isPopoverOpen}
              onOpenChange={(open) => {
                if (!open) {
                  setFeedbackPopoverInsightId(null);
                  setFeedbackTags([]);
                  setFeedbackComment("");
                }
              }}
            >
              <PopoverAnchor asChild>
                <div className="flex-shrink-0 flex items-center gap-0.5">
                  {/* Track / pin to watchlist — always visible when tracked, otherwise on hover */}
                  {onToggleTrack && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleTrack(insight);
                      }}
                      className={`p-1 rounded-md transition-all ${
                        isTracked?.(insight)
                          ? "bg-amber-100 dark:bg-amber-900/30 opacity-100"
                          : "opacity-0 group-hover/insight:opacity-100 hover:bg-amber-100 dark:hover:bg-amber-900/30"
                      }`}
                      title={isTracked?.(insight) ? "Remove from watchlist" : "Track this insight"}
                    >
                      <Bookmark
                        className={`w-3 h-3 transition-colors ${
                          isTracked?.(insight)
                            ? "text-amber-500 fill-amber-500 dark:text-amber-400 dark:fill-amber-400"
                            : "text-slate-400 hover:text-amber-600 dark:hover:text-amber-400"
                        }`}
                        strokeWidth={2}
                      />
                    </button>
                  )}
                  {/* Hover-only action buttons */}
                  <div className="flex items-center gap-0.5 opacity-0 group-hover/insight:opacity-100 transition-all">
                    {/* Investigate (deep dive in workbench) — admin only */}
                    {isAdmin && onInvestigate && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onInvestigate(insight.insightId!);
                        }}
                        className="p-1 rounded-md hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-all"
                        title="Deep dive in Workbench"
                      >
                        <Telescope
                          className="w-3 h-3 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400"
                          strokeWidth={2}
                        />
                      </button>
                    )}
                    {/* Thumbs Up — all users */}
                    {onSubmitFeedback && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleQuickRating(insight.insightId!, 1);
                        }}
                        className={`p-1 rounded-md transition-all ${
                          insightFeedback?.rating === 1
                            ? "bg-green-100 dark:bg-green-900/40 opacity-100"
                            : "hover:bg-green-100 dark:hover:bg-green-900/30"
                        }`}
                        title="Good insight"
                      >
                        <ThumbsUp
                          className={`w-3 h-3 ${
                            insightFeedback?.rating === 1
                              ? "text-green-600 dark:text-green-400 fill-current"
                              : "text-slate-400 hover:text-green-600 dark:hover:text-green-400"
                          }`}
                          strokeWidth={2}
                        />
                      </button>
                    )}
                    {/* Thumbs Down */}
                    {onSubmitFeedback && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleQuickRating(insight.insightId!, -1);
                        }}
                        className={`p-1 rounded-md transition-all ${
                          insightFeedback?.rating === -1
                            ? "bg-red-100 dark:bg-red-900/40 opacity-100"
                            : "hover:bg-red-100 dark:hover:bg-red-900/30"
                        }`}
                        title="Bad insight"
                      >
                        <ThumbsDown
                          className={`w-3 h-3 ${
                            insightFeedback?.rating === -1
                              ? "text-red-600 dark:text-red-400 fill-current"
                              : "text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                          }`}
                          strokeWidth={2}
                        />
                      </button>
                    )}
                    {/* Delete button — admin only */}
                    {isAdmin && onDeleteInsight && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteInsight(insight.insightId!);
                        }}
                        className="p-1 rounded-md hover:bg-red-100 dark:hover:bg-red-900/30 transition-all"
                        title="Remove this insight"
                      >
                        <X className="w-3.5 h-3.5 text-red-400 hover:text-red-600 dark:text-red-500 dark:hover:text-red-400" strokeWidth={2} />
                      </button>
                    )}
                  </div>
                </div>
              </PopoverAnchor>

              {/* Feedback form — rendered via Radix portal so it escapes overflow-hidden ancestors */}
              <PopoverContent
                align="end"
                sideOffset={6}
                className="w-72 p-3 space-y-2.5"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                    <Tag className="w-3 h-3" />
                    Optional tags & comment
                  </span>
                  <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                    insightFeedback?.rating === 1
                      ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                      : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                  }`}>
                    {insightFeedback?.rating === 1 ? <ThumbsUp className="w-2.5 h-2.5" /> : <ThumbsDown className="w-2.5 h-2.5" />}
                    {insightFeedback?.rating === 1 ? "Good" : "Bad"}
                  </span>
                </div>
                {/* Tags */}
                <div className="flex flex-wrap gap-1.5">
                  {FEEDBACK_TAGS.map((tag) => {
                    const isActive = feedbackTags.includes(tag.id);
                    return (
                      <button
                        key={tag.id}
                        onClick={() =>
                          setFeedbackTags((prev) =>
                            isActive ? prev.filter((t) => t !== tag.id) : [...prev, tag.id]
                          )
                        }
                        className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors ${
                          isActive
                            ? "bg-blue-100 dark:bg-blue-900/40 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300"
                            : "bg-slate-50 dark:bg-slate-700/50 border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
                        }`}
                      >
                        {tag.label}
                      </button>
                    );
                  })}
                </div>
                {/* Comment */}
                <textarea
                  value={feedbackComment}
                  onChange={(e) => setFeedbackComment(e.target.value)}
                  placeholder="Optional note..."
                  className="w-full text-xs rounded-md border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/50 px-2.5 py-1.5 text-slate-700 dark:text-slate-300 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none"
                  rows={2}
                />
                {/* Submit */}
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => {
                      setFeedbackPopoverInsightId(null);
                      setFeedbackTags([]);
                      setFeedbackComment("");
                    }}
                    className="px-2.5 py-1 text-[11px] font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                  >
                    Skip
                  </button>
                  <button
                    onClick={() => handleSubmitFeedback(insight.insightId!)}
                    disabled={feedbackSubmitting}
                    className="inline-flex items-center gap-1 px-3 py-1 text-[11px] font-medium rounded-md bg-blue-500 hover:bg-blue-600 text-white transition-colors disabled:opacity-50"
                  >
                    <Send className="w-3 h-3" />
                    {feedbackSubmitting ? "Sending..." : "Submit"}
                  </button>
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>

        <AnimatePresence>
          {shouldShowUnderstory && (insight.understory || insight.reasoning || (insight.understory_bullets?.length ?? 0) > 0) && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
            >
              <div
                className="mt-1.5 rounded-md border border-slate-200/80 dark:border-slate-700/70 bg-white/80 dark:bg-slate-900/40 px-2.5 py-2"
                data-testid="insight-understory"
              >
                {renderAsBulletList ? (
                  <ul
                    className="list-disc pl-4 space-y-1 text-xs text-slate-600 dark:text-slate-300 leading-relaxed"
                    data-testid="insight-understory-list"
                  >
                    {bullets.map((bullet, idx) => (
                      <li key={`${insight.insightId || insight.headline || insight.message}-${idx}`}>
                        {bullet}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p
                    className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed"
                    data-testid="insight-understory-paragraph"
                  >
                    {bullets[0]}
                  </p>
                )}
              </div>
              {canDrill && (
                <span className="inline-flex items-center gap-0.5 mt-1.5 text-[11px] text-blue-500 dark:text-blue-400 font-medium">
                  View details
                  <ChevronRight className="w-3 h-3" />
                </span>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  return (
    <div
      className={`rounded-2xl border ${config.borderColor} ${config.bgColor} ${config.bgColorDark} backdrop-blur-sm overflow-hidden`}
    >
      {/* Bucket header */}
      <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
        <div className="flex items-center gap-2.5">
          <div
            className={`w-6 h-6 rounded-md bg-gradient-to-br ${config.gradient} flex items-center justify-center shadow-sm`}
          >
            <BucketIcon className="w-3 h-3 text-white" strokeWidth={2} />
          </div>
          <h4 className="text-[13px] font-semibold text-slate-800 dark:text-slate-200 tracking-tight">
            {config.label}
          </h4>
          {insights.length > 1 && (
            <span
              className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${config.badgeBg} ${config.badgeText}`}
            >
              {insights.length}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* Prev / Next (collapsed mode, multiple insights) */}
          {!isExpanded && insights.length > 1 && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  goPrev();
                }}
                className="p-1 rounded-md hover:bg-white/60 dark:hover:bg-slate-800/60 transition-colors"
                aria-label="Previous insight"
              >
                <ChevronLeft className="w-3.5 h-3.5 text-slate-400" />
              </button>
              <span className="text-[10px] text-slate-400 dark:text-slate-500 tabular-nums min-w-[28px] text-center">
                {activeIdx + 1}/{insights.length}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  goNext();
                }}
                className="p-1 rounded-md hover:bg-white/60 dark:hover:bg-slate-800/60 transition-colors"
                aria-label="Next insight"
              >
                <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
              </button>
            </>
          )}
          {/* Expand / Collapse toggle */}
          {insights.length > 1 && (
            <button
              onClick={() => {
                setIsExpanded((prev) => !prev);
                setSelectedInsightIdx(null);
              }}
              className="ml-1 px-2 py-0.5 rounded-md text-[10px] font-medium text-slate-500 dark:text-slate-400 hover:bg-white/60 dark:hover:bg-slate-800/60 transition-colors"
            >
              {isExpanded ? "Collapse" : "Show all"}
            </button>
          )}
          {/* Admin controls */}
          {isAdmin && (
            <div className="flex items-center gap-0.5 ml-1">
              {/* Generate more (append) */}
              {onGenerateMore && (
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (isGeneratingMore) return;
                    setIsGeneratingMore(true);
                    try {
                      await onGenerateMore();
                    } finally {
                      setIsGeneratingMore(false);
                    }
                  }}
                  disabled={isGeneratingMore || isBucketRefreshing}
                  className="p-1 rounded-md hover:bg-white/60 dark:hover:bg-slate-800/60 transition-colors disabled:opacity-50"
                  title={`Generate additional ${config.label} insights`}
                >
                  <Plus
                    className={`w-3.5 h-3.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 ${
                      isGeneratingMore ? "animate-pulse" : ""
                    }`}
                    strokeWidth={2}
                  />
                </button>
              )}
              {/* Refresh (replace) */}
              {onRefreshBucket && (
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (isBucketRefreshing) return;
                    setIsBucketRefreshing(true);
                    try {
                      await onRefreshBucket();
                    } finally {
                      setIsBucketRefreshing(false);
                    }
                  }}
                  disabled={isBucketRefreshing || isGeneratingMore}
                  className="p-1 rounded-md hover:bg-white/60 dark:hover:bg-slate-800/60 transition-colors disabled:opacity-50"
                  title={`Regenerate ${config.label} insights`}
                >
                  <RotateCw
                    className={`w-3.5 h-3.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 ${
                      isBucketRefreshing ? "animate-spin" : ""
                    }`}
                    strokeWidth={2}
                  />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Content area */}
      <div className="px-4 pb-3.5">
        {!isExpanded ? (
          /* ---- Single insight view with crossfade ---- */
          current && (
            <AnimatePresence mode="wait">
              <motion.div
                key={activeIdx}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.25 }}
              >
                {renderInsightRow(current, activeIdx, false)}
              </motion.div>
            </AnimatePresence>
          )
        ) : (
          /* ---- Expanded: all insights stacked ---- */
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
            className="space-y-3"
          >
            {insights.map((insight, idx) => (
              <div
                key={idx}
                className={`rounded-lg px-3 py-2.5 border-l-4 ${config.stripColor} bg-white/70 dark:bg-slate-800/50 border border-white/60 dark:border-slate-700/40`}
              >
                {renderInsightRow(insight, idx, true)}
              </div>
            ))}
          </motion.div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Main component
// ============================================================================

export const CohiPromptsCard = React.memo(function CohiPromptsCard({
  dateFilter,
  onDataAvailabilityChange,
  onOpenCohiPanel,
  briefingContext,
  selectedTenantId,
  selectedChannel,
  onDataReady,
}: CohiPromptsCardProps) {
  const sectionRef = useRef<HTMLDivElement>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedInsight, setSelectedInsight] =
    useState<CohiInsight | null>(null);
  /** When true, show DashboardInsightEvidenceModal for dashboard_insights (fallback when details API returns 404). */
  const [useDashboardEvidenceModalFallback, setUseDashboardEvidenceModalFallback] = useState(false);
  useEffect(() => {
    if (selectedInsight?.source === "dashboard_insights") setUseDashboardEvidenceModalFallback(false);
  }, [selectedInsight?.source, selectedInsight?.insightId]);
  // Global expand/collapse state: null = uncontrolled (each lane manages itself),
  // true = all expanded, false = all collapsed. Resets to null on individual lane toggle.
  const [globalExpanded, setGlobalExpanded] = useState<boolean | null>(null);
  // Counter to force re-trigger the effect in BucketLane even when toggling the same value
  const [expandToggleKey, setExpandToggleKey] = useState(0);

  // Auth context — admin controls only shown for platform staff
  const { isPlatformStaff, isSuperAdmin } = useAuth();
  const isAdmin = isPlatformStaff();
  const isSuperAdminUser = isSuperAdmin();
  const {
    lastSyncedAt: losLastSyncedAt,
    syncFrequency: losSyncFrequency,
    syncRunAtTimes: losSyncRunAtTimes,
    syncAllowedWeekdays: losSyncAllowedWeekdays,
    schedulerTimezone: losSchedulerTimezone,
  } = useTenantLosLastSyncedAt(selectedTenantId);

  // Data hook
  const {
    allInsights,
    insightsLoading,
    insightsError,
    funnelData,
    metadata,
    needsGeneration,
    refreshInsights,
    refreshMyInsightsAllUsers,
    refreshMyInsightsProfile,
    refreshMyInsightsInsightsOnly,
    refreshBucket,
    generateMoreInsights,
    reloadInsightsFromDb,
    deleteInsight,
    submitFeedback,
    loadInsightsByMethod,
    refreshByCategory,
    dataQualityMetrics,
    dataQualityLoading,
    refreshDataQualitySummary,
  } = useCohiData(
    dateFilter,
    onDataAvailabilityChange,
    selectedTenantId,
    selectedChannel
  );

  const [activeTab, setActiveTab] = useState<"pipeline" | "agent" | "my_insights">("agent");
  const [myInsights, setMyInsights] = useState<CohiInsight[]>([]);
  const [myInsightsLoading, setMyInsightsLoading] = useState(false);
  const [myInsightsNeedsGen, setMyInsightsNeedsGen] = useState(false);
  const [activeCategoryId, setActiveCategoryId] = useState<string>("all");
  const [agentFinding, setAgentFinding] = useState<Finding | null>(null);
  const [agentFindingInsight, setAgentFindingInsight] = useState<CohiInsight | null>(null);

  const [refreshJobId, setRefreshJobId] = useState<string | null>(null);
  const refreshJob = useJobStatus(refreshJobId);

  const [myInsightsAllUsersJobId, setMyInsightsAllUsersJobId] = useState<string | null>(null);
  const myInsightsAllUsersJob = useJobStatus(myInsightsAllUsersJobId);
  const [myInsightsAllUsersError, setMyInsightsAllUsersError] = useState<string | null>(null);

  const [myProfileRefreshJobId, setMyProfileRefreshJobId] = useState<string | null>(null);
  const myProfileRefreshJob = useJobStatus(myProfileRefreshJobId);
  const [myProfileRefreshError, setMyProfileRefreshError] = useState<string | null>(null);

  const [myInsightsOnlyJobId, setMyInsightsOnlyJobId] = useState<string | null>(null);
  const myInsightsOnlyJob = useJobStatus(myInsightsOnlyJobId);
  const [myInsightsOnlyError, setMyInsightsOnlyError] = useState<string | null>(null);

  const [myPrompts, setMyPrompts] = useState<UserMyInsightPrompt[]>([]);
  const [myPromptsLoading, setMyPromptsLoading] = useState(false);
  const [myPromptsError, setMyPromptsError] = useState<string | null>(null);
  const [promptFormTitle, setPromptFormTitle] = useState("");
  const [promptFormText, setPromptFormText] = useState("");
  const [promptFormSchedule, setPromptFormSchedule] = useState<"batch" | "on_demand">("batch");
  const [myPromptModalOpen, setMyPromptModalOpen] = useState(false);
  const [loanSchemaColumns, setLoanSchemaColumns] = useState<LoanColumnMeta[]>([]);
  const [loanSchemaLoading, setLoanSchemaLoading] = useState(false);
  const [promptSpecifierRows, setPromptSpecifierRows] = useState<PromptSpecifierRow[]>([]);
  const [specifierColumnPopoverRowId, setSpecifierColumnPopoverRowId] = useState<string | null>(null);
  const [specifierColumnSearch, setSpecifierColumnSearch] = useState("");
  const [specifierValuesPopoverRowId, setSpecifierValuesPopoverRowId] = useState<string | null>(null);
  const [specifierValuesSearch, setSpecifierValuesSearch] = useState("");
  const [promptFormBusy, setPromptFormBusy] = useState(false);
  const [editingPromptId, setEditingPromptId] = useState<string | null>(null);
  const [myPromptRunJobId, setMyPromptRunJobId] = useState<string | null>(null);
  const myPromptRunJob = useJobStatus(myPromptRunJobId);

  const [agentJobId, setAgentJobId] = useState<string | null>(null);
  const agentJob = useJobStatus(agentJobId);

  const [categoryJobId, setCategoryJobId] = useState<string | null>(null);
  const categoryJob = useJobStatus(categoryJobId);
  const isCategoryRefreshing = categoryJob.status === "processing";
  const [dqTabRefreshing, setDqTabRefreshing] = useState(false);

  // ---- Tracked insights (watchlist) for pipeline insights ----
  // Map<source_insight_id, tracked_uuid> drives both UI and delete logic.
  type TrackedInsightRow = { id: string; source_insight_id?: number | null; status?: string };
  const [trackedPipelineMap, setTrackedPipelineMap] = useState<Map<number, string>>(new Map());
  const [watchlistRefreshTrigger, setWatchlistRefreshTrigger] = useState(0);
  const [trackedReevalLoading, setTrackedReevalLoading] = useState(false);

  const fetchAndBuildPipelineMap = useCallback(async (bustCache = false) => {
    if (bustCache) api.invalidateCacheFor("/insights/tracked");
    const data = ((await api.getTrackedInsights(selectedTenantId)) || []) as TrackedInsightRow[];
    const map = new Map<number, string>();
    for (const row of data) {
      if (
        (row.status === "active" || row.status === "resolved") &&
        row.source_insight_id != null
      ) {
        map.set(row.source_insight_id, row.id);
      }
    }
    return map;
  }, [selectedTenantId]);

  const handleRunTrackedReevaluation = useCallback(async () => {
    setTrackedReevalLoading(true);
    try {
      await api.runTrackedReevaluation(selectedTenantId);
      api.invalidateCacheFor("/insights/tracked");
      setWatchlistRefreshTrigger((t) => t + 1);
      fetchAndBuildPipelineMap(true).then(setTrackedPipelineMap).catch(() => {});
    } catch (err) {
      console.error("Tracked re-evaluation failed:", err);
    } finally {
      setTrackedReevalLoading(false);
    }
  }, [selectedTenantId, fetchAndBuildPipelineMap]);

  useEffect(() => {
    fetchAndBuildPipelineMap().then(setTrackedPipelineMap).catch((err) =>
      console.error("Failed to load tracked insights:", err)
    );
  }, [fetchAndBuildPipelineMap]);

  const isRefreshing = refreshJob.status === "processing";
  const isMyInsightsAllUsersRefreshing = myInsightsAllUsersJob.status === "processing";
  const isMyProfileRefreshing = myProfileRefreshJob.status === "processing";
  const isMyInsightsOnlyRefreshing = myInsightsOnlyJob.status === "processing";
  const isMyPromptRunBusy = myPromptRunJob.status === "processing";
  const isAnyMyInsightsActionBusy =
    isMyInsightsAllUsersRefreshing ||
    isMyProfileRefreshing ||
    isMyInsightsOnlyRefreshing ||
    isMyPromptRunBusy;
  const isAgentGenerating = agentJob.status === "processing";

  const loadMyInsights = useCallback(async () => {
    setMyInsightsLoading(true);
    try {
      const tenantParam = selectedTenantId
        ? `&tenant_id=${encodeURIComponent(selectedTenantId)}`
        : "";
      const data = await api.request<any>(
        `/api/dashboard/insights/my?dateFilter=${dateFilter}${tenantParam}`
      );
      setMyInsights(mapMyInsightsResponse(data));
      setMyInsightsNeedsGen(!!data.needsGeneration);
    } catch (e) {
      console.error("Failed to load My Insights:", e);
      setMyInsights([]);
      setMyInsightsNeedsGen(true);
    } finally {
      setMyInsightsLoading(false);
    }
  }, [dateFilter, selectedTenantId]);

  const loadMyPrompts = useCallback(async () => {
    setMyPromptsLoading(true);
    setMyPromptsError(null);
    try {
      const res = await api.listMyInsightPrompts(selectedTenantId);
      const raw = (res.prompts || []) as Record<string, unknown>[];
      const mapped: UserMyInsightPrompt[] = raw.map((p) => ({
        id: String(p.id),
        title: String(p.title ?? ""),
        prompt_text: String(p.prompt_text ?? ""),
        specifiers:
          p.specifiers && typeof p.specifiers === "object" ? (p.specifiers as Record<string, unknown>) : null,
        schedule: p.schedule === "on_demand" ? "on_demand" : "batch",
        enabled: Boolean(p.enabled),
      }));
      setMyPrompts(mapped);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to load prompts";
      setMyPromptsError(msg);
      setMyPrompts([]);
    } finally {
      setMyPromptsLoading(false);
    }
  }, [selectedTenantId]);

  const loadDistinctForRow = useCallback(
    async (rowId: string, col: string) => {
      if (!col.trim()) {
        setPromptSpecifierRows((prev) =>
          prev.map((r) =>
            r.id === rowId ? { ...r, options: [], optionsLoading: false, optionsError: null } : r
          )
        );
        return;
      }
      setPromptSpecifierRows((prev) =>
        prev.map((r) => (r.id === rowId ? { ...r, optionsLoading: true, optionsError: null } : r))
      );
      try {
        const tenantParam = selectedTenantId
          ? `?tenant_id=${encodeURIComponent(selectedTenantId)}`
          : "";
        const data = await api.request<{ values: string[] }>(
          `/api/loans/distinct-values/${encodeURIComponent(col)}${tenantParam}`
        );
        const vals = (data.values || []).map((v) => String(v));
        setPromptSpecifierRows((prev) =>
          prev.map((r) =>
            r.id === rowId
              ? {
                  ...r,
                  options: vals,
                  optionsLoading: false,
                  optionsError: null,
                  values: r.values.filter((x) => vals.includes(x)),
                }
              : r
          )
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Could not load values";
        setPromptSpecifierRows((prev) =>
          prev.map((r) =>
            r.id === rowId ? { ...r, options: [], optionsLoading: false, optionsError: msg } : r
          )
        );
      }
    },
    [selectedTenantId]
  );

  useEffect(() => {
    if (!myPromptModalOpen) return;
    let cancelled = false;
    setLoanSchemaLoading(true);
    void (async () => {
      try {
        const tenantParam = selectedTenantId
          ? `?tenant_id=${encodeURIComponent(selectedTenantId)}`
          : "";
        const data = await api.request<{ columns: LoanColumnMeta[] }>(`/api/loans/schema${tenantParam}`);
        if (!cancelled) setLoanSchemaColumns(data.columns || []);
      } catch {
        if (!cancelled) setLoanSchemaColumns([]);
      } finally {
        if (!cancelled) setLoanSchemaLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [myPromptModalOpen, selectedTenantId]);

  useEffect(() => {
    if (refreshJob.status === "complete") {
      reloadInsightsFromDb().catch(() => {});
      void loadMyInsights();
      setRefreshJobId(null);
    }
  }, [refreshJob.status, reloadInsightsFromDb, loadMyInsights]);

  useEffect(() => {
    if (myInsightsAllUsersJob.status === "complete") {
      setMyInsightsAllUsersError(null);
      void loadMyInsights();
      setMyInsightsAllUsersJobId(null);
    } else if (myInsightsAllUsersJob.status === "failed") {
      setMyInsightsAllUsersError(
        myInsightsAllUsersJob.error || "Bulk My Insights refresh failed"
      );
      void loadMyInsights();
      setMyInsightsAllUsersJobId(null);
    }
  }, [myInsightsAllUsersJob.status, myInsightsAllUsersJob.error, loadMyInsights]);

  useEffect(() => {
    if (myProfileRefreshJob.status === "complete") {
      setMyProfileRefreshError(null);
      void loadMyInsights();
      setMyProfileRefreshJobId(null);
    } else if (myProfileRefreshJob.status === "failed") {
      setMyProfileRefreshError(
        myProfileRefreshJob.error || "Interest profile refresh failed"
      );
      void loadMyInsights();
      setMyProfileRefreshJobId(null);
    }
  }, [myProfileRefreshJob.status, myProfileRefreshJob.error, loadMyInsights]);

  useEffect(() => {
    if (myInsightsOnlyJob.status === "complete") {
      setMyInsightsOnlyError(null);
      void loadMyInsights();
      setMyInsightsOnlyJobId(null);
    } else if (myInsightsOnlyJob.status === "failed") {
      setMyInsightsOnlyError(myInsightsOnlyJob.error || "My Insights refresh failed");
      void loadMyInsights();
      setMyInsightsOnlyJobId(null);
    }
  }, [myInsightsOnlyJob.status, myInsightsOnlyJob.error, loadMyInsights]);

  useEffect(() => {
    if (myPromptRunJob.status === "complete") {
      setMyPromptsError(null);
      void loadMyPrompts();
      void loadMyInsights();
      setMyPromptRunJobId(null);
    } else if (myPromptRunJob.status === "failed") {
      setMyPromptsError(myPromptRunJob.error || "Prompt run failed");
      setMyPromptRunJobId(null);
    }
  }, [myPromptRunJob.status, myPromptRunJob.error, loadMyPrompts, loadMyInsights]);

  useEffect(() => {
    if (agentJob.status === "complete") {
      loadInsightsByMethod("agent").catch(() => {});
      setAgentJobId(null);
    }
  }, [agentJob.status, loadInsightsByMethod]);

  useEffect(() => {
    if (categoryJob.status === "complete") {
      loadInsightsByMethod("agent").catch(() => {});
      setCategoryJobId(null);
    }
  }, [categoryJob.status, loadInsightsByMethod]);

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;
    const jobId = await refreshInsights();
    if (jobId) setRefreshJobId(jobId);
  }, [refreshInsights, isRefreshing]);

  const handleRefreshMyInsightsAllUsers = useCallback(async () => {
    if (!isSuperAdminUser || isAnyMyInsightsActionBusy) return;
    setMyInsightsAllUsersError(null);
    setMyProfileRefreshError(null);
    setMyInsightsOnlyError(null);
    const jobId = await refreshMyInsightsAllUsers();
    if (jobId) setMyInsightsAllUsersJobId(jobId);
  }, [isSuperAdminUser, refreshMyInsightsAllUsers, isAnyMyInsightsActionBusy]);

  const handleRefreshMyUserProfile = useCallback(async () => {
    if (isAnyMyInsightsActionBusy) return;
    setMyProfileRefreshError(null);
    setMyInsightsAllUsersError(null);
    setMyInsightsOnlyError(null);
    const jobId = await refreshMyInsightsProfile();
    if (jobId) setMyProfileRefreshJobId(jobId);
  }, [refreshMyInsightsProfile, isAnyMyInsightsActionBusy]);

  const handleRefreshMyInsightsOnly = useCallback(async () => {
    if (isAnyMyInsightsActionBusy) return;
    setMyInsightsOnlyError(null);
    setMyInsightsAllUsersError(null);
    setMyProfileRefreshError(null);
    const jobId = await refreshMyInsightsInsightsOnly();
    if (jobId) setMyInsightsOnlyJobId(jobId);
  }, [refreshMyInsightsInsightsOnly, isAnyMyInsightsActionBusy]);

  const resetMyPromptForm = useCallback(() => {
    setEditingPromptId(null);
    setPromptFormTitle("");
    setPromptFormText("");
    setPromptFormSchedule("batch");
    setPromptSpecifierRows([]);
    setSpecifierColumnPopoverRowId(null);
    setSpecifierColumnSearch("");
    setSpecifierValuesPopoverRowId(null);
    setSpecifierValuesSearch("");
  }, []);

  const addSpecifierRow = useCallback(() => {
    setPromptSpecifierRows((prev) => [...prev, createEmptySpecifierRow()]);
  }, []);

  const removeSpecifierRow = useCallback((rowId: string) => {
    setSpecifierColumnPopoverRowId((id) => (id === rowId ? null : id));
    setSpecifierValuesPopoverRowId((id) => (id === rowId ? null : id));
    setPromptSpecifierRows((prev) => prev.filter((r) => r.id !== rowId));
  }, []);

  const setSpecifierRowColumn = useCallback(
    (rowId: string, col: string) => {
      setPromptSpecifierRows((prev) =>
        prev.map((r) => (r.id === rowId ? { ...r, column: col, values: [] } : r))
      );
      void loadDistinctForRow(rowId, col);
    },
    [loadDistinctForRow]
  );

  const setSpecifierRowValues = useCallback((rowId: string, values: string[]) => {
    setPromptSpecifierRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, values } : r)));
  }, []);

  const handleSubmitMyPrompt = useCallback(async () => {
    const title = promptFormTitle.trim();
    const prompt_text = promptFormText.trim();
    if (!title || !prompt_text) {
      setMyPromptsError("Title and prompt text are required.");
      return;
    }
    const specifiers = specifiersObjectFromRows(promptSpecifierRows) as Record<string, unknown>;
    setPromptFormBusy(true);
    setMyPromptsError(null);
    try {
      if (editingPromptId) {
        await api.updateMyInsightPrompt(
          editingPromptId,
          { title, prompt_text, specifiers, schedule: promptFormSchedule },
          selectedTenantId
        );
      } else {
        await api.createMyInsightPrompt(
          { title, prompt_text, specifiers, schedule: promptFormSchedule, enabled: true },
          selectedTenantId
        );
      }
      resetMyPromptForm();
      setMyPromptModalOpen(false);
      await loadMyPrompts();
    } catch (e: unknown) {
      setMyPromptsError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setPromptFormBusy(false);
    }
  }, [
    promptFormTitle,
    promptFormText,
    promptSpecifierRows,
    editingPromptId,
    promptFormSchedule,
    selectedTenantId,
    resetMyPromptForm,
    loadMyPrompts,
  ]);

  const handleEditMyPrompt = useCallback(
    (p: UserMyInsightPrompt) => {
      const rows = rowsFromSpecifiersObject(
        p.specifiers && typeof p.specifiers === "object" ? p.specifiers : null
      );
      setEditingPromptId(p.id);
      setPromptFormTitle(p.title);
      setPromptFormText(p.prompt_text);
      setPromptFormSchedule(p.schedule);
      setPromptSpecifierRows(rows);
      setMyPromptsError(null);
      setMyPromptModalOpen(true);
      for (const r of rows) {
        if (r.column) void loadDistinctForRow(r.id, r.column);
      }
    },
    [loadDistinctForRow]
  );

  const handleTogglePromptEnabled = useCallback(
    async (p: UserMyInsightPrompt) => {
      try {
        await api.updateMyInsightPrompt(p.id, { enabled: !p.enabled }, selectedTenantId);
        await loadMyPrompts();
      } catch (e: unknown) {
        setMyPromptsError(e instanceof Error ? e.message : "Update failed");
      }
    },
    [selectedTenantId, loadMyPrompts]
  );

  const handleDeleteMyPrompt = useCallback(
    async (id: string) => {
      if (!window.confirm("Delete this saved prompt?")) return;
      const wasEditing = editingPromptId === id;
      try {
        await api.deleteMyInsightPrompt(id, selectedTenantId);
        if (wasEditing) {
          resetMyPromptForm();
          setMyPromptModalOpen(false);
        }
        await loadMyPrompts();
      } catch (e: unknown) {
        setMyPromptsError(e instanceof Error ? e.message : "Delete failed");
      }
    },
    [selectedTenantId, loadMyPrompts, editingPromptId, resetMyPromptForm]
  );

  const handleRunMyPrompt = useCallback(
    async (id: string) => {
      if (isAnyMyInsightsActionBusy) return;
      setMyPromptsError(null);
      try {
        const resp = await api.runMyInsightPrompt(id, selectedTenantId);
        if (resp.jobId) setMyPromptRunJobId(resp.jobId);
      } catch (e: unknown) {
        setMyPromptsError(e instanceof Error ? e.message : "Run failed");
      }
    },
    [selectedTenantId, isAnyMyInsightsActionBusy]
  );

  const handleTabSwitch = useCallback(
    async (tab: "pipeline" | "agent" | "my_insights") => {
      setActiveTab(tab);
      if (tab === "pipeline" || tab === "agent") {
        await loadInsightsByMethod(tab);
      } else if (tab === "my_insights") {
        await loadMyInsights();
        await loadMyPrompts();
      }
    },
    [loadInsightsByMethod, loadMyInsights, loadMyPrompts]
  );

  const handleCategoryRefresh = useCallback(
    async (categoryId: string) => {
      if (categoryId === "all") return;
      if (categoryId === "data_quality") {
        if (dqTabRefreshing) return;
        setDqTabRefreshing(true);
        try {
          await refreshDataQualitySummary();
        } catch (err: unknown) {
          console.error("Data quality metrics refresh failed:", err);
        } finally {
          setDqTabRefreshing(false);
        }
        return;
      }
      if (isCategoryRefreshing) return;
      try {
        const jobId = await refreshByCategory(categoryId);
        if (jobId) setCategoryJobId(jobId);
      } catch (err: unknown) {
        console.error("Category refresh failed:", err);
      }
    },
    [isCategoryRefreshing, refreshByCategory, refreshDataQualitySummary, dqTabRefreshing]
  );

  const handleAgentGenerate = useCallback(async (forceFresh = false) => {
    if (isAgentGenerating) return;
    try {
      const resp: any = await api.triggerAgentInsights(selectedTenantId, forceFresh ? { forceFresh: true } : undefined);
      if (resp?.jobId) {
        setAgentJobId(resp.jobId);
      } else {
        await loadInsightsByMethod("agent");
      }
    } catch (err: any) {
      if (err.message?.includes("409") || err.message?.includes("already in progress")) {
        console.warn("Agent generation already in progress");
      } else {
        console.error("Agent generation failed:", err);
      }
      try { await loadInsightsByMethod("agent"); } catch {}
    }
  }, [loadInsightsByMethod, selectedTenantId, isAgentGenerating]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ tenantId?: string | null }>)
        .detail;
      if (!detail?.tenantId || detail.tenantId === selectedTenantId) {
        refreshInsights();
      }
    };
    window.addEventListener("cohi-demo-seeded", handler as EventListener);
    return () =>
      window.removeEventListener("cohi-demo-seeded", handler as EventListener);
  }, [refreshInsights, selectedTenantId]);

  // Drill-down logic — all insights are drillable now (evidence tables are self-describing)
  const handleInsightClick = useCallback(
    (insight: CohiInsight) => {
      if (insight.generation_method === "agent" && insight.detail_data?.type === "agent_finding") {
        const dd = insight.detail_data;
        const finding: Finding = {
          questionId: 0,
          title: dd.title || insight.headline || "",
          summary: dd.summary || insight.understory || "",
          summary_bullets:
            Array.isArray(insight.understory_bullets) && insight.understory_bullets.length > 0
              ? insight.understory_bullets
              : dd.summary
                ? [dd.summary]
                : (insight.understory ? [insight.understory] : []),
          confidence: dd.confidence || "medium",
          keyMetrics: dd.keyMetrics || {},
          keyMetricDescriptions: dd.keyMetricDescriptions || {},
          keyMetricFormats: dd.keyMetricFormats || {},
          evidence: (dd.evidence || []).map((e: any) => ({
            sql: e.sql || "",
            explanation: e.explanation || "",
            rows: e.rows || [],
            rowCount: e.rowCount || 0,
            fields: e.fields || [],
            columnFormats: e.columnFormats || undefined,
          })),
        };
        setAgentFinding(finding);
        setAgentFindingInsight(insight);
        return;
      }
      if (insight.source) {
        setSelectedInsight(insight);
        setIsModalOpen(true);
      }
    },
    []
  );

  const navigate = useNavigate();

  const [isCreatingResearch, setIsCreatingResearch] = useState(false);

  const handleMoveAgentFindingToResearch = useCallback(async () => {
    if (!agentFinding || isCreatingResearch) return;
    setIsCreatingResearch(true);
    try {
      const tenantParam = selectedTenantId
        ? `?tenant_id=${encodeURIComponent(selectedTenantId)}`
        : "";
      const result = await api.request<{ sessionId: string }>(
        `/api/research/sessions${tenantParam}`,
        {
          method: "POST",
          body: JSON.stringify({
            initialContext: {
              headline: agentFinding.title,
              understory: agentFinding.summary,
              keyMetrics: agentFinding.keyMetrics,
              evidenceSummary: agentFinding.evidence
                ?.map((e: any) => e.explanation)
                .filter(Boolean)
                .join("; "),
            },
          }),
        }
      );
      setAgentFinding(null);
      setAgentFindingInsight(null);
      navigate(`/research?session=${result.sessionId}`);
    } catch (err) {
      console.error("Error creating research session from finding:", err);
    } finally {
      setIsCreatingResearch(false);
    }
  }, [agentFinding, isCreatingResearch, selectedTenantId, navigate]);

  const handleToggleTrack = useCallback(
    async (insight: CohiInsight) => {
      if (insight.insightId == null) return;
      const sourceId = insight.insightId;
      const currentlyTracked = trackedPipelineMap.has(sourceId);

      // Optimistic toggle
      setTrackedPipelineMap((prev) => {
        const next = new Map(prev);
        if (currentlyTracked) next.delete(sourceId); else next.set(sourceId, "pending");
        return next;
      });

      try {
        if (currentlyTracked) {
          let trackedId = trackedPipelineMap.get(sourceId);
          if (!trackedId || trackedId === "pending") {
            const freshMap = await fetchAndBuildPipelineMap(true);
            trackedId = freshMap.get(sourceId);
          }
          if (trackedId && trackedId !== "pending") {
            await api.deleteTrackedInsight(trackedId, selectedTenantId);
          }
        } else {
          const isDashboardInsight =
            (insight.source || "").trim().toLowerCase() === "dashboard_insights";

          // Plan §8 / Stage 4: dashboard rows — server derives metric_signature from dashboard_generated_insights; do not post empty sql.
          if (isDashboardInsight) {
            await api.trackInsight(
              {
                headline: insight.headline || insight.message,
                understory: insight.understory || insight.reasoning,
                source_insight_id: sourceId,
                source_type: "dashboard_insights",
              },
              selectedTenantId
            );
          } else {
            // Agent / pipeline: send signature hints; server normalizes for agent/pipeline.
            const isAgentInsight =
              insight.generation_method === "agent" &&
              insight.detail_data?.type === "agent_finding";

            let metric_signature: { sql: string; keyFields: string[] };
            let source_type: string;
            let display_metadata: Record<string, any> | undefined;

            if (isAgentInsight && insight.detail_data?.metricSignature?.sql) {
              metric_signature = insight.detail_data.metricSignature;
              source_type = "agent";
              if (insight.detail_data.keyMetricDescriptions || insight.detail_data.keyMetricFormats) {
                display_metadata = {
                  keyMetricDescriptions: insight.detail_data.keyMetricDescriptions || {},
                  keyMetricFormats: insight.detail_data.keyMetricFormats || {},
                };
              }
            } else {
              const eq = (insight.evidence as any)?.evidenceQueries?.[0];
              metric_signature = eq?.sql
                ? { sql: eq.sql, keyFields: (insight.evidence as any)?.metrics?.map((m: any) => m.label) || [] }
                : { sql: "", keyFields: [] };
              source_type = "pipeline";
            }

            await api.trackInsight(
              {
                headline: insight.headline || insight.message,
                understory: insight.understory || insight.reasoning,
                metric_signature,
                source_insight_id: sourceId,
                source_type,
                display_metadata,
              },
              selectedTenantId
            );
          }
        }
        const freshMap = await fetchAndBuildPipelineMap(true);
        setTrackedPipelineMap(freshMap);
        setWatchlistRefreshTrigger((t) => t + 1);
      } catch (err) {
        console.error("Error toggling tracked insight:", err);
        // Revert on failure
        setTrackedPipelineMap((prev) => {
          const reverted = new Map(prev);
          if (currentlyTracked) reverted.set(sourceId, "reverted"); else reverted.delete(sourceId);
          return reverted;
        });
      }
    },
    [selectedTenantId, trackedPipelineMap, fetchAndBuildPipelineMap]
  );

  const handleInvestigate = useCallback(
    async (insightId: number) => {
      try {
        const tenantParam = selectedTenantId
          ? `?tenant_id=${encodeURIComponent(selectedTenantId)}`
          : "";
        const result = await api.request<{ id: string }>(
          `/api/workbench/canvases/from-insight${tenantParam}`,
          {
            method: "POST",
            body: JSON.stringify({ insightId }),
          }
        );
        navigate(`/my-dashboard?canvas=${result.id}`);
      } catch (err) {
        console.error("Error creating deep-dive canvas:", err);
      }
    },
    [selectedTenantId, navigate]
  );

  const isDrillable = useCallback(
    (insight: CohiInsight) => {
      return !!insight.source;
    },
    []
  );

  useEffect(() => {
    if (!onDataReady || insightsLoading || allInsights.length === 0) return;
    const lines = allInsights.slice(0, 20).map((i) => {
      const bucket = (i.bucket ?? 'info').toUpperCase();
      const headline = i.headline || i.message || '';
      return `[${bucket}] ${headline}`;
    });
    onDataReady({ content: lines.join('\n'), title: 'Cohi Insights', insightCount: allInsights.length });
  }, [onDataReady, insightsLoading, allInsights]);

  // Parse and cache DQ metadata once per insights payload.
  const insightDqMeta = useMemo(() => {
    const map = new WeakMap<CohiInsight, ReturnType<typeof getInsightDataQuality>>();
    for (const insight of allInsights) {
      map.set(insight, getInsightDataQuality(insight.detail_data));
    }
    return map;
  }, [allInsights]);

  // Filter insights by the active functional category, then group by bucket
  const filteredInsights = useMemo(() => {
    if (activeCategoryId === "all") return allInsights;
    if (activeCategoryId === "data_quality") {
      return allInsights.filter((i) => insightDqMeta.get(i)?.flagged === true);
    }
    return allInsights.filter(
      (i) => (i.functional_category || null) === activeCategoryId
    );
  }, [allInsights, activeCategoryId, insightDqMeta]);

  // Group filtered insights by bucket
  const bucketedInsights = useMemo(() => {
    const map: Record<string, CohiInsight[]> = {
      critical: [],
      attention: [],
      working: [],
      context: [],
    };

    for (const insight of filteredInsights) {
      const bucket = insight.bucket || "context"; // default untagged to context
      if (map[bucket]) {
        map[bucket].push(insight);
      } else {
        map.context.push(insight);
      }
    }
    return map;
  }, [filteredInsights]);

  const bucketedMyInsights = useMemo(() => {
    const map: Record<string, CohiInsight[]> = {
      critical: [],
      attention: [],
      working: [],
      context: [],
    };
    for (const insight of myInsights) {
      const bucket = insight.bucket || "context";
      if (map[bucket]) map[bucket].push(insight);
      else map.context.push(insight);
    }
    return map;
  }, [myInsights]);

  // Per-category counts and critical flags for badge display
  const categoryStats = useMemo(() => {
    const stats: Record<string, { total: number; hasCritical: boolean }> = {};
    const flaggedInsights = allInsights.filter(
      (i) => insightDqMeta.get(i)?.flagged === true
    );
    for (const cat of CATEGORY_TABS) {
      if (cat.id === "all") {
        stats["all"] = {
          total: allInsights.length,
          hasCritical: allInsights.some((i) => i.bucket === "critical"),
        };
        continue;
      }
      if (cat.id === "data_quality") {
        stats["data_quality"] = {
          total: flaggedInsights.length,
          hasCritical:
            (dataQualityMetrics?.critical_issues ?? 0) > 0 ||
            flaggedInsights.some(
              (i) => insightDqMeta.get(i)?.trust_impact === "high"
            ),
        };
        continue;
      }
      const catInsights = allInsights.filter(
        (i) => (i.functional_category || null) === cat.id
      );
      stats[cat.id] = {
        total: catInsights.length,
        hasCritical: catInsights.some((i) => i.bucket === "critical"),
      };
    }
    return stats;
  }, [allInsights, dataQualityMetrics, insightDqMeta]);

  // Count non-empty buckets for the currently visible category
  const nonEmptyBuckets = useMemo(
    () => BUCKET_ORDER.filter((b) => bucketedInsights[b.id]?.length > 0),
    [bucketedInsights]
  );

  const hasInsights = allInsights.length > 0;
  const hasFilteredInsights = filteredInsights.length > 0;
  const hasMyInsights = myInsights.length > 0;
  const activeCategoryDef = CATEGORY_TABS.find((c) => c.id === activeCategoryId);

  const sortedLoanSchemaColumns = useMemo(
    () => [...loanSchemaColumns].sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [loanSchemaColumns]
  );

  return (
    <div className="mb-6 sm:mb-10 Cohi-prompts-card">
      <motion.div
        ref={sectionRef}
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="relative overflow-hidden rounded-2xl sm:rounded-3xl p-4 sm:p-5 md:p-6 lg:p-8 border border-slate-200/60 dark:border-slate-700/60 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl shadow-[0_8px_32px_rgba(15,23,42,0.08)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.24)]"
      >
        {/* ===== Header ===== */}
        <div className="flex items-center justify-between mb-5 sm:mb-6 md:mb-8">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20 dark:shadow-blue-600/15 ring-1 ring-white/20">
              <Zap
                className="w-5 h-5 sm:w-6 sm:h-6 text-white"
                strokeWidth={1.5}
              />
            </div>
            <div>
              <h3 className="text-xl sm:text-2xl md:text-3xl font-semibold text-slate-900 dark:text-white mb-0.5 tracking-tight leading-tight">
                Cohi Insights
              </h3>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 flex items-center gap-2 flex-wrap">
                <span>Executive briefing</span>
                {metadata?.usedLLM && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-100/80 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 text-[10px] sm:text-xs font-medium">
                    <Sparkles className="w-3 h-3" />
                    AI
                  </span>
                )}
                {(() => {
                  const metaMuted = "text-slate-400 dark:text-slate-500";
                  const divider = (key: string) => (
                    <span
                      key={key}
                      aria-hidden
                      className="inline-block h-3.5 w-px shrink-0 bg-slate-300 dark:bg-slate-600 self-center"
                    />
                  );
                  const trailing: React.ReactNode[] = [];
                  if (hasInsights) {
                    trailing.push(
                      <span key="ins-count" className={metaMuted}>
                        {allInsights.length} insights
                      </span>
                    );
                  }
                  if (metadata?.generatedAt) {
                    trailing.push(
                      <span
                        key="gen"
                        className={metaMuted}
                        title={new Date(metadata.generatedAt).toLocaleString()}
                      >
                        Insights Generated{" "}
                        {(() => {
                          const ms =
                            Date.now() -
                            new Date(metadata.generatedAt).getTime();
                          const mins = Math.floor(ms / 60000);
                          if (mins < 1) return "just now";
                          if (mins < 60) return `${mins}m ago`;
                          const hrs = Math.floor(mins / 60);
                          if (hrs < 24) return `${hrs}h ago`;
                          const days = Math.floor(hrs / 24);
                          return `${days}d ago`;
                        })()}
                      </span>
                    );
                  }
                  trailing.push(
                    <span
                      key="los-sync"
                      className={metaMuted}
                      title={
                        losLastSyncedAt
                          ? new Date(losLastSyncedAt).toLocaleString(
                              undefined,
                              {
                                dateStyle: "full",
                                timeStyle: "medium",
                              }
                            )
                          : undefined
                      }
                    >
                      {formatDataLastSyncedLine(losLastSyncedAt)}
                    </span>
                  );
                  const syncInput = {
                    lastSyncedAtUtc: losLastSyncedAt,
                    syncFrequency: losSyncFrequency,
                    syncRunAtTimes: losSyncRunAtTimes,
                    syncAllowedWeekdays: losSyncAllowedWeekdays,
                    schedulerTimezone: losSchedulerTimezone,
                  };
                  const nextSyncAt = getEstimatedNextSyncAt(syncInput);
                  if (nextSyncAt && nextSyncAt.getTime() > Date.now()) {
                    trailing.push(
                      <span
                        key="los-next-sync"
                        className={metaMuted}
                        title={formatEstimatedNextSyncTooltip(syncInput)}
                      >
                        {formatEstimatedNextSyncLine(syncInput)}
                      </span>
                    );
                  }
                  return (
                    <span className="inline-flex items-center flex-wrap gap-x-2 gap-y-1">
                      {trailing.flatMap((node, i) =>
                        i === 0
                          ? [node]
                          : [divider(`meta-div-${i}`), node]
                      )}
                    </span>
                  );
                })()}
              </p>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2">
            {/* Expand All / Collapse All toggle */}
            {hasInsights && nonEmptyBuckets.length > 1 && (
              <button
                onClick={() => {
                  const next = globalExpanded === true ? false : true;
                  setGlobalExpanded(next);
                  setExpandToggleKey((k) => k + 1);
                }}
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors border border-slate-200/60 dark:border-slate-700/50"
                title={globalExpanded === true ? "Collapse all sections" : "Expand all sections"}
              >
                {globalExpanded === true ? (
                  <>
                    <ChevronsDownUp className="w-3.5 h-3.5" strokeWidth={1.5} />
                    Collapse All
                  </>
                ) : (
                  <>
                    <ChevronsUpDown className="w-3.5 h-3.5" strokeWidth={1.5} />
                    Expand All
                  </>
                )}
              </button>
            )}
            <ExportMenu
              title="Cohi Insights"
              targetRef={sectionRef}
              getExportData={(): ExportData => ({
                title: "Cohi Insights",
                tables: [
                  {
                    name: "Insights",
                    headers: [
                      "Bucket",
                      "Headline",
                      "Detail",
                      "Source",
                      "Severity",
                    ],
                    rows: allInsights.map((insight) => [
                      insight.bucket || "--",
                      insight.headline || insight.message || "--",
                      getInsightBullets(insight).join(" | ") || "--",
                      insight.source || "--",
                      insight.severity_score?.toFixed(2) || "--",
                    ]),
                  },
                ],
              })}
            />
            {isAdmin && (
              <button
                onClick={handleRefresh}
                disabled={insightsLoading || isRefreshing}
                className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
                title="Refresh insights (pipeline)"
              >
                <RefreshCw
                  className={`w-4 h-4 text-slate-500 dark:text-slate-400 ${
                    isRefreshing ? "animate-spin" : ""
                  }`}
                  strokeWidth={1.5}
                />
              </button>
            )}
            <button
              onClick={() => onOpenCohiPanel?.()}
              className="p-2 rounded-lg transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400"
              title="Ask Cohi"
            >
              <MessageSquare className="w-4 h-4" strokeWidth={1.5} />
            </button>
            <CohiBriefingControl
              briefingContext={briefingContext}
              tenantId={selectedTenantId}
            />
          </div>
        </div>

        {/* ===== Tab Bar ===== */}
        <div className="flex items-center gap-1 mb-5 border-b border-slate-200/60 dark:border-slate-700/60 -mx-1 px-1">
          {([
            { id: "agent" as const, label: "Insights", icon: Sparkles },
            { id: "my_insights" as const, label: "My Insights", icon: Bookmark },
          ]).map((tab) => (
            <button
              key={tab.id}
              onClick={() => handleTabSwitch(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-all ${
                activeTab === tab.id
                  ? "border-blue-500 text-blue-600 dark:text-blue-400"
                  : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600"
              }`}
            >
              <tab.icon className="w-3.5 h-3.5" strokeWidth={2} />
              {tab.label}
            </button>
          ))}

          {/* Generate/Fresh buttons removed — insight generation is managed
              via the platform admin panel (Sync Management → Sparkles button). */}
        </div>

        {/* ===== Category Tab Row (Insights tab only) ===== */}
        {activeTab === "agent" && hasInsights && (
          <div className="flex items-center gap-0.5 mb-4 overflow-x-auto scrollbar-none -mx-1 px-1 pt-1.5 pb-1">
            {CATEGORY_TABS.map((cat) => {
              const stats = categoryStats[cat.id];
              const isActive = activeCategoryId === cat.id;
              return (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategoryId(cat.id)}
                  className={`relative overflow-visible flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    isActive
                      ? "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 ring-1 ring-blue-200 dark:ring-blue-700/50"
                      : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-300"
                  }`}
                >
                  {/* Red dot for critical items */}
                  {stats?.hasCritical && !isActive && (
                    <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-rose-500 ring-1 ring-white dark:ring-slate-900" />
                  )}
                  {cat.label}
                  {stats && stats.total > 0 && (
                    <span
                      className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold ${
                        isActive
                          ? "bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200"
                          : stats.hasCritical
                          ? "bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300"
                          : "bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                      }`}
                    >
                      {stats.total}
                    </span>
                  )}
                </button>
              );
            })}

            {/* Per-category refresh button (admin only, non-All tabs) */}
            {isAdmin && activeCategoryId !== "all" && activeCategoryId !== "data_quality" && (
              <button
                onClick={() => handleCategoryRefresh(activeCategoryId)}
                disabled={
                  insightsLoading ||
                  (activeCategoryId === "data_quality"
                    ? dqTabRefreshing || dataQualityLoading
                    : isCategoryRefreshing)
                }
                className="ml-auto flex-shrink-0 flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
                title={
                  activeCategoryId === "data_quality"
                    ? "Refresh data quality metrics"
                    : `Regenerate ${activeCategoryDef?.label} insights`
                }
              >
                <RotateCw
                  className={`w-3 h-3 ${
                    activeCategoryId === "data_quality"
                      ? dqTabRefreshing || dataQualityLoading
                      : isCategoryRefreshing
                        ? "animate-spin"
                        : ""
                  }`}
                  strokeWidth={1.5}
                />
                Refresh
              </button>
            )}
          </div>
        )}

        {/* Category job progress */}
        {(categoryJob.status === "processing" || categoryJob.status === "failed") && (
          <JobProgress
            status={categoryJob.status}
            progress={categoryJob.progress}
            message={categoryJob.message}
            error={categoryJob.error}
            onRetry={() => handleCategoryRefresh(activeCategoryId)}
            className="px-1 mb-3"
          />
        )}

        {dqTabRefreshing && (
          <div className="px-1 mb-3 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" aria-hidden />
            Refreshing data quality metrics…
          </div>
        )}

        {activeTab === "agent" && hasInsights && activeCategoryId === "data_quality" && (
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Link
              to="/data-quality"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-sm font-medium transition-colors shadow-sm shadow-teal-600/20"
            >
              Open Data Quality
              <ExternalLink className="w-4 h-4" strokeWidth={2} aria-hidden />
            </Link>
          </div>
        )}

        {/* ===== My Insights Tab (personal feed + tracked section) ===== */}
        {activeTab === "my_insights" && (
          <>
            <div className="mb-6 flex flex-col items-end gap-2">
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => void handleRefreshMyUserProfile()}
                  disabled={isAnyMyInsightsActionBusy}
                  className="inline-flex shrink-0 items-center justify-center gap-2 px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50"
                  title="Recompute your behavioral interest profile from recent activity (no insight run)"
                >
                  {isMyProfileRefreshing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4" />
                  )}
                  Regenerate my user profile
                </button>
                <button
                  type="button"
                  onClick={() => void handleRefreshMyInsightsOnly()}
                  disabled={isAnyMyInsightsActionBusy}
                  className="inline-flex shrink-0 items-center justify-center gap-2 px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-sm font-medium disabled:opacity-50 shadow-sm shadow-teal-600/20"
                  title="Regenerate My Insights for your account using your saved profile"
                >
                  {isMyInsightsOnlyRefreshing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4" />
                  )}
                  Regenerate my insights
                </button>
                {isSuperAdminUser && (
                  <button
                    type="button"
                    onClick={() => void handleRefreshMyInsightsAllUsers()}
                    disabled={isAnyMyInsightsActionBusy}
                    className="inline-flex shrink-0 items-center justify-center gap-2 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium disabled:opacity-50"
                    title="Super admin: refresh My Insights for all tenant users"
                  >
                    {isMyInsightsAllUsersRefreshing ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <RefreshCw className="w-4 h-4" />
                    )}
                    Regenerate for all users
                  </button>
                )}
              </div>
              {(myProfileRefreshError || myInsightsOnlyError || myInsightsAllUsersError) && (
                <p className="text-xs text-rose-600 dark:text-rose-400 text-right max-w-md" role="alert">
                  {[myProfileRefreshError, myInsightsOnlyError, myInsightsAllUsersError]
                    .filter(Boolean)
                    .join(" ")}
                </p>
              )}
            </div>
            {myInsightsLoading && !hasMyInsights && (
              <div className="flex flex-col gap-4 mb-6">
                {[0, 1].map((i) => (
                  <div
                    key={i}
                    className="h-24 rounded-2xl bg-slate-100/80 dark:bg-slate-800/40 animate-pulse"
                  />
                ))}
              </div>
            )}
            {!myInsightsLoading && myInsightsNeedsGen && !hasMyInsights && (
              <div className="rounded-2xl border border-slate-200/60 dark:border-slate-700/60 bg-slate-50/80 dark:bg-slate-800/40 backdrop-blur-sm p-6 text-center mb-6">
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  No personalized insights yet for your account. They generate after data sync, or use
                  Regenerate my user profile and Regenerate my insights above.
                  {isSuperAdminUser
                    ? " Super admins can also use Regenerate for all users to refresh every active user in this tenant."
                    : ""}
                </p>
              </div>
            )}
            {hasMyInsights && (
              <div className="flex flex-col gap-4 mb-8">
                {BUCKET_ORDER.map((bucket) => {
                  const items = bucketedMyInsights[bucket.id] || [];
                  if (items.length === 0) return null;
                  return (
                    <BucketLane
                      key={`my-${bucket.id}`}
                      config={bucket}
                      insights={items}
                      onInsightClick={handleInsightClick}
                      isDrillable={isDrillable}
                      globalExpanded={globalExpanded}
                      expandToggleKey={expandToggleKey}
                      onSubmitFeedback={undefined}
                      isTracked={() => false}
                      onToggleTrack={undefined}
                      isAdmin={isAdmin}
                    />
                  );
                })}
              </div>
            )}
            <div className="border-t border-slate-200/60 dark:border-slate-700/60 pt-6">
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-3">
                Tracked insights
              </h3>
              {isAdmin && (
                <div className="mb-3 flex justify-end">
                  <button
                    type="button"
                    onClick={handleRunTrackedReevaluation}
                    disabled={trackedReevalLoading}
                    className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors"
                  >
                    {trackedReevalLoading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" aria-hidden />
                    ) : null}
                    Run Tracked Re-Evaluation
                  </button>
                </div>
              )}
              <TrackedInsightsWatchlist
                selectedTenantId={selectedTenantId}
                refreshTrigger={watchlistRefreshTrigger}
                onInsightRemoved={() => {
                  fetchAndBuildPipelineMap(true).then(setTrackedPipelineMap).catch(() => {});
                }}
              />
            </div>

            <div className="mt-10 rounded-2xl border border-slate-200/60 dark:border-slate-700/60 bg-slate-50/50 dark:bg-slate-800/30 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-1">My Prompts</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 max-w-2xl">
                    Saved questions can narrow which loans apply using specifiers (pick a loans-table column, then one
                    or more values). Batch prompts run with My Insights sync; use Run for an immediate card. A full My
                    Insights job cannot run at the same time as a single-prompt run.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    resetMyPromptForm();
                    setMyPromptModalOpen(true);
                  }}
                  className="inline-flex shrink-0 items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium shadow-sm shadow-blue-600/20"
                >
                  <Plus className="w-4 h-4" strokeWidth={2} />
                  Add Prompt
                </button>
              </div>
              {myPromptsError && (
                <p className="text-xs text-rose-600 dark:text-rose-400 mb-2" role="alert">
                  {myPromptsError}
                </p>
              )}
              {(myPromptRunJob.status === "processing" || myPromptRunJob.status === "failed") && (
                <JobProgress
                  status={myPromptRunJob.status}
                  progress={myPromptRunJob.progress}
                  message={myPromptRunJob.message}
                  error={myPromptRunJob.error}
                  className="mb-3"
                />
              )}
              {myPromptsLoading ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">Loading prompts…</p>
              ) : myPrompts.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">No saved prompts yet.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {myPrompts.map((p) => (
                    <li
                      key={p.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200/80 dark:border-slate-600/80 bg-white/80 dark:bg-slate-900/50 px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">
                          {p.title}{" "}
                          <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                            ({p.schedule === "on_demand" ? "on demand" : "batch"})
                          </span>
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2">
                          {p.prompt_text}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <label className="text-xs flex items-center gap-1 cursor-pointer text-slate-600 dark:text-slate-300">
                          <input
                            type="checkbox"
                            checked={p.enabled}
                            onChange={() => void handleTogglePromptEnabled(p)}
                            className="rounded border-slate-300"
                          />
                          On
                        </label>
                        <button
                          type="button"
                          title="Run this prompt now"
                          onClick={() => void handleRunMyPrompt(p.id)}
                          disabled={isAnyMyInsightsActionBusy || !p.enabled}
                          className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
                        >
                          <Play className="w-4 h-4 text-teal-600" strokeWidth={2} />
                        </button>
                        <button
                          type="button"
                          title="Edit"
                          onClick={() => handleEditMyPrompt(p)}
                          className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <Pencil className="w-4 h-4 text-slate-600 dark:text-slate-300" strokeWidth={2} />
                        </button>
                        <button
                          type="button"
                          title="Delete"
                          onClick={() => void handleDeleteMyPrompt(p.id)}
                          className="p-1.5 rounded hover:bg-rose-50 dark:hover:bg-rose-950/30"
                        >
                          <Trash2 className="w-4 h-4 text-rose-600" strokeWidth={2} />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <Dialog
              open={myPromptModalOpen}
              onOpenChange={(open) => {
                setMyPromptModalOpen(open);
                if (!open) resetMyPromptForm();
              }}
            >
              <DialogContent className="flex max-h-[min(90dvh,calc(100dvh-2rem))] w-[min(100vw-2rem,52rem)] max-w-3xl flex-col gap-0 overflow-y-auto p-6 sm:p-8">
                <DialogHeader className="flex-shrink-0 pb-3">
                  <DialogTitle>{editingPromptId ? "Edit saved prompt" : "Add prompt"}</DialogTitle>
                  <DialogDescription>
                    Batch prompts run when My Insights syncs; on-demand prompts run when you use Run on the list.
                  </DialogDescription>
                </DialogHeader>
                <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-2 py-1 sm:px-3 sm:py-2">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                      Title
                      <input
                        type="text"
                        value={promptFormTitle}
                        onChange={(e) => setPromptFormTitle(e.target.value)}
                        className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus-visible:ring-offset-slate-950"
                        placeholder="Short label"
                      />
                    </label>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                      Schedule
                      <select
                        value={promptFormSchedule}
                        onChange={(e) => setPromptFormSchedule(e.target.value as "batch" | "on_demand")}
                        className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus-visible:ring-offset-slate-950"
                      >
                        <option value="batch">Batch (with My Insights sync)</option>
                        <option value="on_demand">On demand</option>
                      </select>
                    </label>
                  </div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                    Prompt text
                    <textarea
                      value={promptFormText}
                      onChange={(e) => setPromptFormText(e.target.value)}
                      rows={4}
                      className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus-visible:ring-offset-slate-950"
                      placeholder="What you want summarized as a My Insights card…"
                    />
                  </label>
                  <div>
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Specifiers</span>
                      <button
                        type="button"
                        onClick={addSpecifierRow}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                      >
                        <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                        Add specifier
                      </button>
                    </div>
                    {loanSchemaLoading ? (
                      <p className="text-xs text-slate-500 dark:text-slate-400">Loading loan columns…</p>
                    ) : null}
                    {promptSpecifierRows.length === 0 ? (
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        No specifiers — prompt applies to your full loan scope. Add a row to filter by column values.
                      </p>
                    ) : (
                      <div className="flex flex-col gap-3">
                        {promptSpecifierRows.map((row) => {
                          const colMeta = sortedLoanSchemaColumns.find((c) => c.name === row.column);
                          const columnTriggerLabel = colMeta
                            ? `${colMeta.displayName} (${colMeta.name})`
                            : "Select column…";
                          const colQ =
                            specifierColumnPopoverRowId === row.id
                              ? specifierColumnSearch.trim().toLowerCase()
                              : "";
                          const colsFiltered = colQ
                            ? sortedLoanSchemaColumns.filter(
                                (c) =>
                                  c.name.toLowerCase().includes(colQ) ||
                                  c.displayName.toLowerCase().includes(colQ)
                              )
                            : sortedLoanSchemaColumns;
                          const mergedValueOptions = Array.from(
                            new Set([
                              ...row.values.filter((v) => !row.options.includes(v)),
                              ...row.options,
                            ])
                          );
                          const valQ =
                            specifierValuesPopoverRowId === row.id
                              ? specifierValuesSearch.trim().toLowerCase()
                              : "";
                          const valuesFiltered = valQ
                            ? mergedValueOptions.filter((v) => v.toLowerCase().includes(valQ))
                            : mergedValueOptions;
                          const orderedValues = [...valuesFiltered].sort((a, b) => {
                            const as = row.values.includes(a) ? 1 : 0;
                            const bs = row.values.includes(b) ? 1 : 0;
                            if (as !== bs) return bs - as;
                            return a.localeCompare(b, undefined, { numeric: true });
                          });
                          return (
                            <div
                              key={row.id}
                              className="flex flex-wrap items-start gap-3 rounded-xl border border-slate-200/80 bg-white/90 p-3 dark:border-slate-600/80 dark:bg-slate-900/50"
                            >
                              <div className="min-w-[min(100%,220px)] flex-1">
                                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                  Column
                                </label>
                                <Popover
                                  open={specifierColumnPopoverRowId === row.id}
                                  onOpenChange={(open) => {
                                    if (open) {
                                      setSpecifierColumnPopoverRowId(row.id);
                                      setSpecifierColumnSearch("");
                                    } else {
                                      setSpecifierColumnPopoverRowId((cur) => (cur === row.id ? null : cur));
                                      setSpecifierColumnSearch("");
                                    }
                                  }}
                                >
                                  <PopoverTrigger asChild>
                                    <button
                                      type="button"
                                      disabled={loanSchemaLoading}
                                      className={cn(
                                        "flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-900 shadow-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100",
                                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-950",
                                        loanSchemaLoading && "cursor-not-allowed opacity-50"
                                      )}
                                    >
                                      <span className="min-w-0 flex-1 truncate">{columnTriggerLabel}</span>
                                      <ChevronDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden />
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent align="start" className="w-80 p-0" sideOffset={6}>
                                    <Command shouldFilter={false}>
                                      <CommandInput
                                        placeholder="Search columns…"
                                        value={specifierColumnSearch}
                                        onValueChange={setSpecifierColumnSearch}
                                      />
                                      <CommandList className="max-h-[min(40vh,260px)]">
                                        <CommandEmpty>No columns found.</CommandEmpty>
                                        {colsFiltered.map((col) => (
                                          <CommandItem
                                            key={col.name}
                                            value={`${col.displayName} ${col.name}`}
                                            onSelect={() => {
                                              setSpecifierRowColumn(row.id, col.name);
                                              setSpecifierColumnPopoverRowId(null);
                                              setSpecifierColumnSearch("");
                                            }}
                                            className={cn(
                                              "cursor-pointer",
                                              row.column === col.name
                                                ? "!bg-accent !text-accent-foreground"
                                                : ""
                                            )}
                                          >
                                            <span className="mr-2">{row.column === col.name ? "✓" : ""}</span>
                                            <span className="truncate">
                                              {col.displayName}{" "}
                                              <span className="text-slate-500 dark:text-slate-400">({col.name})</span>
                                            </span>
                                          </CommandItem>
                                        ))}
                                      </CommandList>
                                    </Command>
                                  </PopoverContent>
                                </Popover>
                              </div>
                              <div className="min-w-[min(100%,260px)] flex-[2]">
                                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                  Values
                                </label>
                                {row.optionsLoading ? (
                                  <div className="flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-500 dark:border-slate-600 dark:bg-slate-900">
                                    <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                                    Loading values…
                                  </div>
                                ) : row.optionsError ? (
                                  <p className="text-xs text-rose-600 dark:text-rose-400">{row.optionsError}</p>
                                ) : (
                                  <Popover
                                    open={specifierValuesPopoverRowId === row.id}
                                    onOpenChange={(open) => {
                                      if (open) {
                                        setSpecifierValuesPopoverRowId(row.id);
                                        setSpecifierValuesSearch("");
                                      } else {
                                        setSpecifierValuesPopoverRowId((cur) => (cur === row.id ? null : cur));
                                        setSpecifierValuesSearch("");
                                      }
                                    }}
                                  >
                                    <PopoverTrigger asChild>
                                      <button
                                        type="button"
                                        disabled={!row.column}
                                        className={cn(
                                          "flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-900 shadow-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100",
                                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-950",
                                          !row.column && "cursor-not-allowed opacity-50"
                                        )}
                                      >
                                        <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">
                                          {summarizeSpecifierValues(row.values)}
                                        </span>
                                        <ChevronDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden />
                                      </button>
                                    </PopoverTrigger>
                                    <PopoverContent align="start" className="w-80 p-0" sideOffset={6}>
                                      <Command shouldFilter={false}>
                                        <CommandInput
                                          placeholder="Search values…"
                                          value={specifierValuesSearch}
                                          onValueChange={setSpecifierValuesSearch}
                                        />
                                        <CommandList className="max-h-[min(40vh,260px)]">
                                          <CommandEmpty>No values found.</CommandEmpty>
                                          {orderedValues.map((v) => {
                                            const sel = row.values.includes(v);
                                            return (
                                              <CommandItem
                                                key={v}
                                                value={v}
                                                onSelect={() => {
                                                  const next = sel
                                                    ? row.values.filter((x) => x !== v)
                                                    : [...row.values, v];
                                                  setSpecifierRowValues(row.id, next);
                                                }}
                                                className={cn(
                                                  "cursor-pointer hover:!bg-transparent hover:!text-foreground data-[selected=true]:!bg-transparent data-[selected=true]:!text-foreground",
                                                  sel
                                                    ? "!bg-accent !text-accent-foreground hover:!bg-accent data-[selected=true]:!bg-accent data-[selected=true]:!text-accent-foreground"
                                                    : ""
                                                )}
                                              >
                                                <span className="mr-2">{sel ? "✓" : ""}</span>
                                                <span className="break-all">{v}</span>
                                              </CommandItem>
                                            );
                                          })}
                                        </CommandList>
                                      </Command>
                                    </PopoverContent>
                                  </Popover>
                                )}
                                {!row.optionsLoading &&
                                row.column &&
                                mergedValueOptions.length === 0 &&
                                !row.optionsError ? (
                                  <p className="mt-1 text-xs text-slate-500">No distinct values for this column.</p>
                                ) : null}
                              </div>
                              <button
                                type="button"
                                title="Remove specifier"
                                onClick={() => removeSpecifierRow(row.id)}
                                className="mt-5 shrink-0 rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50 hover:text-rose-600 dark:border-slate-600 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-rose-400"
                              >
                                <X className="h-4 w-4" strokeWidth={2} />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
                <DialogFooter className="flex-shrink-0 flex-col gap-2 border-t border-slate-200/80 pt-5 dark:border-slate-700/80 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={() => setMyPromptModalOpen(false)}
                    className="inline-flex justify-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSubmitMyPrompt()}
                    disabled={promptFormBusy || isAnyMyInsightsActionBusy}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                  >
                    {promptFormBusy ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden /> : null}
                    {editingPromptId ? "Save changes" : "Create prompt"}
                  </button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        )}

        {/* ===== Job Progress ===== */}
        {(refreshJob.status === "processing" || refreshJob.status === "failed") && (
          <JobProgress
            status={refreshJob.status}
            progress={refreshJob.progress}
            message={refreshJob.message}
            error={refreshJob.error}
            onRetry={handleRefresh}
            className="px-1"
          />
        )}
        {(agentJob.status === "processing" || agentJob.status === "failed") && (
          <JobProgress
            status={agentJob.status}
            progress={agentJob.progress}
            message={agentJob.message}
            error={agentJob.error}
            onRetry={() => handleAgentGenerate(false)}
            className="px-1"
          />
        )}

        {/* ===== Loading shimmer ===== */}
        {activeTab === "agent" && insightsLoading && !hasInsights && !(refreshJob.status === "processing") && (
          <div className="flex flex-col gap-4">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-28 rounded-2xl bg-slate-100/80 dark:bg-slate-800/40 animate-pulse"
              />
            ))}
          </div>
        )}

        {/* ===== Needs Generation CTA ===== */}
        {activeTab === "agent" && !insightsLoading && needsGeneration && !hasInsights && (
          <div className="rounded-2xl border border-slate-200/60 dark:border-slate-700/60 bg-slate-50/80 dark:bg-slate-800/40 backdrop-blur-sm p-8 text-center">
            <div className="flex flex-col items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
                <Sparkles className="w-7 h-7 text-white" strokeWidth={1.5} />
              </div>
              <div>
                <p className="text-base font-medium text-slate-800 dark:text-slate-200">
                  Ready to generate insights
                </p>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  Cohi will analyze your data across 4 categories using AI
                </p>
              </div>
              <button
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white text-sm font-medium shadow-lg shadow-blue-500/20 hover:shadow-blue-500/30 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50"
              >
                {isRefreshing ? (
                  <>
                    <RefreshCw
                      className="w-4 h-4 animate-spin"
                      strokeWidth={1.5}
                    />
                    Generating insights...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" strokeWidth={1.5} />
                    Generate Insights
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* ===== Empty state (no data at all) ===== */}
        {activeTab === "agent" && !insightsLoading && !needsGeneration && !hasInsights && (
          <div className="rounded-2xl border border-slate-200/60 dark:border-slate-700/60 bg-slate-50/80 dark:bg-slate-800/40 backdrop-blur-sm p-6 text-center">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Insights will appear once live data is available for this tenant.
            </p>
          </div>
        )}

        {/* ===== Generating overlay ===== */}
        {activeTab === "agent" && isRefreshing && hasInsights && (
          <div className="mb-4 flex items-center justify-center gap-2 py-2 px-4 rounded-xl bg-blue-50/80 dark:bg-blue-950/30 border border-blue-200/60 dark:border-blue-800/40">
            <RefreshCw
              className="w-3.5 h-3.5 text-blue-500 animate-spin"
              strokeWidth={2}
            />
            <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
              Regenerating insights...
            </span>
          </div>
        )}

        {/* ===== Per-category empty state (has global insights, but none for this category) ===== */}
        {activeTab === "agent" && hasInsights && !hasFilteredInsights && activeCategoryId !== "all" && !insightsLoading && (
          <div className="rounded-2xl border border-slate-200/60 dark:border-slate-700/60 bg-slate-50/80 dark:bg-slate-800/40 backdrop-blur-sm p-8 text-center">
            <div className="flex flex-col items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-slate-400 dark:text-slate-500" strokeWidth={1.5} />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  {activeCategoryDef?.emptyTitle}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-xs mx-auto">
                  {activeCategoryDef?.emptyBody}
                </p>
              </div>
              {isAdmin && activeCategoryId !== "data_quality" && (
                <button
                  onClick={() => handleCategoryRefresh(activeCategoryId)}
                  disabled={isCategoryRefreshing}
                  className="mt-1 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs font-medium hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors disabled:opacity-50"
                >
                  <Sparkles className="w-3.5 h-3.5" strokeWidth={1.5} />
                  Generate {activeCategoryDef?.label} Insights
                </button>
              )}
              {isAdmin && activeCategoryId === "data_quality" && (
                <button
                  onClick={() => handleCategoryRefresh("data_quality")}
                  disabled={dqTabRefreshing || dataQualityLoading}
                  className="mt-1 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-50 dark:bg-teal-900/30 text-teal-800 dark:text-teal-200 text-xs font-medium hover:bg-teal-100 dark:hover:bg-teal-900/50 transition-colors disabled:opacity-50"
                >
                  <RotateCw
                    className={`w-3.5 h-3.5 ${dqTabRefreshing || dataQualityLoading ? "animate-spin" : ""}`}
                    strokeWidth={1.5}
                  />
                  Refresh metrics
                </button>
              )}
            </div>
          </div>
        )}

        {/* ===== Bucket Lanes (stacked) ===== */}
        {activeTab === "agent" && hasFilteredInsights && (
          <div className="flex flex-col gap-4">
            {BUCKET_ORDER.map((bucket) => {
              const items = bucketedInsights[bucket.id] || [];
              if (items.length === 0) return null;
              return (
                <BucketLane
                  key={bucket.id}
                  config={bucket}
                  insights={items}
                  onInsightClick={handleInsightClick}
                  isDrillable={isDrillable}
                  globalExpanded={globalExpanded}
                  expandToggleKey={expandToggleKey}
                  onRefreshBucket={
                    isAdmin
                      ? async () => {
                          await refreshBucket(bucket.id);
                        }
                      : undefined
                  }
                  onGenerateMore={
                    isAdmin
                      ? async () => {
                          await generateMoreInsights(bucket.id);
                        }
                      : undefined
                  }
                  onDeleteInsight={
                    isAdmin ? deleteInsight : undefined
                  }
                  onSubmitFeedback={submitFeedback}
                  onInvestigate={isAdmin ? handleInvestigate : undefined}
                  isTracked={(i) => i.insightId != null && trackedPipelineMap.has(i.insightId)}
                  onToggleTrack={handleToggleTrack}
                  isAdmin={isAdmin}
                />
              );
            })}
          </div>
        )}
      </motion.div>

      {/* Dashboard Insight Evidence Modal (fallback when details API returns 404 for dashboard_insights) */}
      <DashboardInsightEvidenceModal
        isOpen={isModalOpen && selectedInsight?.source === "dashboard_insights" && useDashboardEvidenceModalFallback}
        onClose={() => {
          setIsModalOpen(false);
          setSelectedInsight(null);
          setUseDashboardEvidenceModalFallback(false);
        }}
        insight={selectedInsight?.source === "dashboard_insights" && selectedInsight ? CohiInsightToEvidenceModalInsight(selectedInsight) : null}
      />

      {/* Insight Detail Modal (pipeline + dashboard_insights; for dashboard_insights fallback to evidence modal on 404) */}
      <InsightDetailModal
        isOpen={isModalOpen && selectedInsight != null && (selectedInsight.source !== "dashboard_insights" || !useDashboardEvidenceModalFallback)}
        onClose={() => {
          setIsModalOpen(false);
          setSelectedInsight(null);
          setUseDashboardEvidenceModalFallback(false);
        }}
        insightSource={selectedInsight?.source === "my" ? "my" : selectedInsight?.source || ""}
        insightMessage={selectedInsight?.message || ""}
        insightId={selectedInsight?.insightId}
        dateFilter={dateFilter}
        selectedTenantId={selectedTenantId}
        isAdmin={isAdmin}
        etmData={selectedInsight ? {
          what_changed: selectedInsight.what_changed,
          why: selectedInsight.why,
          business_impact: selectedInsight.business_impact,
          risk_if_ignored: selectedInsight.risk_if_ignored,
          recommended_action: selectedInsight.recommended_action,
          owner: selectedInsight.owner,
        } : undefined}
        isTracked={selectedInsight != null && selectedInsight.insightId != null && trackedPipelineMap.has(selectedInsight.insightId)}
        onToggleTrack={selectedInsight ? () => handleToggleTrack(selectedInsight) : undefined}
        onDetailUnavailable={selectedInsight?.source === "dashboard_insights" ? () => setUseDashboardEvidenceModalFallback(true) : undefined}
      />

      {/* Agent Finding Drilldown Modal — portal to body to escape overflow-hidden parents */}
      {createPortal(
        <AnimatePresence>
          {agentFinding && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
              onClick={() => { setAgentFinding(null); setAgentFindingInsight(null); }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: "spring", duration: 0.3 }}
              className="relative w-full max-w-4xl max-h-[85vh] flex flex-col rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Scrollable content */}
              <div className="flex-1 overflow-y-auto p-6 min-h-0">
                {agentFindingInsight &&
                  (() => {
                    const dq = insightDqMeta.get(agentFindingInsight);
                    return dq?.flagged ? <DataQualityImpactBlock dq={dq} className="mb-4" /> : null;
                  })()}
                {/* Action buttons */}
                <div className="flex justify-end gap-2 mb-2">
                  <button
                    onClick={handleMoveAgentFindingToResearch}
                    disabled={isCreatingResearch}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-900/50 transition-colors disabled:opacity-50"
                  >
                    {isCreatingResearch ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <FlaskConical className="w-3.5 h-3.5" />
                    )}
                    {isCreatingResearch ? 'Opening...' : 'Research Lab'}
                  </button>
                  {agentFindingInsight && (
                    <button
                      onClick={() => handleToggleTrack(agentFindingInsight)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                        agentFindingInsight.insightId != null && trackedPipelineMap.has(agentFindingInsight.insightId)
                          ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300"
                          : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-amber-100 dark:hover:bg-amber-900/30 hover:text-amber-700 dark:hover:text-amber-300"
                      }`}
                      title={agentFindingInsight.insightId != null && trackedPipelineMap.has(agentFindingInsight.insightId) ? "Remove from watchlist" : "Track this insight"}
                    >
                      <Bookmark className={`w-3.5 h-3.5 ${agentFindingInsight.insightId != null && trackedPipelineMap.has(agentFindingInsight.insightId) ? "text-amber-500 fill-amber-500 dark:text-amber-400 dark:fill-amber-400" : ""}`} />
                      {agentFindingInsight.insightId != null && trackedPipelineMap.has(agentFindingInsight.insightId) ? "Tracked" : "Track This Insight"}
                    </button>
                  )}
                </div>
                <FindingDrillDown
                  finding={agentFinding}
                  onClose={() => { setAgentFinding(null); setAgentFindingInsight(null); }}
                />
              </div>

              {/* Fixed chat at bottom */}
              <div className="flex-shrink-0 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-6 pb-4">
                <InsightChat
                  insightContext={{
                    title: agentFinding.title,
                    summary: agentFinding.summary,
                    confidence: agentFinding.confidence,
                    keyMetrics: agentFinding.keyMetrics,
                    evidence: agentFinding.evidence.map((e) => ({
                      sql: e.sql,
                      explanation: e.explanation,
                      rowCount: e.rowCount,
                      fields: e.fields,
                    })),
                  }}
                  selectedTenantId={selectedTenantId}
                />
              </div>
            </motion.div>
          </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
});
