/**
 * Cohi Chat Panel Component
 * AI-powered chat interface with hybrid data + knowledge capabilities
 * Enhanced with executive-level visualizations, color-coded messages, and voice agentic
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useLocation, useNavigate, Link as RouterLink } from "react-router-dom";
import { api } from "@/lib/api";
import {
  MessageSquare,
  Send,
  X,
  Save,
  RefreshCw,
  Trash2,
  Sparkles,
  ChevronDown,
  Loader2,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Users,
  User,
  FileText,
  Clock,
  Target,
  CheckCircle2,
  Info,
  AlertTriangle,
  Mic,
  MicOff,
  Volume2,
  BarChart3,
  PieChart,
  Activity,
  FileSpreadsheet,
  Image,
  Expand,
  Shrink,
  MoreHorizontal,
  Share2,
  Download,
  Presentation,
  Copy,
  Check,
  Link,
  Mail,
  Percent,
  BadgeCheck,
  LayoutGrid,
  Code,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  useCohiChat,
  ChatMessage,
  VisualizationConfig,
} from "@/hooks/useCohiChat";
import { ChatHistorySidebar } from "@/components/dashboard/ChatHistorySidebar";
import {
  ChatTypeSelect,
  ResearchDeepAnalysisToggle,
} from "@/components/cohi/ChatTypeSelector";
import { UnifiedChatRebindBanner } from "@/components/cohi/UnifiedChatRebindBanner";
import { BackgroundChatRunsBadge } from "@/components/cohi/BackgroundChatRunsBadge";
import { useUnifiedChatPermissions } from "@/hooks/useUnifiedChatPermissions";
import { InsightBuilderPreviewCard } from "@/components/cohi/InsightBuilderPreviewCard";
import { UnifiedChatResearchWorkspace } from "@/components/cohi/UnifiedChatResearchWorkspace";
import { DatasetAttachPanel } from "@/components/research/ResearchDatasetAttachPanel";
import { ChatFilesBar } from "@/components/cohi/ChatFilesBar";
import { useResearchUploads } from "@/hooks/useResearchUploads";
import { createUnifiedChatClient } from "@/lib/unifiedChatClient";
import {
  isUnifiedChatClientEnabled,
  workbenchArtifactHandoffPath,
} from "@/lib/unifiedChatEnvelope";
import { cohiChatNavigationState, useChatShell } from "@/contexts/ChatShellContext";
import {
  COHI_WORKBENCH_EDITING_WIDGET_STATE_EVENT,
  COHI_WORKBENCH_EDIT_WIDGET_EVENT,
  COHI_WORKBENCH_STOP_EDITING_EVENT,
  isMyDashboardCanvasPath,
  getMyDashboardCanvasIdFromPath,
  bindWorkbenchEditDraftScope,
  navigateForWorkbenchChatSubmit,
  navigateForWorkbenchConversationResume,
  navigateForWorkbenchWidgetEdit,
  type WorkbenchEditWidgetEventDetail,
  type WorkbenchEditingWidgetStateDetail,
  describeWorkbenchActionsApplied,
  formatWorkbenchSectionKey,
  shouldForceNewWorkbenchConversation,
  shouldForkOnChatTypeChange,
  type CarryOverContext,
} from "@/lib/workbench/workbenchChatHandoff";
import { buildCarryOverContext } from "@/lib/carryOverContext";
import { resolveCarryOverSummary } from "@/lib/carryOverContext.resolve";
import { buildModeHandoffFromWorkbench } from "@/lib/chat/modeHandoff";
import {
  getLatestWorkbenchActiveContext,
  markWorkbenchNewChatPendingFirstSend,
} from "@/lib/workbench/workbenchChatScopeSync";
import { ConversationForkChips } from "@/components/cohi/ConversationForkChips";
import { useWorkbenchChatScopeGuard } from "@/components/cohi/WorkbenchChatScopeGuard";
import {
  WorkbenchDashboardSuggestionCard,
  filterSuggestDashboardActions,
} from "@/components/workbench/WorkbenchDashboardSuggestionCard";
import type { SuggestDashboardAction } from "@/types/widgetActions";
import { formatChatTypeLabel } from "@/lib/unifiedChatTypeStyles";
import { useOptionalCohiChatSession } from "@/contexts/CohiChatSessionContext";
import { PAGE_INSIGHTS_CARD } from "@/components/cohi/pageContentStyles";
import { CHAT_SHELL_VIEW_TRANSITION } from "@/hooks/useChatShellAnimatedHeight";
import { DynamicVisualization } from "@/components/visualizations/DynamicVisualization";
import {
  EnhancedVisualization,
  EnhancedVisualizationConfig,
} from "@/components/visualizations/EnhancedVisualization";
import { useToast } from "@/components/ui/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { convertChatToCanvasItems } from "@/utils/chatToCanvas";
import {
  createLayoutItem,
  type CanvasLayoutItem,
} from "@/components/workbench/canvas/types";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuLabel,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { ChatShellExpandControls } from "@/components/cohi/ChatShellExpandControls";
import { CohiChatDockChip } from "@/components/cohi/CohiChatDockChip";
import {
  ChatTypeSuggestedPromptCards,
  resolveChatTypePromptCardsLayout,
} from "@/components/cohi/ChatTypeSuggestedPromptCards";
import type { UnifiedChatType } from "@/lib/unifiedChatClient";
import {
  CHAT_TYPE_DEFAULT_SUGGESTIONS,
  resolveWorkbenchTopicSuggestions,
} from "@/lib/unifiedChatSuggestedPrompts";
import {
  isWorkbenchCanvasPopulated,
  WORKBENCH_CANVAS_SAVED_EVENT,
} from "@/lib/workbench/workbenchChatScopeSync";

const CHAT_EXPORT_FORMAT_KEY = "cohi-chat-preferred-export-format";

// ============================================================================
// Helper Functions
// ============================================================================

// ============================================================================
// Types
// ============================================================================

interface CohiChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onOpen?: () => void;
  tenantId?: string;
  className?: string;
  /** `shell` = horizontal band (COHI-404); `rail` = legacy right slide-over. */
  layout?: "rail" | "shell";
  /** Hide in-panel session history when app sidebar owns history (COHI-403/405). */
  hideInPanelHistory?: boolean;
}


/** Optional override for quick export from message bubble (no dialog) */
type ExportOverride = {
  visualization: VisualizationConfig;
  title?: string;
  description?: string;
  /** Chat message id so we can capture the rendered chart image for the export. */
  messageId?: string;
};

type QuickExportFormat = "pdf" | "ppt";

type MessageType =
  | "success"
  | "warning"
  | "info"
  | "error"
  | "metric"
  | "insight";

interface EnhancedMessage {
  type: MessageType;
  icon: React.ReactNode;
  bgColor: string;
  borderColor: string;
  textColor: string;
  accentColor: string;
}

// ============================================================================
// Message Type Styling
// ============================================================================

const getMessageStyling = (content: string): EnhancedMessage => {
  const lowerContent = content.toLowerCase();

  if (
    lowerContent.includes("up") ||
    lowerContent.includes("increase") ||
    lowerContent.includes("growth") ||
    lowerContent.includes("exceeded") ||
    lowerContent.includes("record")
  ) {
    return {
      type: "success",
      icon: <TrendingUp className="w-4 h-4" />,
      bgColor: "bg-emerald-50 dark:bg-emerald-950/30",
      borderColor: "border-emerald-200 dark:border-emerald-800",
      textColor: "text-emerald-800 dark:text-emerald-200",
      accentColor: "text-emerald-500",
    };
  }

  if (
    lowerContent.includes("down") ||
    lowerContent.includes("decrease") ||
    lowerContent.includes("decline") ||
    lowerContent.includes("risk") ||
    lowerContent.includes("fallout")
  ) {
    return {
      type: "warning",
      icon: <TrendingDown className="w-4 h-4" />,
      bgColor: "bg-amber-50 dark:bg-amber-950/30",
      borderColor: "border-amber-200 dark:border-amber-800",
      textColor: "text-amber-800 dark:text-amber-200",
      accentColor: "text-amber-500",
    };
  }

  if (
    lowerContent.includes("$") ||
    lowerContent.includes("volume") ||
    lowerContent.includes("revenue") ||
    lowerContent.includes("amount")
  ) {
    return {
      type: "metric",
      icon: <DollarSign className="w-4 h-4" />,
      bgColor: "bg-blue-50 dark:bg-blue-950/30",
      borderColor: "border-blue-200 dark:border-blue-800",
      textColor: "text-blue-800 dark:text-blue-200",
      accentColor: "text-blue-500",
    };
  }

  if (
    lowerContent.includes("alert") ||
    lowerContent.includes("attention") ||
    lowerContent.includes("critical")
  ) {
    return {
      type: "error",
      icon: <AlertTriangle className="w-4 h-4" />,
      bgColor: "bg-red-50 dark:bg-red-950/30",
      borderColor: "border-red-200 dark:border-red-800",
      textColor: "text-red-800 dark:text-red-200",
      accentColor: "text-red-500",
    };
  }

  return {
    type: "info",
    icon: <Info className="w-4 h-4" />,
    bgColor: "bg-slate-50 dark:bg-slate-800/50",
    borderColor: "border-slate-200 dark:border-slate-700",
    textColor: "text-slate-800 dark:text-slate-200",
    accentColor: "text-slate-500",
  };
};

import { renderMarkdownText } from "@/utils/renderMarkdown";

// ============================================================================
// Animated KPI Card
// ============================================================================

const AnimatedKPI: React.FC<{
  label: string;
  value: string | number;
  change?: number;
  icon: React.ReactNode;
  color: string;
  delay?: number;
}> = ({ label, value, change, icon, color, delay = 0 }) => (
  <motion.div
    initial={{ opacity: 0, y: 20, scale: 0.9 }}
    animate={{ opacity: 1, y: 0, scale: 1 }}
    transition={{ duration: 0.4, delay }}
    className={cn(
      "p-3 rounded-lg border shadow-sm",
      color === "blue" &&
        "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800",
      color === "green" &&
        "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800",
      color === "amber" &&
        "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800",
      color === "purple" &&
        "bg-purple-50 dark:bg-purple-950/30 border-purple-200 dark:border-purple-800"
    )}
  >
    <div className="flex items-center gap-2 mb-1">
      <span
        className={cn(
          "p-1.5 rounded",
          color === "blue" &&
            "bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400",
          color === "green" &&
            "bg-emerald-100 dark:bg-emerald-900 text-emerald-600 dark:text-emerald-400",
          color === "amber" &&
            "bg-amber-100 dark:bg-amber-900 text-amber-600 dark:text-amber-400",
          color === "purple" &&
            "bg-purple-100 dark:bg-purple-900 text-purple-600 dark:text-purple-400"
        )}
      >
        {icon}
      </span>
      <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
        {label}
      </span>
    </div>
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.6, delay: delay + 0.2 }}
      className="flex items-baseline gap-2"
    >
      <span className="text-xl font-bold text-slate-900 dark:text-white">
        {value}
      </span>
      {change !== undefined && (
        <span
          className={cn(
            "text-xs font-medium flex items-center gap-0.5",
            change >= 0 ? "text-emerald-600" : "text-red-600"
          )}
        >
          {change >= 0 ? (
            <TrendingUp className="w-3 h-3" />
          ) : (
            <TrendingDown className="w-3 h-3" />
          )}
          {Math.abs(change)}%
        </span>
      )}
    </motion.div>
  </motion.div>
);

// ============================================================================
// Bullet Point List
// ============================================================================

const AnimatedBulletList: React.FC<{ items: string[]; delay?: number }> = ({
  items,
  delay = 0,
}) => (
  <motion.ul className="space-y-2 my-3">
    {items.map((item, index) => (
      <motion.li
        key={index}
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3, delay: delay + index * 0.1 }}
        className="flex items-start gap-2 text-sm"
      >
        <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
        <span className="text-slate-700 dark:text-slate-300">{item}</span>
      </motion.li>
    ))}
  </motion.ul>
);

// ============================================================================
// Mini Chart Component
// ============================================================================

const MiniSparkline: React.FC<{ data: number[]; color: string }> = ({
  data,
  color,
}) => {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;

  const points = data
    .map((value, index) => {
      const x = (index / (data.length - 1)) * 100;
      const y = 100 - ((value - min) / range) * 100;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <motion.svg
      viewBox="0 0 100 100"
      className="w-full h-8"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
    >
      <motion.polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1, ease: "easeInOut" }}
      />
    </motion.svg>
  );
};

// ============================================================================
// Main Component
// ============================================================================

export const CohiChatPanel: React.FC<CohiChatPanelProps> = ({
  isOpen,
  onClose,
  onOpen,
  tenantId,
  className,
  layout = "rail",
  hideInPanelHistory = false,
}) => {
  const { toast } = useToast();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [voiceProvider, setVoiceProvider] = useState<"openai" | "gemini">(
    "gemini"
  );
  const [attachedUploadIds, setAttachedUploadIds] = useState<string[]>([]);
  const [workbenchEditingWidget, setWorkbenchEditingWidget] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [researchViewOnly, setResearchViewOnly] = useState(false);
  const [vizTypeOverrides, setVizTypeOverrides] = useState<
    Record<string, VisualizationConfig["type"]>
  >({});
  const isMobile = useIsMobile();
  const {
    mode: shellExpandMode,
    setMode: setShellExpandMode,
    isChatHomePage,
  } = useChatShell();
  const isShellCompact = layout === "shell" && shellExpandMode === "compact";
  const isStackedInsetShell =
    layout === "shell" &&
    (shellExpandMode === "compact" || shellExpandMode === "tall");

  const expandShellIfCompact = useCallback(() => {
    if (layout === "shell" && shellExpandMode === "compact") {
      setShellExpandMode("tall");
    }
  }, [layout, shellExpandMode, setShellExpandMode]);

  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pendingSuggestionRef = useRef<{
    question: string;
    chatType: UnifiedChatType;
    forceNewConversation: boolean;
  } | null>(null);
  /** Canvas id we last auto-selected workbench for (navigation only, not manual mode changes). */
  const lastAutoWorkbenchCanvasIdRef = useRef<string | null>(null);
  const CHAT_INPUT_MAX_HEIGHT_PX = 128;

  const resizeChatInput = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, CHAT_INPUT_MAX_HEIGHT_PX);
    el.style.height = `${next}px`;
    el.style.overflowY =
      el.scrollHeight > CHAT_INPUT_MAX_HEIGHT_PX ? "auto" : "hidden";
  }, []);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    if (isMobile) {
      setIsFullscreen(true);
    }
  }, [isMobile, isOpen]);

  const [chatType, setChatType] = useState<
    import("@/lib/unifiedChatClient").UnifiedChatType
  >("chat");
  const [expandedPromptCard, setExpandedPromptCard] =
    useState<UnifiedChatType | null>(null);
  const [researchDeepAnalysis, setResearchDeepAnalysis] = useState(false);
  const unifiedSession = useOptionalCohiChatSession();
  const allowedChatTypes = useUnifiedChatPermissions(tenantId);

  const legacyChat = useCohiChat({
    tenantId,
    enabled: isOpen && !unifiedSession,
    chatType,
    researchDeepAnalysis,
  });

  const {
    messages,
    isLoading,
    isSessionRunning,
    sessionId: currentSessionId,
    legacyRef,
    suggestedQuestions,
    sendMessage,
    clearMessages,
    newSession,
    chatSessions,
    isLoadingSessions,
    isLoadingSession,
    loadingSessionId = null,
    fetchSessions,
    fetchWorkbenchCanvasSessions = async () => {},
    loadSession,
    deleteSession,
    renameSession,
    conversationForkLinks,
    hasPendingForkCarryOver,
    dismissPendingForkLink,
    restoreDismissedForkLink,
    beginChatTypeFork,
    undoChatTypeFork,
    clearConversationBinding,
    stageModeHandoff,
    workbenchChatScope = null,
    workbenchScopePinned = false,
    workbenchPinnedScopeLabel = null,
    pendingScopeSwitchTarget = null,
    setPendingScopeSwitchTarget = () => {},
    scopeMismatchActions = null,
    acceptPendingWorkbenchScopeSwitch = async () => {},
    cancelPendingWorkbenchScopeSwitch = () => {},
    syncWorkbenchChatToActiveContext = async () => {},
    resetWorkbenchStreamUiForHandoff = () => {},
    resolveScopeMismatchActions = () => {},
    applyWorkbenchDashboardSuggestion = () => {},
  } = unifiedSession ?? legacyChat;

  const activeChatType = unifiedSession?.chatType ?? chatType;

  const workbenchCanvasThreadCount =
    activeChatType === "workbench" ? chatSessions.length : 0;

  const workbenchCanvasDisplayLabel =
    workbenchChatScope?.label ??
    getLatestWorkbenchActiveContext()?.tabTitle ??
    null;

  const workbenchHistoryScopeSubtitle =
    activeChatType === "workbench" && workbenchCanvasDisplayLabel
      ? `Threads for ${workbenchCanvasDisplayLabel}${
          workbenchCanvasThreadCount > 0
            ? ` (${workbenchCanvasThreadCount})`
            : ""
        }`
      : null;

  const showWorkbenchCanvasThreadsControl =
    activeChatType === "workbench" &&
    isMyDashboardCanvasPath(pathname) &&
    !!workbenchCanvasDisplayLabel;

  const shouldScopeHistoryToActiveCanvas =
    isMyDashboardCanvasPath(pathname) &&
    isUnifiedChatClientEnabled();

  const startNewChatSession = useCallback(async () => {
    setResearchViewOnly(false);
    setAttachedUploadIds([]);
    setExpandedPromptCard(null);
    const type = unifiedSession?.chatType ?? chatType;
    if (type === "workbench") {
      markWorkbenchNewChatPendingFirstSend();
    }
    await newSession();
  }, [newSession, unifiedSession?.chatType, chatType]);

  const setActiveChatType = unifiedSession?.setChatType ?? setChatType;
  const activeResearchDeepAnalysis =
    unifiedSession?.researchDeepAnalysis ?? researchDeepAnalysis;
  const setActiveResearchDeepAnalysis =
    unifiedSession?.setResearchDeepAnalysis ?? setResearchDeepAnalysis;

  const fetchHistoryForCurrentView = useCallback(() => {
    if (shouldScopeHistoryToActiveCanvas) {
      void fetchWorkbenchCanvasSessions();
      return;
    }
    void fetchSessions();
  }, [fetchSessions, fetchWorkbenchCanvasSessions, shouldScopeHistoryToActiveCanvas]);

  const openWorkbenchCanvasThreads = useCallback(() => {
    setShowHistory(true);
  }, []);

  const buildCarryOverForNewCanvas = useCallback(
    (pendingUserMessage?: string): CarryOverContext | undefined => {
      if (!currentSessionId) return undefined;
      const snapshot = [...messages];
      const pending = pendingUserMessage?.trim();
      if (
        pending &&
        !snapshot.some((m) => m.role === "user" && m.content.trim() === pending)
      ) {
        snapshot.push({ role: "user", content: pending });
      }
      if (snapshot.length === 0) return undefined;
      const summary = buildCarryOverContext(snapshot, { fromChatType: "workbench" });
      if (!summary.trim()) return undefined;
      return {
        fromConversationId: currentSessionId,
        fromChatType: "workbench",
        fromTitle: workbenchChatScope?.label ?? "Previous canvas",
        summary,
      };
    },
    [currentSessionId, messages, workbenchChatScope?.label],
  );

  const workbenchScopeGuard = useWorkbenchChatScopeGuard({
    activeChatType,
    workbenchChatScope,
    workbenchScopePinned,
    workbenchPinnedScopeLabel,
    pendingScopeSwitchTarget,
    setPendingScopeSwitchTarget,
    scopeMismatchActions,
    acceptPendingWorkbenchScopeSwitch,
    cancelPendingWorkbenchScopeSwitch,
    syncChatToActiveCanvas: syncWorkbenchChatToActiveContext,
    resolveScopeMismatchActions,
    sendMessage,
    buildCarryOverForNewCanvas,
    prepareForNewCanvasHandoff: resetWorkbenchStreamUiForHandoff,
    onNewCanvasPreflightDismiss: (message) => setInput(message),
  });

  useEffect(() => {
    if (
      activeChatType === "workbench" &&
      isMyDashboardCanvasPath(pathname) &&
      isUnifiedChatClientEnabled()
    ) {
      void fetchWorkbenchCanvasSessions();
    }
  }, [activeChatType, pathname, fetchWorkbenchCanvasSessions, workbenchChatScope?.id]);

  const { uploads: availableUploads, listUploads: listAvailableUploads } =
    useResearchUploads(tenantId);

  const showDatasetAttach =
    isUnifiedChatClientEnabled() &&
    activeChatType !== "insight_builder";

  const linkUploadsToCurrentConversation = useCallback(
    async (uploadIds: string[]) => {
      if (!currentSessionId || uploadIds.length === 0 || !isUnifiedChatClientEnabled())
        return;
      try {
        const client = createUnifiedChatClient(tenantId);
        await client.linkConversationDatasets(
          currentSessionId,
          uploadIds,
          activeChatType,
        );
      } catch (err) {
        console.warn("[CohiChat] Failed to link datasets to conversation:", err);
      }
    },
    [currentSessionId, tenantId, activeChatType],
  );

  const handleDetachUpload = useCallback(
    async (uploadId: string) => {
      setAttachedUploadIds((prev) => prev.filter((id) => id !== uploadId));
      if (currentSessionId && isUnifiedChatClientEnabled()) {
        try {
          const client = createUnifiedChatClient(tenantId);
          await client.unlinkConversationDataset(currentSessionId, uploadId);
        } catch (err) {
          console.warn("[CohiChat] Failed to unlink dataset:", err);
        }
      }
    },
    [currentSessionId, tenantId],
  );

  useEffect(() => {
    if (showDatasetAttach) void listAvailableUploads();
  }, [showDatasetAttach, listAvailableUploads]);

  /** Keep conversation ↔ upload links in sync so follow-up turns resolve datasets server-side. */
  useEffect(() => {
    if (
      currentSessionId &&
      attachedUploadIds.length > 0 &&
      isUnifiedChatClientEnabled()
    ) {
      void linkUploadsToCurrentConversation(attachedUploadIds);
    }
  }, [currentSessionId, attachedUploadIds, linkUploadsToCurrentConversation]);

  /** Only the latest assistant draft preview may be edited; older drafts stay read-only. */
  const lastInsightBuilderDraftIdx = useMemo(() => {
    if (activeChatType !== "insight_builder") return -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "assistant" && m.insightBuilderDraft) return i;
    }
    return -1;
  }, [messages, activeChatType]);

  const navigateWorkbenchOnSubmit = useCallback(
    (forceNewConversation: boolean) => {
      if (
        activeChatType !== "workbench" ||
        !isUnifiedChatClientEnabled()
      ) {
        return;
      }
      if (!isMobile) {
        setShellExpandMode("split");
      }
      const onDashboard =
        typeof window !== "undefined" &&
        isMyDashboardCanvasPath(window.location.pathname);
      if (!onDashboard) {
        navigateForWorkbenchChatSubmit(navigate, { forceNewConversation });
      }
    },
    [activeChatType, navigate, isMobile, setShellExpandMode],
  );

  useEffect(() => {
    if (!isUnifiedChatClientEnabled()) return;
    if (!allowedChatTypes.includes(activeChatType)) {
      setActiveChatType(allowedChatTypes[0] ?? "chat");
    }
  }, [allowedChatTypes, activeChatType, setActiveChatType]);

  /** Default to workbench chat when navigating to a saved canvas, not on every mode change. */
  useEffect(() => {
    if (!isUnifiedChatClientEnabled()) return;
    const canvasId = getMyDashboardCanvasIdFromPath(pathname);
    if (!canvasId) {
      lastAutoWorkbenchCanvasIdRef.current = null;
      return;
    }
    if (!allowedChatTypes.includes("workbench")) return;
    if (lastAutoWorkbenchCanvasIdRef.current === canvasId) return;
    lastAutoWorkbenchCanvasIdRef.current = canvasId;
    setActiveChatType("workbench");
  }, [pathname, allowedChatTypes, setActiveChatType]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<WorkbenchEditWidgetEventDetail>).detail;
      if (!detail?.widgetId || !detail.widgetTitle) return;
      setActiveChatType("workbench");
      if (isUnifiedChatClientEnabled()) {
        bindWorkbenchEditDraftScope(detail);
        if (!isMobile) {
          setShellExpandMode("split");
        }
        navigateForWorkbenchWidgetEdit(navigate, detail);
        setWorkbenchEditingWidget({
          id: detail.widgetId,
          title: detail.widgetTitle,
        });
      }
      const autoMessage = detail.message?.trim();
      if (autoMessage) {
        void sendMessage(autoMessage, { forceNewConversation: false });
      } else {
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    };
    window.addEventListener(COHI_WORKBENCH_EDIT_WIDGET_EVENT, handler);
    return () =>
      window.removeEventListener(COHI_WORKBENCH_EDIT_WIDGET_EVENT, handler);
  }, [sendMessage, setActiveChatType, navigate, isMobile, setShellExpandMode]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<WorkbenchEditingWidgetStateDetail>).detail;
      if (!detail) return;
      if (detail.widgetId && detail.widgetTitle) {
        setWorkbenchEditingWidget({
          id: detail.widgetId,
          title: detail.widgetTitle,
        });
      } else {
        setWorkbenchEditingWidget(null);
      }
    };
    window.addEventListener(COHI_WORKBENCH_EDITING_WIDGET_STATE_EVENT, handler);
    return () =>
      window.removeEventListener(
        COHI_WORKBENCH_EDITING_WIDGET_STATE_EVENT,
        handler,
      );
  }, []);

  useEffect(() => {
    if (layout === "shell") return;
    const docEl = document.documentElement;
    const docked = isOpen && !isFullscreen && !isMobile;
    if (!docked) {
      docEl.style.setProperty("--cohi-global-chat-reserve", "0px");
      docEl.removeAttribute("data-cohi-chat-open");
      return;
    }
    const apply = () => {
      const reservePx = Math.min(480, Math.max(0, window.innerWidth - 16));
      docEl.style.setProperty("--cohi-global-chat-reserve", `${reservePx}px`);
      docEl.setAttribute("data-cohi-chat-open", "");
    };
    apply();
    window.addEventListener("resize", apply);
    return () => {
      window.removeEventListener("resize", apply);
      docEl.style.setProperty("--cohi-global-chat-reserve", "0px");
      docEl.removeAttribute("data-cohi-chat-open");
    };
  }, [isOpen, isFullscreen, isMobile, layout]);

  const [showHistory, setShowHistory] = useState(false);
  const [preferredExportFormat, setPreferredExportFormat] =
    useState<QuickExportFormat>(() => {
      if (typeof window === "undefined") return "ppt";
      const stored = window.localStorage.getItem(CHAT_EXPORT_FORMAT_KEY);
      return stored === "pdf" ? "pdf" : "ppt";
    });

  // Auto-scroll to bottom when messages change (scroll the panel only, not the page)
  useEffect(() => {
    const container = messagesScrollRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // --- "Open in Workbench" handler ---
  const [isCreatingCanvas, setIsCreatingCanvas] = useState(false);

  const hasVisualizationMessages = messages.some(
    (m) => m.role === "assistant" && m.visualization && !m.error
  );

  const handleOpenInWorkbench = useCallback(async () => {
    const canvasItems = convertChatToCanvasItems(messages, vizTypeOverrides);
    if (canvasItems.length === 0) {
      toast({ title: "No visualizations to export", description: "Chat with Cohi to generate some charts first.", variant: "destructive" });
      return;
    }

    setIsCreatingCanvas(true);
    try {
      const qs = tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : '';
      const data = await api.request<{ id: string }>(`/api/workbench/canvases${qs}`, {
        method: "POST",
        body: JSON.stringify({
          title: `Chat Export – ${new Date().toLocaleDateString()}`,
          layoutVersion: "freeform-v1",
          layout: canvasItems,
          annotations: [],
          background: { type: "color", value: "#ffffff" },
          uploadsMeta: [],
        }),
      });

      toast({ title: "Workbench created", description: `${canvasItems.length} visualization(s) exported.` });
      // Navigating away unmounts the chat panel in both host modes:
      // 1) floating overlay on dashboard pages
      // 2) dedicated /data-chat route
      //
      // Calling `onClose()` here is unsafe because on /data-chat it is
      // implemented as `navigate(-1)`, which can win the race and send the
      // browser to `about:blank` before the Workbench navigation lands.
      navigate(`/my-dashboard?canvas=${data.id}`);
    } catch (err) {
      toast({ title: "Export failed", description: err instanceof Error ? err.message : "Try again", variant: "destructive" });
    } finally {
      setIsCreatingCanvas(false);
    }
  }, [messages, vizTypeOverrides, toast, onClose, navigate, tenantId]);

  const createSingleVisualizationCanvas = useCallback(
    async (
      visualization: VisualizationConfig,
      question: string,
      options?: { sqlQuery?: string },
    ): Promise<string> => {
      const qs = tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : "";
      const itemId = `chat-build-${Date.now()}`;
      let layout: CanvasLayoutItem[];

      if (options?.sqlQuery) {
        const groupId = `chat-build-group-${Date.now()}`;
        layout = [
          createLayoutItem(
            groupId,
            "widget_group",
            {
              type: "widget_group",
              groupId,
              title: visualization.title || "Chat Visualization",
              sectionType: "company-scorecard",
              widgetIds: [],
              items: [
                {
                  kind: "cohi" as const,
                  id: itemId,
                  sql: options.sqlQuery,
                  title: visualization.title || "Chat Visualization",
                  vizConfig: visualization,
                  explanation: question.slice(0, 200),
                },
              ],
            },
            { x: 20, y: 20, w: 700, h: 500 },
          ),
        ];
      } else {
        layout = [
          createLayoutItem(
            itemId,
            "chart",
            { type: "chart", config: visualization },
            { x: 20, y: 20, w: 420, h: 280 },
          ),
        ];
      }

      const data = await api.request<{ id: string }>(`/api/workbench/canvases${qs}`, {
        method: "POST",
        body: JSON.stringify({
          title: visualization.title || "Chat Visualization",
          layoutVersion: "freeform-v1",
          layout,
          annotations: [],
          background: { type: "color", value: "#ffffff" },
          uploadsMeta: [],
        }),
      });

      return data.id;
    },
    [tenantId],
  );

  // Focus input when panel opens without scrolling the host page (e.g. /insights shell)
  useEffect(() => {
    if (!isOpen) return;
    const id = window.setTimeout(() => {
      inputRef.current?.focus({ preventScroll: layout === "shell" });
    }, 100);
    return () => window.clearTimeout(id);
  }, [isOpen, layout]);

  /**
   * Handle voice recording
   */
  const startVoiceRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: "audio/webm",
      });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, {
          type: "audio/webm",
        });
        stream.getTracks().forEach((track) => track.stop());

        // Send audio for transcription (and optional voice provider for reply)
        const formData = new FormData();
        formData.append("audio", audioBlob, "voice.webm");
        formData.append("voiceProvider", voiceProvider);

        try {
          const response = await fetch("/api/podcast/cohi/ask", {
            method: "POST",
            body: formData,
          });

          if (response.ok) {
            const reader = response.body?.getReader();
            if (reader) {
              // Process streamed response
              toast({
                title: "Voice processed",
                description: "Your question has been received.",
              });
            }
          }
        } catch (error) {
          console.error("Voice processing error:", error);
        }
      };

      mediaRecorder.start();
      setIsListening(true);
    } catch (error) {
      toast({
        title: "Microphone access denied",
        description: "Please enable microphone access to use voice features.",
        variant: "destructive",
      });
    }
  }, [toast, voiceProvider]);

  const stopVoiceRecording = useCallback(() => {
    if (mediaRecorderRef.current && isListening) {
      mediaRecorderRef.current.stop();
      setIsListening(false);
    }
  }, [isListening]);

  /**
   * Text-to-speech: OpenAI streaming voice or Gemini transcript + browser TTS
   * voiceProvider 'openai' = /cohi/ask returns PCM16 audio; 'gemini' = transcript only, we use speechSynthesis
   */
  const speakResponse = useCallback(
    async (text: string) => {
      if (!voiceEnabled || !text) return;

      setIsSpeaking(true);

      try {
        if (voiceProvider === "gemini") {
          const response = await fetch("/api/podcast/cohi/ask", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question: text, voiceProvider: "gemini" }),
          });
          if (!response.ok) throw new Error("Gemini reply failed");
          const reader = response.body?.getReader();
          if (!reader) return;
          const decoder = new TextDecoder();
          let buffer = "";
          let transcript = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const line of lines) {
              if (line.startsWith("data: ")) {
                try {
                  const data = JSON.parse(line.slice(6));
                  if (data.type === "transcript" && data.data)
                    transcript += data.data;
                  if (data.type === "done" && data.transcript)
                    transcript = data.transcript;
                } catch (e) {}
              }
            }
          }
          const toSpeak = transcript.trim() || text;
          if (toSpeak && "speechSynthesis" in window) {
            const u = new SpeechSynthesisUtterance(toSpeak);
            u.onend = () => setIsSpeaking(false);
            u.onerror = () => setIsSpeaking(false);
            window.speechSynthesis.speak(u);
          } else {
            setIsSpeaking(false);
          }
          return;
        }

        audioContextRef.current = audioContextRef.current || new AudioContext();
        const audioContext = audioContextRef.current;
        const response = await fetch("/api/podcast/cohi/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: text, voiceProvider: "openai" }),
        });
        if (!response.ok) throw new Error("Voice synthesis failed");
        const reader = response.body?.getReader();
        if (!reader) return;
        const decoder = new TextDecoder();
        let buffer = "";
        const audioChunks: ArrayBuffer[] = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.type === "audio" && data.data) {
                  const binaryStr = atob(data.data);
                  const bytes = new Uint8Array(binaryStr.length);
                  for (let i = 0; i < binaryStr.length; i++)
                    bytes[i] = binaryStr.charCodeAt(i);
                  audioChunks.push(bytes.buffer);
                }
              } catch (e) {}
            }
          }
        }
        if (audioChunks.length > 0) {
          const totalLength = audioChunks.reduce(
            (acc, chunk) => acc + chunk.byteLength,
            0
          );
          const combinedAudio = new Uint8Array(totalLength);
          let offset = 0;
          for (const chunk of audioChunks) {
            combinedAudio.set(new Uint8Array(chunk), offset);
            offset += chunk.byteLength;
          }
          const pcm16 = new Int16Array(combinedAudio.buffer);
          const floatSamples = new Float32Array(pcm16.length);
          for (let i = 0; i < pcm16.length; i++)
            floatSamples[i] = pcm16[i] / 32768;
          const audioBuffer = audioContext.createBuffer(
            1,
            floatSamples.length,
            24000
          );
          audioBuffer.getChannelData(0).set(floatSamples);
          const source = audioContext.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(audioContext.destination);
          source.onended = () => setIsSpeaking(false);
          source.start();
        } else {
          setIsSpeaking(false);
        }
      } catch (error) {
        console.error("Voice synthesis error:", error);
        setIsSpeaking(false);
      }
    },
    [voiceEnabled, voiceProvider]
  );

  /**
   * Handle send message
   */
  const handleSend = async () => {
    const isResearchMode =
      isUnifiedChatClientEnabled() && activeChatType === "research";
    if (isResearchMode && researchViewOnly) return;
    const hasDatasetAttach = attachedUploadIds.length > 0;
    if (!input.trim() && !hasDatasetAttach) return;
    if (isSessionRunning || (isLoading && !!currentSessionId)) {
      return;
    }

    const userTurnCount = messages.filter((m) => m.role === "user").length;
    const forceNewConversation =
      activeChatType === "workbench"
        ? shouldForceNewWorkbenchConversation({
            isShellCompact,
            currentSessionId,
            userTurnCount,
          })
        : isShellCompact;
    if (isResearchMode) {
      setShellExpandMode("full");
    } else {
      expandShellIfCompact();
    }
    if (forceNewConversation) {
      setResearchViewOnly(false);
    }

    navigateWorkbenchOnSubmit(forceNewConversation);

    const idsForSend = [...attachedUploadIds];
    const researchIdsForNewSession =
      isResearchMode &&
      idsForSend.length > 0 &&
      (forceNewConversation || (!currentSessionId && !legacyRef))
        ? idsForSend
        : undefined;

    const messageText = input.trim() || "Analyze the attached dataset.";
    const sendOpts = {
      forceNewConversation,
      datasetUploadIds: idsForSend.length > 0 ? idsForSend : undefined,
      researchUploadIds: researchIdsForNewSession,
    };

    if (activeChatType === "workbench") {
      const sent = await workbenchScopeGuard.preflightWorkbenchSend(
        messageText,
        sendOpts,
      );
      if (!sent) {
        setInput("");
        return;
      }
    } else {
      await sendMessage(messageText, sendOpts);
    }

    if (researchIdsForNewSession) {
      setAttachedUploadIds([]);
    }

    setInput("");
  };

  const handleAttachedUploadIdsChange = useCallback(
    (ids: string[]) => {
      setAttachedUploadIds(ids);
      const added = ids.filter((id) => !attachedUploadIds.includes(id));
      if (added.length > 0 && currentSessionId) {
        void linkUploadsToCurrentConversation(added);
      }
    },
    [attachedUploadIds, currentSessionId, linkUploadsToCurrentConversation],
  );

  const handleLoadSession = useCallback(
    async (sessionId: string) => {
      const result = await loadSession(sessionId);
      // Sync UI mode to the loaded conversation (fork chips, history sidebar, etc.).
      // Without this, resuming a parent "chat" thread while still on "research" hides
      // messages behind the empty research workspace (no legacyRef).
      if (result.chatType) {
        setActiveChatType(result.chatType);
      }
      setAttachedUploadIds(result.datasetUploadIds);
      void listAvailableUploads();
      if (result.chatType === "workbench" && isUnifiedChatClientEnabled()) {
        if (!isMobile && layout === "shell") {
          setShellExpandMode(
            isMyDashboardCanvasPath(pathname) ? "split" : "full",
          );
        }
        const scopeType = result.scope?.type;
        const scopeId = result.scope?.id;
        if (
          scopeId &&
          (scopeType === "canvas" || scopeType === "draft") &&
          !isMyDashboardCanvasPath(pathname)
        ) {
          navigateForWorkbenchConversationResume(navigate, {
            conversationId: sessionId,
            scopeType,
            scopeId,
          });
        }
      }
    },
    [
      loadSession,
      setActiveChatType,
      listAvailableUploads,
      layout,
      isMobile,
      pathname,
      setShellExpandMode,
      navigate,
    ],
  );

  useEffect(() => {
    const onResume = (e: Event) => {
      const detail = (e as CustomEvent<{
        conversationId: string;
        chatType: import("@/lib/unifiedChatClient").UnifiedChatType;
      }>).detail;
      if (!detail?.conversationId) return;
      const chatType = detail.chatType ?? "chat";
      if (layout === "shell") {
        if (
          chatType === "workbench" &&
          isMyDashboardCanvasPath(pathname) &&
          !isMobile
        ) {
          setShellExpandMode("split");
        } else {
          setShellExpandMode("full");
        }
      }
      setActiveChatType(chatType);
      void handleLoadSession(detail.conversationId);
    };
    window.addEventListener("cohi-chat-resume", onResume);
    return () => window.removeEventListener("cohi-chat-resume", onResume);
  }, [
    handleLoadSession,
    setActiveChatType,
    layout,
    setShellExpandMode,
    pathname,
    isMobile,
  ]);

  /**
   * Handle key press (Enter to send)
   */
  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  useEffect(() => {
    resizeChatInput();
  }, [input, resizeChatInput]);

  const dispatchSuggestion = useCallback(
    async (question: string, forceNewConversation: boolean) => {
      expandShellIfCompact();
      navigateWorkbenchOnSubmit(forceNewConversation);
      const opts = { forceNewConversation };
      if (activeChatType === "workbench") {
        const sent = await workbenchScopeGuard.preflightWorkbenchSend(
          question,
          opts,
        );
        if (!sent) return;
      } else {
        await sendMessage(question, opts);
      }
      setInput("");
    },
    [
      expandShellIfCompact,
      navigateWorkbenchOnSubmit,
      sendMessage,
      activeChatType,
      workbenchScopeGuard,
    ],
  );

  /**
   * Handle suggested question click (optionally for a different chat type).
   */
  const handleSuggestionClick = useCallback(
    (question: string, targetChatType?: UnifiedChatType) => {
      const userTurnCount = messages.filter((m) => m.role === "user").length;
      const chatTypeForSend = targetChatType ?? activeChatType;
      const forceNewConversation =
        chatTypeForSend === "workbench"
          ? shouldForceNewWorkbenchConversation({
              isShellCompact,
              currentSessionId,
              userTurnCount,
            })
          : isShellCompact;
      if (chatTypeForSend !== activeChatType) {
        pendingSuggestionRef.current = {
          question,
          chatType: chatTypeForSend,
          forceNewConversation,
        };
        setActiveChatType(chatTypeForSend);
        return;
      }

      dispatchSuggestion(question, forceNewConversation);
    },
    [
      activeChatType,
      dispatchSuggestion,
      isShellCompact,
      setActiveChatType,
    ],
  );

  useEffect(() => {
    const pending = pendingSuggestionRef.current;
    if (!pending || pending.chatType !== activeChatType) return;
    pendingSuggestionRef.current = null;
    dispatchSuggestion(pending.question, pending.forceNewConversation);
  }, [activeChatType, dispatchSuggestion]);

  const promptCardsLayout = resolveChatTypePromptCardsLayout(
    layout,
    shellExpandMode,
    layout === "rail" && isFullscreen,
  );
  const isTallEmptyPromptCards =
    messages.length === 0 && promptCardsLayout === "row";
  const isSharedResearchViewOnly =
    isUnifiedChatClientEnabled() &&
    activeChatType === "research" &&
    researchViewOnly;
  const showResearchWorkspace =
    activeChatType === "research" &&
    isUnifiedChatClientEnabled() &&
    (messages.length > 0 || !!legacyRef);
  /** Backfilled research has no transcript messages; workspace still counts as an open session. */
  const showEmptyPromptCards =
    messages.length === 0 &&
    promptCardsLayout !== "hidden" &&
    !isSharedResearchViewOnly &&
    !showResearchWorkspace &&
    !(activeChatType === "research" && isUnifiedChatClientEnabled() && isLoadingSession);
  /** Research transcript lives in {@link UnifiedChatResearchWorkspace}; skip empty flex-1 messages pane. */
  const showStandardMessagesPane =
    !isShellCompact &&
    !(
      activeChatType === "research" &&
      isUnifiedChatClientEnabled() &&
      showResearchWorkspace
    );
  /** Full-page shell with no messages: prompt cards + input centered (same as `/` landing). */
  const isCenteredEmptyLanding =
    layout === "shell" &&
    shellExpandMode === "full" &&
    showEmptyPromptCards;

  const [workbenchCanvasPopulated, setWorkbenchCanvasPopulated] = useState(
    () => isWorkbenchCanvasPopulated(),
  );
  useEffect(() => {
    const sync = () => setWorkbenchCanvasPopulated(isWorkbenchCanvasPopulated());
    sync();
    window.addEventListener(WORKBENCH_CANVAS_SAVED_EVENT, sync);
    return () => window.removeEventListener(WORKBENCH_CANVAS_SAVED_EVENT, sync);
  }, [pathname, isOpen, showEmptyPromptCards]);

  const emptyStateSuggestionsByType = useMemo(
    () => ({
      ...CHAT_TYPE_DEFAULT_SUGGESTIONS,
      workbench: resolveWorkbenchTopicSuggestions(workbenchCanvasPopulated),
    }),
    [workbenchCanvasPopulated],
  );

  const shellBodyFillsPane =
    !isShellCompact && (isCenteredEmptyLanding || showStandardMessagesPane);

  const handlePromptCardSelect = useCallback(
    (chatType: UnifiedChatType) => {
      setExpandedPromptCard((current) =>
        current === chatType ? null : chatType,
      );
      setActiveChatType(chatType);
    },
    [setActiveChatType],
  );

  useEffect(() => {
    if (activeChatType !== "research" || !legacyRef) {
      setResearchViewOnly(false);
    }
  }, [activeChatType, legacyRef]);

  const forkUndoToastRef = useRef<{
    dismiss: () => void;
    update: (props: Parameters<ReturnType<typeof toast>["update"]>[0]) => void;
  } | null>(null);

  const handleDismissPendingForkLink = useCallback(() => {
    dismissPendingForkLink();

    const carriedOverToastProps = {
      title: `Started a new ${formatChatTypeLabel(activeChatType)} chat`,
      description: "Context from your previous conversation was carried over.",
      action: (
        <ToastAction
          altText="Undo chat type switch"
          onClick={() => {
            forkUndoToastRef.current?.dismiss();
            forkUndoToastRef.current = null;
            const restored = undoChatTypeFork?.();
            if (restored) {
              setActiveChatType(restored.chatType);
            }
          }}
        >
          Undo
        </ToastAction>
      ),
      duration: 8000,
      open: true,
    };

    const removalToastProps = {
      title: `New ${formatChatTypeLabel(activeChatType)} chat`,
      description:
        "Context from your previous conversation was removed from this chat.",
      action: (
        <ToastAction
          altText="Restore link to previous chat"
          onClick={() => {
            if (restoreDismissedForkLink()) {
              forkUndoToastRef.current?.update(carriedOverToastProps);
            }
          }}
        >
          Undo
        </ToastAction>
      ),
      duration: 8000,
      open: true,
    };

    const existing = forkUndoToastRef.current;
    if (existing?.update) {
      existing.update(removalToastProps);
      return;
    }

    existing?.dismiss?.();
    window.setTimeout(() => {
      forkUndoToastRef.current = toast(removalToastProps);
    }, 0);
  }, [
    activeChatType,
    dismissPendingForkLink,
    restoreDismissedForkLink,
    setActiveChatType,
    toast,
    undoChatTypeFork,
  ]);

  const handleChatTypeChange = useCallback(
    (next: UnifiedChatType) => {
      setExpandedPromptCard(null);
      if (next === "insight_builder") {
        setAttachedUploadIds([]);
      }
      if (next !== "research") {
        setResearchViewOnly(false);
      }

      const prev = activeChatType;
      const shouldFork =
        isUnifiedChatClientEnabled() &&
        beginChatTypeFork &&
        shouldForkOnChatTypeChange({
          previousChatType: prev,
          nextChatType: next,
          currentSessionId,
          messageCount: messages.length,
        });

      const stageWorkbenchStructuralHandoff = (
        fromType: UnifiedChatType,
        fromConversationId: string,
        fromTitle?: string,
      ) => {
        if (fromType !== "workbench") return;
        if (next !== "research" && next !== "insight_builder") return;
        const handoff = buildModeHandoffFromWorkbench({
          fromChatType: fromType,
          fromConversationId,
          fromTitle,
          pathname,
        });
        stageModeHandoff(handoff);
      };

      if (shouldFork) {
        const fromTitle =
          chatSessions.find((s) => s.id === currentSessionId)?.title ??
          (messages.find((m) => m.role === "user")?.content.trim().slice(0, 80) ||
            "Previous chat");
        const forkConversationId = currentSessionId!;
        void (async () => {
          const summary = await resolveCarryOverSummary({
            messages,
            fromChatType: prev,
            legacyRef: prev === "research" ? legacyRef : null,
            tenantId,
          });
          if (summary.trim()) {
            beginChatTypeFork(
              {
                fromConversationId: forkConversationId,
                fromChatType: prev,
                fromTitle,
                summary,
              },
              prev,
            );
            forkUndoToastRef.current?.dismiss();
            forkUndoToastRef.current = toast({
              title: `Started a new ${formatChatTypeLabel(next)} chat`,
              description: "Context from your previous conversation was carried over.",
              action: (
                <ToastAction
                  altText="Undo chat type switch"
                  onClick={() => {
                    forkUndoToastRef.current?.dismiss();
                    forkUndoToastRef.current = null;
                    const restored = undoChatTypeFork?.();
                    if (restored) {
                      setActiveChatType(restored.chatType);
                    }
                  }}
                >
                  Undo
                </ToastAction>
              ),
              duration: 8000,
            });
          }
          stageWorkbenchStructuralHandoff(prev, forkConversationId, fromTitle);
        })();
      } else if (
        prev === "workbench" &&
        (next === "research" || next === "insight_builder")
      ) {
        if (currentSessionId) {
          clearConversationBinding();
          stageWorkbenchStructuralHandoff(
            prev,
            currentSessionId,
            chatSessions.find((s) => s.id === currentSessionId)?.title,
          );
        }
      }

      setActiveChatType(next);
    },
    [
      activeChatType,
      beginChatTypeFork,
      chatSessions,
      clearConversationBinding,
      currentSessionId,
      legacyRef,
      messages,
      pathname,
      setActiveChatType,
      stageModeHandoff,
      tenantId,
      toast,
      undoChatTypeFork,
    ],
  );

  useEffect(() => {
    setExpandedPromptCard(null);
  }, [pathname]);

  useEffect(() => {
    if (messages.length > 0) {
      setExpandedPromptCard(null);
    }
  }, [messages.length]);

  /**
   * Save a single visualization to workbench as a new canvas
   */
  const handleSaveToWorkbench = useCallback(async (
    visualization: VisualizationConfig,
    question: string,
    sqlQuery?: string,
  ) => {
    try {
      const canvasId = await createSingleVisualizationCanvas(visualization, question, {
        sqlQuery,
      });

      toast({ title: "Saved to Workbench", description: "Visualization saved as a new canvas." });
      navigate(`/my-dashboard?canvas=${canvasId}`);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to save to workbench",
        variant: "destructive",
      });
    }
  }, [createSingleVisualizationCanvas, toast, navigate, onClose]);

  const handleBuildInCanvas = useCallback(
    async (
      visualization: VisualizationConfig,
      question: string,
      sqlQuery?: string,
    ) => {
      try {
        const canvasId = await createSingleVisualizationCanvas(visualization, question, {
          sqlQuery,
        });
        toast({
          title: "Opening PowerPoint Editor",
          description: "Chart sent to Workbench and seeded as slide 1.",
        });
        navigate(`/my-dashboard/${canvasId}?reportBuilder=1`);
      } catch (error: any) {
        toast({
          title: "Couldn't open PowerPoint Editor",
          description: error.message || "Please try again.",
          variant: "destructive",
        });
      }
    },
    [createSingleVisualizationCanvas, toast, onClose, navigate],
  );

  /**
   * Export visualization as PDF (chart image on page 1, data table on page 2).
   * If the chart DOM hasn't been rendered (no messageId), falls back to a
   * data-only PDF so the user still gets something.
   */
  const handleDownloadPDF = async (override?: ExportOverride) => {
    const viz = override?.visualization;
    const title = override?.title;
    const desc = override?.description;
    const messageId = override?.messageId;
    if (!viz) return;

    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({
        orientation: "landscape",
        unit: "pt",
        format: "letter",
      });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 40;
      const contentWidth = pageWidth - margin * 2;

      const drawHeader = (pageTitle: string) => {
        doc.setFontSize(18);
        doc.setTextColor(30, 41, 59);
        doc.setFont(undefined as any, "bold");
        doc.text(pageTitle, margin, margin + 10);
        doc.setFont(undefined as any, "normal");

        const chartType = viz.type || "chart";
        doc.setFontSize(10);
        doc.setTextColor(100, 116, 139);
        doc.text(
          `Chart Type: ${chartType.charAt(0).toUpperCase() + chartType.slice(1)}`,
          margin,
          margin + 28
        );
      };

      const drawFooter = () => {
        doc.setFontSize(8);
        doc.setTextColor(148, 163, 184);
        doc.text(
          `Generated by Coheus on ${new Date().toLocaleDateString()}`,
          margin,
          pageHeight - 20
        );
        doc.text("coheus.ai", pageWidth - margin - 50, pageHeight - 20);
      };

      // --- Page 1: Chart image + optional description ---
      drawHeader(title || viz.title || "Visualization");

      let currentY = margin + 48;
      if (desc) {
        doc.setFontSize(11);
        doc.setTextColor(71, 85, 105);
        const splitDescription = doc.splitTextToSize(desc, contentWidth);
        doc.text(splitDescription, margin, currentY);
        currentY += splitDescription.length * 14 + 10;
      }

      // Try to capture the rendered chart as an image
      let chartEmbedded = false;
      if (messageId) {
        try {
          const blob = await captureChartAsBlob(messageId);
          if (blob) {
            const dataUrl: string = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });

            // Determine intrinsic aspect ratio from the captured image so we
            // don't stretch the chart.
            const { width: imgW, height: imgH } = await new Promise<{
              width: number;
              height: number;
            }>((resolve) => {
              const im = new window.Image();
              im.onload = () => resolve({ width: im.width, height: im.height });
              im.onerror = () => resolve({ width: 1024, height: 576 });
              im.src = dataUrl;
            });

            const maxImgHeight = pageHeight - currentY - margin - 24;
            const ratio = imgW / imgH || 16 / 9;
            let drawW = contentWidth;
            let drawH = drawW / ratio;
            if (drawH > maxImgHeight) {
              drawH = maxImgHeight;
              drawW = drawH * ratio;
            }
            const drawX = margin + (contentWidth - drawW) / 2;
            doc.addImage(
              dataUrl,
              "PNG",
              drawX,
              currentY,
              drawW,
              drawH,
              undefined,
              "FAST"
            );
            chartEmbedded = true;
          }
        } catch (captureErr) {
          console.warn("Chart capture for PDF failed:", captureErr);
        }
      }

      if (!chartEmbedded) {
        doc.setFontSize(10);
        doc.setTextColor(148, 163, 184);
        doc.text(
          "Chart preview unavailable — see data table on the next page.",
          margin,
          currentY + 20
        );
      }

      drawFooter();

      // --- Page 2: Data table ---
      const data = viz.data || [];
      const hasTabularData =
        data.length > 0 && Object.keys(data[0] || {}).length > 0;

      if (hasTabularData) {
        doc.addPage();
        drawHeader(`${title || viz.title || "Visualization"} — Data`);

        let tableY = margin + 56;
        const columns = Object.keys(data[0]);
        const colCount = Math.min(columns.length, 6);
        const colWidth = contentWidth / colCount;

        doc.setFillColor(241, 245, 249);
        doc.rect(margin, tableY - 14, contentWidth, 22, "F");

        doc.setFontSize(10);
        doc.setTextColor(30, 41, 59);
        doc.setFont(undefined as any, "bold");
        columns.slice(0, colCount).forEach((col, i) => {
          doc.text(col.substring(0, 22), margin + 6 + i * colWidth, tableY);
        });
        tableY += 14;

        doc.setFont(undefined as any, "normal");
        doc.setTextColor(51, 65, 85);
        doc.setFontSize(9);
        data.forEach((row) => {
          if (tableY > pageHeight - margin - 20) {
            drawFooter();
            doc.addPage();
            drawHeader(`${title || viz.title || "Visualization"} — Data`);
            tableY = margin + 56;
          }
          columns.slice(0, colCount).forEach((col, i) => {
            const value = String(row[col] ?? "").substring(0, 28);
            doc.text(value, margin + 6 + i * colWidth, tableY);
          });
          tableY += 14;
        });

        drawFooter();
      }

      doc.save(
        `${(title || viz.title || "visualization").replace(
          /[^a-z0-9]/gi,
          "_"
        )}.pdf`
      );
      setPreferredExportFormat("pdf");
      if (typeof window !== "undefined") {
        window.localStorage.setItem(CHAT_EXPORT_FORMAT_KEY, "pdf");
      }

      toast({
        title: "Downloaded!",
        description: chartEmbedded
          ? "PDF report saved with chart and data."
          : "PDF report saved.",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to generate PDF",
        variant: "destructive",
      });
    }
  };

  /**
   * Export visualization to PowerPoint (16:9 widescreen, chart image on slide 1,
   * data table on slide 2). Falls back to a data-only deck if the chart DOM
   * hasn't rendered (e.g. quick-export before the bubble mounts).
   */
  const handleAddToPowerPoint = async (override?: ExportOverride) => {
    const viz = override?.visualization;
    const title = override?.title;
    const desc = override?.description;
    const messageId = override?.messageId;
    if (!viz) return;

    try {
      const pptxgen = (await import("pptxgenjs")).default;
      const pres = new pptxgen();
      pres.author = "Coheus";
      pres.title = title || "Visualization";
      // Use 16:9 widescreen (13.333" x 7.5") to match modern PPT templates and
      // match the chart's natural aspect ratio.
      pres.layout = "LAYOUT_WIDE";

      const slideW = 13.333;
      const slideH = 7.5;
      const margin = 0.5;
      const contentW = slideW - margin * 2;
      const displayTitle = title || viz.title || "Visualization";
      const chartType = viz.type || "chart";
      const chartTypeLabel = `Chart Type: ${
        chartType.charAt(0).toUpperCase() + chartType.slice(1)
      }`;

      const addHeader = (s: any, headerTitle: string) => {
        s.addText(headerTitle, {
          x: margin,
          y: 0.3,
          w: contentW,
          h: 0.6,
          fontSize: 24,
          bold: true,
          color: "1e293b",
          fontFace: "Arial",
        });
        s.addText(chartTypeLabel, {
          x: margin,
          y: 0.92,
          w: contentW,
          h: 0.3,
          fontSize: 11,
          color: "64748b",
          fontFace: "Arial",
        });
      };

      const addFooter = (s: any) => {
        s.addText(
          `Generated by Coheus | ${new Date().toLocaleDateString()}`,
          {
            x: margin,
            y: slideH - 0.4,
            w: contentW,
            h: 0.3,
            fontSize: 9,
            color: "94a3b8",
            fontFace: "Arial",
          }
        );
      };

      // --- Slide 1: Chart image ---
      const chartSlide = pres.addSlide();
      addHeader(chartSlide, displayTitle);

      let chartTopY = 1.4;
      if (desc) {
        chartSlide.addText(desc, {
          x: margin,
          y: 1.3,
          w: contentW,
          h: 0.5,
          fontSize: 12,
          color: "475569",
          fontFace: "Arial",
        });
        chartTopY = 1.9;
      }

      let chartEmbedded = false;
      if (messageId) {
        try {
          const blob = await captureChartAsBlob(messageId);
          if (blob) {
            const dataUrl: string = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });

            const { width: imgW, height: imgH } = await new Promise<{
              width: number;
              height: number;
            }>((resolve) => {
              const im = new window.Image();
              im.onload = () => resolve({ width: im.width, height: im.height });
              im.onerror = () => resolve({ width: 1600, height: 900 });
              im.src = dataUrl;
            });

            const ratio = imgW / imgH || 16 / 9;
            const maxW = contentW;
            const maxH = slideH - chartTopY - 0.6; // leave room for footer
            let drawW = maxW;
            let drawH = drawW / ratio;
            if (drawH > maxH) {
              drawH = maxH;
              drawW = drawH * ratio;
            }
            const drawX = margin + (contentW - drawW) / 2;
            const drawY = chartTopY + (maxH - drawH) / 2;

            chartSlide.addImage({
              data: dataUrl,
              x: drawX,
              y: drawY,
              w: drawW,
              h: drawH,
            });
            chartEmbedded = true;
          }
        } catch (captureErr) {
          console.warn("Chart capture for PPT failed:", captureErr);
        }
      }

      if (!chartEmbedded) {
        chartSlide.addText(
          "Chart preview unavailable — see data table on the next slide.",
          {
            x: margin,
            y: chartTopY + 1,
            w: contentW,
            h: 0.5,
            fontSize: 14,
            color: "94a3b8",
            italic: true,
            align: "center",
            fontFace: "Arial",
          }
        );
      }

      addFooter(chartSlide);

      // --- Slide 2: Data table ---
      const data = viz.data || [];
      const hasTabularData =
        data.length > 0 && Object.keys(data[0] || {}).length > 0;

      if (hasTabularData) {
        const tableSlide = pres.addSlide();
        addHeader(tableSlide, `${displayTitle} — Data`);

        const columns = Object.keys(data[0]).slice(0, 6);
        const colWidth = contentW / columns.length;
        const rows = [
          columns.map((col) => ({
            text: col.substring(0, 22),
            options: {
              bold: true,
              fill: { color: "f1f5f9" },
              color: "1e293b",
              fontFace: "Arial",
            },
          })),
          ...data.slice(0, 18).map((row) =>
            columns.map((col) => ({
              text: String(row[col] ?? "").substring(0, 32),
              options: { color: "334155", fontFace: "Arial" },
            }))
          ),
        ];

        tableSlide.addTable(rows as any, {
          x: margin,
          y: 1.4,
          w: contentW,
          h: slideH - 1.4 - 0.6,
          colW: columns.map(() => colWidth),
          border: { pt: 0.5, color: "e2e8f0" },
          fontFace: "Arial",
          fontSize: 11,
          valign: "middle",
        });

        if (data.length > 18) {
          tableSlide.addText(`... and ${data.length - 18} more rows`, {
            x: margin,
            y: slideH - 0.7,
            w: contentW,
            h: 0.25,
            fontSize: 9,
            color: "94a3b8",
            italic: true,
            fontFace: "Arial",
          });
        }

        addFooter(tableSlide);
      }

      await pres.writeFile({
        fileName: `${displayTitle.replace(/[^a-z0-9]/gi, "_")}.pptx`,
      });
      setPreferredExportFormat("ppt");
      if (typeof window !== "undefined") {
        window.localStorage.setItem(CHAT_EXPORT_FORMAT_KEY, "ppt");
      }

      toast({
        title: "Downloaded!",
        description: chartEmbedded
          ? "PowerPoint saved with chart and data slides."
          : "PowerPoint saved.",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to generate PowerPoint",
        variant: "destructive",
      });
    }
  };

  /**
   * Share visualization via copy link
   */
  const [linkCopied, setLinkCopied] = useState(false);

  /**
   * Drilldown state for viewing loan and loan officer details
   */
  const [drilldownOpen, setDrilldownOpen] = useState(false);
  const [drilldownData, setDrilldownData] = useState<{
    type: "loan" | "loan_officer";
    item: any;
    title: string;
  } | null>(null);

  // Keys from Recharts / layout that must not be shown as "properties"
  const DRILLDOWN_EXCLUDED_KEYS = new Set([
    "x",
    "y",
    "width",
    "height",
    "payload",
    "cx",
    "cy",
    "fill",
    "color",
    "stroke",
    "strokeWidth",
    "radius",
    "innerRadius",
    "outerRadius",
    "offset",
  ]);

  const getDrilldownDisplayItem = useCallback(
    (raw: any, type: "loan" | "loan_officer") => {
      const item =
        raw?.payload &&
        typeof raw.payload === "object" &&
        !Array.isArray(raw.payload)
          ? { ...raw.payload }
          : { ...(raw || {}) };
      const entries = Object.entries(item).filter(
        ([key]) => !key.startsWith("_") && !DRILLDOWN_EXCLUDED_KEYS.has(key)
      );
      if (type === "loan_officer") {
        const branch = item.branch ?? item.region ?? "";
        const loansCount =
          item.loans ?? item.active_loans ?? item.activeLoans ?? 0;
        const firstNames = [
          "Sarah",
          "Michael",
          "Jennifer",
          "David",
          "Emily",
          "James",
          "Maria",
          "Robert",
          "Lisa",
          "Christopher",
        ];
        const lastNames = [
          "Johnson",
          "Chen",
          "Williams",
          "Rodriguez",
          "Martinez",
          "Garcia",
          "Brown",
          "Davis",
          "Miller",
          "Wilson",
        ];
        const seed = (branch || "officer")
          .split("")
          .reduce((a: number, c: string) => a + c.charCodeAt(0), 0);
        const displayName =
          item.name ||
          item.loan_officer ||
          item.loan_officer_name ||
          `${firstNames[seed % firstNames.length]} ${
            lastNames[(seed >> 4) % lastNames.length]
          }`;
        const activeLoans = loansCount;
        const closedYtd =
          item.closed_ytd ??
          item.closedYtd ??
          Math.max(0, Math.floor((activeLoans || 42) * 0.58));
        const volume = item.volume ?? item.volume_ytd ?? closedYtd * 385000;
        const pullThrough =
          item.pull_through ??
          item.pullThrough ??
          (activeLoans + closedYtd
            ? Math.round((closedYtd / (activeLoans + closedYtd)) * 100)
            : 78);
        const nmlsId =
          item.nmls_id ?? item.nmlsId ?? `NMLS ${100000 + (seed % 900000)}`;
        return {
          Name: displayName,
          "Active Loans": activeLoans,
          "Closed YTD": closedYtd,
          "Volume YTD":
            typeof volume === "number"
              ? `$${(volume / 1_000_000).toFixed(2)}M`
              : volume,
          "Pull-Through %":
            typeof pullThrough === "number" ? `${pullThrough}%` : pullThrough,
          "NMLS ID": nmlsId,
          Branch: branch || "—",
        };
      }
      return Object.fromEntries(entries);
    },
    []
  );

  const handleDrilldown = useCallback(
    (item: any, level: string) => {
      if (!item) return;

      const displayItem = getDrilldownDisplayItem(
        item,
        level === "loan_officer" ||
          item?.loan_officer ||
          item?.loan_officer_name
          ? "loan_officer"
          : "loan"
      );
      const itemName =
        displayItem.Name ??
        displayItem.name ??
        item?.name ??
        item?.loan_officer ??
        item?.loan_officer_name ??
        item?.branch ??
        item?.loan_number ??
        item?.loan_id ??
        item?.id ??
        "Details";

      if (
        level === "loan_officer" ||
        item?.loan_officer ||
        item?.loan_officer_name ||
        item?.branch
      ) {
        setDrilldownData({
          type: "loan_officer",
          item: displayItem,
          title: `Loan Officer: ${itemName}`,
        });
        setDrilldownOpen(true);
      } else if (level === "loan" || item?.loan_id || item?.id) {
        setDrilldownData({
          type: "loan",
          item: displayItem,
          title: `Loan: ${item?.loan_number ?? item?.loan_id ?? item?.id ?? "Details"}`,
        });
        setDrilldownOpen(true);
      }
    },
    [getDrilldownDisplayItem]
  );

  const handleCopyLink = async (override?: ExportOverride) => {
    const title = override?.title;
    try {
      const shareUrl = `${
        window.location.origin
      }/shared/visualization?title=${encodeURIComponent(
        title || override?.visualization?.title || "Visualization"
      )}`;
      await navigator.clipboard.writeText(shareUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
      toast({
        title: "Link Copied!",
        description: "Shareable link copied to clipboard.",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to copy link",
        variant: "destructive",
      });
    }
  };

  const handleShareViaEmail = (override?: ExportOverride) => {
    const title = override?.title;
    const desc = override?.description;
    const subject = encodeURIComponent(
      title || override?.visualization?.title || "Visualization from Coheus"
    );
    const body = encodeURIComponent(
      `Check out this visualization: ${title || "Data Visualization"}\n\n${
        desc || "Generated from Coheus analytics platform."
      }`
    );
    window.open(`mailto:?subject=${subject}&body=${body}`, "_blank");
  };

  /** Capture chart as PNG blob via html2canvas (element id = cohi-viz-{messageId}) */
  const captureChartAsBlob = async (
    messageId: string
  ): Promise<Blob | null> => {
    const el = document.getElementById(`cohi-viz-${messageId}`);
    if (!el) return null;
    try {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(el, {
        useCORS: true,
        allowTaint: true,
        scale: 2,
        backgroundColor: undefined,
        logging: false,
      });
      return new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b ?? null), "image/png", 1);
      });
    } catch (e) {
      console.error("Capture chart error:", e);
      return null;
    }
  };

  /** Email with screenshot: capture chart, copy to clipboard, open mailto so user can paste image in body */
  const handleEmailWithScreenshot = async (
    override?: ExportOverride,
    messageId?: string
  ) => {
    const title =
      override?.title ?? override?.visualization?.title ?? "Chart";
    if (!messageId) {
      toast({
        title: "Use from chart",
        description:
          "Open this menu from a message that has a chart, then choose Email → Image in body.",
        variant: "destructive",
      });
      return;
    }
    const blob = await captureChartAsBlob(messageId);
    if (!blob) {
      toast({
        title: "Capture failed",
        description: "Could not capture chart image.",
        variant: "destructive",
      });
      return;
    }
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ]);
      const subject = encodeURIComponent(`${title} – Coheus`);
      const body = encodeURIComponent(
        `Hi,\n\nPlease find the chart below (pasted from clipboard).\n\n` +
          `---\n` +
          `The chart image has been copied to your clipboard. Paste it here with Ctrl+V (Windows/Linux) or Cmd+V (Mac).\n\n` +
          `— Coheus`
      );
      window.open(`mailto:?subject=${subject}&body=${body}`, "_blank");
      toast({
        title: "Ready to email",
        description:
          "Chart image copied. Paste (Ctrl+V / Cmd+V) into the email body.",
      });
    } catch (e) {
      toast({
        title: "Clipboard failed",
        description:
          "Could not copy image. Try Download as Image and attach manually.",
        variant: "destructive",
      });
    }
  };

  /** Email with link to live chart so recipient opens the chart in the app */
  const handleEmailWithLink = (override?: ExportOverride) => {
    const title =
      override?.title ??
      override?.visualization?.title ??
      "Visualization";
    const shareUrl = `${
      window.location.origin
    }/shared/visualization?title=${encodeURIComponent(title)}`;
    const subject = encodeURIComponent(`${title} – Coheus`);
    const body = encodeURIComponent(
      `Hi,\n\nView this live chart, graph, or table:\n${shareUrl}\n\n— Coheus`
    );
    window.open(`mailto:?subject=${subject}&body=${body}`, "_blank");
    toast({
      title: "Link ready",
      description: "Email draft opened with link to the live chart.",
    });
  };

  /** Export visualization data as Excel (CSV) */
  const handleExportExcel = (override?: ExportOverride) => {
    const viz = override?.visualization;
    if (!viz?.data?.length) {
      toast({
        title: "No data",
        description: "Nothing to export.",
        variant: "destructive",
      });
      return;
    }
    try {
      const columns = Object.keys(viz.data[0]);
      const header = columns.join(",");
      const rows = viz.data.map((row: any) =>
        columns
          .map((col) => {
            const v = row[col];
            const s =
              typeof v === "string" && (v.includes(",") || v.includes('"'))
                ? `"${v.replace(/"/g, '""')}"`
                : String(v ?? "");
            return s;
          })
          .join(",")
      );
      const csv = [header, ...rows].join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(override?.title ?? viz.title ?? "export").replace(
        /[^a-z0-9]/gi,
        "_"
      )}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Downloaded!", description: "CSV exported." });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Export failed",
        variant: "destructive",
      });
    }
  };

  /** Export chart as PNG (html2canvas on element cohi-viz-{messageId}) */
  const handleExportImage = async (
    override?: ExportOverride,
    messageId?: string
  ) => {
    const viz = override?.visualization;
    if (!viz) return;
    if (!messageId) {
      toast({
        title: "Export from chart",
        description:
          'Use "Download as Image" from the chart\'s Save & export menu.',
        variant: "destructive",
      });
      return;
    }
    const blob = await captureChartAsBlob(messageId);
    if (!blob) {
      toast({
        title: "Capture failed",
        description: "Could not capture chart.",
        variant: "destructive",
      });
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(viz.title || "chart").replace(/[^a-z0-9]/gi, "_")}.png`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Downloaded", description: "Chart saved as PNG." });
  };

  const hideFloatingDockChip =
    pathname === "/my-dashboard" ||
    pathname.startsWith("/my-dashboard/") ||
    pathname === "/workbench" ||
    pathname.startsWith("/workbench/");

  if (!isOpen) {
    if (layout === "shell") return null;
    if (!onOpen) return null;
    if (hideFloatingDockChip) return null;
    return <CohiChatDockChip onClick={onOpen} />;
  }

  const chatInputFooter = isSharedResearchViewOnly ? (
    <div
      className={cn(
        "p-4 shrink-0 w-full border-t border-slate-200/70 dark:border-slate-700/70",
        isStackedInsetShell
          ? "border-slate-200/60 dark:border-slate-700/60"
          : "bg-slate-50/50 dark:bg-slate-900/50",
      )}
    >
      <p className="text-xs text-center text-amber-700 dark:text-amber-300">
        View-only — you cannot send messages on a shared research session.
      </p>
    </div>
  ) : (
    <motion.div
      layout
      layoutId="cohi-chat-input"
      transition={{
        layout: {
          duration: 0.38,
          ease: CHAT_SHELL_VIEW_TRANSITION.ease,
        },
      }}
      className={cn(
        "p-4 shrink-0 w-full",
        isCenteredEmptyLanding
          ? "max-w-2xl mx-auto border-t-0 bg-transparent"
          : isStackedInsetShell
            ? "border-t border-slate-200/60 dark:border-slate-700/60"
            : "border-t border-slate-200/70 dark:border-slate-700/70 bg-slate-50/50 dark:bg-slate-900/50",
      )}
    >
      {workbenchEditingWidget &&
        (activeChatType === "workbench" ||
          isMyDashboardCanvasPath(pathname)) && (
        <div className="flex items-center justify-between gap-2 mb-2 px-2 py-1.5 rounded-lg bg-violet-50/90 dark:bg-indigo-950/40 border border-violet-100 dark:border-indigo-900/50">
          <div className="min-w-0">
            <span className="text-xs font-medium text-indigo-800 dark:text-indigo-200 truncate block">
              Editing: {workbenchEditingWidget.title}
            </span>
            <span className="text-[10px] text-indigo-600/90 dark:text-indigo-300/80">
              Describe your changes in the message box below.
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 shrink-0 text-indigo-600 dark:text-indigo-400"
            onClick={() => {
              setWorkbenchEditingWidget(null);
              window.dispatchEvent(
                new CustomEvent(COHI_WORKBENCH_STOP_EDITING_EVENT),
              );
            }}
            title="Stop editing"
          >
            Stop
          </Button>
        </div>
      )}
      {isUnifiedChatClientEnabled() && conversationForkLinks && (
        <ConversationForkChips
          links={conversationForkLinks}
          conversationTitles={Object.fromEntries(
            chatSessions.map((s) => [s.id, s.title]),
          )}
          onNavigate={(id) => void handleLoadSession(id)}
          onDismissPendingLink={
            hasPendingForkCarryOver ? handleDismissPendingForkLink : undefined
          }
          className="px-1 pb-1"
        />
      )}
      {isUnifiedChatClientEnabled() && (
        <>
          <BackgroundChatRunsBadge activeConversationId={currentSessionId} />
          <UnifiedChatRebindBanner
            tenantId={tenantId}
            conversationId={currentSessionId}
            chatType={activeChatType}
          />
        </>
      )}
      <div
        className="flex flex-wrap sm:flex-nowrap gap-2 items-end w-full min-w-0"
        data-tour="unified-chat-composer"
      >
        {isUnifiedChatClientEnabled() && (
          <ChatTypeSelect
            value={activeChatType}
            onChange={handleChatTypeChange}
            allowedTypes={allowedChatTypes}
            className="w-full sm:w-[140px]"
          />
        )}
        <div className="flex flex-1 min-w-0 basis-full sm:basis-auto gap-2 items-end">
        <Button
          variant={isListening ? "destructive" : "outline"}
          size="icon"
          onClick={isListening ? stopVoiceRecording : startVoiceRecording}
          className={cn("shrink-0", isListening && "animate-pulse")}
          title={isListening ? "Stop recording" : "Voice input"}
        >
          {isListening ? (
            <MicOff className="w-4 h-4" />
          ) : (
            <Mic className="w-4 h-4" />
          )}
        </Button>
        <Textarea
          ref={inputRef}
          value={input}
          rows={1}
          onChange={(e) => {
            setInput(e.target.value);
            resizeChatInput();
          }}
          onKeyDown={handleInputKeyDown}
          placeholder={
            workbenchEditingWidget
              ? `Describe changes for "${workbenchEditingWidget.title}"…`
              : attachedUploadIds.length > 0
                ? "Ask about this dataset..."
                : "What important info do I need to know today?"
          }
          disabled={
            isLoading ||
            (isUnifiedChatClientEnabled() &&
              activeChatType === "research" &&
              researchViewOnly)
          }
          className={cn(
            "flex-1 min-h-10 max-h-32 resize-none py-2.5 leading-snug",
            "rounded-xl border-slate-200/80 dark:border-slate-600/60 bg-white dark:bg-slate-800/50",
            "focus-visible:ring-2 focus-visible:ring-blue-500/30 overflow-y-hidden",
          )}
        />
        <Button
          onClick={handleSend}
          disabled={
            (!input.trim() && attachedUploadIds.length === 0) ||
            isLoading ||
            (isUnifiedChatClientEnabled() &&
              activeChatType === "research" &&
              researchViewOnly)
          }
          size="icon"
          className="rounded-xl bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-500/25"
        >
          {isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </Button>
        </div>
      </div>
      {showDatasetAttach && !researchViewOnly && (
        <DatasetAttachPanel
          className="mt-2.5"
          tenantId={tenantId}
          attachedUploadIds={attachedUploadIds}
          onAttachedUploadIdsChange={handleAttachedUploadIdsChange}
          disabled={isLoading}
        />
      )}
      {isUnifiedChatClientEnabled() &&
        activeChatType === "research" &&
        !researchViewOnly && (
          <ResearchDeepAnalysisToggle
            className="mt-2.5"
            checked={activeResearchDeepAnalysis}
            onCheckedChange={setActiveResearchDeepAnalysis}
          />
        )}
    </motion.div>
  );

  const panelBody = (
      <motion.div
        data-testid="cohi-chat-panel"
        initial={layout === "shell" ? false : { x: 500, opacity: 0 }}
        animate={layout === "shell" ? undefined : { x: 0, opacity: 1 }}
        exit={layout === "shell" ? undefined : { x: 500, opacity: 0 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className={cn(
          layout === "shell"
            ? cn(
                "relative flex flex-col overflow-hidden w-full",
                isShellCompact ? "shrink-0" : "flex-1 min-h-0 h-full",
                isStackedInsetShell && PAGE_INSIGHTS_CARD,
              )
            : "fixed flex flex-col overflow-hidden",
          !isStackedInsetShell &&
            "bg-gradient-to-b from-violet-50/95 via-white/95 to-rose-50/80 dark:from-slate-950/98 dark:via-indigo-950/30 dark:to-slate-950/98 backdrop-blur-xl",
          layout !== "shell" &&
            "border-l border-violet-200/50 dark:border-indigo-900/50 shadow-[0_-4px_24px_-4px_rgba(139,92,246,0.06),0_0_1px_rgba(0,0,0,0.02)] dark:shadow-[0_-4px_32px_-4px_rgba(99,102,241,0.12),0_0_1px_rgba(255,255,255,0.04)]",
          layout !== "shell" &&
            (isFullscreen || isMobile
              ? "left-0 right-0 top-0 bottom-0 z-[9999] w-full h-full"
              : "right-2 top-[70px] h-[calc(100%-70px)] z-[100] rounded-2xl"),
          layout !== "shell" &&
            !isFullscreen &&
            "w-[min(520px,calc(100vw-24px))] sm:w-[496px]",
          className
        )}
      >
        {/* Header – pastel, modern */}
        <div
          className={cn(
            "relative z-[20] flex items-center justify-between gap-2 sm:gap-3 px-4 sm:px-5 py-3.5 shrink-0",
            isStackedInsetShell
              ? "border-b border-slate-200/60 dark:border-slate-700/60"
              : "border-b border-violet-100/80 dark:border-indigo-900/60 bg-gradient-to-r from-violet-50/90 to-indigo-50/80 dark:from-indigo-950/50 dark:to-violet-950/40",
          )}
        >
          <div className="flex items-start gap-2 sm:gap-3 min-w-0 flex-1">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shrink-0 shadow-lg shadow-violet-500/25 ring-1 ring-white/30">
              <Sparkles className="w-5 h-5 text-white" strokeWidth={2} />
            </div>
            <div className="min-w-0 flex-1 py-0.5">
              <div className="flex items-center gap-2 min-w-0">
                <h2 className="text-[15px] sm:text-base font-semibold text-slate-800 dark:text-white tracking-tight truncate min-w-0">
                  Cohi Chat
                </h2>
                <Badge
                  variant="secondary"
                  className="bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300 text-[10px] px-2.5 py-0.5 border-0 shrink-0 font-medium rounded-full"
                >
                  AI
                </Badge>
              </div>
              {showWorkbenchCanvasThreadsControl ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-1 h-7 max-w-full self-start px-2.5 text-[10px] font-normal pointer-events-auto relative z-[1]"
                  title="View chat threads linked to this canvas"
                  data-testid="workbench-chat-scope-chip"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openWorkbenchCanvasThreads();
                  }}
                >
                  <MessageSquare className="w-3 h-3 mr-1.5 shrink-0 opacity-70" />
                  <span className="truncate">
                    {workbenchCanvasDisplayLabel}
                    {workbenchCanvasThreadCount > 0
                      ? ` · ${workbenchCanvasThreadCount} thread${workbenchCanvasThreadCount === 1 ? "" : "s"}`
                      : " · no threads yet"}
                  </span>
                </Button>
              ) : null}
              <p className="text-[11px] sm:text-xs text-slate-600/90 dark:text-slate-400/90 font-normal mt-0.5 leading-snug line-clamp-2 sm:line-clamp-1 sm:truncate">
                Ask about your pipeline & performance
              </p>
            </div>
          </div>
          <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
            {(!hideInPanelHistory || showWorkbenchCanvasThreadsControl) && (
              <Button
                variant="ghost"
                size="icon"
                data-chat-history-toggle="true"
                data-testid="cohi-chat-history-toggle"
                className={cn(
                  "h-8 w-8 rounded-xl text-slate-500 hover:text-violet-700 dark:hover:text-violet-300 hover:bg-violet-100/80 dark:hover:bg-violet-500/20 transition-colors",
                  showHistory && "bg-violet-100/80 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300"
                )}
                onClick={() => setShowHistory((prev) => !prev)}
                title={
                  activeChatType === "workbench"
                    ? "Chat threads for this canvas"
                    : "Chat history"
                }
                aria-pressed={showHistory}
              >
                <Clock className="w-4 h-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-xl text-slate-500 hover:text-violet-700 dark:hover:text-violet-300 hover:bg-violet-100/80 dark:hover:bg-violet-500/20 transition-colors"
              onClick={() => void startNewChatSession()}
              title={
                activeChatType === "workbench"
                  ? "New chat thread on this canvas"
                  : "New conversation"
              }
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
            {hasVisualizationMessages && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-xl text-slate-500 hover:text-violet-700 dark:hover:text-violet-300 hover:bg-violet-100/80 dark:hover:bg-violet-500/20 transition-colors"
                onClick={handleOpenInWorkbench}
                disabled={isCreatingCanvas}
                title="Save all charts from this chat to a new Workbench canvas"
                aria-label="Save all charts to Workbench"
                data-testid="cohi-chat-save-all-to-workbench"
              >
                {isCreatingCanvas ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ExternalLink className="w-4 h-4" />
                )}
              </Button>
            )}
            {layout === "shell" && !isChatHomePage && (
              <ChatShellExpandControls variant="header" />
            )}
            {!(layout === "shell" && isChatHomePage) && (
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-8 w-8 rounded-xl text-slate-500 hover:text-violet-700 dark:hover:text-violet-300 hover:bg-violet-100/80 dark:hover:bg-violet-500/20 transition-colors",
                layout === "shell" &&
                  shellExpandMode === "full" &&
                  "bg-violet-100/80 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300",
              )}
              onClick={() => {
                if (layout === "shell") {
                  setShellExpandMode(shellExpandMode === "full" ? "tall" : "full");
                  return;
                }
                setIsFullscreen(!isFullscreen);
              }}
              title={
                layout === "shell"
                  ? shellExpandMode === "full"
                    ? "Exit full page"
                    : "Full page"
                  : isFullscreen
                    ? "Exit fullscreen"
                    : "Fullscreen"
              }
              aria-pressed={layout === "shell" ? shellExpandMode === "full" : isFullscreen}
            >
              {layout === "shell" && shellExpandMode === "full" ? (
                <Shrink className="w-4 h-4" />
              ) : isFullscreen ? (
                <Shrink className="w-4 h-4" />
              ) : (
                <Expand className="w-4 h-4" />
              )}
            </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-xl text-slate-500 hover:text-violet-700 dark:text-violet-300 hover:bg-violet-100/80 dark:hover:bg-violet-500/20 transition-colors"
                  title="More options"
                >
                  <MoreHorizontal className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 z-[10001]" sideOffset={4}>
                <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  Chat
                </DropdownMenuLabel>
                <DropdownMenuCheckboxItem
                  checked={voiceEnabled}
                  onCheckedChange={(v) => setVoiceEnabled(v === true)}
                  onSelect={(e) => e.preventDefault()}
                >
                  Read responses aloud
                </DropdownMenuCheckboxItem>
                <DropdownMenuItem
                  onClick={() => clearMessages()}
                  className="gap-2 text-rose-600 dark:text-rose-400 focus:text-rose-600 dark:focus:text-rose-400"
                >
                  <Trash2 className="w-4 h-4 shrink-0" />
                  Clear chat
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {layout !== "shell" && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-xl text-slate-500 hover:text-rose-600 dark:hover:text-rose-300 hover:bg-rose-100/80 dark:hover:bg-rose-500/15 transition-colors"
              onClick={onClose}
              title="Close"
            >
              <X className="w-4 h-4" />
            </Button>
            )}
          </div>
        </div>

        <div
          className={cn(
            "relative flex flex-col min-w-0 w-full",
            isShellCompact ? "shrink-0" : "flex-1 min-h-0",
          )}
          data-cohi-chat-panel-body
        >
        {showDatasetAttach && (
          <ChatFilesBar
            uploads={availableUploads}
            attachedUploadIds={attachedUploadIds}
            onDetach={handleDetachUpload}
            disabled={isLoading}
          />
        )}

        {workbenchScopeGuard.pinnedBanner}

        {(!hideInPanelHistory || showWorkbenchCanvasThreadsControl) && (
        <ChatHistorySidebar
          isOpen={showHistory}
          onClose={() => setShowHistory(false)}
          sessions={chatSessions}
          activeSessionId={currentSessionId}
          isLoading={isLoadingSessions}
          loadingSessionId={loadingSessionId}
          onFetchSessions={fetchHistoryForCurrentView}
          onLoadSession={handleLoadSession}
          onDeleteSession={deleteSession}
          onRenameSession={renameSession}
          onNewSession={startNewChatSession}
          scopeSubtitle={workbenchHistoryScopeSubtitle}
        />
        )}

        {showResearchWorkspace && (
          <AnimatePresence initial={false}>
            <motion.div
                key="research-workspace"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={CHAT_SHELL_VIEW_TRANSITION}
                className={cn(
                  "overflow-hidden min-h-0",
                  shellExpandMode === "full" ? "flex-1 flex flex-col" : "shrink-0",
                )}
              >
                <UnifiedChatResearchWorkspace
                  key={legacyRef ?? "research-empty"}
                  researchSessionId={legacyRef}
                  tenantId={tenantId}
                  messages={messages}
                  chatLoading={
                    isLoadingSession ||
                    (isLoading && activeChatType === "research")
                  }
                  onSessionAccess={({ isOwner }) => {
                    setResearchViewOnly(!isOwner);
                  }}
                />
              </motion.div>
          </AnimatePresence>
        )}

        <LayoutGroup id="cohi-chat-shell-body">
        <div
          className={cn(
            "flex flex-col min-w-0 w-full",
            isShellCompact && "shrink-0",
            shellBodyFillsPane && "flex-1 min-h-0",
            !shellBodyFillsPane && !isShellCompact && "shrink-0",
          )}
        >
        {isCenteredEmptyLanding ? (
          <div className="flex flex-1 flex-col justify-center gap-5 px-4 sm:px-5 min-h-0 overflow-hidden">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={CHAT_SHELL_VIEW_TRANSITION}
              className="px-2 w-full min-w-0 shrink-0 py-3 flex justify-center"
            >
              <ChatTypeSuggestedPromptCards
                allowedTypes={allowedChatTypes}
                layout={promptCardsLayout}
                activeChatType={activeChatType}
                expandedChatType={expandedPromptCard}
                onCardSelect={handlePromptCardSelect}
                suggestionsByType={emptyStateSuggestionsByType}
                maxPromptsPerCard={3}
                onPromptClick={handleSuggestionClick}
              />
            </motion.div>
            {chatInputFooter}
          </div>
        ) : (
          <>
        {/* Messages – native scrollable div (not Radix ScrollArea) because Radix
            wraps children in <div style="display:table;min-width:100%"> which lets
            intrinsic-width children like Recharts bleed past the panel's right edge. */}
        <AnimatePresence initial={false} mode="popLayout">
        {showStandardMessagesPane && (
        <motion.div
          key="shell-messages"
          ref={messagesScrollRef}
          layout
          initial={{ opacity: 0 }}
          animate={
            isTallEmptyPromptCards
              ? { opacity: 1 }
              : { opacity: 1, height: "auto" }
          }
          exit={{ opacity: 0, height: 0, marginTop: 0, paddingTop: 0, paddingBottom: 0 }}
          transition={{
            ...CHAT_SHELL_VIEW_TRANSITION,
            opacity: { duration: 0.22, ease: CHAT_SHELL_VIEW_TRANSITION.ease },
            height: { duration: 0.32, ease: CHAT_SHELL_VIEW_TRANSITION.ease },
          }}
          className={cn(
            "flex-1 overflow-x-hidden px-4 sm:px-5 min-w-0 min-h-0",
            isTallEmptyPromptCards
              ? "overflow-y-hidden flex flex-col justify-center"
              : "overflow-y-auto",
            isStackedInsetShell && "bg-transparent",
          )}
        >
          <div className="space-y-5 min-w-0 w-full">
            <AnimatePresence>
              {showEmptyPromptCards && (
                <motion.div
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -16 }}
                  transition={{ duration: 0.35 }}
                  className={cn(
                    "px-2 w-full min-w-0",
                    promptCardsLayout === "row"
                      ? "py-3 flex justify-center"
                      : "py-8",
                  )}
                >
                  <ChatTypeSuggestedPromptCards
                    allowedTypes={allowedChatTypes}
                    layout={promptCardsLayout}
                    activeChatType={activeChatType}
                    expandedChatType={expandedPromptCard}
                    onCardSelect={handlePromptCardSelect}
                    suggestionsByType={emptyStateSuggestionsByType}
                    maxPromptsPerCard={promptCardsLayout === "row" ? 3 : 6}
                    onPromptClick={handleSuggestionClick}
                    className={cn(
                      promptCardsLayout === "grid" && "max-w-2xl mx-auto",
                    )}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {!(
              activeChatType === "research" && isUnifiedChatClientEnabled()
            ) &&
              messages.map((message, idx) => (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
              >
                <EnhancedChatMessageBubble
                  message={message}
                  onSave={(viz, q, sql) => handleSaveToWorkbench(viz, q, sql)}
                  onBuildInCanvas={(viz, q, sql) =>
                    handleBuildInCanvas(viz, q, sql)
                  }
                  onSpeak={speakResponse}
                  onDrilldown={handleDrilldown}
                  isFullscreen={isFullscreen}
                  voiceEnabled={voiceEnabled}
                  vizTypeOverride={vizTypeOverrides[message.id]}
                  onDesignOptionClick={(id, type) =>
                    setVizTypeOverrides((prev) => ({ ...prev, [id]: type }))
                  }
                  onExportPDF={(viz, msgId) =>
                    handleDownloadPDF({
                      visualization: viz,
                      title: viz.title,
                      messageId: msgId,
                    })
                  }
                  onExportExcel={(viz) =>
                    handleExportExcel({ visualization: viz, title: viz.title })
                  }
                  onExportPPT={(viz, msgId) =>
                    handleAddToPowerPoint({
                      visualization: viz,
                      title: viz.title,
                      messageId: msgId,
                    })
                  }
                  onExportImage={(viz, msgId) =>
                    handleExportImage(
                      { visualization: viz, title: viz.title },
                      msgId
                    )
                  }
                  onCopyLink={(viz) =>
                    handleCopyLink({ visualization: viz, title: viz.title })
                  }
                  onEmailWithScreenshot={(viz, msgId) =>
                    handleEmailWithScreenshot(
                      { visualization: viz, title: viz.title },
                      msgId
                    )
                  }
                  onEmailWithLink={(viz) =>
                    handleEmailWithLink({
                      visualization: viz,
                      title: viz.title,
                    })
                  }
                  preferredExportFormat={preferredExportFormat}
                  sendMessage={sendMessage}
                  isLoading={isLoading}
                  chatTenantId={tenantId}
                  insightBuilderReadOnly={
                    !!message.insightBuilderDraft &&
                    (message.insightBuilderPhase === "approved" ||
                      idx !== lastInsightBuilderDraftIdx)
                  }
                  workbenchPendingActions={message.workbenchPendingActions}
                  onApplyWorkbenchDashboardSuggestion={
                    applyWorkbenchDashboardSuggestion
                  }
                />
              </motion.div>
            ))}

            <div ref={messagesEndRef} />
          </div>
        </motion.div>
        )}
        </AnimatePresence>

        <div className="flex flex-col shrink-0 w-full">
          {/* Follow-up chips — hidden in research (workspace + prompt cards cover this) */}
          <AnimatePresence initial={false}>
          {messages.length > 0 &&
            suggestedQuestions.length > 0 &&
            !isLoading &&
            !showResearchWorkspace &&
            !isSharedResearchViewOnly && (
            <motion.div
              key="shell-suggestions"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={CHAT_SHELL_VIEW_TRANSITION}
              className="overflow-hidden shrink-0"
            >
            <div className="px-4 py-1 border-t border-slate-200/60 dark:border-slate-700/60 bg-slate-50/60 dark:bg-slate-800/30">
              <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-thin">
                {suggestedQuestions.slice(0, 3).map((question, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => handleSuggestionClick(question)}
                    title={question}
                    className="shrink-0 max-w-[min(240px,42vw)] truncate text-[11px] px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800/80 border border-slate-200/70 dark:border-slate-600/50 hover:border-blue-300 dark:hover:border-blue-500/50 hover:bg-blue-50/50 dark:hover:bg-blue-950/20 text-slate-600 dark:text-slate-300"
                  >
                    {question}
                  </button>
                ))}
              </div>
            </div>
            </motion.div>
          )}
          </AnimatePresence>

          {chatInputFooter}
        </div>
          </>
        )}
        </div>
        </LayoutGroup>
        </div>
      </motion.div>
  );

  return (
    <>
      {layout !== "shell" && (
        <div
          className="fixed inset-0 z-[90] bg-slate-900/5 dark:bg-slate-950/30 backdrop-blur-[2px]"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      {panelBody}
      {workbenchScopeGuard.dialogs}

      {/* Drilldown Sheet – appears in front of chat overlay (z-[110] above chat z-[100]) */}
      <Sheet open={drilldownOpen} onOpenChange={setDrilldownOpen}>
        <SheetContent
          overlayClassName="z-[110]"
          className="z-[110] w-[400px] sm:w-[420px] max-h-[100vh] h-full overflow-hidden p-0 flex flex-col bg-slate-50/95 dark:bg-slate-900/95 border-l border-slate-200/80 dark:border-slate-700/80"
        >
          {drilldownData && (
            <>
              {/* Header with pastel accent – pr-12 for sheet close button */}
              <div
                className={cn(
                  "pl-5 pr-12 pt-5 pb-4 shrink-0 border-b",
                  drilldownData.type === "loan_officer"
                    ? "bg-violet-50/80 dark:bg-violet-950/30 border-violet-200/50 dark:border-violet-800/50"
                    : "bg-emerald-50/80 dark:bg-emerald-950/30 border-emerald-200/50 dark:border-emerald-800/50"
                )}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      "w-11 h-11 rounded-xl flex items-center justify-center shrink-0",
                      drilldownData.type === "loan_officer"
                        ? "bg-violet-200/70 dark:bg-violet-800/50 text-violet-600 dark:text-violet-400"
                        : "bg-emerald-200/70 dark:bg-emerald-800/50 text-emerald-600 dark:text-emerald-400"
                    )}
                  >
                    {drilldownData.type === "loan_officer" ? (
                      <Users className="w-5 h-5" />
                    ) : (
                      <FileText className="w-5 h-5" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-base font-semibold text-slate-900 dark:text-white truncate">
                      {drilldownData.title || "Details"}
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {drilldownData.type === "loan_officer"
                        ? "Performance and metrics"
                        : "Loan details and status"}
                    </p>
                  </div>
                </div>
              </div>

              <ScrollArea className="flex-1 min-h-0">
                <div className="p-4 sm:p-5 space-y-5">
                  {/* Key metrics with pastel icon cards */}
                  {(() => {
                    const skip = [
                      "x",
                      "y",
                      "width",
                      "height",
                      "payload",
                      "fill",
                      "color",
                      "cx",
                      "cy",
                    ];
                    const entries = Object.entries(drilldownData.item).filter(
                      ([key]) => !skip.includes(key) && !key.startsWith("_")
                    );
                    const norm = (k: string) =>
                      k.toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");
                    const keyMeta: Record<
                      string,
                      { icon: React.ReactNode; bg: string; label?: string }
                    > = {
                      name: {
                        icon: <User className="w-4 h-4" />,
                        bg: "bg-sky-100 dark:bg-sky-900/40 text-sky-600 dark:text-sky-400",
                        label: "Name",
                      },
                      active_loans: {
                        icon: <Activity className="w-4 h-4" />,
                        bg: "bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400",
                        label: "Active loans",
                      },
                      closed_ytd: {
                        icon: <CheckCircle2 className="w-4 h-4" />,
                        bg: "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400",
                        label: "Closed YTD",
                      },
                      volume_ytd: {
                        icon: <DollarSign className="w-4 h-4" />,
                        bg: "bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400",
                        label: "Volume YTD",
                      },
                      pull_through: {
                        icon: <Percent className="w-4 h-4" />,
                        bg: "bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-400",
                        label: "Pull-through %",
                      },
                      pullthrough: {
                        icon: <Percent className="w-4 h-4" />,
                        bg: "bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-400",
                        label: "Pull-through %",
                      },
                      nmls_id: {
                        icon: <BadgeCheck className="w-4 h-4" />,
                        bg: "bg-slate-200/80 dark:bg-slate-700/60 text-slate-600 dark:text-slate-400",
                        label: "NMLS ID",
                      },
                      nmlsid: {
                        icon: <BadgeCheck className="w-4 h-4" />,
                        bg: "bg-slate-200/80 dark:bg-slate-700/60 text-slate-600 dark:text-slate-400",
                        label: "NMLS ID",
                      },
                    };
                    const topEntries = entries.slice(0, 6);
                    return (
                      <div className="grid grid-cols-2 gap-3">
                        {topEntries.map(([key, value]) => {
                          const meta = keyMeta[norm(key)] || {
                            icon: <LayoutGrid className="w-4 h-4" />,
                            bg: "bg-slate-200/80 dark:bg-slate-700/60 text-slate-600 dark:text-slate-400",
                          };
                          const label = meta.label ?? key.replace(/_/g, " ");
                          const display =
                            typeof value === "number"
                              ? value.toLocaleString(undefined, {
                                  maximumFractionDigits: 2,
                                })
                              : String(value ?? "-");
                          return (
                            <div
                              key={key}
                              className={cn(
                                "rounded-xl border p-3.5",
                                "bg-white/80 dark:bg-slate-800/60 border-slate-200/60 dark:border-slate-700/60 shadow-sm"
                              )}
                            >
                              <div
                                className={cn(
                                  "w-8 h-8 rounded-lg flex items-center justify-center mb-2",
                                  meta.bg
                                )}
                              >
                                {meta.icon}
                              </div>
                              <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400 truncate">
                                {label}
                              </div>
                              <div className="text-sm font-semibold text-slate-900 dark:text-white truncate mt-0.5">
                                {display}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}

                  {/* All properties – compact list */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <LayoutGrid className="w-4 h-4 text-slate-400" />
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        All properties
                      </h4>
                    </div>
                    <div className="rounded-xl border border-slate-200/70 dark:border-slate-700/70 overflow-hidden bg-white/60 dark:bg-slate-800/40">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-slate-100/80 dark:bg-slate-800/60 hover:bg-slate-100/80 dark:hover:bg-slate-800/60 border-b border-slate-200/70 dark:border-slate-700/70">
                            <TableHead className="text-xs font-medium text-slate-500 dark:text-slate-400 w-1/3">
                              Property
                            </TableHead>
                            <TableHead className="text-xs font-medium text-slate-500 dark:text-slate-400">
                              Value
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {Object.entries(drilldownData.item)
                            .filter(
                              ([key]) =>
                                ![
                                  "x",
                                  "y",
                                  "width",
                                  "height",
                                  "payload",
                                  "fill",
                                  "color",
                                  "cx",
                                  "cy",
                                ].includes(key) && !key.startsWith("_")
                            )
                            .map(([key, value]) => (
                              <TableRow
                                key={key}
                                className="border-slate-200/50 dark:border-slate-700/50"
                              >
                                <TableCell className="text-xs font-medium text-slate-600 dark:text-slate-400 py-2">
                                  {key.replace(/_/g, " ")}
                                </TableCell>
                                <TableCell className="text-xs text-slate-800 dark:text-slate-200 py-2">
                                  {typeof value === "number"
                                    ? value.toLocaleString(undefined, {
                                        maximumFractionDigits: 2,
                                      })
                                    : String(value ?? "-")}
                                </TableCell>
                              </TableRow>
                            ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </div>
              </ScrollArea>

              {/* Actions – hidden per design */}
              <div className="hidden p-4 border-t border-slate-200/70 dark:border-slate-700/70 bg-white/60 dark:bg-slate-800/40 flex gap-2 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 rounded-xl"
                  onClick={() => setDrilldownOpen(false)}
                >
                  Close
                </Button>
                {drilldownData.type === "loan_officer" && (
                  <Button
                    size="sm"
                    className="flex-1 rounded-xl bg-violet-600 hover:bg-violet-700 text-white"
                  >
                    <User className="w-4 h-4 mr-2" />
                    Full profile
                  </Button>
                )}
                {drilldownData.type === "loan" && (
                  <Button
                    size="sm"
                    className="flex-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    <FileText className="w-4 h-4 mr-2" />
                    Loan details
                  </Button>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
};

// ============================================================================
// Enhanced Message Bubble Component
// ============================================================================

const VIZ_DESIGN_OPTIONS: {
  type: VisualizationConfig["type"];
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}[] = [
  { type: "bar", label: "Bar", Icon: BarChart3 },
  { type: "line", label: "Line", Icon: Activity },
  { type: "pie", label: "Pie", Icon: PieChart },
  { type: "area", label: "Area", Icon: BarChart3 },
  { type: "donut", label: "Donut", Icon: PieChart },
  { type: "horizontal_bar", label: "Horizontal", Icon: BarChart3 },
  { type: "table", label: "Table", Icon: LayoutGrid },
];

interface EnhancedChatMessageBubbleProps {
  message: ChatMessage;
  onSave: (visualization: VisualizationConfig, question: string, sqlQuery?: string) => void;
  onBuildInCanvas: (
    visualization: VisualizationConfig,
    question: string,
    sqlQuery?: string,
  ) => void;
  onSpeak: (text: string) => void;
  onDrilldown: (item: any, level: string) => void;
  isFullscreen: boolean;
  voiceEnabled: boolean;
  vizTypeOverride?: VisualizationConfig["type"];
  onDesignOptionClick?: (
    messageId: string,
    type: VisualizationConfig["type"]
  ) => void;
  onExportPDF?: (viz: VisualizationConfig, messageId?: string) => void;
  onExportExcel?: (viz: VisualizationConfig) => void;
  onExportPPT?: (viz: VisualizationConfig, messageId?: string) => void;
  onExportImage?: (viz: VisualizationConfig, messageId?: string) => void;
  onCopyLink?: (viz: VisualizationConfig) => void;
  onEmailWithScreenshot?: (viz: VisualizationConfig, messageId: string) => void;
  onEmailWithLink?: (viz: VisualizationConfig) => void;
  preferredExportFormat?: QuickExportFormat;
  sendMessage?: (
    text: string,
    options?: import("@/hooks/useCohiChat").SendMessageOptions,
  ) => void | Promise<void>;
  chatTenantId?: string | null;
  isLoading?: boolean;
  insightBuilderReadOnly?: boolean;
  workbenchPendingActions?: import("@/types/widgetActions").WidgetAction[];
  onApplyWorkbenchDashboardSuggestion?: (
    action: SuggestDashboardAction,
  ) => void;
}

const EnhancedChatMessageBubble: React.FC<EnhancedChatMessageBubbleProps> = ({
  message,
  onSave,
  onBuildInCanvas,
  onSpeak,
  onDrilldown,
  isFullscreen,
  voiceEnabled,
  vizTypeOverride,
  onDesignOptionClick,
  onExportPDF,
  onExportExcel,
  onExportPPT,
  onExportImage,
  onCopyLink,
  onEmailWithScreenshot,
  onEmailWithLink,
  preferredExportFormat = "ppt",
  sendMessage,
  isLoading = false,
  chatTenantId,
  insightBuilderReadOnly = false,
  workbenchPendingActions,
  onApplyWorkbenchDashboardSuggestion,
}) => {
  const isUser = message.role === "user";
  const styling = !isUser ? getMessageStyling(message.content) : null;
  const [showSql, setShowSql] = useState(false);

  // Don't parse content - render as markdown to preserve structure
  const messageContent = message.content;

  return (
    <div
      className={cn(
        "flex w-full min-w-0 pr-2",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      <div
        className={cn(
          "rounded-2xl min-w-0",
          isUser ? "max-w-[88%] w-auto" : "w-full max-w-[calc(100%-8px)]",
          isUser
            ? "bg-gradient-to-br from-blue-100 to-blue-200 text-blue-900 dark:from-blue-900/40 dark:to-indigo-900/40 dark:text-blue-100 px-4 py-2.5 shadow-sm"
            : "border border-slate-200/80 dark:border-slate-700/80 bg-slate-50/80 dark:bg-slate-800/60 shadow-sm min-w-0 overflow-x-hidden overflow-y-visible"
        )}
      >
        {message.isLoading ? (
          <div className="flex items-center gap-3 px-4 py-3">
            <Loader2 className="w-5 h-5 text-blue-500 animate-spin shrink-0" />
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Analyzing your data...
              </span>
              <div className="h-1 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden w-28">
                <motion.div
                  className="h-full bg-blue-500 rounded-full"
                  initial={{ width: "0%" }}
                  animate={{ width: "100%" }}
                  transition={{ duration: 2, repeat: Infinity }}
                />
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Compact label bar – color accent only */}
            {!isUser && styling && (
              <div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-slate-200/60 dark:border-slate-700/60">
                <span
                  className={cn(
                    "w-1 h-4 rounded-full shrink-0",
                    styling.type === "success" && "bg-emerald-500",
                    styling.type === "warning" && "bg-amber-500",
                    styling.type === "metric" && "bg-blue-500",
                    styling.type === "error" && "bg-red-500",
                    styling.type === "info" && "bg-slate-400"
                  )}
                />
                <span
                  className={cn(
                    "text-[11px] font-medium uppercase tracking-wider",
                    styling.accentColor
                  )}
                >
                  {styling.type === "success" && "Positive trend"}
                  {styling.type === "warning" && "Needs attention"}
                  {styling.type === "metric" && "Key metric"}
                  {styling.type === "error" && "Alert"}
                  {styling.type === "info" && "Analysis"}
                </span>
                {voiceEnabled && (
                  <button
                    onClick={() => onSpeak(message.content)}
                    className="ml-auto p-1.5 rounded-lg hover:bg-slate-200/60 dark:hover:bg-slate-700/60 transition-colors text-slate-500"
                    title="Read aloud"
                  >
                    <Volume2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}

            {/* Text content with full markdown support */}
            {messageContent && (
              <div
                className={cn(
                  "text-sm whitespace-pre-wrap leading-relaxed text-slate-800 dark:text-slate-200 min-w-0 break-words [overflow-wrap:anywhere]",
                  isUser ? "" : "px-4 pt-3 pb-3"
                )}
              >
                {renderMarkdownText(messageContent)}
              </div>
            )}

            {!isUser &&
              (() => {
                const summary = describeWorkbenchActionsApplied(
                  message.workbenchActions,
                );
                return summary ? (
                  <p className="px-4 pb-2 text-xs font-medium text-violet-600 dark:text-violet-400">
                    {summary}
                  </p>
                ) : null;
              })()}

            {!isUser &&
              filterSuggestDashboardActions(workbenchPendingActions).length >
                0 && (
                <WorkbenchDashboardSuggestionCard
                  actions={filterSuggestDashboardActions(workbenchPendingActions)}
                  disabled={isLoading}
                  onAddSuggested={(action) =>
                    onApplyWorkbenchDashboardSuggestion?.(action)
                  }
                  onBuildCustom={(action) => {
                    const label = formatWorkbenchSectionKey(action.sectionKey);
                    void sendMessage?.(
                      `Build a custom dashboard instead of the ${label} section. ${action.explanation}`,
                    );
                  }}
                />
              )}

            {!isUser && message.insightBuilderDraft && (
              <InsightBuilderPreviewCard
                draft={{
                  title: message.insightBuilderDraft.title,
                  prompt_text: message.insightBuilderDraft.prompt_text,
                  schedule: message.insightBuilderDraft.schedule,
                  prompt_tag: message.insightBuilderDraft.prompt_tag ?? "",
                  specifiers: message.insightBuilderDraft.specifiers ?? {},
                }}
                tenantId={chatTenantId}
                disabled={isLoading}
                readOnly={insightBuilderReadOnly}
                onApprove={(draft) => {
                  void sendMessage?.("approve", {
                    insightBuilder: { action: "approve", draft },
                  });
                }}
                onRequestChanges={(draft) => {
                  void sendMessage?.(
                    "I'd like to change this draft. What should be different?",
                    { insightBuilder: { action: "revise", draft } },
                  );
                }}
              />
            )}

            {!isUser &&
              message.navigationHints &&
              message.navigationHints.length > 0 && (
                <div className="px-4 pb-3 pt-2 border-t border-slate-200/60 dark:border-slate-700/60">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 block mb-2">
                    Go to
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {message.navigationHints.map((h) => {
                      const isWorkbenchTarget =
                        h.path.startsWith("/workbench") ||
                        h.path.startsWith("/my-dashboard");
                      return (
                        <RouterLink
                          key={`${h.path}-${h.label}`}
                          to={h.path}
                          state={cohiChatNavigationState()}
                          className={cn(
                            "inline-flex items-center rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
                            isWorkbenchTarget
                              ? "border-violet-200/90 dark:border-violet-800/80 bg-violet-50/90 dark:bg-violet-950/35 text-violet-800 dark:text-violet-200 hover:bg-violet-100 dark:hover:bg-violet-900/45"
                              : "border-blue-200/90 dark:border-blue-800/80 bg-blue-50/90 dark:bg-blue-950/35 text-blue-800 dark:text-blue-200 hover:bg-blue-100 dark:hover:bg-blue-900/45",
                          )}
                        >
                          {isWorkbenchTarget && !/workbench/i.test(h.label)
                            ? `Open in Workbench — ${h.label}`
                            : h.label}
                        </RouterLink>
                      );
                    })}
                  </div>
                </div>
              )}

            {/* Error */}
            {message.error && (
              <div className="mx-4 mb-3 px-3 py-2 flex items-center gap-2 text-red-600 dark:text-red-400 text-sm bg-red-50 dark:bg-red-950/30 rounded-xl">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>Error: {message.error}</span>
              </div>
            )}

            {/* Chart + Insights – clean separation */}
            {message.visualization &&
              !message.error &&
              (() => {
                const effectiveType = (vizTypeOverride ??
                  message.visualization!.type) as any;
                const vizConfig = {
                  ...message.visualization!,
                  type: effectiveType,
                };
                return (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                    className="mt-0 mx-0 mb-0 max-w-full min-w-0 border-t border-slate-200/60 dark:border-slate-700/60"
                  >
                    {/* Capture target: wraps ONLY the chart card so PDF/PPT
                        exports don't pick up the Design row, SQL toggle, or
                        the Save & export footer buttons. */}
                    <div
                      id={`cohi-viz-${message.id}`}
                      data-testid="cohi-chat-viz"
                    >
                      <EnhancedVisualization
                        config={{
                          type: effectiveType,
                          title: vizConfig.title || "Data Analysis",
                          subtitle: "Click on data points to drill down",
                          data: vizConfig.data || [],
                          xKey: vizConfig.xKey || vizConfig.nameKey,
                          yKey: vizConfig.yKey || vizConfig.valueKey,
                          yKeys: vizConfig.yKeys,
                          colors: vizConfig.colors,
                          showLegend: vizConfig.showLegend,
                          showGrid: vizConfig.showGrid,
                          stacked: vizConfig.stacked,
                          animated: true,
                          drilldownEnabled: true,
                          insights: [],
                        }}
                        height={isFullscreen ? 320 : 236}
                        showInsights={false}
                        onDrilldown={onDrilldown}
                        compact={!isFullscreen}
                      />
                    </div>

                    {/* Design options – click to change chart type */}
                    <div className="border-t border-slate-200/50 dark:border-slate-700/50 bg-slate-50/80 dark:bg-slate-800/40 px-3 py-2 overflow-x-auto">
                      <div className="flex items-center gap-1.5 min-w-max">
                        <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mr-1.5 shrink-0">
                          Design
                        </span>
                        {VIZ_DESIGN_OPTIONS.map(({ type, label, Icon }) => (
                          <Button
                            key={type}
                            variant="ghost"
                            size="sm"
                            className={cn(
                              "h-6 px-2 text-[11px] rounded-md shrink-0",
                              effectiveType === type
                                ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-medium"
                                : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-700/60"
                            )}
                            onClick={() =>
                              onDesignOptionClick?.(message.id, type)
                            }
                          >
                            <Icon className="w-3 h-3 mr-1" />
                            {label}
                          </Button>
                        ))}
                      </div>
                    </div>

                    {/* Show SQL toggle */}
                    {message.sqlQuery && (
                      <div className="border-t border-slate-200/50 dark:border-slate-700/50">
                        <button
                          onClick={() => setShowSql((prev) => !prev)}
                          className="flex items-center gap-1.5 px-4 py-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors w-full text-left"
                        >
                          <Code className="w-3 h-3" />
                          {showSql ? "Hide SQL" : "Show SQL"}
                        </button>
                        {showSql && (
                          <pre className="px-4 pb-3 text-[11px] font-mono text-slate-600 dark:text-slate-300 bg-slate-100/80 dark:bg-slate-900/60 overflow-x-auto whitespace-pre-wrap break-words leading-relaxed">
                            {message.sqlQuery}
                          </pre>
                        )}
                      </div>
                    )}

                    <div
                      className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 bg-slate-100/60 dark:bg-slate-800/30"
                      data-testid="cohi-chat-viz-footer"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                          {effectiveType}
                        </span>
                        <span className="text-[10px] text-blue-600 dark:text-blue-400 font-medium">
                          AI
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 justify-end ml-auto max-w-full">
                        {message.visualizationArtifactId && (
                          <RouterLink
                            to={workbenchArtifactHandoffPath(
                              message.visualizationArtifactId,
                            )}
                            state={cohiChatNavigationState()}
                            className="inline-flex items-center h-8 rounded-md px-2.5 text-[11px] font-medium gap-1.5 border border-violet-200/90 dark:border-violet-800/80 bg-violet-50/90 dark:bg-violet-950/35 text-violet-800 dark:text-violet-200 hover:bg-violet-100 dark:hover:bg-violet-900/45"
                            data-testid="cohi-chat-open-workbench-artifact"
                          >
                            <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                            Open in Workbench
                          </RouterLink>
                        )}
                        <div className="flex items-center overflow-hidden rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 rounded-none px-2.5 text-[11px] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                            onClick={() =>
                              preferredExportFormat === "pdf"
                                ? onExportPDF?.(vizConfig, message.id)
                                : onExportPPT?.(vizConfig, message.id)
                            }
                            title={
                              preferredExportFormat === "pdf"
                                ? "Download PDF"
                                : "Download PowerPoint"
                            }
                            data-testid="cohi-chat-export-primary"
                            data-export-format={preferredExportFormat}
                          >
                            {preferredExportFormat === "pdf" ? (
                              <FileText className="w-3.5 h-3.5 mr-1.5 text-red-500 shrink-0" />
                            ) : (
                              <Presentation className="w-3.5 h-3.5 mr-1.5 text-orange-500 shrink-0" />
                            )}
                            {preferredExportFormat === "pdf" ? "PDF" : "PPT"}
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-7 rounded-none border-l border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-900 dark:hover:text-white"
                                title="Choose export format"
                                data-testid="cohi-chat-export-menu-trigger"
                              >
                                <ChevronDown className="w-3.5 h-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                              align="end"
                              className="w-48 z-[10001]"
                              sideOffset={4}
                            >
                              <DropdownMenuItem
                                onClick={() =>
                                  onExportPDF?.(vizConfig, message.id)
                                }
                                className="gap-2 py-2"
                                data-testid="cohi-chat-export-pdf"
                              >
                                <FileText className="w-4 h-4 text-red-500 shrink-0" />
                                <span>Download PDF</span>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() =>
                                  onExportPPT?.(vizConfig, message.id)
                                }
                                className="gap-2 py-2"
                                data-testid="cohi-chat-export-ppt"
                              >
                                <Presentation className="w-4 h-4 text-orange-500 shrink-0" />
                                <span>Download PowerPoint</span>
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 rounded-md px-2.5 text-[11px] gap-1.5 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700"
                          onClick={() =>
                            onBuildInCanvas(
                              vizConfig,
                              message.content,
                              message.sqlQuery,
                            )
                          }
                          title="Edit this chart in the PowerPoint Editor (opens Workbench with slide 1 seeded)"
                          aria-label="Edit in PowerPoint Editor"
                          data-testid="cohi-chat-edit-in-ppt"
                        >
                          <Presentation className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400 shrink-0" />
                          Edit in PPT Editor
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-[11px] h-8 px-2.5 rounded-md text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white shrink-0"
                              title="More save and export options"
                            >
                              <MoreHorizontal className="w-3.5 h-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="end"
                            className="w-64 z-[10001]"
                            sideOffset={4}
                          >
                          <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-2 py-1.5">
                            Save
                          </DropdownMenuLabel>
                          <DropdownMenuItem
                            onClick={() => onSave(vizConfig, message.content, message.sqlQuery)}
                            className="gap-2 py-2"
                          >
                            <Save className="w-4 h-4 text-slate-500 shrink-0" />
                            <span>Save to Workbench</span>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-2 py-1.5">
                            Export
                          </DropdownMenuLabel>
                          <DropdownMenuItem
                            onClick={() => onExportExcel?.(vizConfig)}
                            className="gap-2 py-2"
                          >
                            <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
                            <span>Export Excel (CSV)</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              onExportImage?.(vizConfig, message.id)
                            }
                            className="gap-2 py-2"
                          >
                            <Image className="w-4 h-4 text-violet-500 shrink-0" />
                            <span>Download as Image</span>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-2 py-1.5">
                            Share
                          </DropdownMenuLabel>
                          <DropdownMenuItem
                            onClick={() => onCopyLink?.(vizConfig)}
                            className="gap-2 py-2"
                          >
                            <Link className="w-4 h-4 text-blue-500 shrink-0" />
                            <span>Copy link</span>
                          </DropdownMenuItem>
                          <DropdownMenuSub>
                            <DropdownMenuSubTrigger className="gap-2 py-2">
                              <Mail className="w-4 h-4 text-purple-500 shrink-0" />
                              <span>Email</span>
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent className="w-56 z-[10002]">
                              <DropdownMenuItem
                                onClick={() =>
                                  onEmailWithScreenshot?.(vizConfig, message.id)
                                }
                                className="gap-2 py-2.5"
                              >
                                <Image className="w-4 h-4 text-violet-500 shrink-0" />
                                <div className="flex flex-col items-start gap-0.5">
                                  <span className="text-sm font-medium">
                                    Image in body
                                  </span>
                                  <span className="text-[10px] text-slate-400">
                                    Screenshot copied; paste into email
                                  </span>
                                </div>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => onEmailWithLink?.(vizConfig)}
                                className="gap-2 py-2.5"
                              >
                                <Link className="w-4 h-4 text-blue-500 shrink-0" />
                                <div className="flex flex-col items-start gap-0.5">
                                  <span className="text-sm font-medium">
                                    Link to live chart
                                  </span>
                                  <span className="text-[10px] text-slate-400">
                                    Recipient opens chart in app
                                  </span>
                                </div>
                              </DropdownMenuItem>
                            </DropdownMenuSubContent>
                          </DropdownMenuSub>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </motion.div>
                );
              })()}
          </>
        )}
      </div>
    </div>
  );
};

export default CohiChatPanel;
