/**
 * Build compact carry-over summaries when forking chat type or canvas handoff.
 */

import type { UnifiedChatType } from "@/lib/unifiedChatClient";
import type {
  InsightBuilderDraftPreview,
  InsightBuilderPhase,
} from "@/lib/unifiedChatEnvelope";
import type { Finding, ResearchReport } from "@/hooks/useResearchSession";
import type { WidgetAction } from "@/types/widgetActions";

export interface ChatMessageForCarryOver {
  role: "user" | "assistant";
  content: string;
  insightBuilderDraft?: InsightBuilderDraftPreview;
  insightBuilderPhase?: InsightBuilderPhase;
  workbenchActions?: WidgetAction[];
}

export interface CarryOverContext {
  fromConversationId: string;
  fromChatType: UnifiedChatType;
  fromTitle?: string;
  summary: string;
}

export interface BuildCarryOverOptions {
  fromChatType?: UnifiedChatType;
  maxChars?: number;
  researchReport?: ResearchReport | null;
  researchFindings?: Finding[];
}

const DEFAULT_MAX_CHARS = 1600;
const BASE_DIALOGUE_CAP = 500;
const STRUCTURED_SECTION_CAP = 500;
const RESEARCH_SECTION_CAP = 400;

function normalizeWhitespace(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function truncate(text: string, max: number): string {
  const t = normalizeWhitespace(text);
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function buildBaseDialogue(messages: ChatMessageForCarryOver[]): string {
  const userTurns = messages.filter((m) => m.role === "user" && m.content.trim());
  const lastUsers = userTurns.slice(-2);
  const lastAssistant = [...messages]
    .reverse()
    .find((m) => m.role === "assistant" && m.content.trim());

  const parts: string[] = [];
  if (lastUsers.length > 0) {
    parts.push("Recent user messages:");
    for (const u of lastUsers) {
      parts.push(`- ${normalizeWhitespace(u.content)}`);
    }
  }
  if (lastAssistant) {
    parts.push(
      `Latest assistant reply: ${truncate(lastAssistant.content, 400)}`,
    );
  }
  return truncate(parts.join("\n"), BASE_DIALOGUE_CAP);
}

function appendInsightBuilderSection(
  messages: ChatMessageForCarryOver[],
): string | null {
  const lastWithDraft = [...messages]
    .reverse()
    .find((m) => m.role === "assistant" && m.insightBuilderDraft);
  const draft = lastWithDraft?.insightBuilderDraft;
  if (!draft?.title?.trim() || !draft.prompt_text?.trim()) return null;

  const lines = [
    "Insight builder draft:",
    `- Title: ${draft.title.trim()}`,
    `- Prompt: ${truncate(draft.prompt_text, 280)}`,
    `- Schedule: ${draft.schedule}`,
  ];
  if (draft.prompt_tag?.trim()) {
    lines.push(`- Tag: ${draft.prompt_tag.trim()}`);
  }
  const phase = lastWithDraft?.insightBuilderPhase;
  if (phase) {
    lines.push(`- Phase: ${phase}`);
  }
  const specKeys = Object.keys(draft.specifiers ?? {}).filter(
    (k) => !k.startsWith("_"),
  );
  if (specKeys.length > 0) {
    try {
      const compact = JSON.stringify(draft.specifiers);
      lines.push(`- Specifiers: ${truncate(compact, 180)}`);
    } catch {
      /* ignore */
    }
  }
  return truncate(lines.join("\n"), STRUCTURED_SECTION_CAP);
}

function summarizeWorkbenchActions(actions: WidgetAction[] | undefined): string | null {
  if (!actions?.length) return null;
  const applied = actions.filter(
    (a) =>
      a.type === "create_widget" ||
      a.type === "modify_widget" ||
      a.type === "modify_group" ||
      a.type === "add_existing_widget",
  );
  if (!applied.length) return null;

  const creates = applied.filter((a) => a.type === "create_widget");
  if (creates.length > 0) {
    return creates.length === 1
      ? "Applied 1 widget to canvas"
      : `Applied ${creates.length} widgets to canvas`;
  }
  const widgetMods = applied.filter((a) => a.type === "modify_widget").length;
  if (widgetMods > 0) {
    return widgetMods === 1
      ? "Updated dashboard widget"
      : `Updated ${widgetMods} dashboard widgets`;
  }
  return "Updated dashboard";
}

function appendWorkbenchSection(messages: ChatMessageForCarryOver[]): string | null {
  const assistants = [...messages]
    .reverse()
    .filter((m) => m.role === "assistant" && m.workbenchActions?.length)
    .slice(0, 2);

  const createLines: string[] = [];
  for (const m of assistants) {
    for (const a of m.workbenchActions ?? []) {
      if (a.type === "create_widget") {
        createLines.push(
          `- Widget: ${a.title} — ${truncate(a.explanation || "", 120)}`,
        );
      }
    }
  }
  if (createLines.length > 0) {
    return truncate(
      ["Workbench widgets created:", ...createLines].join("\n"),
      STRUCTURED_SECTION_CAP,
    );
  }

  for (const m of assistants) {
    const desc = summarizeWorkbenchActions(m.workbenchActions);
    if (desc) {
      return truncate(`Workbench changes: ${desc}`, STRUCTURED_SECTION_CAP);
    }
  }
  return null;
}

function appendResearchSection(
  report: ResearchReport | null | undefined,
  findings: Finding[] | undefined,
): string | null {
  if (report) {
    const lines = ["Research report:"];
    if (report.directAnswer?.trim()) {
      lines.push(`- Direct answer: ${truncate(report.directAnswer, 200)}`);
    }
    if (report.executiveSummary?.trim()) {
      lines.push(`- Executive summary: ${truncate(report.executiveSummary, 280)}`);
    }
    const insights = report.rankedInsights?.slice(0, 3) ?? [];
    if (insights.length > 0) {
      lines.push("- Top insights:");
      for (const ins of insights) {
        const takeaway = ins.keyTakeaway ? ` — ${ins.keyTakeaway}` : "";
        lines.push(`  - ${ins.headline}${takeaway}`);
      }
    }
    return truncate(lines.join("\n"), RESEARCH_SECTION_CAP);
  }

  const top = findings?.slice(0, 3) ?? [];
  if (top.length > 0) {
    const lines = ["Research findings:"];
    for (const f of top) {
      lines.push(`- ${f.title}: ${truncate(f.summary, 120)}`);
    }
    return truncate(lines.join("\n"), RESEARCH_SECTION_CAP);
  }
  return null;
}

function combineSections(sections: string[], maxChars: number): string {
  const combined = sections.filter(Boolean).join("\n\n").trim();
  if (!combined) return "";
  if (combined.length <= maxChars) return combined;
  return `${combined.slice(0, maxChars - 1)}…`;
}

/**
 * Compact summary of recent turns plus type-specific structured context for a forked chat.
 */
export function buildCarryOverContext(
  messages: ChatMessageForCarryOver[],
  options?: BuildCarryOverOptions,
): string {
  const maxChars = options?.maxChars ?? DEFAULT_MAX_CHARS;
  if (!messages.length) return "";

  const sections: string[] = [];
  const base = buildBaseDialogue(messages);
  if (base) sections.push(base);

  const fromChatType = options?.fromChatType;
  if (fromChatType === "insight_builder") {
    const ib = appendInsightBuilderSection(messages);
    if (ib) sections.push(ib);
  } else if (fromChatType === "workbench") {
    const wb = appendWorkbenchSection(messages);
    if (wb) sections.push(wb);
  } else if (fromChatType === "research") {
    const rs = appendResearchSection(
      options?.researchReport,
      options?.researchFindings,
    );
    if (rs) sections.push(rs);
  }

  return combineSections(sections, maxChars);
}
