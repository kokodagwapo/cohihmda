import { describe, expect, it } from "vitest";
import { expandMetricAbbreviations } from "./metricLexicon.js";

describe("metricLexicon", () => {
  it("expands pp to percentage points", () => {
    expect(expandMetricAbbreviations("up 3.2pp vs baseline")).toBe(
      "up 3.2 percentage points vs baseline",
    );
  });

  it("expands PT and Vol", () => {
    expect(expandMetricAbbreviations("PT 54% and Vol $2M")).toBe(
      "pull-through rate 54% and funded volume $2M",
    );
  });
});
