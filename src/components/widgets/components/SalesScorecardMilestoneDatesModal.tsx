/**
 * Modal to select which milestone dates to show on the Sales Scorecard Overview chart and table.
 * Fetches all milestone dates from the API and lets users check/uncheck to include or exclude them.
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useWorkflowMilestones } from "@/hooks/useWorkflowMilestones";
import { Loader2 } from "lucide-react";

export const DEFAULT_SALES_SCORECARD_MILESTONE_COLUMNS = [
  "started_date",
  "application_date",
  "lock_date",
  "closing_date",
  "funding_date",
] as const;

/** Max milestone dates allowed (URL length and backend performance). */
export const MAX_MILESTONE_DATES = 20;

export type DefaultMilestoneColumn = (typeof DEFAULT_SALES_SCORECARD_MILESTONE_COLUMNS)[number];

export interface SalesScorecardMilestoneDatesModalProps {
  open: boolean;
  onClose: () => void;
  /** Currently selected milestone column names (e.g. started_date, application_date). */
  selectedColumns: string[];
  /** Called when user saves with the new selection. */
  onSave: (columns: string[]) => void;
  /** Tenant id for fetching milestones. */
  tenantId: string | null;
}

export function SalesScorecardMilestoneDatesModal({
  open,
  onClose,
  selectedColumns,
  onSave,
  tenantId,
}: SalesScorecardMilestoneDatesModalProps) {
  const { milestones, loading, error } = useWorkflowMilestones(tenantId);
  const [draft, setDraft] = useState<Set<string>>(new Set(selectedColumns));

  useEffect(() => {
    if (open) {
      setDraft(new Set(selectedColumns));
    }
  }, [open, selectedColumns]);

  const toggle = useCallback((column: string) => {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(column)) next.delete(column);
      else next.add(column);
      return next;
    });
  }, []);

  const resetToDefault = useCallback(() => {
    setDraft(new Set(DEFAULT_SALES_SCORECARD_MILESTONE_COLUMNS));
  }, []);

  const handleSave = useCallback(() => {
    onSave(Array.from(draft));
    onClose();
  }, [draft, onSave, onClose]);

  const sortedMilestones = [...milestones].sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: "base" })
  );

  const overLimit = draft.size > MAX_MILESTONE_DATES;
  const canSave = !loading && draft.size > 0 && !overLimit;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Milestone Dates</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Check or uncheck milestone dates to include or remove them from the chart and table.
        </p>

        {error && (
          <div className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200 px-3 py-2 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto border rounded-lg p-2 max-h-[50vh] space-y-1">
            {sortedMilestones.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No milestone dates found.
              </p>
            ) : (
              sortedMilestones.map((m) => (
                <label
                  key={m.column}
                  className="flex items-center gap-3 py-2 px-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800/50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={draft.has(m.column)}
                    onChange={() => toggle(m.column)}
                    className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-violet-600 focus:ring-violet-500"
                  />
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    {m.label}
                  </span>
                  <span className="text-xs text-muted-foreground font-mono truncate" title={m.column}>
                    {m.column}
                  </span>
                </label>
              ))
            )}
          </div>
        )}

        {overLimit && (
          <p className="text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
            Max limit of {MAX_MILESTONE_DATES} milestone dates. Please select fewer dates.
          </p>
        )}

        <div className="flex justify-between gap-4 pt-2 border-t">
          <Button type="button" variant="ghost" size="sm" onClick={resetToDefault}>
            Reset to default
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={!canSave}
            >
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
