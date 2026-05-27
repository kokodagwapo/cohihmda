/**
 * Human-style QA script for Research Lab + Normal Chat awareness changes.
 * Run: npx tsx scripts/qa/researchChatAwarenessManual.ts
 */

import { detectRankingIntent, isPlatformTierRankingExclusion } from "../../src/services/chat/rankingQueryGuard.js";
import {
  detectPlatformIntent,
  platformIntentNavigationHints,
} from "../../src/services/chat/platformIntentRouter.js";
import {
  detectSnapshotColumnsInTimeframeTable,
  isSnapshotMetricId,
  validateMetricSpecWindows,
} from "../../src/services/metrics/metricSemantics.js";
import { composeMetricSql } from "../../src/services/metrics/metricQueryComposer.js";
import { NAVIGATION_TARGETS } from "../../src/services/chat/navigationTargetCatalog.js";

type Case = {
  label: string;
  pass: boolean;
  detail?: string;
};

const results: Case[] = [];

function check(label: string, pass: boolean, detail?: string) {
  results.push({ label, pass, detail });
  const icon = pass ? "PASS" : "FAIL";
  console.log(`  [${icon}] ${label}${detail ? ` — ${detail}` : ""}`);
}

console.log("\n=== Research Lab + Normal Chat Awareness — manual QA ===\n");

console.log("1) Ranking guard (Normal Chat — should NOT mis-route tiers)\n");
check(
  '"who are my top tier LOs?" → no ranking intent',
  detectRankingIntent("who are my top tier LOs?") === null,
);
check(
  '"top tier LOs" triggers platform tier exclusion',
  isPlatformTierRankingExclusion("who are my top tier LOs?"),
);
check(
  '"top 10 loan officers by funded volume" → ranking intent',
  detectRankingIntent("top 10 loan officers by funded volume")?.limit === 10,
);
check(
  '"loan volume by month" → not ranking',
  detectRankingIntent("loan volume by month last year") === null,
);

console.log("\n2) Platform intent router\n");
const tierIntent = detectPlatformIntent("who are my top tier LOs?");
check(
  "top tier LOs → sales scorecard tier",
  tierIntent?.kind === "sales_scorecard_tier",
  tierIntent?.kind,
);
check(
  "top tier suppresses ranking guard",
  tierIntent?.suppressRankingGuard === true,
);
const tierNav = platformIntentNavigationHints(tierIntent);
check(
  "nav hint includes /sales-scorecard",
  tierNav.some((h) => h.path === "/sales-scorecard"),
  tierNav.map((h) => h.path).join(", "),
);

const pipelineIntent = detectPlatformIntent(
  "overall pipeline health and conversion performance",
);
check(
  "pipeline health question → pipeline_health",
  pipelineIntent?.kind === "pipeline_health",
  pipelineIntent?.kind,
);

const ambiguous = detectPlatformIntent("top 10 top tier LOs");
check(
  "ambiguous top N + tier → clarification",
  ambiguous?.kind === "ambiguous_tier_vs_ranking" &&
    Boolean(ambiguous?.clarificationQuestion),
);

console.log("\n3) Research metric semantics (your CSV scenario)\n");
const csvRows = [
  { timeframe: "YTD", active_loans: 496, applications: 1402 },
  { timeframe: "Rolling 90D", active_loans: 496, applications: 829 },
  { timeframe: "Rolling 30D", active_loans: 496, applications: 231 },
];
const snapshotCols = detectSnapshotColumnsInTimeframeTable(
  ["timeframe", "active_loans", "applications"],
  csvRows,
);
check(
  "detects active_loans as repeated snapshot column",
  snapshotCols.includes("active_loans"),
  snapshotCols.join(", "),
);
check(
  "does not flag applications as snapshot",
  !snapshotCols.includes("applications"),
);

const specWarnings = validateMetricSpecWindows({
  metricIds: ["active_loans"],
  window: "ytd",
});
check(
  "metricSpec active_loans + ytd → warning",
  specWarnings.length > 0,
  specWarnings[0]?.slice(0, 80),
);

const composed = composeMetricSql({ metricIds: ["active_loans"], window: "last_90_days" });
check(
  "composer labels snapshot window",
  composed.windowLabel === "snapshot (as of today)",
  composed.windowLabel,
);
check(
  "composer emits snapshot warning",
  composed.warnings.some((w) => /snapshot/i.test(w)),
);

console.log("\n4) Navigation catalog coverage\n");
const ids = NAVIGATION_TARGETS.map((t) => t.id);
for (const id of [
  "sales-scorecard",
  "operations-scorecard",
  "top-tiering-comparison",
  "high-performers",
]) {
  check(`catalog has ${id}`, ids.includes(id));
}

console.log("\n=== Summary ===\n");
const failed = results.filter((r) => !r.pass);
console.log(`${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) {
  console.log("\nFailed:");
  for (const f of failed) console.log(`  - ${f.label}${f.detail ? `: ${f.detail}` : ""}`);
  process.exit(1);
}
console.log("\nAll manual QA checks passed.\n");
