import { describe, it, expect } from "vitest";
import { buildUnderstoryBullets, understoryToBullets } from "./understoryBullets.js";

describe("understoryToBullets", () => {
  it("preserves decimals and abbreviations while splitting", () => {
    const text =
      "MTD pull-through is 56.7%. This is down vs. LM by 4.2 points. U.S. branch mix remained stable.";
    const bullets = understoryToBullets(text);
    expect(bullets).toEqual([
      "MTD pull-through is 56.7%",
      "This is down vs. LM by 4.2 points",
      "U.S. branch mix remained stable",
    ]);
  });

  it("does not enforce a max bullet cap", () => {
    const text = "A. B. C. D. E.";
    const bullets = understoryToBullets(text);
    expect(bullets.length).toBe(5);
  });

  it("does not truncate long bullets", () => {
    const text = `A very long sentence ${"x".repeat(350)}.`;
    const bullets = understoryToBullets(text);
    expect(bullets.length).toBe(1);
    expect(bullets[0].length).toBeGreaterThan(340);
  });
});

describe("buildUnderstoryBullets", () => {
  it("returns deterministic formatter output when fallback is disabled", async () => {
    const text =
      "792 active loans have past estimated close dates. 249 loans close in 0-30 days and 246 are missing milestones.";
    const bullets = await buildUnderstoryBullets(text, { headline: "Pipeline close-date hygiene weak" });
    expect(bullets).toEqual([
      "792 active loans have past estimated close dates",
      "249 loans close in 0-30 days and 246 are missing milestones",
    ]);
  });
});

