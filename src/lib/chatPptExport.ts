import type { VisualizationConfig } from "@/hooks/useCohiChat";
import type { Finding, ResearchReport } from "@/hooks/useResearchSession";
import {
  buildChatVizExportContent,
  writeChatVizExportToPptFile,
  type ChatVizExportContent,
} from "@/lib/chatVisualizationPptContent";
import { blobToDataUrl, captureChartAsBlob } from "@/lib/captureChartForExport";
import {
  buildResearchReportPptModel,
  collectImageCaptureKeys,
  researchCaptureTimeoutMs,
} from "@/lib/researchReportPptExport";
import {
  captureResearchExportImages,
  waitForResearchCaptureReady,
} from "@/lib/researchReportPptCapture";
import { exportResearchReportAsPpt } from "@/utils/exportUtils";

export type ExportAssistantVisualizationInput = {
  viz: VisualizationConfig;
  title?: string;
  description?: string;
  messageId?: string;
  /** When false, only build content (preview) without downloading. */
  download?: boolean;
};

export type ExportAssistantVisualizationResult = {
  exportContent: ChatVizExportContent;
  chartEmbedded: boolean;
  blob?: Blob;
};

export async function exportAssistantVisualizationAsPpt(
  input: ExportAssistantVisualizationInput,
): Promise<ExportAssistantVisualizationResult> {
  const { viz, title, description, messageId } = input;
  const displayTitle = title || viz.title || "Visualization";
  let chartImageDataUrl: string | undefined;

  if (messageId) {
    try {
      const blob = await captureChartAsBlob(messageId);
      if (blob) {
        chartImageDataUrl = await blobToDataUrl(blob);
      }
    } catch (captureErr) {
      console.warn("Chart capture for PPT failed:", captureErr);
    }
  }

  const exportContent = buildChatVizExportContent({
    viz,
    title: displayTitle,
    description,
    chartImageDataUrl,
  });

  if (input.download === false) {
    return {
      exportContent,
      chartEmbedded: !!chartImageDataUrl,
    };
  }

  const { chartEmbedded } = await writeChatVizExportToPptFile(
    exportContent,
    displayTitle,
  );

  return { exportContent, chartEmbedded };
}

export type ExportResearchSessionReportInput = {
  title: string;
  understory?: string;
  report: ResearchReport | null;
  findings: Finding[];
  primaryFinding?: Finding | null;
  reportContainer: HTMLElement | null;
  onPreparing?: (preparing: boolean) => void;
  onSwitchToReportTab?: () => void;
};

export async function exportResearchSessionReportAsPpt(
  input: ExportResearchSessionReportInput,
): Promise<void> {
  const slides = buildResearchReportPptModel({
    title: input.title,
    understory: input.understory,
    report: input.report,
    findings: input.findings,
    primaryFinding: input.primaryFinding,
  });
  const keys = collectImageCaptureKeys(slides);
  input.onSwitchToReportTab?.();
  input.onPreparing?.(true);
  try {
    await waitForResearchCaptureReady(
      input.reportContainer,
      keys,
      researchCaptureTimeoutMs(keys),
    );
    const images = await captureResearchExportImages(
      input.reportContainer,
      keys,
    );
    await exportResearchReportAsPpt(slides, images, input.title);
  } finally {
    input.onPreparing?.(false);
  }
}
