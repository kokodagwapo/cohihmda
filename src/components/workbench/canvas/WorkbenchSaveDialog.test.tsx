import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { WorkbenchSaveDialog } from "./WorkbenchSaveDialog";

describe("WorkbenchSaveDialog", () => {
  it("renders save title field when open", () => {
    renderWithProviders(
      <WorkbenchSaveDialog
        open
        onOpenChange={vi.fn()}
        saveTitle="Q1 Board"
        setSaveTitle={vi.fn()}
        onConfirm={vi.fn()}
        isSaving={false}
      />,
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByDisplayValue("Q1 Board")).toBeTruthy();
  });
});
