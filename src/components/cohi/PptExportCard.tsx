import React, { useCallback, useEffect, useState } from "react";
import { Download, Presentation } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ChatMessagePptExport } from "@/lib/presentationExportTypes";
import { writeChatVizExportToPptFile } from "@/lib/chatVisualizationPptContent";
import { exportAssistantVisualizationAsPpt } from "@/lib/chatPptExport";
import type { VisualizationConfig } from "@/hooks/useCohiChat";

type PptExportCardProps = {
  pptExport: ChatMessagePptExport;
  visualization?: VisualizationConfig;
  /** Full research report export (capture + download). */
  onDownloadResearchReport?: () => void | Promise<void>;
  researchDownloadBusy?: boolean;
};

export function PptExportCard({
  pptExport,
  visualization,
  onDownloadResearchReport,
  researchDownloadBusy = false,
}: PptExportCardProps) {
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    return () => {
      if (pptExport.blobUrl) {
        URL.revokeObjectURL(pptExport.blobUrl);
      }
    };
  }, [pptExport.blobUrl]);

  const handleDownload = useCallback(async () => {
    if (pptExport.exportKind === "research_report") {
      if (onDownloadResearchReport) {
        await onDownloadResearchReport();
      } else {
        const { dispatchResearchPptExport } = await import(
          "@/lib/workbench/workbenchChatHandoff"
        );
        dispatchResearchPptExport();
      }
      return;
    }
    if (pptExport.blobUrl) {
      const a = document.createElement("a");
      a.href = pptExport.blobUrl;
      a.download = `${pptExport.title.replace(/[^a-z0-9]/gi, "_")}.pptx`;
      a.click();
      return;
    }
    if (pptExport.exportContent && visualization) {
      await writeChatVizExportToPptFile(
        pptExport.exportContent,
        pptExport.title,
      );
      return;
    }
    if (visualization && pptExport.messageId) {
      await exportAssistantVisualizationAsPpt({
        viz: visualization,
        title: pptExport.title,
        messageId: pptExport.messageId,
        download: true,
      });
    }
  }, [pptExport, visualization, onDownloadResearchReport]);

  const isBusy =
    pptExport.status === "building" || researchDownloadBusy;

  if (pptExport.status === "building") {
    return (
      <div
        className="mx-4 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-orange-200/80 bg-orange-50/80 px-4 py-3 dark:border-orange-900/50 dark:bg-orange-950/30"
        data-testid="cohi-ppt-export-card"
      >
        <Presentation className="h-4 w-4 text-orange-600 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">
            {pptExport.title}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {pptExport.exportKind === "research_report"
              ? "Research in progress — PowerPoint will be ready when the report finishes"
              : "Preparing presentation…"}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          className="h-8 bg-orange-600/60 text-white"
          disabled
          data-testid="cohi-ppt-export-download"
        >
          <Download className="h-3.5 w-3.5 mr-1.5" />
          Download
        </Button>
      </div>
    );
  }

  if (pptExport.status === "error") {
    return (
      <div className="mx-4 mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
        {pptExport.errorMessage ?? "Could not build presentation."}
      </div>
    );
  }

  return (
    <>
      <div
        className="mx-4 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-orange-200/80 bg-orange-50/80 px-4 py-3 dark:border-orange-900/50 dark:bg-orange-950/30"
        data-testid="cohi-ppt-export-card"
      >
        <Presentation className="h-4 w-4 text-orange-600 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">
            {pptExport.title}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {pptExport.exportKind === "research_report"
              ? pptExport.slideCount > 0
                ? `${pptExport.slideCount} slides · full report`
                : "Full report"
              : pptExport.slideCount > 0
                ? `${pptExport.slideCount} slide${pptExport.slideCount === 1 ? "" : "s"}`
                : "Presentation ready"}
            {pptExport.chartEmbedded ? " · chart included" : ""}
          </p>
        </div>
        {/* Preview UI hidden for v1; keep modal implementation below for later. */}
        <Button
          type="button"
          size="sm"
          className="h-8 bg-orange-600 hover:bg-orange-700 text-white"
          onClick={() => void handleDownload()}
          disabled={isBusy}
          data-testid="cohi-ppt-export-download"
        >
          <Download className="h-3.5 w-3.5 mr-1.5" />
          Download
        </Button>
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{pptExport.title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            {pptExport.exportContent?.description && (
              <p className="text-slate-600 dark:text-slate-300">
                {pptExport.exportContent.description}
              </p>
            )}
            {pptExport.exportContent?.chartImageDataUrl ? (
              <img
                src={pptExport.exportContent.chartImageDataUrl}
                alt="Chart preview"
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700"
              />
            ) : (
              <p className="text-slate-500 italic text-center py-6">
                Chart preview unavailable — data tables are included in the
                downloaded file.
              </p>
            )}
            {pptExport.exportContent?.tablePages.map((page) => (
              <div key={page.slideTitle}>
                <p className="font-medium text-slate-800 dark:text-slate-100 mb-1">
                  {page.slideTitle}
                </p>
                <p className="text-xs text-slate-500 mb-2">{page.rangeLabel}</p>
                <div className="overflow-x-auto rounded border border-slate-200 dark:border-slate-700">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-100 dark:bg-slate-800">
                        {page.columns.map((col) => (
                          <th
                            key={col.key}
                            className="px-2 py-1 text-left font-medium"
                          >
                            {col.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {page.rows.slice(0, 8).map((row, ri) => (
                        <tr key={ri} className="border-t border-slate-100">
                          {page.columns.map((col) => (
                            <td key={col.key} className="px-2 py-1">
                              {String(row[col.key] ?? "")}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {page.rows.length > 8 && (
                    <p className="text-xs text-slate-400 px-2 py-1">
                      +{page.rows.length - 8} more rows in download
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
