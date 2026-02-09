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
 *  • Polymorphic items: supports both registry widgets AND Cohi SQL widgets
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
  FolderInput,
  GripVertical,
  Maximize2,
  Minimize2,
  Plus,
  Trash2,
  X,
  Pencil,
  Check,
  Sparkles,
  Calendar,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { DatePeriodPicker, type DateRange, type PeriodSelection, type PeriodPreset, computePresetDateRange } from '@/components/ui/DatePeriodPicker';
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
import { CohiWidgetRenderer } from '@/components/workbench/canvas/CohiWidgetRenderer';
import { WidgetDataProvider } from '@/components/widgets/data';
import { useTenantStore } from '@/stores/tenantStore';
import type { GroupWidgetItem } from '@/components/workbench/canvas/types';
import type { DateFilter } from '@/hooks/useCohiWidgetData';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WidgetGroupProps {
  groupId: string;
  title: string;
  sectionType: SectionType;
  /** @deprecated Use `items` instead – kept for backward compat */
  widgetIds: string[];
  /** Mixed items: registry + cohi_widget.  Takes precedence over widgetIds. */
  items?: GroupWidgetItem[];
  /** Persisted grid layouts (grid-unit coords, keyed by sortable id) */
  widgetLayouts?: Record<string, { x: number; y: number; w: number; h: number }>;
  /** Layout version – stale layouts from older grid configs are auto-discarded */
  layoutVersion?: number;
  /** Whether the group body is collapsed */
  collapsed?: boolean;
  width: number;
  height: number;
  /** Full payload update callback (handles widgetIds, items, layouts, title, collapsed) */
  onUpdatePayload?: (patch: Record<string, unknown>) => void;
  /** Other widget groups on the canvas that items can be moved to */
  otherGroups?: { id: string; title: string }[];
  /** Called when a user moves an item out of this group into another group */
  onMoveItemOut?: (item: GroupWidgetItem, targetGroupId: string) => void;
  /** Persisted filter state restored from saved canvas */
  savedFilters?: Partial<import('@/stores/widgetSectionStore').SectionFilters>;
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
const LAYOUT_VERSION = 7; // bumped from 6 → 7 for items migration

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
// Helpers – convert legacy widgetIds to GroupWidgetItem[]
// ---------------------------------------------------------------------------

function normalizeItems(widgetIds: string[], items?: GroupWidgetItem[]): GroupWidgetItem[] {
  if (items && items.length > 0) return items;
  return widgetIds.map((defId) => ({ kind: 'registry' as const, defId }));
}

/** Stable key for a GroupWidgetItem at a given index */
function itemKey(item: GroupWidgetItem, idx: number): string {
  if (item.kind === 'registry') return `${item.defId}__${idx}`;
  return `cohi__${item.id}__${idx}`;
}

// ---------------------------------------------------------------------------
// Direct grid-unit sizing per widget category.
// ---------------------------------------------------------------------------

interface GridSize { w: number; h: number; minW: number; minH: number }

const GRID_SIZES: Record<string, GridSize> = {
  kpi:          { w: 5,  h: 4,  minW: 2,  minH: 2 },
  chart:        { w: 18, h: 12, minW: 8,  minH: 6 },
  distribution: { w: 12, h: 10, minW: 6,  minH: 5 },
  table:        { w: 36, h: 16, minW: 18, minH: 8 },
  cohi:         { w: 18, h: 14, minW: 8,  minH: 8 },
};
const DEFAULT_GRID: GridSize = { w: 9, h: 8, minW: 4, minH: 4 };

function getGridSizeForItem(item: GroupWidgetItem): GridSize {
  if (item.kind === 'cohi') return GRID_SIZES.cohi;
  const def = getWidgetDefinition(item.defId);
  return (def && GRID_SIZES[def.category]) || DEFAULT_GRID;
}

/** Build react-grid-layout Layout from items.
 *  Saved layouts are only used when `layoutVersion` matches `LAYOUT_VERSION`.
 *  Items without a saved layout are placed AFTER (below) all saved items so
 *  that newly added / moved widgets appear at the end of the group.
 */
function buildDefaultLayout(
  items: GroupWidgetItem[],
  savedLayouts?: Record<string, { x: number; y: number; w: number; h: number }>,
  layoutVersion?: number,
): Layout[] {
  const validSaved =
    savedLayouts && layoutVersion === LAYOUT_VERSION ? savedLayouts : undefined;

  // First pass: place items that have saved positions and track the max Y extent
  const layout: Layout[] = [];
  let maxYBottom = 0; // bottom-most Y + H of any saved item

  const unsavedIndices: number[] = [];

  items.forEach((item, idx) => {
    const key = itemKey(item, idx);
    const gs = getGridSizeForItem(item);

    if (validSaved?.[key]) {
      const s = validSaved[key];
      layout.push({ i: key, x: s.x, y: s.y, w: s.w, h: s.h, minW: gs.minW, minH: gs.minH });
      maxYBottom = Math.max(maxYBottom, s.y + s.h);
    } else {
      unsavedIndices.push(idx);
    }
  });

  // Second pass: place unsaved items starting after all saved items
  let cx = 0;
  let cy = maxYBottom;
  let rowMaxH = 0;

  unsavedIndices.forEach((idx) => {
    const item = items[idx];
    const key = itemKey(item, idx);
    const gs = getGridSizeForItem(item);

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
  for (const l of layout) {
    map[l.i] = { x: l.x, y: l.y, w: l.w, h: l.h };
  }
  return map;
}

// ---------------------------------------------------------------------------
// Grid cell widget wrapper – renders a single item inside the grid
// ---------------------------------------------------------------------------

function GridCellWidget({
  item,
  width,
  height,
  dateFilter,
  onDelete,
  onDuplicate,
  onMaximize,
  otherGroups,
  onMoveToGroup,
  onVizTypeChange,
}: {
  item: GroupWidgetItem;
  width: number;
  height: number;
  dateFilter: DateFilter | null;
  onDelete: () => void;
  onDuplicate: () => void;
  onMaximize: () => void;
  otherGroups?: { id: string; title: string }[];
  onMoveToGroup?: (targetGroupId: string) => void;
  onVizTypeChange?: (type: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [moveMenuOpen, setMoveMenuOpen] = useState(false);

  const isValid =
    item.kind === 'cohi' ||
    (item.kind === 'registry' && !!getWidgetDefinition(item.defId));

  if (!isValid) {
    return (
      <div className="h-full w-full flex items-center justify-center text-xs text-slate-400 dark:text-slate-500 p-3 border border-dashed border-slate-200 dark:border-slate-700 rounded-lg relative">
        Widget not found: {item.kind === 'registry' ? item.defId : item.id}
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

  const hasOtherGroups = otherGroups && otherGroups.length > 0 && onMoveToGroup;

  return (
    <div
      className="h-full w-full relative rounded-lg overflow-hidden flex flex-col group/widget"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setMoveMenuOpen(false); }}
    >
      {/* Always-visible drag handle strip */}
      <div
        className="widget-drag-handle flex items-center justify-between h-5 min-h-[20px] px-1.5 bg-slate-50/80 dark:bg-slate-800/60 border-b border-slate-100 dark:border-slate-700/40 cursor-grab active:cursor-grabbing select-none transition-colors hover:bg-slate-100 dark:hover:bg-slate-700/60"
        title="Drag to reorder"
        aria-label="Drag to reorder"
      >
        <div className="flex items-center gap-1">
          <GripVertical className="h-3 w-3 text-slate-300 dark:text-slate-600" />
          {item.kind === 'cohi' && (
            <Sparkles className="h-2.5 w-2.5 text-indigo-400" />
          )}
        </div>

        {/* Action buttons on hover */}
        <div className={cn(
          'flex items-center gap-0.5 transition-opacity',
          hovered ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}>
          {/* Move to group popover */}
          {hasOtherGroups && (
            <div className="relative">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setMoveMenuOpen((v) => !v); }}
                className="p-0.5 rounded text-slate-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:text-amber-400 dark:hover:bg-amber-900/30 canvas-interactive transition-colors"
                title="Move to another group"
                aria-label="Move to another group"
              >
                <FolderInput className="h-3 w-3" />
              </button>
              {moveMenuOpen && (
                <div
                  className="absolute right-0 top-full mt-1 z-50 min-w-[160px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg py-1"
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <div className="px-2 py-1 text-[10px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Move to group
                  </div>
                  {otherGroups!.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      className="w-full text-left px-2 py-1.5 text-xs text-slate-700 dark:text-slate-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors canvas-interactive"
                      onClick={(e) => {
                        e.stopPropagation();
                        onMoveToGroup!(g.id);
                        setMoveMenuOpen(false);
                      }}
                    >
                      {g.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
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

      {/* Widget content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {item.kind === 'registry' ? (
          <GridCellRegistryWidget defId={item.defId} width={width} height={height - 20} />
        ) : (
          <GridCellCohiWidget item={item} width={width} height={height - 20} dateFilter={dateFilter} onVizTypeChange={onVizTypeChange} />
        )}
      </div>
    </div>
  );
}

function GridCellRegistryWidget({
  defId,
  width,
  height,
}: {
  defId: string;
  width: number;
  height: number;
}) {
  const definition = getWidgetDefinition(defId);
  if (!definition) return null;

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

function GridCellCohiWidget({
  item,
  width,
  height,
  dateFilter,
  onVizTypeChange,
}: {
  item: Extract<GroupWidgetItem, { kind: 'cohi' }>;
  width: number;
  height: number;
  dateFilter: DateFilter | null;
  onVizTypeChange?: (type: string) => void;
}) {
  const { selectedTenantId } = useTenantStore();
  return (
    <div className="h-full w-full">
      <CohiWidgetRenderer
        sql={item.sql}
        vizConfig={item.vizConfig}
        title={item.title}
        explanation={item.explanation}
        tenantId={selectedTenantId}
        width={width}
        height={height}
        groupDateFilter={dateFilter}
        onVizTypeChange={onVizTypeChange}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Maximize Dialog
// ---------------------------------------------------------------------------

function MaximizeDialog({
  item,
  open,
  onClose,
  dateFilter,
}: {
  item: GroupWidgetItem | null;
  open: boolean;
  onClose: () => void;
  dateFilter: DateFilter | null;
}) {
  if (!item) return null;

  const title =
    item.kind === 'registry'
      ? (getWidgetDefinition(item.defId)?.name || item.defId)
      : item.title;

  const subtitle =
    item.kind === 'registry'
      ? (() => {
          const def = getWidgetDefinition(item.defId);
          return def ? `${def.group} \u00b7 ${def.category}` : '';
        })()
      : 'Cohi SQL Widget';

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[90vw] w-[90vw] max-h-[90vh] h-[85vh] p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-5 pb-3 border-b border-slate-200 dark:border-slate-700 shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Minimize2 className="h-4 w-4 text-slate-400" />
            {title}
            <span className="text-xs font-normal text-slate-400 ml-2">
              {subtitle}
            </span>
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-auto p-6">
          {item.kind === 'registry' ? (
            <MaximizeRegistryWidget defId={item.defId} />
          ) : (
            <MaximizeCohiWidget item={item} dateFilter={dateFilter} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MaximizeRegistryWidget({ defId }: { defId: string }) {
  const definition = getWidgetDefinition(defId);
  if (!definition) return null;

  const { data, loading, error } = useWidgetData(
    definition.dataSource,
    definition.dataSelector,
  );

  const Component = definition.component;
  return <Component data={data} loading={loading} error={error} width={1200} height={700} />;
}

function MaximizeCohiWidget({
  item,
  dateFilter,
}: {
  item: Extract<GroupWidgetItem, { kind: 'cohi' }>;
  dateFilter: DateFilter | null;
}) {
  const { selectedTenantId } = useTenantStore();
  return (
    <CohiWidgetRenderer
      sql={item.sql}
      vizConfig={item.vizConfig}
      title={item.title}
      explanation={item.explanation}
      tenantId={selectedTenantId}
      width={1200}
      height={700}
      groupDateFilter={dateFilter}
    />
  );
}

// ---------------------------------------------------------------------------
// Add Widget Popover
// ---------------------------------------------------------------------------

function AddWidgetPicker({
  sectionType,
  existingItems,
  onAddRegistry,
  onClose,
}: {
  sectionType: SectionType;
  existingItems: GroupWidgetItem[];
  onAddRegistry: (defId: string) => void;
  onClose: () => void;
}) {
  const sourceId = SECTION_TO_SOURCE[sectionType];
  const available = useMemo(() => getWidgetsBySource(sourceId), [sourceId]);
  const [search, setSearch] = useState('');

  const existingRegistryIds = useMemo(
    () => existingItems.filter((i) => i.kind === 'registry').map((i) => (i as any).defId as string),
    [existingItems],
  );

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
              const alreadyIn = existingRegistryIds.includes(w.id);
              return (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => { onAddRegistry(w.id); onClose(); }}
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
  items: itemsProp,
  widgetLayouts,
  layoutVersion: layoutVersionProp,
  collapsed: collapsedProp,
  width,
  height,
  onUpdatePayload,
  otherGroups,
  onMoveItemOut,
  savedFilters: savedFiltersProp,
}: WidgetGroupProps) {
  const registerSection = useWidgetSectionStore((s) => s.registerSection);
  const updateFilters = useWidgetSectionStore((s) => s.updateFilters);
  const filters = useWidgetSectionStore((s) => s.getFilters(groupId));

  // Normalize legacy widgetIds to items
  const items = useMemo(() => normalizeItems(widgetIds, itemsProp), [widgetIds, itemsProp]);

  // Local state
  const [collapsed, setCollapsed] = useState(collapsedProp ?? false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [localTitle, setLocalTitle] = useState(title);
  const [maximizedItem, setMaximizedItem] = useState<GroupWidgetItem | null>(null);
  const [showAddPicker, setShowAddPicker] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const addPickerRef = useRef<HTMLDivElement>(null);
  const filtersRestoredRef = useRef(false);

  // Sync collapsed with prop
  useEffect(() => {
    if (collapsedProp !== undefined) setCollapsed(collapsedProp);
  }, [collapsedProp]);

  // Register this group as a section on mount, then restore saved filters
  useEffect(() => {
    registerSection(groupId, sectionType);
    if (savedFiltersProp && !filtersRestoredRef.current) {
      filtersRestoredRef.current = true;
      updateFilters(groupId, savedFiltersProp);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // ─── Build the group's dateFilter for cohi_widget children ───
  const groupDateFilter = useMemo<DateFilter | null>(() => {
    const dateField = filters.dateField || 'application_date';
    if (filters.periodSelection?.dateRange) {
      return {
        column: dateField,
        start: filters.periodSelection.dateRange.start,
        end: filters.periodSelection.dateRange.end,
      };
    }
    if (filters.dateRange) {
      return {
        column: dateField,
        start: filters.dateRange.start,
        end: filters.dateRange.end,
      };
    }
    // Year-only selection
    if (filters.year) {
      return {
        column: dateField,
        start: `${filters.year}-01-01`,
        end: `${filters.year}-12-31`,
      };
    }
    return null;
  }, [filters.dateField, filters.periodSelection, filters.dateRange, filters.year]);

  // ─── Payload updater (merges into existing payload) ───
  const patchPayload = useCallback(
    (patch: Record<string, unknown>) => {
      onUpdatePayload?.(patch);
    },
    [onUpdatePayload],
  );

  // ─── Persist filter state into the payload so it survives save/reload ───
  const filterSerialRef = useRef(0);
  useEffect(() => {
    // Skip the first render (mount) to avoid immediately overwriting
    filterSerialRef.current += 1;
    if (filterSerialRef.current <= 1) return;
    // Pick just the serialisable filter fields we care about
    const toSave: Record<string, unknown> = {};
    if (filters.year) toSave.year = filters.year;
    if (filters.dateRange) toSave.dateRange = filters.dateRange;
    if (filters.periodSelection) toSave.periodSelection = filters.periodSelection;
    if (filters.dateField && filters.dateField !== 'application_date') toSave.dateField = filters.dateField;
    if (filters.applicationType && filters.applicationType !== 'Applications Taken') toSave.applicationType = filters.applicationType;
    if (filters.actorType && filters.actorType !== 'loan_officer') toSave.actorType = filters.actorType;
    patchPayload({ savedFilters: Object.keys(toSave).length > 0 ? toSave : undefined });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.year, filters.dateRange, filters.periodSelection, filters.dateField, filters.applicationType, filters.actorType]);

  // ─── Grid layout ───
  const contentWidth = Math.max(width - 24, MIN_GRID_WIDTH);

  const gridLayout = useMemo(
    () => buildDefaultLayout(items, widgetLayouts, layoutVersionProp),
    [items, widgetLayouts, layoutVersionProp],
  );

  const saveLayout = useCallback(
    (newLayout: Layout[]) => {
      patchPayload({ widgetLayouts: layoutToMap(newLayout), layoutVersion: LAYOUT_VERSION });
    },
    [patchPayload],
  );

  // ─── Item management ───
  const persistItems = useCallback(
    (nextItems: GroupWidgetItem[], extraPatch?: Record<string, unknown>) => {
      // Persist both formats for backward compat
      const nextWidgetIds = nextItems
        .filter((i) => i.kind === 'registry')
        .map((i) => (i as Extract<GroupWidgetItem, { kind: 'registry' }>).defId);
      patchPayload({
        items: nextItems,
        widgetIds: nextWidgetIds,
        ...extraPatch,
      });
    },
    [patchPayload],
  );

  const handleDelete = useCallback(
    (index: number) => {
      const next = items.filter((_, i) => i !== index);
      // Clean up saved layout
      const key = itemKey(items[index], index);
      const nextLayouts = { ...widgetLayouts };
      delete nextLayouts[key];
      persistItems(next, { widgetLayouts: nextLayouts, layoutVersion: LAYOUT_VERSION });
    },
    [items, widgetLayouts, persistItems],
  );

  const handleDuplicate = useCallback(
    (index: number) => {
      const dup = { ...items[index] };
      // Give cohi items a new id
      if (dup.kind === 'cohi') {
        (dup as any).id = `${dup.id}-dup-${Date.now()}`;
      }
      const next = [...items];
      next.splice(index + 1, 0, dup);
      persistItems(next);
    },
    [items, persistItems],
  );

  const handleMoveItemToGroup = useCallback(
    (index: number, targetGroupId: string) => {
      if (!onMoveItemOut) return;
      const movedItem = items[index];
      // Remove item from this group
      const next = items.filter((_, i) => i !== index);
      const key = itemKey(items[index], index);
      const nextLayouts = { ...widgetLayouts };
      delete nextLayouts[key];
      persistItems(next, { widgetLayouts: nextLayouts, layoutVersion: LAYOUT_VERSION });
      // Tell the canvas to add the item to the target group
      onMoveItemOut(movedItem, targetGroupId);
    },
    [items, widgetLayouts, persistItems, onMoveItemOut],
  );

  /** Persist a viz type change for a cohi item back into the items array */
  const handleVizTypeChange = useCallback(
    (index: number, newType: string) => {
      const item = items[index];
      if (item.kind !== 'cohi') return;
      const updated: GroupWidgetItem = {
        ...item,
        vizConfig: { ...item.vizConfig, type: newType as any },
      };
      const next = items.map((it, i) => (i === index ? updated : it));
      persistItems(next);
    },
    [items, persistItems],
  );

  const handleAddRegistryWidget = useCallback(
    (defId: string) => {
      const next = [...items, { kind: 'registry' as const, defId }];
      persistItems(next);
    },
    [items, persistItems],
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
      if (e.key === 'Escape' && showAddPicker) {
        setShowAddPicker(false);
        e.stopPropagation();
      }
    },
    [showAddPicker],
  );

  const colors = SECTION_COLORS[sectionType];

  // Count items by kind
  const registryCount = items.filter((i) => i.kind === 'registry').length;
  const cohiCount = items.filter((i) => i.kind === 'cohi').length;
  const itemLabel = `${items.length} widget${items.length !== 1 ? 's' : ''}${cohiCount > 0 ? ` (${cohiCount} Cohi)` : ''}`;

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
            {itemLabel}
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
                existingItems={items}
                onAddRegistry={handleAddRegistryWidget}
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
        <WidgetDataProvider sectionId={groupId}>
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
            {items.map((item, idx) => {
              const key = itemKey(item, idx);
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
                    item={item}
                    width={cellW}
                    height={cellH}
                    dateFilter={groupDateFilter}
                    onDelete={() => handleDelete(idx)}
                    onDuplicate={() => handleDuplicate(idx)}
                    onMaximize={() => setMaximizedItem(item)}
                    otherGroups={otherGroups}
                    onMoveToGroup={(targetId) => handleMoveItemToGroup(idx, targetId)}
                    onVizTypeChange={item.kind === 'cohi' ? (type) => handleVizTypeChange(idx, type) : undefined}
                  />
                </div>
              );
            })}
          </GridLayout>

          {items.length === 0 && (
            <div className="w-full py-12 text-center text-sm text-slate-400 dark:text-slate-500">
              <Plus className="w-8 h-8 mx-auto mb-2 opacity-40" />
              No widgets yet. Click <strong>+ Add</strong> above to get started.
            </div>
          )}
        </div>
        </WidgetDataProvider>
      )}

      {/* Collapsed placeholder */}
      {collapsed && (
        <div className="px-4 py-2 text-xs text-slate-400 dark:text-slate-500 italic">
          {itemLabel} &middot; click the arrow to expand
        </div>
      )}

      {/* ═══════ Maximize dialog ═══════ */}
      <MaximizeDialog
        item={maximizedItem}
        open={maximizedItem !== null}
        onClose={() => setMaximizedItem(null)}
        dateFilter={groupDateFilter}
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
