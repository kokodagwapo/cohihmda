/**
 * Modal to edit Loan Detail table columns (workbench only).
 * Column name (text box) + Field dropdown with search and scroll (Popover + Command, like milestone dropdown).
 */

import React, { useState, useEffect, useCallback, useMemo, memo, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { X, ChevronsUpDown, Check } from 'lucide-react';
import { useLoanDetailColumnsStore, type SavedLoanDetailColumn } from '@/stores/loanDetailColumnsStore';
import {
  DEFAULT_LOAN_DETAIL_COLUMNS,
  type ColumnDef,
} from '@/components/views/LoanDetailView';
import { useAdditionalFieldColumns } from '@/hooks/useAdditionalFieldColumns';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

const NONE_FIELD_VALUE = '__none__';
/** Sentinel for "no field selected yet" on a new column; dropdown enabled so user can pick a real field. */
const BLANK_FIELD_VALUE = '__blank__';

const MODAL_STYLES = `
.loan-detail-cols-wrap { width: 100%; max-width: 100%; overflow-x: hidden; min-width: 0; }
.loan-detail-cols-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; gap: 0.5rem; align-items: center; width: 100%; min-width: 0; }
.loan-detail-cols-field { min-width: 0; max-width: 100%; overflow: hidden; }
.loan-detail-cols-field-trigger { min-width: 0 !important; max-width: 100% !important; overflow: hidden !important; justify-content: space-between; }
.loan-detail-cols-field-trigger > span { overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; display: block !important; min-width: 0 !important; }
`;

function getFallbackFieldOptions(): { value: string; label: string }[] {
  const fields = new Set<string>();
  DEFAULT_LOAN_DETAIL_COLUMNS.forEach((c) => {
    if (c.field) fields.add(c.field);
  });
  return Array.from(fields).sort().map((name) => ({ value: name, label: name }));
}

function toSaved(c: ColumnDef): SavedLoanDetailColumn {
  const raw = c.field;
  const field =
    raw === undefined || raw === BLANK_FIELD_VALUE
      ? BLANK_FIELD_VALUE
      : raw;
  return { id: c.id, label: c.label, field: field === BLANK_FIELD_VALUE ? BLANK_FIELD_VALUE : field };
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
  const [open, setOpen] = useState(false);
  const isCalculated = row.field === null;
  const isBlank = row.field === BLANK_FIELD_VALUE;
  const selectedLabel = isCalculated
    ? 'Calculated Value'
    : isBlank
      ? 'Select field...'
      : (row.field ? (fieldOptions.find((o) => o.value === row.field)?.label ?? row.field) : 'Select field...');
  const dropdownDisabled = isCalculated;
  const selectableOptions = fieldOptions.filter((o) => o.value !== NONE_FIELD_VALUE);
  return (
    <div className="loan-detail-cols-row gap-2">
      <Input
        value={row.label}
        onChange={(e) => onUpdate(index, { label: e.target.value })}
        placeholder="Column name"
        className="min-w-0"
      />
      <div className="loan-detail-cols-field min-w-0">
        <Popover open={open} onOpenChange={dropdownDisabled ? () => {} : setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              disabled={dropdownDisabled}
              className={cn(
                'loan-detail-cols-field-trigger h-9 min-w-0 w-full font-normal',
                dropdownDisabled && 'cursor-not-allowed opacity-60',
              )}
            >
              <span className="truncate">{selectedLabel}</span>
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[280px] p-0" align="start">
            <Command>
              <CommandInput placeholder="Search field..." />
              <CommandList className="max-h-[300px]">
                <CommandEmpty>No field found.</CommandEmpty>
                <CommandGroup>
                  {selectableOptions.map((opt) => (
                    <CommandItem
                      key={opt.value}
                      value={opt.label}
                      onSelect={() => {
                        onUpdate(index, { field: opt.value });
                        setOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          'mr-2 h-4 w-4 shrink-0',
                          row.field === opt.value ? 'opacity-100' : 'opacity-0',
                        )}
                      />
                      <span className="truncate">{opt.label}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
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
  const { columns: additionalColumns } = useAdditionalFieldColumns(tenantId ?? null);

  const [draft, setDraft] = useState<SavedLoanDetailColumn[]>([]);
  const [fieldOptions, setFieldOptions] = useState<{ value: string; label: string }[]>(() => getFallbackFieldOptions());
  const listWrapRef = useRef<HTMLDivElement>(null);

  const defaultColumnsWithAdditional = useMemo(
    () =>
      DEFAULT_LOAN_DETAIL_COLUMNS.concat(
        additionalColumns.filter((c) => c.field && !DEFAULT_LOAN_DETAIL_COLUMNS.some((d) => d.field === c.field)),
      ),
    [additionalColumns],
  );

  useEffect(() => {
    if (open) {
      const saved = getColumns(canvasItemId);
      const defaultSaved = defaultColumnsWithAdditional.map(toSaved);
      setDraft(saved?.length ? saved.map((c) => ({ ...c })) : defaultSaved.map((c) => ({ ...c })));
    }
  }, [open, canvasItemId, getColumns, defaultColumnsWithAdditional]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    type SchemaCol = { name: string; displayName?: string };
    type MappingRow = { coheusAlias: string; defaultEncompassFieldId: string | null; postgresqlColumn: string };
    type SwapRow = { coheusAlias: string; encompassFieldId: string };
    type AdditionalFieldRow = { columnName: string; displayName: string; losFieldId?: string; columnCreated?: boolean };

    const tenantParam = tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : '';

    Promise.all([
      api.request<{ columns: SchemaCol[] }>(`/api/loans/schema${tenantParam}`),
      api.request<{ mappings: MappingRow[] }>('/api/encompass/field-mappings').catch(() => ({ mappings: [] })),
      tenantId
        ? api
            .request<{ connections: { id: string; los_type?: string }[] }>(`/api/los/connections${tenantParam}`)
            .then((r) => r.connections?.find((c) => c.los_type === 'encompass')?.id ?? null)
            .catch(() => null)
        : Promise.resolve(null),
      tenantId
        ? api.request<{ fields: AdditionalFieldRow[] }>(`/api/tenant-config/additional-fields${tenantParam}`).catch(() => ({ fields: [] }))
        : Promise.resolve({ fields: [] as AdditionalFieldRow[] }),
    ])
      .then(async ([schemaRes, mappingsRes, firstEncompassConnectionId, additionalRes]) => {
        if (cancelled) return;
        const columns = schemaRes?.columns ?? [];
        const mappings = mappingsRes?.mappings ?? [];
        const additionalFields = additionalRes?.fields ?? [];

        const encompassIdByColumn = new Map<string, string>();

        for (const m of mappings) {
          if (m.defaultEncompassFieldId) encompassIdByColumn.set(m.postgresqlColumn, m.defaultEncompassFieldId);
        }

        if (firstEncompassConnectionId && tenantId) {
          try {
            const swapsRes = await api.request<{ swaps: SwapRow[] }>(
              `/api/encompass/field-swaps/${firstEncompassConnectionId}${tenantParam}`,
            );
            const swaps = swapsRes?.swaps ?? [];
            const aliasToSwap = new Map(swaps.map((s) => [s.coheusAlias, s.encompassFieldId]));
            for (const m of mappings) {
              const swapped = aliasToSwap.get(m.coheusAlias);
              if (swapped) encompassIdByColumn.set(m.postgresqlColumn, swapped);
            }
          } catch {
            // use defaults only
          }
        }

        for (const f of additionalFields) {
          if (f.columnCreated && f.losFieldId) encompassIdByColumn.set(f.columnName, f.losFieldId);
        }

        const options: { value: string; label: string }[] = columns.map((c) => {
          const title = c.displayName ?? c.name;
          const encompassId = encompassIdByColumn.get(c.name);
          const label = encompassId ? `${title} (${encompassId})` : title;
          return { value: c.name, label };
        });
        setFieldOptions(options);
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
      { id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`, label: '', field: BLANK_FIELD_VALUE },
    ]);
    // Scroll list to bottom after the new row is in the DOM
    setTimeout(() => {
      const el = listWrapRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }, 0);
  }, []);

  const resetToDefault = useCallback(() => {
    setDraft(defaultColumnsWithAdditional.map(toSaved).map((c) => ({ ...c })));
  }, [defaultColumnsWithAdditional]);

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

        <div
          ref={listWrapRef}
          className="loan-detail-cols-wrap flex flex-col flex-1 min-h-0 overflow-y-auto border rounded-lg p-3 space-y-2"
        >
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
