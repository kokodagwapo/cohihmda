/**
 * WidgetGroup – State-of-the-art widget container with:
 *
 *  • react-grid-layout for drag-and-drop reordering AND per-widget resize
 *  • Auto-compacting grid (no gaps, Grafana-style)
 *  • Drag handle + hover toolbar (duplicate, maximize, delete)
 *  • Full-screen "Maximize" dialog for any widget
 *  • Inline-editable group title (double-click)
 *  • Collapse / expand toggle
 *  • "Add widget" picker filtered to the group's data source
 *  • DatePeriodPicker + section-specific filter controls
 *  • Layout persistence via payload (stored as grid-unit coords)
 *
 * Patterns borrowed from Grafana, Notion, Retool, and Datadog.
 */

import React, {
  useEffect,
  useCallback,
  useState,
  useMemo,
  useRef,
} from 'react';
import GridLayout, { type Layout, verticalCompactor } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  GripVertical,
  Maximize2,
  Minimize2,
  Plus,
  Trash2,
  X,
  Pencil,
  Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { DatePeriodPicker, type DateRange, type PeriodSelection, type PeriodPreset } from '@/components/ui/DatePeriodPicker';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  useWidgetSectionStore,
  type SectionFilters,
  type SectionType,
} from '@/stores/widgetSectionStore';
import {
  getWidgetDefinition,
  getWidgetsBySource,
  type WidgetDefinition,
} from '@/components/widgets/registry';
import { useWidgetData } from '@/components/widgets/data';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WidgetGroupProps {
  groupId: string;
  title: string;
  sectionType: SectionType;
  widgetIds: string[];
  /** Persisted grid layouts (grid-unit coords, keyed by sortable id) */
  widgetLayouts?: Record<string, { x: number; y: number; w: number; h: number }>;
  /** Layout version – stale layouts from older grid configs are auto-discarded */
  layoutVersion?: number;
  /** Whether the group body is collapsed */
  collapsed?: boolean;
  width: number;
  height: number;
  /** Full payload update callback (handles widgetIds, layouts, title, collapsed) */
  onUpdatePayload?: (patch: Record<string, unknown>) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GRID_COLS = 36; // 36 cols – fine granularity, safe margin budget
const ROW_HEIGHT = 16; // 16px rows – pixel-precise vertical control
const GRID_MARGIN: [number, number] = [6, 6];
const GRID_PADDING: [number, number] = [0, 0];
const HEADER_HEIGHT = 90; // approx header+filters height
/**
 * Minimum content width guaranteed to the grid.
 * Must be > margin * (GRID_COLS + 1) to avoid negative column widths.
 * 6 * 37 = 222px, so 400px gives plenty of room.
 */
const MIN_GRID_WIDTH = 400;
/** Bump this any time you change GRID_COLS / ROW_HEIGHT so stale saved layouts get discarded */
const LAYOUT_VERSION = 6;

// ---------------------------------------------------------------------------
// Section-specific filter options
// ---------------------------------------------------------------------------

const DATE_FIELD_OPTIONS = [
  { value: 'application_date', label: 'Application Date' },
  { value: 'funding_date', label: 'Funding Date' },
  { value: 'started_date', label: 'Started Date' },
  { value: 'closing_date', label: 'Closing Date' },
  { value: 'lock_date', label: 'Lock Date' },
];

const APPLICATION_TYPE_OPTIONS = [
  { value: 'Applications Taken', label: 'Applications Taken' },
  { value: 'Funded Production', label: 'Funded Production' },
  { value: 'Lost Opportunities', label: 'Lost Opportunities' },
  { value: 'All Loans', label: 'All Loans' },
];

const ACTOR_TYPE_OPTIONS = [
  { value: 'loan_officer', label: 'By Loan Officer' },
  { value: 'branch', label: 'By Branch' },
];

const SECTION_COLORS: Record<SectionType, { border: string; bg: string; accent: string; dot: string }> = {
  'company-scorecard':    { border: 'border-indigo-400/50',  bg: 'bg-indigo-50/50 dark:bg-indigo-950/20',  accent: 'text-indigo-600 dark:text-indigo-400',  dot: 'bg-indigo-500' },
  'credit-risk':          { border: 'border-emerald-400/50', bg: 'bg-emerald-50/50 dark:bg-emerald-950/20', accent: 'text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500' },
  'sales-scorecard':      { border: 'border-violet-400/50',  bg: 'bg-violet-50/50 dark:bg-violet-950/20',  accent: 'text-violet-600 dark:text-violet-400',  dot: 'bg-violet-500' },
  'operations-scorecard': { border: 'border-amber-400/50',   bg: 'bg-amber-50/50 dark:bg-amber-950/20',   accent: 'text-amber-600 dark:text-amber-400',   dot: 'bg-amber-500' },
  'operations-trends':    { border: 'border-orange-400/50',  bg: 'bg-orange-50/50 dark:bg-orange-950/20',  accent: 'text-orange-600 dark:text-orange-400',  dot: 'bg-orange-500' },
  'sales-trends':         { border: 'border-fuchsia-400/50', bg: 'bg-fuchsia-50/50 dark:bg-fuchsia-950/20', accent: 'text-fuchsia-600 dark:text-fuchsia-400', dot: 'bg-fuchsia-500' },
  'funnel':               { border: 'border-sky-400/50',     bg: 'bg-sky-50/50 dark:bg-sky-950/20',       accent: 'text-sky-600 dark:text-sky-400',       dot: 'bg-sky-500' },
  'top-tiering-comparison': { border: 'border-cyan-400/50',  bg: 'bg-cyan-50/50 dark:bg-cyan-950/20',     accent: 'text-cyan-600 dark:text-cyan-400',     dot: 'bg-cyan-500' },
  'leaderboard':          { border: 'border-rose-400/50',    bg: 'bg-rose-50/50 dark:bg-rose-950/20',     accent: 'text-rose-600 dark:text-rose-400',     dot: 'bg-rose-500' },
};

// Map SectionType → DataSourceId for add-widget filtering
const SECTION_TO_SOURCE: Record<SectionType, string> = {
  'company-scorecard':    'company-scorecard',
  'credit-risk':          'credit-risk',
  'sales-scorecard':      'sales-scorecard',
  'operations-scorecard': 'operations-scorecard',
  'operations-trends':    'operations-trends',
  'sales-trends':         'sales-trends',
  'funnel':               'funnel',
  'top-tiering-comparison': 'top-tiering-comparison',
  'leaderboard':          'dashboard-metrics',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Direct grid-unit sizing per widget category.
// Tuned to match actual dashboard page layouts.
// At 36 cols / 16px rows on a ~1000px container:
//   1 col ≈ 27px,  1 row = 16px
//   KPI  : 5×4  – 7 KPIs fill one row (5×7=35 cols), ~135×64px
//   chart: 18×12 – 2 charts side by side (18×2=36), ~486×192px
//   distribution: 12×10 – 3 per row, ~324×160px
//   table: 36×16 – full width, ~972×256px
// ---------------------------------------------------------------------------

interface GridSize { w: number; h: number; minW: number; minH: number }

const GRID_SIZES: Record<string, GridSize> = {
  kpi:          { w: 5,  h: 4,  minW: 2,  minH: 2 },
  chart:        { w: 18, h: 12, minW: 8,  minH: 6 },
  distribution: { w: 12, h: 10, minW: 6,  minH: 5 },
  table:        { w: 36, h: 16, minW: 18, minH: 8 },
};
const DEFAULT_GRID: GridSize = { w: 9, h: 8, minW: 4, minH: 4 };

function getGridSize(def: ReturnType<typeof getWidgetDefinition>): GridSize {
  return (def && GRID_SIZES[def.category]) || DEFAULT_GRID;
}

/** Build react-grid-layout Layout from widget IDs.
 *  Saved layouts are only used when `layoutVersion` matches `LAYOUT_VERSION`.
 */
function buildDefaultLayout(
  widgetIds: string[],
  savedLayouts?: Record<string, { x: number; y: number; w: number; h: number }>,
  layoutVersion?: number,
): Layout[] {
  const validSaved =
    savedLayouts && layoutVersion === LAYOUT_VERSION ? savedLayouts : undefined;

  const layout: Layout[] = [];
  let cx = 0;
  let cy = 0;
  let rowMaxH = 0;

  widgetIds.forEach((defId, idx) => {
    const key = `${defId}__${idx}`;
    const def = getWidgetDefinition(defId);
    const gs = getGridSize(def);

    if (validSaved?.[key]) {
      const s = validSaved[key];
      layout.push({ i: key, x: s.x, y: s.y, w: s.w, h: s.h, minW: gs.minW, minH: gs.minH });
      return;
    }

    if (cx + gs.w > GRID_COLS) {
      cx = 0;
      cy += rowMaxH;
      rowMaxH = 0;
    }

    layout.push({ i: key, x: cx, y: cy, w: gs.w, h: gs.h, minW: gs.minW, minH: gs.minH });
    cx += gs.w;
    rowMaxH = Math.max(rowMaxH, gs.h);
  });

  return layout;
}

/** Extract grid-unit layout map for persistence */
function layoutToMap(layout: Layout[]): Record<string, { x: number; y: number; w: number; h: number }> {
  const map: Record<string, { x: number; y: number; w: number; h: number }> = {};
  for (const item of layout) {
    map[item.i] = { x: item.x, y: item.y, w: item.w, h: item.h };
  }
  return map;
}

// ---------------------------------------------------------------------------
// Grid cell widget wrapper (the content inside each grid cell)
// ---------------------------------------------------------------------------

function GridCellWidget({
  definitionId,
  width,
  height,
  onDelete,
  onDuplicate,
  onMaximize,
}: {
  definitionId: string;
  width: number;
  height: number;
  onDelete: () => void;
  onDuplicate: () => void;
  onMaximize: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const definition = getWidgetDefinition(definitionId);

  if (!definition) {
    return (
      <div className="h-full w-full flex items-center justify-center text-xs text-slate-400 dark:text-slate-500 p-3 border border-dashed border-slate-200 dark:border-slate-700 rounded-lg relative">
        Widget not found: {definitionId}
        <button
          type="button"
          onClick={onDelete}
          className="absolute top-1 right-1 p-1 rounded bg-red-500/90 text-white hover:bg-red-600 text-xs canvas-interactive"
          title="Remove widget"
          aria-label="Remove widget"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div
      className="h-full w-full relative rounded-lg overflow-hidden flex flex-col group/widget"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Always-visible drag handle strip – spans the full top of the widget */}
      <div
        className="widget-drag-handle flex items-center justify-between h-5 min-h-[20px] px-1.5 bg-slate-50/80 dark:bg-slate-800/60 border-b border-slate-100 dark:border-slate-700/40 cursor-grab active:cursor-grabbing select-none transition-colors hover:bg-slate-100 dark:hover:bg-slate-700/60"
        title="Drag to reorder"
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-3 w-3 text-slate-300 dark:text-slate-600" />

        {/* Action buttons appear on hover (inside the drag bar so they stay accessible) */}
        <div className={cn(
          'flex items-center gap-0.5 transition-opacity',
          hovered ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
            className="p-0.5 rounded text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:text-indigo-400 dark:hover:bg-indigo-900/30 canvas-interactive transition-colors"
            title="Duplicate"
            aria-label="Duplicate widget"
          >
            <Copy className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onMaximize(); }}
            className="p-0.5 rounded text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:text-indigo-400 dark:hover:bg-indigo-900/30 canvas-interactive transition-colors"
            title="Maximize"
            aria-label="Maximize widget"
          >
            <Maximize2 className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="p-0.5 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:text-red-400 dark:hover:bg-red-900/30 canvas-interactive transition-colors"
            title="Remove from group"
            aria-label="Remove from group"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Widget content – fills the remaining space below the drag bar */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <GridCellWidgetData definition={definition} width={width} height={height - 20} />
      </div>
    </div>
  );
}

function GridCellWidgetData({
  definition,
  width,
  height,
}: {
  definition: NonNullable<ReturnType<typeof getWidgetDefinition>>;
  width: number;
  height: number;
}) {
  const { data, loading, error } = useWidgetData(
    definition.dataSource,
    definition.dataSelector,
  );

  const Component = definition.component;

  return (
    <div className="h-full w-full">
      <Component
        data={data}
        loading={loading}
        error={error}
        width={width}
        height={height}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Maximize Dialog – renders a single widget at full screen
// ---------------------------------------------------------------------------

function MaximizeDialog({
  definitionId,
  open,
  onClose,
}: {
  definitionId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const definition = definitionId ? getWidgetDefinition(definitionId) : null;

  if (!definition) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[90vw] w-[90vw] max-h-[90vh] h-[85vh] p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-5 pb-3 border-b border-slate-200 dark:border-slate-700 shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Minimize2 className="h-4 w-4 text-slate-400" />
            {definition.name}
            <span className="text-xs font-normal text-slate-400 ml-2">
              {definition.group} &middot; {definition.category}
            </span>
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-auto p-6">
          <MaximizeDialogContent definition={definition} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MaximizeDialogContent({
  definition,
}: {
  definition: NonNullable<ReturnType<typeof getWidgetDefinition>>;
}) {
  const { data, loading, error } = useWidgetData(
    definition.dataSource,
    definition.dataSelector,
  );

  const Component = definition.component;

  return (
    <Component
      data={data}
      loading={loading}
      error={error}
      width={1200}
      height={700}
    />
  );
}

// ---------------------------------------------------------------------------
// Add Widget Popover
// ---------------------------------------------------------------------------

function AddWidgetPicker({
  sectionType,
  existingIds,
  onAdd,
  onClose,
}: {
  sectionType: SectionType;
  existingIds: string[];
  onAdd: (defId: string) => void;
  onClose: () => void;
}) {
  const sourceId = SECTION_TO_SOURCE[sectionType];
  const available = useMemo(() => getWidgetsBySource(sourceId), [sourceId]);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return available;
    const q = search.toLowerCase();
    return available.filter(
      (w) =>
        w.name.toLowerCase().includes(q) ||
        w.category.toLowerCase().includes(q) ||
        w.description.toLowerCase().includes(q),
    );
  }, [available, search]);

  // Group by category
  const grouped = useMemo(() => {
    const map = new Map<string, WidgetDefinition[]>();
    for (const w of filtered) {
      if (!map.has(w.category)) map.set(w.category, []);
      map.get(w.category)!.push(w);
    }
    return map;
  }, [filtered]);

  return (
    <div className="absolute top-full left-0 mt-1 z-50 w-72 max-h-80 overflow-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl canvas-interactive">
      {/* Search */}
      <div className="sticky top-0 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 p-2">
        <input
          autoFocus
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search widgets…"
          title="Search available widgets"
          className="w-full h-7 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 text-xs text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
        />
      </div>

      {/* Widget list */}
      <div className="p-1">
        {[...grouped.entries()].map(([category, widgets]) => (
          <div key={category}>
            <div className="px-2 py-1 text-[9px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
              {category}
            </div>
            {widgets.map((w) => {
              const alreadyIn = existingIds.includes(w.id);
              return (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => { onAdd(w.id); onClose(); }}
                  className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-slate-50 dark:hover:bg-slate-800 text-xs transition-colors"
                >
                  <span className="flex-1 font-medium text-slate-700 dark:text-slate-200 truncate">
                    {w.name}
                  </span>
                  {alreadyIn && (
                    <span className="text-[8px] font-medium text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 rounded px-1 py-0.5">
                      IN GROUP
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
        {filtered.length === 0 && (
          <p className="text-xs text-slate-400 dark:text-slate-500 text-center py-4">
            No widgets found
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function WidgetGroup({
  groupId,
  title,
  sectionType,
  widgetIds,
  widgetLayouts,
  layoutVersion: layoutVersionProp,
  collapsed: collapsedProp,
  width,
  height,
  onUpdatePayload,
}: WidgetGroupProps) {
  const registerSection = useWidgetSectionStore((s) => s.registerSection);
  const updateFilters = useWidgetSectionStore((s) => s.updateFilters);
  const filters = useWidgetSectionStore((s) => s.getFilters(groupId));

  // Local state
  const [collapsed, setCollapsed] = useState(collapsedProp ?? false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [localTitle, setLocalTitle] = useState(title);
  const [maximizedWidget, setMaximizedWidget] = useState<string | null>(null);
  const [showAddPicker, setShowAddPicker] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const addPickerRef = useRef<HTMLDivElement>(null);

  // Sync collapsed with prop
  useEffect(() => {
    if (collapsedProp !== undefined) setCollapsed(collapsedProp);
  }, [collapsedProp]);

  // Register this group as a section on mount
  useEffect(() => {
    registerSection(groupId, sectionType);
  }, [groupId, sectionType, registerSection]);

  // Auto-focus title input when renaming
  useEffect(() => {
    if (isRenaming) titleInputRef.current?.focus();
  }, [isRenaming]);

  // Close add picker on outside click
  useEffect(() => {
    if (!showAddPicker) return;
    const handleClick = (e: MouseEvent) => {
      if (addPickerRef.current && !addPickerRef.current.contains(e.target as Node)) {
        setShowAddPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showAddPicker]);

  // ─── Payload updater (merges into existing payload) ───
  const patchPayload = useCallback(
    (patch: Record<string, unknown>) => {
      onUpdatePayload?.(patch);
    },
    [onUpdatePayload],
  );

  // ─── Grid layout ───
  const contentWidth = Math.max(width - 24, MIN_GRID_WIDTH);

  const gridLayout = useMemo(
    () => buildDefaultLayout(widgetIds, widgetLayouts, layoutVersionProp),
    [widgetIds, widgetLayouts, layoutVersionProp],
  );

  // Only persist layout on EXPLICIT user interaction (drag / resize end).
  // We deliberately do NOT use onLayoutChange because it fires on mount and
  // can corrupt the layout before the container dimensions are settled.
  const saveLayout = useCallback(
    (newLayout: Layout[]) => {
      patchPayload({ widgetLayouts: layoutToMap(newLayout), layoutVersion: LAYOUT_VERSION });
    },
    [patchPayload],
  );

  // ─── Widget management ───
  const handleDelete = useCallback(
    (index: number) => {
      const next = widgetIds.filter((_, i) => i !== index);
      // Also clean up saved layout
      const key = `${widgetIds[index]}__${index}`;
      const nextLayouts = { ...widgetLayouts };
      delete nextLayouts[key];
      patchPayload({ widgetIds: next, widgetLayouts: nextLayouts, layoutVersion: LAYOUT_VERSION });
    },
    [widgetIds, widgetLayouts, patchPayload],
  );

  const handleDuplicate = useCallback(
    (index: number) => {
      const defId = widgetIds[index];
      const next = [...widgetIds];
      next.splice(index + 1, 0, defId);
      // Don't copy layout – let auto-layout handle the new instance
      patchPayload({ widgetIds: next });
    },
    [widgetIds, patchPayload],
  );

  const handleAddWidget = useCallback(
    (defId: string) => {
      const next = [...widgetIds, defId];
      patchPayload({ widgetIds: next });
    },
    [widgetIds, patchPayload],
  );

  // ─── Title management ───
  const commitTitle = useCallback(() => {
    setIsRenaming(false);
    if (localTitle.trim() && localTitle !== title) {
      patchPayload({ title: localTitle.trim() });
    } else {
      setLocalTitle(title);
    }
  }, [localTitle, title, patchPayload]);

  // ─── Collapse management ───
  const toggleCollapse = useCallback(() => {
    const next = !collapsed;
    setCollapsed(next);
    patchPayload({ collapsed: next });
  }, [collapsed, patchPayload]);

  // ─── Filter handlers ───
  const handleYearChange = useCallback(
    (year: number) => updateFilters(groupId, { year, dateRange: undefined }),
    [groupId, updateFilters],
  );

  const handleDateRangeChange = useCallback(
    (range: DateRange) => updateFilters(groupId, { dateRange: range }),
    [groupId, updateFilters],
  );

  const handlePeriodChange = useCallback(
    (selection: PeriodSelection) => {
      updateFilters(groupId, {
        periodSelection: selection,
        dateRange: selection.dateRange,
        ...(selection.year != null ? { year: selection.year } : {}),
      });
    },
    [groupId, updateFilters],
  );

  // ─── Per-section preset config ───
  const sectionPresetConfig = useMemo((): { presets?: PeriodPreset[]; showYears?: boolean } => {
    switch (sectionType) {
      case 'operations-scorecard':
        return { presets: ['rolling-3', 'rolling-6', 'rolling-12'], showYears: false };
      case 'sales-trends':
        return { presets: ['rolling-3', 'rolling-6'], showYears: false };
      case 'top-tiering-comparison':
        return { presets: ['mtd', 'qtd', 'ytd', 'last-month', 'last-quarter', 'last-year', 'trailing-12'], showYears: false };
      case 'leaderboard':
        return { presets: ['mtd', 'qtd', 'last-month', 'last-quarter', 'last-year'], showYears: false };
      default:
        return {}; // default behavior: rolling-13, rolling-12 + year buttons
    }
  }, [sectionType]);

  const update = useCallback(
    (partial: Partial<SectionFilters>) => updateFilters(groupId, partial),
    [groupId, updateFilters],
  );

  // ─── Keyboard shortcuts ───
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Escape closes add picker
      if (e.key === 'Escape' && showAddPicker) {
        setShowAddPicker(false);
        e.stopPropagation();
      }
    },
    [showAddPicker],
  );

  const colors = SECTION_COLORS[sectionType];

  return (
    <div
      className={cn(
        'h-full w-full flex flex-col rounded-xl border-2 overflow-hidden',
        colors.border,
        'bg-white dark:bg-slate-900 shadow-sm',
      )}
      onKeyDown={handleKeyDown}
    >
      {/* ═══════ Group header ═══════ */}
      <div className={cn('shrink-0 border-b border-slate-200/70 dark:border-slate-700/70', colors.bg)}>
        {/* Title row */}
        <div className="flex items-center gap-2 px-3 py-2">
          {/* Collapse toggle */}
          <button
            type="button"
            onClick={toggleCollapse}
            className="p-0.5 rounded hover:bg-black/5 dark:hover:bg-white/5 transition-colors canvas-interactive"
            title={collapsed ? 'Expand group' : 'Collapse group'}
            aria-label={collapsed ? 'Expand group' : 'Collapse group'}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4 text-slate-500" />
            ) : (
              <ChevronDown className="h-4 w-4 text-slate-500" />
            )}
          </button>

          <div className={cn('w-2 h-2 rounded-full shrink-0', colors.dot)} />

          {/* Editable title */}
          {isRenaming ? (
            <div className="flex items-center gap-1 flex-1 min-w-0">
              <input
                ref={titleInputRef}
                type="text"
                title="Group title"
                value={localTitle}
                onChange={(e) => setLocalTitle(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitTitle();
                  if (e.key === 'Escape') { setLocalTitle(title); setIsRenaming(false); }
                }}
                className="flex-1 min-w-0 text-sm font-semibold bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500/50 canvas-interactive"
              />
              <button
                type="button"
                onClick={commitTitle}
                className="p-0.5 rounded text-green-600 hover:bg-green-50 dark:hover:bg-green-900/30 canvas-interactive"
                aria-label="Save title"
              >
                <Check className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <h3
              className={cn('text-sm font-semibold tracking-tight flex-1 min-w-0 truncate cursor-pointer', colors.accent)}
              onDoubleClick={() => { setLocalTitle(title); setIsRenaming(true); }}
              title="Double-click to rename"
            >
              {title}
            </h3>
          )}

          {!isRenaming && (
            <button
              type="button"
              onClick={() => { setLocalTitle(title); setIsRenaming(true); }}
              className="p-0.5 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-black/5 dark:hover:bg-white/5 canvas-interactive transition-colors"
              title="Rename group"
              aria-label="Rename group"
            >
              <Pencil className="h-3 w-3" />
            </button>
          )}

          {/* Widget count */}
          <span className="text-[9px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider shrink-0">
            {widgetIds.length} widget{widgetIds.length !== 1 ? 's' : ''}
          </span>

          {/* Add widget */}
          <div className="relative shrink-0" ref={addPickerRef}>
            <button
              type="button"
              onClick={() => setShowAddPicker((v) => !v)}
              className={cn(
                'flex items-center gap-1 h-6 px-2 rounded-md border text-[10px] font-medium canvas-interactive transition-colors',
                showAddPicker
                  ? 'border-blue-400 bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400'
                  : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600 hover:text-slate-700 dark:hover:text-slate-200',
              )}
              title="Add widget to group"
              aria-label="Add widget"
            >
              <Plus className="h-3 w-3" />
              Add
            </button>
            {showAddPicker && (
              <AddWidgetPicker
                sectionType={sectionType}
                existingIds={widgetIds}
                onAdd={handleAddWidget}
                onClose={() => setShowAddPicker(false)}
              />
            )}
          </div>
        </div>

        {/* Date period picker + extra filters (only show when expanded) */}
        {!collapsed && (
          <div className="flex items-center gap-2 px-3 pb-2.5 flex-wrap">
            <DatePeriodPicker
              year={filters.year}
              onYearChange={handleYearChange}
              onDateRangeChange={handleDateRangeChange}
              onPeriodChange={handlePeriodChange}
              presets={sectionPresetConfig.presets}
              showYears={sectionPresetConfig.showYears}
              size="sm"
              showLabel={false}
              yearsToShow={4}
            />

            {sectionType === 'company-scorecard' && (
              <FilterSelect
                value={filters.dateField}
                onChange={(v) => update({ dateField: v })}
                options={DATE_FIELD_OPTIONS}
                label="Date Field"
              />
            )}

            {sectionType === 'credit-risk' && (
              <FilterSelect
                value={filters.applicationType}
                onChange={(v) => update({ applicationType: v })}
                options={APPLICATION_TYPE_OPTIONS}
                label="Type"
              />
            )}

            {sectionType === 'sales-scorecard' && (
              <FilterSelect
                value={filters.actorType}
                onChange={(v) => update({ actorType: v as 'branch' | 'loan_officer' })}
                options={ACTOR_TYPE_OPTIONS}
                label="View"
              />
            )}
          </div>
        )}
      </div>

      {/* ═══════ Widget grid (collapsible) ═══════ */}
      {!collapsed && (
        <div className="flex-1 min-h-0 overflow-auto px-3 py-2 canvas-interactive">
          <GridLayout
            className="layout"
            layout={gridLayout}
            width={contentWidth}
            gridConfig={{
              cols: GRID_COLS,
              rowHeight: ROW_HEIGHT,
              margin: GRID_MARGIN,
              containerPadding: GRID_PADDING,
              maxRows: Infinity,
            }}
            compactor={verticalCompactor}
            dragConfig={{
              enabled: true,
              bounded: false,
              handle: '.widget-drag-handle',
              threshold: 3,
            }}
            resizeConfig={{
              enabled: true,
              handles: ['se'],
            }}
            onDragStop={saveLayout}
            onResizeStop={saveLayout}
          >
            {widgetIds.map((defId, idx) => {
              const key = `${defId}__${idx}`;
              const layoutItem = gridLayout.find((l) => l.i === key);
              const cellW = layoutItem
                ? layoutItem.w * (contentWidth / GRID_COLS) - GRID_MARGIN[0]
                : 200;
              const cellH = layoutItem
                ? layoutItem.h * ROW_HEIGHT - GRID_MARGIN[1]
                : 200;

              return (
                <div key={key} className="rounded-lg bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-700/60 shadow-sm overflow-hidden transition-shadow hover:shadow-md">
                  <GridCellWidget
                    definitionId={defId}
                    width={cellW}
                    height={cellH}
                    onDelete={() => handleDelete(idx)}
                    onDuplicate={() => handleDuplicate(idx)}
                    onMaximize={() => setMaximizedWidget(defId)}
                  />
                </div>
              );
            })}
          </GridLayout>

          {widgetIds.length === 0 && (
            <div className="w-full py-12 text-center text-sm text-slate-400 dark:text-slate-500">
              <Plus className="w-8 h-8 mx-auto mb-2 opacity-40" />
              No widgets yet. Click <strong>+ Add</strong> above to get started.
            </div>
          )}
        </div>
      )}

      {/* Collapsed placeholder */}
      {collapsed && (
        <div className="px-4 py-2 text-xs text-slate-400 dark:text-slate-500 italic">
          {widgetIds.length} widget{widgetIds.length !== 1 ? 's' : ''} &middot; click the arrow to expand
        </div>
      )}

      {/* ═══════ Maximize dialog ═══════ */}
      <MaximizeDialog
        definitionId={maximizedWidget}
        open={maximizedWidget !== null}
        onClose={() => setMaximizedWidget(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compact filter dropdown
// ---------------------------------------------------------------------------

function FilterSelect({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  label: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[9px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider">
        {label}
      </span>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="appearance-none h-6 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-2 pr-5 text-[11px] font-medium text-slate-700 dark:text-slate-200 cursor-pointer hover:border-slate-300 dark:hover:border-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500/50 canvas-interactive"
          title={label}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-1 top-1/2 -translate-y-1/2 h-2.5 w-2.5 text-slate-400 pointer-events-none" />
      </div>
    </div>
  );
}
