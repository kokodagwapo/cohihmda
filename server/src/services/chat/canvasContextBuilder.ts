/**
 * Shared workbench canvas markdown for LLM context (workbench + cross-mode handoff).
 */

import type pg from "pg";
import { loadSession as loadResearchSession } from "../research/orchestrator.js";

export interface CanvasStateSnapshot {
  groups: {
    groupId: string;
    title: string;
    sectionType: string;
    widgetIds: string[];
    widgets?: {
      id: string;
      kind: "registry" | "cohi";
      defId?: string;
      title?: string;
      name?: string;
      sql?: string;
    }[];
    widgetLayouts?: Record<
      string,
      { x: number; y: number; w: number; h: number }
    >;
    filters?: {
      dateRange?: string;
      dateField?: string;
      branch?: string;
      loanOfficer?: string;
    };
  }[];
  standaloneWidgets: {
    id: string;
    type: string;
    title?: string;
    sourceType?: "research" | "chat";
    sourceSessionId?: string;
    sourceArtifactId?: string;
    artifactCapabilities?: {
      canInjectFilters?: boolean;
      canEditPresentation?: boolean;
    };
    filterConfig?: {
      filterable?: boolean;
      dateColumn?: string;
      defaultPreset?: string | null;
    };
    sql?: string;
    selected?: boolean;
  }[];
  totalItems: number;
  widgetData?: {
    itemId: string;
    widgetName: string;
    category: string;
    data: unknown;
  }[];
}

function fmtNum(val: unknown): string {
  if (val == null) return "N/A";
  const n = Number(val);
  if (Number.isNaN(n)) return String(val);
  if (Math.abs(n) >= 1_000_000_000)
    return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000)
    return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2);
}

function formatKpiData(data: unknown): string {
  const d = data as Record<string, unknown> | null;
  if (!d) return "";
  if (d.value !== undefined) {
    const val =
      d.format === "currency"
        ? fmtNum(d.value)
        : d.format === "percent"
          ? `${Number(d.value).toFixed(1)}%`
          : fmtNum(d.value);
    return d.subtitle ? `${val} (${d.subtitle})` : String(val);
  }
  return JSON.stringify(data).substring(0, 200);
}

function formatChartData(data: unknown): string {
  const d = data as Record<string, unknown> | null;
  if (!d) return "";
  const chartData: unknown[] = Array.isArray(d.data)
    ? d.data
    : Array.isArray(data)
      ? (data as unknown[])
      : [];
  if (chartData.length === 0) return "(no data)";

  const first = chartData[0] as Record<string, unknown>;
  const xKey = (d.xKey as string) || Object.keys(first || {})[0];
  const yKey = (d.yKey as string) || Object.keys(first || {})[1];

  const points = chartData.slice(0, 8).map((row) => {
    const r = row as Record<string, unknown>;
    const x = r[xKey] ?? "";
    const y = r[yKey] ?? "";
    return `${x}: ${fmtNum(y)}`;
  });
  const suffix =
    chartData.length > 8 ? ` ... (${chartData.length} total points)` : "";
  return points.join(", ") + suffix;
}

function formatTableData(data: unknown): string {
  const d = data as Record<string, unknown> | null;
  if (!d) return "";
  const rows: unknown[] = Array.isArray(d.data)
    ? d.data
    : Array.isArray(data)
      ? (data as unknown[])
      : [];
  if (rows.length === 0) return "(no data)";

  const first = rows[0] as Record<string, unknown>;
  const keys = Object.keys(first || {}).slice(0, 6);
  const header = keys.join(" | ");
  const bodyRows = rows.slice(0, 5).map((row) => {
    const r = row as Record<string, unknown>;
    return keys
      .map((k) => {
        const v = r[k];
        return v == null
          ? "-"
          : typeof v === "number"
            ? fmtNum(v)
            : String(v).substring(0, 30);
      })
      .join(" | ");
  });
  const suffix = rows.length > 5 ? `\n... (${rows.length} total rows)` : "";
  return `${header}\n${bodyRows.join("\n")}${suffix}`;
}

const MAX_DATA_CHARS = 16000;

/** Build markdown describing the open workbench canvas (structure + live values). */
export function buildCanvasContext(state: CanvasStateSnapshot): string {
  if (state.totalItems === 0) return "The canvas is currently empty.";

  const lines: string[] = ["## CURRENT CANVAS STATE\n"];

  if (state.groups.length > 0) {
    lines.push(`### Dashboard Groups on Canvas (${state.groups.length})`);
    for (const g of state.groups) {
      let filterStr = "";
      if (g.filters) {
        const parts: string[] = [];
        if (g.filters.dateRange) parts.push(`Date: ${g.filters.dateRange}`);
        if (g.filters.dateField) parts.push(`Field: ${g.filters.dateField}`);
        if (g.filters.branch) parts.push(`Branch: ${g.filters.branch}`);
        if (g.filters.loanOfficer) parts.push(`LO: ${g.filters.loanOfficer}`);
        if (parts.length > 0) filterStr = ` [Filters: ${parts.join(", ")}]`;
      }
      const widgetCount = g.widgets?.length ?? g.widgetIds.length;
      lines.push(
        `- **${g.title}** groupId=\`${g.groupId}\` (${g.sectionType}, ${widgetCount} widgets)${filterStr}`,
      );
      if (g.widgets && g.widgets.length > 0) {
        for (const w of g.widgets) {
          const label = w.kind === "registry" ? w.name || w.defId : w.title;
          const layout = g.widgetLayouts?.[w.id];
          const layoutStr = layout
            ? ` @ grid(${layout.x},${layout.y}) size ${layout.w}x${layout.h}`
            : "";
          lines.push(`  - \`${w.id}\` (${w.kind}) ${label ?? ""}${layoutStr}`);
          if (w.kind === "cohi" && w.sql) {
            const sqlLimit = 1600;
            const sqlSnippet =
              w.sql.length <= sqlLimit ? w.sql : `${w.sql.substring(0, sqlLimit)}...`;
            lines.push(`    SQL: \`${sqlSnippet}\``);
          }
        }
      }
    }
    lines.push("");
  }

  if (state.standaloneWidgets.length > 0) {
    lines.push(`### Standalone Items (${state.standaloneWidgets.length})`);
    for (const w of state.standaloneWidgets) {
      const source =
        w.sourceType === "research" ? " [research-lab widget]" : "";
      const selectedLabel = w.selected ? " [SELECTED]" : "";
      lines.push(
        `- ${w.id} (${w.type})${w.title ? ": " + w.title : ""}${source}${selectedLabel}`,
      );
      if (w.sql) {
        const sqlLimit = w.selected ? w.sql.length : 1000;
        const sqlSnippet =
          w.sql.length <= sqlLimit
            ? w.sql
            : w.sql.substring(0, sqlLimit) + "...";
        lines.push(`  SQL: \`${sqlSnippet}\``);
      }
    }
    lines.push("");
  }

  if (state.widgetData && state.widgetData.length > 0) {
    lines.push("### LIVE DATA VALUES (what the user currently sees)\n");

    const sorted = [...state.widgetData].sort((a, b) => {
      const order: Record<string, number> = {
        kpi: 0,
        chart: 1,
        table: 2,
        embed: 3,
        other: 4,
      };
      return (order[a.category] ?? 4) - (order[b.category] ?? 4);
    });

    let charBudget = MAX_DATA_CHARS;

    for (const entry of sorted) {
      if (charBudget <= 0) {
        lines.push(
          "... (additional widget data truncated to stay within context limits)",
        );
        break;
      }

      let formatted = "";
      switch (entry.category) {
        case "kpi":
          formatted = `- **${entry.widgetName}**: ${formatKpiData(entry.data)}`;
          break;
        case "chart":
          formatted = `- **${entry.widgetName}** (chart): ${formatChartData(entry.data)}`;
          break;
        case "table":
          formatted = `- **${entry.widgetName}** (table):\n${formatTableData(entry.data)}`;
          break;
        default:
          formatted = `- **${entry.widgetName}**: ${(JSON.stringify(entry.data) ?? "null").substring(0, 150)}`;
          break;
      }

      charBudget -= formatted.length;
      lines.push(formatted);
    }
  }

  return lines.join("\n");
}

/** Research sessions referenced by widgets on the canvas. */
export async function buildResearchContextFromCanvas(
  state: CanvasStateSnapshot | undefined,
  tenantPool: pg.Pool | null,
): Promise<string> {
  if (!state || !tenantPool) return "";
  const sessionIds = new Set<string>();
  for (const w of state.standaloneWidgets) {
    if (w.sourceType === "research" && w.sourceSessionId) {
      sessionIds.add(w.sourceSessionId);
    }
  }
  if (sessionIds.size === 0) return "";

  const blocks: string[] = ["\n## RESEARCH LAB CONTEXT\n"];
  blocks.push(
    "The canvas contains widgets created from Research Lab sessions. " +
      "When the user asks to modify a research widget, use the research context " +
      "below to understand the analytical intent, then generate a new SQL query " +
      "that achieves the requested change. Use the modify_widget action with a " +
      "new `sql` field.\n",
  );

  for (const sid of sessionIds) {
    try {
      const session = await loadResearchSession(sid, tenantPool);
      if (!session) continue;
      blocks.push(`### Research Session: ${session.topic || "Untitled"}`);
      blocks.push(`Session ID: ${sid}`);
      if (session.findings && session.findings.length > 0) {
        blocks.push(`\n**Findings (${session.findings.length}):**`);
        for (const f of session.findings.slice(0, 5)) {
          blocks.push(
            `- **${f.title}** (${f.confidence} confidence): ${(f.summary ?? "").substring(0, 200)}`,
          );
        }
      }
      blocks.push("");
    } catch (err) {
      console.warn(
        `[canvasContextBuilder] Failed to load research session ${sid}:`,
        err,
      );
    }
  }

  return blocks.join("\n");
}

export function truncateCanvasMarkdown(markdown: string, maxChars: number): {
  text: string;
  truncated: boolean;
} {
  const t = markdown.trim();
  if (t.length <= maxChars) return { text: t, truncated: false };
  return {
    text: `${t.slice(0, maxChars - 1)}…`,
    truncated: true,
  };
}
