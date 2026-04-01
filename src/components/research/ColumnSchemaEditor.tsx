/**
 * ColumnSchemaEditor
 * Lets users override inferred column types and add descriptions for AI context.
 */

import { useState } from "react";
import { AlertTriangle, ChevronDown, Check, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ColumnMeta, InferredColumnType } from "@/hooks/useResearchUploads";

const COLUMN_TYPES: { value: InferredColumnType; label: string }[] = [
  { value: "string", label: "Text" },
  { value: "number", label: "Number" },
  { value: "currency", label: "Currency ($)" },
  { value: "percentage", label: "Percentage (%)" },
  { value: "date", label: "Date" },
  { value: "boolean", label: "Boolean (Yes/No)" },
];

const TYPE_COLORS: Record<InferredColumnType, string> = {
  number:     "text-blue-600 dark:text-blue-400",
  currency:   "text-emerald-600 dark:text-emerald-400",
  percentage: "text-teal-600 dark:text-teal-400",
  date:       "text-violet-600 dark:text-violet-400",
  boolean:    "text-orange-600 dark:text-orange-400",
  string:     "text-slate-500 dark:text-slate-400",
};

interface ColumnSchemaEditorProps {
  columns: ColumnMeta[];
  onChange: (updates: Partial<ColumnMeta>[]) => void;
  disabled?: boolean;
  className?: string;
}

export function ColumnSchemaEditor({ columns, onChange, disabled, className }: ColumnSchemaEditorProps) {
  const [localCols, setLocalCols] = useState<ColumnMeta[]>(columns);
  const [hasChanges, setHasChanges] = useState(false);

  function handleTypeChange(colName: string, type: InferredColumnType) {
    setLocalCols((prev) => prev.map((c) =>
      c.name === colName ? { ...c, userOverrideType: type } : c
    ));
    setHasChanges(true);
  }

  function handleDescriptionChange(colName: string, description: string) {
    setLocalCols((prev) => prev.map((c) =>
      c.name === colName ? { ...c, description } : c
    ));
    setHasChanges(true);
  }

  function handleSave() {
    onChange(localCols.map((c) => ({
      name: c.name,
      userOverrideType: c.userOverrideType,
      description: c.description,
    })));
    setHasChanges(false);
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Column Schema</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Override detected types and add descriptions to improve AI analysis.
          </p>
        </div>
        {hasChanges && (
          <button
            onClick={handleSave}
            disabled={disabled}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-colors disabled:opacity-50"
          >
            <Check className="w-3.5 h-3.5" />
            Save Changes
          </button>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="grid grid-cols-[auto_140px_1fr] text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 px-3 py-2 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
          <span>Column</span>
          <span>Type</span>
          <span>Description for AI</span>
        </div>

        {localCols.map((col, idx) => {
          const activeType = col.userOverrideType || col.inferredType;
          const isOverridden = !!col.userOverrideType && col.userOverrideType !== col.inferredType;
          return (
            <div
              key={col.name}
              className={cn(
                "grid grid-cols-[auto_140px_1fr] items-center gap-3 px-3 py-2 border-b border-slate-100 dark:border-slate-800 last:border-0",
                idx % 2 === 0 ? "bg-white dark:bg-slate-900" : "bg-slate-50/40 dark:bg-slate-800/20"
              )}
            >
              {/* Column name */}
              <div className="min-w-0 flex items-center gap-1.5">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate max-w-[120px]" title={col.displayName}>
                  {col.displayName}
                </span>
                {col.isPotentialPii && (
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" title="Column may contain PII" />
                )}
                {isOverridden && (
                  <Info className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" title={`Originally detected as: ${col.inferredType}`} />
                )}
              </div>

              {/* Type selector */}
              <div className="relative">
                <select
                  value={activeType}
                  onChange={(e) => handleTypeChange(col.name, e.target.value as InferredColumnType)}
                  disabled={disabled}
                  className={cn(
                    "w-full appearance-none text-xs px-2 py-1.5 pr-6 rounded-lg border border-slate-200 dark:border-slate-700",
                    "bg-white dark:bg-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-400 transition-colors",
                    "disabled:opacity-50 disabled:cursor-not-allowed",
                    TYPE_COLORS[activeType]
                  )}
                >
                  {COLUMN_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400 pointer-events-none" />
              </div>

              {/* Description */}
              <input
                type="text"
                value={col.description || ""}
                onChange={(e) => handleDescriptionChange(col.name, e.target.value)}
                disabled={disabled}
                placeholder="e.g. Annual revenue in USD, one row per salesperson"
                className="text-xs px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 placeholder:text-slate-300 dark:placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-emerald-400 disabled:opacity-50"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
