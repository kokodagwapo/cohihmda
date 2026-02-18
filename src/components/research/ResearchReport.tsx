/**
 * ResearchReport
 *
 * Renders the synthesis agent's final output: executive summary,
 * KPI summary strip, key themes (collapsible), ranked insights
 * (with inline metrics + Q&A), and areas for further investigation.
 *
 * Includes: section navigation, executive brief / full report toggle,
 * contextual tooltips on all badges and headers, and per-card
 * InsightChat integration.
 */

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import {
  AlertTriangle,
  AlertCircle,
  Info,
  TrendingUp,
  ChevronRight,
  ChevronDown,
  Search,
  BarChart3,
  Target,
  ThumbsUp,
  ThumbsDown,
  CheckCircle2,
  X,
  Bookmark,
  HelpCircle,
  MessageSquare,
  Eye,
  FileText,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { InsightChat } from "@/components/dashboard/InsightChat";
import type {
  ResearchReport as ResearchReportType,
  ResearchTheme,
  RankedInsight,
  Finding,
} from "@/hooks/useResearchSession";

// ============================================================================
// Types
// ============================================================================

interface ResearchReportProps {
  report: ResearchReportType;
  findings: Finding[];
  sessionId?: string | null;
  selectedTenantId?: string | null;
  onSubmitFeedback?: (
    targetType: "step" | "finding" | "session",
    targetId: string | null,
    rating: -1 | 1 | null,
    comment: string | null,
    context?: any
  ) => void;
  onDrillDown?: (finding: Finding) => void;
  onTrackInsight?: (headline: string, detail: string) => void;
}

type ViewMode = "brief" | "full";

// ============================================================================
// Shared Tooltip Helper
// ============================================================================

function InfoTip({ text }: { text: string }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <HelpCircle className="h-3 w-3 text-muted-foreground/60 hover:text-muted-foreground cursor-help flex-shrink-0" />
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ============================================================================
// Tooltip descriptions
// ============================================================================

const SEVERITY_TOOLTIPS: Record<string, string> = {
  critical:
    "Requires immediate attention — significant risk to pipeline or revenue",
  warning: "Should be addressed soon — trending negatively or nearing a threshold",
  info: "Informational finding — no immediate action needed but worth monitoring",
  positive: "Positive trend — things are going well in this area",
};

const IMPACT_TOOLTIPS: Record<string, string> = {
  high: "Likely to materially affect pipeline volume, revenue, or operational efficiency",
  medium: "Moderate effect — worth acting on but not an emergency",
  low: "Minor impact — good to know but lower priority",
};

const CONFIDENCE_TOOLTIPS: Record<string, string> = {
  high: "Based on strong statistical evidence across multiple data points",
  medium: "Based on moderate evidence — directionally reliable",
  low: "Limited evidence — treat as a hypothesis worth investigating",
};

// ============================================================================
// Finding Feedback
// ============================================================================

function FindingFeedback({
  findingId,
  onSubmit,
}: {
  findingId: string;
  onSubmit: (id: string, rating: -1 | 1, comment: string) => void;
}) {
  const [active, setActive] = useState(false);
  const [rating, setRating] = useState<-1 | 1 | null>(null);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);

  if (submitted) {
    return (
      <span className="text-[10px] text-muted-foreground">Feedback saved</span>
    );
  }

  if (!active) {
    return (
      <div className="inline-flex items-center gap-0.5">
        <button
          className="p-0.5 rounded hover:bg-muted"
          title="Good insight"
          onClick={() => {
            setRating(1);
            setActive(true);
          }}
        >
          <ThumbsUp className="h-3 w-3 text-muted-foreground" />
        </button>
        <button
          className="p-0.5 rounded hover:bg-muted"
          title="Bad insight"
          onClick={() => {
            setRating(-1);
            setActive(true);
          }}
        >
          <ThumbsDown className="h-3 w-3 text-muted-foreground" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 mt-1">
      <Button
        variant={rating === 1 ? "default" : "outline"}
        size="icon"
        className="h-6 w-6"
        onClick={() => setRating(1)}
      >
        <ThumbsUp className="h-3 w-3" />
      </Button>
      <Button
        variant={rating === -1 ? "destructive" : "outline"}
        size="icon"
        className="h-6 w-6"
        onClick={() => setRating(-1)}
      >
        <ThumbsDown className="h-3 w-3" />
      </Button>
      <Input
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Comment..."
        className="h-6 text-xs flex-1 max-w-[200px]"
        onKeyDown={(e) => {
          if (e.key === "Enter" && rating !== null) {
            onSubmit(findingId, rating, comment);
            setSubmitted(true);
          }
        }}
      />
      <Button
        size="icon"
        className="h-6 w-6"
        disabled={rating === null}
        onClick={() => {
          if (rating !== null) {
            onSubmit(findingId, rating, comment);
            setSubmitted(true);
          }
        }}
      >
        <CheckCircle2 className="h-3 w-3" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={() => setActive(false)}
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}

// ============================================================================
// Severity Helpers
// ============================================================================

function getSeverityIcon(severity: ResearchTheme["severity"]) {
  switch (severity) {
    case "critical":
      return <AlertTriangle className="h-4 w-4 text-red-500" />;
    case "warning":
      return <AlertCircle className="h-4 w-4 text-amber-500" />;
    case "info":
      return <Info className="h-4 w-4 text-blue-500" />;
    case "positive":
      return <TrendingUp className="h-4 w-4 text-green-500" />;
  }
}

function getSeverityBg(severity: ResearchTheme["severity"]): string {
  switch (severity) {
    case "critical":
      return "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30";
    case "warning":
      return "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30";
    case "info":
      return "border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30";
    case "positive":
      return "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30";
  }
}

function getSeverityLabel(severity: ResearchTheme["severity"]): string {
  switch (severity) {
    case "critical": return "Critical";
    case "warning": return "Warning";
    case "info": return "Info";
    case "positive": return "Positive";
  }
}

// ============================================================================
// KPI Summary Strip
// ============================================================================

function KpiSummaryStrip({ findings }: { findings: Finding[] }) {
  const aggregatedMetrics = useMemo(() => {
    const all: Record<string, string | number> = {};
    for (const f of findings) {
      if (f.keyMetrics) {
        for (const [k, v] of Object.entries(f.keyMetrics)) {
          if (!(k in all)) all[k] = v;
        }
      }
    }
    return Object.entries(all).slice(0, 8);
  }, [findings]);

  if (aggregatedMetrics.length === 0) return null;

  const formatKpiValue = (val: string | number): string => {
    const num = Number(val);
    if (isNaN(num)) return String(val);
    if (Math.abs(num) >= 1_000_000)
      return `$${(num / 1_000_000).toFixed(1)}M`;
    if (Math.abs(num) >= 1_000) return num.toLocaleString();
    if (num % 1 !== 0) return num.toFixed(2);
    return String(num);
  };

  const humanizeKey = (key: string): string =>
    key
      .replace(/_/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
      {aggregatedMetrics.map(([key, value]) => (
        <div
          key={key}
          className="flex-shrink-0 rounded-lg border bg-card px-3 py-2 min-w-[120px]"
        >
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide block truncate">
            {humanizeKey(key)}
          </span>
          <span className="text-sm font-semibold mt-0.5 block">
            {formatKpiValue(value)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Section Navigation
// ============================================================================

const SECTIONS = [
  { id: "summary", label: "Summary" },
  { id: "themes", label: "Themes" },
  { id: "insights", label: "Insights" },
  { id: "next-steps", label: "Next Steps" },
] as const;

function SectionNav({
  activeSection,
  counts,
  onNavigate,
}: {
  activeSection: string;
  counts: Record<string, number>;
  onNavigate: (id: string) => void;
}) {
  return (
    <div className="flex gap-1 bg-muted/50 rounded-lg p-1 w-fit">
      {SECTIONS.map((s) => {
        const count = counts[s.id];
        const isActive = activeSection === s.id;
        return (
          <button
            key={s.id}
            onClick={() => onNavigate(s.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
              isActive
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {s.label}
            {count != null && count > 0 && (
              <span className="ml-1 text-[10px] opacity-60">({count})</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function ExecutiveSummary({ summary }: { summary: string }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <BarChart3 className="h-4 w-4" />
          Executive Summary
          <InfoTip text="AI-generated overview of all findings from this research session" />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm leading-relaxed">{summary}</p>
      </CardContent>
    </Card>
  );
}

function ThemeAccordion({
  themes,
  findings,
}: {
  themes: ResearchTheme[];
  findings: Finding[];
}) {
  return (
    <Accordion type="multiple" className="space-y-2">
      {themes.map((theme, i) => (
        <AccordionItem
          key={i}
          value={`theme-${i}`}
          className={`rounded-lg border overflow-hidden ${getSeverityBg(theme.severity)}`}
        >
          <AccordionTrigger className="px-3 py-2.5 text-sm hover:no-underline [&[data-state=open]>svg]:rotate-180">
            <div className="flex items-center gap-2 flex-1 min-w-0 text-left">
              {getSeverityIcon(theme.severity)}
              <span className="font-medium truncate">{theme.name}</span>
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 flex-shrink-0">
                      {getSeverityLabel(theme.severity)}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs text-xs">
                    {SEVERITY_TOOLTIPS[theme.severity]}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              {theme.findingIds.length > 0 && (
                <span className="text-[10px] text-muted-foreground flex-shrink-0">
                  {theme.findingIds.length} finding{theme.findingIds.length > 1 ? "s" : ""}
                </span>
              )}
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-3 pb-3">
            <p className="text-xs text-muted-foreground leading-relaxed mb-2">
              {theme.description}
            </p>
            {theme.findingIds.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {theme.findingIds.map((id) => {
                  const finding = findings.find((f) => f.questionId === id);
                  return (
                    <TooltipProvider key={id} delayDuration={200}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge variant="outline" className="text-xs px-1.5 py-0 h-5">
                            Q{id}{finding ? `: ${finding.title.slice(0, 30)}${finding.title.length > 30 ? "..." : ""}` : ""}
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-sm text-xs">
                          {finding ? finding.summary.slice(0, 150) : "Links to the underlying data finding"}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  );
                })}
              </div>
            )}
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

function InsightCard({
  insight,
  findings,
  onFeedback,
  onDrillDown,
  onTrackInsight,
  selectedTenantId,
}: {
  insight: RankedInsight;
  findings: Finding[];
  onFeedback?: (id: string, rating: -1 | 1, comment: string) => void;
  onDrillDown?: (finding: Finding) => void;
  onTrackInsight?: (headline: string, detail: string) => void;
  selectedTenantId?: string | null;
}) {
  const [chatOpen, setChatOpen] = useState(false);
  const relatedFindings = findings.filter((f) =>
    insight.supportingFindingIds.includes(f.questionId)
  );

  const inlineMetrics = useMemo(() => {
    const metrics: Array<{ key: string; value: string | number }> = [];
    for (const f of relatedFindings) {
      if (f.keyMetrics) {
        for (const [k, v] of Object.entries(f.keyMetrics)) {
          if (metrics.length < 4 && !metrics.some((m) => m.key === k)) {
            metrics.push({ key: k, value: v });
          }
        }
      }
    }
    return metrics;
  }, [relatedFindings]);

  const humanizeKey = (key: string): string =>
    key
      .replace(/_/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/\b\w/g, (c) => c.toUpperCase());

  const chatContext = useMemo(
    () => ({
      title: insight.headline,
      summary: insight.detail,
      keyMetrics: relatedFindings.reduce(
        (acc, f) => ({ ...acc, ...f.keyMetrics }),
        {} as Record<string, string | number>
      ),
      evidence: relatedFindings.flatMap((f) =>
        f.evidence.map((e) => ({
          sql: e.sql,
          explanation: e.explanation,
          rowCount: e.rowCount,
          fields: e.fields,
        }))
      ),
    }),
    [insight, relatedFindings]
  );

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="flex gap-3 p-3 hover:bg-accent/5 transition-colors">
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-sm font-bold">
          {insight.rank}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          {/* Header row */}
          <div className="flex items-start gap-2">
            <p className="text-sm font-medium leading-snug flex-1">
              {insight.headline}
            </p>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {onTrackInsight && (
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() =>
                          onTrackInsight(insight.headline, insight.detail)
                        }
                        className="p-1 rounded-md hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-all"
                        title="Track this insight"
                      >
                        <Bookmark
                          className="h-3.5 w-3.5 text-muted-foreground hover:text-amber-600"
                          strokeWidth={2}
                        />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">
                      Track this insight on your watchlist
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      {insight.impact === "high" && (
                        <Badge variant="destructive" className="text-xs">
                          High Impact
                        </Badge>
                      )}
                      {insight.impact === "medium" && (
                        <Badge variant="secondary" className="text-xs">
                          Medium Impact
                        </Badge>
                      )}
                      {insight.impact === "low" && (
                        <Badge variant="outline" className="text-xs">
                          Low Impact
                        </Badge>
                      )}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs text-xs">
                    {IMPACT_TOOLTIPS[insight.impact]}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              {onFeedback && (
                <FindingFeedback
                  findingId={`insight-${insight.rank}`}
                  onSubmit={onFeedback}
                />
              )}
            </div>
          </div>

          {/* Detail text */}
          <p className="text-xs text-muted-foreground leading-relaxed">
            {insight.detail}
          </p>

          {/* Inline KPI row */}
          {inlineMetrics.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {inlineMetrics.map((m) => (
                <div
                  key={m.key}
                  className="flex items-center gap-1.5 text-xs bg-muted/50 rounded px-2 py-1"
                >
                  <span className="text-muted-foreground">{humanizeKey(m.key)}:</span>
                  <span className="font-semibold">{String(m.value)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Recommended Action callout */}
          {insight.recommendedAction && (
            <div className="flex gap-2 rounded-md border-l-3 border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/20 px-3 py-2">
              <Target className="h-3.5 w-3.5 text-indigo-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-indigo-800 dark:text-indigo-300">
                <span className="font-semibold">Action: </span>
                {insight.recommendedAction}
              </p>
            </div>
          )}

          {/* Evidence findings */}
          {relatedFindings.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {relatedFindings.map((f) => (
                <TooltipProvider key={f.questionId} delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        className="flex items-center gap-1 text-xs text-muted-foreground bg-muted rounded px-1.5 py-0.5 hover:bg-accent hover:text-foreground transition-colors"
                        onClick={() => onDrillDown?.(f)}
                      >
                        <ChevronRight className="h-3 w-3" />
                        <span>{f.title}</span>
                        <TooltipProvider delayDuration={200}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge
                                variant={
                                  f.confidence === "high"
                                    ? "default"
                                    : f.confidence === "medium"
                                    ? "secondary"
                                    : "outline"
                                }
                                className="text-[10px] px-1 py-0 h-4 ml-0.5"
                              >
                                {f.confidence}
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs text-xs">
                              {CONFIDENCE_TOOLTIPS[f.confidence]}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-sm text-xs">
                      Click to drill down into this finding's evidence
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ))}
            </div>
          )}

          {/* Ask about this button */}
          <button
            onClick={() => setChatOpen(!chatOpen)}
            className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-md transition-colors ${
              chatOpen
                ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            <MessageSquare className="h-3 w-3" />
            {chatOpen ? "Hide chat" : "Ask about this"}
          </button>
        </div>
      </div>

      {/* Inline Q&A */}
      {chatOpen && (
        <div className="border-t px-4 pb-3">
          <InsightChat
            insightContext={chatContext}
            selectedTenantId={selectedTenantId}
            starterQuestions={[
              "What's driving this trend?",
              "What should I do about this?",
            ]}
          />
        </div>
      )}
    </div>
  );
}

function FurtherInvestigationCard({
  item,
}: {
  item: { question: string; rationale: string };
}) {
  return (
    <div className="flex gap-2 p-2.5 rounded-md border border-dashed bg-muted/30">
      <Search className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-medium">{item.question}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {item.rationale}
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function ResearchReport({
  report,
  findings,
  sessionId,
  selectedTenantId,
  onSubmitFeedback,
  onDrillDown,
  onTrackInsight,
}: ResearchReportProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("brief");
  const [activeSection, setActiveSection] = useState("summary");

  const summaryRef = useRef<HTMLDivElement>(null);
  const themesRef = useRef<HTMLDivElement>(null);
  const insightsRef = useRef<HTMLDivElement>(null);
  const nextStepsRef = useRef<HTMLDivElement>(null);

  const sectionRefs: Record<string, React.RefObject<HTMLDivElement | null>> = {
    summary: summaryRef,
    themes: themesRef,
    insights: insightsRef,
    "next-steps": nextStepsRef,
  };

  const sectionCounts = useMemo(
    () => ({
      summary: 0,
      themes: report.themes?.length ?? 0,
      insights: report.rankedInsights?.length ?? 0,
      "next-steps": report.furtherInvestigation?.length ?? 0,
    }),
    [report]
  );

  // IntersectionObserver for active section highlighting
  useEffect(() => {
    const refs = [summaryRef, themesRef, insightsRef, nextStepsRef];
    const ids = ["summary", "themes", "insights", "next-steps"];

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const idx = refs.findIndex((r) => r.current === entry.target);
            if (idx >= 0) setActiveSection(ids[idx]);
          }
        }
      },
      { threshold: 0.3 }
    );

    for (const ref of refs) {
      if (ref.current) observer.observe(ref.current);
    }
    return () => observer.disconnect();
  }, []);

  const handleNavigate = useCallback((id: string) => {
    sectionRefs[id]?.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const handleFindingFeedback = useCallback(
    (id: string, rating: -1 | 1, comment: string) => {
      if (!onSubmitFeedback) return;
      onSubmitFeedback("finding", id, rating, comment || null);
    },
    [onSubmitFeedback]
  );

  const isBrief = viewMode === "brief";
  const displayInsights = isBrief
    ? (report.rankedInsights || []).slice(0, 3)
    : report.rankedInsights || [];

  return (
    <div className="space-y-4 py-2">
      {/* ========== Top bar: Section Nav + View Toggle ========== */}
      <div className="flex items-center justify-between gap-3 flex-wrap sticky top-0 z-10 bg-background/95 backdrop-blur-sm py-2 -mt-2">
        <SectionNav
          activeSection={activeSection}
          counts={sectionCounts}
          onNavigate={handleNavigate}
        />
        <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-0.5">
          <button
            onClick={() => setViewMode("brief")}
            className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
              isBrief
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Eye className="h-3 w-3" />
            Brief
          </button>
          <button
            onClick={() => setViewMode("full")}
            className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
              !isBrief
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <FileText className="h-3 w-3" />
            Full Report
          </button>
        </div>
      </div>

      {/* ========== Executive Summary ========== */}
      <div ref={summaryRef}>
        <ExecutiveSummary summary={report.executiveSummary} />
      </div>

      {/* ========== KPI Summary Strip ========== */}
      {findings.length > 0 && <KpiSummaryStrip findings={findings} />}

      {/* ========== Key Themes (Collapsible Accordion) ========== */}
      {!isBrief && report.themes && report.themes.length > 0 && (
        <div ref={themesRef}>
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Target className="h-4 w-4" />
            Key Themes
            <InfoTip text="Cross-cutting patterns identified across multiple findings" />
            <span className="text-xs font-normal text-muted-foreground">
              ({report.themes.length})
            </span>
          </h3>
          <ThemeAccordion themes={report.themes} findings={findings} />
        </div>
      )}

      <Separator />

      {/* ========== Ranked Insights ========== */}
      {displayInsights.length > 0 && (
        <div ref={insightsRef}>
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            Ranked Insights
            <InfoTip text="Findings ranked by business impact — highest priority first" />
            <span className="text-xs font-normal text-muted-foreground">
              ({report.rankedInsights?.length ?? 0})
            </span>
            {isBrief && (report.rankedInsights?.length ?? 0) > 3 && (
              <button
                onClick={() => setViewMode("full")}
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline ml-auto"
              >
                Show all {report.rankedInsights?.length}
              </button>
            )}
          </h3>
          <div className="space-y-2">
            {displayInsights.map((insight) => (
              <InsightCard
                key={insight.rank}
                insight={insight}
                findings={findings}
                onFeedback={
                  onSubmitFeedback ? handleFindingFeedback : undefined
                }
                onDrillDown={onDrillDown}
                onTrackInsight={onTrackInsight}
                selectedTenantId={selectedTenantId}
              />
            ))}
          </div>
        </div>
      )}

      {/* ========== Further Investigation ========== */}
      {!isBrief &&
        report.furtherInvestigation &&
        report.furtherInvestigation.length > 0 && (
          <>
            <Separator />
            <div ref={nextStepsRef}>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Search className="h-4 w-4" />
                Suggested Further Investigation
                <InfoTip text="Topics that may warrant deeper analysis based on this research" />
              </h3>
              <div className="space-y-2">
                {report.furtherInvestigation.map((item, i) => (
                  <FurtherInvestigationCard key={i} item={item} />
                ))}
              </div>
            </div>
          </>
        )}

      {/* ========== Timestamp ========== */}
      {report.generatedAt && (
        <p className="text-xs text-muted-foreground text-right">
          Report generated {new Date(report.generatedAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}
