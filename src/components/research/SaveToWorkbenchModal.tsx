/**
 * SaveToWorkbenchModal
 *
 * Lets the user save a research table or chart as a widget on an existing
 * workbench canvas or a new one. The widget stores the SQL so it can
 * re-run for fresh data.
 */

import { useState, useEffect, useCallback } from "react";
import { Bookmark, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantStore } from "@/stores/tenantStore";
import type { VisualizationConfig } from "@/hooks/useCohiChat";
import type { PeriodPreset } from "@/components/ui/DatePeriodPicker";
import { getWidgetDefinition } from "@/components/widgets/registry";
import { createLayoutItem } from "@/components/workbench/canvas/types";

const DEFAULT_WIDGET_W = 520;
const DEFAULT_WIDGET_H = 360;

interface CanvasListItem {
  id: string;
  title: string;
  created_at?: string;
  updated_at?: string;
}

export interface SaveToWorkbenchPayload {
  /** SQL-backed research evidence (omit when saving a registry widget). */
  sql?: string;
  title: string;
  vizConfig?: VisualizationConfig;
  explanation?: string;
  sourceType?: "research";
  sourceSessionId?: string;
  /** Save a canonical registry widget instead of a SQL cohi_widget. */
  registryWidget?: {
    definitionId: string;
    period?: PeriodPreset;
    filters?: { branch?: string; channel?: string; loanOfficer?: string };
  };
}

interface SaveToWorkbenchModalProps {
  open: boolean;
  onClose: () => void;
  payload: SaveToWorkbenchPayload | null;
  onSaved?: (canvasId: string, canvasTitle: string) => void;
}

export function SaveToWorkbenchModal({
  open,
  onClose,
  payload,
  onSaved,
}: SaveToWorkbenchModalProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const selectedTenantId = useTenantStore((s) => s.selectedTenantId);
  const effectiveTenantId = selectedTenantId || user?.tenant_id;
  const [canvases, setCanvases] = useState<CanvasListItem[]>([]);
  const [loadingCanvases, setLoadingCanvases] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedCanvasId, setSelectedCanvasId] = useState<string>("");
  const [newCanvasTitle, setNewCanvasTitle] = useState("New canvas");
  const [widgetTitle, setWidgetTitle] = useState("");
  const [createNew, setCreateNew] = useState(false);

  const tenantQs = effectiveTenantId ? `?tenant_id=${encodeURIComponent(effectiveTenantId)}` : "";

  const loadCanvases = useCallback(async () => {
    setLoadingCanvases(true);
    try {
      const res = await api.request<{ canvases: CanvasListItem[] }>(
        `/api/workbench/canvases${tenantQs}`,
      );
      setCanvases(res?.canvases ?? []);
      if (res?.canvases?.length && !createNew) {
        setSelectedCanvasId(res.canvases[0].id);
      }
    } catch {
      setCanvases([]);
    } finally {
      setLoadingCanvases(false);
    }
  }, [tenantQs, createNew]);

  useEffect(() => {
    if (open) {
      loadCanvases();
      if (payload) {
        setWidgetTitle(payload.title || "Research widget");
      }
    }
  }, [open, payload, loadCanvases]);

  const handleSave = async () => {
    if (!payload) return;
    setSaving(true);
    try {
      const layoutItemId = `cohi-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      let newItem: Record<string, unknown>;

      if (payload.registryWidget?.definitionId) {
        const def = getWidgetDefinition(payload.registryWidget.definitionId);
        const w = def?.defaultSize?.w ?? DEFAULT_WIDGET_W;
        const h = def?.defaultSize?.h ?? DEFAULT_WIDGET_H;
        const rw = payload.registryWidget;
        const config: Record<string, unknown> = {};
        if (rw.period) config.period = rw.period;
        if (rw.filters?.branch) config.branch = rw.filters.branch;
        if (rw.filters?.channel) config.channel = rw.filters.channel;
        if (rw.filters?.loanOfficer) config.loanOfficer = rw.filters.loanOfficer;
        const item = createLayoutItem(
          layoutItemId,
          "registry_widget",
          {
            type: "registry_widget" as const,
            definitionId: rw.definitionId,
            config: Object.keys(config).length ? config : undefined,
          },
          { x: 20, y: 20, w, h },
        );
        newItem = item as unknown as Record<string, unknown>;
      } else {
        if (!payload.sql || !payload.vizConfig) {
          toast({ title: "Nothing to save", description: "Missing SQL or visualization config.", variant: "destructive" });
          setSaving(false);
          return;
        }
        newItem = {
          i: layoutItemId,
          x: 20,
          y: 20,
          w: DEFAULT_WIDGET_W,
          h: DEFAULT_WIDGET_H,
          type: "cohi_widget" as const,
          payload: {
            type: "cohi_widget" as const,
            sql: payload.sql,
            title: widgetTitle.trim() || payload.title,
            vizConfig: payload.vizConfig,
            explanation: payload.explanation,
            sourceType: payload.sourceType,
            sourceSessionId: payload.sourceSessionId,
          },
        };
      }

      if (createNew) {
        const data = await api.request<{ id: string }>(`/api/workbench/canvases${tenantQs}`, {
          method: "POST",
          body: JSON.stringify({
            title: newCanvasTitle.trim() || "New canvas",
            layoutVersion: "freeform-v1",
            layout: [newItem],
          }),
        });
        toast({ title: "Saved to workbench", description: `Added to new canvas "${newCanvasTitle || "New canvas"}".` });
        onSaved?.(data.id, newCanvasTitle.trim() || "New canvas");
      } else {
        if (!selectedCanvasId) {
          toast({ title: "Select a canvas", variant: "destructive" });
          setSaving(false);
          return;
        }
        const existing = await api.request<{ content: { layout?: unknown[] } }>(
          `/api/workbench/canvases/${selectedCanvasId}${tenantQs}`,
        );
        const layout = Array.isArray(existing?.content?.layout) ? existing.content.layout : [];
        const updatedContent = {
          ...existing.content,
          layout: [...layout, newItem],
        };
        await api.request(`/api/workbench/canvases/${selectedCanvasId}${tenantQs}`, {
          method: "PUT",
          body: JSON.stringify({ content: updatedContent }),
        });
        const canvasTitle = canvases.find((c) => c.id === selectedCanvasId)?.title ?? "Canvas";
        toast({ title: "Saved to workbench", description: `Added to "${canvasTitle}".` });
        onSaved?.(selectedCanvasId, canvasTitle);
      }
      onClose();
    } catch (err) {
      toast({
        title: "Failed to save",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const canSave =
    !!payload &&
    (createNew ? !!newCanvasTitle.trim() : !!selectedCanvasId) &&
    (!!payload.registryWidget?.definitionId || !!(payload.sql && payload.vizConfig));

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bookmark className="h-4 w-4" />
            Save to Workbench
          </DialogTitle>
        </DialogHeader>
        {!payload ? (
          <p className="text-sm text-muted-foreground">No content to save.</p>
        ) : (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Widget title</Label>
              <Input
                value={widgetTitle}
                onChange={(e) => setWidgetTitle(e.target.value)}
                placeholder="e.g. Conversion by channel"
              />
              {payload.registryWidget && (
                <p className="text-xs text-muted-foreground">
                  Saves the canonical dashboard widget (live registry). Filters and period from Research Lab are preserved when supported.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Canvas</Label>
              {loadingCanvases ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading canvases…
                </div>
              ) : (
                <>
                  <Select
                    value={createNew ? "__new__" : selectedCanvasId}
                    onValueChange={(v) => {
                      setCreateNew(v === "__new__");
                      if (v !== "__new__") setSelectedCanvasId(v);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select canvas" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__new__">Create new canvas</SelectItem>
                      {canvases.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.title || "Untitled"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {createNew && (
                    <Input
                      className="mt-2"
                      value={newCanvasTitle}
                      onChange={(e) => setNewCanvasTitle(e.target.value)}
                      placeholder="New canvas title"
                    />
                  )}
                </>
              )}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave || saving}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving…
              </>
            ) : (
              "Save"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
