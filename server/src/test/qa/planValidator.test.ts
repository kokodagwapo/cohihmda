import { describe, expect, it } from "vitest";
import { validatePlan } from "../../../scripts/qa/ai/planValidator.js";
import type { TestPlan } from "../../../scripts/qa/ai/types.js";

const BASE_PLAN: TestPlan = {
  planVersion: 1,
  issueKey: "COHI-77",
  modelName: "gpt-5.4",
  modelTemperature: 0,
  generatedAt: "2026-04-14T00:00:00.000Z",
  steps: [
    {
      id: "ac1-goto",
      kind: "goto",
      url: "/workbench/agents",
      expect: { text: "Agents" },
    },
  ],
};

describe("planValidator", () => {
  it("accepts a simple read-only plan", () => {
    const result = validatePlan(BASE_PLAN);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects steps outside the configured URL allowlist", () => {
    const result = validatePlan({
      ...BASE_PLAN,
      steps: [
        {
          id: "ac1-goto",
          kind: "goto",
          url: "https://evil.example.com/admin",
          expect: { text: "Agents" },
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/allowlist/i);
  });
});
