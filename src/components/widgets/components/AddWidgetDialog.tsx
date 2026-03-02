/**
 * AddWidgetDialog – Multi-tab dialog for adding widgets to a WidgetGroup.
 *
 * Three tabs:
 *   1. "Ask Cohi" – Natural language input powered by the Cohi workbench LLM.
 *      User describes what they want and Cohi generates SQL-backed widgets.
 *   2. "Quick Metrics" – Metric + viz-type picker for one-click common widgets.
 *   3. "Templates" – Existing registry widgets (the original AddWidgetPicker).
 *
 * Smart suggested prompts adapt to the group's section type.
 */

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import {
  Sparkles,
  Send,
  Loader2,
  BarChart3,
  Activity,
  PieChart,
  LayoutGrid,
  TrendingUp,
  Hash,
  Plus,
  Search,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { useTenantStore } from '@/stores/tenantStore';
import type { SectionType } from '@/stores/widgetSectionStore';
import type { GroupWidgetItem } from '@/components/workbench/canvas/types';
import type { VisualizationConfig } from '@/hooks/useCohiChat';
import type { WidgetDefinition } from '@/components/widgets/registry';
import { getWidgetsBySource } from '@/components/widgets/registry';
import type { CreateWidgetAction } from '@/types/widgetActions';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SECTION_TO_SOURCE: Record<SectionType, string> = {
  'company-scorecard': 'company-scorecard',
  'credit-risk': 'credit-risk',
  'sales-scorecard': 'sales-scorecard',
  'operations-scorecard': 'operations-scorecard',
  'operations-trends': 'operations-trends',
  'sales-trends': 'sales-trends',
  'funnel': 'funnel',
  'top-tiering-comparison': 'top-tiering-comparison',
  'leaderboard': 'dashboard-metrics',
  'executive-dashboard': 'executive-dashboard',
  'loan-detail': 'loan-detail',
  'workflow-conversion': 'workflow-conversion',
  'high-performers': 'high-performers',
  'actors': 'actors',
  'pricing-dashboard': 'pricing-dashboard',
  'pipeline-analysis': 'pipeline-analysis',
};

// Contextual suggested prompts per section type
const SECTION_SUGGESTIONS: Partial<Record<SectionType, string[]>> = {
  'company-scorecard': [
    'Show pull-through rate by branch as a bar chart',
    'Revenue trend over the last 12 months',
    'Total units KPI for this year vs last year',
    'Volume breakdown by loan officer',
    'Fallout rate by branch as horizontal bars',
  ],
  'credit-risk': [
    'FICO distribution as a bar chart',
    'Average LTV by property type',
    'DTI distribution for funded loans',
    'Credit score trends by month',
  ],
  'sales-scorecard': [
    'Top 10 loan officers by volume',
    'Revenue per loan officer ranked',
    'Pull-through rate comparison across officers',
    'Units closed per branch this quarter',
  ],
};

const DEFAULT_SUGGESTIONS = [
  'Show me pull-through rate by branch',
  'Revenue trend over the last 12 months',
  'Total funded units KPI with year-over-year change',
  'Volume breakdown by loan type as a donut chart',
  'Top performing branches by revenue',
  'Fallout rate trend with denial vs withdrawal split',
];

// Quick metric templates for the "Quick Metrics" tab
const METRIC_TEMPLATES: {
  id: string;
  label: string;
  category: 'kpi' | 'chart';
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  prompt: string;
}[] = [
  {
    id: 'ptr-kpi',
    label: 'Pull-Through Rate',
    category: 'kpi',
    description: 'Funded / completed loans percentage',
    icon: TrendingUp,
    prompt: 'Create a KPI widget showing the current pull-through rate (last 90 days) with year-over-year change. Use the VERIFIED pull-through formula: funded/completed*100.',
  },
  {
    id: 'revenue-kpi',
    label: 'Total Revenue',
    category: 'kpi',
    description: 'Gain-on-sale revenue total',
    icon: Hash,
    prompt: 'Create a KPI widget showing total revenue using the VERIFIED revenue (gain-on-sale) formula for the last 90 days with prior period comparison. Revenue is NOT loan_amount.',
  },
  {
    id: 'volume-kpi',
    label: 'Total Volume',
    category: 'kpi',
    description: 'Total loan volume in dollars',
    icon: Hash,
    prompt: 'Create a KPI widget showing total funded loan volume (SUM of loan_amount for funded loans) for the last 90 days with prior period comparison.',
  },
  {
    id: 'units-kpi',
    label: 'Total Units',
    category: 'kpi',
    description: 'Total loan applications count',
    icon: Hash,
    prompt: 'Create a KPI widget showing total funded loan units (COUNT) for the last 90 days with year-over-year change.',
  },
  {
    id: 'volume-by-branch',
    label: 'Volume by Branch',
    category: 'chart',
    description: 'Bar chart comparing branch volumes',
    icon: BarChart3,
    prompt: 'Create a bar chart showing funded loan volume (SUM of loan_amount) by branch for the last 90 days.',
  },
  {
    id: 'ptr-by-branch',
    label: 'PTR by Branch',
    category: 'chart',
    description: 'Pull-through rate per branch',
    icon: BarChart3,
    prompt: 'Create a horizontal bar chart showing pull-through rate by branch for the last 90 days. Use the VERIFIED pull-through formula.',
  },
  {
    id: 'revenue-trend',
    label: 'Revenue Trend',
    category: 'chart',
    description: 'Monthly revenue over time',
    icon: Activity,
    prompt: 'Create a line chart showing monthly revenue trend. Time range: EXACTLY the last 12 months (CURRENT_DATE - INTERVAL \'12 months\' to CURRENT_DATE), grouped by month. Use the VERIFIED revenue (gain-on-sale) formula, NOT loan_amount.',
  },
  {
    id: 'volume-trend',
    label: 'Volume Trend',
    category: 'chart',
    description: 'Monthly volume over time',
    icon: Activity,
    prompt: 'Create a line chart showing monthly funded loan volume trend. Time range: EXACTLY the last 12 months (CURRENT_DATE - INTERVAL \'12 months\' to CURRENT_DATE), grouped by month.',
  },
  {
    id: 'loan-type-mix',
    label: 'Loan Type Mix',
    category: 'chart',
    description: 'Volume by loan type as donut',
    icon: PieChart,
    prompt: 'Create a donut chart showing funded loan volume distribution by loan type for the last 90 days.',
  },
  {
    id: 'fallout-analysis',
    label: 'Fallout Analysis',
    category: 'chart',
    description: 'Withdrawn vs denied breakdown',
    icon: BarChart3,
    prompt: 'Create a stacked bar chart showing fallout (withdrawn vs denied) by branch',
  },
  {
    id: 'pipeline-table',
    label: 'Pipeline Summary',
    category: 'chart',
    description: 'Active loans summary table',
    icon: LayoutGrid,
    prompt: 'Create a summary table showing pipeline by branch with units, volume, and average loan size',
  },
  {
    id: 'top-officers',
    label: 'Top Loan Officers',
    category: 'chart',
    description: 'Ranked by volume or units',
    icon: BarChart3,
    prompt: 'Create a horizontal bar chart showing the top 15 loan officers by funded volume',
  },
];

// ---------------------------------------------------------------------------
// Tenant resolution helper
// ---------------------------------------------------------------------------
let _cachedTenantId: string | null | undefined = undefined;

async function resolveEffectiveTenantId(
  explicitTenantId?: string | null
): Promise<string | null> {
  if (explicitTenantId) return explicitTenantId;
  if (_cachedTenantId !== undefined) return _cachedTenantId;
  try {
    const response = await api.request<
      { tenants: { id: string }[] } | { id: string }[]
    >('/api/tenants');
    const list = Array.isArray(response)
      ? response
      : (response as any).tenants || [];
    const first = list[0];
    if (first?.id) {
      _cachedTenantId = first.id;
      return _cachedTenantId;
    }
  } catch {
    // ignore
  }
  _cachedTenantId = null;
  return null;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AddWidgetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sectionType: SectionType;
  groupId: string;
  existingItems: GroupWidgetItem[];
  /** Callback to add a registry widget by defId */
  onAddRegistry: (defId: string) => void;
  /** Callback to add a Cohi-generated widget */
  onAddCohi: (widget: {
    sql: string;
    title: string;
    vizConfig: VisualizationConfig;
    explanation?: string;
  }) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AddWidgetDialog({
  open,
  onOpenChange,
  sectionType,
  groupId,
  existingItems,
  onAddRegistry,
  onAddCohi,
}: AddWidgetDialogProps) {
  const [activeTab, setActiveTab] = useState('cohi');
  const { selectedTenantId } = useTenantStore();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 pt-4 pb-0 shrink-0">
          <DialogTitle className="text-base font-semibold flex items-center gap-2">
            <Plus className="h-4 w-4 text-blue-500" />
            Add Widget
          </DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
          <TabsList className="mx-5 mt-3 mb-0 h-8 bg-slate-100 dark:bg-slate-800 p-0.5 shrink-0">
            <TabsTrigger value="cohi" className="text-xs h-7 gap-1.5 data-[state=active]:bg-white dark:data-[state=active]:bg-slate-900">
              <Sparkles className="h-3 w-3" />
              Ask Cohi
            </TabsTrigger>
            <TabsTrigger value="metrics" className="text-xs h-7 gap-1.5 data-[state=active]:bg-white dark:data-[state=active]:bg-slate-900">
              <BarChart3 className="h-3 w-3" />
              Quick Metrics
            </TabsTrigger>
            <TabsTrigger value="templates" className="text-xs h-7 gap-1.5 data-[state=active]:bg-white dark:data-[state=active]:bg-slate-900">
              <LayoutGrid className="h-3 w-3" />
              Templates
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 min-h-0 overflow-hidden">
            <TabsContent value="cohi" className="h-full m-0 p-0">
              <AskCohiTab
                sectionType={sectionType}
                tenantId={selectedTenantId}
                onAddWidget={(widget) => {
                  onAddCohi(widget);
                  onOpenChange(false);
                }}
              />
            </TabsContent>
            <TabsContent value="metrics" className="h-full m-0 p-0">
              <QuickMetricsTab
                sectionType={sectionType}
                tenantId={selectedTenantId}
                onAddWidget={(widget) => {
                  onAddCohi(widget);
                  onOpenChange(false);
                }}
              />
            </TabsContent>
            <TabsContent value="templates" className="h-full m-0 p-0">
              <TemplatesTab
                sectionType={sectionType}
                existingItems={existingItems}
                onAddRegistry={(defId) => {
                  onAddRegistry(defId);
                  onOpenChange(false);
                }}
              />
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// ===========================================================================
// Tab 1: Ask Cohi
// ===========================================================================

function AskCohiTab({
  sectionType,
  tenantId,
  onAddWidget,
}: {
  sectionType: SectionType;
  tenantId?: string | null;
  onAddWidget: (widget: {
    sql: string;
    title: string;
    vizConfig: VisualizationConfig;
    explanation?: string;
  }) => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdWidgets, setCreatedWidgets] = useState<CreateWidgetAction[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const suggestions = useMemo(
    () => SECTION_SUGGESTIONS[sectionType] || DEFAULT_SUGGESTIONS,
    [sectionType],
  );

  useEffect(() => {
    // Auto-focus input when tab becomes active
    const timer = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(timer);
  }, []);

  const handleSubmit = useCallback(
    async (text?: string) => {
      const question = (text || prompt).trim();
      if (!question || loading) return;

      setLoading(true);
      setError(null);
      setCreatedWidgets([]);

      try {
        const effectiveTid = await resolveEffectiveTenantId(tenantId);
        const base = '/api/cohi-chat/workbench';
        const url = effectiveTid
          ? `${base}?tenant_id=${encodeURIComponent(effectiveTid)}`
          : base;

        // Use a conversation history instruction to strongly direct the LLM
        // to produce create_widget actions instead of just teaching notes.
        const systemInstruction = {
          role: 'user',
          content: 'I need you to create visualization widgets for my dashboard. Rules: (1) You MUST respond with one or more "create_widget" actions containing valid PostgreSQL SQL and a visualization config. Do NOT respond with only teaching notes — always generate the widget. (2) ALWAYS use the VERIFIED METRICS SQL formulas from your context for revenue, pull-through, volume, etc. — never invent your own formulas. (3) When I specify a time range like "last 12 months", use EXACTLY that range (CURRENT_DATE - INTERVAL \'12 months\') — do NOT override to YTD or any other default.',
        };
        const assistantAck = {
          role: 'assistant',
          content: '{"message": "Understood! I\'ll generate create_widget actions using the verified metric formulas and respect your exact time ranges. What would you like me to build?", "actions": [], "suggestedQuestions": []}',
        };

        const response = await api.request<{
          message: string;
          actions?: Array<{ type: string; sql?: string; config?: VisualizationConfig; title?: string; explanation?: string }>;
          error?: string;
        }>(url, {
          method: 'POST',
          body: JSON.stringify({
            question: `Build me this widget now: ${question}. Respond with a create_widget action including the SQL query and visualization config.`,
            canvasState: { groups: [], standaloneWidgets: [], totalItems: 0 },
            widgetCatalog: '',
            conversationHistory: [systemInstruction, assistantAck],
            tenantId: effectiveTid,
          }),
        });

        if (response.error) {
          setError(response.error);
          return;
        }

        // Extract create_widget actions
        const widgets = (response.actions || [])
          .filter((a): a is CreateWidgetAction => a.type === 'create_widget' && !!a.sql && !!a.config)
          .map((a) => ({
            type: 'create_widget' as const,
            sql: a.sql!,
            config: a.config!,
            title: a.title || 'Cohi Widget',
            explanation: a.explanation || '',
          }));

        if (widgets.length > 0) {
          setCreatedWidgets(widgets);
        } else {
          setError('Cohi couldn\'t generate a widget from that prompt. Try being more specific about the metric and visualization type.');
        }
      } catch (err: any) {
        setError(err.message || 'Failed to generate widget');
      } finally {
        setLoading(false);
      }
    },
    [prompt, loading, tenantId],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  return (
    <div className="flex flex-col h-full">
      {/* Input area */}
      <div className="px-5 pt-4 pb-3 shrink-0">
        <div className="relative">
          <textarea
            ref={inputRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe the widget you want… e.g. 'Pull-through rate by branch as a bar chart'"
            rows={2}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2.5 pr-12 text-sm text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-400 resize-none"
          />
          <button
            type="button"
            onClick={() => handleSubmit()}
            disabled={!prompt.trim() || loading}
            className="absolute right-2 bottom-2 p-1.5 rounded-md bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Generate widget"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>
        {error && (
          <p className="mt-2 text-xs text-red-500">{error}</p>
        )}
      </div>

      {/* Results or suggestions */}
      <div className="flex-1 min-h-0 overflow-auto px-5 pb-4">
        {createdWidgets.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">
              Cohi generated {createdWidgets.length} widget{createdWidgets.length !== 1 ? 's' : ''}:
            </p>
            {createdWidgets.map((widget, idx) => (
              <div
                key={idx}
                className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <VizTypeIcon type={widget.config.type} />
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">
                      {widget.title}
                    </span>
                  </div>
                  {widget.explanation && (
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">
                      {widget.explanation}
                    </p>
                  )}
                </div>
                <Button
                  size="sm"
                  className="h-7 text-xs shrink-0"
                  onClick={() =>
                    onAddWidget({
                      sql: widget.sql,
                      title: widget.title,
                      vizConfig: widget.config,
                      explanation: widget.explanation,
                    })
                  }
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add
                </Button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => { setCreatedWidgets([]); setPrompt(''); }}
              className="mt-2 text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
            >
              ← Try a different prompt
            </button>
          </div>
        ) : !loading ? (
          <div>
            <p className="text-xs font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">
              Suggestions
            </p>
            <div className="grid grid-cols-1 gap-1.5">
              {suggestions.map((s, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => { setPrompt(s); handleSubmit(s); }}
                  className="text-left px-3 py-2 rounded-md border border-slate-100 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300 hover:bg-blue-50 dark:hover:bg-blue-950/30 hover:border-blue-200 dark:hover:border-blue-800 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
                >
                  <Sparkles className="inline h-3 w-3 mr-1.5 text-blue-400" />
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center py-12 text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            <span className="text-sm">Cohi is generating your widget…</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ===========================================================================
// Tab 2: Quick Metrics
// ===========================================================================

function QuickMetricsTab({
  sectionType,
  tenantId,
  onAddWidget,
}: {
  sectionType: SectionType;
  tenantId?: string | null;
  onAddWidget: (widget: {
    sql: string;
    title: string;
    vizConfig: VisualizationConfig;
    explanation?: string;
  }) => void;
}) {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const kpiMetrics = useMemo(
    () => METRIC_TEMPLATES.filter((m) => m.category === 'kpi'),
    [],
  );
  const chartMetrics = useMemo(
    () => METRIC_TEMPLATES.filter((m) => m.category === 'chart'),
    [],
  );

  const handleGenerate = useCallback(
    async (template: (typeof METRIC_TEMPLATES)[0]) => {
      if (loadingId) return;
      setLoadingId(template.id);
      setError(null);

      try {
        const effectiveTid = await resolveEffectiveTenantId(tenantId);
        const base = '/api/cohi-chat/workbench';
        const url = effectiveTid
          ? `${base}?tenant_id=${encodeURIComponent(effectiveTid)}`
          : base;

        // Same directive conversation history as AskCohiTab
        const systemInstruction = {
          role: 'user',
          content: 'I need you to create visualization widgets for my dashboard. Rules: (1) You MUST respond with one or more "create_widget" actions containing valid PostgreSQL SQL and a visualization config. Do NOT respond with only teaching notes — always generate the widget. (2) ALWAYS use the VERIFIED METRICS SQL formulas from your context for revenue, pull-through, volume, etc. — never invent your own formulas. (3) When the prompt specifies a time range like "last 12 months", use EXACTLY that range (CURRENT_DATE - INTERVAL \'12 months\') — do NOT override to YTD or any other default.',
        };
        const assistantAck = {
          role: 'assistant',
          content: '{"message": "Understood! I\'ll generate create_widget actions using the verified metric formulas and respect exact time ranges. What would you like me to build?", "actions": [], "suggestedQuestions": []}',
        };

        const response = await api.request<{
          message: string;
          actions?: Array<{ type: string; sql?: string; config?: VisualizationConfig; title?: string; explanation?: string }>;
          error?: string;
        }>(url, {
          method: 'POST',
          body: JSON.stringify({
            question: `Build me this widget now: ${template.prompt}. Respond with a create_widget action including the SQL query and visualization config.`,
            canvasState: { groups: [], standaloneWidgets: [], totalItems: 0 },
            widgetCatalog: '',
            conversationHistory: [systemInstruction, assistantAck],
            tenantId: effectiveTid,
          }),
        });

        if (response.error) {
          setError(response.error);
          return;
        }

        const widget = (response.actions || []).find(
          (a): a is CreateWidgetAction => a.type === 'create_widget' && !!a.sql && !!a.config,
        );

        if (widget) {
          onAddWidget({
            sql: widget.sql,
            title: widget.title || template.label,
            vizConfig: widget.config,
            explanation: widget.explanation,
          });
        } else {
          setError(`Couldn't generate "${template.label}". Try the "Ask Cohi" tab for more control.`);
        }
      } catch (err: any) {
        setError(err.message || 'Failed to generate widget');
      } finally {
        setLoadingId(null);
      }
    },
    [loadingId, tenantId, onAddWidget],
  );

  return (
    <div className="flex flex-col h-full overflow-auto px-5 py-4">
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
        One-click metrics powered by Cohi. Click any metric to generate a widget instantly.
      </p>
      {error && (
        <p className="text-xs text-red-500 mb-3">{error}</p>
      )}

      {/* KPI section */}
      <div className="mb-4">
        <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">
          KPI Cards
        </p>
        <div className="grid grid-cols-2 gap-2">
          {kpiMetrics.map((m) => (
            <MetricCard
              key={m.id}
              template={m}
              loading={loadingId === m.id}
              disabled={loadingId !== null}
              onClick={() => handleGenerate(m)}
            />
          ))}
        </div>
      </div>

      {/* Charts section */}
      <div>
        <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">
          Charts & Tables
        </p>
        <div className="grid grid-cols-2 gap-2">
          {chartMetrics.map((m) => (
            <MetricCard
              key={m.id}
              template={m}
              loading={loadingId === m.id}
              disabled={loadingId !== null}
              onClick={() => handleGenerate(m)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  template,
  loading,
  disabled,
  onClick,
}: {
  template: (typeof METRIC_TEMPLATES)[0];
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = template.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex items-start gap-2.5 p-3 rounded-lg border text-left transition-all',
        loading
          ? 'border-blue-300 dark:border-blue-700 bg-blue-50/50 dark:bg-blue-950/20'
          : 'border-slate-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-700 hover:bg-blue-50/30 dark:hover:bg-blue-950/10',
        disabled && !loading && 'opacity-50 cursor-not-allowed',
      )}
    >
      <div className="mt-0.5 p-1.5 rounded-md bg-slate-100 dark:bg-slate-800 shrink-0">
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin" />
        ) : (
          <Icon className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
        )}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate">
          {template.label}
        </p>
        <p className="text-[10px] text-slate-500 dark:text-slate-400 line-clamp-1 mt-0.5">
          {template.description}
        </p>
      </div>
    </button>
  );
}

// ===========================================================================
// Tab 3: Templates (registry widgets)
// ===========================================================================

function TemplatesTab({
  sectionType,
  existingItems,
  onAddRegistry,
}: {
  sectionType: SectionType;
  existingItems: GroupWidgetItem[];
  onAddRegistry: (defId: string) => void;
}) {
  const sourceId = SECTION_TO_SOURCE[sectionType];
  const available = useMemo(() => getWidgetsBySource(sourceId), [sourceId]);
  const [search, setSearch] = useState('');

  const existingRegistryIds = useMemo(
    () =>
      existingItems
        .filter((i) => i.kind === 'registry')
        .map((i) => (i as Extract<GroupWidgetItem, { kind: 'registry' }>).defId),
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

  const grouped = useMemo(() => {
    const map = new Map<string, WidgetDefinition[]>();
    for (const w of filtered) {
      if (!map.has(w.category)) map.set(w.category, []);
      map.get(w.category)!.push(w);
    }
    return map;
  }, [filtered]);

  const categoryLabels: Record<string, string> = {
    kpi: 'KPI Cards',
    chart: 'Charts',
    table: 'Tables',
    distribution: 'Distributions',
    funnel: 'Funnels',
    insight: 'Insights',
  };

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="px-5 pt-4 pb-2 shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input
            autoFocus
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search pre-built widgets…"
            title="Search available widgets"
            className="w-full h-8 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 pl-8 pr-3 text-xs text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
          />
        </div>
      </div>

      {/* Widget list */}
      <div className="flex-1 min-h-0 overflow-auto px-5 pb-4">
        {[...grouped.entries()].map(([category, widgets]) => (
          <div key={category} className="mb-3">
            <div className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1.5">
              {categoryLabels[category] || category}
            </div>
            <div className="space-y-1">
              {widgets.map((w) => {
                const alreadyIn = existingRegistryIds.includes(w.id);
                return (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => onAddRegistry(w.id)}
                    className="w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-md border border-transparent hover:border-slate-200 dark:hover:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs transition-colors group"
                  >
                    <VizCategoryIcon category={w.category} />
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-slate-700 dark:text-slate-200 truncate block">
                        {w.name}
                      </span>
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 line-clamp-1">
                        {w.description}
                      </span>
                    </div>
                    {alreadyIn ? (
                      <span className="text-[9px] font-medium text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 rounded px-1.5 py-0.5 shrink-0">
                        ADDED
                      </span>
                    ) : (
                      <Plus className="h-3.5 w-3.5 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <p className="text-xs text-slate-400 dark:text-slate-500 text-center py-8">
            No widgets found for this section type
          </p>
        )}
      </div>
    </div>
  );
}

// ===========================================================================
// Helper icons
// ===========================================================================

function VizTypeIcon({ type }: { type: string }) {
  switch (type) {
    case 'bar':
    case 'horizontal_bar':
      return <BarChart3 className="h-3.5 w-3.5 text-blue-500" />;
    case 'line':
    case 'area':
      return <Activity className="h-3.5 w-3.5 text-emerald-500" />;
    case 'pie':
    case 'donut':
      return <PieChart className="h-3.5 w-3.5 text-violet-500" />;
    case 'table':
      return <LayoutGrid className="h-3.5 w-3.5 text-amber-500" />;
    case 'kpi':
      return <Hash className="h-3.5 w-3.5 text-rose-500" />;
    default:
      return <BarChart3 className="h-3.5 w-3.5 text-slate-400" />;
  }
}

function VizCategoryIcon({ category }: { category: string }) {
  switch (category) {
    case 'kpi':
      return <div className="p-1 rounded bg-rose-50 dark:bg-rose-950/30"><Hash className="h-3 w-3 text-rose-500" /></div>;
    case 'chart':
      return <div className="p-1 rounded bg-blue-50 dark:bg-blue-950/30"><BarChart3 className="h-3 w-3 text-blue-500" /></div>;
    case 'table':
      return <div className="p-1 rounded bg-amber-50 dark:bg-amber-950/30"><LayoutGrid className="h-3 w-3 text-amber-500" /></div>;
    case 'distribution':
      return <div className="p-1 rounded bg-violet-50 dark:bg-violet-950/30"><Activity className="h-3 w-3 text-violet-500" /></div>;
    default:
      return <div className="p-1 rounded bg-slate-100 dark:bg-slate-800"><BarChart3 className="h-3 w-3 text-slate-400" /></div>;
  }
}
