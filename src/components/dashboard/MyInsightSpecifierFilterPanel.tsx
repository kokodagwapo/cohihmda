import {
  type ColumnFilter,
  type LoanDetailFilterKind,
  type NumericFilterMode,
  EMPTY_FILTER_TOKEN,
  DATE_FILTER_BLANK_LABEL,
  DATE_FILTER_BLANK_SHORTCUT,
  isDateFilterBlankOnlyShortcut,
  getRelativeDateFieldValues,
  dateFilterFromRelativeFields,
} from "@/utils/loanDetailFilters";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { computePresetDateRange, getPeriodPresetMeta, type PeriodPreset } from "@/components/ui/DatePeriodPicker";

export interface MyInsightSpecifierFilterPanelProps {
  columnTitle: string;
  filterKind: LoanDetailFilterKind;
  filter: ColumnFilter;
  distinctOptions: string[];
  filterSearch: string;
  onFilterSearchChange: (q: string) => void;
  onChange: (next: ColumnFilter) => void;
}

function withBlankFirst(options: string[]): string[] {
  if (options.includes(EMPTY_FILTER_TOKEN)) return options;
  return [EMPTY_FILTER_TOKEN, ...options];
}

export function MyInsightSpecifierFilterPanel({
  columnTitle,
  filterKind,
  filter,
  distinctOptions,
  filterSearch,
  onFilterSearchChange,
  onChange,
}: MyInsightSpecifierFilterPanelProps) {
  if (filterKind === "boolean") {
    const value = filter.kind === "boolean" ? filter.value : "all";
    return (
      <div className="space-y-2 p-2">
        <p className="text-xs text-slate-500 dark:text-slate-400 px-1">
          {columnTitle} — Yes / No / All
        </p>
        {(["all", "yes", "no"] as const).map((option) => (
          <Button
            key={option}
            type="button"
            size="sm"
            variant={value === option ? "default" : "outline"}
            className="w-full justify-start"
            onClick={() => onChange({ kind: "boolean", value: option })}
          >
            {option === "all" ? "All" : option === "yes" ? "Yes" : "No"}
          </Button>
        ))}
      </div>
    );
  }

  if (filterKind === "date") {
    const dateFilter = filter.kind === "date" ? filter : { kind: "date" as const };
    const rel = getRelativeDateFieldValues(dateFilter);
    const yearToken = String(new Date().getFullYear());
    const fixedYears = ["2025", "2024", "2023"];
    const dateShortcutOptions: Array<{ token: string; label: string; kind: "preset" | "year" | "ytd" }> = [
      { token: "last-30-days", label: "Last 30 Days", kind: "preset" },
      { token: "mtd", label: "MTD", kind: "preset" },
      { token: "qtd", label: getPeriodPresetMeta("qtd").label, kind: "preset" },
      { token: "last-month", label: "Last Month", kind: "preset" },
      { token: "last-quarter", label: getPeriodPresetMeta("last-quarter").label, kind: "preset" },
      { token: "ytd", label: `${yearToken} YTD`, kind: "ytd" },
      ...fixedYears.map((y) => ({ token: y, label: y, kind: "year" as const })),
      { token: "rolling-13", label: getPeriodPresetMeta("rolling-13").label, kind: "preset" },
      { token: "rolling-12", label: getPeriodPresetMeta("rolling-12").label, kind: "preset" },
    ];
    return (
      <div className="max-h-[min(70vh,520px)] space-y-3 overflow-y-auto p-3">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {columnTitle} — Select one or more values from the list below, or use presets.
        </p>
        <Button
          type="button"
          size="sm"
          variant={isDateFilterBlankOnlyShortcut(dateFilter.shortcut) ? "default" : "outline"}
          className="w-full justify-start"
          onClick={() =>
            onChange({
              kind: "date",
              shortcut: DATE_FILTER_BLANK_SHORTCUT,
              from: "",
              to: "",
            })
          }
        >
          {DATE_FILTER_BLANK_LABEL}
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Input
            type="date"
            value={dateFilter.from ?? ""}
            onChange={(e) =>
              onChange({ kind: "date", from: e.target.value, to: dateFilter.to, shortcut: undefined })
            }
          />
          <Input
            type="date"
            value={dateFilter.to ?? ""}
            onChange={(e) =>
              onChange({ kind: "date", from: dateFilter.from, to: e.target.value, shortcut: undefined })
            }
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          {dateShortcutOptions.map((opt) => (
            <Button
              key={opt.token}
              type="button"
              size="sm"
              variant={dateFilter.shortcut === opt.token ? "default" : "outline"}
              onClick={() => {
                if (opt.kind === "year") {
                  const from = `${opt.token}-01-01`;
                  const to = `${opt.token}-12-31`;
                  onChange({ kind: "date", shortcut: opt.token, from, to });
                  return;
                }
                if (opt.kind === "ytd") {
                  const range = computePresetDateRange("ytd");
                  onChange({ kind: "date", shortcut: "ytd", from: range.start, to: range.end });
                  return;
                }
                const preset = opt.token as PeriodPreset;
                const range = computePresetDateRange(preset);
                onChange({ kind: "date", shortcut: opt.token, from: range.start, to: range.end });
              }}
            >
              {opt.label}
            </Button>
          ))}
        </div>
        <div className="space-y-2 rounded-md border border-slate-200/80 p-2 dark:border-slate-600/60">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Relative to date(s)
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Select one or both dates. One date: on/after From Date, or on/before To Date. Both dates:
            inclusive range. If From is later than To, the other bound clears: changing From keeps From;
            changing To keeps To.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-slate-600 dark:text-slate-300">From</span>
              <Input
                type="date"
                value={rel.from}
                onChange={(e) => onChange(dateFilterFromRelativeFields(e.target.value, rel.to, "from"))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-slate-600 dark:text-slate-300">To</span>
              <Input
                type="date"
                value={rel.to}
                onChange={(e) => onChange(dateFilterFromRelativeFields(rel.from, e.target.value, "to"))}
              />
            </div>
          </div>
        </div>
        <Button type="button" size="sm" variant="ghost" className="w-full" onClick={() => onChange({ kind: "date" })}>
          Clear Selection
        </Button>
      </div>
    );
  }

  if (filterKind === "number") {
    const numberFilter =
      filter.kind === "number" ? filter : { kind: "number" as const, mode: "all" as NumericFilterMode, selectedValues: [] };
    const merged = withBlankFirst(distinctOptions);
    const q = filterSearch.trim().toLowerCase();
    const displayed = q ? merged.filter((v) => v.toLowerCase().includes(q)) : merged;
    const ordered = [...displayed].sort((a, b) => {
      const as = numberFilter.selectedValues.includes(a) ? 1 : 0;
      const bs = numberFilter.selectedValues.includes(b) ? 1 : 0;
      if (as !== bs) return bs - as;
      if (a === EMPTY_FILTER_TOKEN) return -1;
      if (b === EMPTY_FILTER_TOKEN) return 1;
      return a.localeCompare(b, undefined, { numeric: true });
    });
    return (
      <div className="max-h-[min(70vh,520px)] overflow-y-auto p-2">
        <p className="mb-2 text-xs text-slate-500 dark:text-slate-400 px-1">
          {columnTitle} — discrete values, ranges, or comparisons.
        </p>
        <Tabs
          value={numberFilter.mode}
          onValueChange={(mode) =>
            onChange({ kind: "number", mode: mode as NumericFilterMode, selectedValues: [] })
          }
        >
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="range">Range</TabsTrigger>
            <TabsTrigger value="min">Greater Than</TabsTrigger>
            <TabsTrigger value="max">Less Than</TabsTrigger>
          </TabsList>
          <TabsContent value="all" className="space-y-2 pt-2">
            <Command shouldFilter={false}>
              <CommandInput placeholder={`Search ${columnTitle}`} value={filterSearch} onValueChange={onFilterSearchChange} />
              <CommandList className="max-h-[220px]">
                <CommandEmpty>No values found.</CommandEmpty>
                {ordered.map((value) => {
                  const sel = numberFilter.selectedValues.includes(value);
                  return (
                    <CommandItem
                      key={value}
                      onSelect={() => {
                        const next = sel
                          ? numberFilter.selectedValues.filter((x) => x !== value)
                          : [...numberFilter.selectedValues, value];
                        onChange({ kind: "number", mode: "all", selectedValues: next });
                      }}
                      className={cn(
                        "cursor-pointer hover:!bg-transparent hover:!text-foreground data-[selected=true]:!bg-transparent data-[selected=true]:!text-foreground",
                        sel
                          ? "!bg-accent !text-accent-foreground hover:!bg-accent data-[selected=true]:!bg-accent data-[selected=true]:!text-accent-foreground"
                          : "",
                      )}
                    >
                      <span className="mr-2">{sel ? "✓" : ""}</span>
                      {value === EMPTY_FILTER_TOKEN ? "(Blank)" : value}
                    </CommandItem>
                  );
                })}
              </CommandList>
            </Command>
            <Button type="button" size="sm" variant="ghost" className="w-full" onClick={() => onChange({ kind: "number", mode: "all", selectedValues: [] })}>
              Clear Selection
            </Button>
          </TabsContent>
          <TabsContent value="range" className="space-y-2 pt-2">
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <Input
                type="number"
                placeholder="Min"
                value={numberFilter.min ?? ""}
                onChange={(e) =>
                  onChange({
                    kind: "number",
                    mode: "range",
                    selectedValues: [],
                    min: e.target.value,
                    max: numberFilter.max,
                  })
                }
              />
              <span>-</span>
              <Input
                type="number"
                placeholder="Max"
                value={numberFilter.max ?? ""}
                onChange={(e) =>
                  onChange({
                    kind: "number",
                    mode: "range",
                    selectedValues: [],
                    min: numberFilter.min,
                    max: e.target.value,
                  })
                }
              />
            </div>
            <Button type="button" size="sm" variant="ghost" className="w-full" onClick={() => onChange({ kind: "number", mode: "range", selectedValues: [] })}>
              Clear Selection
            </Button>
          </TabsContent>
          <TabsContent value="min" className="space-y-2 pt-2">
            <div className="flex items-center gap-2">
              <span className="text-sm">{">="}</span>
              <Input
                type="number"
                placeholder="Value"
                value={numberFilter.value ?? ""}
                onChange={(e) =>
                  onChange({ kind: "number", mode: "min", selectedValues: [], value: e.target.value })
                }
              />
            </div>
            <Button type="button" size="sm" variant="ghost" className="w-full" onClick={() => onChange({ kind: "number", mode: "min", selectedValues: [] })}>
              Clear Selection
            </Button>
          </TabsContent>
          <TabsContent value="max" className="space-y-2 pt-2">
            <div className="flex items-center gap-2">
              <span className="text-sm">{"<="}</span>
              <Input
                type="number"
                placeholder="Value"
                value={numberFilter.value ?? ""}
                onChange={(e) =>
                  onChange({ kind: "number", mode: "max", selectedValues: [], value: e.target.value })
                }
              />
            </div>
            <Button type="button" size="sm" variant="ghost" className="w-full" onClick={() => onChange({ kind: "number", mode: "max", selectedValues: [] })}>
              Clear Selection
            </Button>
          </TabsContent>
        </Tabs>
      </div>
    );
  }

  const textFilter = filter.kind === "text" ? filter : { kind: "text" as const, selectedValues: [] };
  const merged = withBlankFirst(distinctOptions);
  const q = filterSearch.trim().toLowerCase();
  const displayed = q ? merged.filter((v) => v.toLowerCase().includes(q)) : merged;
  const ordered = [...displayed].sort((a, b) => {
    const as = textFilter.selectedValues.includes(a) ? 1 : 0;
    const bs = textFilter.selectedValues.includes(b) ? 1 : 0;
    if (as !== bs) return bs - as;
    if (a === EMPTY_FILTER_TOKEN) return -1;
    if (b === EMPTY_FILTER_TOKEN) return 1;
    return a.localeCompare(b, undefined, { numeric: true });
  });

  return (
    <div className="max-h-[min(70vh,520px)] space-y-2 overflow-y-auto p-2">
      <p className="text-xs text-slate-500 dark:text-slate-400 px-1">
        {columnTitle} — select one or more values.
      </p>
      <Command shouldFilter={false}>
        <CommandInput placeholder={`Search ${columnTitle}`} value={filterSearch} onValueChange={onFilterSearchChange} />
        <CommandList className="max-h-[min(40vh,320px)]">
          <CommandEmpty>No values found.</CommandEmpty>
          {ordered.map((value) => {
            const sel = textFilter.selectedValues.includes(value);
            return (
              <CommandItem
                key={value}
                onSelect={() => {
                  const next = sel
                    ? textFilter.selectedValues.filter((x) => x !== value)
                    : [...textFilter.selectedValues, value];
                  onChange({ kind: "text", selectedValues: next });
                }}
                className={cn(
                  "cursor-pointer hover:!bg-transparent hover:!text-foreground data-[selected=true]:!bg-transparent data-[selected=true]:!text-foreground",
                  sel
                    ? "!bg-accent !text-accent-foreground hover:!bg-accent data-[selected=true]:!bg-accent data-[selected=true]:!text-accent-foreground"
                    : "",
                )}
              >
                <span className="mr-2">{sel ? "✓" : ""}</span>
                {value === EMPTY_FILTER_TOKEN ? "(Blank)" : value}
              </CommandItem>
            );
          })}
        </CommandList>
      </Command>
      <Button type="button" size="sm" variant="ghost" className="w-full" onClick={() => onChange({ kind: "text", selectedValues: [] })}>
        Clear Selection
      </Button>
    </div>
  );
}
