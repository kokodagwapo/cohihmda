/**
 * Shared workbench user-intent detection (browser + server).
 * Single source of truth for prompt classification regexes.
 */

function combinePromptTexts(
  ...texts: Array<string | undefined | null>
): string {
  return texts
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    .join("\n")
    .toLowerCase();
}

/** Data question on a populated canvas — should not spawn new widgets. */
export function isAnalyticalOnlyRequest(
  ...texts: Array<string | undefined | null>
): boolean {
  const combined = combinePromptTexts(...texts);
  if (
    /\b(add|create|build|remove|delete|rename|switch|change|convert)\b/.test(
      combined,
    )
  ) {
    return false;
  }
  return /\b(why|how come|what (is|are|driving)?|explain|compare|break down|driving|lower|higher|trend|cause|lower than|higher than)\b/.test(
    combined,
  );
}

/** Client alias — single-turn analytical question. */
export function isAnalyticalWorkbenchQuestion(question: string): boolean {
  return isAnalyticalOnlyRequest(question);
}

export function isRemoveWidgetOnlyRequest(
  ...texts: Array<string | undefined | null>
): boolean {
  const combined = combinePromptTexts(...texts);
  if (!/\b(remove|delete)\b/.test(combined)) return false;
  if (
    /\b(add|re-?add|restore|bring back|put back|create|build)\b/.test(combined)
  ) {
    return false;
  }
  return true;
}

/** Client alias — single-turn remove-only question. */
export function isRemoveWidgetOnlyQuestion(question: string): boolean {
  return isRemoveWidgetOnlyRequest(question);
}

export function isPeriodSwitchOnlyRequest(
  ...texts: Array<string | undefined | null>
): boolean {
  const combined = combinePromptTexts(...texts);
  if (!/\b(switch|change|convert|set)\b/.test(combined)) return false;
  if (/\b(add|create|new widget|another)\b/.test(combined)) return false;
  return /\b(ytd|mtd|year|month|period|dashboard|group|filters?|l12m|l6m|py|prior year)\b/.test(
    combined,
  );
}

export function isChartTypeChangeRequest(
  ...texts: Array<string | undefined | null>
): boolean {
  const combined = combinePromptTexts(...texts);
  return /\b(bar chart|line chart|pie chart|chart type|convert.*(to|into).*(bar|line|pie|chart)|change.*(to|into).*(bar|line|pie)|kpi to|from kpi)\b/.test(
    combined,
  );
}

export function isAllTimeRequest(
  ...texts: Array<string | undefined | null>
): boolean {
  const combined = combinePromptTexts(...texts);
  return (
    /\b(all[- ]?time|since inception|lifetime|no (date )?filter)\b/.test(
      combined,
    ) ||
    /\ball[- ]?time\b.*\b(funded|loans|count|total|volume|units)\b/.test(
      combined,
    ) ||
    /\b(total|lifetime)\b.*\b(funded|loans)\b/.test(combined)
  );
}

export function isRestoreWidgetRequest(
  ...texts: Array<string | undefined | null>
): boolean {
  const combined = combinePromptTexts(...texts);
  return /\b(add|re-?add|restore|bring back|put back)\b/.test(combined);
}

/** Extract widget noun phrase from "remove/delete the X widget". */
export function extractRemoveWidgetPhrase(userQuestion: string): string {
  const m = userQuestion.match(
    /\b(?:remove|delete)\s+(?:the\s+)?(.+?)(?:\s+widget|\s+from|\s+off|\s+on|\s+please|$)/i,
  );
  return (m?.[1] ?? "").trim();
}
