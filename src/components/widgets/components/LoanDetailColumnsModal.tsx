/**
 * Modal to edit Loan Detail table columns (workbench only).
 * Simple two even columns: Column name (text box), Field (dropdown). Long dropdown values truncate with "...".
 */

import React, { useState, useEffect, useCallback, useMemo, memo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { X } from 'lucide-react';
import { useLoanDetailColumnsStore, type SavedLoanDetailColumn } from '@/stores/loanDetailColumnsStore';
import {
  DEFAULT_LOAN_DETAIL_COLUMNS,
  type ColumnDef,
} from '@/components/views/LoanDetailView';
import { api } from '@/lib/api';

const NONE_FIELD_VALUE = '__none__';

const MODAL_STYLES = `
.loan-detail-cols-wrap { width: 100%; max-width: 100%; overflow-x: hidden; min-width: 0; }
.loan-detail-cols-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; gap: 0.5rem; align-items: center; width: 100%; min-width: 0; }
.loan-detail-cols-field { min-width: 0; max-width: 100%; overflow: hidden; }
.loan-detail-cols-field-trigger { min-width: 0 !important; max-width: 100% !important; overflow: hidden !important; }
.loan-detail-cols-field-trigger > span { overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; display: block !important; min-width: 0 !important; }
.loan-detail-cols-dropdown { max-width: 280px !important; overflow: hidden; }
.loan-detail-cols-dropdown [data-radix-select-viewport] { min-width: 0 !important; }
.loan-detail-cols-dropdown [data-radix-select-item] { min-width: 0; overflow: hidden; }
.loan-detail-cols-dropdown [data-radix-select-item] > *:last-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
.loan-detail-cols-dropdown .loan-detail-cols-option-text { display: block !important; max-width: 240px !important; min-width: 0 !important; overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; }
`;

function getFallbackFieldOptions(): { value: string; label: string }[] {
  const fields = new Set<string>();
  DEFAULT_LOAN_DETAIL_COLUMNS.forEach((c) => {
    if (c.field) fields.add(c.field);
  });
  return [
    { value: NONE_FIELD_VALUE, label: '— None / Calculated' },
    ...Array.from(fields).sort().map((name) => ({ value: name, label: name })),
  ];
}

function toSaved(c: ColumnDef): SavedLoanDetailColumn {
  return { id: c.id, label: c.label, field: c.field };
}

type FieldOption = { value: string; label: string };

const ColumnRow = memo(function ColumnRow({
  row,
  index,
  fieldOptions,
  onUpdate,
  onRemove,
}: {
  row: SavedLoanDetailColumn;
  index: number;
  fieldOptions: FieldOption[];
  onUpdate: (index: number, patch: Partial<SavedLoanDetailColumn>) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="loan-detail-cols-row gap-2">
      <Input
        value={row.label}
        onChange={(e) => onUpdate(index, { label: e.target.value })}
        placeholder="Column name"
        className="min-w-0"
      />
      <div className="loan-detail-cols-field min-w-0">
        <Select
          value={row.field ?? NONE_FIELD_VALUE}
          onValueChange={(v) => onUpdate(index, { field: v === NONE_FIELD_VALUE ? null : v })}
        >
          <SelectTrigger className="loan-detail-cols-field-trigger h-9 min-w-0 w-full">
            <SelectValue placeholder="— None / Calculated" />
          </SelectTrigger>
          <SelectContent className="loan-detail-cols-dropdown">
            {fieldOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value} className="min-w-0">
                <span className="loan-detail-cols-option-text truncate block">{opt.label}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <button
        type="button"
        onClick={() => onRemove(index)}
        className="p-2 rounded hover:bg-muted text-muted-foreground hover:text-destructive"
        aria-label="Remove column"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
});

export interface LoanDetailColumnsModalProps {
  open: boolean;
  onClose: () => void;
  canvasItemId: string;
  tenantId?: string | null;
}

export function LoanDetailColumnsModal({
  open,
  onClose,
  canvasItemId,
  tenantId,
}: LoanDetailColumnsModalProps) {
  const getColumns = useLoanDetailColumnsStore((s) => s.getColumns);
  const setColumns = useLoanDetailColumnsStore((s) => s.setColumns);

  const [draft, setDraft] = useState<SavedLoanDetailColumn[]>([]);
  const [fieldOptions, setFieldOptions] = useState<{ value: string; label: string }[]>(() => getFallbackFieldOptions());

  useEffect(() => {
    if (open) {
      const saved = getColumns(canvasItemId);
      const defaultSaved = DEFAULT_LOAN_DETAIL_COLUMNS.map(toSaved);
      setDraft(saved?.length ? saved.map((c) => ({ ...c })) : defaultSaved.map((c) => ({ ...c })));
    }
  }, [open, canvasItemId, getColumns]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const qs = tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : '';
    api
      .request<{ columns: { name: string }[] }>(`/api/loans/schema${qs}`)
      .then((data) => {
        if (cancelled || !data?.columns?.length) return;
        setFieldOptions([
          { value: NONE_FIELD_VALUE, label: '— None / Calculated' },
          ...data.columns.map((c) => ({ value: c.name, label: c.name })),
        ]);
      })
      .catch(() => {
        if (!cancelled) setFieldOptions(getFallbackFieldOptions());
      });
    return () => { cancelled = true; };
  }, [open, tenantId]);

  const updateRow = useCallback((index: number, patch: Partial<SavedLoanDetailColumn>) => {
    setDraft((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  }, []);

  const removeRow = useCallback((index: number) => {
    setDraft((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const addColumn = useCallback(() => {
    setDraft((prev) => [
      ...prev,
      { id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`, label: '', field: null },
    ]);
  }, []);

  const resetToDefault = useCallback(() => {
    setDraft(DEFAULT_LOAN_DETAIL_COLUMNS.map(toSaved).map((c) => ({ ...c })));
  }, []);

  const handleSave = useCallback(() => {
    const valid = draft.filter((r) => r.label.trim() !== '');
    if (valid.length === 0) return;
    setColumns(canvasItemId, valid);
    onClose();
  }, [canvasItemId, draft, setColumns, onClose]);

  const hasValidColumns = useMemo(
    () => draft.some((r) => r.label.trim() !== ''),
    [draft],
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <style>{MODAL_STYLES}</style>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col overflow-x-hidden" hideCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Edit Loan Detail columns</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Edit the column name and choose which data field populates it. Long field names are truncated with "...".
        </p>

        <div className="loan-detail-cols-wrap flex flex-col flex-1 min-h-0 overflow-y-auto border rounded-lg p-3 space-y-2">
          <div className="loan-detail-cols-row text-xs font-medium text-muted-foreground">
            <span>Column name</span>
            <span>Field</span>
            <span className="w-8" aria-hidden />
          </div>
          {draft.map((row, index) => (
            <ColumnRow
              key={row.id}
              row={row}
              index={index}
              fieldOptions={fieldOptions}
              onUpdate={updateRow}
              onRemove={removeRow}
            />
          ))}
        </div>

        <Button type="button" variant="outline" size="sm" onClick={addColumn}>
          Add column
        </Button>

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
              disabled={!hasValidColumns}
            >
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
