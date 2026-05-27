import type { ChatVizExportContent } from "@/lib/chatVisualizationPptContent";
import type {
  PresentationExportAction,
  PresentationExportMode,
} from "@/lib/presentationExportIntent";

export type ChatMessagePptExport = {
  title: string;
  slideCount: number;
  /** Viz chart export (default) vs full research report deck. */
  exportKind?: "viz" | "research_report";
  exportContent?: ChatVizExportContent;
  messageId?: string;
  chartEmbedded?: boolean;
  blobUrl?: string;
  status: "ready" | "error" | "building";
  errorMessage?: string;
};

export type PresentationExportMetadataPayload = {
  prefilterHit: boolean;
  wantsPresentationExport: boolean;
  mode: PresentationExportMode;
  action: PresentationExportAction;
  confidence: number;
  deferred?: boolean;
  researchTopic?: string;
};

export function parsePresentationExportMetadata(
  metadata?: Record<string, unknown>,
): PresentationExportMetadataPayload | null {
  const raw = metadata?.presentationExport;
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.wantsPresentationExport !== "boolean") return null;
  return {
    prefilterHit: !!o.prefilterHit,
    wantsPresentationExport: o.wantsPresentationExport,
    mode: o.mode === "convert" ? "convert" : "create",
    action:
      o.action === "export_research_report"
        ? "export_research_report"
        : o.action === "open_workbench_editor"
          ? "open_workbench_editor"
          : o.action === "export_viz"
            ? "export_viz"
            : "none",
    confidence: typeof o.confidence === "number" ? o.confidence : 0,
    deferred: o.deferred === true,
    researchTopic:
      typeof o.researchTopic === "string" ? o.researchTopic : undefined,
  };
}
