import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { WorkbenchEmptyState } from "./WorkbenchEmptyState";

describe("WorkbenchEmptyState", () => {
  it('shows "Your canvas is empty" when embedded Cohi is hidden', () => {
    renderWithProviders(
      <WorkbenchEmptyState
        embeddedCohiHidden
        onOpenCohi={vi.fn()}
        onQuickPrompt={vi.fn()}
        onAddDashboardSection={vi.fn()}
      />,
    );
    expect(screen.getByText("Your canvas is empty")).toBeTruthy();
  });
});
