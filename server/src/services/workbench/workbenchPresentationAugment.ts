/**
 * Fallback generate_report when the model asks for live values instead of using canvas data.
 */

export type CanvasWidgetDataEntry = {
  widgetName: string;
  category: string;
  data: unknown;
};

export type CanvasStateForPresentation = {
  totalItems?: number;
  widgetData?: CanvasWidgetDataEntry[];
};

type MutableWorkbenchAction = {
  type?: string;
  reportDefinition?: Record<string, unknown>;
  format?: "pptx" | "pdf";
  explanation?: string;
};

const DEFAULT_THEME = {
  name: "professional",
  primaryColor: "#1e3a5f",
  accentColor: "#3b82f6",
  backgroundColor: "#ffffff",
  textColor: "#1e293b",
  fontFamily: "Calibri",
  headerFontFamily: "Calibri",
  chartColors: ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"],
};

export function isReportRequest(
  ...texts: Array<string | undefined | null>
): boolean {
  const combined = texts
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    .join("\n")
    .toLowerCase();
  return /\b(report|presentation|powerpoint|pptx|pdf|slide|deck)\b/.test(combined);
}

export function extractPrimaryValue(data: unknown): number | string {
  if (data == null) return "—";
  if (typeof data === "number") return data;
  if (Array.isArray(data) && data.length > 0) {
    const row = data[0];
    if (row && typeof row === "object") {
      for (const v of Object.values(row as Record<string, unknown>)) {
        if (typeof v === "number" && Number.isFinite(v)) return v;
        if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) {
          return Number(v);
        }
      }
    }
  }
  return "—";
}

function formatMetricValue(value: number | string): string {
  if (typeof value === "number") {
    if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
    if (value > 0 && value <= 1) return `${(value * 100).toFixed(1)}%`;
    return value.toLocaleString("en-US");
  }
  return String(value);
}

export function buildFallbackReportFromCanvas(
  canvasState: CanvasStateForPresentation,
  title = "Executive Dashboard",
): Record<string, unknown> {
  const widgetData = canvasState.widgetData ?? [];
  const kpis = widgetData.filter((w) => w.category === "kpi");
  const charts = widgetData.filter((w) => w.category !== "kpi");

  const slides: Record<string, unknown>[] = [
    {
      id: "slide-title",
      layout: "title",
      title,
      subtitle: "Month-to-date performance",
      elements: [
        {
          id: "el-title",
          type: "text",
          position: { x: 0.5, y: 2.0, w: 9.0, h: 1.5 },
          config: { type: "text", content: title },
        },
      ],
    },
  ];

  if (kpis.length > 0) {
    slides.push({
      id: "slide-kpis",
      layout: "kpi-grid",
      title: "Key metrics",
      elements: kpis.slice(0, 6).map((w, i) => {
        const value = extractPrimaryValue(w.data);
        return {
          id: `kpi-${i}`,
          type: "kpi",
          position: {
            x: 0.4 + (i % 3) * 3.1,
            y: 1.1 + Math.floor(i / 3) * 1.5,
            w: 2.9,
            h: 1.3,
          },
          config: {
            type: "kpi",
            label: w.widgetName,
            value,
          },
        };
      }),
    });
  }

  const summaryLines = widgetData.slice(0, 8).map((w) => {
    const v = formatMetricValue(extractPrimaryValue(w.data));
    return `• ${w.widgetName}: ${v}`;
  });

  slides.push({
    id: "slide-summary",
    layout: "content",
    title: "Executive summary",
    speakerNotes: summaryLines.join("\n"),
    elements: [
      {
        id: "el-summary",
        type: "text",
        position: { x: 0.5, y: 1.0, w: 9.0, h: 5.5 },
        config: {
          type: "text",
          content:
            summaryLines.join("\n") ||
            "This deck summarizes the metrics currently visible on your dashboard.",
        },
      },
    ],
  });

  if (charts.length > 0) {
    const w = charts[0];
    const rows = Array.isArray(w.data) ? w.data : [];
    slides.push({
      id: "slide-chart",
      layout: "chart-focus",
      title: w.widgetName,
      elements: [
        {
          id: "el-chart",
          type: "chart",
          position: { x: 0.5, y: 1.2, w: 9.0, h: 4.8 },
          config: {
            type: "bar",
            title: w.widgetName,
            data: rows,
          },
        },
      ],
    });
  }

  return {
    title,
    subtitle: "Generated from live dashboard data",
    theme: DEFAULT_THEME,
    slides,
  };
}

/** Inject generate_report when the model omitted it but canvas has live values. */
export function augmentPresentationFromCanvas(
  actions: unknown[],
  options: {
    userQuestion?: string;
    canvasState?: CanvasStateForPresentation;
  },
): boolean {
  if (!isReportRequest(options.userQuestion)) return false;
  if ((options.canvasState?.totalItems ?? 0) === 0) return false;
  if (!options.canvasState?.widgetData?.length) return false;

  const typed = actions as MutableWorkbenchAction[];
  if (typed.some((a) => a.type === "generate_report")) return false;

  const reportDefinition = buildFallbackReportFromCanvas(
    options.canvasState,
    "Board-Ready Executive Overview",
  );

  typed.unshift({
    type: "generate_report",
    reportDefinition,
    format: "pptx",
    explanation: "Executive deck built from dashboard live values",
  });

  return true;
}
