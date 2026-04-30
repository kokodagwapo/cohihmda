import { describe, expect, it } from "vitest";
import { shouldValidateInjectedFilters } from "../../routes/cohiWorkbench.js";

describe("cohiWorkbench research widget SQL validation", () => {
  it("does not require injected filter validation for run-as-saved research artifacts", () => {
    expect(
      shouldValidateInjectedFilters(
        { type: "modify_widget", instanceId: "research-widget" },
        {
          id: "research-widget",
          type: "cohi_widget",
          sourceType: "research",
          sourceArtifactId: "artifact-1",
          artifactCapabilities: { canInjectFilters: false },
        },
      ),
    ).toBe(false);
  });

  it("keeps injected filter validation when a research artifact explicitly allows filters", () => {
    expect(
      shouldValidateInjectedFilters(
        { type: "modify_widget", instanceId: "research-widget" },
        {
          id: "research-widget",
          type: "cohi_widget",
          sourceType: "research",
          sourceArtifactId: "artifact-1",
          artifactCapabilities: { canInjectFilters: true },
        },
      ),
    ).toBe(true);
  });

  it("keeps existing create_widget filter validation unless explicitly disabled", () => {
    expect(shouldValidateInjectedFilters({ type: "create_widget" })).toBe(true);
    expect(
      shouldValidateInjectedFilters({
        type: "create_widget",
        filterConfig: { filterable: false },
      }),
    ).toBe(false);
  });
});
