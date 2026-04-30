import { describe, expect, it } from "vitest";
import {
  columnReferencedInFinalSelectBody,
  computeResearchSqlFilterInjectionEligibility,
  findFinalSelectOffset,
  hasStandardLoansAliasL,
  isSingleStatementSql,
} from "./researchSqlFilterInjectionEligibility";

describe("findFinalSelectOffset", () => {
  it("returns 0 for plain SELECT", () => {
    expect(findFinalSelectOffset("SELECT 1")).toBe(0);
  });

  it("finds outer SELECT after WITH", () => {
    const sql = `WITH a AS (SELECT 1) SELECT application_date FROM a`;
    const i = findFinalSelectOffset(sql);
    expect(sql.slice(i).toUpperCase().startsWith("SELECT")).toBe(true);
    expect(sql.slice(i)).toContain("application_date");
  });
});

describe("computeResearchSqlFilterInjectionEligibility", () => {
  it("is eligible for simple loans l query with application_date in outer select", () => {
    const sql = `
      SELECT l.application_date, COUNT(*)::int AS n
      FROM public.loans l
      WHERE l.application_date IS NOT NULL
      GROUP BY 1
    `;
    const r = computeResearchSqlFilterInjectionEligibility(sql);
    expect(r.eligible).toBe(true);
    expect(r.dateColumn).toBe("application_date");
  });

  it("is not eligible without loans l alias", () => {
    const sql = `
      SELECT application_date, COUNT(*)::int AS n
      FROM public.loans
      WHERE application_date IS NOT NULL
      GROUP BY 1
    `;
    const r = computeResearchSqlFilterInjectionEligibility(sql);
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe("missing_loans_l_alias");
  });

  it("is not eligible when date column only exists inside CTE, not outer SELECT", () => {
    const sql = `
      WITH x AS (
        SELECT l.application_date
        FROM public.loans l
      )
      SELECT x.n FROM (SELECT COUNT(*)::int AS n FROM x) x
    `;
    expect(columnReferencedInFinalSelectBody(sql, "application_date")).toBe(false);
    const r = computeResearchSqlFilterInjectionEligibility(sql);
    expect(r.eligible).toBe(false);
  });

  it("rejects multi-statement SQL", () => {
    const sql = "SELECT 1 FROM public.loans l; SELECT 2 FROM public.loans l";
    expect(isSingleStatementSql(sql)).toBe(false);
    expect(computeResearchSqlFilterInjectionEligibility(sql).eligible).toBe(false);
  });

  it("rejects pull-through heuristics", () => {
    const sql = `
      SELECT l.application_date FROM public.loans l WHERE 1=1
    `;
    const r = computeResearchSqlFilterInjectionEligibility(sql, {
      title: "Pull-through by branch",
    });
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe("pull_through");
  });

  it("picks funding_date when application_date absent from final body", () => {
    const sql = `
      SELECT l.funding_date, SUM(l.loan_amount)::numeric AS vol
      FROM public.loans l
      GROUP BY 1
    `;
    const r = computeResearchSqlFilterInjectionEligibility(sql);
    expect(r.eligible).toBe(true);
    expect(r.dateColumn).toBe("funding_date");
  });
});
