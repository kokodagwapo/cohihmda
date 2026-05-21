/**
 * CSV dataset attach UI for unified research chat (reused from Research Lab).
 */

import { useState } from "react";
import { AlertCircle, Check, Database, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { UploadDropZone } from "@/components/research/UploadDropZone";
import { useResearchUploads } from "@/hooks/useResearchUploads";

export interface DatasetAttachPanelProps {
  tenantId?: string;
  attachedUploadIds: string[];
  onAttachedUploadIdsChange: (ids: string[]) => void;
  disabled?: boolean;
  className?: string;
}

/** Shared CSV attach UI for chat, workbench, and research modes. */
export function DatasetAttachPanel({
  tenantId,
  attachedUploadIds,
  onAttachedUploadIdsChange,
  disabled = false,
  className,
}: DatasetAttachPanelProps) {
  const {
    uploads: availableUploads,
    listUploads: listAvailableUploads,
    uploadFile,
    isUploading,
    uploadProgress,
    error: uploadError,
    setError: setUploadError,
  } = useResearchUploads(tenantId);

  const [showUploadPanel, setShowUploadPanel] = useState(false);
  const attachedUploads = availableUploads.filter((u) =>
    attachedUploadIds.includes(u.id),
  );

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setShowUploadPanel((v) => !v);
            if (!showUploadPanel) void listAvailableUploads();
          }}
          className={cn(
            "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors",
            showUploadPanel
              ? "border-emerald-400 dark:border-emerald-600 text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/30"
              : "border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-400 dark:hover:border-slate-500",
            disabled && "opacity-50 pointer-events-none",
          )}
        >
          <Upload className="h-3.5 w-3.5" />
          {attachedUploadIds.length > 0
            ? `${attachedUploadIds.length} CSV${attachedUploadIds.length > 1 ? "s" : ""} attached`
            : "Upload CSV"}
        </button>
      </div>

      {attachedUploads.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {attachedUploads.map((u) => (
            <span
              key={u.id}
              className="inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-700 dark:text-emerald-300"
            >
              <Database className="h-3 w-3 flex-shrink-0" />
              <span className="max-w-[160px] truncate">{u.originalFileName}</span>
              <span className="text-emerald-500/70">{u.rowCount.toLocaleString()}r</span>
              {!disabled && (
                <button
                  type="button"
                  onClick={() =>
                    onAttachedUploadIdsChange(
                      attachedUploadIds.filter((i) => i !== u.id),
                    )
                  }
                  className="ml-0.5 rounded-full p-0.5 hover:bg-emerald-200 dark:hover:bg-emerald-800 transition-colors"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {showUploadPanel && !disabled && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30 p-3 space-y-3">
          <UploadDropZone
            onFileSelected={async (file) => {
              setUploadError(null);
              const result = await uploadFile(file);
              if (result) {
                onAttachedUploadIdsChange([...attachedUploadIds, result.id]);
              }
            }}
            isUploading={isUploading}
            uploadProgress={uploadProgress}
          />

          {uploadError && (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 px-3 py-2">
              <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-red-700 dark:text-red-400">{uploadError}</p>
            </div>
          )}

          {availableUploads.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide px-1">
                Your uploads
              </p>
              {availableUploads.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() =>
                    onAttachedUploadIdsChange(
                      attachedUploadIds.includes(u.id)
                        ? attachedUploadIds.filter((i) => i !== u.id)
                        : [...attachedUploadIds, u.id],
                    )
                  }
                  className={cn(
                    "w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded-lg transition-colors text-left",
                    attachedUploadIds.includes(u.id)
                      ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                      : "hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300",
                  )}
                >
                  <Database className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="flex-1 truncate">{u.originalFileName}</span>
                  <span className="text-slate-400 tabular-nums">
                    {u.rowCount.toLocaleString()} rows
                  </span>
                  {attachedUploadIds.includes(u.id) && (
                    <Check className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** @deprecated Use DatasetAttachPanel */
export type ResearchDatasetAttachPanelProps = DatasetAttachPanelProps;
/** @deprecated Use DatasetAttachPanel */
export const ResearchDatasetAttachPanel = DatasetAttachPanel;
