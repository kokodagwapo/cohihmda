import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkbenchCanvasItemsLayer } from "./WorkbenchCanvasItemsLayer";
import type { CanvasLayoutItem } from "./types";

vi.mock("react-rnd", () => ({
  Rnd: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="rnd-mock">{children}</div>
  ),
}));

vi.mock("@/components/workbench/canvas/WidgetRenderer", () => ({
  WidgetRenderer: ({ item }: { item: CanvasLayoutItem }) => (
    <span data-testid="widget-renderer">{item.type}</span>
  ),
}));

vi.mock("@/components/workbench/canvas/CanvasWidgetCard", () => ({
  CanvasWidgetCard: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="widget-card">{children}</div>
  ),
}));

const noop = () => {};
const noopRect = () => {};
const setItems = vi.fn();

const baseProps = {
  canEdit: true,
  selectedWidgetId: null,
  editingWidgetId: null,
  setSelectedWidgetId: noop,
  setEditingWidgetId: noop,
  updateItemRect: noopRect,
  updateWidgetPayload: noop,
  setItemsWithHistory: setItems,
  duplicateWidget: noop,
  removeWidget: noop,
  bringToFront: noop,
  sendToBack: noop,
  handleExportWidgetExcel: noop,
  handleExportWidgetPdf: noop,
  defaultGroupWidth: 800,
  embeddedCohiHidden: false,
  setShowCohiPanel: noop,
  cohiSendMessage: noop,
  canvasId: null,
  draftScopeId: "draft-test",
};

describe("WorkbenchCanvasItemsLayer", () => {
  it("renders nothing when items list is empty", () => {
    const { container } = render(
      <WorkbenchCanvasItemsLayer
        {...baseProps}
        items={[]}
        itemsForRender={[]}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders one cohi_widget item", () => {
    const item: CanvasLayoutItem = {
      i: "w1",
      x: 0,
      y: 0,
      w: 400,
      h: 300,
      type: "cohi_widget",
      payload: {
        type: "cohi_widget",
        sql: "SELECT 1",
        title: "Test KPI",
        vizConfig: { chartType: "kpi" },
      },
    };
    render(
      <WorkbenchCanvasItemsLayer
        {...baseProps}
        items={[item]}
        itemsForRender={[item]}
      />,
    );
    expect(screen.getByTestId("rnd-mock")).toBeTruthy();
    expect(screen.getByTestId("widget-renderer").textContent).toBe(
      "cohi_widget",
    );
  });
});
