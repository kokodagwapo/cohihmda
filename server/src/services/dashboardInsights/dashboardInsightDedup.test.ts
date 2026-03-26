import { describe, it, expect } from "vitest";
import {
  filterContextsAreDuplicate,
  headlineJaccard,
  deduplicateByFilterContextAndHeadline,
  insightsMatchByFilterThenHeadline,
  HEADLINE_JACCARD_THRESHOLD,
} from "./dashboardInsightDedup.js";
import type { DashboardInsight } from "./types.js";

function baseInsight(overrides: Partial<DashboardInsight & { judge_score?: number }> = {}): DashboardInsight & {
  judge_score?: number;
} {
  return {
    headline: "Test",
    understory: "",
    sentiment: "neutral",
    severity_score: 0.5,
    cited_numbers: [],
    what_changed: "",
    why: "",
    business_impact: "",
    risk_if_ignored: "",
    recommended_action: "",
    owner: "",
    scope: "page",
    filter_context: {},
    evidence_refs: [],
    escalate: false,
    sourcePageId: "workflow-conversion",
    sourcePageName: "Workflow Conversion",
    ...overrides,
  };
}

describe("filterContextsAreDuplicate", () => {
  it("workflow-conversion: treats conversion string vs boolean as same when other keys match", () => {
    const a = {
      datePeriod: "mtd",
      segmentIndex: 3,
      segmentLabel: "Submitted To Underwriting → Uw Final Approval",
      conversion: "conversion",
    };
    const b = {
      datePeriod: "mtd",
      segmentIndex: 3,
      segmentLabel: "Submitted To Underwriting → Uw Final Approval",
      conversion: true,
    };
    expect(filterContextsAreDuplicate("workflow-conversion", a, b)).toBe(true);
  });

  it("returns false when no dedup key is present on both sides", () => {
    expect(
      filterContextsAreDuplicate("workflow-conversion", { datePeriod: "mtd" }, { segmentLabel: "Started → Application" })
    ).toBe(false);
  });

  it("company-scorecard: both present tier must match", () => {
    expect(
      filterContextsAreDuplicate(
        "company-scorecard",
        { datePeriod: "ytd", tier: "Top Tier" },
        { datePeriod: "ytd", tier: "Top Tier" }
      )
    ).toBe(true);
    expect(
      filterContextsAreDuplicate(
        "company-scorecard",
        { datePeriod: "ytd", tier: "Top Tier" },
        { datePeriod: "ytd", tier: "Second Tier" }
      )
    ).toBe(false);
  });

  it("leaderboard: leaderName compared when both present", () => {
    expect(
      filterContextsAreDuplicate(
        "leaderboard",
        { datePeriod: "mtd", leaderName: "Jane Doe" },
        { datePeriod: "mtd", leaderName: "Jane Doe" }
      )
    ).toBe(true);
  });

  it("leaderboard: leader key can match leaderName for compatibility", () => {
    expect(
      filterContextsAreDuplicate(
        "leaderboard",
        { datePeriod: "mtd", leaderName: "Jane Doe" },
        { datePeriod: "mtd", leader: "Jane Doe" }
      )
    ).toBe(true);
  });

  it("loan-complexity: actor is compared by actor name", () => {
    expect(
      filterContextsAreDuplicate(
        "loan-complexity",
        { datePeriod: "qtd", actor: "Craig James Nielsen" },
        { datePeriod: "qtd", actor: "Craig James Nielsen" }
      )
    ).toBe(true);
    expect(
      filterContextsAreDuplicate(
        "loan-complexity",
        { datePeriod: "qtd", actor: "Craig James Nielsen" },
        { datePeriod: "qtd", actor: "Marcus Allen Yokley" }
      )
    ).toBe(false);
    expect(
      filterContextsAreDuplicate(
        "loan-complexity",
        { datePeriod: "qtd", actor: "Craig James Nielsen" },
        { datePeriod: "qtd", actorType: "loan_officer" }
      )
    ).toBe(false);
  });
});

describe("headlineJaccard", () => {
  it("returns 0 for two empty headlines", () => {
    expect(headlineJaccard("", "")).toBe(0);
  });

  it("is 1 for identical token sets", () => {
    expect(headlineJaccard("Pull-through fell vs last month", "Pull-through fell vs last month")).toBe(1);
  });

  it("meets threshold for minor wording overlap", () => {
    const a = "Processing to UW conversion weakest in MTD funnel";
    const b = "Processing to UW conversion weakest link MTD funnel";
    expect(headlineJaccard(a, b)).toBeGreaterThanOrEqual(HEADLINE_JACCARD_THRESHOLD - 0.01);
  });
});

describe("deduplicateByFilterContextAndHeadline", () => {
  it("keeps higher judge_score when filter contexts duplicate", () => {
    const low = baseInsight({
      judge_score: 6,
      filter_context: {
        datePeriod: "mtd",
        segmentLabel: "A → B",
        segmentIndex: 1,
      },
      headline: "Low",
    });
    const high = baseInsight({
      judge_score: 8,
      filter_context: {
        datePeriod: "mtd",
        segmentLabel: "A → B",
        segmentIndex: 1,
        conversion: true,
      },
      headline: "High",
    });
    const out = deduplicateByFilterContextAndHeadline([low, high], "workflow-conversion");
    expect(out).toHaveLength(1);
    expect(out[0].headline).toBe("High");
    expect(out[0].judge_score).toBe(8);
  });

  it("merges on headline when Pass 1 does not (similar headlines)", () => {
    const a = baseInsight({
      judge_score: 7,
      filter_context: { datePeriod: "ly" },
      headline: "Bottleneck at Processing to UW in last calendar year",
    });
    const b = baseInsight({
      judge_score: 9,
      filter_context: { datePeriod: "mtd" },
      headline: "Bottleneck at Processing to UW in last calendar year",
    });
    const out = deduplicateByFilterContextAndHeadline([a, b], "workflow-conversion");
    expect(out).toHaveLength(1);
    expect(out[0].judge_score).toBe(9);
  });
});

describe("insightsMatchByFilterThenHeadline", () => {
  it("matches by filter_context before headline", () => {
    const a = baseInsight({
      filter_context: { datePeriod: "mtd", segmentLabel: "Started → Application" },
      headline: "Completely different words A",
    });
    const b = baseInsight({
      filter_context: { datePeriod: "mtd", segmentLabel: "Started → Application" },
      headline: "Completely different words B",
    });
    expect(insightsMatchByFilterThenHeadline("workflow-conversion", a, b)).toBe(true);
  });
});
