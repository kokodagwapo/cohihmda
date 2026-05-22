/**
 * Research Report tab — chat transcript with an answer block after each turn.
 * Quick-mode first answers use QuickAnswerView; the latest synthesized report
 * uses ResearchReport. Earlier full reports are preserved across follow-ups.
 */

import { useEffect, useMemo, useRef } from "react";
import { Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { renderMarkdownText } from "@/utils/renderMarkdown";
import { ResearchReport, QuickAnswerView } from "@/components/research/ResearchReport";
import type { SaveToWorkbenchPayload } from "@/components/research/SaveToWorkbenchModal";
import type { ChatMessage } from "@/hooks/useCohiChat";
import type {
  Finding,
  ResearchReport as ResearchReportType,
} from "@/hooks/useResearchSession";

export interface ResearchReportTabContentProps {
  messages: ChatMessage[];
  chatLoading?: boolean;
  findings: Finding[];
  report: ResearchReportType | null;
  phase: string;
  researchSessionId: string;
  tenantId?: string;
  sessionIsOwner: boolean;
  isTracked?: boolean;
  onToggleTrack?: () => void;
  onSubmitFeedback?: (
    targetType: "step" | "finding" | "session",
    targetId: string | null,
    rating: -1 | 1 | null,
    comment: string | null,
    contextSnapshot?: unknown,
  ) => Promise<number | undefined>;
  onSaveToWorkbench?: (payload: SaveToWorkbenchPayload) => void;
  onDrillDown?: (finding: Finding) => void;
  onRunFurtherInvestigation?: (question: string) => void;
  reportContainerRef?: React.RefObject<HTMLDivElement | null>;
  className?: string;
}

type ResearchTurn = {
  user: ChatMessage;
  assistant: ChatMessage | null;
};

function buildResearchTurns(messages: ChatMessage[]): ResearchTurn[] {
  const visible = messages.filter((m) => !m.isLoading);
  const turns: ResearchTurn[] = [];
  for (let i = 0; i < visible.length; i++) {
    if (visible[i].role !== "user") continue;
    const assistant =
      visible[i + 1]?.role === "assistant" ? visible[i + 1] : null;
    turns.push({ user: visible[i], assistant });
    if (assistant) i += 1;
  }
  return turns;
}

function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => a.questionId - b.questionId);
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("flex w-full min-w-0", isUser ? "justify-end" : "justify-start")}
    >
      <div
        className={cn(
          "rounded-2xl min-w-0 text-sm leading-relaxed",
          isUser
            ? "max-w-[88%] bg-gradient-to-br from-blue-100 to-blue-200 text-blue-900 dark:from-blue-900/40 dark:to-indigo-900/40 dark:text-blue-100 px-4 py-2.5 shadow-sm"
            : "w-full border border-slate-200/80 dark:border-slate-700/80 bg-white/90 dark:bg-slate-800/60 shadow-sm px-4 py-3",
        )}
      >
        {message.isLoading ? (
          <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
            <Loader2 className="h-4 w-4 animate-spin text-violet-500 shrink-0" />
            <span>Analyzing your data…</span>
          </div>
        ) : (
          <div
            className={cn(
              "prose prose-sm dark:prose-invert max-w-none break-words",
              isUser && "prose-p:my-0 prose-headings:my-1",
            )}
          >
            {renderMarkdownText(message.content || "")}
          </div>
        )}
        {message.error && (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">{message.error}</p>
        )}
      </div>
    </motion.div>
  );
}

export function ResearchReportTabContent({
  messages,
  chatLoading = false,
  findings,
  report,
  phase,
  researchSessionId,
  tenantId,
  sessionIsOwner,
  isTracked,
  onToggleTrack,
  onSubmitFeedback,
  onSaveToWorkbench,
  onDrillDown,
  onRunFurtherInvestigation,
  reportContainerRef,
  className,
}: ResearchReportTabContentProps) {
  const reportSnapshotsRef = useRef<ResearchReportType[]>([]);
  const sortedFindings = useMemo(() => sortFindings(findings), [findings]);
  const turns = useMemo(() => buildResearchTurns(messages), [messages]);

  // Before each follow-up re-synthesis, snapshot the current full report (deep mode).
  useEffect(() => {
    if (phase !== "followup" || !report) return;
    const snapshots = reportSnapshotsRef.current;
    if (snapshots.length === 0 || snapshots[snapshots.length - 1] !== report) {
      reportSnapshotsRef.current = [...snapshots, report];
    }
  }, [phase, report]);

  useEffect(() => {
    if (messages.length === 0) {
      reportSnapshotsRef.current = [];
    }
  }, [researchSessionId]);

  if (turns.length === 0 && !chatLoading) {
    return (
      <p className={cn("text-xs text-slate-500 py-4 px-1", className)}>
        Your question and Cohi&apos;s answer will appear here.
      </p>
    );
  }

  const renderAnswer = (turnIndex: number, isLastTurn: boolean) => {
    const finding = sortedFindings[turnIndex];
    const priorReportSnapshot =
      turnIndex > 0 ? reportSnapshotsRef.current[turnIndex - 1] : undefined;
    const initialReportSnapshot =
      turnIndex === 0 ? reportSnapshotsRef.current[0] : undefined;

    if (isLastTurn && report) {
      return (
        <div
          ref={reportContainerRef}
          className="border-t border-slate-200/70 dark:border-slate-700/70 pt-4"
        >
          <ResearchReport
            report={report}
            findings={findings}
            sessionId={researchSessionId}
            selectedTenantId={tenantId ?? null}
            onSubmitFeedback={onSubmitFeedback}
            onSaveToWorkbench={onSaveToWorkbench}
            isTracked={isTracked}
            onToggleTrack={onToggleTrack}
            onDrillDown={onDrillDown}
            onRunFurtherInvestigation={
              sessionIsOwner ? onRunFurtherInvestigation : undefined
            }
          />
        </div>
      );
    }

    if (!isLastTurn && priorReportSnapshot) {
      return (
        <div className="border-t border-slate-200/70 dark:border-slate-700/70 pt-4">
          <ResearchReport
            report={priorReportSnapshot}
            findings={sortedFindings.slice(0, turnIndex + 1)}
            sessionId={researchSessionId}
            selectedTenantId={tenantId ?? null}
            onSubmitFeedback={onSubmitFeedback}
            onSaveToWorkbench={onSaveToWorkbench}
            onDrillDown={onDrillDown}
          />
        </div>
      );
    }

    if (
      !isLastTurn &&
      turnIndex === 0 &&
      initialReportSnapshot &&
      turns.length === 2
    ) {
      return (
        <div className="border-t border-slate-200/70 dark:border-slate-700/70 pt-4">
          <ResearchReport
            report={initialReportSnapshot}
            findings={sortedFindings}
            sessionId={researchSessionId}
            selectedTenantId={tenantId ?? null}
            onSubmitFeedback={onSubmitFeedback}
            onSaveToWorkbench={onSaveToWorkbench}
            onDrillDown={onDrillDown}
          />
        </div>
      );
    }

    if (finding) {
      return (
        <div className="border-t border-slate-200/70 dark:border-slate-700/70 pt-4">
          <QuickAnswerView
            finding={finding}
            sessionId={researchSessionId}
            onSaveToWorkbench={onSaveToWorkbench}
            onDrillDown={onDrillDown}
          />
        </div>
      );
    }

    if (isLastTurn && phase === "complete" && chatLoading) {
      return (
        <div className="flex items-center gap-2 text-xs text-slate-500 py-4 border-t border-slate-200/70 dark:border-slate-700/70">
          <Loader2 className="h-4 w-4 animate-spin text-violet-500" />
          Updating report…
        </div>
      );
    }

    return null;
  };

  return (
    <div className={cn("space-y-6 min-w-0 py-2", className)}>
      {turns.map((turn, idx) => {
        const isLast = idx === turns.length - 1;
        return (
          <div key={turn.user.id} className="space-y-4 min-w-0">
            <MessageBubble message={turn.user} />
            {turn.assistant && <MessageBubble message={turn.assistant} />}
            {turn.assistant && !turn.assistant.isLoading && renderAnswer(idx, isLast)}
          </div>
        );
      })}

      {chatLoading && messages[messages.length - 1]?.role !== "assistant" && (
        <div className="flex justify-start">
          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-700/70 bg-white/90 dark:bg-slate-800/60 px-4 py-3">
            <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <Loader2 className="h-4 w-4 animate-spin text-violet-500" />
              <span>Research in progress…</span>
            </div>
          </div>
        </div>
      )}

      {/* Single-turn legacy: no assistant message yet but findings/report exist */}
      {turns.length === 0 && sortedFindings.length >= 1 && phase === "complete" && (
        <div className="border-t border-slate-200/70 dark:border-slate-700/70 pt-4">
          {report ? (
            <ResearchReport
              report={report}
              findings={findings}
              sessionId={researchSessionId}
              selectedTenantId={tenantId ?? null}
              onSubmitFeedback={onSubmitFeedback}
              onSaveToWorkbench={onSaveToWorkbench}
              isTracked={isTracked}
              onToggleTrack={onToggleTrack}
              onDrillDown={onDrillDown}
              onRunFurtherInvestigation={
                sessionIsOwner ? onRunFurtherInvestigation : undefined
              }
            />
          ) : (
            <QuickAnswerView
              finding={sortedFindings[sortedFindings.length - 1]}
              sessionId={researchSessionId}
              onSaveToWorkbench={onSaveToWorkbench}
              onDrillDown={onDrillDown}
            />
          )}
        </div>
      )}
    </div>
  );
}
