/**
 * Dashboard Image Analysis Service
 * Analyzes uploaded dashboard screenshots using GPT-4o Vision
 * and generates widget blueprints that can be materialized on the workbench canvas.
 */

import {
  callOpenAI,
  getOpenAIKey,
  generateQuery,
  executeQuery,
  buildVisualizationConfig,
  formatDataRows,
  type OpenAIChatMessage,
  type ChatContext,
  type VisualizationConfig,
} from "./cohiChatService.js";
import { getSchemaForTenant } from "./schemaContextService.js";

// ============================================================================
// Blueprint Types
// ============================================================================

export interface WidgetBlueprint {
  /** Human-readable title for this widget */
  title: string;
  /** Description of what the widget shows – used as the prompt for SQL generation */
  description: string;
  /** Visualization type */
  vizType: "kpi" | "bar" | "line" | "area" | "pie" | "donut" | "horizontal_bar" | "table";
  /** Whether this is a multi-series / grouped chart */
  multiSeries?: boolean;
  /** Series labels for multi-series charts */
  seriesLabels?: string[];
  /** Column descriptions for table widgets */
  columns?: string[];
  /** LLM's best-guess SQL (validated/regenerated later) */
  suggestedSql?: string;
  /** Layout size hint (grid columns x grid rows within the group) */
  layoutHint?: { w: number; h: number };
}

export interface DashboardGroupBlueprint {
  /** Display title for the WidgetGroup */
  title: string;
  /** Section type for filter scoping */
  sectionType: string;
  /** Primary date column for this section */
  dateField: string;
  /** Widgets within this group */
  widgets: WidgetBlueprint[];
}

export interface DashboardBlueprint {
  /** Overall dashboard title */
  title: string;
  /** Groups (sections) within the dashboard */
  groups: DashboardGroupBlueprint[];
}

// ============================================================================
// Generated Widget (result of materializing a blueprint)
// ============================================================================

export interface GeneratedWidget {
  id: string;
  sql: string;
  title: string;
  vizConfig: VisualizationConfig;
  explanation?: string;
}

export interface GeneratedGroup {
  title: string;
  sectionType: string;
  dateField: string;
  widgets: GeneratedWidget[];
}

// ============================================================================
// Vision System Prompt
// ============================================================================

function buildVisionSystemPrompt(schemaContext: string): string {
  return `You are a dashboard analysis expert. You will receive a screenshot of a business dashboard and a database schema. Your task is to decompose the dashboard into discrete widgets and return a structured JSON blueprint.

## Your Database Schema
${schemaContext}

## Instructions

1. **Identify all distinct sections/groups** in the dashboard. Each group typically has its own title, filters, and a collection of visualizations. A section is a visually distinct area with its own header or filter controls.

2. **For each group**, identify:
   - Its title (e.g. "Pull Through | Application Date to Funded")
   - The primary date column it filters on (map to actual column names from the schema: application_date, lock_date, funding_date, closing_date, started_date, etc.)
   - A sectionType: use "company-scorecard" as default, or "credit-risk", "sales-scorecard", "operations-scorecard" if clearly applicable

3. **For each widget within a group**, identify:
   - title: A concise title (e.g. "Pull Through %")
   - description: A detailed natural language description of what data the widget shows, referencing actual database columns and calculations. This must be specific enough to generate a SQL query. Example: "Calculate the pull-through percentage as (COUNT of loans where funding_date IS NOT NULL / COUNT of all loans where current_loan_status != 'Active Loan') * 100, filtered by application_date in the selected date range"
   - vizType: one of "kpi", "bar", "line", "area", "pie", "donut", "horizontal_bar", "table"
   - multiSeries: true if the chart shows multiple data series (e.g. grouped/clustered bars)
   - seriesLabels: array of series names if multiSeries (e.g. ["Pull Through %", "Approved %", "Withdrawn %", "Denied %"])
   - columns: for tables, describe each column (e.g. ["Underwriter name", "Unit count", "Funded percentage", ...])
   - suggestedSql: your best-guess PostgreSQL query using the actual table and column names from the schema. The main table is public.loans aliased as l. Use proper aggregation functions.
   - layoutHint: approximate size in a 12-column grid. KPIs are typically {w:3, h:2}, charts {w:6, h:4} or {w:12, h:4}, tables {w:12, h:5}

## Important Notes
- The database table is \`public.loans\` with columns exactly as listed in the schema above.
- Pull-through rate = (loans with funding_date IS NOT NULL) / (total loans excluding current_loan_status = 'Active Loan') * 100
- Approved rate includes loans that got approved (approval_date IS NOT NULL) but may not have funded
- Withdrawn/Denied can be determined from current_loan_status containing 'Withdrawn', 'Denied', etc.
- For date filtering, always use the group's dateField column
- For grouped bar charts with monthly data, use DATE_TRUNC('month', date_column) and format with TO_CHAR
- Personnel columns: loan_officer, underwriter, processor, closer
- Always reference the actual column names from the schema, not made-up names

## Output Format
Return ONLY valid JSON matching this structure:
{
  "title": "Dashboard Title",
  "groups": [
    {
      "title": "Group Title",
      "sectionType": "company-scorecard",
      "dateField": "application_date",
      "widgets": [
        {
          "title": "Widget Title",
          "description": "Detailed description for SQL generation...",
          "vizType": "kpi",
          "multiSeries": false,
          "seriesLabels": [],
          "columns": [],
          "suggestedSql": "SELECT ...",
          "layoutHint": { "w": 3, "h": 2 }
        }
      ]
    }
  ]
}`;
}

// ============================================================================
// Analyze Dashboard Image
// ============================================================================

export async function analyzeDashboardImage(
  imageBase64: string,
  tenantId: string,
  description?: string
): Promise<DashboardBlueprint> {
  const apiKey = await getOpenAIKey(tenantId);
  const schemaContext = await getSchemaForTenant(tenantId);
  const systemPrompt = buildVisionSystemPrompt(schemaContext);

  const userContent: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } }
  > = [
    {
      type: "image_url",
      image_url: { url: imageBase64, detail: "high" },
    },
    {
      type: "text",
      text: description
        ? `Analyze this dashboard screenshot and generate a blueprint. Additional context from the user: "${description}"`
        : "Analyze this dashboard screenshot and generate a complete blueprint for recreating it.",
    },
  ];

  const messages: OpenAIChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ];

  const response = await callOpenAI(messages, apiKey, {
    temperature: 0.2,
    jsonMode: true,
    maxTokens: 4000,
  });

  const parsed = JSON.parse(response) as DashboardBlueprint;

  // Validate basic structure
  if (!parsed.title || !Array.isArray(parsed.groups)) {
    throw new Error("Invalid blueprint structure returned from LLM");
  }

  for (const group of parsed.groups) {
    if (!group.title || !Array.isArray(group.widgets)) {
      throw new Error(`Invalid group structure: ${JSON.stringify(group)}`);
    }
    // Default sectionType if missing
    if (!group.sectionType) group.sectionType = "company-scorecard";
    if (!group.dateField) group.dateField = "application_date";
  }

  return parsed;
}

// ============================================================================
// Generate Widgets from Blueprint
// ============================================================================

export async function generateWidgetsFromBlueprint(
  group: DashboardGroupBlueprint,
  context: ChatContext
): Promise<GeneratedGroup> {
  const results: GeneratedWidget[] = [];

  for (const widget of group.widgets) {
    try {
      const widgetResult = await generateSingleWidget(widget, group, context);
      if (widgetResult) {
        results.push(widgetResult);
      }
    } catch (err: any) {
      console.error(
        `[DashboardImage] Failed to generate widget "${widget.title}":`,
        err.message
      );
      // If the widget has suggestedSql, try using that directly
      if (widget.suggestedSql) {
        try {
          const fallbackResult = await generateWidgetFromSql(
            widget,
            widget.suggestedSql,
            context
          );
          if (fallbackResult) {
            results.push(fallbackResult);
            continue;
          }
        } catch (fallbackErr: any) {
          console.error(
            `[DashboardImage] Fallback SQL also failed for "${widget.title}":`,
            fallbackErr.message
          );
        }
      }
      // Create a placeholder widget so the user knows it failed
      results.push({
        id: `cohi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        sql: widget.suggestedSql || "-- SQL generation failed",
        title: `${widget.title} (failed to generate)`,
        vizConfig: {
          type: widget.vizType as VisualizationConfig["type"],
          title: widget.title,
          data: [],
        },
        explanation: `Failed to generate: ${err.message}`,
      });
    }
  }

  return {
    title: group.title,
    sectionType: group.sectionType,
    dateField: group.dateField,
    widgets: results,
  };
}

// ============================================================================
// Internal: Generate a single widget
// ============================================================================

async function generateSingleWidget(
  widget: WidgetBlueprint,
  group: DashboardGroupBlueprint,
  context: ChatContext
): Promise<GeneratedWidget | null> {
  // Build a detailed question for the existing query generation pipeline
  const question = buildWidgetQuestion(widget, group);

  console.log(
    `[DashboardImage] Generating widget "${widget.title}" with question: ${question.substring(0, 200)}...`
  );

  // Use the existing generateQuery pipeline (includes schema context, prompt config, auto-retry)
  const queryResult = await generateQuery(question, context);

  if (!queryResult) {
    // Try with suggestedSql if available
    if (widget.suggestedSql) {
      return generateWidgetFromSql(widget, widget.suggestedSql, context);
    }
    throw new Error("Query generation returned null");
  }

  // Execute the generated SQL
  const execResult = await executeQuery(queryResult.sql, queryResult.params, context);

  // Format the data
  const formattedData = formatDataRows(execResult.rows);

  // Build the visualization config
  const vizConfig = buildVisualizationConfig(formattedData, queryResult);

  // Override the title with the blueprint's title
  vizConfig.title = widget.title;

  // For multi-series charts, make sure yKeys are set
  if (widget.multiSeries && widget.seriesLabels && vizConfig.yKeys === undefined) {
    // The LLM should have set yKeys in chartConfig, but if not, try to infer from data
    const dataKeys = Object.keys(formattedData[0] || {});
    const xKey = vizConfig.xKey || dataKeys[0];
    const potentialYKeys = dataKeys.filter((k) => k !== xKey);
    if (potentialYKeys.length > 1) {
      vizConfig.yKeys = potentialYKeys;
    }
  }

  return {
    id: `cohi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    sql: queryResult.sql,
    title: widget.title,
    vizConfig,
    explanation: queryResult.explanation,
  };
}

async function generateWidgetFromSql(
  widget: WidgetBlueprint,
  sql: string,
  context: ChatContext
): Promise<GeneratedWidget | null> {
  const execResult = await executeQuery(sql, [], context);
  const formattedData = formatDataRows(execResult.rows);

  // Build a minimal viz config
  const vizType = widget.vizType as VisualizationConfig["type"];
  const humanize = (key: string): string =>
    key.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());

  const baseConfig: VisualizationConfig = {
    type: vizType,
    title: widget.title,
    data: formattedData,
    showLegend: true,
    showGrid: true,
  };

  if (vizType === "kpi") {
    const firstRow = formattedData[0] || {};
    const kpiKey = Object.keys(firstRow)[0];
    baseConfig.kpiConfig = {
      value: firstRow[kpiKey],
      label: widget.title,
      format:
        typeof firstRow[kpiKey] === "number" && firstRow[kpiKey] <= 100
          ? "percent"
          : "number",
    };
  } else if (vizType === "table") {
    const columns = Object.keys(formattedData[0] || {}).map((key) => ({
      key,
      label: humanize(key),
      format: undefined,
    }));
    baseConfig.tableConfig = { columns, sortable: true, pageSize: 10 };
  } else {
    // bar, line, area, etc.
    const dataKeys = Object.keys(formattedData[0] || {});
    baseConfig.xKey = dataKeys[0];
    baseConfig.yKey = dataKeys[1];
    baseConfig.xLabel = humanize(dataKeys[0] || "");
    baseConfig.yLabel = humanize(dataKeys[1] || "");
    baseConfig.colors = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];

    if (widget.multiSeries && dataKeys.length > 2) {
      baseConfig.yKeys = dataKeys.slice(1);
    }
  }

  return {
    id: `cohi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    sql,
    title: widget.title,
    vizConfig: baseConfig,
    explanation: widget.description,
  };
}

function buildWidgetQuestion(
  widget: WidgetBlueprint,
  group: DashboardGroupBlueprint
): string {
  let q = widget.description;

  // Add viz type hint
  q += `\n\nIMPORTANT: Generate this as a ${widget.vizType} visualization.`;

  if (widget.vizType === "kpi") {
    q += " Return a single-row result with one numeric value.";
  }

  if (widget.multiSeries && widget.seriesLabels) {
    q += ` This should be a multi-series chart with these series: ${widget.seriesLabels.join(", ")}. Use separate columns for each series in the SQL output (yKeys pattern).`;
  }

  if (widget.vizType === "table" && widget.columns) {
    q += ` The table should have these columns: ${widget.columns.join(", ")}.`;
  }

  // Add date field context
  q += `\n\nUse ${group.dateField} as the primary date column for filtering and grouping.`;

  // If there's a suggested SQL, hint at it
  if (widget.suggestedSql) {
    q += `\n\nHere is a suggested SQL query for reference (adapt as needed to match the actual schema):\n${widget.suggestedSql}`;
  }

  return q;
}
