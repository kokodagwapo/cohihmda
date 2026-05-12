/**
 * Deterministic navigation answers for Cohi Chat ("where can I track…").
 * Keeps links aligned with product routes; paths are sanitized via sanitizeNavigationHints.
 */

import {
  NAVIGATION_TARGETS,
  getNavigationTargetById,
  type NavigationTarget,
} from "./navigationTargetCatalog.js";

/** Minimal shape for conversation history (avoids circular import with cohiChatService). */
export interface NavigationHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface NavigationResolveResult {
  message: string;
  hints: { label: string; path: string }[];
  suggestedQuestions?: string[];
}

function buildResearchSuggestion(question: string): string {
  const cleaned = question.replace(/\?+$/g, "").trim();
  return cleaned
    ? `Open Research Lab: ${cleaned}`
    : "Open Research Lab for deeper analysis";
}

function withResearchSuggestion(
  question: string,
  suggestions: string[],
): string[] {
  const research = buildResearchSuggestion(question);
  if (suggestions.some((s) => s.toLowerCase().includes("research lab"))) {
    return suggestions;
  }
  return [...suggestions, research];
}

const NAV_CONCEPT_KEYWORDS = {
  pullThrough: ["pull through", "pullthrough", "pull thru", "pullthru"],
  lock: ["lock", "locks", "rate lock", "lock stratification", "lock stage"],
  workflowConversion: ["workflow conversion", "conversion funnel"],
  productionTrends: ["production trend", "production trends"],
  leaderboard: ["leaderboard", "ranking", "rankings"],
  fallout: ["fallout", "withdrawn", "withdrawal"],
  pipeline: ["pipeline"],
  dashboard: ["dashboard", "dashboards", "report", "reports", "insight", "insights", "page", "pages"],
} as const;

function normalizeNavText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeNavText(input: string): string[] {
  return normalizeNavText(input).split(" ").filter(Boolean);
}

function levenshteinDistance(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    Array(b.length + 1).fill(0),
  );
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[a.length][b.length];
}

function fuzzyTokenEquals(token: string, target: string): boolean {
  if (token === target) return true;
  // Keep short-token matching strict to avoid false positives like "to" ~= "go",
  // while still allowing dropped-last-letter typos (e.g. "se" for "see").
  if (token.length <= 2 || target.length <= 2) {
    const shorter = token.length < target.length ? token : target;
    const longer = token.length < target.length ? target : token;
    return (
      longer.length - shorter.length === 1 &&
      longer.startsWith(shorter) &&
      longer[0] === shorter[0]
    );
  }
  const lenDelta = Math.abs(token.length - target.length);
  if (lenDelta > 2) return false;
  const maxDistance = target.length >= 8 ? 2 : 1;
  return levenshteinDistance(token, target) <= maxDistance;
}

function hasApproxToken(tokens: string[], candidates: readonly string[]): boolean {
  for (const token of tokens) {
    for (const c of candidates) {
      if (fuzzyTokenEquals(token, c)) return true;
    }
  }
  return false;
}

function hasConcept(input: string, aliases: readonly string[]): boolean {
  const normalized = normalizeNavText(input);
  if (!normalized) return false;
  const normalizedCompact = normalized.replace(/\s+/g, "");
  const tokens = tokenizeNavText(normalized);

  for (const alias of aliases) {
    const aliasNorm = normalizeNavText(alias);
    const aliasCompact = aliasNorm.replace(/\s+/g, "");

    // Direct / compact substring first (fast path)
    if (normalized.includes(aliasNorm) || normalizedCompact.includes(aliasCompact)) {
      return true;
    }

    const aliasTokens = aliasNorm.split(" ").filter(Boolean);
    if (aliasTokens.length === 1) {
      if (hasApproxToken(tokens, aliasTokens)) return true;
      continue;
    }

    // Multi-token approximate match (contiguous window)
    const win = aliasTokens.length;
    for (let i = 0; i <= tokens.length - win; i++) {
      let allMatch = true;
      for (let j = 0; j < win; j++) {
        if (!fuzzyTokenEquals(tokens[i + j], aliasTokens[j])) {
          allMatch = false;
          break;
        }
      }
      if (allMatch) return true;
    }
  }

  return false;
}

function scoreTargetMatch(input: string, target: NavigationTarget): number {
  let score = 0;
  if (hasConcept(input, [target.label])) score += 8;
  for (const kw of target.keywords) {
    if (hasConcept(input, [kw])) score += 4;
  }
  return score;
}

function resolveTargetsById(ids: readonly string[]): NavigationTarget[] {
  const out: NavigationTarget[] = [];
  for (const id of ids) {
    const t = getNavigationTargetById(id);
    if (t) out.push(t);
  }
  return out;
}

function buildHintsFromTargets(targets: NavigationTarget[]): { label: string; path: string }[] {
  return targets
    .filter((t): t is NavigationTarget & { path: string } => t.kind === "route" && !!t.path)
    .map((t) => ({ label: t.label, path: t.path }));
}

/**
 * Tolerant pull-through detector for navigation routing.
 * Handles whitespace/hyphen variants and common typo forms.
 */
export function hasPullThroughKeyword(input: string): boolean {
  return hasConcept(input, NAV_CONCEPT_KEYWORDS.pullThrough);
}

/** Broad guidance (how to use Cohi) — not location/navigation. */
export function isCohiGuidanceIntent(question: string): boolean {
  const t = question.trim().toLowerCase();
  if (/^help\s*[?.!]*$/i.test(t)) return true;
  if (/^(what can you do|who are you|how do you work)\b/i.test(t)) return true;
  return (
    /\bhow (do|can) i use cohi\b/.test(t) ||
    /\btips for using cohi\b/.test(t) ||
    /\bwhat can i ask cohi\b/.test(t) ||
    /\bhow does cohi work\b/.test(t) ||
    /\bhow to use cohi\b/.test(t)
  );
}

/** User wants to know which page/dashboard to open (not necessarily portfolio numbers). */
export function isNavigationIntent(question: string): boolean {
  const t = question.trim().toLowerCase();
  if (isCohiGuidanceIntent(question)) return false;
  if (
    /\b(where|which)\s+(can|do)\s+i\s+(track|find|see|view|go|open|access|get)\b/.test(
      t,
    )
  ) {
    return true;
  }
  if (/\b(which|what)\s+(dashboard|page|report)\b/.test(t)) return true;
  if (/\bhow\s+do\s+i\s+(open|find|get\s+to|navigate\s+to)\b/.test(t))
    return true;
  if (/\bgive\s+me\s+(a\s+)?(page|link)\b/.test(t)) return true;
  if (/\b(link|url)\s+to\b/.test(t)) return true;

  // Fuzzy fallback for typo-heavy prompts:
  // e.g. "wher can i se dashbord for pullthough"
  const tokens = tokenizeNavText(t);
  const asksWhereLike = hasApproxToken(tokens, ["where", "which", "what", "how"]);
  const navVerbLike = hasApproxToken(tokens, [
    "track",
    "find",
    "see",
    "view",
    "open",
    "access",
    "navigate",
    "go",
    "get",
  ]);
  const navObjectLike =
    hasConcept(t, NAV_CONCEPT_KEYWORDS.dashboard) ||
    hasApproxToken(tokens, ["link", "url", "page"]);

  if ((asksWhereLike && navVerbLike) || (navVerbLike && navObjectLike)) return true;
  return false;
}

/**
 * Map short follow-ups ("yes give me a page") to the prior user question that established topic.
 */
export function expandEffectiveQuestionForNavigation(
  question: string,
  history: NavigationHistoryMessage[],
): string {
  const ql = question.trim().toLowerCase();
  const looksLikeFollowUp =
    /^(yes|yeah|yep|please|ok|okay|sure)\b/.test(ql) ||
    /\b(give me|show me)\s+(the\s+)?(page|link)\b/.test(ql) ||
    /^(which page|what page|the page)\b/.test(ql) ||
    (/\b(page|link)\b/.test(ql) && ql.length < 80);

  if (!looksLikeFollowUp || !history.length) return question.trim();

  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.role !== "user") continue;
    const c = m.content.trim();
    if (isNavigationIntent(c)) return c;
    if (
      hasPullThroughKeyword(c) ||
      hasConcept(c, NAV_CONCEPT_KEYWORDS.fallout) ||
      hasConcept(c, NAV_CONCEPT_KEYWORDS.pipeline) ||
      hasConcept(c, NAV_CONCEPT_KEYWORDS.dashboard) ||
      hasConcept(c, NAV_CONCEPT_KEYWORDS.leaderboard) ||
      hasConcept(c, NAV_CONCEPT_KEYWORDS.lock) ||
      hasConcept(c, NAV_CONCEPT_KEYWORDS.workflowConversion) ||
      hasConcept(c, NAV_CONCEPT_KEYWORDS.productionTrends)
    ) {
      return c;
    }
  }
  return question.trim();
}

export function buildGuidanceResponse(): NavigationResolveResult {
  const helpTargets = resolveTargetsById([
    "help-what-you-can-ask",
    "help-example-queries",
    "help-chat-workbench",
    "insights",
    "workbench",
  ]);
  return {
    message: [
      "**Using Cohi**",
      "",
      "- Ask **data questions** with a time range (e.g. last 30 days, this quarter).",
      "- Ask **where to find** a metric or report — Cohi can link you to the right dashboard.",
      "- Use **Workbench** to build custom canvases; **Insights** for the standard dashboard library.",
      "",
      "Help articles below go deeper on prompts and examples.",
    ].join("\n"),
    hints: buildHintsFromTargets(helpTargets),
    suggestedQuestions: [
      "Where can I track company pull-through?",
      "Show funded volume by branch last month",
      "Open help for example queries",
      "Open Research Lab for deeper analysis",
    ],
  };
}

/**
 * Return a deterministic navigation answer or null to fall through to RAG/SQL flow.
 */
export function resolveNavigationAnswer(
  question: string,
): NavigationResolveResult | null {
  const q = question.trim().toLowerCase();
  if (!q) return null;

  const lockContext = hasConcept(q, NAV_CONCEPT_KEYWORDS.lock);
  const pullContext = hasPullThroughKeyword(q);

  if (pullContext && lockContext) {
    const targets = resolveTargetsById([
      "lock-stratification",
      "company-scorecard",
      "insights",
    ]);
    return {
      message:
        "For **pull-through in a lock/pipeline-stage context**, start with **Lock Stratification**. For company-level conversion views, use **Company Scorecard**.",
      hints: buildHintsFromTargets(targets),
      suggestedQuestions: withResearchSuggestion(question, [
        "Show pull-through vs fallout by stage",
        "Where can I see lock expiration risk?",
      ]),
    };
  }
  if (pullContext) {
    const targets = resolveTargetsById([
      "company-scorecard",
      "business-overview",
      "lock-stratification",
      "insights",
    ]);
    return {
      message:
        "For company pull-through performance, start with **Company Scorecard**; **Business Overview** is useful for executive KPIs. Use **Lock Stratification** for stage-specific pull-through.",
      hints: buildHintsFromTargets(targets),
      suggestedQuestions: withResearchSuggestion(question, [
        "Show my company pull-through trend for the last 90 days",
        "Compare pull-through by branch this quarter",
      ]),
    };
  }

  if (isNavigationIntent(q)) {
    const scored = NAVIGATION_TARGETS.map((target) => ({
      target,
      score: scoreTargetMatch(q, target),
    }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .map((x) => x.target);

    if (scored.length > 0) {
      const top = scored[0];
      return {
        message: `Best match: **${top.label}**. You can also open the related dashboards below.`,
        hints: buildHintsFromTargets(scored),
        suggestedQuestions: withResearchSuggestion(question, [
          `Show ${top.label.toLowerCase()} metrics for the last 90 days`,
          "Compare this quarter vs last quarter performance",
        ]),
      };
    }

    return {
      message:
        "Your **Insights** hub lists core dashboards. **Workbench** is for custom canvases you build.",
      hints: buildHintsFromTargets(resolveTargetsById(["insights", "workbench"])),
      suggestedQuestions: withResearchSuggestion(question, [
        "Which dashboards cover pull-through?",
        "How do I build a canvas in Workbench?",
      ]),
    };
  }

  return null;
}
