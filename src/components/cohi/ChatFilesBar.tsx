/**
 * "Files in this chat" — shows datasets linked to the current conversation.
 */

import { Database, X } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import type { ResearchUpload } from "@/hooks/useResearchUploads";

export interface ChatFilesBarProps {
  uploads: ResearchUpload[];
  attachedUploadIds: string[];
  onDetach: (uploadId: string) => void;
  disabled?: boolean;
  className?: string;
}

export function ChatFilesBar({
  uploads,
  attachedUploadIds,
  onDetach,
  disabled = false,
  className,
}: ChatFilesBarProps) {
  const attached = uploads.filter((u) => attachedUploadIds.includes(u.id));
  const missingIds = attachedUploadIds.filter(
    (id) => !attached.some((u) => u.id === id),
  );

  if (attachedUploadIds.length === 0) return null;

  return (
    <div
      className={cn(
        "px-4 sm:px-5 py-2 border-b border-emerald-100/80 dark:border-emerald-900/40 bg-emerald-50/40 dark:bg-emerald-950/20",
        className,
      )}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700/80 dark:text-emerald-400/80 mb-1.5">
        Files in this chat
      </p>
      <div className="flex flex-wrap gap-1.5 items-center">
        {attached.map((u) => (
          <span
            key={u.id}
            className="inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-full bg-white/80 dark:bg-slate-900/60 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-200"
          >
            <Database className="h-3 w-3 flex-shrink-0" />
            <span className="max-w-[180px] truncate">{u.originalFileName}</span>
            <span className="text-emerald-600/70 dark:text-emerald-400/60 tabular-nums">
              {u.rowCount.toLocaleString()}r
            </span>
            {!disabled && (
              <button
                type="button"
                title="Remove from this chat"
                onClick={() => onDetach(u.id)}
                className="ml-0.5 rounded-full p-0.5 hover:bg-emerald-100 dark:hover:bg-emerald-900 transition-colors"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            )}
          </span>
        ))}
        {missingIds.map((id) => (
          <span
            key={id}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-slate-200 dark:border-slate-700 text-xs text-slate-500"
          >
            Dataset {id.slice(0, 8)}…
            {!disabled && (
              <button type="button" onClick={() => onDetach(id)} className="p-0.5">
                <X className="h-2.5 w-2.5" />
              </button>
            )}
          </span>
        ))}
        <Link
          to="/research/data-explorer"
          className="text-[11px] text-emerald-700 dark:text-emerald-400 hover:underline ml-1"
        >
          Data Explorer
        </Link>
      </div>
    </div>
  );
}
