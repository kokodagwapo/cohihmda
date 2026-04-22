import { describe, expect, it } from "vitest";
import { buildSummaryBulletPresentation } from "@/lib/understoryBullets";

describe("buildSummaryBulletPresentation", () => {
  it("supports already-bulleted input", () => {
    const text = "- First point\n- Second point";
    const out = buildSummaryBulletPresentation(text);
    expect(out.renderMode).toBe("list");
    expect(out.bullets).toEqual(["First point", "Second point"]);
  });

  it("splits long paragraph input into bullets", () => {
    const text =
      "MTD pull-through is 56.7%. This is down vs. LM by 4.2 points. U.S. branch mix remained stable.";
    const out = buildSummaryBulletPresentation(text);
    expect(out.renderMode).toBe("list");
    expect(out.bullets).toEqual([
      "MTD pull-through is 56.7%",
      "This is down vs. LM by 4.2 points",
      "U.S. branch mix remained stable",
    ]);
  });

  it("keeps single short sentence as paragraph", () => {
    const text = "Pull-through improved this week.";
    const out = buildSummaryBulletPresentation(text);
    expect(out.renderMode).toBe("paragraph");
    expect(out.bullets).toEqual([text]);
  });

  it("preserves numeric facts exactly", () => {
    const text =
      "In the true active pipeline snapshot, 475 of 1,086 active loans are older than 180 days (43.74%), representing $108.7M of $250.5M active volume.";
    const out = buildSummaryBulletPresentation(text);
    const combined = out.bullets.join(" ");
    expect(combined).toContain("475");
    expect(combined).toContain("1,086");
    expect(combined).toContain("180");
    expect(combined).toContain("43.74%");
    expect(combined).toContain("$108.7");
    expect(combined).toContain("$250.5");
  });
});
