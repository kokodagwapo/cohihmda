import type { AlertCircle } from "lucide-react";

export type WarningGroup =
  | "Status Tests"
  | "Application Tests"
  | "Credit Tests"
  | "UW Tests"
  | "Mortgage Tests"
  | "Personnel Tests"
  | "Date Tests";

export type Severity = "critical" | "warning" | "info";

/**
 * Maps the 7 backend WarningGroups into 3 user-friendly display categories.
 */
export type WarningCategory = "Loan Lifecycle" | "Compliance" | "Data Integrity";

export const CATEGORY_GROUPS: Record<WarningCategory, WarningGroup[]> = {
  "Loan Lifecycle": ["Status Tests", "Date Tests", "UW Tests"],
  "Compliance": ["Application Tests"],
  "Data Integrity": ["Credit Tests", "Mortgage Tests", "Personnel Tests"],
};

export const CATEGORY_DESCRIPTIONS: Record<WarningCategory, string> = {
  "Loan Lifecycle": "Status inconsistencies, date sequence errors, and underwriting gaps",
  "Compliance": "HMDA and TRID required field violations",
  "Data Integrity": "Out-of-range values, missing loan data, and unassigned personnel",
};

export interface DataQualityWarning {
  id: string;
  name: string;
  type: string;
  group: WarningGroup;
  severity: Severity;
  field: string;
  description: string;
  count: number;
  sample_loans: Array<{
    loan_id: string;
    loan_number: string | null;
    field_value?: unknown;
  }>;
}

export interface GroupedWarningSummary {
  count: number;
  criticalCount: number;
  warningCount: number;
  infoCount: number;
}

export interface StatusInconsistency {
  id: string;
  name: string;
  description: string;
  severity: Severity;
  count: number;
  sample_loans: Array<{
    loan_id: string;
    loan_number: string | null;
    field_value?: unknown;
  }>;
}

export interface StatusDistribution {
  status: string;
  count: number;
  status_group: "Active" | "Originated" | "Adverse";
}

export interface DataQualityMetrics {
  total_loans: number;
  loans_with_issues: number;
  total_issues: number;
  critical_issues: number;
  warning_issues: number;
  info_issues: number;
  quality_score: number;
  status_inconsistencies?: number;
  date_sequence_issues?: number;
  issues_by_group?: Record<WarningGroup, number>;
}

export type FieldStage = "universal" | "originated" | "processing";

export interface CrucialFieldStatus {
  name: string;
  column: string;
  priority: number;
  /** The loan subset this field was measured against */
  applicableLoanCount: number;
  populatedCount: number;
  missingCount: number;
  populationRate: number;
  status: "good" | "warning" | "critical";
  /** True when the column doesn't exist in the loans table at all */
  columnMissing?: boolean;
}

export interface CrucialFieldStageGroup {
  label: string;
  description: string;
  applicableLoanCount: number;
  fields: CrucialFieldStatus[];
}

export interface CrucialFieldsResponse {
  stageGroups: {
    universal: CrucialFieldStageGroup;
    originated: CrucialFieldStageGroup;
    processing: CrucialFieldStageGroup;
  };
  totalLoans: number;
}

export interface RangeAnalysis {
  fico?: {
    inRange: number;
    outOfRange: number;
    distribution: { range: string; count: number }[];
  };
  ltv?: {
    inRange: number;
    outOfRange: number;
    distribution: { range: string; count: number }[];
  };
  dti?: {
    inRange: number;
    outOfRange: number;
    distribution: { range: string; count: number }[];
  };
  interestRate?: {
    inRange: number;
    outOfRange: number;
    distribution: { range: string; count: number }[];
  };
}

export const SEVERITY_COLORS: Record<Severity, string> = {
  critical: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400",
  warning: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  info: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
};

export const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

export const WARNING_GROUP_CONFIG: Record<
  WarningGroup,
  { color: string; bgColor: string }
> = {
  "Status Tests": {
    color: "text-rose-600 dark:text-rose-400",
    bgColor: "bg-rose-100 dark:bg-rose-900/30",
  },
  "Application Tests": {
    color: "text-purple-600 dark:text-purple-400",
    bgColor: "bg-purple-100 dark:bg-purple-900/30",
  },
  "Credit Tests": {
    color: "text-blue-600 dark:text-blue-400",
    bgColor: "bg-blue-100 dark:bg-blue-900/30",
  },
  "UW Tests": {
    color: "text-indigo-600 dark:text-indigo-400",
    bgColor: "bg-indigo-100 dark:bg-indigo-900/30",
  },
  "Mortgage Tests": {
    color: "text-emerald-600 dark:text-emerald-400",
    bgColor: "bg-emerald-100 dark:bg-emerald-900/30",
  },
  "Personnel Tests": {
    color: "text-amber-600 dark:text-amber-400",
    bgColor: "bg-amber-100 dark:bg-amber-900/30",
  },
  "Date Tests": {
    color: "text-orange-600 dark:text-orange-400",
    bgColor: "bg-orange-100 dark:bg-orange-900/30",
  },
};

export const CATEGORY_CONFIG: Record<
  WarningCategory,
  { color: string; bgColor: string; borderColor: string }
> = {
  "Loan Lifecycle": {
    color: "text-rose-700 dark:text-rose-400",
    bgColor: "bg-rose-50 dark:bg-rose-900/20",
    borderColor: "border-rose-200 dark:border-rose-800",
  },
  "Compliance": {
    color: "text-purple-700 dark:text-purple-400",
    bgColor: "bg-purple-50 dark:bg-purple-900/20",
    borderColor: "border-purple-200 dark:border-purple-800",
  },
  "Data Integrity": {
    color: "text-blue-700 dark:text-blue-400",
    bgColor: "bg-blue-50 dark:bg-blue-900/20",
    borderColor: "border-blue-200 dark:border-blue-800",
  },
};
