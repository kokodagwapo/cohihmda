/**
 * AgentTimeline
 *
 * Vertical timeline showing each step of the research investigation.
 * Steps include agent thinking, SQL generation, query execution, analysis,
 * findings, user steering, pause/resume events, and inline step feedback.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Brain,
  Database,
  Search,
  CheckCircle2,
  AlertCircle,
  MessageSquare,
  ChevronDown,
  ChevronRight,
  Lightbulb,
  Play,
  Loader2,
  User,
  Code,
  BarChart3,
  Pause,
  PlayCircle,
  ThumbsUp,
  ThumbsDown,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useDebugMode } from "@/contexts/DebugModeContext";
import type { AgentEvent } from "@/hooks/useResearchSession";

// ============================================================================
// Types
// ============================================================================

interface AgentTimelineProps {
  events: AgentEvent[];
  isRunning: boolean;
  isPaused?: boolean;
  sessionId?: string | null;
  onSelectEvent?: (event: AgentEvent) => void;
  onSubmitFeedback?: (targetType: "step" | "finding" | "session", targetId: string | null, rating: -1 | 1 | null, comment: string | null, context?: any) => void;
}

// ============================================================================
// Event Icon + Color + Label Mapping
// ============================================================================

function getEventIcon(type: string) {
  switch (type) {
    case "phase": return <Play className="h-4 w-4" />;
    case "plan": return <Lightbulb className="h-4 w-4" />;
    case "agent_start": return <Search className="h-4 w-4" />;
    case "agent_thinking": return <Brain className="h-4 w-4" />;
    case "agent_sql_generated": return <Code className="h-4 w-4" />;
    case "agent_sql_executed": return <Database className="h-4 w-4" />;
    case "agent_finding": return <CheckCircle2 className="h-4 w-4" />;
    case "agent_complete": return <CheckCircle2 className="h-4 w-4" />;
    case "agent_error": return <AlertCircle className="h-4 w-4" />;
    case "synthesis": return <BarChart3 className="h-4 w-4" />;
    case "user_steer": return <User className="h-4 w-4" />;
    case "user_followup": return <User className="h-4 w-4" />;
    case "paused": return <Pause className="h-4 w-4" />;
    case "resumed": return <PlayCircle className="h-4 w-4" />;
    case "complete": return <CheckCircle2 className="h-4 w-4" />;
    case "error": return <AlertCircle className="h-4 w-4" />;
    default: return <MessageSquare className="h-4 w-4" />;
  }
}

function getEventColor(type: string): string {
  switch (type) {
    case "phase": return "text-blue-500";
    case "plan": return "text-purple-500";
    case "agent_start": return "text-sky-500";
    case "agent_thinking": return "text-amber-500";
    case "agent_sql_generated": return "text-indigo-500";
    case "agent_sql_executed": return "text-emerald-500";
    case "agent_finding": return "text-green-600";
    case "agent_complete": return "text-green-600";
    case "agent_error": case "error": return "text-red-500";
    case "synthesis": return "text-violet-600";
    case "user_steer": case "user_followup": return "text-orange-500";
    case "paused": return "text-yellow-600";
    case "resumed": return "text-blue-500";
    case "complete": return "text-green-700";
    default: return "text-muted-foreground";
  }
}

function getEventLabel(type: string): string {
  switch (type) {
    case "phase": return "Phase";
    case "plan": return "Research Plan";
    case "agent_start": return "Agent Started";
    case "agent_thinking": return "Thinking";
    case "agent_sql_generated": return "SQL Generated";
    case "agent_sql_executed": return "Query Executed";
    case "agent_finding": return "Finding";
    case "agent_complete": return "Agent Complete";
    case "agent_error": return "Agent Error";
    case "synthesis": return "Synthesis Report";
    case "user_steer": return "User Direction";
    case "user_followup": return "Follow-up Question";
    case "paused": return "Paused";
    case "resumed": return "Resumed";
    case "complete": return "Complete";
    case "error": return "Error";
    case "heartbeat": return "Connected";
    default: return type;
  }
}

// ============================================================================
// Step Feedback Inline
// ============================================================================

function StepFeedback({
  eventIndex,
  onSubmit,
}: {
  eventIndex: number;
  onSubmit: (rating: -1 | 1, comment: string) => void;
}) {
  const [active, setActive] = useState(false);
  const [rating, setRating] = useState<-1 | 1 | null>(null);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);

  if (submitted) {
    return (
      <span className="text-[10px] text-muted-foreground ml-2">Feedback saved</span>
    );
  }

  if (!active) {
    return (
      <div className="inline-flex items-center gap-0.5 ml-2 opacity-0 group-hover/step:opacity-100 transition-opacity">
        <button
          className="p-0.5 rounded hover:bg-muted"
          title="Good step"
          onClick={(e) => { e.stopPropagation(); setRating(1); setActive(true); }}
        >
          <ThumbsUp className="h-3 w-3 text-muted-foreground" />
        </button>
        <button
          className="p-0.5 rounded hover:bg-muted"
          title="Bad step"
          onClick={(e) => { e.stopPropagation(); setRating(-1); setActive(true); }}
        >
          <ThumbsDown className="h-3 w-3 text-muted-foreground" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 mt-1" onClick={(e) => e.stopPropagation()}>
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
            onSubmit(rating, comment);
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
            onSubmit(rating, comment);
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
// Timeline Event Item
// ============================================================================

function TimelineEvent({
  event,
  eventIndex,
  isLast,
  onSelect,
  onStepFeedback,
}: {
  event: AgentEvent;
  eventIndex: number;
  isLast: boolean;
  onSelect?: () => void;
  onStepFeedback?: (index: number, rating: -1 | 1, comment: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const hasExpandableContent = eventHasDetail(event);
  const time = new Date(event.timestamp);
  const timeStr = time.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  if (event.type === "heartbeat") return null;

  const showFeedback = [
    "agent_thinking",
    "agent_sql_generated",
    "agent_sql_executed",
    "agent_finding",
  ].includes(event.type);

  return (
    <div className="relative flex gap-3 pb-4 group/step">
      {!isLast && (
        <div className="absolute left-[15px] top-8 bottom-0 w-px bg-border" />
      )}

      <div
        className={cn(
          "flex-shrink-0 w-8 h-8 rounded-full border-2 flex items-center justify-center bg-background z-10",
          getEventColor(event.type)
        )}
      >
        {getEventIcon(event.type)}
      </div>

      <div className="flex-1 min-w-0">
        <Collapsible open={open} onOpenChange={setOpen}>
          <div className="flex items-start gap-2">
            <CollapsibleTrigger
              className={cn(
                "flex items-center gap-1.5 text-sm font-medium hover:underline text-left",
                !hasExpandableContent && "cursor-default hover:no-underline"
              )}
              disabled={!hasExpandableContent}
              onClick={() => onSelect?.()}
            >
              {hasExpandableContent &&
                (open ? (
                  <ChevronDown className="h-3.5 w-3.5 flex-shrink-0" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 flex-shrink-0" />
                ))}
              <span>{getEventLabel(event.type)}</span>
            </CollapsibleTrigger>

            {event.data?.questionId && (
              <Badge variant="outline" className="text-xs px-1.5 py-0 h-5">
                Q{event.data.questionId}
              </Badge>
            )}
            {event.data?.confidence && (
              <Badge
                variant={
                  event.data.confidence === "high"
                    ? "default"
                    : event.data.confidence === "medium"
                    ? "secondary"
                    : "outline"
                }
                className="text-xs px-1.5 py-0 h-5"
              >
                {event.data.confidence}
              </Badge>
            )}

            {/* Inline step feedback */}
            {showFeedback && onStepFeedback && (
              <StepFeedback
                eventIndex={eventIndex}
                onSubmit={(rating, comment) => onStepFeedback(eventIndex, rating, comment)}
              />
            )}

            <span className="text-xs text-muted-foreground ml-auto flex-shrink-0">
              {timeStr}
            </span>
          </div>

          <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">
            {getEventSummary(event)}
          </p>

          {hasExpandableContent && (
            <CollapsibleContent className="mt-2">
              <EventDetail event={event} />
            </CollapsibleContent>
          )}
        </Collapsible>
      </div>
    </div>
  );
}

// ============================================================================
// Event Detail Renderers
// ============================================================================

function eventHasDetail(event: AgentEvent): boolean {
  return [
    "plan", "agent_thinking", "agent_sql_generated", "agent_sql_executed",
    "agent_finding", "synthesis", "error", "agent_error",
  ].includes(event.type);
}

function getEventSummary(event: AgentEvent): string {
  switch (event.type) {
    case "phase": return event.data?.message || "";
    case "plan": return `${event.data?.questions?.length || 0} investigation questions planned`;
    case "agent_start": return event.data?.topic || "";
    case "agent_thinking":
      return (event.data?.content || "").substring(0, 120) + (event.data?.content?.length > 120 ? "..." : "");
    case "agent_sql_generated": return event.data?.content || "Query generated";
    case "agent_sql_executed": return event.data?.content || "Query executed";
    case "agent_finding":
      try {
        const f = JSON.parse(event.data?.content);
        return f.title || f.summary?.substring(0, 100) || "Finding reported";
      } catch { return "Finding reported"; }
    case "agent_complete": return `${event.data?.title || "Question"} — ${event.data?.confidence || "unknown"} confidence`;
    case "synthesis": return event.data?.executiveSummary?.substring(0, 150) || "Report generated";
    case "user_steer": return event.data?.message || "";
    case "user_followup": return event.data?.question || "";
    case "paused": return "Investigation paused — waiting for user";
    case "resumed": return "Investigation resumed";
    case "complete": return event.data?.message || "Investigation complete";
    case "error": case "agent_error": return event.data?.message || event.data?.error || "An error occurred";
    default: return "";
  }
}

function EventDetail({ event }: { event: AgentEvent }) {
  const { isDebugMode } = useDebugMode();
  switch (event.type) {
    case "plan": return <PlanDetail plan={event.data} />;
    case "agent_thinking":
      return <div className="bg-muted/50 rounded-md p-3 text-sm whitespace-pre-wrap">{event.data?.content}</div>;
    case "agent_sql_generated":
      return (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{event.data?.content}</p>
          {isDebugMode && event.data?.sql && (
            <pre className="bg-muted rounded-md p-3 text-xs overflow-x-auto font-mono">{event.data.sql}</pre>
          )}
        </div>
      );
    case "agent_sql_executed":
      return (
        <div className="space-y-2">
          <p className="text-sm">{event.data?.content}</p>
          {event.data?.result?.rows && event.data.result.rows.length > 0 && (
            <QueryResultTable fields={event.data.result.fields} rows={event.data.result.rows} />
          )}
        </div>
      );
    case "agent_finding":
      try {
        const finding = JSON.parse(event.data?.content);
        return <FindingDetail finding={finding} />;
      } catch {
        return <div className="text-sm text-muted-foreground">{event.data?.content}</div>;
      }
    case "synthesis": return null;
    case "error": case "agent_error":
      return <div className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">{event.data?.message || event.data?.error}</div>;
    default: return null;
  }
}

function PlanDetail({ plan }: { plan: any }) {
  return (
    <div className="space-y-2">
      <p className="text-sm">{plan.summary}</p>
      <div className="space-y-1.5">
        {plan.questions?.map((q: any) => (
          <div key={q.id} className="flex items-start gap-2 bg-muted/50 rounded-md p-2">
            <Badge
              variant={q.priority === "high" ? "default" : q.priority === "medium" ? "secondary" : "outline"}
              className="text-xs mt-0.5 flex-shrink-0"
            >
              {q.priority}
            </Badge>
            <div className="min-w-0">
              <p className="text-sm font-medium">{q.topic}</p>
              <p className="text-xs text-muted-foreground">{q.hypothesis}</p>
            </div>
            <Badge variant="outline" className="text-xs flex-shrink-0 ml-auto">{q.category}</Badge>
          </div>
        ))}
      </div>
    </div>
  );
}

function FindingDetail({ finding }: { finding: any }) {
  return (
    <div className="space-y-2 bg-muted/50 rounded-md p-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{finding.title}</span>
        <Badge
          variant={finding.confidence === "high" ? "default" : finding.confidence === "medium" ? "secondary" : "outline"}
          className="text-xs"
        >
          {finding.confidence}
        </Badge>
      </div>
      <p className="text-sm">{finding.summary}</p>
      {finding.keyMetrics && Object.keys(finding.keyMetrics).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(finding.keyMetrics).map(([key, value]) => (
            <div key={key} className="bg-background rounded px-2 py-1 text-xs">
              <span className="text-muted-foreground">{key}:</span>{" "}
              <span className="font-medium">{String(value)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function QueryResultTable({ fields, rows }: { fields: string[]; rows: Record<string, any>[] }) {
  const displayRows = rows.slice(0, 10);
  return (
    <div className="border rounded-md overflow-x-auto max-h-60">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b bg-muted/50">
            {fields.map((f) => (
              <th key={f} className="px-2 py-1.5 text-left font-medium whitespace-nowrap">{f}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {displayRows.map((row, i) => (
            <tr key={i} className="border-b last:border-b-0">
              {fields.map((f) => (
                <td key={f} className="px-2 py-1 whitespace-nowrap max-w-[200px] truncate">
                  {row[f] == null ? <span className="text-muted-foreground">NULL</span> : String(row[f])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 10 && (
        <div className="px-2 py-1 text-xs text-muted-foreground bg-muted/30 border-t">
          Showing 10 of {rows.length} rows
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function AgentTimeline({
  events,
  isRunning,
  isPaused,
  sessionId,
  onSelectEvent,
  onSubmitFeedback,
}: AgentTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events.length]);

  const handleStepFeedback = useCallback(
    (eventIndex: number, rating: -1 | 1, comment: string) => {
      if (!onSubmitFeedback) return;
      const event = events[eventIndex];
      const context = {
        eventType: event.type,
        questionId: event.data?.questionId,
        content: event.data?.content?.substring(0, 500),
        sql: event.data?.sql?.substring(0, 500),
      };
      onSubmitFeedback("step", `event-${eventIndex}`, rating, comment || null, context);
    },
    [events, onSubmitFeedback]
  );

  const visibleEvents = events.filter((e) => e.type !== "heartbeat");

  if (visibleEvents.length === 0 && !isRunning) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground py-12">
        <Search className="h-8 w-8 mb-3 opacity-50" />
        <p className="text-sm">Start an investigation to see the agent timeline</p>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="overflow-y-auto h-full px-4 py-3">
      {visibleEvents.map((event, i) => (
        <TimelineEvent
          key={`${event.timestamp}-${i}`}
          event={event}
          eventIndex={events.indexOf(event)}
          isLast={i === visibleEvents.length - 1 && !isRunning}
          onSelect={() => onSelectEvent?.(event)}
          onStepFeedback={onSubmitFeedback ? handleStepFeedback : undefined}
        />
      ))}

      {isRunning && (
        <div className="flex items-center gap-2 pl-[15px] text-sm text-muted-foreground">
          {isPaused ? (
            <>
              <Pause className="h-4 w-4 text-yellow-600" />
              <span>Investigation paused...</span>
            </>
          ) : (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Agents working...</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
