/**
 * Normalize structural mode handoff for Research / Insight Builder branches.
 */

import type pg from "pg";
import type { ResearchSession } from "../research/orchestrator.js";
import type { ResearchWidgetContext } from "../../types/researchWidgetContext.js";
import type { ModeHandoffContextPayload } from "./modeHandoff.js";
import {
  buildCanvasContext,
  buildResearchContextFromCanvas,
  truncateCanvasMarkdown,
  type CanvasStateSnapshot,
} from "./canvasContextBuilder.js";
import { METRIC_LANGUAGE_RULES } from "./metricLexicon.js";

const MAX_CANVAS_MARKDOWN = 8000;
const MAX_IB_PREFIX_CHARS = 2000;

export interface HandoffManifestEntry {
  tier: string;
  included: boolean;
  truncated: boolean;
}

export interface ResolvedResearchHandoff {
  steeringDirectives: string[];
  widgetContext?: ResearchWidgetContext;
  manifest: HandoffManifestEntry[];
}

export interface ResolvedInsightBuilderHandoff {
  historyPrefix: string | null;
  manifest: HandoffManifestEntry[];
}

function canvasSteeringDirective(
  markdown: string,
  meta: { canvasTitle?: string; fromChatType?: string },
): string {
  const label = meta.fromChatType ?? "workbench";
  const titlePart = meta.canvasTitle ? ` "${meta.canvasTitle}"` : "";
  return [
    `OPEN WORKBENCH CANVAS — User switched from ${label} while viewing${titlePart}:`,
    markdown,
    "Treat this board as the subject of the investigation when the user refers to 'this dashboard', 'these widgets', or similar.",
    "Prefer widgets and metrics already on the canvas before inventing new SQL.",
    METRIC_LANGUAGE_RULES,
  ].join("\n");
}

export async function resolveResearchStructuralHandoff(
  handoff: ModeHandoffContextPayload | null,
  tenantPool: pg.Pool | null,
): Promise<ResolvedResearchHandoff> {
  const manifest: HandoffManifestEntry[] = [];
  const steeringDirectives: string[] = [];

  if (!handoff) {
    return { steeringDirectives, manifest };
  }

  let widgetContext: ResearchWidgetContext | undefined;
  if (handoff.widgetCatalog?.trim()) {
    widgetContext = {
      catalog: handoff.widgetCatalog.trim(),
      meta: Array.isArray(handoff.widgetCatalogMeta)
        ? handoff.widgetCatalogMeta
        : [],
    };
    manifest.push({
      tier: "research_registry",
      included: true,
      truncated: false,
    });
  }

  const canvas = handoff.canvasState as CanvasStateSnapshot | undefined;
  if (canvas && canvas.totalItems > 0) {
    const raw = buildCanvasContext(canvas);
    const { text, truncated } = truncateCanvasMarkdown(
      raw,
      MAX_CANVAS_MARKDOWN,
    );
    steeringDirectives.push(
      canvasSteeringDirective(text, {
        canvasTitle: handoff.canvasTitle,
        fromChatType: handoff.fromChatType,
      }),
    );
    manifest.push({
      tier: "workbench_snapshot",
      included: true,
      truncated,
    });

    if (tenantPool) {
      const researchOnCanvas = await buildResearchContextFromCanvas(
        canvas,
        tenantPool,
      );
      if (researchOnCanvas.trim()) {
        const { text: rcText, truncated: rcTrunc } = truncateCanvasMarkdown(
          researchOnCanvas,
          4000,
        );
        steeringDirectives.push(rcText);
        manifest.push({
          tier: "canvas_research_widgets",
          included: true,
          truncated: rcTrunc,
        });
      }
    }
  }

  return { steeringDirectives, widgetContext, manifest };
}

export function resolveInsightBuilderStructuralHandoff(
  handoff: ModeHandoffContextPayload | null,
): ResolvedInsightBuilderHandoff {
  const manifest: HandoffManifestEntry[] = [];
  if (!handoff?.canvasState || handoff.canvasState.totalItems === 0) {
    return { historyPrefix: null, manifest };
  }

  const canvas = handoff.canvasState as CanvasStateSnapshot;
  const raw = buildCanvasContext(canvas);
  const { text, truncated } = truncateCanvasMarkdown(raw, MAX_IB_PREFIX_CHARS);

  const titlePart = handoff.canvasTitle ? ` "${handoff.canvasTitle}"` : "";
  const prefix = [
    `[Workbench canvas context${titlePart} — use for insight prompt/specifier ideas]`,
    text,
  ].join("\n");

  manifest.push({
    tier: "workbench_snapshot_ib",
    included: true,
    truncated,
  });

  return { historyPrefix: prefix, manifest };
}

export function applyResearchHandoffToSession(
  session: ResearchSession,
  resolved: ResolvedResearchHandoff,
): void {
  if (
    resolved.widgetContext &&
    (resolved.widgetContext.catalog?.trim() ||
      (resolved.widgetContext.meta?.length ?? 0) > 0)
  ) {
    session.widgetContext = resolved.widgetContext;
  }
  if (session.phase === "complete" || session.phase === "error") return;
  for (const directive of resolved.steeringDirectives) {
    if (directive.trim()) session.steeringDirectives.push(directive);
  }
}
