/**
 * Modal to choose which columns are visible in the workbench Actors tables.
 * Lists predefined columns with checkboxes to add/remove. Order is fixed for now.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ACTORS_TABLE_DEFAULT_COLUMN_IDS } from '@/stores/widgetSectionStore';
import { cn } from '@/lib/utils';

const ACTORS_TABLE_COLUMN_LABELS: Record<string, string> = {
  name: 'Actor',
  units: 'Units',
  volume: 'Volume',
  avgAppToFund: 'Turn time (Avg/Median App to Fund or Closing)',
  approvalPct: 'Approval %',
  deniedPct: 'Denied %',
  withdrawnPct: 'Withdrawn %',
  loanComplexity: 'Complexity',
};

export interface ActorsTableColumnsModalProps {
  open: boolean;
  onClose: () => void;
  sectionId: string;
  /** Current ordered list of visible column ids (from section filters). Empty = all default. */
  columnIds: string[];
  onSave: (sectionId: string, columnIds: string[]) => void;
}

export function ActorsTableColumnsModal({
  open,
  onClose,
  sectionId,
  columnIds,
  onSave,
}: ActorsTableColumnsModalProps) {
  const defaultIds = [...ACTORS_TABLE_DEFAULT_COLUMN_IDS];
  const currentSet = new Set(columnIds?.length ? columnIds : defaultIds);

  const [draft, setDraft] = useState<{ id: string; label: string; visible: boolean }[]>(() =>
    defaultIds.map((id) => ({
      id,
      label: ACTORS_TABLE_COLUMN_LABELS[id] ?? id,
      visible: currentSet.has(id),
    }))
  );

  useEffect(() => {
    if (open) {
      const ids = columnIds?.length ? columnIds : defaultIds;
      const set = new Set(ids);
      setDraft(
        defaultIds.map((id) => ({
          id,
          label: ACTORS_TABLE_COLUMN_LABELS[id] ?? id,
          visible: set.has(id),
        }))
      );
    }
  }, [open, sectionId, columnIds]);

  const toggle = useCallback((index: number) => {
    setDraft((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], visible: !next[index].visible };
      return next;
    });
  }, []);

  const resetToDefault = useCallback(() => {
    setDraft(
      defaultIds.map((id) => ({
        id,
        label: ACTORS_TABLE_COLUMN_LABELS[id] ?? id,
        visible: true,
      }))
    );
  }, []);

  const handleSave = useCallback(() => {
    const visibleIds = draft.filter((d) => d.visible).map((d) => d.id);
    onSave(sectionId, visibleIds.length ? visibleIds : [...defaultIds]);
    onClose();
  }, [draft, sectionId, defaultIds, onSave, onClose]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col overflow-x-hidden" hideCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Actors table columns</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Choose which columns to show in the Actor tables. All columns are listed below.
        </p>

        <div className="flex flex-col flex-1 min-h-0 overflow-y-auto border rounded-lg p-3 space-y-2">
          {draft.map((row, index) => (
            <label
              key={row.id}
              className={cn(
                'flex items-center gap-3 py-2 px-2 rounded-md hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer'
              )}
            >
              <Checkbox
                checked={row.visible}
                onCheckedChange={() => toggle(index)}
                aria-label={`Toggle ${row.label}`}
              />
              <span className="text-sm text-slate-700 dark:text-slate-300">{row.label}</span>
            </label>
          ))}
        </div>

        <div className="flex justify-between gap-4 pt-2 border-t">
          <Button type="button" variant="ghost" size="sm" onClick={resetToDefault}>
            Reset to default
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={handleSave}>
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
