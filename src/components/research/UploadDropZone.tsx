/**
 * UploadDropZone
 * Drag-and-drop file upload zone for Research Lab / Data Explorer.
 * Accepts CSV and TSV files; validates type and size client-side before upload.
 */

import { useCallback, useState, useRef } from "react";
import { Upload, FileText, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const MAX_FILE_SIZE_MB = 50;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const ACCEPTED_EXTENSIONS = [".csv", ".tsv", ".txt"];
const ACCEPTED_MIME = ["text/csv", "text/plain", "text/tab-separated-values", "application/octet-stream"];

interface UploadDropZoneProps {
  onFileSelected: (file: File) => void;
  isUploading?: boolean;
  uploadProgress?: number;
  disabled?: boolean;
  className?: string;
}

export function UploadDropZone({
  onFileSelected,
  isUploading = false,
  uploadProgress = 0,
  disabled = false,
  className,
}: UploadDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function validateFile(file: File): string | null {
    const ext = "." + file.name.split(".").pop()?.toLowerCase();
    const isValidExt = ACCEPTED_EXTENSIONS.includes(ext);
    const isValidMime = ACCEPTED_MIME.includes(file.type) || file.type === "";
    if (!isValidExt && !isValidMime) {
      return `Unsupported file type. Please upload a CSV or TSV file.`;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return `File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum allowed: ${MAX_FILE_SIZE_MB} MB.`;
    }
    if (file.size === 0) {
      return "File is empty.";
    }
    return null;
  }

  const handleFile = useCallback((file: File) => {
    const err = validateFile(file);
    if (err) {
      setValidationError(err);
      return;
    }
    setValidationError(null);
    onFileSelected(file);
  }, [onFileSelected]);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (disabled || isUploading) return;
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [disabled, isUploading, handleFile]);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!disabled && !isUploading) setIsDragging(true);
  }, [disabled, isUploading]);

  const handleDragLeave = useCallback(() => setIsDragging(false), []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // Reset so same file can be re-selected
    if (inputRef.current) inputRef.current.value = "";
  }, [handleFile]);

  return (
    <div className={cn("w-full", className)}>
      <div
        role="button"
        tabIndex={disabled || isUploading ? -1 : 0}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => !disabled && !isUploading && inputRef.current?.click()}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
        className={cn(
          "relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed transition-all duration-200 cursor-pointer select-none",
          "min-h-[180px] p-8 text-center",
          isDragging
            ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/20 scale-[1.01]"
            : "border-slate-300 dark:border-slate-600 hover:border-emerald-400 dark:hover:border-emerald-500 bg-slate-50/50 dark:bg-slate-800/30 hover:bg-emerald-50/40 dark:hover:bg-emerald-950/10",
          (disabled || isUploading) && "opacity-50 cursor-not-allowed pointer-events-none"
        )}
      >
        {isUploading ? (
          <>
            <div className="relative">
              <Loader2 className="w-10 h-10 text-emerald-500 animate-spin" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                Uploading...
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {uploadProgress}% complete
              </p>
            </div>
            {uploadProgress > 0 && (
              <div className="w-full max-w-xs h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            )}
          </>
        ) : (
          <>
            <div className={cn(
              "p-3 rounded-xl transition-colors",
              isDragging ? "bg-emerald-100 dark:bg-emerald-900/30" : "bg-slate-100 dark:bg-slate-700/50"
            )}>
              <Upload className={cn(
                "w-7 h-7 transition-colors",
                isDragging ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400 dark:text-slate-500"
              )} />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                {isDragging ? "Drop your file here" : "Drop a file or click to browse"}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                CSV or TSV up to {MAX_FILE_SIZE_MB} MB · up to 500,000 rows
              </p>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-slate-400 dark:text-slate-500">
              <FileText className="w-3.5 h-3.5" />
              <span>.csv &nbsp;·&nbsp; .tsv</span>
            </div>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.tsv,.txt"
          className="hidden"
          onChange={handleInputChange}
          disabled={disabled || isUploading}
        />
      </div>

      {validationError && (
        <div className="mt-2 flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 px-3 py-2">
          <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-red-700 dark:text-red-400">{validationError}</p>
        </div>
      )}
    </div>
  );
}
