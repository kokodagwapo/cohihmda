import { describe, expect, it } from "vitest";
import {
  applyRankingSqlGuard,
  detectRankingIntent,
  RANKING_DEFAULT_LIMIT,
} from "./rankingQueryGuard.js";

describe("rankingQueryGuard", () => {
  it("detects explicit top N", () => {
    const intent = detectRankingIntent("show me top 10 LOs this month");
    expect(intent).toEqual({ kind: "top", limit: 10, isRanking: true });
  });

  it("detects implied top with default limit", () => {
    const intent = detectRankingIntent("show top loan officers this month");
    expect(intent?.limit).toBe(RANKING_DEFAULT_LIMIT);
  });

  it("detects bottom N", () => {
    const intent = detectRankingIntent(
      "bottom 7 branches by pull-through this quarter",
    );
    expect(intent).toEqual({ kind: "bottom", limit: 7, isRanking: true });
  });

  it("does not treat time series as ranking", () => {
    expect(detectRankingIntent("loan volume by month last year")).toBeNull();
  });

  it("does not treat platform tier phrasing as top-N ranking", () => {
    expect(detectRankingIntent("who are my top tier LOs?")).toBeNull();
    expect(detectRankingIntent("second tier loan officers on scorecard")).toBeNull();
  });

  it("still detects explicit top N for LOs", () => {
    const intent = detectRankingIntent("top 10 loan officers by funded volume");
    expect(intent?.limit).toBe(10);
  });

  it("adds LIMIT when missing on ranking SQL", () => {
    const sql =
      "SELECT loan_officer, COUNT(*) AS c FROM public.loans l GROUP BY 1 ORDER BY c DESC";
    const guarded = applyRankingSqlGuard(sql, {
      kind: "top",
      limit: 10,
      isRanking: true,
    });
    expect(guarded).toMatch(/LIMIT\s+10/i);
  });
});
