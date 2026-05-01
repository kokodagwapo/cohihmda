import { DATA_QUALITY_TESTS, type DataQualityTest } from "../dataQuality/dataQualityTests.js";
import type { InsightFinding } from "./agents/insightInvestigatorAgent.js";
import { isSqlEvidenceItem } from "../research/agents/dataAnalystAgent.js";

export interface DataQualityMatcherInput {
  finding?: InsightFinding;
  issueSummary?: string;
}

export interface DataQualityMatcherResult {
  matchedTestIds: string[];
  matchedBy: Record<string, string[]>;
  cohortHints: Array<"active" | "originated">;
}

export interface DataQualityPrefilterResult {
  candidateTestIds: string[];
  matchedBy: Record<string, string[]>;
  cohortHints: Array<"active" | "originated">;
}

function humanizeField(field: string): string {
  return field.replace(/_/g, " ").trim().toLowerCase();
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1);
}

function detectCohortHints(text: string): Set<"active" | "originated"> {
  const hints = new Set<"active" | "originated">();
  const t = text.toLowerCase();
  if (/\bactive\b/.test(t)) hints.add("active");
  if (/\boriginated\b|\bfunded\b|\bpurchased\b/.test(t)) hints.add("originated");
  return hints;
}

function sqlHasActiveGate(sqlLower: string): boolean {
  return (
    sqlLower.includes("current_loan_status = 'active loan'") ||
    sqlLower.includes("current_loan_status ilike '%active%'")
  );
}

function sqlHasOriginatedGate(sqlLower: string): boolean {
  return (
    sqlLower.includes("%originated%") ||
    sqlLower.includes("%funded%") ||
    sqlLower.includes("%purchased%")
  );
}

function cohortCompatible(test: DataQualityTest, hints: Set<"active" | "originated">): boolean {
  if (hints.size === 0) return true;
  const sql = test.sqlCondition.toLowerCase();
  const hasActive = sqlHasActiveGate(sql);
  const hasOriginated = sqlHasOriginatedGate(sql);
  if (!hasActive && !hasOriginated) return true;
  if (hints.has("active") && !hasActive && hasOriginated) return false;
  if (hints.has("originated") && !hasOriginated && hasActive) return false;
  return true;
}

function inferIssueKindHints(text: string): Set<"missing" | "range" | "sequence" | "status"> {
  const t = text.toLowerCase();
  const out = new Set<"missing" | "range" | "sequence" | "status">();
  if (/\bmissing\b|\bnull\b|\bblank\b|\black\b|\bnot populated\b/.test(t)) out.add("missing");
  if (/\bout of range\b|\bover\b|\bunder\b|\bexceeds\b|\babove\b|\bbelow\b/.test(t)) out.add("range");
  if (/\bbefore\b|\bafter\b|\bfuture\b|\bpast\b|\bsequence\b/.test(t)) out.add("sequence");
  if (/\bstatus\b|\bactive loan\b|\bfunded\b|\boriginated\b|\bwithdrawn\b|\bdenied\b/.test(t)) out.add("status");
  return out;
}

function inferTestKind(test: DataQualityTest): Set<"missing" | "range" | "sequence" | "status"> {
  const out = new Set<"missing" | "range" | "sequence" | "status">();
  const sql = test.sqlCondition.toLowerCase();
  const name = test.name.toLowerCase();
  if (sql.includes(" is null") || sql.includes("trim(")) out.add("missing");
  if (sql.includes(" < ") || sql.includes(" > ") || name.includes("out of range")) out.add("range");
  if (name.includes("before") || name.includes("future")) out.add("sequence");
  if (test.group === "Status Tests" || name.includes("status")) out.add("status");
  return out;
}

function conditionKindCompatible(test: DataQualityTest, issueKinds: Set<"missing" | "range" | "sequence" | "status">): boolean {
  if (issueKinds.size === 0) return true;
  const testKinds = inferTestKind(test);
  for (const kind of issueKinds) {
    if (testKinds.has(kind)) return true;
  }
  return false;
}

function fieldMentioned(test: DataQualityTest, textLower: string, tokenSet: Set<string>): boolean {
  const field = test.field.toLowerCase();
  if (textLower.includes(field)) return true;

  const human = humanizeField(test.field);
  if (human && textLower.includes(human)) return true;

  const parts = field.split("_").filter((p) => p.length > 2);
  if (parts.length > 0 && parts.every((p) => tokenSet.has(p))) return true;
  return false;
}

function candidateScore(
  test: DataQualityTest,
  textLower: string,
  tokenSet: Set<string>,
  issueKinds: Set<"missing" | "range" | "sequence" | "status">,
  cohortHints: Set<"active" | "originated">,
  matchedBy: string[]
): number {
  if (!cohortCompatible(test, cohortHints)) return 0;
  if (!conditionKindCompatible(test, issueKinds)) return 0;

  let score = 0;
  if (textLower.includes(test.id.toLowerCase())) {
    score += 100;
    matchedBy.push("id");
  }
  if (fieldMentioned(test, textLower, tokenSet)) {
    score += 10;
    matchedBy.push("field");
  }

  const nameTokens = tokenize(test.name).filter((t) => !["hmda", "trid", "loan", "missing", "date"].includes(t));
  const descTokens = tokenize(test.description).filter((t) => t.length >= 4);
  const keywordHits = [...new Set([...nameTokens.slice(0, 4), ...descTokens.slice(0, 4)])].filter((tok) =>
    tokenSet.has(tok)
  );
  if (keywordHits.length >= 2) {
    score += 6;
    matchedBy.push("keywords");
  }
  return score;
}

export function matchInsightToDataQualityTests(input: DataQualityMatcherInput): DataQualityMatcherResult {
  const text = [
    input.issueSummary ?? "",
    input.finding?.title ?? "",
    input.finding?.summary ?? "",
    ...Object.keys(input.finding?.keyMetrics || {}),
    ...(input.finding?.evidence || []).map((e) =>
      `${e.explanation || ""} ${isSqlEvidenceItem(e) ? e.sql || "" : ""}`,
    ),
  ]
    .join(" ")
    .trim();

  const textLower = text.toLowerCase();
  const tokenSet = new Set(tokenize(textLower));
  const cohortHints = detectCohortHints(textLower);
  const issueKinds = inferIssueKindHints(textLower);

  const scored: Array<{ id: string; score: number; matchedBy: string[] }> = [];
  for (const test of DATA_QUALITY_TESTS) {
    const matchedBy: string[] = [];
    const score = candidateScore(test, textLower, tokenSet, issueKinds, cohortHints, matchedBy);
    if (score > 0) scored.push({ id: test.id, score, matchedBy });
  }

  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const top = scored.filter((s) => s.score >= 10).slice(0, 3);

  return {
    matchedTestIds: top.map((s) => s.id),
    matchedBy: Object.fromEntries(top.map((s) => [s.id, s.matchedBy])),
    cohortHints: [...cohortHints],
  };
}

export function prefilterDataQualityTests(input: DataQualityMatcherInput): DataQualityPrefilterResult {
  const base = matchInsightToDataQualityTests(input);
  return {
    candidateTestIds: base.matchedTestIds,
    matchedBy: base.matchedBy,
    cohortHints: base.cohortHints,
  };
}

function hasPositiveCompletenessSignal(text: string, field: string): boolean {
  const f = field.replace(/_/g, "[ _-]?");
  const pattern = new RegExp(
    `(${f}).{0,40}(100\\s*%\\s*populated|0\\s*%\\s*missing|no\\s+missing|fully\\s+populated)|` +
      `(100\\s*%\\s*populated|0\\s*%\\s*missing|no\\s+missing|fully\\s+populated).{0,40}(${f})`,
    "i"
  );
  return pattern.test(text);
}

function findingText(input: DataQualityMatcherInput): string {
  return `${input.issueSummary ?? ""} ${input.finding?.title ?? ""} ${input.finding?.summary ?? ""}`.toLowerCase();
}

function inferInsightFocusTokens(input: DataQualityMatcherInput): Set<string> {
  const tokens = new Set<string>();
  for (const t of tokenize(`${input.finding?.title ?? ""} ${Object.keys(input.finding?.keyMetrics || {}).join(" ")}`)) {
    if (t.length > 2) tokens.add(t);
  }
  return tokens;
}

export function rankRelevantVerifiedTests(
  input: DataQualityMatcherInput,
  verifiedTestIds: string[]
): DataQualityMatcherResult {
  const text = findingText(input);
  const focusTokens = inferInsightFocusTokens(input);
  const ranked: Array<{ id: string; score: number; matchedBy: string[] }> = [];

  for (const id of verifiedTestIds) {
    const test = DATA_QUALITY_TESTS.find((t) => t.id === id);
    if (!test) continue;
    const matchedBy: string[] = [];
    if (hasPositiveCompletenessSignal(text, test.field)) {
      matchedBy.push("contradicted_by_text");
      continue;
    }

    let score = 1;
    if (text.includes(test.field.toLowerCase())) {
      score += 4;
      matchedBy.push("field");
    }
    if (text.includes(test.group.toLowerCase().replace(" tests", ""))) {
      score += 2;
      matchedBy.push("group");
    }
    const nameTokens = tokenize(test.name);
    const overlap = nameTokens.filter((t) => focusTokens.has(t));
    if (overlap.length > 0) {
      score += overlap.length;
      matchedBy.push("focus_overlap");
    }
    ranked.push({ id, score, matchedBy });
  }

  ranked.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const kept = ranked.slice(0, 3);
  return {
    matchedTestIds: kept.map((r) => r.id),
    matchedBy: Object.fromEntries(kept.map((r) => [r.id, r.matchedBy])),
    cohortHints: [...detectCohortHints(text)],
  };
}
