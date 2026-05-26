import { api } from "@/lib/api";
import type {
  CanvasAnnotation,
  CanvasBackground,
  CanvasLayoutItem,
  CanvasUpload,
} from "@/components/workbench/canvas/types";

export type CreateWorkbenchCanvasPayload = {
  title: string;
  layout: CanvasLayoutItem[];
  annotations: CanvasAnnotation[];
  background: CanvasBackground;
  uploads: CanvasUpload[];
  tenantId?: string;
};

export async function createWorkbenchCanvas(
  payload: CreateWorkbenchCanvasPayload,
): Promise<{ id: string }> {
  const tenantQs = payload.tenantId
    ? `?tenant_id=${encodeURIComponent(payload.tenantId)}`
    : "";
  return api.request<{ id: string }>(`/api/workbench/canvases${tenantQs}`, {
    method: "POST",
    body: JSON.stringify({
      title: payload.title,
      layoutVersion: "freeform-v1",
      layout: payload.layout,
      annotations: payload.annotations,
      background: payload.background,
      uploadsMeta: payload.uploads,
    }),
  });
}

export async function rebindWorkbenchDraftConversationScope(args: {
  draftScopeId: string;
  canvasId: string;
  tenantId?: string;
}): Promise<void> {
  const tenantQs = args.tenantId
    ? `?tenant_id=${encodeURIComponent(args.tenantId)}`
    : "";
  try {
    await api.request(
      `/api/cohi-chat/workbench/conversations/rebind-scope${tenantQs}`,
      {
        method: "POST",
        body: JSON.stringify({
          fromScopeId: `draft:${args.draftScopeId}`,
          toScopeId: `canvas:${args.canvasId}`,
        }),
      },
    );
  } catch (err) {
    console.warn(
      "[WorkbenchCanvas] Could not rebind draft conversation scope:",
      err,
    );
  }
}
