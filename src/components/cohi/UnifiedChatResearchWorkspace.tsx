/**

 * Research mode body embedded in unified shell (COHI-406 §4.6).

 * Timeline + Findings mirror Research Lab; Report tab holds the chat transcript.

 */



import { useEffect, useState } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { useResearchSession } from "@/hooks/useResearchSession";

import { AgentTimeline } from "@/components/research/AgentTimeline";

import { ResearchReport, QuickAnswerView } from "@/components/research/ResearchReport";

import { FindingDrillDown } from "@/components/research/FindingDrillDown";

import { FindingSummaryContent } from "@/components/research/FindingSummaryContent";

import { ResearchChatTranscript } from "@/components/cohi/ResearchChatTranscript";

import { Badge } from "@/components/ui/badge";

import { Card, CardContent } from "@/components/ui/card";

import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

import { useChatShell } from "@/contexts/ChatShellContext";

import type { ChatMessage } from "@/hooks/useCohiChat";



export interface UnifiedChatResearchWorkspaceProps {

  researchSessionId?: string | null;

  tenantId?: string;

  messages?: ChatMessage[];

  chatLoading?: boolean;

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

}: UnifiedChatResearchWorkspaceProps) {

  const { mode } = useChatShell();

  const {
    phase,
    plan,
    findings,
    report,
    events,
    isRunning,
    isPaused,
    loadSession,
    refreshSession,
    submitFeedback,
    reset,
  } = useResearchSession(tenantId);
  const [activeTab, setActiveTab] = useState("report");
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);

  useEffect(() => {
    if (!researchSessionId) {
      reset();
      setActiveTab("report");
      setSelectedFindingId(null);
      return;
    }
    void loadSession(researchSessionId);
  }, [researchSessionId, loadSession, reset]);

  // Unified chat stream does not feed useResearchSession — poll until DB catches up.
  useEffect(() => {
    if (!researchSessionId) return;

    const needsRefresh =
      chatLoading ||
      isRunning ||
      (phase !== "complete" &&
        phase !== "error" &&
        phase !== "idle" &&
        phase !== "creating") ||
      (phase === "complete" && findings.length === 0);

    if (!needsRefresh) return;

    const timer = window.setInterval(() => {
      void refreshSession(researchSessionId);
    }, 2000);

    return () => window.clearInterval(timer);
  }, [
    chatLoading,
    researchSessionId,
    findings.length,
    isRunning,
    phase,
    refreshSession,
  ]);

  useEffect(() => {
    if (!researchSessionId || chatLoading) return;
    void refreshSession(researchSessionId);
  }, [researchSessionId, chatLoading, refreshSession]);

  const selectedFinding =

    findings.find((f) => String(f.questionId) === selectedFindingId) ??

    findings[0] ??

    null;



  const showRunningSpinner =
    !!researchSessionId && (isRunning || chatLoading);
  const reportReady =
    !!researchSessionId &&
    (!!report || (findings.length >= 1 && phase === "complete"));

  if (!researchSessionId) {

    return (

      <div className="shrink-0 px-4 py-3 border-b border-violet-100/80 dark:border-indigo-900/50 text-xs text-slate-500">

        Ask a research question below to start an investigation.

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

      <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-200/60 dark:border-slate-700/60 shrink-0">

        <span className="text-xs font-medium text-slate-600 dark:text-slate-300">

          Research

        </span>

        <Badge variant="outline" className="text-[10px] capitalize">

          {phaseLabel(phase, showRunningSpinner)}

        </Badge>

        {showRunningSpinner && (

          <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500" />

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

          <div className="space-y-4 py-2">

            <ResearchChatTranscript

              messages={messages}

              isLoading={chatLoading}

            />



            {report ? (

              <div className="border-t border-slate-200/70 dark:border-slate-700/70 pt-4">

                <ResearchReport

                  report={report}

                  findings={findings}

                  sessionId={researchSessionId}

                  selectedTenantId={tenantId ?? null}

                  onSubmitFeedback={submitFeedback}

                  onDrillDown={(f) => {

                    setSelectedFindingId(String(f.questionId));

                    setActiveTab("findings");

                  }}

                />

              </div>

            ) : findings.length >= 1 && phase === "complete" ? (

              <div className="border-t border-slate-200/70 dark:border-slate-700/70 pt-4">

                <QuickAnswerView

                  finding={findings[findings.length - 1]}

                  sessionId={researchSessionId}

                  onDrillDown={(f) => {

                    setSelectedFindingId(String(f.questionId));

                    setActiveTab("findings");

                  }}

                />

              </div>

            ) : null}

          </div>

        </TabsContent>

      </Tabs>

    </div>

  );

}


