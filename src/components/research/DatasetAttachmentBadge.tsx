/**
 * DatasetAttachmentBadge
 * Compact badge shown in the Research Analyst when uploads are attached to the session.
 */

import { Database, X, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ResearchUpload } from "@/hooks/useResearchUploads";

interface DatasetAttachmentBadgeProps {
  upload: ResearchUpload;
  onRemove?: () => void;
  compact?: boolean;
  className?: string;
}

export function DatasetAttachmentBadge({
  upload,
  onRemove,
  compact = false,
  className,
}: DatasetAttachmentBadgeProps) {
  const hasPii = upload.columns?.some((c) => c.isPotentialPii);
  const storageLabel = upload.storageStrategy === "table" ? "SQL" : "Context";

  if (compact) {
    return (
      <div className={cn(
        "inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium",
        "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400",
        "border border-emerald-200 dark:border-emerald-800",
        className
      )}>
        <Database className="w-3 h-3" />
        <span className="truncate max-w-[120px]">{upload.originalFileName}</span>
        {onRemove && (
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            className="ml-0.5 rounded-full hover:bg-emerald-100 dark:hover:bg-emerald-900/50 p-0.5 transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={cn(
      "flex items-start gap-3 p-3 rounded-xl border",
      "bg-emerald-50/50 dark:bg-emerald-950/10 border-emerald-200 dark:border-emerald-800/50",
      className
    )}>
      <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex-shrink-0">
        <Database className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 truncate">
            {upload.originalFileName}
          </p>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 font-medium flex-shrink-0">
            {storageLabel}
          </span>
          {hasPii && (
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" title="PII warning" />
          )}
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          {upload.rowCount.toLocaleString()} rows · {upload.columnCount} columns
          {upload.tableName && (
            <> · table: <code className="font-mono text-[10px]">{upload.tableName}</code></>
          )}
        </p>
      </div>
      {onRemove && (
        <button
          onClick={onRemove}
          className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors flex-shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

// Multi-badge compact strip
interface DatasetAttachmentStripProps {
  uploads: ResearchUpload[];
  onRemove?: (id: string) => void;
  className?: string;
}

export function DatasetAttachmentStrip({ uploads, onRemove, className }: DatasetAttachmentStripProps) {
  if (uploads.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {uploads.map((u) => (
        <DatasetAttachmentBadge
          key={u.id}
          upload={u}
          compact
          onRemove={onRemove ? () => onRemove(u.id) : undefined}
        />
      ))}
    </div>
  );
}
