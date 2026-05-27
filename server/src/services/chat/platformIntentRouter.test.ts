import { describe, expect, it } from "vitest";
import { detectRankingIntent } from "./rankingQueryGuard.js";
import {
  detectPlatformIntent,
  platformIntentNavigationHints,
} from "./platformIntentRouter.js";

describe("platformIntentRouter", () => {
  it("detects sales scorecard tier intent and suppresses ranking", () => {
    const intent = detectPlatformIntent("who are my top tier LOs?");
    expect(intent?.kind).toBe("sales_scorecard_tier");
    expect(intent?.suppressRankingGuard).toBe(true);
    expect(intent?.navigationTargetId).toBe("sales-scorecard");
  });

  it("does not treat top tier as generic ranking (via ranking guard exclusion)", () => {
    expect(detectRankingIntent("who are my top tier LOs?")).toBeNull();
  });

  it("returns ambiguous intent when top N and tier both appear", () => {
    const intent = detectPlatformIntent("top 10 top tier LOs");
    expect(intent?.kind).toBe("ambiguous_tier_vs_ranking");
    expect(intent?.clarificationQuestion).toBeTruthy();
  });

  it("maps pipeline health to pipeline analysis nav", () => {
    const intent = detectPlatformIntent(
      "overall pipeline health and conversion performance",
    );
    expect(intent?.kind).toBe("pipeline_health");
    const hints = platformIntentNavigationHints(intent);
    expect(hints.some((h) => h.path === "/pipeline-analysis")).toBe(true);
  });

  it("uses page route as low-confidence default", () => {
    const intent = detectPlatformIntent("how is volume?", "/sales-scorecard");
    expect(intent?.kind).toBe("sales_scorecard_tier");
  });
});
