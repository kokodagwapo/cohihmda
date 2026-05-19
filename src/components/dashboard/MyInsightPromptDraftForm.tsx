/**
 * Shared My Insights prompt draft form (Add prompt modal + Insight builder preview).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Loader2, Plus, X } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { ColumnFilter } from "@/utils/loanDetailFilters";
import { EMPTY_FILTER_TOKEN } from "@/utils/loanDetailFilters";
import { MyInsightSpecifierFilterPanel } from "@/components/dashboard/MyInsightSpecifierFilterPanel";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  MY_INSIGHT_PROMPT_TAG_OPTIONS,
  type LoanColumnMeta,
  type MyInsightPromptDraft,
  type PromptSpecifierRow,
  createEmptySpecifierRow,
  defaultFilterForKind,
  inferFilterKindFromPgColumn,
  rowsFromSpecifiersObject,
  specifiersObjectFromRows,
  summarizeSpecifierFilterButton,
  syncDraftSpecifiersFromRows,
} from "@/lib/myInsightPromptFormUtils";

export type { MyInsightPromptDraft } from "@/lib/myInsightPromptFormUtils";

export interface MyInsightPromptDraftFormProps {
  value: MyInsightPromptDraft;
  onChange: (value: MyInsightPromptDraft) => void;
  tenantId?: string | null;
  disabled?: boolean;
  /** Saved / approved — static display only (no edits, no add/remove specifiers). */
  readOnly?: boolean;
  /** When false, parent must ensure schema is irrelevant (read-only empty specifiers). Default true. */
  loadSchema?: boolean;
}

const SCHEDULE_LABELS: Record<MyInsightPromptDraft["schedule"], string> = {
  batch: "Batch (with My Insights sync)",
  on_demand: "On demand",
};

export function MyInsightPromptDraftForm({
  value,
  onChange,
  tenantId,
  disabled,
  readOnly,
  loadSchema = true,
}: MyInsightPromptDraftFormProps) {
  const [loanSchemaColumns, setLoanSchemaColumns] = useState<LoanColumnMeta[]>([]);
  const [loanSchemaLoading, setLoanSchemaLoading] = useState(false);
  const [specifierRows, setSpecifierRows] = useState<PromptSpecifierRow[]>([]);
  const [specifierColumnPopoverRowId, setSpecifierColumnPopoverRowId] = useState<string | null>(null);
  const [specifierColumnSearch, setSpecifierColumnSearch] = useState("");
  const [specifierValuesPopoverRowId, setSpecifierValuesPopoverRowId] = useState<string | null>(null);
  const [specifierValuesSearch, setSpecifierValuesSearch] = useState("");
  const sortedLoanSchemaColumns = useMemo(
    () => [...loanSchemaColumns].sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [loanSchemaColumns],
  );

  useEffect(() => {
    if (!loadSchema) return;
    let cancelled = false;
    setLoanSchemaLoading(true);
    void (async () => {
      try {
        const tenantParam = tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : "";
        const data = await api.request<{ columns: LoanColumnMeta[] }>(
          `/api/loans/schema${tenantParam}`,
        );
        if (!cancelled) setLoanSchemaColumns(data.columns || []);
      } catch {
        if (!cancelled) setLoanSchemaColumns([]);
      } finally {
        if (!cancelled) setLoanSchemaLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadSchema, tenantId]);

  const specifiersKey = JSON.stringify(value.specifiers ?? {});

  useEffect(() => {
    if (!loadSchema || loanSchemaLoading) return;
    const specNoTag = Object.fromEntries(
      Object.entries(value.specifiers ?? {}).filter(([k]) => k !== "_prompt_tag"),
    );
    setSpecifierRows(rowsFromSpecifiersObject(specNoTag, loanSchemaColumns));
  }, [
    loadSchema,
    loanSchemaLoading,
    loanSchemaColumns,
    value.title,
    value.prompt_text,
    value.schedule,
    value.prompt_tag,
    specifiersKey,
  ]);

  const patchDraft = useCallback(
    (patch: Partial<MyInsightPromptDraft>) => {
      onChange({ ...value, ...patch });
    },
    [onChange, value],
  );

  const updateRows = useCallback(
    (rows: PromptSpecifierRow[]) => {
      setSpecifierRows(rows);
      onChange(syncDraftSpecifiersFromRows(value, rows));
    },
    [onChange, value],
  );

  const loadDistinctForRow = useCallback(
    async (rowId: string, col: string) => {
      if (!col.trim()) {
        setSpecifierRows((prev) =>
          prev.map((r) =>
            r.id === rowId ? { ...r, options: [], optionsLoading: false, optionsError: null } : r,
          ),
        );
        return;
      }
      const meta = loanSchemaColumns.find((c) => c.name === col);
      const fk = inferFilterKindFromPgColumn(meta, col);
      if (fk === "boolean" || fk === "date") {
        setSpecifierRows((prev) =>
          prev.map((r) =>
            r.id === rowId ? { ...r, options: [], optionsLoading: false, optionsError: null } : r,
          ),
        );
        return;
      }
      setSpecifierRows((prev) =>
        prev.map((r) => (r.id === rowId ? { ...r, optionsLoading: true, optionsError: null } : r)),
      );
      try {
        const tenantParam = tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : "";
        const data = await api.request<{ values: string[] }>(
          `/api/loans/distinct-values/${encodeURIComponent(col)}${tenantParam}`,
        );
        const vals = (data.values || []).map((v) => String(v));
        const withBlank =
          fk === "text" || fk === "number"
            ? vals.includes(EMPTY_FILTER_TOKEN)
              ? vals
              : [EMPTY_FILTER_TOKEN, ...vals]
            : vals;
        setSpecifierRows((prev) =>
          prev.map((r) => {
            if (r.id !== rowId) return r;
            let nextFilter = r.filter;
            if (r.filter.kind === "text") {
              nextFilter = {
                ...r.filter,
                selectedValues: r.filter.selectedValues.filter(
                  (x) => x === EMPTY_FILTER_TOKEN || withBlank.includes(x),
                ),
              };
            } else if (r.filter.kind === "number" && r.filter.mode === "all") {
              nextFilter = {
                ...r.filter,
                selectedValues: r.filter.selectedValues.filter(
                  (x) => x === EMPTY_FILTER_TOKEN || withBlank.includes(x),
                ),
              };
            }
            const next = {
              ...r,
              options: withBlank,
              optionsLoading: false,
              optionsError: null,
              filter: nextFilter,
            };
            return next;
          }),
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Could not load values";
        setSpecifierRows((prev) =>
          prev.map((r) =>
            r.id === rowId ? { ...r, options: [], optionsLoading: false, optionsError: msg } : r,
          ),
        );
      }
    },
    [tenantId, loanSchemaColumns],
  );

  useEffect(() => {
    for (const r of specifierRows) {
      if (r.column && r.options.length === 0 && !r.optionsLoading && !r.optionsError) {
        void loadDistinctForRow(r.id, r.column);
      }
    }
  }, [specifierRows, loadDistinctForRow]);

  const setSpecifierRowColumn = useCallback(
    (rowId: string, col: string) => {
      const meta = loanSchemaColumns.find((c) => c.name === col);
      const fk = inferFilterKindFromPgColumn(meta, col);
      const next = specifierRows.map((r) =>
        r.id === rowId
          ? {
              ...r,
              column: col,
              filter: defaultFilterForKind(fk),
              options: [],
              optionsLoading: false,
              optionsError: null,
            }
          : r,
      );
      updateRows(next);
      void loadDistinctForRow(rowId, col);
    },
    [loanSchemaColumns, specifierRows, updateRows, loadDistinctForRow],
  );

  const setSpecifierRowFilter = useCallback(
    (rowId: string, filter: ColumnFilter) => {
      const next = specifierRows.map((r) => (r.id === rowId ? { ...r, filter } : r));
      updateRows(next);
    },
    [specifierRows, updateRows],
  );

  const inputClass =
    "mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus-visible:ring-offset-slate-950 disabled:opacity-50";

  if (readOnly) {
    const tagLabel =
      MY_INSIGHT_PROMPT_TAG_OPTIONS.find((o) => o.id === value.prompt_tag)?.label ??
      (value.prompt_tag ? value.prompt_tag : "—");
    const fieldCn =
      "mt-1 text-sm text-slate-800 dark:text-slate-100 whitespace-pre-wrap break-words";
    const labelCn = "text-xs font-medium text-slate-500 dark:text-slate-400";

    return (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className={labelCn}>Title</p>
            <p className={fieldCn}>{value.title || "—"}</p>
          </div>
          <div>
            <p className={labelCn}>Schedule</p>
            <p className={fieldCn}>{SCHEDULE_LABELS[value.schedule]}</p>
          </div>
        </div>
        <div>
          <p className={labelCn}>Prompt text</p>
          <p className={fieldCn}>{value.prompt_text || "—"}</p>
        </div>
        <div>
          <p className={labelCn}>Tag</p>
          <p className={fieldCn}>{tagLabel}</p>
        </div>
        <div>
          <p className={labelCn}>Specifiers</p>
          {loanSchemaLoading ? (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Loading…</p>
          ) : specifierRows.length === 0 ? (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              No specifiers — full loan scope.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {specifierRows.map((row) => {
                const colMeta = sortedLoanSchemaColumns.find((c) => c.name === row.column);
                const columnLabel = colMeta
                  ? `${colMeta.displayName} (${colMeta.name})`
                  : row.column || "—";
                const filterLabel = summarizeSpecifierFilterButton(
                  colMeta,
                  row.column,
                  row.filter,
                );
                return (
                  <li
                    key={row.id}
                    className="rounded-lg border border-slate-200/80 bg-white/90 px-3 py-2 text-sm dark:border-slate-600/80 dark:bg-slate-900/50"
                  >
                    <span className="font-medium text-slate-700 dark:text-slate-200">
                      {columnLabel}
                    </span>
                    <span className="text-slate-500 dark:text-slate-400"> · </span>
                    <span className="text-slate-600 dark:text-slate-300">{filterLabel}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
          Title
          <input
            type="text"
            disabled={disabled}
            value={value.title}
            onChange={(e) => patchDraft({ title: e.target.value })}
            className={inputClass}
            placeholder="Short label"
          />
        </label>
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
          Schedule
          <select
            disabled={disabled}
            value={value.schedule}
            onChange={(e) =>
              patchDraft({
                schedule: e.target.value === "on_demand" ? "on_demand" : "batch",
              })
            }
            className={inputClass}
          >
            <option value="batch">Batch (with My Insights sync)</option>
            <option value="on_demand">On demand</option>
          </select>
        </label>
      </div>
      <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
        Prompt text
        <textarea
          disabled={disabled}
          value={value.prompt_text}
          onChange={(e) => patchDraft({ prompt_text: e.target.value })}
          rows={4}
          className={inputClass}
          placeholder="What you want summarized as a My Insights card…"
        />
      </label>
      <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
        Tag
        <select
          disabled={disabled}
          value={value.prompt_tag}
          onChange={(e) => {
            const tag = e.target.value;
            const rows = specifierRows;
            onChange({
              ...value,
              prompt_tag: tag,
              specifiers: specifiersObjectFromRows(rows, tag),
            });
          }}
          className={cn(inputClass, "max-w-md")}
        >
          {MY_INSIGHT_PROMPT_TAG_OPTIONS.map((opt) => (
            <option key={opt.id || "__blank__"} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-[11px] text-slate-500 dark:text-slate-400">
          Optional. Tags the generated My Insights card for the category tabs.
        </span>
      </label>
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Specifiers</span>
          <button
            type="button"
            disabled={disabled || loanSchemaLoading}
            onClick={() => updateRows([...specifierRows, createEmptySpecifierRow()])}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            Add specifier
          </button>
        </div>
        {loanSchemaLoading ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">Loading loan columns…</p>
        ) : null}
        {specifierRows.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            No specifiers — prompt applies to your full loan scope. Add a row to filter the loan
            cohort.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {specifierRows.map((row) => {
              const colMeta = sortedLoanSchemaColumns.find((c) => c.name === row.column);
              const columnTriggerLabel = colMeta
                ? `${colMeta.displayName} (${colMeta.name})`
                : "Select column…";
              const colQ =
                specifierColumnPopoverRowId === row.id
                  ? specifierColumnSearch.trim().toLowerCase()
                  : "";
              const colsFiltered = colQ
                ? sortedLoanSchemaColumns.filter(
                    (c) =>
                      c.name.toLowerCase().includes(colQ) ||
                      c.displayName.toLowerCase().includes(colQ),
                  )
                : sortedLoanSchemaColumns;
              const fk = inferFilterKindFromPgColumn(colMeta, row.column);
              return (
                <div
                  key={row.id}
                  className="flex flex-wrap items-start gap-3 rounded-xl border border-slate-200/80 bg-white/90 p-3 dark:border-slate-600/80 dark:bg-slate-900/50"
                >
                  <div className="min-w-[min(100%,220px)] flex-1">
                    <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Column
                    </label>
                    <Popover
                      open={specifierColumnPopoverRowId === row.id}
                      onOpenChange={(open) => {
                        if (open) {
                          setSpecifierColumnPopoverRowId(row.id);
                          setSpecifierColumnSearch("");
                        } else {
                          setSpecifierColumnPopoverRowId((cur) => (cur === row.id ? null : cur));
                          setSpecifierColumnSearch("");
                        }
                      }}
                    >
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          disabled={disabled || loanSchemaLoading}
                          className={cn(
                            "flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-900 shadow-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40",
                            (disabled || loanSchemaLoading) && "cursor-not-allowed opacity-50",
                          )}
                        >
                          <span className="min-w-0 flex-1 truncate">{columnTriggerLabel}</span>
                          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-80 p-0" sideOffset={6}>
                        <Command shouldFilter={false}>
                          <CommandInput
                            placeholder="Search columns…"
                            value={specifierColumnSearch}
                            onValueChange={setSpecifierColumnSearch}
                          />
                          <CommandList className="max-h-[min(40vh,260px)]">
                            <CommandEmpty>No columns found.</CommandEmpty>
                            {colsFiltered.map((col) => (
                              <CommandItem
                                key={col.name}
                                value={`${col.displayName} ${col.name}`}
                                onSelect={() => {
                                  setSpecifierRowColumn(row.id, col.name);
                                  setSpecifierColumnPopoverRowId(null);
                                  setSpecifierColumnSearch("");
                                }}
                                className={cn(
                                  "cursor-pointer",
                                  row.column === col.name
                                    ? "!bg-accent !text-accent-foreground"
                                    : "",
                                )}
                              >
                                <span className="mr-2">{row.column === col.name ? "✓" : ""}</span>
                                <span className="truncate">
                                  {col.displayName}{" "}
                                  <span className="text-slate-500 dark:text-slate-400">
                                    ({col.name})
                                  </span>
                                </span>
                              </CommandItem>
                            ))}
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="min-w-[min(100%,260px)] flex-[2]">
                    <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Filter
                    </label>
                    {row.optionsLoading ? (
                      <div className="flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-500 dark:border-slate-600 dark:bg-slate-900">
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                        Loading values…
                      </div>
                    ) : row.optionsError ? (
                      <p className="text-xs text-rose-600 dark:text-rose-400">{row.optionsError}</p>
                    ) : (
                      <Popover
                        open={specifierValuesPopoverRowId === row.id}
                        onOpenChange={(open) => {
                          if (open) {
                            setSpecifierValuesPopoverRowId(row.id);
                            setSpecifierValuesSearch("");
                          } else {
                            setSpecifierValuesPopoverRowId((cur) => (cur === row.id ? null : cur));
                            setSpecifierValuesSearch("");
                          }
                        }}
                      >
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            disabled={disabled || !row.column}
                            className={cn(
                              "flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-900 shadow-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100",
                              (!row.column || disabled) && "cursor-not-allowed opacity-50",
                            )}
                          >
                            <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">
                              {summarizeSpecifierFilterButton(colMeta, row.column, row.filter)}
                            </span>
                            <ChevronDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent
                          align="start"
                          className="w-[min(100vw-1rem,420px)] p-0"
                          sideOffset={6}
                        >
                          <MyInsightSpecifierFilterPanel
                            columnTitle={colMeta?.displayName ?? row.column}
                            filterKind={fk}
                            filter={row.filter}
                            distinctOptions={row.options}
                            filterSearch={
                              specifierValuesPopoverRowId === row.id ? specifierValuesSearch : ""
                            }
                            onFilterSearchChange={setSpecifierValuesSearch}
                            onChange={(next) => setSpecifierRowFilter(row.id, next)}
                          />
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>
                  <button
                    type="button"
                    title="Remove specifier"
                    disabled={disabled}
                    onClick={() => {
                      setSpecifierColumnPopoverRowId((id) => (id === row.id ? null : id));
                      setSpecifierValuesPopoverRowId((id) => (id === row.id ? null : id));
                      updateRows(specifierRows.filter((r) => r.id !== row.id));
                    }}
                    className="mt-5 shrink-0 rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50 hover:text-rose-600 dark:border-slate-600 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-rose-400 disabled:opacity-50"
                  >
                    <X className="h-4 w-4" strokeWidth={2} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
