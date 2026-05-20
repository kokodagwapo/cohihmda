/**
 * ResearchAnalyst Page
 *
 * Full-featured research analyst page with:
 *   - Session history sidebar (collapsible)
 *   - Pause/Resume controls + auto-pause on steering focus
 *   - Follow-up chat after investigation completes
 *   - Session-level feedback
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { useDashboardVisibility } from "@/hooks/useDashboardVisibility";
import type { ReportData } from "@/data/reportSimulations";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantStore } from "@/stores/tenantStore";
import { useResearchSession } from "@/hooks/useResearchSession";
import { useResearchInsightTracking } from "@/hooks/useResearchInsightTracking";
import { api } from "@/lib/api";
import { AgentTimeline } from "@/components/research/AgentTimeline";
import { ResearchReport, QuickAnswerView } from "@/components/research/ResearchReport";
import { FindingDrillDown } from "@/components/research/FindingDrillDown";
import { SaveToWorkbenchModal, type SaveToWorkbenchPayload } from "@/components/research/SaveToWorkbenchModal";
import type { Finding, ResearchMode } from "@/hooks/useResearchSession";
import {
  Play,
  SendHorizontal,
  RotateCcw,
  Loader2,
  Sparkles,
  AlertCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  PlayCircle,
  Trash2,
  Clock,
  ThumbsUp,
  ThumbsDown,
  MessageSquarePlus,
  Share2,
  ChevronDown,
  ChevronUp,
  Database,
  Check,
  Upload,
  X,
} from "lucide-react";
import { RESEARCH_TOPIC_SUGGESTIONS } from "@/lib/unifiedChatSuggestedPrompts";
import { ExportMenu } from "@/components/common/ExportMenu";
import { UserSharePicker } from "@/components/common/UserSharePicker";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTutorial } from "@/contexts/TutorialContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useResearchUploads } from "@/hooks/useResearchUploads";
import { DatasetAttachmentStrip } from "@/components/research/DatasetAttachmentBadge";
import { UploadDropZone } from "@/components/research/UploadDropZone";
import { FindingSummaryContent } from "@/components/research/FindingSummaryContent";
// ============================================================================
// Phase Badge
// ============================================================================

function PhaseBadge({ phase }: { phase: string }) {
  const config: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
    idle: { label: "Ready", variant: "outline" },
    creating: { label: "Creating...", variant: "secondary" },
    planning: { label: "Planning", variant: "secondary" },
    investigating: { label: "Investigating", variant: "default" },
    synthesizing: { label: "Synthesizing", variant: "default" },
    followup: { label: "Follow-up", variant: "default" },
    complete: { label: "Complete", variant: "outline" },
    error: { label: "Error", variant: "destructive" },
  };

  const c = config[phase] || { label: phase, variant: "outline" as const };
  return <Badge variant={c.variant}>{c.label}</Badge>;
}

// ============================================================================
// Session Sidebar
// ============================================================================

function SessionSidebar({
  sessions,
  currentSessionId,
  onSelect,
  onDelete,
  onNew,
  collapsed,
  onToggle,
}: {
  sessions: Array<{ id: string; topic: string | null; phase: string; primaryCategory?: string | null; createdAt: string; updatedAt: string; isOwner?: boolean }>;
  currentSessionId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const isRunningPhase = (phase: string) =>
    phase === "planning" || phase === "investigating" || phase === "synthesizing" || phase === "followup";
  const [search, setSearch] = useState("");
  const searchLower = search.trim().toLowerCase();
  const matchesSearch = (s: { topic: string | null }) =>
    !searchLower || (s.topic?.toLowerCase().includes(searchLower) ?? false);
  const mySessions = sessions.filter((s) => s.isOwner !== false).filter(matchesSearch);
  const sharedWithMe = sessions.filter((s) => s.isOwner === false).filter(matchesSearch);

  if (collapsed) {
    return (
      <div className="border-r flex flex-col items-center py-3 px-1 gap-2" data-tour="research-sessions">
        <Button variant="ghost" size="icon" onClick={onToggle} className="h-8 w-8">
          <PanelLeftOpen className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={onNew} className="h-8 w-8">
          <MessageSquarePlus className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="border-r w-64 flex flex-col flex-shrink-0" data-tour="research-sessions">
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Sessions</span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={onNew} className="h-7 w-7">
            <MessageSquarePlus className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onToggle} className="h-7 w-7">
            <PanelLeftClose className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <div className="px-2 py-1.5 border-b">
        <Input
          type="search"
          placeholder="Search sessions..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 text-xs"
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        {sessions.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">No sessions yet</p>
        ) : mySessions.length === 0 && sharedWithMe.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">No sessions match your search</p>
        ) : (
          <>
            {mySessions.length > 0 && (
              <div className="px-2 pt-2 pb-1">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">My sessions</span>
              </div>
            )}
            {mySessions.map((s) => (
              <div
                key={s.id}
                className={cn(
                  "group flex items-start gap-2 px-3 py-2.5 cursor-pointer hover:bg-accent/50 transition-colors border-b border-transparent",
                  currentSessionId === s.id && "bg-accent"
                )}
                onClick={() => onSelect(s.id)}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium line-clamp-2">{s.topic || "Open Analysis"}</p>
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    {s.primaryCategory && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 capitalize">
                        {s.primaryCategory}
                      </Badge>
                    )}
                    <PhaseBadge phase={s.phase} />
                    {isRunningPhase(s.phase) && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                    <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                      <Clock className="h-2.5 w-2.5" />
                      {new Date(s.updatedAt || s.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 opacity-0 group-hover:opacity-100 flex-shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(s.id);
                  }}
                >
                  <Trash2 className="h-3 w-3 text-muted-foreground" />
                </Button>
              </div>
            ))}
            {sharedWithMe.length > 0 && (
              <div className="px-2 pt-3 pb-1">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Shared</span>
              </div>
            )}
            {sharedWithMe.map((s) => (
              <div
                key={s.id}
                className={cn(
                  "group flex items-start gap-2 px-3 py-2.5 cursor-pointer hover:bg-accent/50 transition-colors border-b border-transparent",
                  currentSessionId === s.id && "bg-accent"
                )}
                onClick={() => onSelect(s.id)}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium line-clamp-2">{s.topic || "Open Analysis"}</p>
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    {s.primaryCategory && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 capitalize">
                        {s.primaryCategory}
                      </Badge>
                    )}
                    <PhaseBadge phase={s.phase} />
                    {isRunningPhase(s.phase) && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                    <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                      <Clock className="h-2.5 w-2.5" />
                      {new Date(s.updatedAt || s.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Session-Level Feedback
// ============================================================================

function SessionFeedback({ onSubmit }: { onSubmit: (rating: -1 | 1, comment: string) => void }) {
  const [rating, setRating] = useState<-1 | 1 | null>(null);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [expanded, setExpanded] = useState(false);

  if (submitted) {
    return (
      <p className="text-xs text-muted-foreground">Thanks for your feedback!</p>
    );
  }

  if (!expanded) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground hover:text-foreground -ml-2"
        onClick={() => setExpanded(true)}
      >
        <MessageSquarePlus className="h-3.5 w-3.5 mr-1.5" />
        Give feedback on this report
      </Button>
    );
  }

  return (
    <Card>
      <CardContent className="pt-4 pb-3 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">How was this investigation?</p>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground"
            onClick={() => setExpanded(false)}
          >
            Collapse
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={rating === 1 ? "default" : "outline"}
            size="sm"
            onClick={() => setRating(1)}
          >
            <ThumbsUp className="h-3.5 w-3.5 mr-1" /> Helpful
          </Button>
          <Button
            variant={rating === -1 ? "destructive" : "outline"}
            size="sm"
            onClick={() => setRating(-1)}
          >
            <ThumbsDown className="h-3.5 w-3.5 mr-1" /> Not helpful
          </Button>
        </div>
        <Textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Any notes on what could be improved? (optional)"
          rows={2}
          className="text-sm"
        />
        <Button
          size="sm"
          disabled={rating === null}
          onClick={() => {
            if (rating !== null) {
              onSubmit(rating, comment);
              setSubmitted(true);
            }
          }}
        >
          Submit Feedback
        </Button>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Main Page
// ============================================================================

export default function ResearchAnalyst() {
  const { user } = useAuth();
  const { selectedTenantId } = useTenantStore();
  const effectiveTenantId = selectedTenantId || user?.tenant_id;
  const { dashboardVisibility, handleVisibilityChange } = useDashboardVisibility();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const {
    sessionId,
    phase,
    plan,
    findings,
    report,
    events,
    error,
    isRunning,
    isPaused,
    sessions: sessionList,
    sessionVisibility,
    sessionSharedWithUserIds,
    updateSessionSharing,
    startSession,
    runSession,
    steer,
    pause,
    resume,
    askFollowUp,
    loadSession,
    fetchSessions,
    deleteSession,
    submitFeedback,
    reset,
  } = useResearchSession(effectiveTenantId);

  const [topicInput, setTopicInput] = useState("");
  const [steerInput, setSteerInput] = useState("");
  const [researchMode, setResearchMode] = useState<ResearchMode>("quick");
  const [activeTab, setActiveTab] = useState<string>("timeline");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [drillDownFinding, setDrillDownFinding] = useState<Finding | null>(null);
  const [workbenchPayload, setWorkbenchPayload] = useState<SaveToWorkbenchPayload | null>(null);
  const steerInputRef = useRef<HTMLInputElement>(null);
  const lastReportRef = useRef<boolean>(false);
  const reportContainerRef = useRef<HTMLDivElement>(null);
  // Upload attachments for this session
  const {
    uploads: availableUploads,
    listUploads: listAvailableUploads,
    uploadFile,
    isUploading,
    uploadProgress,
    error: uploadError,
    setError: setUploadError,
  } = useResearchUploads(effectiveTenantId);
  const [attachedUploadIds, setAttachedUploadIds] = useState<string[]>([]);
  const [showUploadPanel, setShowUploadPanel] = useState(false);
  const attachedUploads = availableUploads.filter((u) => attachedUploadIds.includes(u.id));
  const currentSessionTopic = sessionList.find((s) => s.id === sessionId)?.topic ?? null;
  const { toast } = useToast();
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareDialogVisibility, setShareDialogVisibility] = useState<"private" | "shared" | "global">("private");
  const [shareDialogSharedIds, setShareDialogSharedIds] = useState<string[]>([]);
  const [shareDialogSaving, setShareDialogSaving] = useState(false);
  const [suggestionsExpanded, setSuggestionsExpanded] = useState(false);

  const { isTracked: isResearchInsightTracked, onToggleTrack: handleToggleTrackResearch } =
    useResearchInsightTracking(effectiveTenantId, sessionId);

  const [searchParams, setSearchParams] = useSearchParams();

  // Load sessions on mount
  useEffect(() => {
    fetchSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveTenantId]);

  // Auto-load session from ?session= query param (e.g., from "Move to Research Lab")
  const sessionParamHandled = useRef(false);
  useEffect(() => {
    if (sessionParamHandled.current) return;
    const sessionParam = searchParams.get("session");
    if (sessionParam) {
      sessionParamHandled.current = true;
      setSearchParams({}, { replace: true });
      runSession(sessionParam);
      // Tab will switch to report/findings when session data is available
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Refresh session list when a session completes
  useEffect(() => {
    if (phase === "complete" || phase === "error") {
      fetchSessions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Reset report tracking when a follow-up starts so the updated report auto-switches
  useEffect(() => {
    if (phase === "followup") {
      lastReportRef.current = false;
    }
  }, [phase]);

  // Switch to report tab when synthesis arrives (once per synthesis cycle)
  useEffect(() => {
    if (report && !lastReportRef.current) {
      lastReportRef.current = true;
      setActiveTab("report");
    } else if (!report && findings.length >= 1 && phase === "complete" && !lastReportRef.current) {
      lastReportRef.current = true;
      setActiveTab("report");
    }
  }, [report, findings.length, phase]);

  // Switch to findings tab when first finding arrives (so results are primary view during investigation)
  useEffect(() => {
    if (
      findings.length > 0 &&
      !report &&
      (phase === "investigating" || phase === "synthesizing")
    ) {
      setActiveTab("findings");
    }
  }, [findings.length, report, phase]);

  // Reset report tracking and drill-down when session changes
  useEffect(() => {
    lastReportRef.current = false;
    setDrillDownFinding(null);
  }, [sessionId]);

  // Start investigation
  const handleStart = useCallback(() => {
    const topic = topicInput.trim() || undefined;
    startSession(topic, undefined, researchMode, attachedUploadIds.length > 0 ? attachedUploadIds : undefined);
    setActiveTab("timeline");
    lastReportRef.current = false;
    setAttachedUploadIds([]);
    setShowUploadPanel(false);
  }, [topicInput, researchMode, startSession, attachedUploadIds]);

  // Send steering or follow-up
  const handleSend = useCallback(() => {
    const msg = steerInput.trim();
    if (!msg) return;

    if (isRunning) {
      steer(msg);
    } else if (phase === "complete") {
      askFollowUp(msg);
      setActiveTab("timeline");
    }

    setSteerInput("");
    steerInputRef.current?.focus();
  }, [steerInput, steer, isRunning, phase, askFollowUp]);

  // Auto-pause on focus
  const handleSteerFocus = useCallback(() => {
    if (isRunning && !isPaused) {
      pause();
    }
  }, [isRunning, isPaused, pause]);

  // Resume on blur without sending
  const handleSteerBlur = useCallback(() => {
    if (isRunning && isPaused && !steerInput.trim()) {
      resume();
    }
  }, [isRunning, isPaused, steerInput, resume]);

  // Handle Enter key
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (phase === "idle") {
          handleStart();
        } else {
          handleSend();
        }
      }
    },
    [phase, handleStart, handleSend]
  );

  const handleNewInvestigation = useCallback(() => {
    reset();
    setTopicInput("");
    setSteerInput("");
    setActiveTab("timeline");
    lastReportRef.current = false;
  }, [reset]);

  const handleLoadSession = useCallback(
    (id: string) => {
      loadSession(id);
      setActiveTab("timeline");
      lastReportRef.current = false;
    },
    [loadSession]
  );

  // Session-level feedback
  const handleSessionFeedback = useCallback(
    (rating: -1 | 1, comment: string) => {
      submitFeedback("session", null, rating, comment);
    },
    [submitFeedback]
  );

  // ── Tour: auto-load first session when tour advances past idle-state steps ──
  const { setTourStepHandler, activeTourId } = useTutorial();
  const tourSessionLoadedRef = useRef(false);

  useEffect(() => {
    if (activeTourId !== "research") {
      tourSessionLoadedRef.current = false;
      return;
    }

    setTourStepHandler((tourId, completedStepIndex) => {
      if (tourId !== "research") return;
      // Step 2 (0-indexed) = "Topic Suggestions" — load a session before showing timeline
      if (completedStepIndex === 2 && !tourSessionLoadedRef.current && sessionList.length > 0) {
        tourSessionLoadedRef.current = true;
        return new Promise<void>((resolve) => {
          loadSession(sessionList[0].id);
          setActiveTab("timeline");
          lastReportRef.current = false;
          // Give the UI time to render the session content
          setTimeout(resolve, 1200);
        });
      }
    });

    return () => setTourStepHandler(null);
  }, [activeTourId, sessionList, loadSession, setTourStepHandler]);

  // Show the bottom input bar when running OR when complete (for follow-ups)
  const showBottomInput = isRunning || phase === "complete";

  return (
    <DashboardLayout
      isAuthenticated={!!user}
      mobileMenuOpen={mobileMenuOpen}
      onMobileMenuToggle={() => setMobileMenuOpen((prev) => !prev)}
      dashboardVisibility={dashboardVisibility}
      onVisibilityChange={handleVisibilityChange}
      onReportClick={(_report: ReportData) => {}}
    >
      <div className="h-[calc(100vh-4rem)] overflow-hidden bg-background flex flex-col">
      {/* Body: Session panel + Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Inline collapsible session panel */}
        <SessionSidebar
          sessions={sessionList}
          currentSessionId={sessionId}
          onSelect={handleLoadSession}
          onDelete={deleteSession}
          onNew={handleNewInvestigation}
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((p) => !p)}
        />

        {/* Main Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {phase === "idle" ? (
            /* ── Idle: Topic Input + Mode ── */
            <div className="flex-1 overflow-y-auto p-8">
              <div className="max-w-xl w-full space-y-6 mx-auto">
                <div className="text-center space-y-2">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-2">
                    <Sparkles className="h-8 w-8 text-primary" />
                  </div>
                  <h2 className="text-2xl font-semibold">Research Lab</h2>
                  <p className="text-muted-foreground">
                    Get a quick answer or run a full multi-agent investigation on your loan data.
                  </p>
                </div>

                <Card>
                  <CardContent className="pt-6 space-y-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1" />
                      <Button
                        type="button"
                        variant={researchMode === "deep" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setResearchMode(researchMode === "deep" ? "quick" : "deep")}
                      >
                        {researchMode === "deep" ? "Deep Analysis ✓" : "Deep Analysis"}
                      </Button>
                    </div>
                    {researchMode === "deep" && (
                      <p className="text-xs text-muted-foreground">
                        Full plan + multiple agents + synthesis. Best for: exploratory questions and comprehensive reports.
                      </p>
                    )}

                    <div data-tour="research-input">
                      <label className="text-sm font-medium mb-1.5 block">
                        {researchMode === "quick" ? "Your question" : "Investigation topic (optional)"}
                      </label>
                      <div className="flex gap-2">
                        <Input
                          value={topicInput}
                          onChange={(e) => setTopicInput(e.target.value)}
                          placeholder={
                            researchMode === "quick"
                              ? "e.g., What's our YTD pull-through? or Show top 10 LOs by volume"
                              : "e.g., Why is pull-through declining? or leave blank for comprehensive analysis"
                          }
                          onKeyDown={handleKeyDown}
                          className="flex-1"
                        />
                        <Button onClick={handleStart} disabled={isRunning}>
                          <Play className="h-4 w-4 mr-1.5" />
                          {researchMode === "quick" ? "Get answer" : "Investigate"}
                        </Button>
                      </div>

                      {/* CSV Upload + attachment area */}
                      <div className="mt-3 space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          {/* Primary Upload CSV button — toggles the drop zone panel */}
                          <button
                            type="button"
                            onClick={() => { setShowUploadPanel((v) => !v); if (!showUploadPanel) listAvailableUploads(); }}
                            className={cn(
                              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors",
                              showUploadPanel
                                ? "border-emerald-400 dark:border-emerald-600 text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/30"
                                : "border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-400 dark:hover:border-slate-500"
                            )}
                          >
                            <Upload className="h-3.5 w-3.5" />
                            {attachedUploadIds.length > 0
                              ? `${attachedUploadIds.length} CSV${attachedUploadIds.length > 1 ? "s" : ""} attached`
                              : "Upload CSV"}
                          </button>
                        </div>

                        {/* Attached dataset badges */}
                        {attachedUploads.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {attachedUploads.map((u) => (
                              <span
                                key={u.id}
                                className="inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-700 dark:text-emerald-300"
                              >
                                <Database className="h-3 w-3 flex-shrink-0" />
                                <span className="max-w-[160px] truncate">{u.originalFileName}</span>
                                <span className="text-emerald-500/70">{u.rowCount.toLocaleString()}r</span>
                                <button
                                  type="button"
                                  onClick={() => setAttachedUploadIds((prev) => prev.filter((i) => i !== u.id))}
                                  className="ml-0.5 rounded-full p-0.5 hover:bg-emerald-200 dark:hover:bg-emerald-800 transition-colors"
                                >
                                  <X className="h-2.5 w-2.5" />
                                </button>
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Upload panel: drop zone + existing uploads list */}
                        {showUploadPanel && (
                          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30 p-3 space-y-3">
                            {/* Drag-and-drop zone with file size info */}
                            <UploadDropZone
                              onFileSelected={async (file) => {
                                setUploadError(null);
                                const result = await uploadFile(file);
                                if (result) {
                                  setAttachedUploadIds((prev) => [...prev, result.id]);
                                }
                              }}
                              isUploading={isUploading}
                              uploadProgress={uploadProgress}
                            />

                            {uploadError && (
                              <div className="flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 px-3 py-2">
                                <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                                <p className="text-xs text-red-700 dark:text-red-400">{uploadError}</p>
                              </div>
                            )}

                            {/* Previously uploaded files */}
                            {availableUploads.length > 0 && (
                              <div className="space-y-1">
                                <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide px-1">Your uploads</p>
                                {availableUploads.map((u) => (
                                  <button
                                    key={u.id}
                                    onClick={() => setAttachedUploadIds((prev) =>
                                      prev.includes(u.id) ? prev.filter((i) => i !== u.id) : [...prev, u.id]
                                    )}
                                    className={cn(
                                      "w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded-lg transition-colors text-left",
                                      attachedUploadIds.includes(u.id)
                                        ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                                        : "hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300"
                                    )}
                                  >
                                    <Database className="w-3.5 h-3.5 flex-shrink-0" />
                                    <span className="flex-1 truncate">{u.originalFileName}</span>
                                    <span className="text-slate-400 tabular-nums">{u.rowCount.toLocaleString()} rows</span>
                                    {attachedUploadIds.includes(u.id) && <Check className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    <Separator />

                    <div data-tour="research-suggestions">
                      <p className="text-xs text-muted-foreground mb-2">Or try one of these:</p>
                      <div className="flex flex-wrap gap-1.5">
                        {RESEARCH_TOPIC_SUGGESTIONS.map((topic) => (
                          <button
                            key={topic}
                            onClick={() => setTopicInput(topic)}
                            className="text-xs bg-muted hover:bg-accent rounded-full px-3 py-1.5 transition-colors text-left"
                          >
                            {topic}
                          </button>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <p className="text-xs text-muted-foreground text-center">
                  {researchMode === "deep"
                    ? "You can pause, steer, and ask follow-ups during the investigation."
                    : "Click Deep Analysis for a full multi-agent investigation."}
                </p>
              </div>
            </div>
          ) : (
            /* ── Active Investigation ── */
            <div className="flex-1 flex flex-col overflow-hidden">
              <Tabs
                value={activeTab}
                onValueChange={setActiveTab}
                className="flex-1 flex flex-col overflow-hidden"
              >
                <div className="px-6 pt-2 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <TabsList>
                      <TabsTrigger value="timeline" className="relative">
                        Timeline
                        {isRunning && <Loader2 className="h-3 w-3 ml-1.5 animate-spin" />}
                      </TabsTrigger>
                      <TabsTrigger value="findings" disabled={findings.length === 0}>
                        Findings ({findings.length})
                      </TabsTrigger>
                      <TabsTrigger
                        value="report"
                        disabled={!report && !(findings.length >= 1 && phase === "complete")}
                      >
                        Report
                      </TabsTrigger>
                    </TabsList>
                    <PhaseBadge phase={phase} />
                  </div>
                  <div className="flex items-center gap-2">
                    {sessionId && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        data-tour="research-share"
                        onClick={() => {
                          setShareDialogVisibility(
                            sessionVisibility === "global" ? "global" :
                            sessionVisibility === "shared" ? "shared" : "private"
                          );
                          setShareDialogSharedIds([...sessionSharedWithUserIds]);
                          setShareDialogOpen(true);
                        }}
                      >
                        <Share2 className="w-4 h-4" />
                        Share
                      </Button>
                    )}
                    {report && (
                      <div data-tour="research-export">
                      <ExportMenu
                        title={currentSessionTopic ? `Research Report - ${currentSessionTopic}` : "Research Report"}
                        targetRef={reportContainerRef}
                        getExportData={() => ({
                          title: currentSessionTopic ? `Research Report - ${currentSessionTopic}` : "Research Report",
                          tables: report
                            ? [
                                {
                                  name: "Executive Summary",
                                  headers: ["Section", "Content"],
                                  rows: [["Summary", report.executiveSummary || ""]],
                                },
                                ...(report.rankedInsights?.length
                                  ? [
                                      {
                                        name: "Insights",
                                        headers: ["Rank", "Headline", "Detail", "Impact"],
                                        rows: report.rankedInsights.map((insight) => [
                                          insight.rank,
                                          insight.headline || "",
                                          insight.detail || "",
                                          insight.impact || "",
                                        ]),
                                      },
                                    ]
                                  : []),
                              ]
                            : [],
                        })}
                      />
                      </div>
                    )}
                    <Button variant="outline" size="sm" onClick={handleNewInvestigation}>
                      <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                      New Investigation
                    </Button>
                  </div>
                </div>

                {/* Timeline Tab */}
                <TabsContent value="timeline" className="flex-1 overflow-hidden m-0 px-6 pb-0" data-tour="research-timeline">
                  <AgentTimeline
                    events={events}
                    isRunning={isRunning}
                    isPaused={isPaused}
                    sessionId={sessionId}
                    totalQuestions={plan?.questions?.length}
                    onSubmitFeedback={submitFeedback}
                  />
                </TabsContent>

              {/* Findings Tab */}
              <TabsContent value="findings" className="flex-1 overflow-y-auto m-0 px-6 pb-4" data-tour="research-findings">
                {drillDownFinding ? (
                  <div className="py-3">
                    <FindingDrillDown
                      finding={drillDownFinding}
                      onClose={() => setDrillDownFinding(null)}
                      sessionId={sessionId}
                    />
                  </div>
                ) : (
                  <div className="space-y-3 py-3">
                    {findings.map((f, i) => (
                      <Card
                        key={i}
                        className="cursor-pointer hover:border-primary/50 hover:shadow-sm transition-all"
                        onClick={() => setDrillDownFinding(f)}
                      >
                        <CardContent className="pt-4 pb-3">
                          <div className="flex items-start gap-2 mb-2">
                            <h4 className="text-sm font-semibold flex-1">{f.title}</h4>
                            <Badge
                              variant={f.confidence === "high" ? "default" : f.confidence === "medium" ? "secondary" : "outline"}
                              className="text-xs"
                            >
                              {f.confidence}
                            </Badge>
                          </div>
                          <FindingSummaryContent summary={f.summary} preferredBullets={f.summary_bullets} />
                          {Object.keys(f.keyMetrics).length > 0 && (
                            <div className="flex flex-wrap gap-2 mt-2">
                              {Object.entries(f.keyMetrics).map(([k, v]) => (
                                <div key={k} className="bg-muted rounded px-2 py-1 text-xs">
                                  <span className="text-muted-foreground">{k}:</span>{" "}
                                  <span className="font-medium">{String(v)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          <p className="text-xs text-muted-foreground mt-2">
                            {f.evidence.length} query(ies) executed — click to drill down
                          </p>
                        </CardContent>
                      </Card>
                    ))}
                    {findings.length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-8">
                        No findings yet — agents are still investigating.
                      </p>
                    )}
                  </div>
                )}
              </TabsContent>

                {/* Report Tab */}
                <TabsContent value="report" className="flex-1 overflow-y-auto m-0 px-6 pb-4" data-tour="research-report">
                  {report ? (
                    <div ref={reportContainerRef} className="space-y-4 py-2">
                      <ResearchReport
                        report={report}
                        findings={findings}
                        sessionId={sessionId}
                        selectedTenantId={effectiveTenantId}
                        onSubmitFeedback={submitFeedback}
                        onDrillDown={(f) => {
                          setDrillDownFinding(f);
                          setActiveTab("findings");
                        }}
                        isTracked={isResearchInsightTracked}
                        onToggleTrack={handleToggleTrackResearch}
                        onRunFurtherInvestigation={(question) => {
                          reset();
                          setTopicInput(question);
                          lastReportRef.current = false;
                          startSession(question, undefined, "deep");
                          setActiveTab("timeline");
                        }}
                      />
                      {phase === "complete" && (
                        <SessionFeedback onSubmit={handleSessionFeedback} />
                      )}
                    </div>
                  ) : findings.length >= 1 && phase === "complete" ? (
                    <div className="space-y-4 py-2">
                      <QuickAnswerView
                        finding={findings[findings.length - 1]}
                        onDrillDown={(f) => {
                          setDrillDownFinding(f);
                          setActiveTab("findings");
                        }}
                        onSaveToWorkbench={setWorkbenchPayload}
                        sessionId={sessionId}
                      />
                      <SessionFeedback onSubmit={handleSessionFeedback} />
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                      <Loader2 className="h-6 w-6 animate-spin mb-2" />
                      <p className="text-sm">Waiting for synthesis...</p>
                    </div>
                  )}
                </TabsContent>
              </Tabs>

              {/* Error Banner */}
              {error && (
                <div className="mx-6 mb-2 flex items-center gap-2 bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
                  <AlertCircle className="h-4 w-4 flex-shrink-0" />
                  {error}
                </div>
              )}

              {/* Bottom Input Bar: Steering (running) or Follow-up (complete) */}
              {showBottomInput && (
                <div
                  className={cn(
                    "border-t px-6 py-3",
                    phase === "complete" && "bg-muted/40"
                  )}
                  data-tour="research-followup"
                >
                  {phase === "complete" && (
                    <p className="text-sm font-medium text-foreground mb-2">
                      Continue the conversation
                    </p>
                  )}
                  <div className="flex gap-2 max-w-2xl">
                    {isRunning && (
                      isPaused ? (
                        <Button variant="outline" size="sm" onClick={resume}>
                          <PlayCircle className="h-3.5 w-3.5 mr-1.5" />
                          Resume
                        </Button>
                      ) : (
                        <Button variant="outline" size="sm" onClick={pause}>
                          <Pause className="h-3.5 w-3.5 mr-1.5" />
                          Pause
                        </Button>
                      )
                    )}
                    <Input
                      ref={steerInputRef}
                      value={steerInput}
                      onChange={(e) => setSteerInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      onFocus={handleSteerFocus}
                      onBlur={handleSteerBlur}
                      placeholder={
                        phase === "complete"
                          ? "Ask a follow-up question..."
                          : "Steer the investigation... e.g., 'Focus more on FHA loans'"
                      }
                      className="flex-1"
                    />
                    <Button onClick={handleSend} disabled={!steerInput.trim()} size="sm">
                      <SendHorizontal className="h-4 w-4" />
                    </Button>
                  </div>
                  {phase === "complete" && report?.furtherInvestigation && report.furtherInvestigation.length > 0 && (
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={() => setSuggestionsExpanded(v => !v)}
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {suggestionsExpanded
                          ? <ChevronUp className="h-3 w-3" />
                          : <ChevronDown className="h-3 w-3" />
                        }
                        {suggestionsExpanded ? "Hide" : "Suggested follow-ups"} ({report.furtherInvestigation.length})
                      </button>
                      {suggestionsExpanded && (
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          {report.furtherInvestigation.map((item, i) => (
                            <Badge
                              key={i}
                              variant="secondary"
                              className="cursor-pointer hover:bg-primary/20 hover:text-primary transition-colors py-1 px-2 text-xs font-normal"
                              onClick={() => {
                                reset();
                                setTopicInput(item.question);
                                lastReportRef.current = false;
                                startSession(item.question);
                                setActiveTab("timeline");
                                setSuggestionsExpanded(false);
                              }}
                            >
                              {item.question}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    {phase === "complete"
                      ? "Ask a follow-up and the agent will investigate using the existing context."
                      : isPaused
                      ? "Investigation paused. Send a message or click Resume to continue."
                      : "Your directions will be incorporated at the agents' next iteration."
                    }
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <Dialog open={shareDialogOpen} onOpenChange={setShareDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Share2 className="h-4 w-4" />
              Share session
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <UserSharePicker
              visibility={shareDialogVisibility}
              sharedWithUserIds={shareDialogSharedIds}
              onVisibilityChange={setShareDialogVisibility}
              onSharedWithUserIdsChange={setShareDialogSharedIds}
              allowGlobal={['super_admin', 'platform_admin', 'tenant_admin'].includes(user?.role || '')}
            />
            <Button
              className="w-full"
              disabled={shareDialogSaving}
              onClick={async () => {
                setShareDialogSaving(true);
                try {
                  const ok = await updateSessionSharing(
                    shareDialogVisibility,
                    shareDialogSharedIds,
                  );
                  if (ok) {
                    toast({ title: "Sharing updated", description: "Session sharing settings saved." });
                    setShareDialogOpen(false);
                  } else {
                    toast({ title: "Failed to update", variant: "destructive" });
                  }
                } finally {
                  setShareDialogSaving(false);
                }
              }}
            >
              {shareDialogSaving ? "Saving…" : "Save sharing settings"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <SaveToWorkbenchModal
        open={workbenchPayload != null}
        onClose={() => setWorkbenchPayload(null)}
        payload={workbenchPayload}
      />
      </div>
    </DashboardLayout>
  );
}
