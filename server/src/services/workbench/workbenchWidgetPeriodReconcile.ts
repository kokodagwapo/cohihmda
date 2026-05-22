/**
 * Reconcile LLM workbench widget titles and filterConfig with explicit time scope.
 * Prevents "Funded Units MTD" titles while group/canvas filters run YTD or all-time.
 */

export type WorkbenchLlmPreset =
  | "L12M"
  | "L6M"
  | "L3M"
  | "YTD"
  | "MTD"
  | "CY"
  | "PY"
  | null;

export interface WidgetFilterConfigLike {
  filterable?: boolean;
  dateColumn?: string;
  defaultPreset?: string | null;
}

export interface CreateWidgetActionLike {
  type: string;
  title?: string;
  filterConfig?: WidgetFilterConfigLike;
  sql?: string;
}

const PERIOD_TOKEN_IN_TITLE =
  /\b(?:MTD|YTD|QTD|L13M|L12M|L6M|L3M|LM|LQ|LY|CY|PY|month[- ]to[- ]date|year[- ]to[- ]date|quarter[- ]to[- ]date)\b/gi;

const TITLE_TOKEN_TO_PRESET: Array<{ pattern: RegExp; preset: WorkbenchLlmPreset }> = [
  { pattern: /\bMTD\b/i, preset: "MTD" },
  { pattern: /\bmonth[- ]to[- ]date\b/i, preset: "MTD" },
  { pattern: /\bYTD\b/i, preset: "YTD" },
  { pattern: /\byear[- ]to[- ]date\b/i, preset: "YTD" },
  { pattern: /\bQTD\b/i, preset: "YTD" },
  { pattern: /\bL13M\b/i, preset: "L12M" },
  { pattern: /\bL12M\b/i, preset: "L12M" },
  { pattern: /\bL6M\b/i, preset: "L6M" },
  { pattern: /\bL3M\b/i, preset: "L3M" },
  { pattern: /\bCY\b/i, preset: "CY" },
  { pattern: /\bPY\b/i, preset: "PY" },
  { pattern: /\bLY\b/i, preset: "PY" },
  { pattern: /\bLM\b/i, preset: "PY" },
];

/** Parse explicit period intent from user + recent history (newest first). */
export function parseRequestedPeriodFromText(
  ...texts: Array<string | undefined | null>
): WorkbenchLlmPreset {
  const combined = texts
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    .join("\n")
    .toLowerCase();

  if (!combined.trim()) return null;

  if (/\b(this month|month to date|mtd|current month|board.*this month)\b/.test(combined)) {
    return "MTD";
  }
  if (/\b(this quarter|quarter to date|qtd|current quarter)\b/.test(combined)) {
    return "YTD";
  }
  if (/\b(this year|year to date|ytd|current year)\b/.test(combined)) {
    return "YTD";
  }
  if (/\b(last year|prior year|py|previous year)\b/.test(combined)) {
    return "PY";
  }
  if (/\b(last 13 months|l13m|rolling 13)\b/.test(combined)) {
    return "L12M";
  }
  if (/\b(last 12 months|l12m|rolling 12|past year)\b/.test(combined)) {
    return "L12M";
  }
  if (/\b(last 6 months|l6m)\b/.test(combined)) {
    return "L6M";
  }
  if (/\b(last 3 months|l3m|last 90 days)\b/.test(combined)) {
    return "L3M";
  }
  if (/\b(all time|since inception|lifetime|no time)\b/.test(combined)) {
    return null;
  }

  return null;
}

function presetFromTitle(title: string): WorkbenchLlmPreset {
  for (const { pattern, preset } of TITLE_TOKEN_TO_PRESET) {
    if (pattern.test(title)) return preset;
  }
  return null;
}

function stripPeriodTokensFromTitle(title: string): string {
  const cleaned = title
    .replace(PERIOD_TOKEN_IN_TITLE, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .trim();
  return cleaned.replace(/[-–—]\s*$/g, "").trim();
}

function ensureFilterConfig(action: CreateWidgetActionLike): WidgetFilterConfigLike {
  if (!action.filterConfig) {
    action.filterConfig = { filterable: true, dateColumn: "application_date" };
  }
  return action.filterConfig;
}

/**
 * Align create_widget / nested cohi widgets with requested period and title hygiene.
 */
export function reconcileWidgetActionPeriods(
  actions: unknown[],
  options?: { requestedPeriod?: WorkbenchLlmPreset; userQuestion?: string },
): void {
  const requested =
    options?.requestedPeriod ??
    parseRequestedPeriodFromText(options?.userQuestion);

  for (const raw of actions) {
    if (!raw || typeof raw !== "object") continue;
    const action = raw as CreateWidgetActionLike & {
      groups?: Array<{ widgets?: unknown[] }>;
      standaloneWidgets?: unknown[];
    };

    if (action.type === "create_widget") {
      reconcileOneCreateWidget(action, requested);
      continue;
    }

    if (action.type === "create_dashboard") {
      const nested: CreateWidgetActionLike[] = [];
      for (const g of action.groups ?? []) {
        for (const w of g.widgets ?? []) {
          if (w && typeof w === "object" && (w as { kind?: string }).kind === "cohi") {
            nested.push(w as CreateWidgetActionLike);
          }
        }
      }
      for (const w of action.standaloneWidgets ?? []) {
        if (w && typeof w === "object" && (w as { kind?: string }).kind === "cohi") {
          nested.push(w as CreateWidgetActionLike);
        }
      }
      for (const w of nested) {
        reconcileCohiDashboardWidget(w, requested);
      }
    }
  }
}

function reconcileOneCreateWidget(
  action: CreateWidgetActionLike,
  requested: WorkbenchLlmPreset,
): void {
  const title = String(action.title ?? "").trim();
  const fromTitle = title ? presetFromTitle(title) : null;
  const implied = fromTitle ?? requested;

  if (title) {
    const stripped = stripPeriodTokensFromTitle(title);
    if (stripped) action.title = stripped;
  }

  if (!implied) return;

  const fc = ensureFilterConfig(action);
  if (!fc.defaultPreset) fc.defaultPreset = implied;
  if (fc.filterable === false && implied) {
    fc.filterable = true;
  }
}

function reconcileCohiDashboardWidget(
  widget: CreateWidgetActionLike & { filterConfig?: WidgetFilterConfigLike; title?: string },
  requested: WorkbenchLlmPreset,
): void {
  const title = String(widget.title ?? "").trim();
  const fromTitle = title ? presetFromTitle(title) : null;
  const implied = fromTitle ?? requested;

  if (title) {
    const stripped = stripPeriodTokensFromTitle(title);
    if (stripped) widget.title = stripped;
  }

  if (!implied) return;

  const fc = ensureFilterConfig(widget);
  if (!fc.defaultPreset) fc.defaultPreset = implied;
  if (fc.filterable === false && implied) {
    fc.filterable = true;
  }
}
