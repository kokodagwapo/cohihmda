/**
 * Rnd-wrapped canvas items: widget cards, groups, dashboard sections.
 */
import React from "react";
import { Rnd } from "react-rnd";
import { useToast } from "@/hooks/use-toast";
import { WidgetRenderer } from "@/components/workbench/canvas/WidgetRenderer";
import { CanvasWidgetCard } from "@/components/workbench/canvas/CanvasWidgetCard";
import {
  createLayoutItem,
  type CanvasLayoutItem,
  type CanvasWidgetPayload,
} from "@/components/workbench/canvas/types";
import { getWidgetDefinition } from "@/components/widgets/registry";
import {
  COHI_WORKBENCH_EDIT_WIDGET_EVENT,
  draftScopeIdForCanvasTab,
} from "@/lib/workbench/workbenchChatHandoff";

function resolveCanvasItemWidgetTitle(item: CanvasLayoutItem): string {
  const payload = item.payload as CanvasWidgetPayload;
  if (payload.type === "cohi_widget") return payload.title ?? "";
  if (payload.type === "widget_group") return payload.title ?? "";
  if (payload.type === "registry_widget") {
    const def = getWidgetDefinition(payload.definitionId);
    return def?.name ?? payload.definitionId;
  }
  if (payload.type === "dashboard_section") {
    return (payload as { title?: string; sectionId?: string }).title ?? "";
  }
  return "";
}

function resolveCanvasItemChartType(item: CanvasLayoutItem): string {
  const payload = item.payload;
  if (payload.type === "cohi_widget") {
    return payload.vizConfig?.type ?? "";
  }
  return "";
}

function resolveCanvasItemFilterable(item: CanvasLayoutItem): string {
  const payload = item.payload;
  if (payload.type === "cohi_widget") {
    const filterable = payload.filterConfig?.filterable;
    return filterable === false ? "false" : "true";
  }
  return "";
}

const DASHBOARD_HIDEABLE_SECTIONS: Record<
  string,
  { id: string; label: string }[]
> = {
  topTiering: [
    { id: "dailyStory", label: "Executive summary / Daily Story" },
    { id: "chart", label: "Funnel / Detail chart" },
  ],
  loanFunnel: [
    { id: "dailyStory", label: "Executive summary / Daily Story" },
    { id: "chart", label: "Funnel / Detail chart" },
  ],
};

export type WorkbenchCanvasItemsLayerProps = {
  items: CanvasLayoutItem[];
  itemsForRender: CanvasLayoutItem[];
  canEdit: boolean;
  selectedWidgetId: string | null;
  editingWidgetId: string | null;
  setSelectedWidgetId: (id: string | null) => void;
  setEditingWidgetId: (id: string | null) => void;
  updateItemRect: (
    id: string,
    next: Partial<Pick<CanvasLayoutItem, "x" | "y" | "w" | "h">>,
    withHistory?: boolean,
  ) => void;
  updateWidgetPayload: (
    id: string,
    payload: CanvasLayoutItem["payload"],
    options?: { recordHistory?: boolean },
  ) => void;
  setItemsWithHistory: React.Dispatch<
    React.SetStateAction<CanvasLayoutItem[]>
  >;
  duplicateWidget: (id: string) => void;
  removeWidget: (id: string) => void;
  bringToFront: (id: string) => void;
  sendToBack: (id: string) => void;
  handleExportWidgetExcel: (id: string) => void;
  defaultGroupWidth: number;
  embeddedCohiHidden: boolean;
  setShowCohiPanel: (open: boolean) => void;
  cohiSendMessage: (message: string) => void;
  canvasId: string | null;
  loadCanvasId?: string | null;
  draftScopeId: string;
};

export function WorkbenchCanvasItemsLayer({
  items,
  itemsForRender,
  canEdit,
  selectedWidgetId,
  editingWidgetId,
  setSelectedWidgetId,
  setEditingWidgetId,
  updateItemRect,
  updateWidgetPayload,
  setItemsWithHistory,
  duplicateWidget,
  removeWidget,
  bringToFront,
  sendToBack,
  handleExportWidgetExcel,
  defaultGroupWidth,
  embeddedCohiHidden,
  setShowCohiPanel,
  cohiSendMessage,
  canvasId,
  loadCanvasId,
  draftScopeId,
}: WorkbenchCanvasItemsLayerProps) {
  const { toast } = useToast();

  if (itemsForRender.length === 0) {
    return null;
  }

  return (
    <>
      {itemsForRender.map((displayItem, index) => {
        const item = items[index]!;
        const isDashboardSection =
          item.type === "dashboard_section" &&
          item.payload.type === "dashboard_section";
        const payload = item.payload;
        const isLegacyLoanDetail =
          isDashboardSection &&
          (payload as { sectionId?: string }).sectionId === "loanDetail";
        const hideableSections = isDashboardSection
          ? (DASHBOARD_HIDEABLE_SECTIONS[
              (payload as { sectionId: string }).sectionId
            ] ?? [])
          : [];
        const hiddenSections = isDashboardSection
          ? ((payload as { hiddenSections?: string[] }).hiddenSections ?? [])
          : [];
        const displayMode = isDashboardSection
          ? ((payload as { displayMode?: "full" | "compact" | "hidden" })
              .displayMode ?? "full")
          : undefined;
        const onToggleSection = isDashboardSection
          ? (sectionId: string, hidden: boolean) => {
              const prev =
                (payload as { hiddenSections?: string[] }).hiddenSections ?? [];
              const next = hidden
                ? [...prev, sectionId]
                : prev.filter((s) => s !== sectionId);
              updateWidgetPayload(item.i, {
                ...payload,
                hiddenSections: next,
              });
            }
          : undefined;

        const isStandaloneCohiWidget =
          item.type === "cohi_widget" && payload.type === "cohi_widget";
        const availableGroups = isStandaloneCohiWidget
          ? items
              .filter(
                (it) =>
                  it.type === "widget_group" &&
                  it.payload.type === "widget_group" &&
                  it.i !== item.i,
              )
              .map((it) => ({
                id: it.i,
                title: (it.payload as { title?: string }).title || "Untitled Group",
              }))
          : [];

        const handleMoveToGroup = isStandaloneCohiWidget
          ? (groupId: string) => {
              const groupItem = items.find((it) => it.i === groupId);
              if (!groupItem || groupItem.payload.type !== "widget_group") return;
              const gp = groupItem.payload;
              const currentItems =
                gp.items ||
                gp.widgetIds.map((id: string) => ({
                  kind: "registry" as const,
                  defId: id,
                }));
              const cohiPayload = payload as {
                sql: string;
                title: string;
                vizConfig: unknown;
                explanation?: string;
              };
              const newItem = {
                kind: "cohi" as const,
                id: `moved-${Date.now()}`,
                sql: cohiPayload.sql,
                title: cohiPayload.title,
                vizConfig: cohiPayload.vizConfig,
                explanation: cohiPayload.explanation,
              };
              const updatedGP = {
                ...gp,
                items: [...currentItems, newItem],
                widgetIds: [...currentItems, newItem]
                  .filter((i: { kind?: string }) => i.kind === "registry")
                  .map((i: { defId: string }) => i.defId),
              };
              const sourceId = item.i;
              const targetId = groupId;
              setItemsWithHistory((prev) =>
                prev
                  .filter((it) => it.i !== sourceId)
                  .map((it) =>
                    it.i === targetId ? { ...it, payload: updatedGP } : it,
                  ),
              );
              toast({
                title: "Moved to group",
                description: (gp as { title?: string }).title,
              });
            }
          : undefined;

        const handleWrapInGroup = isStandaloneCohiWidget
          ? () => {
              const cohiPayload = payload as {
                sql: string;
                title: string;
                vizConfig: unknown;
                explanation?: string;
              };
              const groupId = `wrap-group-${Date.now()}`;
              const newGroupItem = createLayoutItem(
                groupId,
                "widget_group",
                {
                  type: "widget_group",
                  groupId,
                  title: cohiPayload.title || "New Group",
                  sectionType: "company-scorecard",
                  widgetIds: [],
                  items: [
                    {
                      kind: "cohi" as const,
                      id: `wrapped-${Date.now()}`,
                      sql: cohiPayload.sql,
                      title: cohiPayload.title,
                      vizConfig: cohiPayload.vizConfig,
                      explanation: cohiPayload.explanation,
                    },
                  ],
                  filterSync: false,
                },
                { x: 0, y: item.y, w: defaultGroupWidth, h: 500 },
              );
              const replaceId = item.i;
              setItemsWithHistory((prev) =>
                prev.map((it) => (it.i === replaceId ? newGroupItem : it)),
              );
              toast({ title: "Wrapped in new group" });
            }
          : undefined;

        const widgetTitle = resolveCanvasItemWidgetTitle(item);
        const chartType = resolveCanvasItemChartType(item);

        return (
          <Rnd
            key={item.i}
            data-testid={`canvas-item-${item.i}`}
            data-item-id={item.i}
            data-widget-type={item.type}
            data-widget-title={widgetTitle}
            data-chart-type={chartType || undefined}
            data-filterable={resolveCanvasItemFilterable(item) || undefined}
            size={{ width: item.w, height: item.h }}
            position={{ x: item.x, y: item.y }}
            onDragStart={() => setSelectedWidgetId(item.i)}
            onResizeStart={() => setSelectedWidgetId(item.i)}
            onDrag={(_, data) =>
              updateItemRect(item.i, { x: data.x, y: data.y })
            }
            onDragStop={(_, data) =>
              updateItemRect(item.i, { x: data.x, y: data.y }, true)
            }
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
                true,
              )
            }
            disableDragging={!canEdit}
            enableResizing={canEdit}
            dragHandleClassName={
              item.type === "rich_text" ? "canvas-drag-handle" : undefined
            }
            cancel="button, a, input, textarea, select, option, [contenteditable], .canvas-interactive"
            className="canvas-item"
            style={{ zIndex: index + 1 }}
          >
            <CanvasWidgetCard
              widgetId={item.i}
              selected={selectedWidgetId === item.i}
              editing={editingWidgetId === item.i}
              onSelect={() => setSelectedWidgetId(item.i)}
              onDuplicate={canEdit ? () => duplicateWidget(item.i) : undefined}
              onDelete={canEdit ? () => removeWidget(item.i) : undefined}
              className="overflow-hidden"
              hideableSections={canEdit ? hideableSections : []}
              hiddenSections={hiddenSections}
              onToggleSection={canEdit ? onToggleSection : undefined}
              onBringToFront={canEdit ? () => bringToFront(item.i) : undefined}
              onSendToBack={canEdit ? () => sendToBack(item.i) : undefined}
              displayMode={displayMode}
              onChangeDisplayMode={
                canEdit && isDashboardSection
                  ? (mode) =>
                      updateWidgetPayload(item.i, {
                        ...payload,
                        displayMode: mode,
                      })
                  : undefined
              }
              availableGroups={canEdit ? availableGroups : []}
              onMoveToGroup={canEdit ? handleMoveToGroup : undefined}
              onWrapInGroup={canEdit ? handleWrapInGroup : undefined}
              onExportExcel={() => handleExportWidgetExcel(item.i)}
              onEditWithCohi={
                embeddedCohiHidden
                  ? () => {
                      setEditingWidgetId(item.i);
                      setSelectedWidgetId(item.i);
                      const widgetTitle =
                        (payload as { title?: string; sectionId?: string })
                          .title ||
                        (payload as { sectionId?: string }).sectionId ||
                        item.type;
                      const widgetType = item.type;
                      const targetId =
                        item.type === "widget_group" &&
                        payload.type === "widget_group"
                          ? payload.groupId
                          : item.i;
                      const message = `Help me edit the "${widgetTitle}" widget (type: ${widgetType}, groupId: ${targetId}, layoutId: ${item.i}). What changes can I make?`;
                      const resolvedCanvasId = canvasId ?? loadCanvasId;
                      const resolvedDraftScope = resolvedCanvasId
                        ? draftScopeIdForCanvasTab(resolvedCanvasId)
                        : draftScopeId;
                      window.dispatchEvent(
                        new CustomEvent(COHI_WORKBENCH_EDIT_WIDGET_EVENT, {
                          detail: {
                            message,
                            widgetId: targetId,
                            widgetTitle: String(widgetTitle),
                            widgetType,
                            draftScopeId: resolvedDraftScope,
                            canvasId: resolvedCanvasId,
                          },
                        }),
                      );
                    }
                  : () => {
                      setEditingWidgetId(item.i);
                      setSelectedWidgetId(item.i);
                      setShowCohiPanel(true);
                      const widgetTitle =
                        (payload as { title?: string; sectionId?: string })
                          .title ||
                        (payload as { sectionId?: string }).sectionId ||
                        item.type;
                      const widgetType = item.type;
                      const contextMsg = `Help me edit the "${widgetTitle}" widget (type: ${widgetType}, ID: ${item.i}). What changes can I make?`;
                      cohiSendMessage(contextMsg);
                    }
              }
            >
              <WidgetRenderer
                item={displayItem}
                height={item.h}
                width={item.w}
                canEdit={canEdit}
                onUpdatePayload={
                  canEdit &&
                  (item.type === "text_block" ||
                    item.type === "rich_text" ||
                    item.type === "widget_group" ||
                    (item.type === "cohi_widget" &&
                      payload.type === "cohi_widget"))
                    ? (p) =>
                        updateWidgetPayload(
                          item.i,
                          p,
                          item.type === "cohi_widget"
                            ? { recordHistory: true }
                            : undefined,
                        )
                    : canEdit && isLegacyLoanDetail
                      ? (p) =>
                          setItemsWithHistory((prev) =>
                            prev.map((i) =>
                              i.i === item.i
                                ? {
                                    ...i,
                                    type: "widget_group" as const,
                                    payload: p,
                                  }
                                : i,
                            ),
                          )
                      : undefined
                }
                otherGroups={
                  item.type === "widget_group" || isLegacyLoanDetail
                    ? items
                        .filter(
                          (it) =>
                            it.type === "widget_group" &&
                            it.payload.type === "widget_group" &&
                            it.i !== item.i,
                        )
                        .map((it) => ({
                          id: it.i,
                          title:
                            (it.payload as { title?: string }).title ||
                            "Untitled Group",
                        }))
                    : undefined
                }
                onMoveItemOut={
                  item.type === "widget_group" || isLegacyLoanDetail
                    ? (movedItem, targetGroupId) => {
                        setItemsWithHistory((prev) =>
                          prev.map((it) => {
                            if (
                              it.i !== targetGroupId ||
                              it.payload.type !== "widget_group"
                            )
                              return it;
                            const gp = it.payload;
                            const currentItems =
                              gp.items ||
                              gp.widgetIds.map((id: string) => ({
                                kind: "registry" as const,
                                defId: id,
                              }));
                            const updatedItems = [...currentItems, movedItem];
                            return {
                              ...it,
                              payload: {
                                ...gp,
                                items: updatedItems,
                                widgetIds: updatedItems
                                  .filter(
                                    (i: { kind?: string }) =>
                                      i.kind === "registry",
                                  )
                                  .map((i: { defId: string }) => i.defId),
                              },
                            };
                          }),
                        );
                        toast({
                          title: "Moved to group",
                          description: "Widget moved successfully",
                        });
                      }
                    : undefined
                }
              />
            </CanvasWidgetCard>
          </Rnd>
        );
      })}
    </>
  );
}
