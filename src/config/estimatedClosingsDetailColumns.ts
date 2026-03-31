import type { LoanDetailFilterKind } from "@/utils/loanDetailFilters";

export type EstimatedClosingsDetailColumnDefMini = {
  id: string;
  label: string;
  kind: LoanDetailFilterKind;
};

export const ESTIMATED_CLOSINGS_DETAIL_COLUMNS: EstimatedClosingsDetailColumnDefMini[] = [
  { id: "loanNumber", label: "Loan Number", kind: "text" },
  { id: "complexityGroup", label: "Complexity Group", kind: "text" },
  { id: "complexity", label: "Complexity", kind: "number" },
  { id: "closingProjectionGroup", label: "Closing Projection", kind: "text" },
  { id: "units", label: "Units", kind: "number" },
  { id: "volume", label: "Volume", kind: "number" },
  { id: "occupancyType", label: "Occupancy Type", kind: "text" },
  { id: "fico", label: "FICO", kind: "number" },
  { id: "ltv", label: "LTV", kind: "number" },
  { id: "beDti", label: "BE DTI", kind: "number" },
  { id: "borrowerSelfEmployed", label: "Borrower Self Employed", kind: "boolean" },
  { id: "qmLoanType", label: "QM Loan Type", kind: "text" },
  { id: "propertyType", label: "Property Type", kind: "text" },
  { id: "loanProgram", label: "Loan Program", kind: "text" },
  { id: "appToDispositionDays", label: "App to Disposition Days", kind: "number" },
  { id: "currentLoanStatus", label: "Current Loan Status", kind: "text" },
  { id: "currentStatusDate", label: "Current Status Date", kind: "date" },
  { id: "lastCompletedMilestone", label: "Last Completed Milestone", kind: "text" },
  { id: "loanFolder", label: "Loan Folder", kind: "text" },
  { id: "applicationDate", label: "Application Date", kind: "date" },
  { id: "fundingDate", label: "Funding Date", kind: "date" },
  { id: "lockDate", label: "Lock Date", kind: "date" },
  { id: "investorLockDate", label: "Investor Lock Date", kind: "date" },
  { id: "estimatedClosingDate", label: "Estimated Closing Date", kind: "date" },
  { id: "ctcDate", label: "CTC Date", kind: "date" },
  { id: "uwFinalApprovalDate", label: "UW Final Approval Date", kind: "date" },
  { id: "deniedDate", label: "Denied Date", kind: "date" },
  { id: "conditionalApprovalDate", label: "Conditional Approval Date", kind: "date" },
  { id: "branch", label: "Branch", kind: "text" },
  { id: "loanOfficer", label: "Loan Officer", kind: "text" },
  { id: "processor", label: "Processor", kind: "text" },
  { id: "underwriter", label: "Underwriter", kind: "text" },
];

export const ESTIMATED_CLOSINGS_DETAIL_COLUMN_BY_ID = Object.fromEntries(
  ESTIMATED_CLOSINGS_DETAIL_COLUMNS.map((c) => [c.id, c]),
) as Record<string, EstimatedClosingsDetailColumnDefMini>;
