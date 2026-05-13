import { describe, it, expect } from "vitest";
import {
  buildSpecifierPredicateSql,
  composeAccessAndSpecifierFilters,
  isSpecifierObjectEmpty,
} from "./userInsightSpecifierPredicate.js";
import type { LoanAccessFilter } from "../userLoanAccessService.js";

describe("isSpecifierObjectEmpty", () => {
  it("treats {} as empty", () => {
    expect(isSpecifierObjectEmpty({})).toBe(true);
  });

  it("detects non-empty array values", () => {
    expect(isSpecifierObjectEmpty({ branch: ["2005"] })).toBe(false);
  });
});

describe("buildSpecifierPredicateSql", () => {
  const allow = new Set(["branch", "loan_type"]);

  it("returns null filter for empty effective specifiers", () => {
    const r = buildSpecifierPredicateSql({}, allow);
    expect(r.ok).toBe(true);
    expect(r.filter).toBeNull();
  });

  it("builds AND of ANY clauses", () => {
    const r = buildSpecifierPredicateSql({ branch: ["2005", "2006"], loan_type: ["FHA"] }, allow);
    expect(r.ok).toBe(true);
    expect(r.filter?.sql).toContain("l.branch = ANY($1::text[])");
    expect(r.filter?.sql).toContain("AND");
    expect(r.filter?.sql).toContain("l.loan_type = ANY($2::text[])");
    expect(r.filter?.params).toEqual([["2005", "2006"], ["FHA"]]);
  });

  it("fails fast on unknown columns", () => {
    const r = buildSpecifierPredicateSql({ not_a_column: ["x"] }, allow);
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.invalidKeys).toContain("not_a_column");
    }
  });
});

describe("composeAccessAndSpecifierFilters", () => {
  const access: LoanAccessFilter = {
    sql: "l.guid IN (SELECT loan_guid FROM user_loan_access WHERE user_id = $1)",
    params: ["user-uuid"],
    paramOffset: 1,
  };

  const spec: LoanAccessFilter = {
    sql: "l.branch = ANY($1::text[])",
    params: [["A", "B"]],
    paramOffset: 1,
  };

  it("returns only access when specifier is null", () => {
    expect(composeAccessAndSpecifierFilters(access, null)).toEqual(access);
  });

  it("ANDs access with shifted specifier placeholders", () => {
    const merged = composeAccessAndSpecifierFilters(access, spec);
    expect(merged?.sql).toContain("l.guid IN");
    expect(merged?.sql).toContain("AND");
    expect(merged?.sql).toContain("l.branch = ANY($2::text[])");
    expect(merged?.params).toEqual(["user-uuid", ["A", "B"]]);
  });
});
