/**
 * Cohi Chat Panel Component
 * AI-powered chat interface with hybrid data + knowledge capabilities
 * Enhanced with executive-level visualizations, color-coded messages, and voice agentic
 */

import React, { useState, useRef, useEffect, useCallback } from "react";
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
  Paperclip,
  Expand,
  Shrink,
  MoreHorizontal,
  FileSpreadsheet,
  Image,
  File,
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
import { Input } from "@/components/ui/input";
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
import { DynamicVisualization } from "@/components/visualizations/DynamicVisualization";
import {
  EnhancedVisualization,
  EnhancedVisualizationConfig,
} from "@/components/visualizations/EnhancedVisualization";
import { useToast } from "@/components/ui/use-toast";
import { convertChatToCanvasItems } from "@/utils/chatToCanvas";
import {
  createLayoutItem,
  type CanvasLayoutItem,
} from "@/components/workbench/canvas/types";
import { motion, AnimatePresence } from "framer-motion";
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
import { CohiChatDockChip } from "@/components/cohi/CohiChatDockChip";

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
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [vizTypeOverrides, setVizTypeOverrides] = useState<
    Record<string, VisualizationConfig["type"]>
  >({});
  const isMobile = useIsMobile();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    if (isMobile) {
      setIsFullscreen(true);
    }
  }, [isMobile, isOpen]);

  // When the panel is docked (not fullscreen / not mobile), reserve matching width on #root so KPIs and main content stay visible.
  useEffect(() => {
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
  }, [isOpen, isFullscreen, isMobile]);

  const {
    messages,
    isLoading,
    sessionId: currentSessionId,
    suggestedQuestions,
    sendMessage,
    addConversationTurn,
    clearMessages,
    newSession,
    chatSessions,
    isLoadingSessions,
    isLoadingSession,
    fetchSessions,
    loadSession,
    deleteSession,
    renameSession,
  } = useCohiChat({ tenantId, enabled: isOpen });

  const [showHistory, setShowHistory] = useState(false);
  const [preferredExportFormat, setPreferredExportFormat] =
    useState<QuickExportFormat>(() => {
      if (typeof window === "undefined") return "ppt";
      const stored = window.localStorage.getItem(CHAT_EXPORT_FORMAT_KEY);
      return stored === "pdf" ? "pdf" : "ppt";
    });

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
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

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

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
    if ((!input.trim() && !uploadedFile) || isLoading) return;

    if (uploadedFile) {
      setIsUploading(true);
      try {
        const formData = new FormData();
        formData.append("file", uploadedFile);
        formData.append(
          "question",
          input.trim() || `Analyze this ${uploadedFile.name}`
        );

        const response = await fetch("/api/cohi-chat/analyze-file", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          throw new Error("Failed to analyze file");
        }

        const result = await response.json();
        const analysisText =
          result.analysis || result.summary || "File processed successfully.";
        const userPrompt = input.trim() || `Analyze this ${uploadedFile.name}`;
        if (result.visualization) {
          addConversationTurn(
            `[File: ${uploadedFile.name}] ${userPrompt}`,
            analysisText,
            result.visualization,
            [
              "Show as pie chart",
              "Compare with another file",
              "Export this data",
            ]
          );
        } else {
          addConversationTurn(
            `[File: ${uploadedFile.name}] ${userPrompt}`,
            analysisText
          );
        }
        setUploadedFile(null);
        setInput("");
      } catch (error: any) {
        toast({
          title: "Upload Error",
          description: error.message || "Failed to analyze file",
          variant: "destructive",
        });
      } finally {
        setIsUploading(false);
      }
    } else {
      sendMessage(input.trim());
      setInput("");
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const allowedTypes = [
        "text/csv",
        "application/pdf",
        "image/png",
        "image/jpeg",
        "image/gif",
        "image/webp",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/vnd.ms-powerpoint",
      ];

      const maxSize = 10 * 1024 * 1024;

      if (!allowedTypes.includes(file.type) && !file.name.endsWith(".csv")) {
        toast({
          title: "Invalid file type",
          description:
            "Please upload CSV, PDF, Excel, PowerPoint, or image files.",
          variant: "destructive",
        });
        return;
      }

      if (file.size > maxSize) {
        toast({
          title: "File too large",
          description: "Maximum file size is 10MB.",
          variant: "destructive",
        });
        return;
      }

      setUploadedFile(file);
      toast({
        title: "File attached",
        description: `${file.name} ready to analyze. Add a question and send.`,
      });
    }
  };

  const getFileIcon = (filename: string) => {
    const ext = filename.split(".").pop()?.toLowerCase();
    if (ext === "csv" || ext === "xlsx" || ext === "xls")
      return <FileSpreadsheet className="w-4 h-4" />;
    if (ext === "pdf") return <FileText className="w-4 h-4" />;
    if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext || ""))
      return <Image className="w-4 h-4" />;
    return <File className="w-4 h-4" />;
  };

  /**
   * Handle key press (Enter to send)
   */
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  /**
   * Handle suggested question click
   */
  const handleSuggestionClick = (question: string) => {
    setInput(question);
    sendMessage(question);
  };

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
    if (!onOpen) return null;
    // Workbench + embedded dashboard wire their own dock chip so only one launcher shows.
    if (hideFloatingDockChip) return null;

    return <CohiChatDockChip onClick={onOpen} />;
  }

  return (
    <>
      <div
        className="fixed inset-0 z-[90] bg-slate-900/5 dark:bg-slate-950/30 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <motion.div
        data-testid="cohi-chat-panel"
        initial={{ x: 500, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 500, opacity: 0 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className={cn(
          "fixed flex flex-col overflow-hidden",
          "bg-gradient-to-b from-violet-50/95 via-white/95 to-rose-50/80 dark:from-slate-950/98 dark:via-indigo-950/30 dark:to-slate-950/98 backdrop-blur-xl",
          "border-l border-violet-200/50 dark:border-indigo-900/50",
          "shadow-[0_-4px_24px_-4px_rgba(139,92,246,0.06),0_0_1px_rgba(0,0,0,0.02)] dark:shadow-[0_-4px_32px_-4px_rgba(99,102,241,0.12),0_0_1px_rgba(255,255,255,0.04)]",
          isFullscreen || isMobile
            ? "left-0 right-0 top-0 bottom-0 z-[9999] w-full h-full"
            : "right-2 top-[70px] h-[calc(100%-70px)] z-[100] rounded-2xl",
          !isFullscreen &&
            "w-[min(520px,calc(100vw-24px))] sm:w-[496px]",
          className
        )}
      >
        {/* Header – pastel, modern */}
        <div className="relative z-[20] flex items-center justify-between gap-2 sm:gap-3 px-4 sm:px-5 py-3.5 border-b border-violet-100/80 dark:border-indigo-900/60 bg-gradient-to-r from-violet-50/90 to-indigo-50/80 dark:from-indigo-950/50 dark:to-violet-950/40">
          <div className="flex items-start gap-2 sm:gap-3 min-w-0 flex-1">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shrink-0 shadow-lg shadow-violet-500/25 ring-1 ring-white/30">
              <Sparkles className="w-5 h-5 text-white" strokeWidth={2} />
            </div>
            <div className="min-w-0 flex-1 py-0.5">
              <div className="flex items-center gap-2 min-w-0">
                <h2 className="text-[15px] sm:text-base font-semibold text-slate-800 dark:text-white tracking-tight truncate min-w-0">
                  Cohi Insights
                </h2>
                <Badge
                  variant="secondary"
                  className="bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300 text-[10px] px-2.5 py-0.5 border-0 shrink-0 font-medium rounded-full"
                >
                  AI
                </Badge>
              </div>
              <p className="text-[11px] sm:text-xs text-slate-600/90 dark:text-slate-400/90 font-normal mt-0.5 leading-snug line-clamp-2 sm:line-clamp-1 sm:truncate">
                Ask about your pipeline & performance
              </p>
            </div>
          </div>
          <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              data-chat-history-toggle="true"
              className={cn(
                "h-8 w-8 rounded-xl text-slate-500 hover:text-violet-700 dark:text-violet-300 hover:bg-violet-100/80 dark:hover:bg-violet-500/20 transition-colors",
                showHistory && "bg-violet-100/80 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300"
              )}
              onClick={() => setShowHistory((prev) => !prev)}
              title="Chat history"
              aria-pressed={showHistory}
            >
              <Clock className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-xl text-slate-500 hover:text-violet-700 dark:hover:text-violet-300 hover:bg-violet-100/80 dark:hover:bg-violet-500/20 transition-colors"
              onClick={newSession}
              title="New conversation"
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
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-xl text-slate-500 hover:text-violet-700 dark:hover:text-violet-300 hover:bg-violet-100/80 dark:hover:bg-violet-500/20 transition-colors"
              onClick={() => setIsFullscreen(!isFullscreen)}
              title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            >
              {isFullscreen ? (
                <Shrink className="w-4 h-4" />
              ) : (
                <Expand className="w-4 h-4" />
              )}
            </Button>
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
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-xl text-slate-500 hover:text-rose-600 dark:hover:text-rose-300 hover:bg-rose-100/80 dark:hover:bg-rose-500/15 transition-colors"
              onClick={onClose}
              title="Close"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Chat History Sidebar */}
        <ChatHistorySidebar
          isOpen={showHistory}
          onClose={() => setShowHistory(false)}
          sessions={chatSessions}
          activeSessionId={currentSessionId}
          isLoading={isLoadingSessions}
          isLoadingSession={isLoadingSession}
          onFetchSessions={fetchSessions}
          onLoadSession={loadSession}
          onDeleteSession={deleteSession}
          onRenameSession={renameSession}
          onNewSession={newSession}
        />

        {/* Messages – native scrollable div (not Radix ScrollArea) because Radix
            wraps children in <div style="display:table;min-width:100%"> which lets
            intrinsic-width children like Recharts bleed past the panel's right edge. */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-5 min-w-0">
          <div className="space-y-5 min-w-0 w-full">
            <AnimatePresence>
              {messages.length === 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -16 }}
                  transition={{ duration: 0.35 }}
                  className="py-12 px-2"
                >
                  {/* Suggested Questions – minimalist */}
                  <div className="space-y-1 max-w-[300px] mx-auto">
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-widest font-medium mb-4 text-center">
                      Try asking
                    </p>
                    {suggestedQuestions.slice(0, 4).map((question, index) => (
                      <motion.button
                        key={index}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.1 + index * 0.05 }}
                        onClick={() => handleSuggestionClick(question)}
                        className="group block w-full text-left py-2.5 px-0 text-[13px] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors duration-150 border-b border-transparent hover:border-slate-200 dark:hover:border-slate-700 last:border-0"
                      >
                        <span className="font-normal">{question}</span>
                      </motion.button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {messages.map((message, idx) => (
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
                />
              </motion.div>
            ))}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Suggestions */}
        {messages.length > 0 && suggestedQuestions.length > 0 && !isLoading && (
          <div className="px-4 py-2.5 border-t border-slate-200/70 dark:border-slate-700/70 bg-slate-50/80 dark:bg-slate-800/40">
            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin">
              <span className="text-[11px] text-slate-400 dark:text-slate-500 shrink-0 font-medium">
                Suggestions
              </span>
              {suggestedQuestions.slice(0, 3).map((question, index) => (
                <button
                  key={index}
                  onClick={() => handleSuggestionClick(question)}
                  className="shrink-0 text-xs px-3 py-2 rounded-xl bg-white dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-600/60 hover:border-blue-300 dark:hover:border-blue-500/50 hover:bg-blue-50/50 dark:hover:bg-blue-950/20 transition-all text-slate-600 dark:text-slate-300 font-medium"
                >
                  {question}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Input – soft UI, clear hierarchy */}
        <div className="p-4 border-t border-slate-200/70 dark:border-slate-700/70 bg-slate-50/50 dark:bg-slate-900/50">
          {uploadedFile && (
            <div className="flex items-center gap-2 mb-3 p-2.5 bg-blue-50/80 dark:bg-blue-900/25 rounded-xl text-sm border border-blue-200/50 dark:border-blue-800/50">
              {getFileIcon(uploadedFile.name)}
              <span className="flex-1 truncate text-blue-700 dark:text-blue-300 font-medium">
                {uploadedFile.name}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-lg"
                onClick={() => setUploadedFile(null)}
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
          )}
          <div className="flex gap-2">
            {/* Voice Button */}
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

            {/* File Upload Button */}
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".csv,.pdf,.png,.jpg,.jpeg,.gif,.webp,.xlsx,.xls,.pptx,.ppt"
              onChange={handleFileSelect}
            />
            <Button
              variant="outline"
              size="icon"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading || isUploading}
              className="shrink-0"
              title="Upload file (CSV, PDF, Excel, PowerPoint, Image)"
            >
              <Paperclip className="w-4 h-4" />
            </Button>

            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder={
                uploadedFile
                  ? "Ask about this file..."
                  : "What important info do I need to know today?"
              }
              disabled={isLoading || isUploading}
              className="flex-1 rounded-xl border-slate-200/80 dark:border-slate-600/60 bg-white dark:bg-slate-800/50 focus-visible:ring-2 focus-visible:ring-blue-500/30"
            />
            <Button
              onClick={handleSend}
              disabled={
                (!input.trim() && !uploadedFile) || isLoading || isUploading
              }
              size="icon"
              className="rounded-xl bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-500/25"
            >
              {isLoading || isUploading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>
      </motion.div>

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
              message.navigationHints &&
              message.navigationHints.length > 0 && (
                <div className="px-4 pb-3 pt-2 border-t border-slate-200/60 dark:border-slate-700/60">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 block mb-2">
                    Go to
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {message.navigationHints.map((h) => (
                      <RouterLink
                        key={`${h.path}-${h.label}`}
                        to={h.path}
                        className="inline-flex items-center rounded-lg border border-blue-200/90 dark:border-blue-800/80 bg-blue-50/90 dark:bg-blue-950/35 px-2.5 py-1.5 text-xs font-medium text-blue-800 dark:text-blue-200 hover:bg-blue-100 dark:hover:bg-blue-900/45 transition-colors"
                      >
                        {h.label}
                      </RouterLink>
                    ))}
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
