/**
 * Build workbench canvas content for "deep dive" from a dashboard_generated_insights row.
 * One widget_group per insight: the full registry widget set for that dashboard (not evidence_refs IDs).
 * savedFilters: date scope + branch/LO + channel + loan-complexity drill-down + credit-risk application type when present.
 */

export type DashboardInsightRowForDeepDive = {
  id: number;
  page_id: string;
  page_name: string | null;
  headline: string | null;
  understory: string | null;
  scope: string | null;
  filter_context: unknown;
  evidence_refs: unknown;
};

type DeepDiveGroupDef = {
  sectionType: string;
  groupTitle: string;
  widgetIds: string[];
};

/** Mirrors src/components/workbench/WorkbenchCanvas.tsx SECTION_TO_WIDGETS for dashboard-insight pages. */
const DASHBOARD_DEEP_DIVE_BY_PAGE_ID: Record<string, DeepDiveGroupDef> = {
  "company-scorecard": {
    sectionType: "company-scorecard",
    groupTitle: "Company Scorecard",
    widgetIds: [
      "company-scorecard-units",
      "company-scorecard-volume",
      "company-scorecard-avg-loan-size",
      "company-scorecard-wac",
      "company-scorecard-wa-fico",
      "company-scorecard-wa-ltv",
      "company-scorecard-wa-dti",
      "company-scorecard-volume-by-branch",
      "company-scorecard-pullthrough-by-branch",
      "company-scorecard-tabbed-table",
    ],
  },
  "credit-risk-management": {
    sectionType: "credit-risk",
    groupTitle: "Credit Risk Management",
    widgetIds: [
      "credit-risk-units",
      "credit-risk-volume",
      "credit-risk-wac",
      "credit-risk-wa-fico",
      "credit-risk-wa-ltv",
      "credit-risk-wa-dti",
      "credit-risk-fico-distribution",
      "credit-risk-ltv-distribution",
      "credit-risk-dti-distribution",
      "credit-risk-loan-mix-table",
    ],
  },
  "loan-complexity": {
    sectionType: "loan-complexity",
    groupTitle: "Loan Complexity",
    widgetIds: ["loan-complexity-pivot", "loan-complexity-chart", "loan-complexity-table"],
  },
  leaderboard: {
    sectionType: "leaderboard",
    groupTitle: "Leaderboard",
    widgetIds: ["leaderboard-embed"],
  },
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toYmd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function startOfYear(d: Date): Date {
  return new Date(d.getFullYear(), 0, 1);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function endOfYear(d: Date): Date {
  return new Date(d.getFullYear(), 11, 31);
}

function subMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() - n, d.getDate());
}

function subYears(d: Date, n: number): Date {
  return new Date(d.getFullYear() - n, d.getMonth(), d.getDate());
}

function startOfQuarter(d: Date): Date {
  const q = Math.floor(d.getMonth() / 3);
  return new Date(d.getFullYear(), q * 3, 1);
}

function endOfQuarter(d: Date): Date {
  const q = Math.floor(d.getMonth() / 3);
  return new Date(d.getFullYear(), q * 3 + 3, 0);
}

function subQuarters(d: Date, n: number): Date {
  return subMonths(d, n * 3);
}

function computePresetDateRange(preset: string): { start: string; end: string } {
  const now = new Date();
  switch (preset) {
    case "rolling-13":
      return { start: toYmd(startOfMonth(subMonths(now, 13))), end: toYmd(now) };
    case "rolling-12":
      return { start: toYmd(startOfMonth(subMonths(now, 12))), end: toYmd(now) };
    case "mtd":
      return { start: toYmd(startOfMonth(now)), end: toYmd(now) };
    case "qtd":
      return { start: toYmd(startOfQuarter(now)), end: toYmd(now) };
    case "ytd":
      return { start: toYmd(startOfYear(now)), end: toYmd(now) };
    case "last-month": {
      const d = subMonths(now, 1);
      return { start: toYmd(startOfMonth(d)), end: toYmd(endOfMonth(d)) };
    }
    case "last-quarter": {
      const d = subQuarters(now, 1);
      return { start: toYmd(startOfQuarter(d)), end: toYmd(endOfQuarter(d)) };
    }
    case "last-year": {
      const d = subYears(now, 1);
      return { start: toYmd(startOfYear(d)), end: toYmd(endOfYear(d)) };
    }
    default:
      return { start: toYmd(startOfYear(now)), end: toYmd(now) };
  }
}

function periodSelectionFromDatePeriod(
  dpRaw: unknown
): { periodSelection: Record<string, unknown>; dateRange: { start: string; end: string }; year: number } | null {
  const dp = typeof dpRaw === "string" ? dpRaw.trim().toLowerCase() : "";
  if (!dp) return null;
  const now = new Date();
  const y = now.getFullYear();

  if (dp === "l13m") {
    const dr = computePresetDateRange("rolling-13");
    return { periodSelection: { type: "preset", preset: "rolling-13", dateRange: dr }, dateRange: dr, year: y };
  }
  if (dp === "l12m") {
    const dr = computePresetDateRange("rolling-12");
    return { periodSelection: { type: "preset", preset: "rolling-12", dateRange: dr }, dateRange: dr, year: y };
  }
  if (dp === "mtd") {
    const dr = computePresetDateRange("mtd");
    return { periodSelection: { type: "preset", preset: "mtd", dateRange: dr }, dateRange: dr, year: y };
  }
  if (dp === "qtd") {
    const dr = computePresetDateRange("qtd");
    return { periodSelection: { type: "preset", preset: "qtd", dateRange: dr }, dateRange: dr, year: y };
  }
  if (dp === "ytd") {
    const dr = { start: `${y}-01-01`, end: toYmd(now) };
    return { periodSelection: { type: "year", year: y, dateRange: dr }, dateRange: dr, year: y };
  }
  if (dp === "lm" || dp === "last-month") {
    const dr = computePresetDateRange("last-month");
    return { periodSelection: { type: "preset", preset: "last-month", dateRange: dr }, dateRange: dr, year: y };
  }
  if (dp === "lq" || dp === "last-quarter") {
    const dr = computePresetDateRange("last-quarter");
    return { periodSelection: { type: "preset", preset: "last-quarter", dateRange: dr }, dateRange: dr, year: y };
  }
  if (dp === "ly" || dp === "last-year") {
    const dr = computePresetDateRange("last-year");
    return { periodSelection: { type: "preset", preset: "last-year", dateRange: dr }, dateRange: dr, year: y };
  }

  const yMatch = dp.match(/^y_(\d{4})$/);
  if (yMatch) {
    const yr = Number(yMatch[1]);
    const dr = { start: `${yr}-01-01`, end: `${yr}-12-31` };
    return { periodSelection: { type: "year", year: yr, dateRange: dr }, dateRange: dr, year: yr };
  }

  return null;
}

function parseBranchFromHeadline(headline: string): string | undefined {
  const m = headline.match(/\bBranch\s+([^\s,.;]+)/i);
  return m?.[1]?.trim();
}

function extractBranchLoanOfficer(
  fc: Record<string, unknown>,
  evidenceRefs: any[],
  headline: string
): { branch?: string; loanOfficer?: string } {
  let branch: string | undefined;
  let loanOfficer: string | undefined;

  if (fc?.branch != null && typeof fc.branch === "string") branch = fc.branch.trim();
  if (fc?.loanOfficer != null && typeof fc.loanOfficer === "string") loanOfficer = fc.loanOfficer.trim();
  if (!loanOfficer && fc?.loan_officer != null && typeof fc.loan_officer === "string") {
    loanOfficer = fc.loan_officer.trim();
  }

  for (const ref of evidenceRefs || []) {
    const wid = String(ref?.widgetId || "");
    const label = typeof ref?.target?.label === "string" ? ref.target.label.trim() : "";
    if (!label) continue;
    if (wid === "company-scorecard-detail-branch-table" || wid.includes("detail-branch")) branch = label;
    if (wid === "company-scorecard-detail-loan-officer-table" || wid.includes("detail-loan-officer")) {
      loanOfficer = label;
    }
  }

  if (!branch && headline) {
    const fromHl = parseBranchFromHeadline(headline);
    if (fromHl) branch = fromHl;
  }

  return { branch, loanOfficer };
}

const LC_WIDGET_TO_FILTERS: Record<
  string,
  { groupBy: "branch" | "actors" | "current_loan_status"; actorType?: string }
> = {
  "loan-complexity-pivot-branch": { groupBy: "branch" },
  "loan-complexity-pivot-loan-officer": { groupBy: "actors", actorType: "loan_officer" },
  "loan-complexity-pivot-processor": { groupBy: "actors", actorType: "processor" },
  "loan-complexity-pivot-underwriter": { groupBy: "actors", actorType: "underwriter" },
  "loan-complexity-pivot-closer": { groupBy: "actors", actorType: "closer" },
  "loan-complexity-pivot-current-loan-status": { groupBy: "current_loan_status" },
  "loan-complexity-bar-chart": { groupBy: "actors", actorType: "loan_officer" },
};

function buildLoanComplexityDrillDown(evidenceRefs: any[]): Record<string, unknown> | null {
  const refs = Array.isArray(evidenceRefs) ? evidenceRefs : [];
  const primary =
    refs.find((r: any) => r?.role === "primary") ?? refs[0];
  if (!primary?.widgetId || !primary?.target?.label) return null;
  const wid = String(primary.widgetId);
  const label = String(primary.target.label).trim();
  if (!label) return null;
  const cfg = LC_WIDGET_TO_FILTERS[wid];
  if (!cfg) return null;
  const dimension =
    cfg.groupBy === "branch"
      ? "branch"
      : cfg.groupBy === "current_loan_status"
        ? "current_loan_status"
        : cfg.actorType ?? "loan_officer";
  const out: Record<string, unknown> = {
    loanComplexityGroupBy: cfg.groupBy,
    loanComplexitySelectedGroups: [{ dimension, groupName: label }],
  };
  if (cfg.actorType) out.loanComplexityActorType = cfg.actorType;
  return out;
}

function normalizeApplicationType(raw: unknown): string | undefined {
  if (raw == null || typeof raw !== "string") return undefined;
  const t = raw.trim();
  if (!t) return undefined;
  return t === "Lost Opperturnities" ? "Lost Opportunities" : t;
}

function buildSavedFilters(
  def: DeepDiveGroupDef,
  fc: Record<string, unknown>,
  evidenceRefs: any[],
  headline: string
): Record<string, unknown> {
  const year = new Date().getFullYear();
  const sectionType = def.sectionType;

  const base: Record<string, unknown> = {
    sectionType,
    year,
    branch: "all",
    loanOfficer: "all",
    application: "applicationsTaken",
    dateField: "application_date",
    applicationType: "Applications Taken",
    actorType: "loan_officer",
  };

  const ps = periodSelectionFromDatePeriod(fc.datePeriod);
  if (ps) {
    base.periodSelection = ps.periodSelection;
    base.dateRange = ps.dateRange;
    base.year = ps.year;
  }

  const cg = fc.channelGroup;
  if (cg != null && typeof cg === "string") {
    const v = cg.trim();
    if (v && v.toLowerCase() !== "all") {
      base.dynamicFilters = [{ column: "channel", label: "Channel", value: v }];
    }
  }

  if (sectionType === "company-scorecard" || sectionType === "credit-risk") {
    const { branch, loanOfficer } = extractBranchLoanOfficer(fc, evidenceRefs, headline);
    if (branch && branch.toLowerCase() !== "all") base.branch = branch;
    if (loanOfficer && loanOfficer.toLowerCase() !== "all") base.loanOfficer = loanOfficer;
  }

  if (sectionType === "credit-risk") {
    const app = normalizeApplicationType(fc.applicationType);
    if (app) base.applicationType = app;
  }

  if (sectionType === "loan-complexity") {
    const lc = buildLoanComplexityDrillDown(evidenceRefs);
    if (lc) Object.assign(base, lc);
  }

  return base;
}

function getGroupDef(pageId: string): DeepDiveGroupDef | null {
  const id = String(pageId || "")
    .trim()
    .toLowerCase();
  return DASHBOARD_DEEP_DIVE_BY_PAGE_ID[id] ?? null;
}

export function buildDashboardInsightDeepDiveCanvas(row: DashboardInsightRowForDeepDive): {
  content: Record<string, unknown>;
  canvasTitle: string;
} {
  const def = getGroupDef(row.page_id);
  if (!def) {
    throw new Error(`No deep-dive widget group mapping for dashboard page: ${row.page_id}`);
  }

  const fc =
    row.filter_context && typeof row.filter_context === "object" && !Array.isArray(row.filter_context)
      ? (row.filter_context as Record<string, unknown>)
      : {};
  const evidenceRefs = Array.isArray(row.evidence_refs) ? row.evidence_refs : [];

  const savedFilters = buildSavedFilters(def, fc, evidenceRefs, String(row.headline || ""));
  const items = def.widgetIds.map((defId) => ({ kind: "registry" as const, defId }));

  const ts = Date.now();
  const groupId = `ddash-grp-${ts}`;
  const FULL_WIDTH = 1020;
  const HEIGHT = 1400;
  const LEFT_MARGIN = 12;
  const TOP = 24;

  const layout = [
    {
      i: `deep-dash-${ts}-section`,
      x: LEFT_MARGIN,
      y: TOP,
      w: FULL_WIDTH,
      h: HEIGHT,
      type: "widget_group" as const,
      payload: {
        type: "widget_group" as const,
        groupId,
        title: def.groupTitle,
        sectionType: def.sectionType,
        widgetIds: [],
        filtersCollapsed: false,
        items,
        savedFilters,
      },
    },
  ];

  const sourceDashboardInsight = {
    id: row.id,
    page_id: row.page_id,
    page_name: row.page_name,
    headline: row.headline,
    scope: row.scope,
    filter_context: row.filter_context,
    evidence_refs: row.evidence_refs,
  };

  const headlineStr = String(row.headline || "");
  const canvasTitle = `Deep Dive (Dashboard): ${headlineStr.substring(0, 60)}${headlineStr.length > 60 ? "..." : ""}`;

  const content = {
    layoutVersion: "freeform-v1",
    layout,
    annotations: [],
    background: { type: "color", value: "#ffffff" },
    uploadsMeta: [],
    sourceDashboardInsight,
  };

  return { content, canvasTitle };
}
