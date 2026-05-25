import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { createRef } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { renderWithProviders } from "@/test/render";
import { DASHBOARD_SECTION_GROUPS } from "@/components/workbench/workbenchSections";
import {
  WorkbenchTopToolbar,
  type WorkbenchTopToolbarProps,
} from "@/components/workbench/canvas/WorkbenchTopToolbar";

function buildProps(
  overrides: Partial<WorkbenchTopToolbarProps> = {},
): WorkbenchTopToolbarProps {
  return {
    showReportBuilder: false,
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: true,
    canRedo: true,
    isOwner: true,
    saveTitle: "Test canvas",
    setSaveTitle: vi.fn(),
    canvasId: "canvas-1",
    handleSaveConfirm: vi.fn(),
    handleSaveClick: vi.fn(),
    isSaving: false,
    canvasLoading: false,
    saveIndicator: null,
    handleShareClick: vi.fn(),
    navigate: vi.fn(),
    canEdit: true,
    backgroundImageInputRef: createRef(),
    handleBackgroundImageChange: vi.fn(),
    canvasBackground: { type: "color", value: "#ffffff" },
    setCanvasBackground: vi.fn(),
    fileInputRef: createRef(),
    handleFileChange: vi.fn(),
    logoInputRef: createRef(),
    handleLogoChange: vi.fn(),
    activeAddGroup: DASHBOARD_SECTION_GROUPS[0]?.label ?? "Insights",
    setActiveAddGroup: vi.fn(),
    addDashboardSection: vi.fn(),
    addTextBlock: vi.fn(),
    applyTemplate: vi.fn(),
    selectedWidgetId: null,
    duplicateWidget: vi.fn(),
    removeWidget: vi.fn(),
    addRichTextBlock: vi.fn(),
    setClearConfirmOpen: vi.fn(),
    hasItems: false,
    embeddedCohiHidden: true,
    showCohiPanel: false,
    setShowCohiPanel: vi.fn(),
    setShowReportBuilder: vi.fn(),
    ...overrides,
  };
}

function renderToolbar(overrides: Partial<WorkbenchTopToolbarProps> = {}) {
  return renderWithProviders(
    <TooltipProvider>
      <WorkbenchTopToolbar {...buildProps(overrides)} />
    </TooltipProvider>,
  );
}

describe("WorkbenchTopToolbar", () => {
  it("shows title input and save when isOwner is true", () => {
    renderToolbar({ isOwner: true });

    expect(
      screen.getByTestId("workbench-canvas-title-input"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("workbench-save-button")).toBeInTheDocument();
  });

  it("hides save when isOwner is false", () => {
    renderToolbar({ isOwner: false, canEdit: false });

    expect(
      screen.getByTestId("workbench-canvas-title-input"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("workbench-save-button")).not.toBeInTheDocument();
  });
});
