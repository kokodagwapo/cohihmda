import { describe, expect, it } from "vitest";
import {
  evaluateLoanDetailFilters,
  isFilterActive,
  type ColumnFilterState,
} from "@/utils/loanDetailFilters";

type Row = {
  branch: string;
  status: string;
  fico: number;
  closingDate: string;
  lockedFlag: "Yes" | "No";
};

const rows: Row[] = [
  { branch: "2001", status: "Active Loan", fico: 620, closingDate: "2025-01-10", lockedFlag: "Yes" },
  { branch: "1000", status: "Active Loan", fico: 730, closingDate: "2025-02-15", lockedFlag: "No" },
  { branch: "2100", status: "Closed", fico: 580, closingDate: "2024-11-30", lockedFlag: "No" },
];

describe("loanDetailFilters", () => {
  it("applies OR within a column and AND across columns", () => {
    const filters: ColumnFilterState = {
      branch: { kind: "text", selectedValues: ["2001", "1000"] },
      status: { kind: "text", selectedValues: ["Active Loan"] },
    };
    const filtered = evaluateLoanDetailFilters(rows, filters, (row, columnId) => row[columnId as keyof Row]);
    expect(filtered).toHaveLength(2);
  });

  it("applies numeric range/min/max correctly", () => {
    const rangeFilters: ColumnFilterState = {
      fico: { kind: "number", mode: "range", selectedValues: [], min: "600", max: "700" },
    };
    const minFilters: ColumnFilterState = {
      fico: { kind: "number", mode: "min", selectedValues: [], value: "700" },
    };
    const maxFilters: ColumnFilterState = {
      fico: { kind: "number", mode: "max", selectedValues: [], value: "600" },
    };

    expect(evaluateLoanDetailFilters(rows, rangeFilters, (r, c) => r[c as keyof Row])).toHaveLength(1);
    expect(evaluateLoanDetailFilters(rows, minFilters, (r, c) => r[c as keyof Row])).toHaveLength(1);
    expect(evaluateLoanDetailFilters(rows, maxFilters, (r, c) => r[c as keyof Row])).toHaveLength(1);
  });

  it("supports date shortcut and boolean filters", () => {
    const yearFilters: ColumnFilterState = {
      closingDate: { kind: "date", shortcut: "2025" },
      lockedFlag: { kind: "boolean", value: "yes" },
    };
    const filtered = evaluateLoanDetailFilters(rows, yearFilters, (row, columnId) => row[columnId as keyof Row]);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].branch).toBe("2001");
  });

  it("detects active filters", () => {
    expect(isFilterActive({ kind: "text", selectedValues: [] })).toBe(false);
    expect(isFilterActive({ kind: "text", selectedValues: ["x"] })).toBe(true);
    expect(isFilterActive({ kind: "number", mode: "all", selectedValues: [] })).toBe(false);
    expect(isFilterActive({ kind: "number", mode: "min", selectedValues: [], value: "600" })).toBe(true);
    expect(isFilterActive({ kind: "date", shortcut: "ytd" })).toBe(true);
    expect(isFilterActive({ kind: "boolean", value: "all" })).toBe(false);
  });
});
