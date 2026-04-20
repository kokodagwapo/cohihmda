import { describe, it, expect } from "vitest";
import { buildSeededCanvasUrl } from "../../../scripts/qa/ai/planRoutes.js";

describe("buildSeededCanvasUrl", () => {
  it("returns an /my-dashboard/<id> path (NOT /workbench/<id>)", () => {
    // Regression guard: the individual canvas editor lives at
    // `/my-dashboard/:canvasId` in `src/App.tsx`. Using `/workbench/<id>`
    // falls through React Router and the canvas toolbar never mounts, so
    // every canvas-scoped Playwright assertion silently fails.
    const url = buildSeededCanvasUrl("9f59a11d-08fa-48cb-bc20-0a9cb0153f02");
    expect(url).toBe("/my-dashboard/9f59a11d-08fa-48cb-bc20-0a9cb0153f02");
    expect(url.startsWith("/workbench/")).toBe(false);
  });

  it("trims whitespace from the canvas id", () => {
    expect(buildSeededCanvasUrl("  abc-123  ")).toBe("/my-dashboard/abc-123");
  });

  it("throws on an empty or whitespace-only canvas id", () => {
    expect(() => buildSeededCanvasUrl("")).toThrow(/canvasId is required/);
    expect(() => buildSeededCanvasUrl("   ")).toThrow(/canvasId is required/);
  });
});
