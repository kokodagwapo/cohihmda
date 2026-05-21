import { describe, it, expect } from "vitest";
import { parseWorkbenchLlmJson } from "./parseWorkbenchLlmJson.js";

describe("parseWorkbenchLlmJson", () => {
  it("parses first object when response contains two concatenated JSON blobs", () => {
    const one = {
      message: "Done.",
      actions: [{ type: "create_widget" }],
    };
    const raw = JSON.stringify(one) + JSON.stringify(one);
    const p = parseWorkbenchLlmJson(raw);
    expect(p?.message).toBe("Done.");
    expect(p?.actions).toHaveLength(1);
  });
});
