import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkbenchCanvasSurface } from "./WorkbenchCanvasSurface";

describe("WorkbenchCanvasSurface", () => {
  it("renders children inside the canvas layer", () => {
    render(
      <WorkbenchCanvasSurface canvasContentWidth={800} canvasContentHeight={600}>
        <span data-testid="child">layer</span>
      </WorkbenchCanvasSurface>,
    );
    expect(screen.getByTestId("child").textContent).toBe("layer");
  });
});
