import { describe, it, expect } from "vitest";
import { inferResearchArtifactKeyFields } from "./inferResearchArtifactKeyFields";

describe("inferResearchArtifactKeyFields", () => {
  it("prefers explicit keyFields when provided", () => {
    expect(
      inferResearchArtifactKeyFields(
        { type: "bar", title: "t", data: [], xKey: "a", yKey: "b" },
        ["z"],
      ),
    ).toEqual(["z"]);
  });

  it("collects keys from vizConfig", () => {
    expect(
      inferResearchArtifactKeyFields({
        type: "table",
        title: "t",
        data: [],
        tableConfig: {
          columns: [
            { key: "month", label: "Month" },
            { key: "amt", label: "Amt" },
          ],
        },
      }),
    ).toEqual(expect.arrayContaining(["month", "amt"]));
  });
});
