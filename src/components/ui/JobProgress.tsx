import React from "react";
import { Progress } from "@/components/ui/progress";
import { Loader2, CheckCircle2, XCircle, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { JobStatus } from "@/hooks/useJobStatus";

interface JobProgressProps {
  status: JobStatus["status"];
  progress: number;
  message?: string;
  error?: string;
  onRetry?: () => void;
  className?: string;
}

export function JobProgress({
  status,
  progress,
  message,
  error,
  onRetry,
  className,
}: JobProgressProps) {
  if (status === "idle") return null;

  return (
    <div className={cn("flex flex-col gap-2 w-full", className)}>
      {status === "processing" && (
        <>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{message || "Processing..."}</span>
            <span className="ml-auto font-medium tabular-nums">
              {Math.round(progress)}%
            </span>
          </div>
          <Progress value={progress} className="h-2" />
        </>
      )}

      {status === "complete" && (
        <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-4 w-4" />
          <span>Complete</span>
        </div>
      )}

      {status === "failed" && (
        <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
          <XCircle className="h-4 w-4" />
          <span className="flex-1">{error || "Something went wrong"}</span>
          {onRetry && (
            <button
              onClick={onRetry}
              className="inline-flex items-center gap-1 text-xs font-medium underline hover:no-underline"
            >
              <RotateCw className="h-3 w-3" />
              Retry
            </button>
          )}
        </div>
      )}
    </div>
  );
}
