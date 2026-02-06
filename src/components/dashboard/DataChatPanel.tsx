/**
 * Cohi Chat Panel Component
 * AI-powered chat interface with hybrid data + knowledge capabilities
 * Enhanced with executive-level visualizations, color-coded messages, and voice agentic
 */

import React, { useState, useRef, useEffect, useCallback } from "react";
import { Rnd } from "react-rnd";
import {
  MessageSquare,
  Send,
  X,
  Minimize2,
  Maximize2,
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
  VolumeX,
  BarChart3,
  PieChart,
  Activity,
  Paperclip,
  Expand,
  Shrink,
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
  LayoutDashboard,
  Trophy,
  Zap,
  Newspaper,
  Filter,
  ArrowLeftRight,
  Shield,
  ClipboardList,
  LineChart,
  Calculator,
  Pin,
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
import { DynamicVisualization } from "@/components/visualizations/DynamicVisualization";
import {
  EnhancedVisualization,
  EnhancedVisualizationConfig,
  CohiInsight,
} from "@/components/visualizations/EnhancedVisualization";
import { CohiInsightPanel } from "@/components/cohi/CohiInsightPanel";
import { useToast } from "@/components/ui/use-toast";
import { useCanvasPinStore } from "@/stores/canvasPinStore";
import { CanvasWidgetCard } from "@/components/workbench/canvas/CanvasWidgetCard";
import { WidgetRenderer } from "@/components/workbench/canvas/WidgetRenderer";
import {
  createLayoutItem,
  type CanvasLayoutItem,
} from "@/components/workbench/canvas/types";
import { motion, AnimatePresence } from "framer-motion";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
} from "@/components/ui/dropdown-menu";

// ============================================================================
// Helper Functions
// ============================================================================

function generateCohiInsights(
  visualization: VisualizationConfig
): CohiInsight[] {
  const insights: CohiInsight[] = [];
  const data = visualization.data || [];

  if (data.length === 0) return insights;

  const valueKey = visualization.yKey || visualization.valueKey || "value";
  const nameKey = visualization.xKey || visualization.nameKey || "name";

  const values = data
    .map((d) =>
      typeof d[valueKey] === "number"
        ? d[valueKey]
        : parseFloat(d[valueKey]) || 0
    )
    .filter((v) => !isNaN(v) && isFinite(v));

  if (values.length === 0) return insights;

  const total = values.reduce((sum, v) => sum + v, 0);
  const avg = values.length > 0 ? total / values.length : 0;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const maxItem = data.find((d) => (d[valueKey] || 0) === max);
  const minItem = data.find((d) => (d[valueKey] || 0) === min);

  if (avg === 0 || !isFinite(avg)) return insights;

  if (maxItem) {
    insights.push({
      type: "success",
      title: "Top Performer",
      description: `${maxItem[nameKey]} leads with ${formatInsightValue(max)}`,
      metric: `${((max / total) * 100).toFixed(1)}% of total`,
      trend: "up",
      payload: maxItem,
    });
  }

  if (minItem && values.length > 2) {
    const avgDiff = ((avg - min) / avg) * 100;
    if (avgDiff > 20) {
      insights.push({
        type: "warning",
        title: "Needs Attention",
        description: `${minItem[nameKey]} is ${avgDiff.toFixed(
          0
        )}% below average`,
        metric: formatInsightValue(min),
        trend: "down",
        payload: minItem,
      });
    }
  }

  const variance =
    values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / values.length;
  const stdDev = Math.sqrt(variance);
  const cv = (stdDev / avg) * 100;

  if (cv > 50) {
    insights.push({
      type: "info",
      title: "High Variance",
      description: "Performance varies significantly across the dataset",
      metric: `CV: ${cv.toFixed(1)}%`,
      payload: data[0],
    });
  } else if (cv < 15) {
    insights.push({
      type: "success",
      title: "Consistent Performance",
      description: "Values are tightly clustered around the average",
      metric: `Avg: ${formatInsightValue(avg)}`,
      payload: data[0],
    });
  }

  return insights.slice(0, 4);
}

function formatInsightValue(value: number): string {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`;
  if (value < 1 && value > 0) return `${(value * 100).toFixed(1)}%`;
  return value.toLocaleString();
}

// ============================================================================
// Types
// ============================================================================

interface DataChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onOpen?: () => void;
  tenantId?: string;
  className?: string;
}

interface SaveDialogState {
  isOpen: boolean;
  visualization: VisualizationConfig | null;
  question: string;
}

/** Optional override for quick export from message bubble (no dialog) */
type ExportOverride = {
  visualization: VisualizationConfig;
  title?: string;
  description?: string;
};

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

/**
 * Parse markdown and render as React elements
 * Supports: links [text](url), **bold**, bullet lists, numbered lists
 */
const renderMarkdownText = (text: string): React.ReactNode => {
  // First, split by double newlines to get paragraphs/sections
  const sections = text.split(/\n\n+/);

  const renderInlineMarkdown = (
    line: string,
    keyPrefix: string
  ): React.ReactNode => {
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;

    // Combined regex for links and bold
    const combinedRegex = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*/g;
    let match;
    let matchIndex = 0;

    while ((match = combinedRegex.exec(line)) !== null) {
      // Add text before match
      if (match.index > lastIndex) {
        parts.push(line.slice(lastIndex, match.index));
      }

      if (match[1] && match[2]) {
        // It's a link: [text](url)
        parts.push(
          <a
            key={`${keyPrefix}-link-${matchIndex}`}
            href={match[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
          >
            {match[1]}
          </a>
        );
      } else if (match[3]) {
        // It's bold: **text**
        parts.push(
          <strong
            key={`${keyPrefix}-bold-${matchIndex}`}
            className="font-semibold"
          >
            {match[3]}
          </strong>
        );
      }

      lastIndex = match.index + match[0].length;
      matchIndex++;
    }

    // Add remaining text
    if (lastIndex < line.length) {
      parts.push(line.slice(lastIndex));
    }

    return parts.length > 0 ? parts : line;
  };

  return (
    <div className="space-y-3">
      {sections.map((section, sectionIdx) => {
        const lines = section.split("\n");

        // Check if this section is a list
        const isNumberedList = lines.some((l) => /^\d+\.\s/.test(l.trim()));
        const isBulletList = lines.some(
          (l) => /^[-•*]\s/.test(l.trim()) && !l.trim().startsWith("**")
        );

        if (isNumberedList || isBulletList) {
          // Render as list with proper indentation
          return (
            <div key={sectionIdx} className="space-y-1">
              {lines.map((line, lineIdx) => {
                const trimmed = line.trim();
                if (!trimmed) return null;

                // Calculate indentation level
                const leadingSpaces = line.match(/^(\s*)/)?.[1].length || 0;
                const indentLevel = Math.floor(leadingSpaces / 2);

                // Check line type
                const numberedMatch = trimmed.match(/^(\d+)\.\s*(.*)/);
                const bulletMatch = trimmed.match(/^[-•*]\s*(.*)/);

                // Use explicit Tailwind classes for indentation (dynamic classes don't work)
                const marginClasses = ["", "ml-4", "ml-8", "ml-12"];
                const marginClass =
                  marginClasses[Math.min(indentLevel, 3)] || "";

                if (numberedMatch) {
                  return (
                    <div
                      key={`${sectionIdx}-${lineIdx}`}
                      className={`flex gap-2 ${marginClass}`}
                    >
                      <span className="text-slate-500 dark:text-slate-400 font-medium shrink-0">
                        {numberedMatch[1]}.
                      </span>
                      <span>
                        {renderInlineMarkdown(
                          numberedMatch[2],
                          `${sectionIdx}-${lineIdx}`
                        )}
                      </span>
                    </div>
                  );
                } else if (bulletMatch) {
                  return (
                    <div
                      key={`${sectionIdx}-${lineIdx}`}
                      className={`flex gap-2 ${marginClass}`}
                    >
                      <span className="text-slate-400 dark:text-slate-500 shrink-0">
                        •
                      </span>
                      <span>
                        {renderInlineMarkdown(
                          bulletMatch[1],
                          `${sectionIdx}-${lineIdx}`
                        )}
                      </span>
                    </div>
                  );
                } else {
                  // Regular text line in a list context (like a header)
                  return (
                    <div
                      key={`${sectionIdx}-${lineIdx}`}
                      className={marginClass}
                    >
                      {renderInlineMarkdown(
                        trimmed,
                        `${sectionIdx}-${lineIdx}`
                      )}
                    </div>
                  );
                }
              })}
            </div>
          );
        }

        // Regular paragraph
        return (
          <p key={sectionIdx}>
            {renderInlineMarkdown(
              section.replace(/\n/g, " "),
              `p-${sectionIdx}`
            )}
          </p>
        );
      })}
    </div>
  );
};

const CHAT_CANVAS_DEFAULT_SIZE = { w: 360, h: 240 };
const CHAT_CANVAS_GAP = 16;

type ChatDashboardItem = {
  id: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  iconClass?: string;
};

const CHAT_DASHBOARD_GROUPS: { label: string; items: ChatDashboardItem[] }[] = [
  {
    label: "Insights",
    items: [
      {
        id: "aletheiaInsights",
        title: "Cohi Daily Briefings",
        icon: Zap,
        iconClass: "text-emerald-500",
      },
      {
        id: "industryNews",
        title: "Mortgage News",
        icon: Newspaper,
        iconClass: "text-blue-500",
      },
    ],
  },
  {
    label: "Dashboards",
    items: [
      {
        id: "leaderboard",
        title: "Leaderboard",
        icon: Trophy,
        iconClass: "text-amber-500",
      },
      {
        id: "executiveDashboard",
        title: "Business Overview",
        icon: Target,
        iconClass: "text-blue-500",
      },
      {
        id: "closingFalloutForecast",
        title: "Closing & Fallout Forecast",
        icon: BarChart3,
        iconClass: "text-emerald-500",
      },
    ],
  },
  {
    label: "Top Tiering",
    items: [
      {
        id: "loanFunnel",
        title: "Loan Funnel",
        icon: Filter,
        iconClass: "text-blue-500",
      },
      {
        id: "topTieringComparison",
        title: "TopTiering Comparison",
        icon: ArrowLeftRight,
        iconClass: "text-sky-500",
      },
      {
        id: "creditRiskManagement",
        title: "Credit Risk Management",
        icon: Shield,
        iconClass: "text-emerald-500",
      },
      {
        id: "companyScorecard",
        title: "Company Scorecard",
        icon: ClipboardList,
        iconClass: "text-indigo-500",
      },
    ],
  },
  {
    label: "Sales",
    items: [
      {
        id: "salesScorecard",
        title: "Scorecard",
        icon: Target,
        iconClass: "text-violet-500",
      },
      {
        id: "salesTrends",
        title: "Trends",
        icon: TrendingUp,
        iconClass: "text-emerald-500",
      },
    ],
  },
  {
    label: "Operations",
    items: [
      {
        id: "operationsScorecard",
        title: "Scorecard",
        icon: Target,
        iconClass: "text-indigo-500",
      },
      {
        id: "operationsTrends",
        title: "Trends",
        icon: LineChart,
        iconClass: "text-blue-500",
      },
    ],
  },
  {
    label: "Financial Modeling",
    items: [
      {
        id: "financialModeling",
        title: "Financial Modeling Sandbox",
        icon: Calculator,
        iconClass: "text-amber-500",
      },
    ],
  },
];

const CHAT_HIDEABLE_SECTIONS: Record<string, { id: string; label: string }[]> =
  {
    topTiering: [
      { id: "dailyStory", label: "Executive summary / Daily Story" },
      { id: "chart", label: "Funnel / Detail chart" },
    ],
    loanFunnel: [
      { id: "dailyStory", label: "Executive summary / Daily Story" },
      { id: "chart", label: "Funnel / Detail chart" },
    ],
  };

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

export const DataChatPanel: React.FC<DataChatPanelProps> = ({
  isOpen,
  onClose,
  onOpen,
  tenantId,
  className,
}) => {
  const { toast } = useToast();
  const [input, setInput] = useState("");
  const [isExpanded, setIsExpanded] = useState(true);
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
  const [saveDialog, setSaveDialog] = useState<SaveDialogState>({
    isOpen: false,
    visualization: null,
    question: "",
  });
  const [saveTitle, setSaveTitle] = useState("");
  const [saveDescription, setSaveDescription] = useState("");
  const [chatCanvasItems, setChatCanvasItems] = useState<CanvasLayoutItem[]>(
    []
  );
  const [selectedCanvasId, setSelectedCanvasId] = useState<string | null>(null);
  const [chatCanvasWidth, setChatCanvasWidth] = useState(360);
  const [lastDashboardLabel, setLastDashboardLabel] = useState("Add dashboard");
  const isMobile = useIsMobile();
  const chatCanvasRef = useRef<HTMLDivElement>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    const el = chatCanvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry?.contentRect.width) {
        setChatCanvasWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    setChatCanvasWidth(el.getBoundingClientRect().width || 360);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    if (isMobile) {
      setIsFullscreen(true);
      setIsExpanded(false);
    }
  }, [isMobile, isOpen]);

  const getNextCanvasPosition = useCallback(() => {
    if (chatCanvasItems.length === 0) return { x: 0, y: 0 };
    let maxY = 0;
    chatCanvasItems.forEach((item) => {
      const bottom = item.y + item.h;
      if (bottom > maxY) maxY = bottom;
    });
    return { x: 0, y: maxY + CHAT_CANVAS_GAP };
  }, [chatCanvasItems]);

  const updateCanvasItemRect = useCallback(
    (
      id: string,
      next: Partial<Pick<CanvasLayoutItem, "x" | "y" | "w" | "h">>
    ) => {
      setChatCanvasItems((prev) =>
        prev.map((i) => (i.i === id ? { ...i, ...next } : i))
      );
    },
    []
  );

  const updateCanvasWidgetPayload = useCallback(
    (id: string, payload: CanvasLayoutItem["payload"]) => {
      setChatCanvasItems((prev) =>
        prev.map((i) => (i.i === id ? { ...i, payload } : i))
      );
    },
    []
  );

  const addDashboardToCanvas = useCallback(
    (sectionId: string, title: string) => {
      const id = `cohi-canvas-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      const { x, y } = getNextCanvasPosition();
      const baseWidth = Math.max(
        220,
        Math.min(chatCanvasWidth - 16, isMobile ? 320 : 420)
      );
      const baseHeight = Math.max(200, Math.round(baseWidth * 0.6));
      const newItem = createLayoutItem(
        id,
        "dashboard_section",
        { type: "dashboard_section", sectionId, title },
        { x, y, w: baseWidth, h: baseHeight }
      );
      setChatCanvasItems((prev) => [...prev, newItem]);
      setSelectedCanvasId(id);
      setLastDashboardLabel(title);
    },
    [chatCanvasWidth, getNextCanvasPosition]
  );

  const addVisualizationToCanvas = useCallback(
    (payload: { visualization?: VisualizationConfig }) => {
      if (!payload.visualization) return;
      const id = `cohi-viz-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      const { x, y } = getNextCanvasPosition();
      const baseWidth = Math.max(
        220,
        Math.min(chatCanvasWidth - 16, isMobile ? 320 : 420)
      );
      const baseHeight = Math.max(220, Math.round(baseWidth * 0.6));
      const newItem = createLayoutItem(
        id,
        "chart",
        { type: "chart", config: payload.visualization },
        { x, y, w: baseWidth, h: baseHeight }
      );
      setChatCanvasItems((prev) => [...prev, newItem]);
      setSelectedCanvasId(id);
    },
    [chatCanvasWidth, getNextCanvasPosition]
  );

  const duplicateCanvasItem = useCallback(
    (id: string) => {
      const item = chatCanvasItems.find((i) => i.i === id);
      if (!item) return;
      const newId = `cohi-canvas-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      const { x, y } = getNextCanvasPosition();
      const copy = { ...item, i: newId, x, y };
      setChatCanvasItems((prev) => [...prev, copy]);
      setSelectedCanvasId(newId);
    },
    [chatCanvasItems, getNextCanvasPosition]
  );

  const removeCanvasItem = useCallback(
    (id: string) => {
      setChatCanvasItems((prev) => prev.filter((i) => i.i !== id));
      if (selectedCanvasId === id) setSelectedCanvasId(null);
    },
    [selectedCanvasId]
  );

  const {
    messages,
    isLoading,
    suggestedQuestions,
    sendMessage,
    addConversationTurn,
    saveVisualization,
    clearMessages,
    newSession,
  } = useCohiChat({ tenantId });

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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

        const response = await fetch("/api/data-chat/analyze-file", {
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
   * Open save dialog
   */
  const handleOpenSaveDialog = (
    visualization: VisualizationConfig,
    question: string
  ) => {
    setSaveTitle(visualization.title || "My Visualization");
    setSaveDescription("");
    setSaveDialog({ isOpen: true, visualization, question });
  };

  /**
   * Handle save visualization
   */
  const handleSave = async () => {
    if (!saveDialog.visualization) return;

    try {
      await saveVisualization(
        saveDialog.visualization,
        saveDialog.question,
        saveTitle,
        saveDescription
      );

      toast({
        title: "Saved!",
        description: "Visualization saved to your dashboard.",
      });

      setSaveDialog({ isOpen: false, visualization: null, question: "" });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to save visualization",
        variant: "destructive",
      });
    }
  };

  /**
   * Export visualization as PDF (optional override for quick export from bubble)
   */
  const handleDownloadPDF = async (override?: ExportOverride) => {
    const viz = override?.visualization ?? saveDialog.visualization;
    const title = override?.title ?? saveTitle;
    const desc = override?.description ?? saveDescription;
    if (!viz) return;

    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.width;

      doc.setFontSize(20);
      doc.setTextColor(30, 41, 59);
      doc.text(title || viz.title || "Visualization", 20, 25);

      const chartType = viz.type || "chart";
      doc.setFontSize(10);
      doc.setTextColor(100, 116, 139);
      doc.text(
        `Chart Type: ${chartType.charAt(0).toUpperCase() + chartType.slice(1)}`,
        20,
        35
      );

      let currentY = 45;
      if (desc) {
        doc.setFontSize(11);
        doc.setTextColor(71, 85, 105);
        const splitDescription = doc.splitTextToSize(desc, pageWidth - 40);
        doc.text(splitDescription, 20, currentY);
        currentY += splitDescription.length * 6 + 10;
      }

      const data = viz.data || [];
      if (data.length > 0 && Object.keys(data[0]).length > 0) {
        const columns = Object.keys(data[0]);
        const colCount = Math.min(columns.length, 5);

        // Guard against divide by zero
        if (colCount === 0) {
          doc.setFontSize(10);
          doc.text("No data columns available", 20, currentY);
        } else {
          const colWidth = (pageWidth - 40) / colCount;

          // Table header background
          doc.setFillColor(241, 245, 249); // slate-100
          doc.rect(20, currentY - 5, pageWidth - 40, 10, "F");

          // Headers
          doc.setFontSize(9);
          doc.setTextColor(30, 41, 59);
          doc.setFont(undefined as any, "bold");
          columns.slice(0, colCount).forEach((col, i) => {
            doc.text(col.substring(0, 18), 22 + i * colWidth, currentY);
          });
          currentY += 10;

          // Data rows
          doc.setFont(undefined as any, "normal");
          doc.setTextColor(51, 65, 85); // slate-700
          data.slice(0, 25).forEach((row) => {
            if (currentY > 270) {
              doc.addPage();
              currentY = 25;
            }
            columns.slice(0, colCount).forEach((col, i) => {
              const value = String(row[col] ?? "").substring(0, 18);
              doc.text(value, 22 + i * colWidth, currentY);
            });
            currentY += 7;
          });

          if (data.length > 25) {
            currentY += 5;
            doc.setFontSize(8);
            doc.setTextColor(148, 163, 184); // slate-400
            doc.text(`... and ${data.length - 25} more rows`, 20, currentY);
          }
        }
      } else {
        doc.setFontSize(10);
        doc.setTextColor(148, 163, 184);
        doc.text("No data available for this visualization", 20, currentY);
      }

      // Footer
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text(
        `Generated by Coheus on ${new Date().toLocaleDateString()}`,
        20,
        285
      );
      doc.text("coheus.ai", pageWidth - 35, 285);

      doc.save(
        `${(title || viz.title || "visualization").replace(
          /[^a-z0-9]/gi,
          "_"
        )}.pdf`
      );

      toast({
        title: "Downloaded!",
        description: "PDF report saved successfully.",
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
   * Export visualization to PowerPoint (optional override for quick export)
   */
  const handleAddToPowerPoint = async (override?: ExportOverride) => {
    const viz = override?.visualization ?? saveDialog.visualization;
    const title = override?.title ?? saveTitle;
    if (!viz) return;

    try {
      const pptxgen = (await import("pptxgenjs")).default;
      const pres = new pptxgen();
      pres.author = "Coheus";
      pres.title = title || "Visualization";

      const slide = pres.addSlide();
      slide.addText(title || viz.title || "Visualization", {
        x: 0.5,
        y: 0.3,
        w: 9,
        fontSize: 28,
        bold: true,
        color: "1e293b",
      });

      const chartType = viz.type || "chart";
      slide.addText(
        `Chart Type: ${chartType.charAt(0).toUpperCase() + chartType.slice(1)}`,
        {
          x: 0.5,
          y: 0.7,
          w: 9,
          fontSize: 12,
          color: "64748b",
        }
      );

      const desc = override?.description ?? saveDescription;
      let tableY = 1.3;
      if (desc) {
        slide.addText(desc, {
          x: 0.5,
          y: 1.0,
          w: 9,
          fontSize: 14,
          color: "475569",
        });
        tableY = 1.7;
      }

      const data = viz.data || [];
      if (data.length > 0 && Object.keys(data[0]).length > 0) {
        const columns = Object.keys(data[0]).slice(0, 5);

        // Guard against empty columns
        if (columns.length > 0) {
          const colWidth = 9 / columns.length;
          const rows = [
            columns.map((col) => ({
              text: col.substring(0, 20),
              options: {
                bold: true,
                fill: { color: "f1f5f9" },
                color: "1e293b",
              },
            })),
            ...data.slice(0, 12).map((row) =>
              columns.map((col) => ({
                text: String(row[col] ?? "").substring(0, 25),
                options: { color: "334155" },
              }))
            ),
          ];

          slide.addTable(rows as any, {
            x: 0.5,
            y: tableY,
            w: 9,
            colW: columns.map(() => colWidth),
            border: { pt: 0.5, color: "e2e8f0" },
            fontFace: "Arial",
            fontSize: 10,
          });

          if (data.length > 12) {
            slide.addText(`... and ${data.length - 12} more rows`, {
              x: 0.5,
              y: tableY + 2.8,
              fontSize: 9,
              color: "94a3b8",
              italic: true,
            });
          }
        }
      } else {
        slide.addText("No data available for this visualization", {
          x: 0.5,
          y: tableY,
          fontSize: 12,
          color: "94a3b8",
        });
      }

      // Footer
      slide.addText(
        `Generated by Coheus | ${new Date().toLocaleDateString()}`,
        {
          x: 0.5,
          y: 5.2,
          fontSize: 8,
          color: "94a3b8",
        }
      );

      await pres.writeFile({
        fileName: `${(title || viz.title || "visualization").replace(
          /[^a-z0-9]/gi,
          "_"
        )}.pptx`,
      });

      toast({
        title: "Downloaded!",
        description: "PowerPoint presentation saved.",
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
          title: `Loan: ${item?.loan_id ?? item?.id ?? "Details"}`,
        });
        setDrilldownOpen(true);
      }
    },
    [getDrilldownDisplayItem]
  );

  const handleCopyLink = async (override?: ExportOverride) => {
    const title = override?.title ?? saveTitle;
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
    const title = override?.title ?? saveTitle;
    const desc = override?.description ?? saveDescription;
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
      override?.title ?? saveTitle ?? override?.visualization?.title ?? "Chart";
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
      saveTitle ??
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
    const viz = override?.visualization ?? saveDialog.visualization;
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
    const viz = override?.visualization ?? saveDialog.visualization;
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

  if (!isOpen) {
    if (!onOpen) return null;

    return (
      <motion.button
        initial={{ x: 20, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 20, opacity: 0 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        onClick={onOpen}
        className="fixed right-0 top-1/2 -translate-y-1/2 z-50 flex flex-col items-center gap-2 px-2.5 py-4 rounded-l-xl shadow-[0_4px_24px_rgba(59,130,246,0.25)] dark:shadow-[0_4px_24px_rgba(99,102,241,0.2)] bg-gradient-to-b from-blue-600 to-indigo-600 text-white border border-l-0 border-white/10 hover:from-blue-500 hover:to-indigo-500 hover:shadow-[0_6px_28px_rgba(59,130,246,0.35)] transition-all duration-200 hover:pl-3 group"
        title="Cohi – Ask about your pipeline & performance"
        aria-label="Open Cohi Insights"
      >
        <Sparkles
          className="w-5 h-5 text-white drop-shadow-sm"
          strokeWidth={1.75}
        />
        <span
          className="text-xs font-semibold tracking-tight"
          style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}
        >
          Cohi
        </span>
      </motion.button>
    );
  }

  return (
    <>
      <div
        className="fixed inset-0 z-[90] bg-slate-900/10 dark:bg-slate-950/20"
        onClick={onClose}
        aria-hidden="true"
      />
      <motion.div
        initial={{ x: 500, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 500, opacity: 0 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className={cn(
          "fixed flex flex-col border-l border-slate-200/80 dark:border-slate-700/80 shadow-[0_0_60px_-12px_rgba(15,23,42,0.25)] dark:shadow-[0_0_60px_-12px_rgba(0,0,0,0.5)] bg-white/95 dark:bg-slate-900/95 backdrop-blur-2xl",
          isFullscreen || isMobile
            ? "left-0 right-0 top-0 bottom-0 z-[9999] w-full h-full"
            : "right-0 top-[70px] h-[calc(100%-70px)] z-[100]",
          !isFullscreen && (isExpanded ? "w-[480px]" : "w-[380px]"),
          className
        )}
      >
        {/* Header – clean, compact */}
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-slate-200/60 dark:border-slate-700/60 bg-gradient-to-r from-blue-600/95 to-indigo-600/95 backdrop-blur-md">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-semibold text-white tracking-tight truncate">
                Cohi Insights
              </h2>
              <p className="text-[10px] sm:text-xs text-white/80 truncate">
                Ask about your pipeline & performance
              </p>
            </div>
            <Badge
              variant="secondary"
              className="bg-white/25 text-white text-[10px] px-2 py-0 border-0 shrink-0"
            >
              AI
            </Badge>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Dashboard selector – adds to chat canvas */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-white/80 hover:text-white hover:bg-white/20 text-xs gap-1 max-w-[160px] truncate"
                  title="Add dashboard to chat canvas"
                >
                  <LayoutDashboard className="w-3.5 h-3.5" />
                  <span className="truncate">{lastDashboardLabel}</span>
                  <ChevronDown className="w-3 h-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="z-[10001] w-72">
                {CHAT_DASHBOARD_GROUPS.map((group, index) => (
                  <div key={group.label}>
                    <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-2 py-1.5">
                      {group.label}
                    </DropdownMenuLabel>
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      return (
                        <DropdownMenuItem
                          key={item.id}
                          onClick={() =>
                            addDashboardToCanvas(item.id, item.title)
                          }
                          className="gap-2 py-2"
                        >
                          <Icon
                            className={`w-4 h-4 ${
                              item.iconClass ?? "text-slate-500"
                            } shrink-0`}
                          />
                          <span className="truncate">{item.title}</span>
                        </DropdownMenuItem>
                      );
                    })}
                    {index < CHAT_DASHBOARD_GROUPS.length - 1 && (
                      <DropdownMenuSeparator />
                    )}
                  </div>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {/* Voice Toggle */}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-white/80 hover:text-white hover:bg-white/20"
              onClick={() => setVoiceEnabled(!voiceEnabled)}
              title={voiceEnabled ? "Disable voice" : "Enable voice"}
            >
              {voiceEnabled ? (
                <Volume2 className="w-4 h-4" />
              ) : (
                <VolumeX className="w-4 h-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-white/80 hover:text-white hover:bg-white/20"
              onClick={newSession}
              title="New conversation"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-white/80 hover:text-white hover:bg-white/20"
              onClick={() => clearMessages()}
              title="Clear chat"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
            {!isFullscreen && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-white/80 hover:text-white hover:bg-white/20"
                onClick={() => setIsExpanded(!isExpanded)}
                title={isExpanded ? "Minimize width" : "Expand width"}
              >
                {isExpanded ? (
                  <Minimize2 className="w-4 h-4" />
                ) : (
                  <Maximize2 className="w-4 h-4" />
                )}
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-white/80 hover:text-white hover:bg-white/20"
              onClick={() => setIsFullscreen(!isFullscreen)}
              title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            >
              {isFullscreen ? (
                <Shrink className="w-4 h-4" />
              ) : (
                <Expand className="w-4 h-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-white/90 hover:text-white hover:bg-white/25"
              onClick={onClose}
              title="Close"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1 p-4 sm:p-5">
          <div className="space-y-5">
            {/* Chat Canvas */}
            {chatCanvasItems.length > 0 && (
              <div className="rounded-2xl border border-slate-200/70 dark:border-slate-700/70 bg-white/90 dark:bg-slate-900/70 shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-3.5 py-2 border-b border-slate-200/70 dark:border-slate-700/70 bg-slate-50/70 dark:bg-slate-800/60">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                    <LayoutGrid className="w-4 h-4 text-slate-500" />
                    Chat Canvas
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                    onClick={() => setChatCanvasItems([])}
                  >
                    Clear
                  </Button>
                </div>
                <div
                  ref={chatCanvasRef}
                  className="relative p-2 min-h-[200px] sm:min-h-[260px] bg-white/70 dark:bg-slate-900/40 resize-y overflow-auto max-h-[70vh]"
                  style={{
                    minHeight: Math.max(
                      isMobile ? 200 : 260,
                      Math.max(...chatCanvasItems.map((i) => i.y + i.h)) + 80
                    ),
                  }}
                >
                  <style>{`
                    .cohi-chat-canvas .react-resizable-handle {
                      opacity: 0;
                      z-index: 20;
                      width: 12px;
                      height: 12px;
                      transition: opacity 0.2s ease;
                    }
                    .cohi-chat-canvas .canvas-item:hover .react-resizable-handle {
                      opacity: 1;
                    }
                    .cohi-chat-canvas .react-resizable-handle-se::after,
                    .cohi-chat-canvas .react-resizable-handle-sw::after,
                    .cohi-chat-canvas .react-resizable-handle-ne::after,
                    .cohi-chat-canvas .react-resizable-handle-nw::after {
                      right: 2px;
                      bottom: 2px;
                      width: 6px;
                      height: 6px;
                      border-right-width: 2px;
                      border-bottom-width: 2px;
                      border-color: rgba(100, 116, 139, 0.6);
                    }
                  `}</style>
                  <div
                    className="relative cohi-chat-canvas w-full"
                    style={{ minWidth: 260 }}
                  >
                    {chatCanvasItems.map((item, index) => {
                      const isDashboardSection =
                        item.type === "dashboard_section" &&
                        item.payload.type === "dashboard_section";
                      const payload = item.payload;
                      const hideableSections = isDashboardSection
                        ? CHAT_HIDEABLE_SECTIONS[
                            (payload as { sectionId: string }).sectionId
                          ] ?? []
                        : [];
                      const hiddenSections = isDashboardSection
                        ? (payload as { hiddenSections?: string[] })
                            .hiddenSections ?? []
                        : [];
                      const displayMode = isDashboardSection
                        ? (
                            payload as {
                              displayMode?: "full" | "compact" | "hidden";
                            }
                          ).displayMode ?? "full"
                        : undefined;
                      const onToggleSection = isDashboardSection
                        ? (sectionId: string, hidden: boolean) => {
                            const prev =
                              (payload as { hiddenSections?: string[] })
                                .hiddenSections ?? [];
                            const next = hidden
                              ? [...prev, sectionId]
                              : prev.filter((s) => s !== sectionId);
                            updateCanvasWidgetPayload(item.i, {
                              ...payload,
                              hiddenSections: next,
                            });
                          }
                        : undefined;

                      return (
                        <Rnd
                          key={item.i}
                          size={{ width: item.w, height: item.h }}
                          position={{ x: item.x, y: item.y }}
                          bounds="parent"
                          onDragStart={() => setSelectedCanvasId(item.i)}
                          onResizeStart={() => setSelectedCanvasId(item.i)}
                          onDrag={(_, data) =>
                            updateCanvasItemRect(item.i, {
                              x: data.x,
                              y: data.y,
                            })
                          }
                          onResize={(_, __, ref, ___, position) =>
                            updateCanvasItemRect(item.i, {
                              x: position.x,
                              y: position.y,
                              w: ref.offsetWidth,
                              h: ref.offsetHeight,
                            })
                          }
                          onDragStop={(_, data) =>
                            updateCanvasItemRect(item.i, {
                              x: data.x,
                              y: data.y,
                            })
                          }
                          onResizeStop={(_, __, ref, ___, position) =>
                            updateCanvasItemRect(item.i, {
                              x: position.x,
                              y: position.y,
                              w: ref.offsetWidth,
                              h: ref.offsetHeight,
                            })
                          }
                          enableResizing
                          cancel="button, a, input, textarea, select, option, [contenteditable], .canvas-interactive"
                          className="canvas-item"
                          style={{ zIndex: index + 1 }}
                        >
                          <CanvasWidgetCard
                            widgetId={item.i}
                            selected={selectedCanvasId === item.i}
                            onSelect={() => setSelectedCanvasId(item.i)}
                            onDuplicate={() => duplicateCanvasItem(item.i)}
                            onDelete={() => removeCanvasItem(item.i)}
                            className="overflow-hidden"
                            hideableSections={hideableSections}
                            hiddenSections={hiddenSections}
                            onToggleSection={onToggleSection}
                            displayMode={displayMode}
                            onChangeDisplayMode={
                              isDashboardSection
                                ? (mode) =>
                                    updateCanvasWidgetPayload(item.i, {
                                      ...payload,
                                      displayMode: mode,
                                    })
                                : undefined
                            }
                          >
                            <WidgetRenderer
                              item={item}
                              height={item.h}
                              width={item.w}
                              onUpdatePayload={
                                item.type === "text_block" ||
                                item.type === "rich_text"
                                  ? (p) => updateCanvasWidgetPayload(item.i, p)
                                  : undefined
                              }
                            />
                          </CanvasWidgetCard>
                        </Rnd>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

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
                  onSave={(viz, q) => handleOpenSaveDialog(viz, q)}
                  onSpeak={speakResponse}
                  onDrilldown={handleDrilldown}
                  isExpanded={isExpanded}
                  voiceEnabled={voiceEnabled}
                  vizTypeOverride={vizTypeOverrides[message.id]}
                  onDesignOptionClick={(id, type) =>
                    setVizTypeOverrides((prev) => ({ ...prev, [id]: type }))
                  }
                  onExportPDF={(viz) =>
                    handleDownloadPDF({ visualization: viz, title: viz.title })
                  }
                  onExportExcel={(viz) =>
                    handleExportExcel({ visualization: viz, title: viz.title })
                  }
                  onExportPPT={(viz) =>
                    handleAddToPowerPoint({
                      visualization: viz,
                      title: viz.title,
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
                  onPinToCanvas={(payload) =>
                    useCanvasPinStore.getState().addPinnedInsight(payload)
                  }
                  onAddToChatCanvas={(payload) =>
                    addVisualizationToCanvas(payload)
                  }
                />
              </motion.div>
            ))}

            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

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

      {/* Save Dialog */}
      <Dialog
        open={saveDialog.isOpen}
        onOpenChange={(open) =>
          !open &&
          setSaveDialog({ isOpen: false, visualization: null, question: "" })
        }
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Save & Share</DialogTitle>
            <DialogDescription>
              Save this visualization or share it with your team.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={saveTitle}
                onChange={(e) => setSaveTitle(e.target.value)}
                placeholder="My Visualization"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea
                id="description"
                value={saveDescription}
                onChange={(e) => setSaveDescription(e.target.value)}
                placeholder="What does this visualization show?"
                rows={2}
              />
            </div>

            {/* Export Options */}
            <div className="space-y-3 pt-2">
              <Label className="text-sm text-slate-500">Export Options</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  onClick={handleDownloadPDF}
                  className="flex items-center gap-2 h-11 justify-start"
                >
                  <Download className="w-4 h-4 text-red-500" />
                  <span className="text-sm">Download PDF</span>
                </Button>
                <Button
                  variant="outline"
                  onClick={handleAddToPowerPoint}
                  className="flex items-center gap-2 h-11 justify-start"
                >
                  <Presentation className="w-4 h-4 text-orange-500" />
                  <span className="text-sm">Add to PowerPoint</span>
                </Button>
              </div>
            </div>

            {/* Share Options */}
            <div className="space-y-3 pt-2">
              <Label className="text-sm text-slate-500">Share</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  onClick={handleCopyLink}
                  className="flex items-center gap-2 h-11 justify-start"
                >
                  {linkCopied ? (
                    <Check className="w-4 h-4 text-green-500" />
                  ) : (
                    <Link className="w-4 h-4 text-blue-500" />
                  )}
                  <span className="text-sm">
                    {linkCopied ? "Copied!" : "Copy Link"}
                  </span>
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    handleEmailWithLink({
                      visualization: saveDialog.visualization!,
                      title: saveTitle,
                    })
                  }
                  className="flex items-center gap-2 h-11 justify-start"
                >
                  <Mail className="w-4 h-4 text-purple-500" />
                  <span className="text-sm">Email (link to chart)</span>
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() =>
                setSaveDialog({
                  isOpen: false,
                  visualization: null,
                  question: "",
                })
              }
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={!saveTitle.trim()}
              className="bg-blue-600 hover:bg-blue-700"
            >
              <Save className="w-4 h-4 mr-2" />
              Save to Dashboard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
  onSave: (visualization: VisualizationConfig, question: string) => void;
  onSpeak: (text: string) => void;
  onDrilldown: (item: any, level: string) => void;
  isExpanded: boolean;
  voiceEnabled: boolean;
  vizTypeOverride?: VisualizationConfig["type"];
  onDesignOptionClick?: (
    messageId: string,
    type: VisualizationConfig["type"]
  ) => void;
  onExportPDF?: (viz: VisualizationConfig) => void;
  onExportExcel?: (viz: VisualizationConfig) => void;
  onExportPPT?: (viz: VisualizationConfig) => void;
  onExportImage?: (viz: VisualizationConfig, messageId?: string) => void;
  onCopyLink?: (viz: VisualizationConfig) => void;
  onEmailWithScreenshot?: (viz: VisualizationConfig, messageId: string) => void;
  onEmailWithLink?: (viz: VisualizationConfig) => void;
  onPinToCanvas?: (payload: {
    title: string;
    content: string;
    visualization?: VisualizationConfig;
  }) => void;
  onAddToChatCanvas?: (payload: {
    title: string;
    content: string;
    visualization?: VisualizationConfig;
  }) => void;
}

const EnhancedChatMessageBubble: React.FC<EnhancedChatMessageBubbleProps> = ({
  message,
  onSave,
  onSpeak,
  onDrilldown,
  isExpanded,
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
  onPinToCanvas,
  onAddToChatCanvas,
}) => {
  const isUser = message.role === "user";
  const styling = !isUser ? getMessageStyling(message.content) : null;

  // Don't parse content - render as markdown to preserve structure
  const messageContent = message.content;

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[95%] rounded-2xl",
          isUser
            ? "bg-gradient-to-br from-blue-500 to-indigo-600 text-white px-4 py-2.5 shadow-sm"
            : "border border-slate-200/80 dark:border-slate-700/80 bg-slate-50/80 dark:bg-slate-800/60 shadow-sm overflow-hidden"
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
                  "text-sm whitespace-pre-wrap leading-relaxed text-slate-800 dark:text-slate-200",
                  isUser ? "" : "px-4 pt-3 pb-3"
                )}
              >
                {renderMarkdownText(messageContent)}
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
                    id={`cohi-viz-${message.id}`}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                    className="mt-0 mx-0 mb-0 max-w-full min-w-0 border-t border-slate-200/60 dark:border-slate-700/60"
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
                        insights: generateCohiInsights(vizConfig),
                      }}
                      height={isExpanded ? 300 : 220}
                      showInsights={true}
                      onDrilldown={onDrilldown}
                    />

                    {/* Design options – click to change chart type */}
                    <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-t border-slate-200/50 dark:border-slate-700/50 bg-slate-50/80 dark:bg-slate-800/40">
                      <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mr-1">
                        Design:
                      </span>
                      {VIZ_DESIGN_OPTIONS.map(({ type, label, Icon }) => (
                        <Button
                          key={type}
                          variant="ghost"
                          size="sm"
                          className={cn(
                            "h-7 px-2 text-xs rounded-lg",
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

                    <div className="flex flex-wrap justify-between items-center gap-2 px-4 py-3 bg-slate-100/60 dark:bg-slate-800/30">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                          {effectiveType}
                        </span>
                        <span className="text-[10px] text-blue-600 dark:text-blue-400 font-medium">
                          AI
                        </span>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs h-8 rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                          >
                            <Save className="w-3 h-3 mr-1.5" />
                            Save & export
                            <ChevronDown className="w-3 h-3 ml-1" />
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
                            onClick={() => onSave(vizConfig, message.content)}
                            className="gap-2 py-2"
                          >
                            <Save className="w-4 h-4 text-slate-500 shrink-0" />
                            <span>Save to Dashboard</span>
                          </DropdownMenuItem>
                          {onAddToChatCanvas && (
                            <DropdownMenuItem
                              onClick={() =>
                                onAddToChatCanvas({
                                  title: vizConfig.title ?? "Insight",
                                  content: message.content,
                                  visualization: vizConfig,
                                })
                              }
                              className="gap-2 py-2"
                            >
                              <LayoutGrid className="w-4 h-4 text-indigo-500 shrink-0" />
                              <span>Add to chat canvas</span>
                            </DropdownMenuItem>
                          )}
                          {onPinToCanvas && (
                            <DropdownMenuItem
                              onClick={() =>
                                onPinToCanvas({
                                  title: vizConfig.title ?? "Insight",
                                  content: message.content,
                                  visualization: vizConfig,
                                })
                              }
                              className="gap-2 py-2"
                            >
                              <Pin className="w-4 h-4 text-amber-500 shrink-0" />
                              <span>Pin to canvas</span>
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-2 py-1.5">
                            Export
                          </DropdownMenuLabel>
                          <DropdownMenuItem
                            onClick={() => onExportPDF?.(vizConfig)}
                            className="gap-2 py-2"
                          >
                            <FileText className="w-4 h-4 text-red-500 shrink-0" />
                            <span>Download PDF</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => onExportExcel?.(vizConfig)}
                            className="gap-2 py-2"
                          >
                            <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
                            <span>Export Excel (CSV)</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => onExportPPT?.(vizConfig)}
                            className="gap-2 py-2"
                          >
                            <Presentation className="w-4 h-4 text-orange-500 shrink-0" />
                            <span>Add to PowerPoint</span>
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
                  </motion.div>
                );
              })()}
            {/* COHI response plan – structured insights and charts from /api/cohi/query */}
            {message.responsePlan && !message.error && (
              <motion.div
                id={`cohi-insight-${message.id}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className="mt-0 mx-0 mb-0 max-w-full min-w-0 border-t border-slate-200/60 dark:border-slate-700/60"
              >
                <CohiInsightPanel
                  responsePlan={message.responsePlan}
                  dataPayloads={message.dataPayloads ?? {}}
                  className="px-4 py-3"
                />
              </motion.div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default DataChatPanel;
