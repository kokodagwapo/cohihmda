/**
 * ImageToDashboardDialog
 * Upload a dashboard screenshot, get an LLM-generated blueprint, preview/edit it,
 * then generate SQL-backed widgets and add them to the canvas.
 */

import React, { useState, useCallback, useRef } from 'react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  ImagePlus,
  Loader2,
  Trash2,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Check,
  AlertCircle,
  BarChart3,
  Table2,
  Activity,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ============================================================================
// Types (mirror server-side DashboardBlueprint)
// ============================================================================

interface WidgetBlueprint {
  title: string;
  description: string;
  vizType: string;
  multiSeries?: boolean;
  seriesLabels?: string[];
  columns?: string[];
  suggestedSql?: string;
  layoutHint?: { w: number; h: number };
}

interface DashboardGroupBlueprint {
  title: string;
  sectionType: string;
  dateField: string;
  widgets: WidgetBlueprint[];
}

interface DashboardBlueprint {
  title: string;
  groups: DashboardGroupBlueprint[];
}

interface GeneratedWidget {
  id: string;
  sql: string;
  title: string;
  vizConfig: any;
  explanation?: string;
}

interface GeneratedGroup {
  title: string;
  sectionType: string;
  dateField: string;
  widgets: GeneratedWidget[];
}

// ============================================================================
// Props
// ============================================================================

interface ImageToDashboardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId?: string | null;
  onDashboardGenerated: (groups: GeneratedGroup[]) => void;
}

// ============================================================================
// Step indicator
// ============================================================================

type Step = 'upload' | 'preview' | 'generating' | 'done';

function StepIndicator({ step }: { step: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: 'upload', label: 'Upload' },
    { key: 'preview', label: 'Review' },
    { key: 'generating', label: 'Generate' },
    { key: 'done', label: 'Done' },
  ];
  const currentIdx = steps.findIndex((s) => s.key === step);

  return (
    <div className="flex items-center gap-1.5 mb-4">
      {steps.map((s, idx) => (
        <React.Fragment key={s.key}>
          <div
            className={cn(
              'flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full transition-colors',
              idx < currentIdx && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400',
              idx === currentIdx && 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
              idx > currentIdx && 'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500'
            )}
          >
            {idx < currentIdx ? <Check className="h-3 w-3" /> : <span className="h-3 w-3 flex items-center justify-center text-[10px]">{idx + 1}</span>}
            {s.label}
          </div>
          {idx < steps.length - 1 && <div className="w-4 h-px bg-slate-200 dark:bg-slate-700" />}
        </React.Fragment>
      ))}
    </div>
  );
}

// ============================================================================
// Widget type icon
// ============================================================================

function VizIcon({ type }: { type: string }) {
  switch (type) {
    case 'kpi':
      return <Activity className="h-3.5 w-3.5 text-emerald-500" />;
    case 'table':
      return <Table2 className="h-3.5 w-3.5 text-blue-500" />;
    default:
      return <BarChart3 className="h-3.5 w-3.5 text-violet-500" />;
  }
}

// ============================================================================
// Main Component
// ============================================================================

export function ImageToDashboardDialog({
  open,
  onOpenChange,
  tenantId,
  onDashboardGenerated,
}: ImageToDashboardDialogProps) {
  const [step, setStep] = useState<Step>('upload');
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [blueprint, setBlueprint] = useState<DashboardBlueprint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());
  const [generatingProgress, setGeneratingProgress] = useState<{ current: number; total: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---- Reset state when dialog closes ----
  const handleOpenChange = useCallback(
    (v: boolean) => {
      if (!v) {
        setStep('upload');
        setImageDataUrl(null);
        setDescription('');
        setBlueprint(null);
        setError(null);
        setExpandedGroups(new Set());
        setGeneratingProgress(null);
        setIsAnalyzing(false);
      }
      onOpenChange(v);
    },
    [onOpenChange]
  );

  // ---- File selection ----
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file (PNG, JPG, etc.)');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setError('Image must be smaller than 20 MB');
      return;
    }
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      setImageDataUrl(reader.result as string);
    };
    reader.readAsDataURL(file);
    // Reset the input so re-selecting the same file works
    e.target.value = '';
  }, []);

  // ---- Drop handler ----
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file || !file.type.startsWith('image/')) {
      setError('Please drop an image file');
      return;
    }
    setError(null);
    const reader = new FileReader();
    reader.onload = () => setImageDataUrl(reader.result as string);
    reader.readAsDataURL(file);
  }, []);

  // ---- Analyze the image ----
  const handleAnalyze = useCallback(async () => {
    if (!imageDataUrl) return;
    setIsAnalyzing(true);
    setError(null);
    try {
      const tenantQs = tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : '';
      const result = await api.request<{ blueprint: DashboardBlueprint }>(
        `/api/cohi-chat/analyze-dashboard-image${tenantQs}`,
        {
          method: 'POST',
          body: JSON.stringify({ image: imageDataUrl, description: description || undefined }),
        }
      );
      setBlueprint(result.blueprint);
      // Expand all groups by default
      setExpandedGroups(new Set(result.blueprint.groups.map((_, i) => i)));
      setStep('preview');
    } catch (err: any) {
      setError(err.message || 'Failed to analyze image');
    } finally {
      setIsAnalyzing(false);
    }
  }, [imageDataUrl, description, tenantId]);

  // ---- Edit blueprint helpers ----
  const updateGroupTitle = useCallback((groupIdx: number, title: string) => {
    setBlueprint((prev) => {
      if (!prev) return prev;
      const groups = [...prev.groups];
      groups[groupIdx] = { ...groups[groupIdx], title };
      return { ...prev, groups };
    });
  }, []);

  const removeWidget = useCallback((groupIdx: number, widgetIdx: number) => {
    setBlueprint((prev) => {
      if (!prev) return prev;
      const groups = [...prev.groups];
      const widgets = [...groups[groupIdx].widgets];
      widgets.splice(widgetIdx, 1);
      groups[groupIdx] = { ...groups[groupIdx], widgets };
      // If group is empty, remove it
      if (widgets.length === 0) {
        groups.splice(groupIdx, 1);
      }
      return { ...prev, groups };
    });
  }, []);

  const removeGroup = useCallback((groupIdx: number) => {
    setBlueprint((prev) => {
      if (!prev) return prev;
      const groups = [...prev.groups];
      groups.splice(groupIdx, 1);
      return { ...prev, groups };
    });
  }, []);

  const toggleGroup = useCallback((idx: number) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  // ---- Generate widgets from blueprint ----
  const handleGenerate = useCallback(async () => {
    if (!blueprint || blueprint.groups.length === 0) return;
    setStep('generating');
    setError(null);
    setGeneratingProgress({ current: 0, total: blueprint.groups.length });

    const generatedGroups: GeneratedGroup[] = [];

    try {
      const tenantQs = tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : '';

      for (let i = 0; i < blueprint.groups.length; i++) {
        setGeneratingProgress({ current: i + 1, total: blueprint.groups.length });
        const group = blueprint.groups[i];

        const result = await api.request<{ group: GeneratedGroup }>(
          `/api/cohi-chat/generate-dashboard-widgets${tenantQs}`,
          {
            method: 'POST',
            body: JSON.stringify({ blueprint: group }),
          }
        );

        generatedGroups.push(result.group);
      }

      setStep('done');
      onDashboardGenerated(generatedGroups);

      // Auto-close after a moment
      setTimeout(() => handleOpenChange(false), 1500);
    } catch (err: any) {
      setError(err.message || 'Failed to generate widgets');
      setStep('preview'); // Go back to preview on error
    }
  }, [blueprint, tenantId, onDashboardGenerated, handleOpenChange]);

  // ---- Render ----
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-violet-500" />
            Create Dashboard from Image
          </DialogTitle>
        </DialogHeader>

        <StepIndicator step={step} />

        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 text-sm">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {/* ================================================================ */}
        {/* STEP 1: Upload */}
        {/* ================================================================ */}
        {step === 'upload' && (
          <div className="space-y-4">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Upload a screenshot of an existing dashboard and Cohi will analyze it to recreate the
              visualizations with live data from your database.
            </p>

            {/* Drop zone */}
            {!imageDataUrl ? (
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-xl p-8 flex flex-col items-center gap-3 cursor-pointer hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50/30 dark:hover:bg-blue-950/10 transition-colors"
              >
                <ImagePlus className="h-10 w-10 text-slate-400 dark:text-slate-500" />
                <div className="text-sm text-slate-500 dark:text-slate-400 text-center">
                  <span className="font-medium text-blue-600 dark:text-blue-400">Click to upload</span> or drag
                  and drop
                  <br />
                  <span className="text-xs">PNG, JPG, WebP up to 20 MB</span>
                </div>
              </div>
            ) : (
              <div className="relative rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700">
                <img
                  src={imageDataUrl}
                  alt="Dashboard screenshot"
                  className="w-full max-h-64 object-contain bg-slate-50 dark:bg-slate-800"
                />
                <button
                  onClick={() => setImageDataUrl(null)}
                  className="absolute top-2 right-2 p-1.5 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
                  aria-label="Remove image"
                  title="Remove image"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="hidden"
              aria-hidden
              title="Upload dashboard image"
            />

            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional: describe the dashboard or add context (e.g., 'This is a pull-through rate dashboard showing monthly trends by underwriter')"
              className="resize-none h-20 text-sm"
            />

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleAnalyze} disabled={!imageDataUrl || isAnalyzing}>
                {isAnalyzing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" />
                    Analyze Dashboard
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* ================================================================ */}
        {/* STEP 2: Preview / Edit Blueprint */}
        {/* ================================================================ */}
        {step === 'preview' && blueprint && (
          <div className="space-y-4">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Review the detected dashboard structure. You can edit titles, remove widgets, or remove
              entire groups before generating.
            </p>

            {/* Dashboard title */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400 shrink-0">
                Dashboard:
              </span>
              <Input
                value={blueprint.title}
                onChange={(e) => setBlueprint((prev) => prev ? { ...prev, title: e.target.value } : prev)}
                className="h-8 text-sm font-medium"
              />
            </div>

            {/* Groups */}
            {blueprint.groups.map((group, gIdx) => (
              <div
                key={gIdx}
                className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden"
              >
                {/* Group header */}
                <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-800/50">
                  <button onClick={() => toggleGroup(gIdx)} className="shrink-0">
                    {expandedGroups.has(gIdx) ? (
                      <ChevronDown className="h-4 w-4 text-slate-400" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-slate-400" />
                    )}
                  </button>
                  <Input
                    value={group.title}
                    onChange={(e) => updateGroupTitle(gIdx, e.target.value)}
                    className="h-7 text-sm font-medium flex-1 bg-transparent border-transparent hover:border-slate-300 focus:border-blue-400"
                  />
                  <span className="text-xs text-slate-400 shrink-0">
                    {group.widgets.length} widget{group.widgets.length !== 1 ? 's' : ''}
                  </span>
                  <span className="text-xs text-slate-400 shrink-0 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700">
                    {group.dateField}
                  </span>
                  <button
                    onClick={() => removeGroup(gIdx)}
                    className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-slate-400 hover:text-red-500 transition-colors"
                    title="Remove group"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Widget list */}
                {expandedGroups.has(gIdx) && (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {group.widgets.map((w, wIdx) => (
                      <div
                        key={wIdx}
                        className="flex items-start gap-2 px-3 py-2 hover:bg-slate-50/50 dark:hover:bg-slate-800/30"
                      >
                        <VizIcon type={w.vizType} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-slate-700 dark:text-slate-300 truncate">
                            {w.title}
                          </div>
                          <div className="text-xs text-slate-400 dark:text-slate-500 line-clamp-2">
                            {w.description}
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 font-medium">
                              {w.vizType}
                            </span>
                            {w.multiSeries && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 font-medium">
                                multi-series
                              </span>
                            )}
                            {w.layoutHint && (
                              <span className="text-[10px] text-slate-400">
                                {w.layoutHint.w}x{w.layoutHint.h}
                              </span>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => removeWidget(gIdx, wIdx)}
                          className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-slate-400 hover:text-red-500 transition-colors shrink-0"
                          title="Remove widget"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {blueprint.groups.length === 0 && (
              <div className="text-center py-6 text-sm text-slate-400">
                No groups remaining. Go back and re-analyze, or cancel.
              </div>
            )}

            <div className="flex justify-between gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setStep('upload');
                  setBlueprint(null);
                }}
              >
                Back
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => handleOpenChange(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleGenerate}
                  disabled={blueprint.groups.length === 0}
                >
                  <Sparkles className="h-4 w-4 mr-2" />
                  Generate {blueprint.groups.reduce((sum, g) => sum + g.widgets.length, 0)} Widget
                  {blueprint.groups.reduce((sum, g) => sum + g.widgets.length, 0) !== 1 ? 's' : ''}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ================================================================ */}
        {/* STEP 3: Generating */}
        {/* ================================================================ */}
        {step === 'generating' && (
          <div className="flex flex-col items-center gap-4 py-8">
            <Loader2 className="h-10 w-10 text-blue-500 animate-spin" />
            <div className="text-center">
              <div className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Generating widgets...
              </div>
              {generatingProgress && (
                <div className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                  Group {generatingProgress.current} of {generatingProgress.total}
                </div>
              )}
              <div className="text-xs text-slate-400 dark:text-slate-500 mt-2">
                This may take a minute as SQL queries are generated and validated for each widget.
              </div>
            </div>
            {generatingProgress && (
              <div className="w-full max-w-xs bg-slate-100 dark:bg-slate-800 rounded-full h-2 overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-500"
                  style={{
                    width: `${(generatingProgress.current / generatingProgress.total) * 100}%`,
                  }}
                />
              </div>
            )}
          </div>
        )}

        {/* ================================================================ */}
        {/* STEP 4: Done */}
        {/* ================================================================ */}
        {step === 'done' && (
          <div className="flex flex-col items-center gap-4 py-8">
            <div className="h-12 w-12 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
              <Check className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="text-center">
              <div className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Dashboard created!
              </div>
              <div className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                Your widgets have been added to the canvas.
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
