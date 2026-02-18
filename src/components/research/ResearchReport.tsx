/**
 * ResearchReport
 *
 * Renders the synthesis agent's final output: executive summary,
 * key themes, ranked insights, and areas for further investigation.
 * Includes per-finding feedback controls (thumbs + comment).
 */

import { useState, useCallback } from "react";
import {
  AlertTriangle,
  AlertCircle,
  Info,
  TrendingUp,
  ChevronRight,
  Search,
  BarChart3,
  Target,
  ThumbsUp,
  ThumbsDown,
  CheckCircle2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
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
  onSubmitFeedback?: (targetType: "step" | "finding" | "session", targetId: string | null, rating: -1 | 1 | null, comment: string | null, context?: any) => void;
  onDrillDown?: (finding: Finding) => void;
}

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
    return <span className="text-[10px] text-muted-foreground">Feedback saved</span>;
  }

  if (!active) {
    return (
      <div className="inline-flex items-center gap-0.5">
        <button className="p-0.5 rounded hover:bg-muted" title="Good insight" onClick={() => { setRating(1); setActive(true); }}>
          <ThumbsUp className="h-3 w-3 text-muted-foreground" />
        </button>
        <button className="p-0.5 rounded hover:bg-muted" title="Bad insight" onClick={() => { setRating(-1); setActive(true); }}>
          <ThumbsDown className="h-3 w-3 text-muted-foreground" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 mt-1">
      <Button variant={rating === 1 ? "default" : "outline"} size="icon" className="h-6 w-6" onClick={() => setRating(1)}>
        <ThumbsUp className="h-3 w-3" />
      </Button>
      <Button variant={rating === -1 ? "destructive" : "outline"} size="icon" className="h-6 w-6" onClick={() => setRating(-1)}>
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
      <Button size="icon" className="h-6 w-6" disabled={rating === null} onClick={() => { if (rating !== null) { onSubmit(findingId, rating, comment); setSubmitted(true); } }}>
        <CheckCircle2 className="h-3 w-3" />
      </Button>
      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setActive(false)}>
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
    case "critical": return <AlertTriangle className="h-4 w-4 text-red-500" />;
    case "warning": return <AlertCircle className="h-4 w-4 text-amber-500" />;
    case "info": return <Info className="h-4 w-4 text-blue-500" />;
    case "positive": return <TrendingUp className="h-4 w-4 text-green-500" />;
  }
}

function getSeverityBg(severity: ResearchTheme["severity"]): string {
  switch (severity) {
    case "critical": return "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30";
    case "warning": return "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30";
    case "info": return "border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30";
    case "positive": return "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30";
  }
}

function getImpactBadge(impact: RankedInsight["impact"]) {
  switch (impact) {
    case "high": return <Badge variant="destructive" className="text-xs">High Impact</Badge>;
    case "medium": return <Badge variant="secondary" className="text-xs">Medium Impact</Badge>;
    case "low": return <Badge variant="outline" className="text-xs">Low Impact</Badge>;
  }
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
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm leading-relaxed">{summary}</p>
      </CardContent>
    </Card>
  );
}

function ThemeCard({ theme }: { theme: ResearchTheme }) {
  return (
    <div className={`rounded-lg border p-3 ${getSeverityBg(theme.severity)}`}>
      <div className="flex items-start gap-2">
        {getSeverityIcon(theme.severity)}
        <div className="min-w-0">
          <p className="text-sm font-medium">{theme.name}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{theme.description}</p>
          {theme.findingIds.length > 0 && (
            <div className="flex gap-1 mt-1.5">
              {theme.findingIds.map((id) => (
                <Badge key={id} variant="outline" className="text-xs px-1.5 py-0 h-5">Q{id}</Badge>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InsightCard({
  insight,
  findings,
  onFeedback,
  onDrillDown,
}: {
  insight: RankedInsight;
  findings: Finding[];
  onFeedback?: (id: string, rating: -1 | 1, comment: string) => void;
  onDrillDown?: (finding: Finding) => void;
}) {
  const relatedFindings = findings.filter((f) => insight.supportingFindingIds.includes(f.questionId));

  return (
    <div className="flex gap-3 p-3 rounded-lg border bg-card hover:bg-accent/5 transition-colors">
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-sm font-bold">
        {insight.rank}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <p className="text-sm font-medium leading-snug flex-1">{insight.headline}</p>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {getImpactBadge(insight.impact)}
            {onFeedback && (
              <FindingFeedback
                findingId={`insight-${insight.rank}`}
                onSubmit={onFeedback}
              />
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{insight.detail}</p>
        {relatedFindings.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {relatedFindings.map((f) => (
              <button
                key={f.questionId}
                className="flex items-center gap-1 text-xs text-muted-foreground bg-muted rounded px-1.5 py-0.5 hover:bg-accent hover:text-foreground transition-colors"
                title="Click to drill down into this finding"
                onClick={() => onDrillDown?.(f)}
              >
                <ChevronRight className="h-3 w-3" />
                <span>{f.title}</span>
                <Badge
                  variant={f.confidence === "high" ? "default" : f.confidence === "medium" ? "secondary" : "outline"}
                  className="text-[10px] px-1 py-0 h-4 ml-0.5"
                >
                  {f.confidence}
                </Badge>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FurtherInvestigationCard({ item }: { item: { question: string; rationale: string } }) {
  return (
    <div className="flex gap-2 p-2.5 rounded-md border border-dashed bg-muted/30">
      <Search className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-medium">{item.question}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{item.rationale}</p>
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function ResearchReport({ report, findings, sessionId, onSubmitFeedback, onDrillDown }: ResearchReportProps) {
  const handleFindingFeedback = useCallback(
    (id: string, rating: -1 | 1, comment: string) => {
      if (!onSubmitFeedback) return;
      onSubmitFeedback("finding", id, rating, comment || null);
    },
    [onSubmitFeedback]
  );

  return (
    <div className="space-y-6 py-2">
      <ExecutiveSummary summary={report.executiveSummary} />

      {report.themes && report.themes.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Target className="h-4 w-4" />
            Key Themes
          </h3>
          <div className="grid gap-2">
            {report.themes.map((theme, i) => (
              <ThemeCard key={i} theme={theme} />
            ))}
          </div>
        </div>
      )}

      <Separator />

      {report.rankedInsights && report.rankedInsights.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-3">
            Ranked Insights ({report.rankedInsights.length})
          </h3>
          <div className="space-y-2">
            {report.rankedInsights.map((insight) => (
              <InsightCard
                key={insight.rank}
                insight={insight}
                findings={findings}
                onFeedback={onSubmitFeedback ? handleFindingFeedback : undefined}
                onDrillDown={onDrillDown}
              />
            ))}
          </div>
        </div>
      )}

      {report.furtherInvestigation && report.furtherInvestigation.length > 0 && (
        <>
          <Separator />
          <div>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Search className="h-4 w-4" />
              Suggested Further Investigation
            </h3>
            <div className="space-y-2">
              {report.furtherInvestigation.map((item, i) => (
                <FurtherInvestigationCard key={i} item={item} />
              ))}
            </div>
          </div>
        </>
      )}

      {report.generatedAt && (
        <p className="text-xs text-muted-foreground text-right">
          Report generated {new Date(report.generatedAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}
