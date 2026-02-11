/**
 * Workbench Canvas
 * Full-width white canvas with drag-and-drop grid, toolbar, Add-from-dashboard palette, and uploads.
 */

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { SectionType } from '@/stores/widgetSectionStore';
import { Rnd } from 'react-rnd';
import { api } from '@/lib/api';
import * as XLSX from 'xlsx';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Save,
  Share2,
  Image,
  Upload,
  Palette,
  LayoutDashboard,
  BarChart3,
  Target,
  ChevronDown,
  FileSpreadsheet,
  FileText,
  File,
  Clock,
  Type,
  Sparkles,
  Download,
  Presentation,
  Mail,
  Link as LinkIcon,
  Code,
  Undo2,
  Redo2,
  LayoutTemplate,
  LayoutGrid,
  PlusCircle,
  X,
  Trash2,
  Copy,
  Eraser,
  MessageSquare,
  StickyNote,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { useCanvasHistory } from '@/hooks/useCanvasHistory';
import { useCanvasPinStore } from '@/stores/canvasPinStore';
import { WidgetRenderer } from '@/components/workbench/canvas/WidgetRenderer';
import { CanvasWidgetCard } from '@/components/workbench/canvas/CanvasWidgetCard';
import {
  createLayoutItem,
  type CanvasLayoutItem,
  type CanvasUpload,
  type CanvasBackground,
  type CanvasAnnotation,
} from '@/components/workbench/canvas/types';
import { getWidgetDefinition } from '@/components/widgets/registry';
import { WidgetDataProvider } from '@/components/widgets/data';
import { WorkbenchCohiPanel } from '@/components/workbench/WorkbenchCohiPanel';
import { useWorkbenchCohi } from '@/hooks/useWorkbenchCohi';
import { useCanvasDataStore } from '@/stores/canvasDataStore';
import { ReportBuilder } from '@/components/workbench/report/ReportBuilder';
import { serializeWidgetCatalog } from '@/utils/widgetCatalogSerializer';
import type { WidgetAction } from '@/types/widgetActions';
import { ImageToDashboardDialog } from '@/components/workbench/ImageToDashboardDialog';
import { Camera } from 'lucide-react';

/**
 * Helper: make an authenticated POST that returns a Blob (for PPTX/PDF downloads).
 * api.request() always parses JSON, so we use fetch directly for binary responses.
 */
async function fetchBlob(endpoint: string, body: object): Promise<Blob> {
  const token = localStorage.getItem('auth_token');
  const baseUrl = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:3001' : '');
  const url = baseUrl ? `${baseUrl}${endpoint}` : endpoint;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => 'Unknown error');
    let errMsg = `Report generation failed (${res.status})`;
    try { errMsg = JSON.parse(errText).error || errMsg; } catch { /* use default */ }
    throw new Error(errMsg);
  }
  return res.blob();
}

const UPLOAD_ALLOWED_TYPES = [
  'text/csv',
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
];
const UPLOAD_MAX_SIZE = 10 * 1024 * 1024;

const DEFAULT_BACKGROUND: CanvasBackground = { type: 'color', value: '#ffffff' };

/** 10 UGC background templates: gradients and subtle patterns */
const BACKGROUND_TEMPLATES: { id: string; label: string; style: React.CSSProperties }[] = [
  { id: 'ocean', label: 'Ocean', style: { background: 'linear-gradient(135deg, #0ea5e9 0%, #06b6d4 50%, #22d3ee 100%)' } },
  { id: 'sunset', label: 'Sunset', style: { background: 'linear-gradient(180deg, #f97316 0%, #fb923c 30%, #fbbf24 100%)' } },
  { id: 'forest', label: 'Forest', style: { background: 'linear-gradient(160deg, #15803d 0%, #22c55e 50%, #86efac 100%)' } },
  { id: 'lavender', label: 'Lavender', style: { background: 'linear-gradient(135deg, #7c3aed 0%, #a78bfa 50%, #c4b5fd 100%)' } },
  { id: 'slate', label: 'Slate', style: { background: 'linear-gradient(180deg, #475569 0%, #64748b 50%, #94a3b8 100%)' } },
  { id: 'rose', label: 'Rose', style: { background: 'linear-gradient(135deg, #e11d48 0%, #f43f5e 50%, #fb7185 100%)' } },
  { id: 'frost', label: 'Frost', style: { background: 'linear-gradient(180deg, #f0f9ff 0%, #e0f2fe 50%, #bae6fd 100%)' } },
  { id: 'sand', label: 'Sand', style: { background: 'linear-gradient(160deg, #fef3c7 0%, #fde68a 50%, #fcd34d 100%)' } },
  { id: 'mesh', label: 'Mesh', style: { background: 'radial-gradient(at 40% 20%, #6366f1 0px, transparent 50%), radial-gradient(at 80% 0%, #8b5cf6 0px, transparent 50%), radial-gradient(at 0% 50%, #06b6d4 0px, transparent 50%)' } },
  { id: 'minimal', label: 'Minimal dots', style: { backgroundImage: 'radial-gradient(#cbd5e1 1px, transparent 1px)', backgroundSize: '20px 20px', backgroundColor: '#f8fafc' } },
];

const GRID_COLS = 12;
const GRID_ROW_HEIGHT = 140;
const GRID_MARGIN = { x: 8, y: 8 };
const DEFAULT_SECTION_SIZE = { w: 420, h: 280 };
const DEFAULT_WIDGET_SIZE = { w: 360, h: 240 };
const TEMPLATE_SCALE = 0.75;
const TEMPLATE_MIN_SIZE = { w: 260, h: 180 };

/** Predefined canvas templates (layout + optional background) */
const CANVAS_TEMPLATES: {
  id: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  items: CanvasLayoutItem[];
  background?: CanvasBackground;
}[] = [
  {
    id: 'blank',
    label: 'Blank',
    description: 'Start from a clean slate.',
    icon: LayoutTemplate,
    items: [],
  },
  {
    id: 'executive',
    label: 'Executive summary',
    description: 'KPIs plus key dashboards.',
    icon: Target,
    items: [
      createLayoutItem('t1-kpi', 'kpi', { type: 'kpi', label: 'Total volume', value: 0, format: 'currency' }, { x: 0, y: 0, w: 3, h: 1 }),
      createLayoutItem('t1-kpi2', 'kpi', { type: 'kpi', label: 'Units', value: 0, format: 'number' }, { x: 3, y: 0, w: 3, h: 1 }),
      createLayoutItem('t1-kpi3', 'kpi', { type: 'kpi', label: 'Pull-through %', value: 0, format: 'percent' }, { x: 6, y: 0, w: 3, h: 1 }),
      createLayoutItem('t1-section', 'dashboard_section', { type: 'dashboard_section', sectionId: 'leaderboard', title: 'Leaderboard' }, { x: 0, y: 1, w: 6, h: 3 }),
      createLayoutItem('t1-section2', 'dashboard_section', { type: 'dashboard_section', sectionId: 'executiveDashboard', title: 'Business Overview' }, { x: 6, y: 1, w: 6, h: 3 }),
    ],
    background: { type: 'template', value: 'frost' },
  },
  {
    id: 'sales',
    label: 'Sales review',
    description: 'Leaderboards and close-rate focus.',
    icon: BarChart3,
    items: [
      createLayoutItem('t2-1', 'dashboard_section', { type: 'dashboard_section', sectionId: 'leaderboard', title: 'Leaderboard' }, { x: 0, y: 0, w: 12, h: 2 }),
      createLayoutItem('t2-2', 'dashboard_section', { type: 'dashboard_section', sectionId: 'closingFalloutForecast', title: 'Closing & Fallout' }, { x: 0, y: 2, w: 6, h: 2 }),
      createLayoutItem('t2-3', 'dashboard_section', { type: 'dashboard_section', sectionId: 'topTiering', title: 'Top Tiering' }, { x: 6, y: 2, w: 6, h: 2 }),
    ],
    background: { type: 'template', value: 'slate' },
  },
  {
    id: 'marketing',
    label: 'Marketing',
    description: 'Campaign brief + overview tiles.',
    icon: Sparkles,
    items: [
      createLayoutItem('tm-1', 'text_block', { type: 'text_block', content: 'Campaign goals and KPIs', title: 'Campaign brief' }, { x: 0, y: 0, w: 6, h: 2 }),
      createLayoutItem('tm-2', 'dashboard_section', { type: 'dashboard_section', sectionId: 'leaderboard', title: 'Leaderboard' }, { x: 6, y: 0, w: 6, h: 2 }),
      createLayoutItem('tm-3', 'dashboard_section', { type: 'dashboard_section', sectionId: 'executiveDashboard', title: 'Business Overview' }, { x: 0, y: 2, w: 12, h: 3 }),
    ],
    background: { type: 'template', value: 'lavender' },
  },
  {
    id: 'operations',
    label: 'Operations',
    description: 'Pipeline + closing health view.',
    icon: LayoutGrid,
    items: [
      createLayoutItem('to-1', 'kpi', { type: 'kpi', label: 'Pipeline', value: 0, format: 'number' }, { x: 0, y: 0, w: 3, h: 1 }),
      createLayoutItem('to-2', 'kpi', { type: 'kpi', label: 'Fallout %', value: 0, format: 'percent' }, { x: 3, y: 0, w: 3, h: 1 }),
      createLayoutItem('to-3', 'kpi', { type: 'kpi', label: 'Close rate', value: 0, format: 'percent' }, { x: 6, y: 0, w: 3, h: 1 }),
      createLayoutItem('to-4', 'dashboard_section', { type: 'dashboard_section', sectionId: 'closingFalloutForecast', title: 'Closing & Fallout' }, { x: 0, y: 1, w: 6, h: 3 }),
      createLayoutItem('to-5', 'dashboard_section', { type: 'dashboard_section', sectionId: 'topTiering', title: 'Loan Funnel' }, { x: 6, y: 1, w: 6, h: 3 }),
    ],
    background: { type: 'template', value: 'frost' },
  },
];

function getGridColWidth(containerWidth: number) {
  const usable = containerWidth - GRID_MARGIN.x * (GRID_COLS + 1);
  return usable / GRID_COLS;
}

function gridToPixels(item: CanvasLayoutItem, containerWidth: number) {
  const colWidth = getGridColWidth(containerWidth);
  const x = GRID_MARGIN.x + item.x * (colWidth + GRID_MARGIN.x);
  const y = GRID_MARGIN.y + item.y * (GRID_ROW_HEIGHT + GRID_MARGIN.y);
  const w = item.w * colWidth + (item.w - 1) * GRID_MARGIN.x;
  const h = item.h * GRID_ROW_HEIGHT + (item.h - 1) * GRID_MARGIN.y;
  return {
    x: Math.round(x),
    y: Math.round(y),
    w: Math.round(w),
    h: Math.round(h),
  };
}

function normalizeTemplateItems(
  templateItems: CanvasLayoutItem[],
  containerWidth: number,
  start: { x: number; y: number }
): CanvasLayoutItem[] {
  if (templateItems.length === 0) return [];
  const pixelItems = templateItems.map((item) => ({
    ...item,
    ...gridToPixels(item, containerWidth),
  }));
  const minX = Math.min(...pixelItems.map((item) => item.x));
  const minY = Math.min(...pixelItems.map((item) => item.y));
  return pixelItems.map((item, index) => {
    const x = Math.max(0, Math.round((item.x - minX) * TEMPLATE_SCALE)) + start.x;
    const y = Math.max(0, Math.round((item.y - minY) * TEMPLATE_SCALE)) + start.y;
    const w = Math.max(TEMPLATE_MIN_SIZE.w, Math.round(item.w * TEMPLATE_SCALE));
    const h = Math.max(TEMPLATE_MIN_SIZE.h, Math.round(item.h * TEMPLATE_SCALE));
    return {
      ...item,
      i: `widget-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`,
      x,
      y,
      w,
      h,
    };
  });
}

// Re-export shared section config so existing imports from WorkbenchCanvas keep working
export type { DashboardSectionItem } from './workbenchSections';
export { STANDALONE_WIDGETS, DASHBOARD_SECTION_GROUPS } from './workbenchSections';
import { STANDALONE_WIDGETS, DASHBOARD_SECTION_GROUPS, DASHBOARD_SECTION_ITEMS } from './workbenchSections';

/**
 * Maps dashboard sectionIds to a section definition with:
 * - sectionType: drives which filter controls appear in the header
 * - widgetIds: registry widget definition IDs to place as individual widgets
 *
 * When a user adds one of these sections, we place:
 *   1. A SectionHeader (title bar + filter dropdowns)
 *   2. Individual widget cards (KPIs, charts, tables)
 * All sharing a unique sectionId so filters are linked.
 */
const SECTION_TO_WIDGETS: Record<string, {
  sectionType: SectionType;
  widgetIds: string[];
}> = {
  companyScorecard: {
    sectionType: 'company-scorecard',
    widgetIds: [
      'company-scorecard-units',
      'company-scorecard-volume',
      'company-scorecard-avg-loan-size',
      'company-scorecard-wac',
      'company-scorecard-wa-fico',
      'company-scorecard-wa-ltv',
      'company-scorecard-wa-dti',
      'company-scorecard-volume-by-branch',
      'company-scorecard-pullthrough-by-branch',
      'company-scorecard-tabbed-table',
    ],
  },
  creditRiskManagement: {
    sectionType: 'credit-risk',
    widgetIds: [
      'credit-risk-units',
      'credit-risk-volume',
      'credit-risk-wac',
      'credit-risk-wa-fico',
      'credit-risk-wa-ltv',
      'credit-risk-wa-dti',
      'credit-risk-fico-distribution',
      'credit-risk-ltv-distribution',
      'credit-risk-dti-distribution',
      'credit-risk-loan-mix-table',
    ],
  },
  salesScorecard: {
    sectionType: 'sales-scorecard',
    widgetIds: [
      'sales-scorecard-units',
      'sales-scorecard-volume',
      'sales-scorecard-revenue',
      'sales-scorecard-revenue-bps',
      'sales-scorecard-pull-through',
      'sales-scorecard-avg-turn-time',
      'sales-scorecard-avg-tts',
      'sales-scorecard-tabbed-table',
    ],
  },
  operationsScorecard: {
    sectionType: 'operations-scorecard',
    widgetIds: [
      'ops-scorecard-actor-count',
      'ops-scorecard-units-output',
      'ops-scorecard-avg-days',
      'ops-scorecard-approved-pct',
      'ops-scorecard-cost-per-file',
      'ops-scorecard-wa-fico',
      'ops-scorecard-wa-ltv',
      'ops-scorecard-tabbed-table',
    ],
  },
  operationsTrends: {
    sectionType: 'operations-trends',
    widgetIds: [
      'ops-trends-target-units',
      'ops-trends-avg-output',
      'ops-trends-avg-volume',
      'ops-trends-complexity',
      'ops-trends-avg-days',
      'ops-trends-table',
    ],
  },
  salesTrends: {
    sectionType: 'sales-trends',
    widgetIds: [
      'sales-trends-total-units',
      'sales-trends-total-volume',
      'sales-trends-active-los',
      'sales-trends-avg-turn-time',
      'sales-trends-monthly-performance',
      'sales-trends-fund-type',
      'sales-trends-lo-table',
    ],
  },
  loanFunnel: {
    sectionType: 'funnel',
    widgetIds: [
      'funnel-loans-started',
      'funnel-respa-apps',
      'funnel-originated',
      'funnel-withdrawn',
      'funnel-denied',
      'funnel-still-active',
      'funnel-volume',
      'funnel-waterfall-table',
    ],
  },
  topTieringComparison: {
    sectionType: 'top-tiering-comparison',
    widgetIds: [
      'ttc-total-revenue',
      'ttc-total-units',
      'ttc-total-volume',
      'ttc-avg-bps',
      'ttc-revenue-chart',
      'ttc-units-chart',
      'ttc-bps-chart',
      'ttc-detail-table',
    ],
  },
  leaderboard: {
    sectionType: 'leaderboard',
    widgetIds: [
      'leaderboard-embed',
    ],
  },
  executiveDashboard: {
    sectionType: 'executive-dashboard',
    widgetIds: [
      'exec-dashboard-embed',
    ],
  },
};

/** Hideable sub-sections per dashboard_section (for "Hide sections" menu). */
const DASHBOARD_HIDEABLE_SECTIONS: Record<string, { id: string; label: string }[]> = {
  topTiering: [
    { id: 'dailyStory', label: 'Executive summary / Daily Story' },
    { id: 'chart', label: 'Funnel / Detail chart' },
  ],
  loanFunnel: [
    { id: 'dailyStory', label: 'Executive summary / Daily Story' },
    { id: 'chart', label: 'Funnel / Detail chart' },
  ],
};

function getNextPosition(items: CanvasLayoutItem[]): { x: number; y: number } {
  if (items.length === 0) return { x: 0, y: 0 };
  let maxY = 0;
  items.forEach((item) => {
    const bottom = item.y + item.h;
    if (bottom > maxY) maxY = bottom;
  });
  return { x: 0, y: maxY + 24 };
}

function isLikelyGridLayout(items: CanvasLayoutItem[]): boolean {
  if (items.length === 0) return false;
  const maxW = Math.max(...items.map((i) => i.w));
  const maxH = Math.max(...items.map((i) => i.h));
  const maxX = Math.max(...items.map((i) => i.x));
  const maxY = Math.max(...items.map((i) => i.y));
  return maxW <= 12 && maxH <= 12 && maxX <= 12 && maxY <= 50;
}

function convertLayoutToPixels(
  items: CanvasLayoutItem[],
  containerWidth: number
): CanvasLayoutItem[] {
  return items.map((item) => ({ ...item, ...gridToPixels(item, containerWidth) }));
}

export type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'idle';

export interface WorkbenchCanvasProps {
  loadCanvasId?: string | null;
  onLoaded?: () => void;
  /** Called after a canvas is saved (new or existing) with (canvasId, title) */
  onSaved?: (canvasId: string, title: string) => void;
  tenantId?: string | null;
  /** Called when dirty state changes so parent can show indicator on tab */
  onDirtyChange?: (dirty: boolean) => void;
}

export function WorkbenchCanvas({ loadCanvasId, onLoaded, onSaved, tenantId, onDirtyChange }: WorkbenchCanvasProps) {
  const {
    items,
    annotations,
    setItems,
    setAnnotations,
    setItemsWithHistory,
    setAnnotationsWithHistory,
    setBothWithHistory,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useCanvasHistory<CanvasLayoutItem, CanvasAnnotation>([], []);
  const [uploads, setUploads] = useState<CanvasUpload[]>([]);
  const [canvasBackground, setCanvasBackground] = useState<CanvasBackground>(DEFAULT_BACKGROUND);
  const [canvasId, setCanvasId] = useState<string | null>(null);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveTitle, setSaveTitle] = useState('Untitled canvas');
  const [isSaving, setIsSaving] = useState(false);
  const [width, setWidth] = useState(1200);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [sharePin, setSharePin] = useState('');
  const [shareScope, setShareScope] = useState<'private' | 'team' | 'public'>('team');
  const [shareEmail, setShareEmail] = useState('');
  const [shareFavorited, setShareFavorited] = useState(false);
  const [favoriteLoading, setFavoriteLoading] = useState(false);
  const [activeAddGroup, setActiveAddGroup] = useState(() => DASHBOARD_SECTION_GROUPS[0]?.label ?? 'Insights');
  const [aiBackgroundOpen, setAiBackgroundOpen] = useState(false);
  const [aiBackgroundPrompt, setAiBackgroundPrompt] = useState('');
  const [showCohiPanel, setShowCohiPanel] = useState(() => {
    // Auto-open Cohi panel on first visit
    const visited = localStorage.getItem('cohi-workbench-visited');
    if (!visited) {
      localStorage.setItem('cohi-workbench-visited', '1');
      return true;
    }
    return false;
  });
  const [imageToDashboardOpen, setImageToDashboardOpen] = useState(false);
  const [aiBackgroundLoading, setAiBackgroundLoading] = useState(false);
  const [aiBackgroundResult, setAiBackgroundResult] = useState<{ templateId: string; suggestedDescription: string } | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const backgroundImageInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const pendingPins = useCanvasPinStore((s) => s.pendingPins);
  const consumePendingPins = useCanvasPinStore((s) => s.consumePendingPins);

  /* ─── Autosave: dirty-state tracking & debounced save ─── */
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const lastSavedSnapshotRef = useRef<string>('');
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Build a snapshot string for comparison
  const currentSnapshot = useMemo(() => {
    try {
      return JSON.stringify({ items, annotations, bg: canvasBackground, uploads, title: saveTitle });
    } catch {
      return '';
    }
  }, [items, annotations, canvasBackground, uploads, saveTitle]);

  // Determine dirty state
  const isDirty = useMemo(() => {
    if (!lastSavedSnapshotRef.current) return false; // never saved/loaded — not dirty
    return currentSnapshot !== lastSavedSnapshotRef.current;
  }, [currentSnapshot]);

  // Notify parent of dirty state changes
  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  // Update visual save status based on dirty
  useEffect(() => {
    if (isDirty && saveStatus !== 'saving') {
      setSaveStatus('unsaved');
    } else if (!isDirty && saveStatus !== 'saving') {
      setSaveStatus(canvasId ? 'saved' : 'idle');
    }
  }, [isDirty, canvasId, saveStatus]);

  // Autosave: debounce 5s after last change for already-saved canvases
  useEffect(() => {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    if (!canvasId || !isDirty) return;

    autosaveTimerRef.current = setTimeout(async () => {
      const title = saveTitle.trim() || 'Untitled canvas';
      const content = {
        layoutVersion: 'freeform-v1',
        layout: items,
        annotations,
        background: canvasBackground,
        uploadsMeta: uploads,
      };
      setSaveStatus('saving');
      try {
        await api.request(`/api/workbench/canvases/${canvasId}${tenantQs}`, {
          method: 'PUT',
          body: JSON.stringify({ title, content }),
        });
        lastSavedSnapshotRef.current = JSON.stringify({ items, annotations, bg: canvasBackground, uploads, title: saveTitle });
        setSaveStatus('saved');
        onSaved?.(canvasId, title);
      } catch {
        setSaveStatus('unsaved');
      }
    }, 5000);

    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSnapshot, canvasId]);

  // --- Cohi Workbench Intelligence ---
  const widgetCatalog = React.useMemo(() => serializeWidgetCatalog(), []);

  // Ref to hold the latest handleCohiAction for auto-execution (avoids circular dep with hook)
  const cohiActionRef = useRef<(action: WidgetAction) => void>(() => {});

  const {
    messages: cohiMessages,
    isLoading: cohiLoading,
    suggestedQuestions: cohiSuggestions,
    sendMessage: cohiSendMessage,
    clearMessages: cohiClearMessages,
  } = useWorkbenchCohi({
    tenantId,
    canvasItems: items,
    widgetCatalog,
    onAutoExecuteActions: useCallback((actions: WidgetAction[]) => {
      // Batch-execute all canvas actions to avoid stale-state issues
      // Separate create_widget actions (need intelligent layout) from others
      const createWidgetActions = actions.filter((a) => a.type === 'create_widget');
      const otherActions = actions.filter((a) => a.type !== 'create_widget');

      // Execute non-create_widget actions normally (one at a time)
      for (const action of otherActions) {
        cohiActionRef.current(action);
      }

      // Batch all create_widget actions into a SINGLE widget_group (or add to existing)
      if (createWidgetActions.length > 0) {
        setItemsWithHistory((prev) => {
          // Build all cohi widget items
          const cohiItems = createWidgetActions.map((action, idx) => ({
            kind: 'cohi' as const,
            id: `cohi-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
            sql: action.sql,
            title: action.title,
            vizConfig: action.config,
            explanation: action.explanation,
          }));

          // Check if there's an existing widget_group we can append to
          const existingGroupIdx = prev.findIndex(
            (it) => it.type === 'widget_group' && it.payload.type === 'widget_group'
          );

          if (existingGroupIdx !== -1) {
            // Add to existing group
            const existingGroup = prev[existingGroupIdx];
            const groupPayload = existingGroup.payload;
            const currentItems = groupPayload.items || groupPayload.widgetIds.map((id: string) => ({ kind: 'registry' as const, defId: id }));
            const mergedItems = [...currentItems, ...cohiItems];

            // Grow the group height to accommodate new widgets
            const newChartCount = createWidgetActions.length;
            const extraH = Math.ceil(newChartCount / 2) * 280;

            const updated = prev.map((it, i) =>
              i === existingGroupIdx
                ? {
                    ...it,
                    h: it.h + extraH,
                    payload: {
                      ...groupPayload,
                      items: mergedItems,
                      widgetIds: mergedItems.filter((item: any) => item.kind === 'registry').map((item: any) => item.defId),
                    },
                  }
                : it
            );
            return updated;
          }

          // No existing group — create a new one
          const newItems = [...prev];
          let yOffset = 20;
          for (const item of prev) {
            const bottom = item.y + item.h;
            if (bottom + 20 > yOffset) yOffset = bottom + 20;
          }

          // Determine a good title for the group
          const groupTitle = createWidgetActions.length === 1
            ? (createWidgetActions[0].title || 'Cohi Widget')
            : 'Cohi Dashboard';

          // Size: taller for more widgets (KPIs are short, charts need ~250px each)
          const kpiCount = createWidgetActions.filter((a) => a.config?.type === 'kpi').length;
          const chartCount = createWidgetActions.length - kpiCount;
          const kpiRows = Math.ceil(kpiCount / 4);
          const chartRows = Math.ceil(chartCount / 2);
          const groupH = Math.max(350, 110 + kpiRows * 100 + chartRows * 280);
          const groupW = Math.max(width - 40, 600);

          const groupId = `canvas-group-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          const groupItem = createLayoutItem(
            groupId,
            'widget_group',
            {
              type: 'widget_group' as const,
              groupId,
              title: groupTitle,
              sectionType: 'company-scorecard' as SectionType,
              widgetIds: [],
              items: cohiItems,
            },
            { x: 0, y: yOffset, w: groupW, h: groupH }
          );
          newItems.push(groupItem);
          return newItems;
        });
        toast({
          title: `${createWidgetActions.length} widget${createWidgetActions.length > 1 ? 's' : ''} added`,
          description: createWidgetActions.map((a) => a.title).filter(Boolean).join(', '),
        });
      }
    }, [width, setItemsWithHistory, toast]),
  });

  const handleCohiAction = useCallback(
    (action: WidgetAction) => {
      switch (action.type) {
        case 'add_existing_widget': {
          const def = getWidgetDefinition(action.widgetId);
          if (!def) {
            toast({ title: 'Widget not found', description: `Unknown widget: ${action.widgetId}`, variant: 'destructive' });
            return;
          }
          // Find the correct section type from SECTION_TO_WIDGETS
          let sectionType: SectionType = 'company-scorecard';
          for (const [, cfg] of Object.entries(SECTION_TO_WIDGETS)) {
            if (cfg.widgetIds.includes(action.widgetId)) {
              sectionType = cfg.sectionType as SectionType;
              break;
            }
          }
          const groupId = `cohi-group-${Date.now()}`;
          const newItem = createLayoutItem(
            `canvas-${Date.now()}`,
            'widget_group',
            {
              type: 'widget_group',
              groupId,
              title: def.group,
              sectionType,
              widgetIds: [action.widgetId],
            },
            { x: 20, y: 20, w: 500, h: 400 }
          );
          setItemsWithHistory([...items, newItem]);
          toast({ title: 'Widget added', description: `Added "${def.name}" to canvas` });
          break;
        }
        case 'suggest_dashboard': {
          const sectionKey = action.sectionKey as string;
          const sectionTitle = sectionKey.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase()).trim();

          // Check standalone widgets first
          const sw = STANDALONE_WIDGETS[sectionKey];
          if (sw) {
            const swItem = createLayoutItem(
              `canvas-${Date.now()}`,
              'registry_widget',
              { type: 'registry_widget', definitionId: sw.defId },
              { x: 20, y: 20, w: sw.w, h: sw.h },
            );
            setItemsWithHistory([...items, swItem]);
            toast({ title: 'Widget added', description: `Added "${sectionTitle}" to canvas` });
            break;
          }

          // Full dashboard sections
          const section = SECTION_TO_WIDGETS[sectionKey];
          if (!section) {
            toast({ title: 'Dashboard not found', description: `Unknown section: ${sectionKey}`, variant: 'destructive' });
            return;
          }
          const gId = `cohi-dash-${Date.now()}`;
          const dashItem = createLayoutItem(
            `canvas-${Date.now()}`,
            'widget_group',
            {
              type: 'widget_group',
              groupId: gId,
              title: sectionTitle,
              sectionType: section.sectionType as SectionType,
              widgetIds: section.widgetIds,
            },
            { x: 20, y: 20, w: 1000, h: 800 }
          );
          setItemsWithHistory([...items, dashItem]);
          toast({ title: 'Dashboard added', description: `Added ${section.widgetIds.length} widgets to canvas` });
          break;
        }
        case 'create_widget': {
          // Check if there's an existing widget_group on the canvas we can add to
          const existingGroup = items.find(
            (it) => it.type === 'widget_group' && it.payload.type === 'widget_group'
          );

          if (existingGroup && existingGroup.payload.type === 'widget_group') {
            // Add to existing group
            const groupPayload = existingGroup.payload;
            const currentItems = groupPayload.items || groupPayload.widgetIds.map((id: string) => ({ kind: 'registry' as const, defId: id }));
            const newCohiItem = {
              kind: 'cohi' as const,
              id: `cohi-${Date.now()}`,
              sql: action.sql,
              title: action.title,
              vizConfig: action.config,
              explanation: action.explanation,
            };
            const updatedItems = [...currentItems, newCohiItem];
            const updatedPayload = {
              ...groupPayload,
              items: updatedItems,
              widgetIds: updatedItems.filter((i: any) => i.kind === 'registry').map((i: any) => i.defId),
            };
            const targetGroupId = existingGroup.i;
            setItemsWithHistory((prev) =>
              prev.map((it) => it.i === targetGroupId ? { ...it, payload: updatedPayload } : it)
            );
            toast({ title: 'Widget added to group', description: action.title });
          } else {
            // Create a new widget_group containing this single cohi widget
            const groupId = `canvas-group-${Date.now()}`;
            const cohiGroupItem = createLayoutItem(
              groupId,
              'widget_group',
              {
                type: 'widget_group',
                groupId,
                title: action.title,
                sectionType: 'company-scorecard',
                widgetIds: [],
                items: [{
                  kind: 'cohi' as const,
                  id: `cohi-${Date.now()}`,
                  sql: action.sql,
                  title: action.title,
                  vizConfig: action.config,
                  explanation: action.explanation,
                }],
              },
              { x: 20, y: 20, w: 700, h: 500 }
            );
            setItemsWithHistory((prev) => [...prev, cohiGroupItem]);
            toast({ title: 'Widget group created', description: action.title });
          }
          break;
        }
        case 'delete_widget': {
          setItemsWithHistory(items.filter((it) => it.i !== action.instanceId));
          toast({ title: 'Widget removed' });
          break;
        }
        case 'create_canvas': {
          // Build a full canvas from multiple dashboard sections
          const sectionKeys = action.sectionKeys ?? [];
          if (sectionKeys.length === 0) {
            toast({ title: 'No sections specified', variant: 'destructive' });
            break;
          }
          if (action.title) setSaveTitle(action.title);
          const newItems: CanvasLayoutItem[] = [];
          let yOffset = 0;
          const groupW = Math.max(width - 32, 480);
          const EMBED_HEIGHTS: Record<string, number> = {
            executiveDashboard: 700,
            leaderboard: 850,
          };

          for (const key of sectionKeys) {
            const itemId = `widget-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
            const sectionTitle = key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase()).trim();

            // Standalone widgets – add as registry_widget directly
            const standalone = STANDALONE_WIDGETS[key];
            if (standalone) {
              newItems.push(
                createLayoutItem(itemId, 'registry_widget', {
                  type: 'registry_widget',
                  definitionId: standalone.defId,
                }, { x: 0, y: yOffset, w: Math.min(standalone.w, groupW), h: standalone.h })
              );
              yOffset += standalone.h + 24;
              continue;
            }

            // Full dashboard sections – add as widget_group
            const section = SECTION_TO_WIDGETS[key];
            if (!section) continue;
            const groupId = `cohi-canvas-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

            const embedH = EMBED_HEIGHTS[key];
            let groupH: number;
            if (embedH && section.widgetIds.length <= 2) {
              groupH = embedH;
            } else {
              const kpiCount = section.widgetIds.filter((id) => {
                const def = getWidgetDefinition(id);
                return def?.category === 'kpi';
              }).length;
              const kpiRows = Math.ceil(kpiCount / 7);
              const chartCount = section.widgetIds.filter((id) => {
                const d = getWidgetDefinition(id);
                return d?.category === 'chart' || d?.category === 'distribution';
              }).length;
              const tableCount = section.widgetIds.filter((id) => {
                const d = getWidgetDefinition(id);
                return d?.category === 'table';
              }).length;
              const chartRows = Math.ceil(chartCount / 2);
              const contentH = kpiRows * 80 + chartRows * 210 + tableCount * 280 + 20;
              groupH = Math.max(350, 110 + contentH);
            }

            newItems.push(
              createLayoutItem(itemId, 'widget_group', {
                type: 'widget_group',
                groupId,
                title: sectionTitle,
                sectionType: section.sectionType as SectionType,
                widgetIds: section.widgetIds,
              }, { x: 0, y: yOffset, w: groupW, h: groupH })
            );
            yOffset += groupH + 24;
          }

          if (newItems.length > 0) {
            setItemsWithHistory((prev) => [...prev, ...newItems]);
            toast({
              title: action.title || 'Canvas created',
              description: `Added ${newItems.length} dashboard section${newItems.length !== 1 ? 's' : ''} to canvas`,
            });
          }
          break;
        }
        case 'generate_report': {
          // AI-generated report: send the report definition to the backend for PPTX generation
          const reportAction = action as import('@/types/widgetActions').GenerateReportAction;
          const reportDef = reportAction.reportDefinition;
          if (!reportDef || !reportDef.slides?.length) {
            toast({ title: 'Invalid report', description: 'Report has no slides', variant: 'destructive' });
            break;
          }
          toast({ title: 'Generating report...', description: `Building ${reportDef.slides.length}-slide presentation` });
          // Call backend to generate PPTX
          (async () => {
            try {
              const tenantParam = tenantId ? `?tenant_id=${tenantId}` : '';
              const fmt = reportAction.format || 'pptx';
              const blob = await fetchBlob(
                `/api/workbench/reports/generate${tenantParam}`,
                {
                  definition: {
                    id: `report-${Date.now()}`,
                    ...reportDef,
                    metadata: {
                      createdAt: new Date().toISOString(),
                      dataAsOf: new Date().toISOString(),
                      generatedBy: 'ai',
                    },
                  },
                  format: fmt,
                }
              );
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `${(reportDef.title || 'report').replace(/[^a-z0-9]/gi, '_')}.${fmt}`;
              a.click();
              URL.revokeObjectURL(url);
              toast({ title: 'Report downloaded', description: `${reportDef.title || 'Report'} saved as ${fmt.toUpperCase()}` });
            } catch (err: any) {
              console.error('[Report] Generation failed:', err);
              toast({ title: 'Report failed', description: err.message || 'Failed to generate report', variant: 'destructive' });
            }
          })();
          break;
        }
        default:
          // explain_widget, explain_schema, modify_widget – handled in chat only
          break;
      }
    },
    [items, setItemsWithHistory, toast, width, tenantId]
  );

  // Keep the ref in sync so auto-execute callback always uses latest handler
  cohiActionRef.current = handleCohiAction;

  // ---- Image-to-Dashboard: handle generated groups ----
  const handleDashboardGenerated = useCallback(
    (groups: Array<{ title: string; sectionType: string; dateField: string; widgets: Array<{ id: string; sql: string; title: string; vizConfig: any; explanation?: string }> }>) => {
      const newItems: CanvasLayoutItem[] = [];
      let yOffset = 20;

      // Find the bottom of existing items so new groups don't overlap
      for (const item of items) {
        const bottom = item.y + item.h;
        if (bottom > yOffset) yOffset = bottom + 20;
      }

      for (const group of groups) {
        const groupId = `canvas-group-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const groupItems = group.widgets.map((w) => ({
          kind: 'cohi' as const,
          id: w.id,
          sql: w.sql,
          title: w.title,
          vizConfig: w.vizConfig,
          explanation: w.explanation,
        }));

        const groupPayload = {
          type: 'widget_group' as const,
          groupId,
          title: group.title,
          sectionType: (group.sectionType || 'company-scorecard') as import('@/stores/widgetSectionStore').SectionType,
          widgetIds: [] as string[],
          items: groupItems,
        };

        // Size the group based on widget count
        const widgetCount = group.widgets.length;
        const groupHeight = Math.max(500, widgetCount <= 4 ? 500 : 300 + widgetCount * 100);

        newItems.push(
          createLayoutItem(groupId, 'widget_group', groupPayload, {
            x: 20,
            y: yOffset,
            w: 900,
            h: groupHeight,
          })
        );

        yOffset += groupHeight + 20;
      }

      if (newItems.length > 0) {
        setItemsWithHistory((prev) => [...prev, ...newItems]);
        toast({
          title: 'Dashboard created from image',
          description: `Added ${groups.length} group${groups.length !== 1 ? 's' : ''} with ${groups.reduce((s, g) => s + g.widgets.length, 0)} widget${groups.reduce((s, g) => s + g.widgets.length, 0) !== 1 ? 's' : ''}`,
        });
      }
    },
    [items, setItemsWithHistory, toast]
  );

  // Build tenant query param once for all canvas API calls
  const tenantQs = useMemo(() => (tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : ''), [tenantId]);

  // Clear canvas data store when switching canvases
  const clearCanvasData = useCanvasDataStore((s) => s.clearAll);
  useEffect(() => {
    clearCanvasData();
  }, [loadCanvasId, clearCanvasData]);

  useEffect(() => {
    if (!loadCanvasId) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await api.request<any>(`/api/workbench/canvases/${loadCanvasId}${tenantQs}`);
        if (cancelled || !data) return;
        const content = data.content ?? {};
        if (Array.isArray(content.layout)) {
          const containerWidth = Math.max(width - 32, 480);
          const layoutVersion = content.layoutVersion as string | undefined;
          const shouldConvert = layoutVersion !== 'freeform-v1' && isLikelyGridLayout(content.layout);
          const nextLayout = shouldConvert
            ? convertLayoutToPixels(content.layout, containerWidth)
            : content.layout;
          setItems(nextLayout);
        }
        if (Array.isArray(content.annotations)) setAnnotations(content.annotations);
        if (content.background && typeof content.background === 'object') setCanvasBackground(content.background);
        if (Array.isArray(content.uploadsMeta)) setUploads(content.uploadsMeta);
        if (data.title) setSaveTitle(data.title);
        if (typeof data.favorited === 'boolean') setShareFavorited(data.favorited);
        setCanvasId(data.id);
        // Snapshot baseline for dirty-state tracking (after a tick so state is flushed)
        requestAnimationFrame(() => {
          const shouldConvert2 = (content.layoutVersion as string | undefined) !== 'freeform-v1' && isLikelyGridLayout(content.layout ?? []);
          const layoutForSnap = shouldConvert2
            ? convertLayoutToPixels(content.layout ?? [], Math.max(width - 32, 480))
            : (content.layout ?? []);
          lastSavedSnapshotRef.current = JSON.stringify({
            items: layoutForSnap,
            annotations: content.annotations ?? [],
            bg: content.background ?? canvasBackground,
            uploads: content.uploadsMeta ?? [],
            title: data.title ?? 'Untitled canvas',
          });
          setSaveStatus('saved');
        });
        onLoaded?.();
      } catch {
        if (!cancelled) toast({ title: 'Failed to load canvas', variant: 'destructive' });
      }
    })();
    return () => { cancelled = true; };
  }, [loadCanvasId, onLoaded, toast, width, tenantQs]);

  /* ─── Proactive AI: auto-analyze canvas data on load (opens panel automatically) ─── */
  const autoInsightsFiredRef = useRef(false);
  useEffect(() => {
    // Fire once when a loaded canvas has items — no need for panel to already be open
    if (autoInsightsFiredRef.current) return;
    if (!canvasId || items.length === 0) return;
    // Only fire for loaded canvases (not brand-new ones)
    if (!loadCanvasId) return;

    autoInsightsFiredRef.current = true;
    // Delay to let the canvas and widget data settle
    const timer = setTimeout(() => {
      const sectionNames = items
        .filter((it) => it.payload.type === 'widget_group')
        .map((it) => (it.payload as any).title || 'Unknown')
        .join(', ');

      // Auto-open the Cohi panel so the user sees insights immediately
      setShowCohiPanel(true);

      // Give the panel a moment to mount before sending
      setTimeout(() => {
        cohiSendMessage(
          `I just opened a canvas containing: ${sectionNames || 'some dashboard widgets'}. ` +
          `As a senior mortgage analyst, give me a brief executive briefing:\n` +
          `1. What stands out — any metrics that need attention?\n` +
          `2. Any trends or patterns worth watching?\n` +
          `3. One recommended action or focus area.\n` +
          `Keep it concise and in mortgage executive language.`
        );
      }, 400);
    }, 2500);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasId, items.length, loadCanvasId]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry?.contentRect.width) setWidth(entry.contentRect.width);
    });
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width || 1200);
    return () => ro.disconnect();
  }, []);

  const canvasWidth = Math.max(width - 32, 480);

  const bringToFront = useCallback(
    (id: string) => {
      setItemsWithHistory((prev) => {
        const idx = prev.findIndex((p) => p.i === id);
        if (idx < 0) return prev;
        const item = prev[idx];
        return [...prev.slice(0, idx), ...prev.slice(idx + 1), item];
      });
      toast({ title: 'Brought to front' });
    },
    [setItemsWithHistory, toast]
  );

  const sendToBack = useCallback(
    (id: string) => {
      setItemsWithHistory((prev) => {
        const idx = prev.findIndex((p) => p.i === id);
        if (idx < 0) return prev;
        const item = prev[idx];
        return [item, ...prev.slice(0, idx), ...prev.slice(idx + 1)];
      });
      toast({ title: 'Sent to back' });
    },
    [setItemsWithHistory, toast]
  );

  const applyBestFitLayout = useCallback(() => {
    if (items.length === 0) return;
    const n = items.length;
    const gap = 24;
    const maxCols = Math.max(1, Math.min(3, Math.floor((canvasWidth + gap) / (DEFAULT_SECTION_SIZE.w + gap))));
    const colCount = Math.min(Math.max(1, maxCols), n);
    const w = Math.max(280, Math.floor((canvasWidth - gap * (colCount - 1)) / colCount));
    const h = Math.max(220, Math.min(360, Math.round(w * 0.6)));
    const newItems = items.map((item, i) => {
      const col = i % colCount;
      const row = Math.floor(i / colCount);
      return {
        ...item,
        x: col * (w + gap),
        y: row * (h + gap),
        w,
        h,
      };
    });
    setItemsWithHistory(() => newItems);
    toast({ title: 'Layout applied', description: 'Dashboards arranged to fit.' });
  }, [items, canvasWidth, setItemsWithHistory, toast]);

  const applyColumnLayout = useCallback(() => {
    if (items.length === 0) return;
    const gap = 24;
    const w = Math.min(canvasWidth, 560);
    let y = 0;
    const newItems = items.map((item) => {
      const next = { ...item, x: 0, y, w, h: Math.max(220, item.h) };
      y += next.h + gap;
      return next;
    });
    setItemsWithHistory(() => newItems);
    toast({ title: 'Layout applied', description: 'Stacked in a single column.' });
  }, [items, canvasWidth, setItemsWithHistory, toast]);

  const applyRowLayout = useCallback(() => {
    if (items.length === 0) return;
    const gap = 24;
    let x = 0;
    const h = 260;
    const newItems = items.map((item) => {
      const next = { ...item, x, y: 0, w: Math.max(280, item.w), h };
      x += next.w + gap;
      return next;
    });
    setItemsWithHistory(() => newItems);
    toast({ title: 'Layout applied', description: 'Arranged in a single row.' });
  }, [items, setItemsWithHistory, toast]);

  const applyMasonryLayout = useCallback(() => {
    if (items.length === 0) return;
    const gap = 24;
    const colCount = Math.max(2, Math.min(4, Math.floor((canvasWidth + gap) / (DEFAULT_WIDGET_SIZE.w + gap))));
    const colHeights = Array.from({ length: colCount }).fill(0) as number[];
    const colWidth = Math.floor((canvasWidth - gap * (colCount - 1)) / colCount);
    const newItems = items.map((item) => {
      const col = colHeights.indexOf(Math.min(...colHeights));
      const x = col * (colWidth + gap);
      const y = colHeights[col];
      const h = Math.max(220, item.h);
      colHeights[col] += h + gap;
      return { ...item, x, y, w: colWidth, h };
    });
    setItemsWithHistory(() => newItems);
    toast({ title: 'Layout applied', description: 'Masonry grid for mixed heights.' });
  }, [items, canvasWidth, setItemsWithHistory, toast]);

  const addWidget = useCallback(
    (type: CanvasLayoutItem['type'], payload: CanvasLayoutItem['payload'], size?: { w?: number; h?: number }) => {
      const id = `widget-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const { x, y } = getNextPosition(items);
      const newItem = createLayoutItem(id, type, payload, {
        x,
        y,
        w: size?.w ?? DEFAULT_WIDGET_SIZE.w,
        h: size?.h ?? DEFAULT_WIDGET_SIZE.h,
      });
      setItemsWithHistory((prev) => [...prev, newItem]);
    },
    [items, setItemsWithHistory]
  );

  const removeWidget = useCallback(
    (id: string) => {
      setItemsWithHistory((prev) => prev.filter((i) => i.i !== id));
      if (selectedWidgetId === id) setSelectedWidgetId(null);
      toast({ title: 'Widget removed' });
    },
    [setItemsWithHistory, selectedWidgetId, toast]
  );

  const duplicateWidget = useCallback(
    (id: string) => {
      const item = items.find((i) => i.i === id);
      if (!item) return;
      const newId = `widget-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const { x, y } = getNextPosition(items);
      const copy = createLayoutItem(newId, item.type, { ...item.payload }, { x, y, w: item.w, h: item.h });
      setItemsWithHistory((prev) => [...prev, copy]);
      setSelectedWidgetId(newId);
      toast({ title: 'Widget duplicated' });
    },
    [items, setItemsWithHistory, toast]
  );

  const updateItemRect = useCallback(
    (
      id: string,
      next: Partial<Pick<CanvasLayoutItem, 'x' | 'y' | 'w' | 'h'>>,
      withHistory = false
    ) => {
      const setter = withHistory ? setItemsWithHistory : setItems;
      setter((prev) => prev.map((i) => (i.i === id ? { ...i, ...next } : i)));
    },
    [setItems, setItemsWithHistory]
  );

  const updateWidgetPayload = useCallback((id: string, payload: CanvasLayoutItem['payload']) => {
    setItems((prev) => prev.map((i) => (i.i === id ? { ...i, payload } : i)));
  }, []);

  const addTextBlock = useCallback(() => {
    addWidget('text_block', { type: 'text_block', content: '', title: '' }, DEFAULT_WIDGET_SIZE);
    toast({ title: 'Text block added', description: 'Click to edit.' });
  }, [addWidget, toast]);

  const addRichTextBlock = useCallback(() => {
    addWidget(
      'rich_text',
      { type: 'rich_text', html: '<p>Start writing…</p>' },
      { w: 480, h: 320 }
    );
    toast({ title: 'Rich text added', description: 'Use the toolbar to style content.' });
  }, [addWidget, toast]);

  const addDashboardSection = useCallback(
    (sectionId: string, title: string) => {
      // ── Standalone widgets (no WidgetGroup wrapper) ──────────────────
      const standalone = STANDALONE_WIDGETS[sectionId];
      if (standalone) {
        const { x, y } = getNextPosition(items);
        const id = `widget-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const newItem = createLayoutItem(id, 'registry_widget', {
          type: 'registry_widget' as const,
          definitionId: standalone.defId,
        }, { x, y, w: standalone.w, h: standalone.h });

        setItemsWithHistory((prev) => [...prev, newItem]);
        toast({ title: `${title} added`, description: 'Widget added to canvas.' });
        return;
      }

      // ── Full dashboard sections (WidgetGroup wrapper) ────────────────
      const widgetLayout = SECTION_TO_WIDGETS[sectionId];
      if (widgetLayout) {
        const groupId = `group-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const { x, y: startY } = getNextPosition(items);

        const groupW = canvasWidth || 1200;
        const kpiCount = widgetLayout.widgetIds.filter((id) => {
          const def = getWidgetDefinition(id);
          return def?.category === 'kpi';
        }).length;
        // Embed sections (ExecDashboard, Leaderboard) get explicit minimum heights
        const EMBED_MIN_HEIGHTS: Record<string, number> = {
          executiveDashboard: 700,
          leaderboard: 850,
        };
        const embedOverride = EMBED_MIN_HEIGHTS[sectionId];
        let groupH: number;

        if (embedOverride && widgetLayout.widgetIds.length <= 2) {
          groupH = embedOverride;
        } else {
          const kpiRows = Math.ceil(kpiCount / 7);
          const chartCount = widgetLayout.widgetIds.filter((id) => {
            const d = getWidgetDefinition(id);
            return d?.category === 'chart' || d?.category === 'distribution';
          }).length;
          const tableCount = widgetLayout.widgetIds.filter((id) => {
            const d = getWidgetDefinition(id);
            return d?.category === 'table';
          }).length;
          const chartRows = Math.ceil(chartCount / 2);
          const contentH = kpiRows * 80 + chartRows * 210 + tableCount * 280 + 20;
          groupH = Math.max(350, 110 + contentH);
        }

        const id = `widget-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const newItem = createLayoutItem(id, 'widget_group', {
          type: 'widget_group' as const,
          groupId,
          title,
          sectionType: widgetLayout.sectionType,
          widgetIds: widgetLayout.widgetIds,
        }, { x: 0, y: startY, w: groupW, h: groupH });

        setItemsWithHistory((prev) => [...prev, newItem]);
        toast({
          title: `${title} added`,
          description: `Group with ${widgetLayout.widgetIds.length} widgets and date controls.`,
        });
        return;
      }

      // Fallback: legacy dashboard_section embed (for sections without widget mappings)
      const id = `widget-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const payload = { type: 'dashboard_section' as const, sectionId, title };
      const { x, y } = getNextPosition(items);
      setItemsWithHistory((prev) => {
        const newItem = createLayoutItem(id, 'dashboard_section', payload, {
          x,
          y,
          w: DEFAULT_SECTION_SIZE.w,
          h: DEFAULT_SECTION_SIZE.h,
        });
        return [...prev, newItem];
      });
      toast({ title: 'Dashboard added', description: 'Drag to arrange. Use ⋮ → Bring to front / Send to back for layers.' });
    },
    [items, setItemsWithHistory, toast, canvasWidth]
  );

  const applyTemplate = useCallback(
    (template: (typeof CANVAS_TEMPLATES)[number]) => {
      const newItems = normalizeTemplateItems(template.items, canvasWidth, { x: 0, y: 0 });
      setItemsWithHistory(() => newItems);
      if (template.background) setCanvasBackground(template.background);
      setSelectedWidgetId(null);
      toast({ title: 'Template applied', description: template.label });
    },
    [canvasWidth, setItemsWithHistory, toast]
  );

  useEffect(() => {
    if (pendingPins.length === 0) return;
    const pins = consumePendingPins();
    setItems((prev) => {
      let y = prev.length === 0 ? 0 : Math.max(0, ...prev.map((i) => i.y + i.h)) + 24;
      const newItems: CanvasLayoutItem[] = [];
      pins.forEach((pin) => {
        const id = `widget-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const payload =
          pin.type === 'pinned_insight'
            ? { type: 'pinned_insight' as const, title: pin.payload.title, content: pin.payload.content, visualization: pin.payload.visualization }
            : { type: 'news_card' as const, title: pin.payload.title, summary: pin.payload.summary, link: pin.payload.link };
        const type = pin.type;
        newItems.push(createLayoutItem(id, type, payload, { x: 0, y, ...DEFAULT_WIDGET_SIZE }));
        y += DEFAULT_WIDGET_SIZE.h + 24;
      });
      return [...prev, ...newItems];
    });
    if (pins.length > 0) {
      toast({ title: 'Added to canvas', description: `${pins.length} item(s) pinned. Open Canvas tab to see them.` });
    }
  }, [pendingPins, consumePendingPins, toast]);

  // Listen for dashboard section additions from the sidebar
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.sectionId) {
        const item = DASHBOARD_SECTION_ITEMS.find((s) => s.id === detail.sectionId);
        if (item) {
          addDashboardSection(item.id, item.title);
        }
      }
    };
    window.addEventListener('add-dashboard-section', handler);
    return () => window.removeEventListener('add-dashboard-section', handler);
  }, [addDashboardSection]);

  // Listen for generic canvas widget additions (from Cohi Chat "Add to Workbench")
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.type && detail?.payload) {
        addWidget(detail.type, detail.payload, detail.size ?? { w: 360, h: 240 });
        toast({ title: 'Added to workbench', description: 'Widget from Cohi Chat' });
      }
    };
    window.addEventListener('add-canvas-widget', handler);
    return () => window.removeEventListener('add-canvas-widget', handler);
  }, [addWidget, toast]);

  // (Sidebar report builder links removed — reports are generated from canvas via the header button)

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      if (
        !UPLOAD_ALLOWED_TYPES.includes(file.type) &&
        !file.name.toLowerCase().endsWith('.csv')
      ) {
        toast({
          title: 'Invalid file type',
          description: 'Please upload CSV, PDF, Excel, PowerPoint, or image files.',
          variant: 'destructive',
        });
        return;
      }
      if (file.size > UPLOAD_MAX_SIZE) {
        toast({
          title: 'File too large',
          description: 'Maximum file size is 10MB.',
          variant: 'destructive',
        });
        return;
      }
      setIsUploading(true);
      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('question', 'Analyze this file');
        const response = await fetch('/api/data-chat/analyze-file', {
          method: 'POST',
          body: formData,
        });
        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          throw new Error(err.message || 'Failed to analyze file');
        }
        const result = await response.json();
        const analysis = result.analysis || result.summary || '';
        const visualization = result.visualization;
        const uploadRecord: CanvasUpload = {
          id: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          filename: file.name,
          mimeType: file.type,
          uploadedAt: new Date().toISOString(),
          analysis: analysis || undefined,
          visualization,
        };
        setUploads((prev) => [uploadRecord, ...prev]);
        if (visualization) {
          addWidget('chart', { type: 'chart', config: visualization }, { w: 6, h: 3 });
        }
        toast({
          title: 'File analyzed',
          description: visualization
            ? `Added chart from ${file.name} to canvas.`
            : `${file.name} analyzed. Add a chart from CSV/Excel for automatic visualization.`,
        });
      } catch (err: unknown) {
        toast({
          title: 'Upload failed',
          description: err instanceof Error ? err.message : 'Failed to analyze file',
          variant: 'destructive',
        });
      } finally {
        setIsUploading(false);
      }
    },
    [addWidget, toast]
  );

  const handleLogoChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !file.type.startsWith('image/')) {
      toast({ title: 'Invalid logo', description: 'Upload a PNG, JPG, or SVG logo.', variant: 'destructive' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      addWidget('image', { type: 'image', src: dataUrl, alt: file.name }, { w: 220, h: 140 });
      toast({ title: 'Logo added', description: 'Drag to position and resize.' });
    };
    reader.readAsDataURL(file);
  }, [addWidget, toast]);

  const getUploadIcon = (filename: string) => {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (ext === 'csv' || ext === 'xlsx' || ext === 'xls') return <FileSpreadsheet className="h-4 w-4 text-emerald-500" />;
    if (ext === 'pdf') return <FileText className="h-4 w-4 text-red-500" />;
    if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext || '')) return <Image className="h-4 w-4 text-blue-500" />;
    return <File className="h-4 w-4 text-slate-500" />;
  };

  const formatUploadTime = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    return sameDay ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString();
  };

  const handleBackgroundImageChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setCanvasBackground({ type: 'image', value: dataUrl });
      toast({ title: 'Background set', description: 'Image applied to canvas.' });
    };
    reader.readAsDataURL(file);
  }, [toast]);

  const canvasContainerStyle = ((): React.CSSProperties => {
    if (canvasBackground.type === 'color') {
      return { backgroundColor: canvasBackground.value };
    }
    if (canvasBackground.type === 'image') {
      return {
        backgroundImage: `url(${canvasBackground.value})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      };
    }
    const t = BACKGROUND_TEMPLATES.find((x) => x.id === canvasBackground.value);
    if (t) return t.style;
    return { backgroundColor: '#ffffff' };
  })();

  const updateAnnotationPosition = useCallback(
    (id: string, dx: number, dy: number) => {
      setAnnotations((prev) =>
      prev.map((a) => {
        if (a.id !== id) return a;
        if (a.type === 'text' || a.type === 'rect' || a.type === 'circle' || a.type === 'ellipse') {
          return { ...a, x: a.x + dx, y: a.y + dy };
        }
        if (a.type === 'line') {
          return { ...a, x: a.x + dx, y: a.y + dy, x2: a.x2 + dx, y2: a.y2 + dy };
        }
        return a;
      })
    );
    },
    []
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedWidgetId(null);
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedWidgetId) {
        const t = e.target as HTMLElement;
        if (!t.closest?.('input, textarea, [contenteditable]')) {
          e.preventDefault();
          removeWidget(selectedWidgetId);
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedWidgetId, removeWidget, undo, redo, canUndo, canRedo]);

  const handleAnnotationMouseDown = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setSelectedAnnotationId(id);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  useEffect(() => {
    if (selectedAnnotationId == null || !dragStartRef.current) return;
    const onMove = (e: MouseEvent) => {
      const start = dragStartRef.current;
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      updateAnnotationPosition(selectedAnnotationId, dx, dy);
    };
    const onUp = () => {
      setSelectedAnnotationId(null);
      dragStartRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [selectedAnnotationId, updateAnnotationPosition]);

  const canvasContentHeight = Math.max(
    400,
    items.length === 0 ? 400 : Math.max(0, ...items.map((i) => i.y + i.h)) + 200
  );
  const canvasContentWidth = Math.max(
    canvasWidth,
    items.length === 0 ? canvasWidth : Math.max(0, ...items.map((i) => i.x + i.w)) + 200
  );

  const handleAiBackgroundSubmit = useCallback(async () => {
    setAiBackgroundLoading(true);
    setAiBackgroundResult(null);
    try {
      const res = await fetch('/api/workbench/canvas/generate-background', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: aiBackgroundPrompt || 'professional and clean' }),
      });
      if (!res.ok) throw new Error('Failed to generate');
      const data = await res.json();
      setAiBackgroundResult({ templateId: data.templateId, suggestedDescription: data.suggestedDescription });
    } catch (err) {
      toast({ title: 'AI background failed', description: err instanceof Error ? err.message : 'Try again.', variant: 'destructive' });
    } finally {
      setAiBackgroundLoading(false);
    }
  }, [aiBackgroundPrompt, toast]);

  const applyAiBackground = useCallback(() => {
    if (aiBackgroundResult) {
      setCanvasBackground({ type: 'template', value: aiBackgroundResult.templateId });
      toast({ title: 'Background applied', description: aiBackgroundResult.suggestedDescription });
      setAiBackgroundOpen(false);
      setAiBackgroundResult(null);
      setAiBackgroundPrompt('');
    }
  }, [aiBackgroundResult, toast]);

  const handleSaveClick = useCallback(() => {
    setSaveTitle((t) => t || 'Untitled canvas');
    setSaveDialogOpen(true);
  }, []);

  const captureCanvasAsBlob = useCallback(async (): Promise<Blob | null> => {
    const el = document.getElementById('workbench-canvas-root');
    if (!el) return null;
    try {
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(el, {
        useCORS: true,
        allowTaint: true,
        scale: 2,
        backgroundColor: undefined,
        logging: false,
      });
      return new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b ?? null), 'image/png', 1);
      });
    } catch (e) {
      console.error('Canvas capture error:', e);
      return null;
    }
  }, []);

  const handleExportPng = useCallback(async () => {
    const blob = await captureCanvasAsBlob();
    if (!blob) {
      toast({ title: 'Capture failed', description: 'Could not capture canvas.', variant: 'destructive' });
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(saveTitle || 'canvas').replace(/[^a-z0-9]/gi, '_')}.png`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: 'Downloaded', description: 'Canvas saved as PNG.' });
  }, [captureCanvasAsBlob, saveTitle, toast]);

  const handleExportPdf = useCallback(async () => {
    const blob = await captureCanvasAsBlob();
    if (!blob) {
      toast({ title: 'Capture failed', description: 'Could not capture canvas.', variant: 'destructive' });
      return;
    }
    try {
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({ orientation: 'landscape' });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const imgData = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = reject;
        r.readAsDataURL(blob);
      });
      doc.addImage(imgData, 'PNG', 0, 0, pageW, pageH);
      doc.save(`${(saveTitle || 'canvas').replace(/[^a-z0-9]/gi, '_')}.pdf`);
      toast({ title: 'Downloaded', description: 'Canvas saved as PDF.' });
    } catch (err) {
      toast({ title: 'Export failed', description: err instanceof Error ? err.message : 'Could not create PDF', variant: 'destructive' });
    }
  }, [captureCanvasAsBlob, saveTitle, toast]);

  const handleExportPptx = useCallback(async () => {
    const blob = await captureCanvasAsBlob();
    if (!blob) {
      toast({ title: 'Capture failed', description: 'Could not capture canvas.', variant: 'destructive' });
      return;
    }
    try {
      const pptxgen = (await import('pptxgenjs')).default;
      const pres = new pptxgen();
      pres.author = 'Coheus';
      pres.title = saveTitle || 'Canvas';
      const slide = pres.addSlide();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = reject;
        r.readAsDataURL(blob);
      });
      slide.addImage({ data: dataUrl, x: 0.5, y: 0.5, w: 9, h: 5.25 });
      slide.addText(saveTitle || 'Canvas', { x: 0.5, y: 0.2, w: 9, fontSize: 24, bold: true, color: '1e293b' });
      await pres.writeFile({ fileName: `${(saveTitle || 'canvas').replace(/[^a-z0-9]/gi, '_')}.pptx` });
      toast({ title: 'Downloaded', description: 'PowerPoint saved.' });
    } catch (err) {
      toast({ title: 'Export failed', description: err instanceof Error ? err.message : 'Could not create PowerPoint', variant: 'destructive' });
    }
  }, [captureCanvasAsBlob, saveTitle, toast]);




  /** Excel export: multi-sheet workbook from widget data (KPIs, tables, charts, text, insights). */
  const handleExportExcel = useCallback(() => {
    const safeName = (saveTitle || 'canvas').replace(/[^a-z0-9]/gi, '_');
    const sanitizeSheetName = (name: string) =>
      name.replace(/[\s\\/*?:\[\]]/g, '_').slice(0, 31) || 'Sheet';
    const stripHtml = (html: string) =>
      html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();

    const wb = XLSX.utils.book_new();

    // Summary
    const typeCounts: Record<string, number> = {};
    items.forEach((i) => { typeCounts[i.type] = (typeCounts[i.type] ?? 0) + 1; });
    const summaryRows: (string | number)[][] = [
      ['Canvas Export'],
      ['Title', saveTitle || 'Untitled canvas'],
      ['Exported', new Date().toISOString()],
      [],
      ['Widget type', 'Count'],
      ...Object.entries(typeCounts).map(([k, v]) => [k, v]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), sanitizeSheetName('Summary'));

    // KPIs
    const kpiItems = items.filter((i) => i.type === 'kpi' && i.payload.type === 'kpi');
    if (kpiItems.length > 0) {
      const kpiRows: (string | number)[][] = [['Label', 'Value', 'Format']];
      kpiItems.forEach((i) => {
        const p = i.payload as { label: string; value: number | string; format?: string };
        kpiRows.push([p.label, p.value, p.format ?? '']);
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(kpiRows), sanitizeSheetName('KPIs'));
    }

    // Table widgets (each table → own sheet)
    const tableItems = items.filter((i) => i.type === 'table' && i.payload.type === 'table');
    tableItems.forEach((item, idx) => {
      const p = item.payload as { columns: { key: string; label: string }[]; data: any[] };
      const cols = p.columns ?? [];
      const header = cols.map((c) => c.label || c.key);
      const rows = (p.data ?? []).map((row) => cols.map((c) => row[c.key] ?? ''));
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([header, ...rows]),
        sanitizeSheetName(`Table ${idx + 1}`)
      );
    });

    // Chart widgets (data array → sheet per chart)
    const chartItems = items.filter((i) => i.type === 'chart' && i.payload.type === 'chart');
    chartItems.forEach((item, idx) => {
      const p = item.payload as { config?: { title?: string; data?: any[] } };
      const chartData = p.config?.data;
      if (Array.isArray(chartData) && chartData.length > 0) {
        const cols = Object.keys(chartData[0]);
        const rows = chartData.map((row: any) => cols.map((c) => row[c] ?? ''));
        const sheetName = sanitizeSheetName(`Chart ${idx + 1}` + (p.config?.title ? ` - ${p.config.title}` : ''));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([cols, ...rows]), sheetName);
      }
    });

    // Text (text_block + rich_text)
    const textRows: (string | number)[][] = [['Title', 'Content']];
    items.forEach((i) => {
      if (i.type === 'text_block' && i.payload.type === 'text_block') {
        const p = i.payload as { title?: string; content: string };
        textRows.push([p.title ?? '', p.content ?? '']);
      } else if (i.type === 'rich_text' && i.payload.type === 'rich_text') {
        const p = i.payload as { html: string };
        textRows.push(['', stripHtml(p.html ?? '')]);
      }
    });
    if (textRows.length > 1) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(textRows), sanitizeSheetName('Text'));
    }

    // Insights (pinned_insight, news_card)
    const insightRows: (string | number)[][] = [['Title', 'Content/Summary', 'Link']];
    items.forEach((i) => {
      if (i.type === 'pinned_insight' && i.payload.type === 'pinned_insight') {
        const p = i.payload as { title: string; content: string };
        insightRows.push([p.title ?? '', p.content ?? '', '']);
      } else if (i.type === 'news_card' && i.payload.type === 'news_card') {
        const p = i.payload as { title: string; summary: string; link?: string };
        insightRows.push([p.title ?? '', p.summary ?? '', p.link ?? '']);
      }
    });
    if (insightRows.length > 1) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(insightRows), sanitizeSheetName('Insights'));
    }

    // Dashboard sections (sectionId + title only)
    const sectionItems = items.filter(
      (i) => i.type === 'dashboard_section' && i.payload.type === 'dashboard_section'
    );
    if (sectionItems.length > 0) {
      const sectionRows: (string | number)[][] = [['Section ID', 'Title']];
      sectionItems.forEach((i) => {
        const p = i.payload as { sectionId: string; title: string };
        sectionRows.push([p.sectionId ?? '', p.title ?? '']);
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sectionRows), sanitizeSheetName('Dashboard Sections'));
    }

    try {
      const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeName}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: 'Downloaded', description: 'Canvas data exported as Excel.' });
    } catch (err) {
      toast({
        title: 'Export failed',
        description: err instanceof Error ? err.message : 'Could not create Excel file',
        variant: 'destructive',
      });
    }
  }, [items, saveTitle, toast]);

  // ---- Report Generation: Quick Report from Canvas ----
  const handleQuickReport = useCallback(async (format: 'pptx' | 'pdf' = 'pptx') => {
    const snapshot = useCanvasDataStore.getState().getSnapshot();
    if (!snapshot.length && !items.length) {
      toast({ title: 'Nothing to report', description: 'Add widgets to the canvas first.', variant: 'destructive' });
      return;
    }
    toast({ title: 'Generating report...', description: 'Building multi-slide presentation from canvas data.' });
    try {
      const widgetData = snapshot.map((w) => ({
        itemId: w.itemId,
        widgetName: w.widgetName,
        category: w.category,
        data: w.data,
      }));
      const tenantParam = tenantId ? `?tenant_id=${tenantId}` : '';
      const blob = await fetchBlob(
        `/api/workbench/reports/from-canvas${tenantParam}`,
        {
          widgetData,
          format,
          options: { title: saveTitle || 'Canvas Report' },
        }
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(saveTitle || 'canvas_report').replace(/[^a-z0-9]/gi, '_')}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: 'Report downloaded', description: `Report saved as ${format.toUpperCase()}.` });
    } catch (err: any) {
      console.error('[QuickReport] Error:', err);
      toast({
        title: 'Report generation failed',
        description: err.response?.data?.error || err.message || 'Could not generate report.',
        variant: 'destructive',
      });
    }
  }, [items, saveTitle, tenantId, toast]);

  // ---- AI-Enhanced Report from Canvas ----
  const [isGeneratingAiReport, setIsGeneratingAiReport] = useState(false);
  const handleAiReport = useCallback(async (format: 'pptx' | 'pdf' = 'pptx') => {
    const snapshot = useCanvasDataStore.getState().getSnapshot();
    if (!snapshot.length && !items.length) {
      toast({ title: 'Nothing to report', description: 'Add widgets to the canvas first.', variant: 'destructive' });
      return;
    }

    setIsGeneratingAiReport(true);
    toast({ title: 'Preparing your executive briefing...', description: 'Cohi is analyzing your data and writing a board-ready presentation.' });

    try {
      // Build canvas state snapshot (mirrors the logic from useWorkbenchCohi)
      const sectionState = (await import('@/stores/widgetSectionStore')).useWidgetSectionStore.getState().sections;
      const groups: any[] = [];
      const standaloneWidgets: any[] = [];

      for (const item of items) {
        if (item.payload.type === 'widget_group') {
          const sectionFilters = sectionState[item.payload.groupId];
          groups.push({
            groupId: item.payload.groupId,
            title: item.payload.title,
            sectionType: item.payload.sectionType,
            widgetIds: item.payload.widgetIds,
            filters: sectionFilters ? {
              dateRange: sectionFilters.periodSelection?.preset
                || (sectionFilters.dateRange
                  ? `${sectionFilters.dateRange.start} to ${sectionFilters.dateRange.end}`
                  : `${sectionFilters.year}`),
              dateField: sectionFilters.dateField || undefined,
              branch: sectionFilters.branch !== 'all' ? sectionFilters.branch : undefined,
              loanOfficer: sectionFilters.loanOfficer !== 'all' ? sectionFilters.loanOfficer : undefined,
            } : undefined,
          });
        } else {
          standaloneWidgets.push({
            id: item.i,
            type: item.payload.type,
            title: 'title' in item.payload ? (item.payload as any).title : undefined,
          });
        }
      }

      const widgetData = snapshot.map((entry) => ({
        itemId: entry.itemId,
        widgetName: entry.widgetName,
        category: entry.category,
        data: entry.data,
      }));

      const canvasState = {
        groups,
        standaloneWidgets,
        totalItems: items.length,
        widgetData: widgetData.length > 0 ? widgetData : undefined,
      };

      // Call the Cohi workbench API directly with a report-generation prompt
      const tenantParam = tenantId ? `?tenant_id=${tenantId}` : '';
      const aiResponse = await api.request<{
        message?: string;
        actions?: Array<{ type: string; reportDefinition?: any; format?: string }>;
      }>(
        `/api/cohi-chat/workbench${tenantParam}`,
        {
          method: 'POST',
          body: JSON.stringify({
            question: `Prepare a board-ready executive presentation from everything on this canvas. Use ALL the live data currently visible — KPI values, charts, tables — and embed the actual numbers into the report.

Structure it as a narrative-first executive briefing:
- Slide 1: Title slide with "${saveTitle || 'Executive Performance Summary'}" and today's date
- Slide 2: Executive Summary — write a full 3-5 sentence narrative paragraph summarizing what happened, why it matters, and what requires attention. Include 4-6 top KPIs.
- Slides 3-N: One topic per slide, each LEADING with a narrative paragraph explaining the insight, followed by a supporting chart or table. Write like a senior analyst preparing a board memo.
- Final Slide: "Executive Focus & Recommendations" — 3-5 specific, data-driven recommendations with context.
- Add detailed speaker notes with talking points on every slide.
- Use mortgage industry language: "pull-through resilience", "margin compression", "pipeline velocity", "fallout pressure", "lock-to-close efficiency".
- Cite specific numbers throughout: "$842M (+2% MoM)" not "volume increased".
- Make it immediately exportable — no rework needed. This must be defensible in a board meeting.`,
            canvasState,
            widgetCatalog: '',
            conversationHistory: [],
          }),
        }
      );

      // Extract the generate_report action from the AI response
      const reportAction = aiResponse.actions?.find(
        (a) => a.type === 'generate_report'
      );

      if (!reportAction?.reportDefinition?.slides?.length) {
        // Fallback: if AI didn't produce a report action, use the structural conversion
        toast({ title: 'Falling back to structured report', description: 'AI couldn\'t generate a custom report. Opening Report Builder with canvas data.' });
        setShowReportBuilder(true);
        return;
      }

      // Open the Report Builder with the AI-generated definition so the user
      // can preview, edit, and then export — instead of downloading directly.
      const reportDef = reportAction.reportDefinition;
      const fullDef = {
        id: `ai-report-${Date.now()}`,
        ...reportDef,
        metadata: {
          createdAt: new Date().toISOString(),
          dataAsOf: new Date().toISOString(),
          generatedBy: 'ai' as const,
        },
      };

      setAiReportDefinition(fullDef);
      setShowReportBuilder(true);

      toast({
        title: 'Executive briefing ready',
        description: `"${reportDef.title || 'Report'}" is ready to review. Export to PowerPoint when satisfied.`,
      });
    } catch (err: any) {
      console.error('[AiReport] Error:', err);
      toast({
        title: 'AI report generation failed',
        description: err.response?.data?.error || err.message || 'Could not generate AI report.',
        variant: 'destructive',
      });
    } finally {
      setIsGeneratingAiReport(false);
    }
  }, [items, saveTitle, tenantId, toast, handleQuickReport]);

  // ---- Report Builder mode toggle ----
  const [showReportBuilder, setShowReportBuilder] = useState(false);
  const [aiReportDefinition, setAiReportDefinition] = useState<any | null>(null);

  const handleEmailScreenshot = useCallback(async () => {
    const blob = await captureCanvasAsBlob();
    if (!blob) {
      toast({ title: 'Capture failed', description: 'Could not capture canvas.', variant: 'destructive' });
      return;
    }
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      const subject = encodeURIComponent(`${saveTitle || 'Canvas'} – Coheus`);
      const body = encodeURIComponent(
        'Hi,\n\nThe canvas image has been copied to your clipboard. Paste it here with Ctrl+V (Windows/Linux) or Cmd+V (Mac).\n\n— Coheus'
      );
      window.open(`mailto:?subject=${subject}&body=${body}`, '_blank');
      toast({ title: 'Ready to email', description: 'Canvas image copied. Paste (Ctrl+V / Cmd+V) into the email body.' });
    } catch {
      toast({ title: 'Clipboard failed', description: 'Could not copy image.', variant: 'destructive' });
    }
  }, [captureCanvasAsBlob, saveTitle, toast]);

  const getShareUrl = useCallback(() => {
    if (!canvasId) return '';
    const params = new URLSearchParams();
    const pin = sharePin.trim();
    if (pin) params.set('pin', pin);
    if (shareScope) params.set('scope', shareScope);
    const qs = params.toString();
    return `${window.location.origin}/my-dashboard/${canvasId}${qs ? `?${qs}` : ''}`;
  }, [canvasId, sharePin, shareScope]);

  const getEmbedCode = useCallback(() => {
    const url = getShareUrl();
    return `<iframe src="${url}" width="100%" height="720" style="border:0;border-radius:16px;overflow:hidden" loading="lazy"></iframe>`;
  }, [getShareUrl]);

  const getShareHtmlPage = useCallback(() => {
    const url = getShareUrl();
    const title = (saveTitle || 'Canvas').replace(/[<>]/g, '');
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      html, body {
        height: 100%;
        margin: 0;
        background: #f8fafc;
      }
      .frame {
        height: 100%;
        width: 100%;
        padding: 16px;
        box-sizing: border-box;
      }
      iframe {
        width: 100%;
        height: 100%;
        border: 0;
        border-radius: 16px;
        box-shadow: 0 12px 32px rgba(15, 23, 42, 0.18);
      }
      @media (max-width: 768px) {
        .frame { padding: 8px; }
        iframe { border-radius: 12px; }
      }
    </style>
  </head>
  <body>
    <div class="frame">
      <iframe src="${url}" loading="lazy"></iframe>
    </div>
  </body>
</html>`;
  }, [getShareUrl, saveTitle]);

  const handleEmailLink = useCallback(() => {
    if (!canvasId) {
      toast({ title: 'Save first', description: 'Save the canvas to get a shareable link.', variant: 'destructive' });
      return;
    }
    const shareUrl = getShareUrl();
    const subject = encodeURIComponent(`${saveTitle || 'Canvas'} – Coheus`);
    const pinNote = sharePin.trim() ? `\n\nPIN: ${sharePin.trim()}` : '';
    const scopeNote = shareScope ? `\nScope: ${shareScope}` : '';
    const body = encodeURIComponent(`Hi,\n\nView this canvas:\n${shareUrl}${pinNote}${scopeNote}\n\n— Coheus`);
    const recipient = shareEmail.trim();
    const to = recipient ? `mailto:${encodeURIComponent(recipient)}` : 'mailto:';
    window.open(`${to}?subject=${subject}&body=${body}`, '_blank');
    toast({ title: 'Link ready', description: 'Email draft opened with link to the canvas.' });
  }, [canvasId, getShareUrl, saveTitle, shareEmail, sharePin, shareScope, toast]);

  const handleCopyShareLink = useCallback(async () => {
    if (!canvasId) return;
    const shareUrl = getShareUrl();
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast({ title: 'Link copied', description: `Shareable ${shareScope} link copied to clipboard.` });
    } catch {
      window.prompt('Copy this link:', shareUrl);
    }
  }, [canvasId, getShareUrl, shareScope, toast]);

  const handleToggleFavorite = useCallback(async () => {
    if (!canvasId || favoriteLoading) return;
    setFavoriteLoading(true);
    const next = !shareFavorited;
    try {
      await api.request(`/api/workbench/canvases/${canvasId}/favorite${tenantQs}`, {
        method: 'POST',
        body: JSON.stringify({ favorited: next }),
      });
      setShareFavorited(next);
      toast({
        title: next ? 'Added to bookmarks' : 'Removed from bookmarks',
        description: next ? 'Canvas saved to your bookmarks.' : 'Canvas removed from bookmarks.',
      });
    } catch {
      toast({ title: 'Update failed', description: 'Could not update bookmarks.', variant: 'destructive' });
    } finally {
      setFavoriteLoading(false);
    }
  }, [canvasId, favoriteLoading, shareFavorited, toast, tenantQs]);

  const handleCopyEmbedCode = useCallback(async () => {
    if (!canvasId) return;
    const embed = getEmbedCode();
    try {
      await navigator.clipboard.writeText(embed);
      toast({ title: 'Embed code copied', description: 'Paste into your website.' });
    } catch {
      window.prompt('Copy this embed code:', embed);
    }
  }, [canvasId, getEmbedCode, toast]);

  const handleDownloadHtmlPage = useCallback(() => {
    if (!canvasId) return;
    const html = getShareHtmlPage();
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(saveTitle || 'canvas').replace(/[^a-z0-9]/gi, '_')}.html`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: 'HTML downloaded', description: 'Share the file as a standalone page.' });
  }, [canvasId, getShareHtmlPage, saveTitle, toast]);

  const handleShareClick = useCallback(() => {
    if (!canvasId) {
      setSaveDialogOpen(true);
      toast({ title: 'Save first', description: 'Save the canvas to get a shareable link.' });
      return;
    }
    setShareDialogOpen(true);
  }, [canvasId, toast]);

  const handleSaveConfirm = useCallback(async () => {
    const title = saveTitle.trim() || 'Untitled canvas';
    const content = {
      layoutVersion: 'freeform-v1',
      layout: items,
      annotations,
      background: canvasBackground,
      uploadsMeta: uploads,
    };
    setIsSaving(true);
    setSaveStatus('saving');
    try {
      if (canvasId) {
        await api.request(`/api/workbench/canvases/${canvasId}${tenantQs}`, {
          method: 'PUT',
          body: JSON.stringify({ title, content }),
        });
        toast({ title: 'Canvas saved', description: title });
        onSaved?.(canvasId, title);
      } else {
        const data = await api.request<{ id: string }>(`/api/workbench/canvases${tenantQs}`, {
          method: 'POST',
          body: JSON.stringify({
            title,
            layoutVersion: 'freeform-v1',
            layout: items,
            annotations,
            background: canvasBackground,
            uploadsMeta: uploads,
          }),
        });
        setCanvasId(data.id);
        toast({ title: 'Canvas saved', description: title });
        onSaved?.(data.id, title);
      }
      // Update snapshot so dirty-state resets
      lastSavedSnapshotRef.current = JSON.stringify({ items, annotations, bg: canvasBackground, uploads, title: saveTitle });
      setSaveStatus('saved');
      setSaveDialogOpen(false);
    } catch (err) {
      setSaveStatus('unsaved');
      toast({ title: 'Save failed', description: err instanceof Error ? err.message : 'Try again', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  }, [canvasId, items, annotations, canvasBackground, uploads, saveTitle, toast, tenantQs, onSaved]);

  const hasItems = items.length > 0;

  const handleClearCanvas = useCallback(() => {
    setBothWithHistory([], []);
    setUploads([]);
    setCanvasBackground(DEFAULT_BACKGROUND);
    setSelectedWidgetId(null);
    setSelectedAnnotationId(null);
    setClearConfirmOpen(false);
    toast({ title: 'Canvas cleared', description: 'All blocks and annotations removed. Use Undo to restore.' });
  }, [setBothWithHistory, setUploads, setCanvasBackground, setSelectedAnnotationId, toast]);

  const handleDeselect = useCallback(() => {
    setSelectedWidgetId(null);
  }, []);

  return (
    <WidgetDataProvider>
    <div ref={containerRef} className="flex h-full w-full min-h-0">
      <div
        id="workbench-canvas-root"
        className="flex-1 min-w-0 flex flex-col overflow-hidden"
        style={canvasContainerStyle}
      >
        {/* Toolbar — sticky at top of canvas, always visible */}
        <div className="flex flex-wrap md:flex-nowrap items-center justify-between gap-2 md:gap-1 overflow-x-auto py-1.5 px-3 border-b border-slate-200/70 dark:border-slate-700/70 bg-slate-50/80 dark:bg-slate-800/50 shrink-0 min-h-[44px] sticky top-0 z-20">
          <div className="flex items-center gap-1 flex-wrap md:flex-nowrap shrink-0">
            {!showReportBuilder && (<>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-slate-600 dark:text-slate-400" onClick={() => undo()} disabled={!canUndo}>
                  <Undo2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Undo (Ctrl+Z)</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-slate-600 dark:text-slate-400" onClick={() => redo()} disabled={!canRedo}>
                  <Redo2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Redo (Ctrl+Shift+Z)</TooltipContent>
            </Tooltip>
            <div className="w-px h-5 bg-slate-200 dark:bg-slate-600 shrink-0 mx-0.5" />
            {/* Inline editable canvas name */}
            <input
              type="text"
              value={saveTitle}
              onChange={(e) => setSaveTitle(e.target.value)}
              onBlur={() => {
                if (!saveTitle.trim()) setSaveTitle('Untitled canvas');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
              className="h-8 min-w-[120px] max-w-[260px] px-2 py-1 text-sm font-medium text-slate-700 dark:text-slate-200 bg-transparent border border-transparent hover:border-slate-300 dark:hover:border-slate-600 focus:border-blue-400 dark:focus:border-blue-500 focus:ring-1 focus:ring-blue-400/30 rounded-md outline-none transition-colors truncate"
              placeholder="Canvas name…"
              title="Click to rename this canvas"
            />
            <div className="w-px h-5 bg-slate-200 dark:bg-slate-600 shrink-0 mx-0.5" />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-slate-600 dark:text-slate-400" onClick={handleSaveClick}>
                  <Save className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Save</TooltipContent>
            </Tooltip>
            {/* Autosave status indicator */}
            {saveStatus === 'saving' && (
              <span className="text-[11px] text-amber-600 dark:text-amber-400 whitespace-nowrap animate-pulse">Saving…</span>
            )}
            {saveStatus === 'saved' && canvasId && !isDirty && (
              <span className="text-[11px] text-emerald-600 dark:text-emerald-400 whitespace-nowrap">Saved</span>
            )}
            {saveStatus === 'unsaved' && canvasId && isDirty && (
              <span className="text-[11px] text-slate-400 dark:text-slate-500 whitespace-nowrap">Unsaved changes</span>
            )}
            {/* Share button hidden – not ready for release
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-slate-600 dark:text-slate-400" onClick={handleShareClick}>
                  <Share2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Share</TooltipContent>
            </Tooltip>
            */}
            <input ref={backgroundImageInputRef} type="file" accept="image/*" onChange={handleBackgroundImageChange} className="hidden" aria-hidden />
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-slate-600 dark:text-slate-400">
                      <Palette className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">Background</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="start" className="w-64">
                <div className="px-2 py-2 flex items-center gap-2">
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Color</span>
                  <input type="color" value={canvasBackground.type === 'color' ? canvasBackground.value : '#ffffff'} onChange={(e) => setCanvasBackground({ type: 'color', value: e.target.value })} className="h-8 w-12 cursor-pointer rounded border border-slate-200 dark:border-slate-600 bg-transparent" />
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => backgroundImageInputRef.current?.click()} className="gap-2">
                  <Image className="h-4 w-4" /> Upload image
                </DropdownMenuItem>
                {/* AI background generation hidden until backend endpoint is implemented */}
                <DropdownMenuSeparator />
                <div className="px-2 py-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">Templates</div>
                {BACKGROUND_TEMPLATES.map((t) => (
                  <DropdownMenuItem key={t.id} onClick={() => setCanvasBackground({ type: 'template', value: t.id })} className="gap-2">
                    <span className="h-5 w-8 rounded border border-slate-200 dark:border-slate-600 shrink-0" style={t.style} />
                    {t.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <input ref={fileInputRef} type="file" accept={UPLOAD_ALLOWED_TYPES.join(',') + ',.csv,.xlsx,.xls,.pptx,.ppt'} onChange={handleFileChange} className="hidden" aria-hidden />
            <input ref={logoInputRef} type="file" accept="image/*" onChange={handleLogoChange} className="hidden" aria-hidden />
            {/* Upload file button hidden – not ready for release
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-slate-600 dark:text-slate-400 relative" disabled={isUploading}>
                      <Upload className="h-4 w-4" />
                      {uploads.length > 0 && <span className="absolute -top-0.5 -right-0.5 h-3.5 min-w-[14px] rounded-full bg-slate-500 text-[10px] text-white flex items-center justify-center px-1">{uploads.length}</span>}
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">{isUploading ? 'Uploading…' : 'Upload file'}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="start" className="w-72">
                <DropdownMenuItem onClick={handleUploadClick} disabled={isUploading} className="gap-2">
                  <Upload className="h-4 w-4" /> Upload CSV / Excel / PDF / image…
                </DropdownMenuItem>
                {uploads.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <div className="px-2 py-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-2">
                      <Clock className="h-3.5 w-3.5" /> Recent uploads
                    </div>
                    {uploads.slice(0, 10).map((u) => (
                      <DropdownMenuItem key={u.id} disabled className="gap-2 py-2 cursor-default">
                        <span className="shrink-0">{getUploadIcon(u.filename)}</span>
                        <span className="truncate flex-1" title={u.filename}>{u.filename}</span>
                        <span className="text-xs text-slate-400 shrink-0">{formatUploadTime(u.uploadedAt)}</span>
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            */}
            {/* Image-to-Dashboard button hidden until feature is ready for release
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-950/30"
                  onClick={() => setImageToDashboardOpen(true)}
                >
                  <Camera className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Create dashboard from image</TooltipContent>
            </Tooltip>
            */}
            <div className="w-px h-5 bg-slate-200 dark:bg-slate-600 shrink-0 mx-0.5" />
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8 shrink-0 gap-1.5 px-2 text-slate-700 dark:text-slate-300">
                      <PlusCircle className="h-4 w-4" />
                      <span className="text-xs font-medium">Add</span>
                      <ChevronDown className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">Add widget or template</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="start" className="w-[620px]">
                <div className="grid grid-cols-[160px_1fr] gap-3 px-2 py-2">
                  <div className="space-y-1.5">
                    {DASHBOARD_SECTION_GROUPS.map((group) => (
                      <button
                        key={group.label}
                        type="button"
                        onClick={() => setActiveAddGroup(group.label)}
                        className={`w-full text-left rounded-lg px-2 py-2 text-xs font-semibold uppercase tracking-wider transition-colors ${
                          activeAddGroup === group.label
                            ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                            : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60'
                        }`}
                      >
                        {group.label}
                      </button>
                    ))}
                  </div>
                  <div className="rounded-xl border border-slate-200/70 dark:border-slate-700/70 bg-slate-50/70 dark:bg-slate-900/40 p-2.5">
                    <div className="grid grid-cols-2 gap-2">
                      {(DASHBOARD_SECTION_GROUPS.find((g) => g.label === activeAddGroup)?.items ?? []).map((section) => {
                        const Icon = section.icon;
                        return (
                          <DropdownMenuItem
                            key={section.id}
                            onClick={() => addDashboardSection(section.id, section.title)}
                            className="gap-2 rounded-lg px-2 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-white/70 dark:hover:bg-slate-800/70"
                          >
                            <Icon className={`h-4 w-4 ${section.iconClass ?? 'text-slate-500'}`} />
                            <span className="truncate">{section.title}</span>
                          </DropdownMenuItem>
                        );
                      })}
                    </div>
                  </div>
                </div>
                <div className="h-px bg-slate-200/70 dark:bg-slate-700/60 my-2" />
                <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 px-3">
                  Templates
                </DropdownMenuLabel>
                <div className="grid grid-cols-2 gap-2 px-2 py-2">
                  {CANVAS_TEMPLATES.map((t) => {
                    const Icon = t.icon;
                    return (
                      <DropdownMenuItem
                        key={t.id}
                        onClick={() => applyTemplate(t)}
                        className="gap-3 rounded-lg border border-transparent bg-slate-50/60 p-2.5 transition-colors data-[highlighted]:border-slate-200 data-[highlighted]:bg-slate-100 dark:bg-slate-800/40 dark:data-[highlighted]:border-slate-700 dark:data-[highlighted]:bg-slate-800"
                      >
                        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-slate-600 shadow-sm dark:bg-slate-900 dark:text-slate-300">
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="flex flex-col">
                          <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{t.label}</span>
                          <span className="text-xs text-slate-500 dark:text-slate-400">{t.description}</span>
                        </span>
                      </DropdownMenuItem>
                    );
                  })}
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={addTextBlock} className="gap-2">
                  <StickyNote className="h-4 w-4" />
                  Text block
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {/* Logo button hidden – not ready for release
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0 gap-1.5 px-2 text-slate-700 dark:text-slate-300"
                  onClick={() => logoInputRef.current?.click()}
                >
                  <Image className="h-4 w-4" />
                  <span className="text-xs font-medium">Logo</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Add logo</TooltipContent>
            </Tooltip>
            */}
            {selectedWidgetId && (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={() => duplicateWidget(selectedWidgetId)}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Duplicate selected</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="icon" className="h-8 w-8 shrink-0 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300" onClick={() => removeWidget(selectedWidgetId)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Delete selected</TooltipContent>
                </Tooltip>
              </>
            )}
            {/* Arrange button hidden – not ready for release
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8 shrink-0 gap-1.5 px-2 text-slate-700 dark:text-slate-300">
                      <LayoutGrid className="h-4 w-4" />
                      <span className="text-xs font-medium">Arrange</span>
                      <ChevronDown className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">Arrange layout</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="text-xs font-medium text-slate-500 dark:text-slate-400">Auto layout</DropdownMenuLabel>
                <DropdownMenuItem onClick={applyBestFitLayout} disabled={!hasItems} className="gap-2">
                  <LayoutGrid className="h-4 w-4" />
                  Best fit — balanced grid
                </DropdownMenuItem>
                <DropdownMenuItem onClick={applyMasonryLayout} disabled={!hasItems} className="gap-2">
                  <LayoutGrid className="h-4 w-4" />
                  Masonry — staggered columns
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs font-medium text-slate-500 dark:text-slate-400">Manual layouts</DropdownMenuLabel>
                <DropdownMenuItem onClick={applyRowLayout} disabled={!hasItems} className="gap-2">
                  <LayoutGrid className="h-4 w-4" />
                  Single row
                </DropdownMenuItem>
                <DropdownMenuItem onClick={applyColumnLayout} disabled={!hasItems} className="gap-2">
                  <LayoutGrid className="h-4 w-4" />
                  Single column
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={addRichTextBlock}>
                  <Type className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Rich text</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
                  onClick={() => setClearConfirmOpen(true)}
                  disabled={!hasItems}
                >
                  <Eraser className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Clear canvas</TooltipContent>
            </Tooltip>
            </>)}
            {/* --- End canvas-only tools --- */}

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(
                    'h-8 gap-1.5 text-xs px-2.5 font-medium shrink-0',
                    showCohiPanel
                      ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 border-indigo-300 dark:border-indigo-700'
                      : ''
                  )}
                  onClick={() => setShowCohiPanel(!showCohiPanel)}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Cohi
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Toggle Cohi Assistant</TooltipContent>
            </Tooltip>

            {/* Primary: Generate Report — one-click, AI-powered */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  className={cn(
                    'h-8 gap-1.5 text-xs px-3 font-semibold shrink-0 shadow-sm',
                    isGeneratingAiReport
                      ? 'bg-indigo-400 text-white cursor-wait'
                      : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white'
                  )}
                  onClick={() => handleAiReport('pptx')}
                  disabled={isGeneratingAiReport}
                >
                  {isGeneratingAiReport ? (
                    <><svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12" /></svg> Preparing...</>
                  ) : (
                    <><Sparkles className="h-3.5 w-3.5" /> {showReportBuilder ? 'Regenerate Report' : 'Generate Report'}</>
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Cohi prepares an executive presentation from your canvas data</TooltipContent>
            </Tooltip>

            {/* Report / Canvas view toggle */}
            {showReportBuilder ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 text-xs px-2.5 font-medium shrink-0 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700"
                    onClick={() => setShowReportBuilder(false)}
                  >
                    <LayoutDashboard className="h-3.5 w-3.5" />
                    Back to Canvas
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Switch back to canvas view</TooltipContent>
              </Tooltip>
            ) : aiReportDefinition ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 text-xs px-2.5 font-medium shrink-0 bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 border-violet-300 dark:border-violet-700"
                    onClick={() => setShowReportBuilder(true)}
                  >
                    <Presentation className="h-3.5 w-3.5" />
                    View Report
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Return to your generated report</TooltipContent>
              </Tooltip>
            ) : null}
          </div>
          {!showReportBuilder && (
          <div className="flex items-center gap-1 shrink-0">
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon" className="h-8 w-8 shrink-0">
                      <Download className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">Export</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel className="text-xs font-medium text-slate-500 dark:text-slate-400">Export Canvas</DropdownMenuLabel>
                <DropdownMenuItem onClick={handleExportPng} className="gap-2">
                  <Download className="h-4 w-4" /> Image (PNG)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportPdf} className="gap-2">
                  <FileText className="h-4 w-4" /> PDF
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportPptx} className="gap-2">
                  <Presentation className="h-4 w-4" /> PowerPoint
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportExcel} className="gap-2">
                  <FileSpreadsheet className="h-4 w-4" /> Excel
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs font-medium text-slate-500 dark:text-slate-400">Share</DropdownMenuLabel>
                <DropdownMenuItem onClick={handleEmailScreenshot} className="gap-2">
                  <Mail className="h-4 w-4" /> Email screenshot
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleEmailLink} className="gap-2">
                  <LinkIcon className="h-4 w-4" /> Email link
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          )}
        </div>

        {/* Inline Report Builder — always mounted, hidden when inactive to preserve state */}
        <div className={cn("flex-1 min-h-0 overflow-hidden", !showReportBuilder && "hidden")}>
          <ReportBuilder
            onClose={() => setShowReportBuilder(false)}
            canvasWidgetData={useCanvasDataStore.getState().getSnapshot()}
            canvasTitle={saveTitle || 'Untitled Canvas'}
            tenantId={tenantId}
            initialDefinition={aiReportDefinition ?? undefined}
            inline
          />
        </div>

        {/* Canvas surface: freeform or empty state + annotations overlay */}
        <div className={cn("flex-1 p-2 min-h-0 overflow-auto canvas-freeform", showReportBuilder && "hidden")}>
          <style>{`
            .canvas-freeform .react-resizable-handle {
              opacity: 0;
              z-index: 20;
              width: 14px;
              height: 14px;
              transition: opacity 0.2s ease;
            }
            .canvas-freeform .canvas-item:hover .react-resizable-handle {
              opacity: 1;
            }
            .canvas-freeform .react-resizable-handle-se::after,
            .canvas-freeform .react-resizable-handle-sw::after,
            .canvas-freeform .react-resizable-handle-ne::after,
            .canvas-freeform .react-resizable-handle-nw::after {
              right: 2px;
              bottom: 2px;
              width: 7px;
              height: 7px;
              border-right-width: 2px;
              border-bottom-width: 2px;
              border-color: rgba(100, 116, 139, 0.6);
            }
          `}</style>
          <div className="relative" style={{ width: canvasContentWidth, minHeight: canvasContentHeight }}>
            {hasItems ? (
              items.map((item, index) => {
                const isDashboardSection = item.type === 'dashboard_section' && item.payload.type === 'dashboard_section';
                const payload = item.payload;
                const hideableSections = isDashboardSection ? (DASHBOARD_HIDEABLE_SECTIONS[(payload as { sectionId: string }).sectionId] ?? []) : [];
                const hiddenSections = isDashboardSection ? ((payload as { hiddenSections?: string[] }).hiddenSections ?? []) : [];
                const displayMode = isDashboardSection ? ((payload as { displayMode?: 'full' | 'compact' | 'hidden' }).displayMode ?? 'full') : undefined;
                const onToggleSection = isDashboardSection
                  ? (sectionId: string, hidden: boolean) => {
                      const prev = (payload as { hiddenSections?: string[] }).hiddenSections ?? [];
                      const next = hidden ? [...prev, sectionId] : prev.filter((s) => s !== sectionId);
                      updateWidgetPayload(item.i, { ...payload, hiddenSections: next });
                    }
                  : undefined;

                // ─── Group actions for standalone cohi_widget items ───
                const isStandaloneCohiWidget = item.type === 'cohi_widget' && payload.type === 'cohi_widget';
                const availableGroups = isStandaloneCohiWidget
                  ? items
                      .filter((it) => it.type === 'widget_group' && it.payload.type === 'widget_group' && it.i !== item.i)
                      .map((it) => ({
                        id: it.i,
                        title: (it.payload as any).title || 'Untitled Group',
                      }))
                  : [];

                const handleMoveToGroup = isStandaloneCohiWidget
                  ? (groupId: string) => {
                      const groupItem = items.find((it) => it.i === groupId);
                      if (!groupItem || groupItem.payload.type !== 'widget_group') return;
                      const gp = groupItem.payload;
                      const currentItems = gp.items || gp.widgetIds.map((id: string) => ({ kind: 'registry' as const, defId: id }));
                      const cohiPayload = payload as { sql: string; title: string; vizConfig: any; explanation?: string };
                      const newItem = {
                        kind: 'cohi' as const,
                        id: `moved-${Date.now()}`,
                        sql: cohiPayload.sql,
                        title: cohiPayload.title,
                        vizConfig: cohiPayload.vizConfig,
                        explanation: cohiPayload.explanation,
                      };
                      const updatedGP = {
                        ...gp,
                        items: [...currentItems, newItem],
                        widgetIds: [...currentItems, newItem].filter((i: any) => i.kind === 'registry').map((i: any) => i.defId),
                      };
                      // Remove standalone item and update the target group
                      const sourceId = item.i;
                      const targetId = groupId;
                      setItemsWithHistory((prev) =>
                        prev
                          .filter((it) => it.i !== sourceId)
                          .map((it) => it.i === targetId ? { ...it, payload: updatedGP } : it)
                      );
                      toast({ title: 'Moved to group', description: (gp as any).title });
                    }
                  : undefined;

                const handleWrapInGroup = isStandaloneCohiWidget
                  ? () => {
                      const cohiPayload = payload as { sql: string; title: string; vizConfig: any; explanation?: string };
                      const groupId = `wrap-group-${Date.now()}`;
                      const newGroupItem = createLayoutItem(
                        groupId,
                        'widget_group',
                        {
                          type: 'widget_group',
                          groupId,
                          title: cohiPayload.title || 'New Group',
                          sectionType: 'company-scorecard',
                          widgetIds: [],
                          items: [{
                            kind: 'cohi' as const,
                            id: `wrapped-${Date.now()}`,
                            sql: cohiPayload.sql,
                            title: cohiPayload.title,
                            vizConfig: cohiPayload.vizConfig,
                            explanation: cohiPayload.explanation,
                          }],
                        },
                        { x: item.x, y: item.y, w: 700, h: 500 },
                      );
                      // Replace standalone item with the new group
                      const replaceId = item.i;
                      setItemsWithHistory((prev) =>
                        prev.map((it) => it.i === replaceId ? newGroupItem : it)
                      );
                      toast({ title: 'Wrapped in new group' });
                    }
                  : undefined;

                return (
                    <Rnd
                    key={item.i}
                    size={{ width: item.w, height: item.h }}
                    position={{ x: item.x, y: item.y }}
                    onDragStart={() => setSelectedWidgetId(item.i)}
                    onResizeStart={() => setSelectedWidgetId(item.i)}
                    onDrag={(_, data) => updateItemRect(item.i, { x: data.x, y: data.y })}
                    onDragStop={(_, data) => updateItemRect(item.i, { x: data.x, y: data.y }, true)}
                    onResize={(_, __, ref, ___, position) =>
                      updateItemRect(item.i, {
                        x: position.x,
                        y: position.y,
                        w: ref.offsetWidth,
                        h: ref.offsetHeight,
                      })
                    }
                    onResizeStop={(_, __, ref, ___, position) =>
                      updateItemRect(
                        item.i,
                        {
                          x: position.x,
                          y: position.y,
                          w: ref.offsetWidth,
                          h: ref.offsetHeight,
                        },
                        true
                      )
                    }
                    enableResizing
                    dragHandleClassName={item.type === 'rich_text' ? 'canvas-drag-handle' : undefined}
                    cancel="button, a, input, textarea, select, option, [contenteditable], .canvas-interactive"
                    className="canvas-item"
                    style={{ zIndex: index + 1 }}
                  >
                    <CanvasWidgetCard
                      widgetId={item.i}
                      selected={selectedWidgetId === item.i}
                      onSelect={() => setSelectedWidgetId(item.i)}
                      onDuplicate={() => duplicateWidget(item.i)}
                      onDelete={() => removeWidget(item.i)}
                      className="overflow-hidden"
                      hideableSections={hideableSections}
                      hiddenSections={hiddenSections}
                      onToggleSection={onToggleSection}
                      onBringToFront={() => bringToFront(item.i)}
                      onSendToBack={() => sendToBack(item.i)}
                      displayMode={displayMode}
                      onChangeDisplayMode={
                        isDashboardSection
                          ? (mode) => updateWidgetPayload(item.i, { ...payload, displayMode: mode })
                          : undefined
                      }
                      availableGroups={availableGroups}
                      onMoveToGroup={handleMoveToGroup}
                      onWrapInGroup={handleWrapInGroup}
                      onEditWithCohi={() => {
                        // Open Cohi panel with context about this widget
                        setShowCohiPanel(true);
                        const widgetTitle = (payload as any).title || (payload as any).sectionId || item.type;
                        const widgetType = item.type;
                        const contextMsg = `Help me edit the "${widgetTitle}" widget (type: ${widgetType}, ID: ${item.i}). What changes can I make?`;
                        cohiSendMessage(contextMsg);
                      }}
                    >
                      <WidgetRenderer
                        item={item}
                        height={item.h}
                        width={item.w}
                        onUpdatePayload={
                          item.type === 'text_block' || item.type === 'rich_text' || item.type === 'widget_group'
                            ? (p) => updateWidgetPayload(item.i, p)
                            : undefined
                        }
                        otherGroups={
                          item.type === 'widget_group'
                            ? items
                                .filter((it) => it.type === 'widget_group' && it.payload.type === 'widget_group' && it.i !== item.i)
                                .map((it) => ({ id: it.i, title: (it.payload as any).title || 'Untitled Group' }))
                            : undefined
                        }
                        onMoveItemOut={
                          item.type === 'widget_group'
                            ? (movedItem, targetGroupId) => {
                                // Add the moved item to the target group's items array
                                setItemsWithHistory((prev) =>
                                  prev.map((it) => {
                                    if (it.i !== targetGroupId || it.payload.type !== 'widget_group') return it;
                                    const gp = it.payload;
                                    const currentItems = gp.items || gp.widgetIds.map((id: string) => ({ kind: 'registry' as const, defId: id }));
                                    const updatedItems = [...currentItems, movedItem];
                                    return {
                                      ...it,
                                      payload: {
                                        ...gp,
                                        items: updatedItems,
                                        widgetIds: updatedItems.filter((i: any) => i.kind === 'registry').map((i: any) => i.defId),
                                      },
                                    };
                                  }),
                                );
                                toast({ title: 'Moved to group', description: `Widget moved successfully` });
                              }
                            : undefined
                        }
                      />
                    </CanvasWidgetCard>
                  </Rnd>
                );
              })
            ) : (
              <div className="flex items-center justify-center p-8 min-h-[400px]">
                <div className="text-center max-w-2xl w-full">
                  <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-200/60 dark:shadow-violet-900/40">
                    <Sparkles className="w-7 h-7 text-white" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-1">
                    What would you like to review?
                  </h3>
                  <p className="text-sm text-slate-400 dark:text-slate-500 mb-6">
                    Ask Cohi to prepare dashboards, analyze performance, or build executive presentations.
                  </p>

                  {/* Primary: Natural language input */}
                  <div className="max-w-lg mx-auto mb-6">
                    <button
                      type="button"
                      onClick={() => setShowCohiPanel(true)}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-md hover:border-violet-300 dark:hover:border-violet-600 hover:shadow-lg transition-all group text-left"
                    >
                      <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shrink-0">
                        <Sparkles className="h-4 w-4 text-white" />
                      </div>
                      <span className="flex-1 text-sm text-slate-400 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors">
                        &ldquo;Prepare a board-ready overview of monthly performance&rdquo;
                      </span>
                      <MessageSquare className="h-4 w-4 text-slate-300 dark:text-slate-600 shrink-0 group-hover:text-violet-500 transition-colors" />
                    </button>
                  </div>

                  {/* Quick executive prompts */}
                  <div className="flex flex-wrap gap-2 justify-center mb-6">
                    {[
                      { label: 'Executive Dashboard', prompt: 'Build me a comprehensive executive dashboard with key KPIs, production trends, and pull-through analysis' },
                      { label: 'Monthly Performance', prompt: 'Prepare a monthly performance overview with funded volume, pull-through, turn times, and highlights' },
                      { label: 'Pipeline Review', prompt: 'Show me a pipeline review dashboard with active loans by stage, aging analysis, and fallout risk' },
                      { label: 'Board Presentation', prompt: 'Create a board-ready presentation with executive summary, key metrics, trends, and recommendations' },
                    ].map((q) => (
                      <button
                        key={q.label}
                        type="button"
                        onClick={() => {
                          setShowCohiPanel(true);
                          // Small delay to let the panel open before sending the message
                          setTimeout(() => cohiSendMessage(q.prompt), 300);
                        }}
                        className="px-3 py-1.5 text-xs font-medium rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:border-violet-300 dark:hover:border-violet-600 hover:text-violet-700 dark:hover:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-all"
                      >
                        {q.label}
                      </button>
                    ))}
                  </div>

                  {/* Secondary: Browse library */}
                  <div className="flex items-center justify-center gap-4">
                    <div className="h-px flex-1 max-w-[60px] bg-slate-200 dark:bg-slate-700" />
                    <span className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500">or browse templates</span>
                    <div className="h-px flex-1 max-w-[60px] bg-slate-200 dark:bg-slate-700" />
                  </div>
                  <div className="flex gap-2 justify-center mt-3">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="gap-2 text-slate-500 dark:text-slate-400 text-xs">
                          <LayoutDashboard className="h-3.5 w-3.5" />
                          Dashboard Library
                          <ChevronDown className="h-3 w-3" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="center" className="w-72 max-h-80 overflow-y-auto">
                        {DASHBOARD_SECTION_GROUPS.map((group, gi) => (
                          <React.Fragment key={group.label}>
                            {gi > 0 && <DropdownMenuSeparator />}
                            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-slate-400">{group.label}</DropdownMenuLabel>
                            {group.items.map((section) => {
                              const Icon = section.icon;
                              return (
                                <DropdownMenuItem key={section.id} onClick={() => addDashboardSection(section.id, section.title)} className="gap-2">
                                  <Icon className={`h-4 w-4 ${section.iconClass ?? 'text-slate-500'}`} />
                                  <span>{section.title}</span>
                                </DropdownMenuItem>
                              );
                            })}
                          </React.Fragment>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </div>
            )}
            {annotations.length > 0 && (
              <svg
                className="absolute top-0 left-0 pointer-events-none"
                width={canvasContentWidth}
                height={canvasContentHeight}
                style={{ overflow: 'visible' }}
              >
                <g style={{ pointerEvents: 'auto' }}>
                  {annotations.map((ann) => {
                    if (ann.type === 'text') {
                      const s = ann.style;
                      return (
                        <text
                          key={ann.id}
                          x={ann.x}
                          y={ann.y}
                          fontSize={s?.fontSize ?? 16}
                          fill={s?.fill ?? '#1e293b'}
                          fontFamily={s?.fontFamily ?? 'system-ui, sans-serif'}
                          fontWeight={s?.fontWeight ?? 400}
                          fontStyle={s?.fontStyle ?? 'normal'}
                          textAnchor={s?.textAnchor ?? 'start'}
                          className="cursor-move select-none"
                          style={{ pointerEvents: 'auto' }}
                          onMouseDown={(e) => handleAnnotationMouseDown(e, ann.id)}
                        >
                          {ann.text}
                        </text>
                      );
                    }
                    if (ann.type === 'rect') {
                      return (
                        <rect
                          key={ann.id}
                          x={ann.x}
                          y={ann.y}
                          width={ann.width}
                          height={ann.height}
                          fill={ann.style?.fill ?? 'rgba(59,130,246,0.3)'}
                          stroke={ann.style?.stroke ?? '#3b82f6'}
                          strokeWidth={2}
                          className="cursor-move"
                          style={{ pointerEvents: 'auto' }}
                          onMouseDown={(e) => handleAnnotationMouseDown(e, ann.id)}
                        />
                      );
                    }
                    if (ann.type === 'circle') {
                      return (
                        <circle
                          key={ann.id}
                          cx={ann.x}
                          cy={ann.y}
                          r={ann.r}
                          fill={ann.style?.fill ?? 'rgba(34,197,94,0.3)'}
                          stroke={ann.style?.stroke ?? '#22c55e'}
                          strokeWidth={2}
                          className="cursor-move"
                          style={{ pointerEvents: 'auto' }}
                          onMouseDown={(e) => handleAnnotationMouseDown(e, ann.id)}
                        />
                      );
                    }
                    if (ann.type === 'ellipse') {
                      return (
                        <ellipse
                          key={ann.id}
                          cx={ann.x}
                          cy={ann.y}
                          rx={ann.rx}
                          ry={ann.ry}
                          fill={ann.style?.fill ?? 'rgba(168,85,247,0.25)'}
                          stroke={ann.style?.stroke ?? '#a855f7'}
                          strokeWidth={2}
                          className="cursor-move"
                          style={{ pointerEvents: 'auto' }}
                          onMouseDown={(e) => handleAnnotationMouseDown(e, ann.id)}
                        />
                      );
                    }
                    if (ann.type === 'line') {
                      return (
                        <line
                          key={ann.id}
                          x1={ann.x}
                          y1={ann.y}
                          x2={ann.x2}
                          y2={ann.y2}
                          stroke={ann.style?.stroke ?? '#6366f1'}
                          strokeWidth={2}
                          className="cursor-move"
                          style={{ pointerEvents: 'auto' }}
                          onMouseDown={(e) => handleAnnotationMouseDown(e, ann.id)}
                        />
                      );
                    }
                    return null;
                  })}
                </g>
              </svg>
            )}
          </div>
        </div>

      </div>

      {/* Cohi Assistant Panel (docks right) */}
      <WorkbenchCohiPanel
        open={showCohiPanel}
        onClose={() => setShowCohiPanel(false)}
        messages={cohiMessages}
        isLoading={cohiLoading}
        suggestedQuestions={cohiSuggestions}
        onSendMessage={cohiSendMessage}
        onClearMessages={cohiClearMessages}
        onExecuteAction={handleCohiAction}
      />

      <AlertDialog open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear canvas?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes all widgets, annotations, uploads, and resets the background. You can still Undo after clearing.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleClearCanvas}>Clear canvas</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={shareDialogOpen} onOpenChange={setShareDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Share2 className="h-5 w-5 text-slate-500" />
              Share canvas
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Share scope
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(['private', 'team', 'public'] as const).map((scope) => (
                  <Button
                    key={scope}
                    type="button"
                    variant={shareScope === scope ? 'default' : 'outline'}
                    className="h-8 text-xs capitalize"
                    onClick={() => setShareScope(scope)}
                  >
                    {scope}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Scope tags the link for private, team-only, or public sharing.
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Optional PIN (added to link)
              </label>
              <Input
                placeholder="e.g. 1234"
                value={sharePin}
                onChange={(e) => setSharePin(e.target.value)}
                className="mt-1"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Share with someone
              </label>
              <Input
                placeholder="name@company.com"
                value={shareEmail}
                onChange={(e) => setShareEmail(e.target.value)}
              />
              <Button variant="outline" onClick={handleEmailLink} className="w-full">
                Send email invite
              </Button>
            </div>
            <div className="flex flex-col gap-2">
              <Button onClick={handleCopyShareLink} className="w-full">
                Copy share link
              </Button>
              <Button
                variant={shareFavorited ? 'secondary' : 'outline'}
                onClick={handleToggleFavorite}
                className="w-full"
                disabled={favoriteLoading}
              >
                {shareFavorited ? 'Remove from bookmarks' : 'Add to bookmarks'}
              </Button>
            </div>
            <div className="h-px bg-slate-200 dark:bg-slate-700" />
            <div className="flex flex-col gap-2">
              <Button variant="secondary" onClick={handleCopyEmbedCode} className="w-full gap-2">
                <Code className="h-4 w-4" />
                Copy frame embed
              </Button>
              <Button variant="secondary" onClick={handleDownloadHtmlPage} className="w-full gap-2">
                <FileText className="h-4 w-4" />
                Create HTML page
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Save className="h-5 w-5 text-slate-500" />
              Save canvas
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Title</label>
              <Input
                placeholder="Untitled canvas"
                value={saveTitle}
                onChange={(e) => setSaveTitle(e.target.value)}
                className="mt-2"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleSaveConfirm} disabled={isSaving}>{isSaving ? 'Saving…' : 'Save'}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={aiBackgroundOpen} onOpenChange={setAiBackgroundOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-amber-500" />
              AI background
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Describe the background you want</label>
              <Input
                placeholder="e.g. calm ocean, professional blue, warm sunset"
                value={aiBackgroundPrompt}
                onChange={(e) => setAiBackgroundPrompt(e.target.value)}
                className="mt-2"
                onKeyDown={(e) => e.key === 'Enter' && handleAiBackgroundSubmit()}
              />
            </div>
            {!aiBackgroundResult ? (
              <Button onClick={handleAiBackgroundSubmit} disabled={aiBackgroundLoading} className="w-full gap-2">
                {aiBackgroundLoading ? 'Generating…' : 'Generate with Cohi'}
              </Button>
            ) : (
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2">
                <p className="text-sm text-slate-600 dark:text-slate-400">{aiBackgroundResult.suggestedDescription}</p>
                <div className="flex gap-2">
                  <Button onClick={applyAiBackground} className="flex-1 gap-2">
                    Use as background
                  </Button>
                  <Button variant="outline" onClick={() => setAiBackgroundResult(null)}>Try again</Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
      {/* ---- Image-to-Dashboard Dialog ---- */}
      <ImageToDashboardDialog
        open={imageToDashboardOpen}
        onOpenChange={setImageToDashboardOpen}
        tenantId={tenantId}
        onDashboardGenerated={handleDashboardGenerated}
      />
      {/* Report Builder is now rendered inline above the canvas surface */}
    </div>
    </WidgetDataProvider>
  );
}
