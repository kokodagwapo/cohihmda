/**
 * One-time helper: merges Mark Roszko QA doc findings into docs/COHI_JIRA_IMPORT.json
 * Run: node scripts/merge-qa-issues-into-jira-import.mjs
 */
import fs from "fs";
import path from "path";

const root = path.join(import.meta.dirname, "..");
const target = path.join(root, "docs", "COHI_JIRA_IMPORT.json");

function adf(text) {
  return {
    type: "doc",
    version: 1,
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: text }],
      },
    ],
  };
}

function issue(issueType, summary, descriptionText, extraLabels, qaRef) {
  const labels = [
    "cohi-backlog-draft",
    "qa",
    "qa-run-2026-03",
    "qa-coheus-2-0",
    "env-cohi-dev",
    "client-homestead",
    ...extraLabels,
  ];
  const prefix = qaRef ? `QA ref ${qaRef}. ` : "";
  return {
    fields: {
      project: { key: "COHI" },
      summary,
      issuetype: { name: issueType },
      labels,
      description: adf(prefix + descriptionText),
    },
  };
}

const qaBatch = [
  issue(
    "Task",
    "[QA run] Coheus 2.0 Platform — Mark Roszko (Mar 12–13, 2026)",
    "Umbrella for QA findings from docs/QA Coheus 2.0 Platform recovered.docx. URL tested: https://cohi-dev.coheus1.com/admin. Client: Homestead Financial Mortgage. After import, link subsequent Bug/Task issues to this item (Jira linked issues, Epic, or parent) per team workflow. Labels on children include qa-finding.",
    ["qa-umbrella-batch", "tester-mark-roszko"],
    null,
  ),
  issue(
    "Bug",
    "Landing: rename Cohi Daily Briefings toggle to match Cohi Insights panel",
    "Toggle label says Cohi Daily Briefings but it hides/shows the Cohi Insights panel — align naming.",
    ["qa-finding", "landing-page"],
    "1.03",
  ),
  issue(
    "Bug",
    "Landing: rename Mortgage News toggle to match Cohi Daily Morning Brief panel",
    "Toggle label says Mortgage News but it controls the Cohi Daily Morning Brief panel — align naming.",
    ["qa-finding", "landing-page"],
    "1.04",
  ),
  issue(
    "Bug",
    "Generate Cohi Insights runs batch loop ~4 minutes then does not display results",
    "Purple Generate button appears to complete batch processing but insights do not render when finished.",
    ["qa-finding", "landing-page", "insights"],
    "1.06",
  ),
  issue(
    "Bug",
    "Insights refresh: button label Fresh should be Refresh; reconcile duplicate refresh controls",
    "Label typo Fresh; two refresh-related buttons — confirm if both are needed and simplify UX.",
    ["qa-finding", "landing-page", "insights"],
    "1.07",
  ),
  issue(
    "Bug",
    "Cohi Daily Morning Brief export: Excel, PDF, PowerPoint fail; PNG and JPEG succeed",
    "Export returns errors for Excel, PDF, PowerPoint (Mark report). PNG/JPEG work.",
    ["qa-finding", "landing-page", "export"],
    "1.08",
  ),
  issue(
    "Task",
    "Compliance: review Optimal Blue OBMMI redistribution terms for Daily Brief charts",
    "Data use agreement references restrictions on reselling/relicensing/redistributing for commercial use — confirm product/legal posture.",
    ["qa-finding", "landing-page", "compliance", "legal-review"],
    "1.10",
  ),
  issue(
    "Bug",
    "10Y Treasury chart: data lag vs brief cutoff; fix Treasury link; clarify Fed cuts subtitle",
    "Chart data lags brief cutoff; hyperlink goes to Treasury landing page instead of daily yields page; subtitle ~65bps Fed cuts pricing unclear or needs sourcing.",
    ["qa-finding", "landing-page", "market-data"],
    "1.11",
  ),
  issue(
    "Bug",
    "MBA Application Index chart: data stale vs brief date",
    "Most recent bar data behind Cohi Daily Morning Brief cutoff (e.g. Feb 7 vs Mar 12).",
    ["qa-finding", "landing-page", "market-data"],
    "1.12a",
  ),
  issue(
    "Task",
    "Compliance: review MBA data commercial use terms for Daily Brief charts",
    "MBA terms of use may restrict commercial reuse — confirm with legal.",
    ["qa-finding", "landing-page", "compliance", "legal-review"],
    "1.12b",
  ),
  issue(
    "Bug",
    "NAHB Builder Confidence chart: stale data and non-monthly axis labels",
    "January data shown; axis shows irregular month labels instead of clear monthly series.",
    ["qa-finding", "landing-page", "market-data"],
    "1.13",
  ),
  issue(
    "Bug",
    "Rate snapshot by product: incorrect last week value vs Optimal Blue",
    "Today value matches site; last week value appears to be prior day not week prior.",
    ["qa-finding", "landing-page", "market-data"],
    "1.14",
  ),
  issue(
    "Task",
    "Compliance: review NAR Existing Home Sales citation and member use restrictions",
    "Citation guidelines may limit use to members — confirm compliance for chart.",
    ["qa-finding", "landing-page", "compliance", "legal-review"],
    "1.15",
  ),
  issue(
    "Bug",
    "Top Headlines: open article in new browser tab",
    "Clicking headline navigates away without easy return; open target=_blank or equivalent.",
    ["qa-finding", "landing-page"],
    "1.17",
  ),
  issue(
    "Task",
    "Business Overview Active Loans KPI: reconcile new platform vs classic Coheus count",
    "531 vs 1128; export with criteria yields 1128; is_archived handling — pending definition of Field 5016 / archived logic per Marko.",
    ["qa-finding", "dashboards", "business-overview", "data-parity"],
    "2.01",
  ),
  issue(
    "Bug",
    "Business Overview Closed Loans MTD: exclude loans with future funding dates",
    "KPI includes four loans funding tomorrow; should not count in MTD closed.",
    ["qa-finding", "dashboards", "business-overview"],
    "2.02",
  ),
  issue(
    "Bug",
    "Business Overview Pull-Through KPI: rolling window does not match Last 90 Days label",
    "Earliest app date in export Jan 1 2026 vs expected ~90 days from test date.",
    ["qa-finding", "dashboards", "business-overview"],
    "2.05",
  ),
  issue(
    "Task",
    "Actors dashboard: time period selector should state which date field drives filter",
    "Users cannot tell if filter uses application, start, funding, or other date.",
    ["qa-finding", "dashboards", "actors"],
    "2.07",
  ),
  issue(
    "Bug",
    "Actors KPI panel: restore Combined LTV; reconcile row set vs classic",
    "Combined LTV missing vs classic; classic includes additional same-day application records.",
    ["qa-finding", "dashboards", "actors"],
    "2.08",
  ),
  issue(
    "Bug",
    "Actors Actor Summary: legend for colors/stars; volume precision; Aaron Michael Rist stat mismatch",
    "Explain color coding and stars; show less rounded volume; fix mismatched stats for named actor.",
    ["qa-finding", "dashboards", "actors"],
    "2.09",
  ),
  issue(
    "Task",
    "Dashboards: loan number search or targeted filter for applicable dashboards",
    "General finding: cannot add specific filters or search by loan number everywhere needed.",
    ["qa-finding", "dashboards", "feature-request"],
    "General-A",
  ),
  issue(
    "Task",
    "Dashboards: multi-select values within a dimension on visualizations",
    "General finding: cannot multi-select loan statuses etc. on Actor dashboard visual.",
    ["qa-finding", "dashboards", "feature-request"],
    "General-B",
  ),
];

const data = JSON.parse(fs.readFileSync(target, "utf8"));

data.meta.issueTypes = {
  Task: "Planning, requirements, investigations, legal or compliance review, data parity analysis, umbrella batch tracker. Use for QA items that are questions or follow-ups without a single broken behavior.",
  Bug: "Defect: broken behavior, wrong data, failed export, incorrect labels, UX that does not match intended product behavior.",
  Story:
    "Optional on many boards: user-deliverable feature work. Use only if COHI project requires Stories for dev work; QA outcomes are usually Bug or Task.",
  Epic:
    "If your Jira uses Epics for release themes: optionally create a QA Epic and link all qa-finding issues. This JSON uses a Task umbrella instead to avoid custom Epic field IDs.",
};

data.meta.labeling = {
  cohiBacklog: ["cohi-backlog-draft"],
  productRoadmap: "Issues from product planning (Builder, Lender profile, CSV, etc.) carry cohi-backlog-draft and themed labels (insights, mct, ...).",
  qaFromMarkMar2026:
    "All Mark doc items: qa, qa-run-2026-03, qa-coheus-2-0, qa-finding (except umbrella uses qa-umbrella-batch), env-cohi-dev, client-homestead, tester-mark-roszko on umbrella. Add environment or client label per run for future QA imports.",
  howToOrganizeInJira: [
    "Use Bug vs Task as mapped in issueTypes so reporting separates defect backlog from research/compliance.",
    "Link all qa-finding issues to the umbrella Task [QA run] or to a QA Epic after import.",
    "Optionally add Jira Components (Frontend, Data, Market Data, Compliance) — not in JSON; set manually or extend script.",
    "Optionally set Priority and Fix Version on import; requires known project configuration.",
    "Filter board: labels in (qa-finding) OR fixVersion = upcoming patch.",
  ],
};

data.meta.usage =
  "For each object in issues[], POST { fields: issue.fields } to /rest/api/3/issue. Strip any non-API keys if you add them. Issue types Bug and Task must exist on project COHI. If your project uses different names (e.g. Defect), replace issuetype.name in this file.";

delete data.meta.markQaNote;

const markIdx = data.issues.findIndex((i) =>
  String(i.fields.summary).includes("Mark QA findings — import Word doc"),
);
if (markIdx === -1) {
  console.error("Could not find Mark QA placeholder issue");
  process.exit(1);
}
data.issues.splice(markIdx, 1, ...qaBatch);

fs.writeFileSync(target, JSON.stringify(data, null, 2) + "\n");
console.log("Updated", target, "issues count:", data.issues.length);
