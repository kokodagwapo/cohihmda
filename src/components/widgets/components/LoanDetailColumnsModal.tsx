/**
 * Modal to edit Loan Detail table columns (workbench only).
 * Column name (text box) + Field dropdown with search and scroll (Popover + Command, like milestone dropdown).
 * Reorder: order number input (1-based, live while typing) and ↑ / ↓ beside remove.
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
import { X, ChevronsUpDown, Check, ChevronUp, ChevronDown } from 'lucide-react';
import { useLoanDetailColumnsStore, type SavedLoanDetailColumn } from '@/stores/loanDetailColumnsStore';
import {
  DEFAULT_LOAN_DETAIL_COLUMNS,
  type ColumnDef,
} from '@/components/views/LoanDetailView';
import { useAdditionalFieldColumns } from '@/hooks/useAdditionalFieldColumns';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  arrayMoveToFinalIndex,
  moveRowToEndByIndex,
  moveRowToOneBasedPosition,
} from '@/utils/loanDetailColumnsReorder';

const NONE_FIELD_VALUE = '__none__';
/** Sentinel for "no field selected yet" on a new column; dropdown enabled so user can pick a real field. */
const BLANK_FIELD_VALUE = '__blank__';

const MODAL_STYLES = `
.loan-detail-cols-wrap {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  overflow-x: hidden;
  overflow-y: auto;
}
.loan-detail-cols-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 3.5rem minmax(0, auto) minmax(0, auto) minmax(0, auto);
  gap: 0.5rem;
  align-items: center;
  width: 100%;
  min-width: 0;
  max-width: 100%;
}
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
  return { id: c.id, label: c.label, field };
}

type FieldOption = { value: string; label: string };

function orderInputDisplayValue(orderDraftByRowId: Record<string, string>, rowId: string, index: number): string {
  return Object.prototype.hasOwnProperty.call(orderDraftByRowId, rowId)
    ? orderDraftByRowId[rowId]
    : String(index + 1);
}

const ColumnEditRow = memo(function ColumnEditRow({
  row,
  index,
  fieldOptions,
  onUpdate,
  onRemove,
  registerRowElement,
  orderValue,
  onOrderFocus,
  onOrderChange,
  onOrderBlur,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: {
  row: SavedLoanDetailColumn;
  index: number;
  fieldOptions: FieldOption[];
  onUpdate: (index: number, patch: Partial<SavedLoanDetailColumn>) => void;
  onRemove: (index: number) => void;
  registerRowElement: (rowId: string, el: HTMLDivElement | null) => void;
  orderValue: string;
  onOrderFocus: (rowId: string) => void;
  onOrderChange: (rowId: string, raw: string) => void;
  onOrderBlur: (rowId: string) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
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
    <div
      ref={(el) => registerRowElement(row.id, el)}
      className="rounded-md border border-transparent w-full max-w-full min-w-0 overflow-hidden"
    >
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
        <Input
          value={orderValue}
          onChange={(e) => onOrderChange(row.id, e.target.value)}
          onFocus={() => onOrderFocus(row.id)}
          onBlur={() => onOrderBlur(row.id)}
          inputMode="numeric"
          autoComplete="off"
          aria-label={`Column order (1 = first). Current row: ${row.label || row.id}`}
          className="h-9 w-full min-w-0 px-1 text-center tabular-nums"
        />
        <button
          type="button"
          onClick={() => onRemove(index)}
          className="p-2 rounded hover:bg-muted text-muted-foreground hover:text-destructive shrink-0"
          aria-label="Remove column"
        >
          <X className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onMoveUp(index)}
          disabled={!canMoveUp}
          className={cn(
            'p-2 rounded shrink-0 text-muted-foreground hover:bg-muted hover:text-foreground',
            !canMoveUp && 'opacity-40 cursor-not-allowed hover:bg-transparent',
          )}
          aria-label="Move column up"
        >
          <ChevronUp className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onMoveDown(index)}
          disabled={!canMoveDown}
          className={cn(
            'p-2 rounded shrink-0 text-muted-foreground hover:bg-muted hover:text-foreground',
            !canMoveDown && 'opacity-40 cursor-not-allowed hover:bg-transparent',
          )}
          aria-label="Move column down"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>
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
  /** Raw order input text while editing; empty string means user cleared input (row moves to end). */
  const [orderDraftByRowId, setOrderDraftByRowId] = useState<Record<string, string>>({});
  const [fieldOptions, setFieldOptions] = useState<{ value: string; label: string }[]>(() => getFallbackFieldOptions());
  const listWrapRef = useRef<HTMLDivElement>(null);
  const rowElByIdRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const registerRowElement = useCallback((rowId: string, el: HTMLDivElement | null) => {
    const m = rowElByIdRef.current;
    if (el) m.set(rowId, el);
    else m.delete(rowId);
  }, []);

  const defaultColumnsWithAdditional = useMemo(
    () =>
      DEFAULT_LOAN_DETAIL_COLUMNS.concat(
        additionalColumns.filter((c) => c.field && !DEFAULT_LOAN_DETAIL_COLUMNS.some((d) => d.field === c.field)),
      ),
    [additionalColumns],
  );

  useEffect(() => {
    if (!open) return;
    setOrderDraftByRowId({});
    const saved = getColumns(canvasItemId);
    const baseDefs =
      defaultColumnsWithAdditional.length > 0
        ? defaultColumnsWithAdditional
        : DEFAULT_LOAN_DETAIL_COLUMNS;
    const defaultSaved = baseDefs.map(toSaved);
    const nextDraft =
      Array.isArray(saved) && saved.length > 0
        ? saved.map((c) => ({ ...c }))
        : defaultSaved.map((c) => ({ ...c }));
    setDraft(nextDraft);
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
    let removedId: string | undefined;
    setDraft((prev) => {
      removedId = prev[index]?.id;
      return prev.filter((_, i) => i !== index);
    });
    if (removedId) {
      setOrderDraftByRowId((d) => {
        const next = { ...d };
        delete next[removedId!];
        return next;
      });
    }
  }, []);

  const addColumn = useCallback(() => {
    setDraft((prev) => [
      ...prev,
      { id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`, label: '', field: BLANK_FIELD_VALUE },
    ]);
    setTimeout(() => {
      const el = listWrapRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }, 0);
  }, []);

  const resetToDefault = useCallback(() => {
    setOrderDraftByRowId({});
    const base =
      defaultColumnsWithAdditional.length > 0
        ? defaultColumnsWithAdditional
        : DEFAULT_LOAN_DETAIL_COLUMNS;
    setDraft(base.map(toSaved).map((c) => ({ ...c })));
  }, [defaultColumnsWithAdditional]);

  const handleOrderFocus = useCallback((rowId: string) => {
    const idx = draftRef.current.findIndex((r) => r.id === rowId);
    if (idx >= 0) {
      setOrderDraftByRowId((prev) => ({ ...prev, [rowId]: String(idx + 1) }));
    }
    requestAnimationFrame(() => {
      rowElByIdRef.current.get(rowId)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }, []);

  const handleOrderBlur = useCallback((rowId: string) => {
    setOrderDraftByRowId((prev) => {
      const next = { ...prev };
      delete next[rowId];
      return next;
    });
  }, []);

  /**
   * Digits only while typing. Empty → move row to end. Non-empty → parse integer and move to that 1-based
   * position (clamped); intermediate "0" alone does not reorder (e.g. typing "10").
   */
  const handleOrderChange = useCallback((rowId: string, raw: string) => {
    const digitsOnly = raw.replace(/\D/g, '');
    setOrderDraftByRowId((prev) => ({ ...prev, [rowId]: digitsOnly }));
    setDraft((prev) => {
      const from = prev.findIndex((r) => r.id === rowId);
      if (from < 0) return prev;
      if (digitsOnly === '') {
        return moveRowToEndByIndex(prev, from);
      }
      const num = parseInt(digitsOnly, 10);
      if (!Number.isFinite(num) || num < 1) {
        return prev;
      }
      return moveRowToOneBasedPosition(prev, from, num);
    });
  }, []);

  const handleMoveUp = useCallback((index: number) => {
    if (index <= 0) return;
    setOrderDraftByRowId({});
    setDraft((prev) => arrayMoveToFinalIndex(prev, index, index - 1));
  }, []);

  const handleMoveDown = useCallback((index: number) => {
    setOrderDraftByRowId({});
    setDraft((prev) => {
      if (index >= prev.length - 1) return prev;
      return arrayMoveToFinalIndex(prev, index, index + 1);
    });
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
      <DialogContent
        className="max-w-2xl max-h-[85vh] flex flex-col overflow-x-hidden overflow-y-auto"
        hideCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>Edit Loan Detail columns</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Edit the column name and choose which data field populates it. Long field names are truncated with an ellipsis.
          Use the order box (1 = first column) or the arrows to reorder; clearing the order sends the row to the end until you type a position.
        </p>

        <div
          ref={listWrapRef}
          className="loan-detail-cols-wrap flex flex-col flex-1 min-h-0 min-w-0 border rounded-lg p-3 space-y-2"
        >
          <div className="loan-detail-cols-row text-xs font-medium text-muted-foreground">
            <span>Column name</span>
            <span>Field</span>
            <span className="text-center">Order</span>
            <span className="sr-only">Remove</span>
            <span className="sr-only">Up</span>
            <span className="sr-only">Down</span>
          </div>
          <div className="flex flex-col gap-2 min-w-0">
            {draft.map((row, index) => (
              <ColumnEditRow
                key={row.id}
                row={row}
                index={index}
                fieldOptions={fieldOptions}
                onUpdate={updateRow}
                onRemove={removeRow}
                registerRowElement={registerRowElement}
                orderValue={orderInputDisplayValue(orderDraftByRowId, row.id, index)}
                onOrderFocus={handleOrderFocus}
                onOrderChange={handleOrderChange}
                onOrderBlur={handleOrderBlur}
                onMoveUp={handleMoveUp}
                onMoveDown={handleMoveDown}
                canMoveUp={index > 0}
                canMoveDown={index < draft.length - 1}
              />
            ))}
          </div>
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
