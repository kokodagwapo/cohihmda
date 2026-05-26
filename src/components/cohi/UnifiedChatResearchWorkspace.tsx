/**
 * Research mode body embedded in unified shell (COHI-406 §4.6).
 * Timeline + Findings mirror Research Lab; Report tab holds the chat transcript.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useResearchSession } from "@/hooks/useResearchSession";
import { AgentTimeline } from "@/components/research/AgentTimeline";
import type { Finding } from "@/hooks/useResearchSession";
import { FindingDrillDown } from "@/components/research/FindingDrillDown";
import { FindingSummaryContent } from "@/components/research/FindingSummaryContent";
import { ResearchReportTabContent } from "@/components/cohi/ResearchReportTabContent";
import { SaveToWorkbenchModal, type SaveToWorkbenchPayload } from "@/components/research/SaveToWorkbenchModal";
import { ExportMenu } from "@/components/common/ExportMenu";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { UserSharePicker } from "@/components/common/UserSharePicker";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { HistoryMetaPill } from "@/components/cohi/UnifiedChatHistoryMeta";
import { cn } from "@/lib/utils";
import { useChatShell } from "@/contexts/ChatShellContext";
import { buildResearchReportExportData } from "@/lib/researchReportExport";
import {
  buildResearchReportPptModel,
  collectImageCaptureKeys,
  researchCaptureTimeoutMs,
} from "@/lib/researchReportPptExport";
import {
  captureResearchExportImages,
  waitForResearchCaptureReady,
} from "@/lib/researchReportPptCapture";
import { exportResearchReportAsPpt } from "@/utils/exportUtils";
import { useResearchInsightTracking } from "@/hooks/useResearchInsightTracking";
import { useOptionalCohiChatSession } from "@/contexts/CohiChatSessionContext";
import { RESEARCH_SHELL_EXPAND_EVENT } from "@/lib/unifiedChatEnvelope";
import type { ChatMessage } from "@/hooks/useCohiChat";

export interface UnifiedChatResearchWorkspaceProps {
  researchSessionId?: string | null;
  tenantId?: string;
  messages?: ChatMessage[];
  chatLoading?: boolean;
  onSessionAccess?: (access: {
    isOwner: boolean;
    ownerEmail: string;
    ownerName: string;
  }) => void;
}

function phaseLabel(phase: string, isRunning: boolean) {
  if (isRunning) return "Running";
  if (phase === "complete") return "Complete";
  if (phase === "error") return "Error";
  return phase;
}

export function UnifiedChatResearchWorkspace({
  researchSessionId,
  tenantId,
  messages = [],
  chatLoading = false,
  onSessionAccess,
}: UnifiedChatResearchWorkspaceProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { mode } = useChatShell();
  const {
    phase,
    plan,
    findings,
    report,
    events,
    isRunning,
    isPaused,
    sessions,
    refreshSession,
    submitFeedback,
    reset,
    startSession,
    sessionVisibility,
    sessionSharedWithUserIds,
    sessionIsOwner,
    sessionOwnerEmail,
    sessionOwnerName,
    updateSessionSharing,
  } = useResearchSession(tenantId);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareDialogVisibility, setShareDialogVisibility] = useState<
    "private" | "shared" | "global"
  >("private");
  const [shareDialogSharedIds, setShareDialogSharedIds] = useState<string[]>(
    [],
  );
  const [shareDialogSaving, setShareDialogSaving] = useState(false);
  const chatSession = useOptionalCohiChatSession();
  const [activeTab, setActiveTab] = useState("report");
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [workbenchPayload, setWorkbenchPayload] = useState<SaveToWorkbenchPayload | null>(null);
  const reportContainerRef = useRef<HTMLDivElement>(null);
  const [exportPreparing, setExportPreparing] = useState(false);
  const { isTracked, onToggleTrack } = useResearchInsightTracking(
    tenantId,
    researchSessionId,
  );

  const handleRunFurtherInvestigation = useCallback(
    (question: string) => {
      const topic = question.trim();
      if (!topic) return;

      setSelectedFindingId(null);
      setActiveTab("timeline");
      reset();

      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent(RESEARCH_SHELL_EXPAND_EVENT, {
            detail: { researchShellExpand: true },
          }),
        );
      }

      if (!sessionIsOwner) return;

      if (chatSession) {
        chatSession.setResearchDeepAnalysis(true);
        void chatSession.sendMessage(topic, { forceNewConversation: true });
        return;
      }

      void startSession(topic, undefined, "deep");
    },
    [chatSession, reset, sessionIsOwner, startSession],
  );

  const [sessionHydrating, setSessionHydrating] = useState(false);

  useEffect(() => {
    if (!researchSessionId) {
      reset();
      setSessionHydrating(false);
      setActiveTab("report");
      setSelectedFindingId(null);
      return;
    }
    setSessionHydrating(true);
    reset();
    void refreshSession(researchSessionId).finally(() => setSessionHydrating(false));
  }, [researchSessionId, reset, refreshSession]);

  const investigationInProgress =
    sessionHydrating ||
    chatLoading ||
    isRunning ||
    (phase !== "complete" && phase !== "error");

  // Unified chat poll mode: pipeline runs server-side; refresh session state on an interval.
  useEffect(() => {
    if (!researchSessionId) return;

    const shouldPoll =
      investigationInProgress ||
      (phase === "complete" && findings.length === 0 && !report);

    if (!shouldPoll) return;

    const timer = window.setInterval(() => {
      void refreshSession(researchSessionId);
    }, 2000);

    return () => window.clearInterval(timer);
  }, [
    researchSessionId,
    investigationInProgress,
    phase,
    findings.length,
    report,
    refreshSession,
  ]);

  useEffect(() => {
    if (!researchSessionId) {
      onSessionAccess?.({ isOwner: true, ownerEmail: "", ownerName: "" });
      return;
    }
    onSessionAccess?.({
      isOwner: sessionIsOwner,
      ownerEmail: sessionOwnerEmail,
      ownerName: sessionOwnerName,
    });
  }, [
    researchSessionId,
    sessionIsOwner,
    sessionOwnerEmail,
    sessionOwnerName,
    onSessionAccess,
  ]);

  const selectedFinding =
    selectedFindingId != null
      ? (findings.find((f) => String(f.questionId) === selectedFindingId) ?? null)
      : null;

  const showRunningSpinner = !!researchSessionId && investigationInProgress;
  const reportReady =
    !!researchSessionId &&
    (!!report || (findings.length >= 1 && phase === "complete"));

  const primaryFinding = useMemo(() => {
    if (findings.length === 0) return null;
    return [...findings].sort((a, b) => a.questionId - b.questionId)[
      findings.length - 1
    ];
  }, [findings]);

  const reportExportTitle = useMemo(() => {
    const topic = sessions.find((s) => s.id === researchSessionId)?.topic?.trim();
    if (topic) return `Research Report - ${topic}`;
    const firstUser = messages.find((m) => m.role === "user")?.content?.trim();
    if (firstUser) {
      const short = firstUser.length > 80 ? `${firstUser.slice(0, 77)}...` : firstUser;
      return `Research Report - ${short}`;
    }
    return "Research Report";
  }, [messages, researchSessionId, sessions]);

  const reportUnderstory = useMemo(() => {
    const topic = sessions.find((s) => s.id === researchSessionId)?.topic?.trim();
    if (topic) return topic;
    const firstUser = messages.find((m) => m.role === "user")?.content?.trim();
    return firstUser || undefined;
  }, [messages, researchSessionId, sessions]);

  const handleStructuredResearchPpt = useCallback(async () => {
    const slides = buildResearchReportPptModel({
      title: reportExportTitle,
      understory: reportUnderstory,
      report,
      findings,
      primaryFinding,
    });
    const keys = collectImageCaptureKeys(slides);
    flushSync(() => {
      setExportPreparing(true);
      setActiveTab("report");
    });
    try {
      await waitForResearchCaptureReady(
        reportContainerRef.current,
        keys,
        researchCaptureTimeoutMs(keys),
      );
      const images = await captureResearchExportImages(
        reportContainerRef.current,
        keys,
      );
      await exportResearchReportAsPpt(slides, images, reportExportTitle);
      toast({
        title: "Downloaded",
        description: "PowerPoint saved.",
      });
    } catch (error) {
      toast({
        title: "Export failed",
        description:
          error instanceof Error ? error.message : "Could not create PowerPoint.",
        variant: "destructive",
      });
    } finally {
      setExportPreparing(false);
    }
  }, [
    reportExportTitle,
    reportUnderstory,
    report,
    findings,
    primaryFinding,
    toast,
  ]);

  if (!researchSessionId) {
    return (
      <div
        data-testid="unified-research-workspace"
        className="shrink-0 px-4 py-3 border-b border-violet-100/80 dark:border-indigo-900/50 flex items-center gap-2 text-xs text-slate-500"
      >
        {chatLoading && (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500 shrink-0" />
        )}
        <span>
          {chatLoading
            ? "Starting research investigation…"
            : "Ask a research question below to start an investigation."}
        </span>
      </div>
    );
  }

  const heightClass =
    mode === "full"
      ? "flex-1 min-h-0"
      : mode === "tall"
        ? "max-h-[min(400px,45vh)]"
        : "max-h-[min(320px,40vh)]";

  return (
    <div
      data-testid="unified-research-workspace"
      className={cn(
        "shrink-0 border-b border-violet-100/80 dark:border-indigo-900/50 overflow-hidden flex flex-col bg-slate-50/30 dark:bg-slate-900/30",
        heightClass,
      )}
    >
      <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-slate-200/60 dark:border-slate-700/60 shrink-0">
        <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
          Research
        </span>
        <Badge variant="outline" className="text-xs capitalize px-2 py-0.5">
          {phaseLabel(phase, showRunningSpinner)}
        </Badge>
        {showRunningSpinner && (
          <Loader2 className="h-4 w-4 animate-spin text-violet-500" />
        )}
        <div className="flex-1" />
        {!sessionIsOwner && (sessionOwnerName || sessionOwnerEmail) && (
          <HistoryMetaPill className="bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100 shrink-0 text-xs px-2.5 py-1">
            Shared by {sessionOwnerName || sessionOwnerEmail}
          </HistoryMetaPill>
        )}
        {sessionIsOwner && researchSessionId && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-sm"
            data-testid="research-share"
            onClick={() => {
              setShareDialogVisibility(
                sessionVisibility === "global"
                  ? "global"
                  : sessionVisibility === "shared"
                    ? "shared"
                    : "private",
              );
              setShareDialogSharedIds([...sessionSharedWithUserIds]);
              setShareDialogOpen(true);
            }}
          >
            <Share2 className="h-4 w-4" />
            Share
          </Button>
        )}
        {reportReady && (
          <ExportMenu
            title={reportExportTitle}
            targetRef={reportContainerRef}
            getExportData={() =>
              report
                ? buildResearchReportExportData(report, reportExportTitle)
                : { title: reportExportTitle, tables: [] }
            }
            onExportPpt={handleStructuredResearchPpt}
            disabled={exportPreparing}
          />
        )}
        {findings.length > 1 && activeTab !== "findings" && (
          <button
            type="button"
            className="text-xs text-violet-600 dark:text-violet-400 hover:underline"
            onClick={() => {
              setSelectedFindingId(null);
              setActiveTab("findings");
            }}
          >
            All findings ({findings.length})
          </button>
        )}
      </div>

      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex-1 min-h-0 flex flex-col"
      >
        <TabsList className="mx-4 mt-2 h-8 shrink-0">
          <TabsTrigger value="timeline" className="text-xs gap-1">
            Timeline
            {showRunningSpinner && (
              <Loader2 className="h-3 w-3 animate-spin" />
            )}
          </TabsTrigger>
          <TabsTrigger
            value="findings"
            className="text-xs"
            disabled={findings.length === 0 && !showRunningSpinner}
          >
            Findings ({findings.length})
          </TabsTrigger>
          <TabsTrigger
            value="report"
            className="text-xs"
            disabled={!reportReady && messages.length === 0 && !chatLoading}
          >
            Report
          </TabsTrigger>
        </TabsList>

        <TabsContent
          value="timeline"
          className="flex-1 overflow-y-auto mt-0 min-h-0 data-[state=inactive]:hidden"
        >
          <AgentTimeline
            events={events}
            isRunning={showRunningSpinner}
            isPaused={isPaused}
            sessionId={researchSessionId}
            totalQuestions={plan?.questions?.length}
            onSubmitFeedback={submitFeedback}
          />
        </TabsContent>

        <TabsContent
          value="findings"
          className="flex-1 overflow-y-auto px-4 pb-3 mt-0 min-h-0 data-[state=inactive]:hidden"
        >
          {selectedFinding ? (
            <div className="py-2 min-h-0">
              <FindingDrillDown
                finding={selectedFinding}
                sessionId={researchSessionId}
                onClose={() => setSelectedFindingId(null)}
                onSaveToWorkbench={setWorkbenchPayload}
              />
            </div>
          ) : (
            <div className="space-y-2 py-2">
              {findings.map((f) => (
                <Card
                  key={f.questionId}
                  className="cursor-pointer hover:border-violet-300 dark:hover:border-violet-600 transition-colors"
                  onClick={() => setSelectedFindingId(String(f.questionId))}
                >
                  <CardContent className="pt-3 pb-2 px-3">
                    <div className="flex items-start gap-2 mb-1.5">
                      <h4 className="text-sm font-semibold flex-1 text-slate-800 dark:text-slate-100">
                        {f.title}
                      </h4>
                      <Badge
                        variant={
                          f.confidence === "high"
                            ? "default"
                            : f.confidence === "medium"
                              ? "secondary"
                              : "outline"
                        }
                        className="text-[10px] shrink-0"
                      >
                        {f.confidence}
                      </Badge>
                    </div>
                    <FindingSummaryContent
                      summary={f.summary}
                      preferredBullets={f.summary_bullets}
                      paragraphClassName="text-xs text-slate-600 dark:text-slate-400 leading-relaxed"
                      listClassName="list-disc pl-4 space-y-1 text-xs text-slate-600 dark:text-slate-400 leading-relaxed"
                    />
                    {Object.keys(f.keyMetrics ?? {}).length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {Object.entries(f.keyMetrics).map(([k, v]) => (
                          <div
                            key={k}
                            className="rounded bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px]"
                          >
                            <span className="text-slate-500">{k}:</span>{" "}
                            <span className="font-medium">{String(v)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="text-[10px] text-slate-500 mt-2">
                      {f.evidence?.length ?? 0} query(ies) — click to drill down
                    </p>
                  </CardContent>
                </Card>
              ))}
              {findings.length === 0 && (
                <p className="text-xs text-slate-500 py-6 text-center">
                  {showRunningSpinner
                    ? "Agents are investigating…"
                    : "No findings yet."}
                </p>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent
          value="report"
          className="flex-1 overflow-y-auto px-4 pb-3 mt-0 min-h-0 data-[state=inactive]:hidden"
        >
          <ResearchReportTabContent
            messages={messages}
            chatLoading={chatLoading}
            findings={findings}
            report={report}
            phase={phase}
            researchSessionId={researchSessionId}
            tenantId={tenantId}
            sessionIsOwner={sessionIsOwner}
            isTracked={isTracked}
            onToggleTrack={onToggleTrack}
            onSubmitFeedback={submitFeedback}
            onSaveToWorkbench={setWorkbenchPayload}
            onDrillDown={(f: Finding) => {
              setSelectedFindingId(String(f.questionId));
              setActiveTab("findings");
            }}
            onRunFurtherInvestigation={
              sessionIsOwner ? handleRunFurtherInvestigation : undefined
            }
            reportContainerRef={reportContainerRef}
            forceEvidenceOpen={exportPreparing}
          />
        </TabsContent>
      </Tabs>

      <SaveToWorkbenchModal
        open={workbenchPayload !== null}
        onClose={() => setWorkbenchPayload(null)}
        payload={workbenchPayload}
      />

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
              allowGlobal={["super_admin", "platform_admin", "tenant_admin"].includes(
                user?.role || "",
              )}
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
                    toast({
                      title: "Sharing updated",
                      description: "Session sharing settings saved.",
                    });
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
    </div>
  );
}
