/**
 * SaveToWorkbenchModal
 *
 * Lets the user save a research table or chart as a widget on an existing
 * workbench canvas or a new one. The widget stores the SQL so it can
 * re-run for fresh data.
 */

import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
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
import type { ResearchArtifactCapabilities } from "@/components/workbench/canvas/types";
import { inferResearchArtifactKeyFields } from "@/lib/inferResearchArtifactKeyFields";

const DEFAULT_WIDGET_W = 520;

const DEFAULT_RESEARCH_ARTIFACT_CAPS: ResearchArtifactCapabilities = {
  canInjectFilters: false,
  canEditPresentation: true,
  canEditColumns: true,
  requiresSqlRewriteForLogicChanges: true,
};
const DEFAULT_WIDGET_H = 360;

interface CanvasListItem {
  id: string;
  title: string;
  created_at?: string;
  updated_at?: string;
}

export interface SaveToWorkbenchPayload {
  sql: string;
  title: string;
  vizConfig: VisualizationConfig;
  explanation?: string;
  sourceType?: "research";
  sourceSessionId?: string;
  /** Column keys for research_artifacts.key_fields (optional — inferred from vizConfig) */
  keyFields?: string[];
  /** When set, skip POST /api/research/artifacts and reference this row */
  sourceArtifactId?: string;
  artifactCapabilities?: ResearchArtifactCapabilities;
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
  const navigate = useNavigate();
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
      let sourceArtifactId = payload.sourceArtifactId;
      const caps = payload.artifactCapabilities ?? DEFAULT_RESEARCH_ARTIFACT_CAPS;
      if (
        payload.sourceType === "research" &&
        payload.sql?.trim() &&
        payload.sourceSessionId &&
        !sourceArtifactId
      ) {
        try {
          const keyFields = inferResearchArtifactKeyFields(payload.vizConfig, payload.keyFields);
          const created = await api.createResearchArtifact(
            {
              session_id: payload.sourceSessionId,
              sql: payload.sql,
              keyFields,
              title: widgetTitle.trim() || payload.title,
              explanation: payload.explanation,
              viz_config: payload.vizConfig as Record<string, unknown>,
            },
            effectiveTenantId,
          );
          sourceArtifactId = created?.id;
        } catch (e) {
          console.warn("[SaveToWorkbench] research artifact create failed", e);
          toast({
            title: "Could not link research artifact",
            description:
              "The widget was saved, but without a durable research artifact link. Tracking/Cohi context may be limited.",
            variant: "destructive",
          });
        }
      }

      const layoutItemId = `cohi-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const newItem = {
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
          ...(sourceArtifactId
            ? { sourceArtifactId, artifactCapabilities: caps }
            : {}),
        },
      };

      let savedCanvasId = "";
      let savedCanvasTitle = "";
      if (createNew) {
        const data = await api.request<{ id: string }>(`/api/workbench/canvases${tenantQs}`, {
          method: "POST",
          body: JSON.stringify({
            title: newCanvasTitle.trim() || "New canvas",
            layoutVersion: "freeform-v1",
            layout: [newItem],
          }),
        });
        savedCanvasId = data.id;
        savedCanvasTitle = newCanvasTitle.trim() || "New canvas";
        toast({ title: "Saved to workbench", description: `Opening "${savedCanvasTitle}".` });
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
        savedCanvasId = selectedCanvasId;
        savedCanvasTitle = canvases.find((c) => c.id === selectedCanvasId)?.title ?? "Canvas";
        toast({ title: "Saved to workbench", description: `Opening "${savedCanvasTitle}".` });
      }
      if (savedCanvasId) {
        onSaved?.(savedCanvasId, savedCanvasTitle || "Canvas");
        navigate(`/my-dashboard/${savedCanvasId}`);
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

  const canSave = payload && (createNew ? newCanvasTitle.trim() : selectedCanvasId);

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
