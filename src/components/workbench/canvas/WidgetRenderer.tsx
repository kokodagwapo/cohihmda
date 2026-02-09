/**
 * Renders a single canvas widget by type (chart, kpi, table, dashboard_section, etc.)
 * Dashboard sections render directly in a floating card with pixel sizing.
 */

import React, { useMemo, useRef, useState, useEffect } from "react";
import { EnhancedVisualization } from "@/components/visualizations/EnhancedVisualization";
import { LeaderBoardSection } from "@/components/dashboard/LeaderBoardSection";
import { ExecutiveDashboard } from "@/components/dashboard/ExecutiveDashboard";
import { ClosingFalloutForecast } from "@/components/dashboard/ClosingFalloutForecast";
import { LoanFunnelView } from "@/components/views/LoanFunnelView";
import { TopTieringComparisonView } from "@/components/views/TopTieringComparisonView";
import { OperationsScorecardView } from "@/components/views/OperationsScorecardView";
import { OperationScorecardTrendsView } from "@/components/views/OperationScorecardTrendsView";
import { FinancialModelingSandboxView } from "@/components/views/FinancialModelingSandboxView";
import { AletheiaPromptsCard } from "@/components/dashboard/AletheiaPromptsCard";
import { IndustryNewsCard } from "@/components/dashboard/IndustryNewsCard";
import { useTenantStore } from "@/stores/tenantStore";
import { useChannelStore } from "@/stores/channelStore";
import { useWidgetSectionStore } from "@/stores/widgetSectionStore";
import { getWidgetDefinition } from "@/components/widgets/registry";
import { useWidgetData } from "@/components/widgets/data";
import { SectionHeader } from "@/components/widgets/components/SectionHeader";
import { WidgetGroup } from "@/components/widgets/components/WidgetGroup";
import { CohiWidgetRenderer } from "./CohiWidgetRenderer";
import type { CanvasLayoutItem, CanvasWidgetPayload, GroupWidgetItem } from "./types";
import {
  LayoutGrid,
  Lightbulb,
  Newspaper,
  StickyNote,
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  Image as ImageIcon,
  Table as TableIcon,
  GripVertical,
  BarChart3,
  Activity,
  PieChart as PieChartIcon,
} from "lucide-react";

interface WidgetRendererProps {
  item: CanvasLayoutItem;
  height?: number;
  width?: number;
  /** Called when a widget updates its payload (e.g. text block content). Omit to make widget read-only. */
  onUpdatePayload?: (payload: CanvasWidgetPayload) => void;
  /** Other widget groups on the canvas (for moving items between groups) */
  otherGroups?: { id: string; title: string }[];
  /** Called when an item inside a widget_group is moved out to another group */
  onMoveItemOut?: (item: GroupWidgetItem, targetGroupId: string) => void;
}

const CHART_TYPE_OPTIONS: {
  type: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}[] = [
  { type: 'bar', label: 'Bar', Icon: BarChart3 },
  { type: 'line', label: 'Line', Icon: Activity },
  { type: 'pie', label: 'Pie', Icon: PieChartIcon },
  { type: 'area', label: 'Area', Icon: BarChart3 },
  { type: 'donut', label: 'Donut', Icon: PieChartIcon },
  { type: 'horizontal_bar', label: 'H-Bar', Icon: BarChart3 },
  { type: 'table', label: 'Table', Icon: LayoutGrid },
];

function ChartWidget({
  payload,
}: {
  payload: Extract<CanvasWidgetPayload, { type: "chart" }>;
}) {
  const [chartType, setChartType] = useState<string | null>(null);

  if (payload.type !== "chart" || !payload.config) return null;
  const config = payload.config as any;
  const effectiveConfig = chartType ? { ...config, type: chartType } : config;

  return (
    <div className="h-full w-full flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0 p-2 overflow-auto">
        <EnhancedVisualization
          config={{
            ...effectiveConfig,
            animated: true,
            drilldownEnabled: false,
          }}
          height={200}
          showInsights={false}
        />
      </div>
      <div className="flex flex-wrap items-center gap-1 px-2 py-1.5 border-t border-slate-200/50 dark:border-slate-700/50 bg-slate-50/80 dark:bg-slate-800/40 shrink-0">
        <span className="text-[9px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider mr-0.5">
          Type:
        </span>
        {CHART_TYPE_OPTIONS.map(({ type, label, Icon }) => (
          <button
            key={type}
            className={`h-6 px-1.5 text-[10px] rounded-md canvas-interactive inline-flex items-center ${
              (chartType ?? config.type) === type
                ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-medium'
                : 'text-slate-500 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-700/60'
            }`}
            onClick={() => setChartType(type)}
          >
            <Icon className="w-3 h-3 mr-0.5" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function KpiWidget({
  payload,
}: {
  payload: Extract<CanvasWidgetPayload, { type: "kpi" }>;
}) {
  if (payload.type !== "kpi") return null;
  const formatted =
    payload.format === "currency"
      ? typeof payload.value === "number"
        ? new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
            maximumFractionDigits: 0,
          }).format(payload.value)
        : String(payload.value)
      : payload.format === "percent"
      ? `${Number(payload.value)}%`
      : String(payload.value);
  return (
    <div className="h-full w-full p-4 flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200/70 dark:border-slate-700/70">
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
        {payload.label}
      </p>
      <p className="text-xl font-semibold text-slate-900 dark:text-white mt-1">
        {formatted}
      </p>
    </div>
  );
}

function TableWidget({
  payload,
}: {
  payload: Extract<CanvasWidgetPayload, { type: "table" }>;
}) {
  if (payload.type !== "table" || !payload.data?.length) return null;
  const columns = payload.columns || Object.keys(payload.data[0] || {});
  return (
    <div className="h-full w-full overflow-auto p-2">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 dark:border-slate-700">
            {columns.map((col) => (
              <th
                key={col.key || col}
                className="text-left py-2 px-2 font-medium text-slate-600 dark:text-slate-400"
              >
                {typeof col === "object" ? col.label : col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {payload.data.slice(0, 10).map((row, idx) => (
            <tr
              key={idx}
              className="border-b border-slate-100 dark:border-slate-800"
            >
              {columns.map((col) => {
                const key = typeof col === "object" ? col.key : col;
                return (
                  <td
                    key={key}
                    className="py-1.5 px-2 text-slate-800 dark:text-slate-200"
                  >
                    {String(row[key] ?? "")}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const currentYear = new Date().getFullYear();

const DASHBOARD_REF_WIDTH = 1200;
const DASHBOARD_REF_HEIGHT = 900;

function ScaleToFit({
  refWidth,
  refHeight,
  width,
  height,
  maxScale = 1,
  children,
}: {
  refWidth: number;
  refHeight: number;
  width?: number;
  height?: number;
  maxScale?: number;
  children: React.ReactNode;
}) {
  const scale = useMemo(() => {
    if (!width || !height) return 1;
    const s = Math.min(width / refWidth, height / refHeight, maxScale);
    return Number.isFinite(s) && s > 0 ? s : 1;
  }, [width, height, refWidth, refHeight, maxScale]);

  return (
    <div
      className="w-full h-full overflow-hidden flex items-start justify-start"
      style={{ minHeight: 0 }}
    >
      <div
        style={{
          width: refWidth,
          height: refHeight,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function DashboardSectionEmbed({
  payload,
  height,
  width: refWidth,
}: {
  payload: Extract<CanvasWidgetPayload, { type: "dashboard_section" }>;
  height?: number;
  width?: number;
}) {
  // Use global tenant and channel stores for data fetching
  const { selectedTenantId } = useTenantStore();
  const { selectedChannel } = useChannelStore();

  if (payload.type !== "dashboard_section") return null;

  const fixedSize = refWidth != null && height != null;
  const scrollStyle = fixedSize
    ? { width: refWidth, height, minHeight: height, maxHeight: height }
    : { minHeight: height ?? 200, maxHeight: height ?? "100%" };

  switch (payload.sectionId) {
    case "leaderboard":
      return (
        <div
          className="h-full w-full overflow-auto rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200/70 dark:border-slate-700/70"
          style={scrollStyle}
        >
          <LeaderBoardSection
            dateFilter="mtd"
            selectedTenantId={selectedTenantId}
            hideAvatar
          />
        </div>
      );
    case "executiveDashboard":
      return (
        <div
          className="h-full w-full overflow-auto rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200/70 dark:border-slate-700/70"
          style={scrollStyle}
        >
          <ExecutiveDashboard
            dateFilter="mtd"
            year={currentYear}
            selectedTenantId={selectedTenantId}
          />
        </div>
      );
    case "closingFalloutForecast":
      return (
        <div
          className="h-full w-full overflow-auto rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200/70 dark:border-slate-700/70"
          style={scrollStyle}
        >
          <ClosingFalloutForecast dateFilter="mtd" />
        </div>
      );
    case "topTiering":
    case "loanFunnel": {
      return (
        <LoanFunnelViewEmbed
          height={height}
          width={refWidth}
          hiddenSections={payload.hiddenSections}
        />
      );
    }
    case "topTieringComparison":
      return (
        <div
          className="h-full w-full overflow-auto rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200/70 dark:border-slate-700/70"
          style={scrollStyle}
        >
          <TopTieringComparisonView
            selectedTenantId={selectedTenantId}
            selectedChannel={selectedChannel}
          />
        </div>
      );
    case "operationsScorecard":
      return (
        <div
          className="h-full w-full overflow-auto rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200/70 dark:border-slate-700/70"
          style={scrollStyle}
        >
          <OperationsScorecardView
            selectedTenantId={selectedTenantId}
            selectedChannel={selectedChannel}
          />
        </div>
      );
    case "operationsTrends":
      return (
        <div
          className="h-full w-full overflow-auto rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200/70 dark:border-slate-700/70"
          style={scrollStyle}
        >
          <OperationScorecardTrendsView
            selectedTenantId={selectedTenantId}
            selectedChannel={selectedChannel}
          />
        </div>
      );
    case "financialModeling":
      return (
        <div
          className="h-full w-full overflow-auto rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200/70 dark:border-slate-700/70"
          style={scrollStyle}
        >
          <FinancialModelingSandboxView />
        </div>
      );
    case "creditRiskManagement":
    case "companyScorecard":
    case "salesScorecard":
    case "salesTrends":
      // These sections are now decomposed into individual registry widgets.
      // If a legacy saved canvas still has this type, show a migration hint.
      return (
        <div className="h-full w-full p-4 flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-dashed border-slate-300 dark:border-slate-600">
          <LayoutGrid className="w-8 h-8 text-slate-400 dark:text-slate-500 mb-2" />
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
            {payload.title || payload.sectionId}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 text-center max-w-[260px]">
            This section now uses individual widgets. Remove this block and re-add from the Add menu to get drag-and-drop KPIs and charts.
          </p>
        </div>
      );
    case "aletheiaInsights":
      return (
        <div
          className="h-full w-full overflow-auto rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200/70 dark:border-slate-700/70"
          style={scrollStyle}
        >
          <AletheiaPromptsCard
            dateFilter="mtd"
            selectedTenantId={selectedTenantId}
            selectedChannel={selectedChannel}
          />
        </div>
      );
    case "industryNews":
      return (
        <div
          className="h-full w-full overflow-auto rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200/70 dark:border-slate-700/70"
          style={scrollStyle}
        >
          <IndustryNewsCard />
        </div>
      );
    default:
      return (
        <div className="h-full w-full p-4 flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-dashed border-slate-300 dark:border-slate-600">
          <LayoutGrid className="w-8 h-8 text-slate-400 dark:text-slate-500 mb-2" />
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
            {payload.title}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {payload.sectionId}
          </p>
        </div>
      );
  }
}

function LoanFunnelViewEmbed({
  height,
  width,
  hiddenSections,
}: {
  height?: number;
  width?: number;
  hiddenSections?: string[];
}) {
  const [view, setView] = useState<
    "funnel" | "bar" | "revenue" | "units" | "volume" | "detail"
  >("funnel");
  const [year, setYear] = useState(currentYear);
  const { selectedTenantId } = useTenantStore();
  const { selectedChannel } = useChannelStore();
  const scrollStyle =
    width != null && height != null
      ? { width, height, minHeight: height, maxHeight: height }
      : { minHeight: height ?? 200, maxHeight: height ?? "100%" };
  return (
    <div
      className="h-full w-full overflow-auto rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200/70 dark:border-slate-700/70"
      style={scrollStyle}
    >
      <LoanFunnelView
        view={view}
        onViewChange={setView}
        year={year}
        onYearChange={setYear}
        selectedTenantId={selectedTenantId}
        selectedChannel={selectedChannel}
        hiddenSections={hiddenSections}
      />
    </div>
  );
}

function PinnedInsightWidget({
  payload,
}: {
  payload: Extract<CanvasWidgetPayload, { type: "pinned_insight" }>;
}) {
  if (payload.type !== "pinned_insight") return null;
  const hasViz =
    payload.visualization && payload.visualization.data?.length > 0;
  return (
    <div className="h-full w-full p-3 overflow-auto rounded-xl border border-slate-200/70 dark:border-slate-700/70 bg-white/80 dark:bg-slate-800/50 flex flex-col">
      <div className="flex items-center gap-2 mb-2 shrink-0">
        <Lightbulb className="w-4 h-4 text-amber-500 shrink-0" />
        <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
          {payload.title}
        </p>
      </div>
      {hasViz ? (
        <>
          <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2 mb-2 shrink-0">
            {payload.content}
          </p>
          <div className="flex-1 min-h-0">
            <EnhancedVisualization
              config={{
                ...payload.visualization!,
                animated: true,
                drilldownEnabled: false,
              }}
              height={120}
              showInsights={false}
            />
          </div>
        </>
      ) : (
        <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-4">
          {payload.content}
        </p>
      )}
    </div>
  );
}

function NewsCardWidget({
  payload,
}: {
  payload: Extract<CanvasWidgetPayload, { type: "news_card" }>;
}) {
  if (payload.type !== "news_card") return null;
  return (
    <div className="h-full w-full p-3 overflow-auto rounded-xl border border-slate-200/70 dark:border-slate-700/70 bg-white/80 dark:bg-slate-800/50">
      <div className="flex items-center gap-2 mb-2">
        <Newspaper className="w-4 h-4 text-blue-500 shrink-0" />
        <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
          {payload.title}
        </p>
      </div>
      <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-4">
        {payload.summary}
      </p>
      {payload.link && (
        <a
          href={payload.link}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-600 dark:text-blue-400 mt-2 inline-block"
        >
          Read more
        </a>
      )}
    </div>
  );
}

function TextBlockWidget({
  payload,
  onUpdate,
}: {
  payload: Extract<CanvasWidgetPayload, { type: "text_block" }>;
  onUpdate?: (
    payload: Extract<CanvasWidgetPayload, { type: "text_block" }>
  ) => void;
}) {
  if (payload.type !== "text_block") return null;
  const editable = typeof onUpdate === "function";
  return (
    <div className="h-full w-full p-3 overflow-auto rounded-xl border border-amber-200/80 dark:border-amber-700/60 bg-amber-50/80 dark:bg-amber-950/40 flex flex-col">
      <div className="flex items-center gap-2 mb-2 shrink-0">
        <StickyNote className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
        {editable ? (
          <input
            className="flex-1 min-w-0 text-sm font-semibold text-slate-900 dark:text-white bg-transparent border-0 border-b border-transparent focus:border-amber-400 focus:outline-none px-0"
            value={payload.title ?? ""}
            onChange={(e) => onUpdate?.({ ...payload, title: e.target.value })}
            onBlur={() => {}}
            placeholder="Title (optional)"
          />
        ) : (
          payload.title && (
            <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
              {payload.title}
            </p>
          )
        )}
      </div>
      {editable ? (
        <textarea
          className="flex-1 min-h-0 w-full text-sm text-slate-700 dark:text-slate-300 bg-transparent border-0 resize-none focus:outline-none focus:ring-0 p-0"
          value={payload.content}
          onChange={(e) => onUpdate?.({ ...payload, content: e.target.value })}
          onBlur={() => {}}
          placeholder="Write your note…"
        />
      ) : (
        <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap flex-1 min-h-0 overflow-auto">
          {payload.content || "Empty note"}
        </p>
      )}
    </div>
  );
}

function RichTextWidget({
  payload,
  onUpdate,
}: {
  payload: Extract<CanvasWidgetPayload, { type: "rich_text" }>;
  onUpdate?: (
    payload: Extract<CanvasWidgetPayload, { type: "rich_text" }>
  ) => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fontFamily, setFontFamily] = useState("Inter");
  const [fontSize, setFontSize] = useState("16");

  useEffect(() => {
    if (contentRef.current && contentRef.current.innerHTML !== payload.html) {
      contentRef.current.innerHTML = payload.html || "<p></p>";
    }
  }, [payload.html]);

  const syncHtml = () => {
    if (!contentRef.current) return;
    const next = contentRef.current.innerHTML;
    if (next !== payload.html) {
      onUpdate?.({ ...payload, html: next });
    }
  };

  const applyCommand = (command: string, value?: string) => {
    if (!contentRef.current) return;
    contentRef.current.focus();
    document.execCommand(command, false, value);
    syncHtml();
  };

  const handleFontChange = (value: string) => {
    setFontFamily(value);
    applyCommand("fontName", value);
  };

  const handleFontSizeChange = (value: string) => {
    setFontSize(value);
    const sizeMap: Record<string, string> = {
      "12": "2",
      "14": "2",
      "16": "3",
      "18": "4",
      "20": "4",
      "24": "5",
      "28": "6",
      "32": "7",
    };
    applyCommand("fontSize", sizeMap[value] ?? "3");
  };

  const insertTable = () => {
    const tableHtml = `
      <table style="width:100%; border-collapse:collapse; margin:8px 0;">
        <tbody>
          <tr>
            <td style="border:1px solid #e2e8f0; padding:6px; min-width:60px;">&nbsp;</td>
            <td style="border:1px solid #e2e8f0; padding:6px; min-width:60px;">&nbsp;</td>
          </tr>
          <tr>
            <td style="border:1px solid #e2e8f0; padding:6px; min-width:60px;">&nbsp;</td>
            <td style="border:1px solid #e2e8f0; padding:6px; min-width:60px;">&nbsp;</td>
          </tr>
        </tbody>
      </table>
    `;
    applyCommand("insertHTML", tableHtml);
  };

  const handleImageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      applyCommand("insertImage", String(reader.result || ""));
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      applyCommand("insertImage", String(reader.result || ""));
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="h-full w-full flex flex-col rounded-xl border border-slate-200/70 dark:border-slate-700/70 bg-white/90 dark:bg-slate-900/70 overflow-hidden">
      <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5 border-b border-slate-200/70 dark:border-slate-700/70 bg-slate-50/80 dark:bg-slate-800/60">
        <div className="canvas-drag-handle h-7 w-6 flex items-center justify-center text-slate-400 dark:text-slate-500 cursor-grab active:cursor-grabbing">
          <GripVertical className="h-4 w-4" />
        </div>
        <select
          value={fontFamily}
          onChange={(e) => handleFontChange(e.target.value)}
          className="h-7 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 text-xs text-slate-700 dark:text-slate-200 canvas-interactive"
        >
          <option value="Inter">Inter</option>
          <option value="Arial">Arial</option>
          <option value="Georgia">Georgia</option>
          <option value="Times New Roman">Times New Roman</option>
          <option value="Courier New">Courier New</option>
        </select>
        <select
          value={fontSize}
          onChange={(e) => handleFontSizeChange(e.target.value)}
          className="h-7 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 text-xs text-slate-700 dark:text-slate-200 canvas-interactive"
        >
          {["12", "14", "16", "18", "20", "24", "28", "32"].map((size) => (
            <option key={size} value={size}>
              {size}px
            </option>
          ))}
        </select>
        <div className="w-px h-5 bg-slate-200 dark:bg-slate-700 mx-1" />
        <button
          type="button"
          onClick={() => applyCommand("bold")}
          className="h-7 w-7 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 canvas-interactive"
        >
          <Bold className="h-4 w-4 mx-auto" />
        </button>
        <button
          type="button"
          onClick={() => applyCommand("italic")}
          className="h-7 w-7 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 canvas-interactive"
        >
          <Italic className="h-4 w-4 mx-auto" />
        </button>
        <button
          type="button"
          onClick={() => applyCommand("underline")}
          className="h-7 w-7 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 canvas-interactive"
        >
          <Underline className="h-4 w-4 mx-auto" />
        </button>
        <div className="w-px h-5 bg-slate-200 dark:bg-slate-700 mx-1" />
        <button
          type="button"
          onClick={() => applyCommand("insertUnorderedList")}
          className="h-7 w-7 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 canvas-interactive"
        >
          <List className="h-4 w-4 mx-auto" />
        </button>
        <button
          type="button"
          onClick={() => applyCommand("insertOrderedList")}
          className="h-7 w-7 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 canvas-interactive"
        >
          <ListOrdered className="h-4 w-4 mx-auto" />
        </button>
        <div className="w-px h-5 bg-slate-200 dark:bg-slate-700 mx-1" />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleImageFile}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="h-7 w-7 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 canvas-interactive"
        >
          <ImageIcon className="h-4 w-4 mx-auto" />
        </button>
        <button
          type="button"
          onClick={insertTable}
          className="h-7 w-7 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 canvas-interactive"
        >
          <TableIcon className="h-4 w-4 mx-auto" />
        </button>
      </div>
      <div
        ref={contentRef}
        contentEditable
        suppressContentEditableWarning
        onInput={syncHtml}
        onBlur={syncHtml}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        className="flex-1 min-h-0 overflow-auto px-3 py-2 text-sm text-slate-800 dark:text-slate-100 canvas-interactive"
        style={{ fontFamily: "Inter" }}
      />
    </div>
  );
}

// Section-type to accent color for the left border on grouped widgets
const SECTION_ACCENT: Record<string, string> = {
  'company-scorecard': 'border-l-indigo-500',
  'credit-risk': 'border-l-emerald-500',
  'sales-scorecard': 'border-l-violet-500',
};

/** Renders a registry-based widget using the widget architecture.
 *  Data is provided by the WidgetDataProvider context wrapping the canvas. */
function RegistryWidgetEmbed({
  payload,
  width,
  height,
}: {
  payload: Extract<CanvasWidgetPayload, { type: "registry_widget" }>;
  width?: number;
  height?: number;
}) {
  const definition = getWidgetDefinition(payload.definitionId);

  // Determine accent class for section grouping
  const sectionType = payload.sectionId
    ? useWidgetSectionStore.getState().sections[payload.sectionId]?.sectionType
    : undefined;
  const accentClass = sectionType ? SECTION_ACCENT[sectionType] ?? '' : '';

  if (!definition) {
    return (
      <div className="h-full w-full flex items-center justify-center text-sm text-slate-400 dark:text-slate-500 p-4">
        Widget not found: {payload.definitionId}
      </div>
    );
  }

  // Read data from the shared WidgetDataProvider context, scoped to this section
  const { data: selectedData, loading, error } = useWidgetData(
    definition.dataSource,
    definition.dataSelector,
    payload.sectionId,
  );

  const Component = definition.component;

  return (
    <div className={accentClass ? `h-full w-full border-l-[3px] ${accentClass} rounded-l-sm` : 'h-full w-full'}>
      <Component
        data={selectedData}
        loading={loading}
        error={error}
        width={width ?? definition.defaultSize.w}
        height={height ?? definition.defaultSize.h}
        config={payload.config}
      />
    </div>
  );
}

/**
 * Wrapper that reads selectedTenantId from the store so CohiWidgetRenderer
 * can pass it as a query parameter to the data-fetch endpoint.
 */
function CohiWidgetRendererWithTenant({
  payload,
  style,
  width,
  height,
}: {
  payload: Extract<CanvasWidgetPayload, { type: 'cohi_widget' }>;
  style: React.CSSProperties;
  width?: number;
  height?: number;
}) {
  const { selectedTenantId } = useTenantStore();
  return (
    <div style={style} className="h-full w-full">
      <CohiWidgetRenderer
        sql={payload.sql}
        vizConfig={payload.vizConfig}
        title={payload.title}
        explanation={payload.explanation}
        tenantId={selectedTenantId}
        width={width}
        height={height}
      />
    </div>
  );
}

export function WidgetRenderer({
  item,
  height = 200,
  width,
  onUpdatePayload,
  otherGroups,
  onMoveItemOut,
}: WidgetRendererProps) {
  const { type, payload } = item;
  const style = { minHeight: height };
  if (type === "chart" && payload.type === "chart")
    return (
      <div style={style}>
        <ChartWidget payload={payload} />
      </div>
    );
  if (type === "kpi" && payload.type === "kpi")
    return (
      <div style={style}>
        <KpiWidget payload={payload} />
      </div>
    );
  if (type === "table" && payload.type === "table")
    return (
      <div style={style}>
        <TableWidget payload={payload} />
      </div>
    );
  if (type === "dashboard_section" && payload.type === "dashboard_section")
    return (
      <div
        style={{ ...style, width: "100%", height: "100%" }}
        className="w-full h-full min-h-0 flex flex-col"
      >
        {payload.displayMode === "hidden" ? (
          <div className="h-full w-full flex items-center justify-center text-sm text-slate-500 dark:text-slate-400">
            {payload.title} (hidden)
          </div>
        ) : (
          <ScaleToFit
            refWidth={DASHBOARD_REF_WIDTH}
            refHeight={DASHBOARD_REF_HEIGHT}
            width={width}
            height={height}
            maxScale={payload.displayMode === "compact" ? 0.85 : 1}
          >
            <DashboardSectionEmbed
              payload={payload}
              height={DASHBOARD_REF_HEIGHT}
              width={DASHBOARD_REF_WIDTH}
            />
          </ScaleToFit>
        )}
      </div>
    );
  if (type === "pinned_insight" && payload.type === "pinned_insight")
    return (
      <div style={style}>
        <PinnedInsightWidget payload={payload} />
      </div>
    );
  if (type === "news_card" && payload.type === "news_card")
    return (
      <div style={style}>
        <NewsCardWidget payload={payload} />
      </div>
    );
  if (type === "text_block" && payload.type === "text_block")
    return (
      <div style={style}>
        <TextBlockWidget
          payload={payload}
          onUpdate={
            onUpdatePayload as (
              p: Extract<CanvasWidgetPayload, { type: "text_block" }>
            ) => void
          }
        />
      </div>
    );
  if (type === "rich_text" && payload.type === "rich_text")
    return (
      <div style={style}>
        <RichTextWidget
          payload={payload}
          onUpdate={
            onUpdatePayload as (
              p: Extract<CanvasWidgetPayload, { type: "rich_text" }>
            ) => void
          }
        />
      </div>
    );
  if (type === "registry_widget" && payload.type === "registry_widget") {
    return (
      <div style={{ ...style, width: "100%", height: "100%" }} className="w-full h-full min-h-0">
        <RegistryWidgetEmbed payload={payload} width={width} height={height} />
      </div>
    );
  }
  if (type === "section_header" && payload.type === "section_header") {
    return (
      <div style={{ ...style, width: "100%", height: "100%" }} className="w-full h-full min-h-0">
        <SectionHeader
          sectionId={payload.sectionId}
          title={payload.title}
          sectionType={payload.sectionType}
        />
      </div>
    );
  }
  if (type === "widget_group" && payload.type === "widget_group") {
    return (
      <div style={{ ...style, width: "100%", height: "100%" }} className="w-full h-full min-h-0">
        <WidgetGroup
          groupId={payload.groupId}
          title={payload.title}
          sectionType={payload.sectionType}
          widgetIds={payload.widgetIds}
          items={payload.items}
          widgetLayouts={payload.widgetLayouts}
          layoutVersion={payload.layoutVersion}
          collapsed={payload.collapsed}
          width={width ?? 800}
          height={height}
          onUpdatePayload={
            onUpdatePayload
              ? (patch) => onUpdatePayload({ ...payload, ...patch })
              : undefined
          }
          otherGroups={otherGroups}
          onMoveItemOut={onMoveItemOut}
          savedFilters={payload.savedFilters}
        />
      </div>
    );
  }
  if (type === "image" && payload.type === "image") {
    return (
      <div style={style} className="h-full w-full p-3">
        <div className="h-full w-full rounded-xl border border-slate-200/70 dark:border-slate-700/70 bg-white/80 dark:bg-slate-800/50 flex items-center justify-center overflow-hidden">
          <img
            src={payload.src}
            alt={payload.alt || "Canvas image"}
            className="max-h-full max-w-full object-contain"
          />
        </div>
      </div>
    );
  }
  if (type === "cohi_widget" && payload.type === "cohi_widget") {
    return (
      <CohiWidgetRendererWithTenant
        payload={payload}
        style={style}
        width={width}
        height={height}
      />
    );
  }
  return (
    <div
      style={style}
      className="flex items-center justify-center text-slate-400 dark:text-slate-500 text-sm"
    >
      Unknown widget: {type}
    </div>
  );
}
