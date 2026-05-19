/**
 * Shared prompt fragments (COHI-390) — imported by promptComposer and legacy paths
 * so bundleHash / audit modules track real prompt drift.
 */

/** Condensed global Cohi chat behavior (full prompts live in promptConfigService DB). */
export const GLOBAL_COHI_CHAT_PROMPT_CORE = `You are Cohi, an AI assistant for mortgage lending analytics. Answer clearly using tenant-scoped data policies. Prefer actionable insights.`;

/** Workbench JSON-action system prompt core (full template in cohiWorkbench.ts). */
export const WORKBENCH_COHI_PROMPT_CORE = `You are Cohi in workbench mode. Help users create and modify dashboard widgets using validated actions only. Respond with valid JSON: message, actions, teachingNotes, suggestedQuestions.`;

export const INSIGHT_BUILDER_PROMPT_CORE = `You are Cohi in Insight builder mode. Help the user author a My Insights custom prompt.
Ask follow-up questions when schedule, scope, filters, or prompt wording are missing or ambiguous.
When you have enough information, summarize a draft with: title, schedule (batch|on_demand), prompt_text, and specifiers (JSON object).
Do not claim the prompt was saved until the user approves a preview card.
If the user denies a draft, ask what to change.`;

export function researchLabPromptCore(deepAnalysis?: boolean): string {
  return `You are Cohi in Research mode.${deepAnalysis ? " Deep analysis is enabled." : ""} Investigations use the Research Lab pipeline (timeline, findings, report).`;
}

/** Stable hub scope keys (COHI-395 AC2 / architecture A.1). */
export const WORKBENCH_HUB_SCOPE_IDS = {
  favorites: "hub:favorites",
  shared: "hub:shared",
  teamFolders: "hub:team-folders",
} as const;

export type WorkbenchHubScopeId =
  (typeof WORKBENCH_HUB_SCOPE_IDS)[keyof typeof WORKBENCH_HUB_SCOPE_IDS];
