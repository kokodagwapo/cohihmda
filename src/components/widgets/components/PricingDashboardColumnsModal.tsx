/**
 * Modal to edit Pricing Dashboard table columns (all four tables).
 * Shows column name (editable), LOS Field ID; supports delete and add with dual search (column name + LOS field).
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { X, Plus } from 'lucide-react';
import { useWidgetSectionStore } from '@/stores/widgetSectionStore';
import { usePricingDashboardStandaloneColumnsStore } from '@/stores/pricingDashboardStandaloneColumnsStore';
import {
  DEFAULT_PRICING_DASHBOARD_COLUMNS,
  PRICING_AVAILABLE_FIELDS,
  type PricingDashboardColumnDef,
} from '@/lib/pricingDashboardColumns';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

export interface PricingDashboardColumnsModalProps {
  open: boolean;
  onClose: () => void;
  /** When provided, edits are stored in the workbench group filters. When undefined, standalone store is used. */
  groupId?: string;
}

export function PricingDashboardColumnsModal({
  open,
  onClose,
  groupId,
}: PricingDashboardColumnsModalProps) {
  const getFilters = useWidgetSectionStore((s) => s.getFilters);
  const updateFilters = useWidgetSectionStore((s) => s.updateFilters);
  const standaloneSetColumns = usePricingDashboardStandaloneColumnsStore((s) => s.setColumns);
  const standaloneGetColumns = usePricingDashboardStandaloneColumnsStore((s) => s.getColumns);
  const isStandalone = groupId == null;

  const [draft, setDraft] = useState<PricingDashboardColumnDef[]>([]);
  const [columnNameSearch, setColumnNameSearch] = useState('');
  const [losFieldSearch, setLosFieldSearch] = useState('');
  const [columnNamePickerOpen, setColumnNamePickerOpen] = useState(false);
  const [losFieldPickerOpen, setLosFieldPickerOpen] = useState(false);
  const [selectedForAdd, setSelectedForAdd] = useState<PricingDashboardColumnDef | null>(null);

  const availableFields = useMemo(() => PRICING_AVAILABLE_FIELDS, []);

  useEffect(() => {
    if (open) {
      setDraft(
        isStandalone
          ? (standaloneGetColumns().map((c) => ({ ...c })) as PricingDashboardColumnDef[])
          : (() => {
              const filters = getFilters(groupId!);
              const custom = filters.pricingDashboardColumns;
              return custom && custom.length > 0
                ? custom.map((c) => ({ ...c }))
                : DEFAULT_PRICING_DASHBOARD_COLUMNS.map((c) => ({ ...c }));
            })()
      );
      setSelectedForAdd(null);
      setColumnNameSearch('');
      setLosFieldSearch('');
    }
  }, [open, groupId, isStandalone, getFilters, standaloneGetColumns]);

  const updateRow = useCallback((index: number, label: string) => {
    setDraft((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], label };
      return next;
    });
  }, []);

  const removeRow = useCallback((index: number) => {
    setDraft((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const filteredByColumnName = useMemo(() => {
    const q = columnNameSearch.trim().toLowerCase();
    if (!q) return availableFields;
    return availableFields.filter(
      (f) =>
        f.label.toLowerCase().includes(q) || f.key.toLowerCase().includes(q)
    );
  }, [availableFields, columnNameSearch]);

  const filteredByLosField = useMemo(() => {
    const q = losFieldSearch.trim().toLowerCase();
    if (!q) return availableFields;
    return availableFields.filter(
      (f) =>
        f.key.toLowerCase().includes(q) || f.label.toLowerCase().includes(q)
    );
  }, [availableFields, losFieldSearch]);

  const addColumn = useCallback(() => {
    if (!selectedForAdd) return;
    const already = draft.some((c) => c.key === selectedForAdd.key);
    if (already) return;
    setDraft((prev) => [...prev, { ...selectedForAdd }]);
    setSelectedForAdd(null);
    setColumnNameSearch('');
    setLosFieldSearch('');
    setColumnNamePickerOpen(false);
    setLosFieldPickerOpen(false);
  }, [selectedForAdd, draft]);

  const resetToDefault = useCallback(() => {
    setDraft(DEFAULT_PRICING_DASHBOARD_COLUMNS.map((c) => ({ ...c })));
  }, []);

  const handleSave = useCallback(() => {
    const valid = draft.filter((r) => r.key.trim() !== '' && r.label.trim() !== '');
    if (valid.length === 0) return;
    if (isStandalone) {
      standaloneSetColumns(valid);
    } else {
      updateFilters(groupId!, { pricingDashboardColumns: valid });
    }
    onClose();
  }, [isStandalone, groupId, draft, updateFilters, standaloneSetColumns, onClose]);

  const hasValidColumns = useMemo(
    () => draft.some((r) => r.key.trim() !== '' && r.label.trim() !== ''),
    [draft]
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Edit columns</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          These columns apply to all four Pricing Dashboard tables. Edit the display name or remove columns. Add columns via the search below.
        </p>

        <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-xs font-medium text-muted-foreground border-b pb-1.5">
          <span>Column name</span>
          <span>LOS Field ID</span>
          <span className="w-8" aria-hidden />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto space-y-2 border rounded-lg p-2 max-h-48">
          {draft.map((row, index) => (
            <div
              key={`${row.key}-${index}`}
              className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center"
            >
              <Input
                value={row.label}
                onChange={(e) => updateRow(index, e.target.value)}
                placeholder="Column name"
                className="h-9"
              />
              <span className="text-sm font-mono text-muted-foreground truncate" title={row.key}>
                {row.key}
              </span>
              <button
                type="button"
                onClick={() => removeRow(index)}
                className="p-2 rounded hover:bg-muted text-muted-foreground hover:text-destructive"
                aria-label="Remove column"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>

        <div className="space-y-2 pt-2 border-t">
          <p className="text-xs font-medium text-muted-foreground">Add column</p>
          <div className="flex flex-wrap items-center gap-2">
            <Popover open={columnNamePickerOpen} onOpenChange={setColumnNamePickerOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 justify-between min-w-[200px]">
                  {selectedForAdd ? selectedForAdd.label : 'Search by column name...'}
                  <span className="ml-2 opacity-50">▼</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[300px] p-0" align="start">
                <Command shouldFilter={false}>
                  <CommandInput
                    placeholder="Search column name..."
                    value={columnNameSearch}
                    onValueChange={setColumnNameSearch}
                  />
                  <CommandList className="max-h-[200px]">
                    <CommandEmpty>No match.</CommandEmpty>
                    <CommandGroup>
                      {filteredByColumnName.map((f) => (
                        <CommandItem
                          key={f.key}
                          value={f.key}
                          onSelect={() => {
                            setSelectedForAdd(f);
                            setLosFieldSearch(f.key);
                            setColumnNamePickerOpen(false);
                          }}
                        >
                          <span className="font-medium">{f.label}</span>
                          <span className="ml-2 text-xs text-muted-foreground font-mono">{f.key}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            <Popover open={losFieldPickerOpen} onOpenChange={setLosFieldPickerOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 justify-between min-w-[200px]">
                  {selectedForAdd ? selectedForAdd.key : 'Search by LOS Field ID...'}
                  <span className="ml-2 opacity-50">▼</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[300px] p-0" align="start">
                <Command shouldFilter={false}>
                  <CommandInput
                    placeholder="Search LOS Field ID..."
                    value={losFieldSearch}
                    onValueChange={setLosFieldSearch}
                  />
                  <CommandList className="max-h-[200px]">
                    <CommandEmpty>No match.</CommandEmpty>
                    <CommandGroup>
                      {filteredByLosField.map((f) => (
                        <CommandItem
                          key={f.key}
                          value={f.key}
                          onSelect={() => {
                            setSelectedForAdd(f);
                            setColumnNameSearch(f.label);
                            setLosFieldPickerOpen(false);
                          }}
                        >
                          <span className="font-mono text-xs">{f.key}</span>
                          <span className="ml-2 text-muted-foreground truncate">{f.label}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            <Button
              type="button"
              size="sm"
              variant={selectedForAdd ? 'default' : 'secondary'}
              onClick={addColumn}
              disabled={!selectedForAdd || draft.some((c) => c.key === selectedForAdd?.key)}
              className="h-9"
            >
              <Plus className="h-4 w-4 mr-1" />
              Add
            </Button>
          </div>
        </div>

        <div className="flex justify-between gap-4 pt-2 border-t">
          <Button type="button" variant="ghost" size="sm" onClick={resetToDefault}>
            Reset to default
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={handleSave} disabled={!hasValidColumns}>
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
