import { describe, expect, it } from "vitest";
import {
  buildLoanDetailViewStatePreferenceKey,
  normalizeLoanDetailViewState,
} from "./useLoanDetailViewState";

describe("buildLoanDetailViewStatePreferenceKey", () => {
  it("builds standalone key with tenant id", () => {
    expect(
      buildLoanDetailViewStatePreferenceKey({
        tenantId: "tenant_1",
        scope: "standalone",
      }),
    ).toBe("loanDetailViewState:v1:tenant:tenant_1:standalone");
  });

  it("returns null when tenant id is missing", () => {
    expect(
      buildLoanDetailViewStatePreferenceKey({
        tenantId: null,
        scope: "standalone",
      }),
    ).toBeNull();
  });

  it("builds widget key with scope id", () => {
    expect(
      buildLoanDetailViewStatePreferenceKey({
        tenantId: "tenant_1",
        scope: "widget",
        scopeId: "canvas_42",
      }),
    ).toBe("loanDetailViewState:v1:tenant:tenant_1:widget:canvas_42");
  });
});

describe("normalizeLoanDetailViewState", () => {
  it("normalizes invalid input to safe defaults", () => {
    const normalized = normalizeLoanDetailViewState(null);
    expect(normalized.version).toBe(1);
    expect(normalized.appliedFilters).toEqual({});
    expect(normalized.selectedBookmarkId).toBeNull();
    expect(normalized.selectedBookmarkTitle).toBeNull();
    expect(normalized.columns).toEqual([]);
    expect(normalized.sortColumnId).toBeNull();
    expect(normalized.sortDirection).toBe("asc");
    expect(normalized.showFilters).toBe(false);
  });

  it("normalizes mixed values and strips invalid columns", () => {
    const normalized = normalizeLoanDetailViewState({
      appliedFilters: {
        loan_number: { kind: "text", selectedValues: ["123"] },
      },
      selectedBookmarkId: "bookmark_1",
      selectedBookmarkTitle: "My bookmark",
      columns: [
        { id: "loan_number", label: "Loan number", field: "loan_number" },
        { id: "", label: "Bad", field: "bad" },
        { id: "loan_number", label: "Duplicate", field: "loan_number" },
      ],
      sortColumnId: "loan_number",
      sortDirection: "desc",
      showFilters: true,
    });

    expect(normalized.appliedFilters).toEqual({
      loan_number: { kind: "text", selectedValues: ["123"] },
    });
    expect(normalized.selectedBookmarkId).toBe("bookmark_1");
    expect(normalized.selectedBookmarkTitle).toBe("My bookmark");
    expect(normalized.columns).toEqual([
      { id: "loan_number", label: "Loan number", field: "loan_number" },
    ]);
    expect(normalized.sortColumnId).toBe("loan_number");
    expect(normalized.sortDirection).toBe("desc");
    expect(normalized.showFilters).toBe(true);
  });
});

