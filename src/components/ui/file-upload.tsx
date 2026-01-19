import * as React from 'react';
import { useCallback, useState } from 'react';
import { Upload, X, FileText, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FileUploadProps {
  onFileSelect: (file: File) => void;
  onRemove?: () => void;
  acceptedFileTypes?: string;
  maxSize?: number; // in MB
  className?: string;
  disabled?: boolean;
  value?: File | null;
}

export const FileUpload = React.forwardRef<HTMLInputElement, FileUploadProps>(
  ({ onFileSelect, onRemove, acceptedFileTypes = '.csv', maxSize = 250, className, disabled, value }, ref) => {
    const [isDragging, setIsDragging] = useState(false);
    const [isUploading, setIsUploading] = useState(false);

    const handleDragOver = useCallback((e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!disabled) {
        setIsDragging(true);
      }
    }, [disabled]);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      if (disabled) return;

      const files = Array.from(e.dataTransfer.files);
      const file = files.find(f => f.name.endsWith('.csv'));

      if (file) {
        if (file.size > maxSize * 1024 * 1024) {
          alert(`File size exceeds ${maxSize}MB limit`);
          return;
        }
        onFileSelect(file);
      }
    }, [disabled, maxSize, onFileSelect]);

    const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        if (file.size > maxSize * 1024 * 1024) {
          alert(`File size exceeds ${maxSize}MB limit`);
          return;
        }
        onFileSelect(file);
      }
    }, [maxSize, onFileSelect]);

    return (
      <div className={cn('w-full', className)}>
        {!value ? (
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={cn(
              'relative flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer transition-colors',
              isDragging
                ? 'border-primary bg-primary/5'
                : 'border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/30 hover:bg-slate-100 dark:hover:bg-slate-800/50',
              disabled && 'opacity-50 cursor-not-allowed'
            )}
          >
            <input
              ref={ref}
              type="file"
              accept={acceptedFileTypes}
              onChange={handleFileInput}
              disabled={disabled}
              className="absolute top-0 right-0 bottom-0 w-full h-full opacity-0 cursor-pointer"
            />
            <div className="flex flex-col items-center justify-center pt-5 pb-6">
              <Upload className={cn('w-10 h-10 mb-3', isDragging ? 'text-primary' : 'text-slate-400')} />
              <p className="mb-2 text-sm text-slate-500 dark:text-slate-400 font-light">
                <span className="font-medium">Click to upload</span> or drag and drop
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-500 font-light">
                CSV file (MAX. {maxSize}MB)
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between p-4 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800/30">
            <div className="flex items-center gap-3">
              <FileText className="h-8 w-8 text-slate-400" />
              <div>
                <p className="text-sm font-light text-slate-900 dark:text-white">{value.name}</p>
                <p className="text-xs text-slate-500 dark:text-slate-500 font-light">
                  {(value.size / 1024).toFixed(2)} KB
                </p>
              </div>
            </div>
            {onRemove && (
              <button
                type="button"
                onClick={onRemove}
                disabled={disabled || isUploading}
                className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
      </div>
    );
  }
);
FileUpload.displayName = 'FileUpload';
