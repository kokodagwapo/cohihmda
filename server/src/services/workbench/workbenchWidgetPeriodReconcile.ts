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

type MutableGroupOperationLike = {
  op?: string;
  preset?: WorkbenchLlmPreset;
  widgetId?: string;
};

type MutableWorkbenchActionLike = {
  type?: string;
  groupId?: string;
  explanation?: string;
  operations?: MutableGroupOperationLike[];
};

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

  if (
    /\b(this month'?s?|month to date|mtd|current month|board[- ]?ready|monthly performance)\b/.test(
      combined,
    )
  ) {
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
  if (/\b(all[- ]?time|since inception|lifetime|no (date )?filter)\b/.test(combined)) {
    return null;
  }
  if (
    /\b(switch|change|convert|set)\b/.test(combined) &&
    /\b(ytd|year[- ]to[- ]date)\b/.test(combined)
  ) {
    return "YTD";
  }
  if (
    /\b(switch|change|convert|set)\b/.test(combined) &&
    /\b(mtd|month[- ]to[- ]date|this month)\b/.test(combined)
  ) {
    return "MTD";
  }

  return null;
}

export function isAllTimeRequest(
  ...texts: Array<string | undefined | null>
): boolean {
  const combined = texts
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    .join("\n")
    .toLowerCase();
  return /\b(all[- ]?time|since inception|lifetime|no date filter)\b/.test(combined);
}

export function isChartTypeChangeRequest(
  ...texts: Array<string | undefined | null>
): boolean {
  const combined = texts
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    .join("\n")
    .toLowerCase();
  return /\b(bar chart|line chart|pie chart|chart type|convert.*(to|into).*(bar|line|pie|chart)|change.*(to|into).*(bar|line|pie)|kpi to|from kpi)\b/.test(
    combined,
  );
}

export function isPeriodSwitchOnlyRequest(
  ...texts: Array<string | undefined | null>
): boolean {
  const combined = texts
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    .join("\n")
    .toLowerCase();
  if (!/\b(switch|change|convert|set)\b/.test(combined)) return false;
  if (/\b(add|create|new widget|another)\b/.test(combined)) return false;
  return /\b(ytd|mtd|year|month|period|dashboard|group|filters?|l12m|l6m)\b/.test(
    combined,
  );
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
/** True when the canvas has no widgets and the user wants a new scoped executive view. */
export function shouldBuildExecutiveDashboardOnEmptyCanvas(
  question: string,
  totalItems: number | undefined,
  requestedPeriod?: WorkbenchLlmPreset,
): boolean {
  if ((totalItems ?? 0) > 0) return false;
  if (requestedPeriod) return true;
  const q = question.toLowerCase();
  return /\b(board[- ]?ready|executive (dashboard|overview|summary)|monthly performance|fresh dashboard|this month)\b/.test(
    q,
  );
}

export function reconcileWidgetActionPeriods(
  actions: unknown[],
  options?: { requestedPeriod?: WorkbenchLlmPreset; userQuestion?: string },
): void {
  const requested =
    options?.requestedPeriod ??
    parseRequestedPeriodFromText(options?.userQuestion);
  const allTime = isAllTimeRequest(options?.userQuestion);

  for (const raw of actions) {
    if (!raw || typeof raw !== "object") continue;
    const action = raw as CreateWidgetActionLike & {
      groups?: Array<{ widgets?: unknown[] }>;
      standaloneWidgets?: unknown[];
    };

    if (action.type === "create_widget") {
      reconcileOneCreateWidget(action, requested, allTime);
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
        reconcileCohiDashboardWidget(w, requested, allTime);
      }
    }
  }
}

/** Prefer modify_group set_period over recreating widgets when user only changes period. */
export function augmentPeriodSwitchActions(
  actions: unknown[],
  options: {
    userQuestion?: string;
    canvasState?: { totalItems?: number; groups?: Array<{ groupId: string }> };
  },
): void {
  if ((options.canvasState?.totalItems ?? 0) === 0) return;
  if (!isPeriodSwitchOnlyRequest(options.userQuestion)) return;

  const period = parseRequestedPeriodFromText(options.userQuestion);
  if (!period) return;

  const groupId = options.canvasState?.groups?.[0]?.groupId;
  if (!groupId) return;

  const typed = actions as MutableWorkbenchActionLike[];
  if (
    typed.some(
      (a) =>
        a.type === "modify_group" &&
        a.operations?.some((o) => o.op === "set_period" || o.op === "set_filters"),
    )
  ) {
    return;
  }

  const kept = typed.filter(
    (a) => a.type !== "create_widget" && a.type !== "create_dashboard",
  );
  kept.unshift({
    type: "modify_group",
    groupId,
    operations: [{ op: "set_period", preset: period }],
    explanation: `Set dashboard period to ${period}`,
  });
  actions.length = 0;
  actions.push(...kept);
}

export type CanvasWidgetRef = {
  id: string;
  title?: string;
  name?: string;
  kind?: string;
};

/** Map LLM widget id / title fragment to the stable canvas widget key. */
export function resolveCanvasWidgetKey(
  widgets: CanvasWidgetRef[],
  widgetIdRef: string,
): string | null {
  const needle = widgetIdRef.trim().toLowerCase();
  if (!needle || widgets.length === 0) return null;

  const exact = widgets.find((w) => w.id.toLowerCase() === needle);
  if (exact) return exact.id;

  const needleNorm = needle.replace(/[^a-z0-9]/g, "");
  const partial = widgets.find((w) => {
    const id = w.id.toLowerCase();
    if (id.includes(needle) || needle.includes(id)) return true;
    const label = (w.title ?? w.name ?? "").toLowerCase();
    if (!label) return false;
    const labelNorm = label.replace(/[^a-z0-9]/g, "");
    return (
      label.includes(needle) ||
      needle.includes(label) ||
      (needleNorm.length >= 4 &&
        (labelNorm.includes(needleNorm) || needleNorm.includes(labelNorm))) ||
      (needleNorm.includes("pullthrough") && labelNorm.includes("pullthrough"))
    );
  });
  return partial?.id ?? null;
}

/** Normalize modify_group / modify_widget ids using the client canvas snapshot. */
/** When the user asks to remove a grouped widget but the model omitted modify_group. */
export function augmentGroupRemoveFromQuestion(
  actions: unknown[],
  options?: {
    userQuestion?: string;
    canvasState?: {
      groups?: Array<{
        groupId: string;
        widgets?: CanvasWidgetRef[];
      }>;
    };
  },
): void {
  const q = (options?.userQuestion ?? "").toLowerCase();
  if (!/\b(remove|delete)\b/.test(q)) return;
  const group = options?.canvasState?.groups?.[0];
  if (!group?.widgets?.length) return;

  const typed = actions as MutableWorkbenchActionLike[];
  const already = typed.some(
    (a) =>
      a.type === "modify_group" &&
      a.operations?.some((o) => o.op === "remove"),
  );
  if (already) return;

  const qNorm = q.replace(/[^a-z0-9]/g, "");
  const target = group.widgets.find((w) => {
    const label = (w.title ?? w.name ?? w.id ?? "").toLowerCase();
    const labelNorm = label.replace(/[^a-z0-9]/g, "");
    if (!labelNorm) return false;
    if (q.includes(label) || label.includes(q.slice(0, 20))) return true;
    if (qNorm.includes("pullthrough") && labelNorm.includes("pullthrough")) {
      return true;
    }
    return (
      qNorm.length >= 4 &&
      (labelNorm.includes(qNorm) || qNorm.includes(labelNorm))
    );
  });
  if (!target) return;

  typed.unshift({
    type: "modify_group",
    groupId: group.groupId,
    operations: [{ op: "remove", widgetId: target.id }],
    explanation: `Removed ${target.title ?? target.name ?? target.id}`,
  });
}

export function normalizeWorkbenchWidgetIds(
  actions: unknown[],
  canvasState?: {
    groups?: Array<{ groupId: string; widgets?: CanvasWidgetRef[] }>;
    standaloneWidgets?: CanvasWidgetRef[];
  },
): void {
  if (!canvasState) return;

  const standalone = canvasState.standaloneWidgets ?? [];
  const allGroupWidgets = (canvasState.groups ?? []).flatMap((g) => g.widgets ?? []);
  const allWidgets = [...standalone, ...allGroupWidgets];

  for (const raw of actions) {
    if (!raw || typeof raw !== "object") continue;
    const action = raw as {
      type?: string;
      groupId?: string;
      instanceId?: string;
      widgetId?: string;
      operations?: Array<{ op?: string; widgetId?: string }>;
    };

    if (action.type === "modify_widget" && action.instanceId) {
      const resolved = resolveCanvasWidgetKey(allWidgets, action.instanceId);
      if (resolved) action.instanceId = resolved;
      continue;
    }

    if (action.type === "modify_registry_widget" && action.widgetId) {
      const group = canvasState.groups?.find((g) => g.groupId === action.groupId);
      const pool = group?.widgets?.length ? group.widgets : allGroupWidgets;
      const resolved = resolveCanvasWidgetKey(pool, action.widgetId);
      if (resolved) action.widgetId = resolved;
      continue;
    }

    if (action.type !== "modify_group" || !action.groupId || !action.operations) {
      continue;
    }
    const group = canvasState.groups?.find((g) => g.groupId === action.groupId);
    if (!group?.widgets?.length) continue;

    for (const op of action.operations) {
      if (!op.widgetId) continue;
      if (
        op.op !== "remove" &&
        op.op !== "resize" &&
        op.op !== "set_widget_title" &&
        op.op !== "reorder"
      ) {
        continue;
      }
      const resolved = resolveCanvasWidgetKey(group.widgets, op.widgetId);
      if (resolved) op.widgetId = resolved;
    }
  }
}

function reconcileOneCreateWidget(
  action: CreateWidgetActionLike,
  requested: WorkbenchLlmPreset,
  allTime: boolean,
): void {
  const title = String(action.title ?? "").trim();
  if (title) {
    const stripped = stripPeriodTokensFromTitle(title);
    if (stripped) action.title = stripped;
  }

  const fc = ensureFilterConfig(action);
  if (allTime) {
    fc.filterable = false;
    fc.defaultPreset = null;
    return;
  }

  const fromTitle = title ? presetFromTitle(title) : null;
  const implied = fromTitle ?? requested;
  if (!implied) return;

  const preset = requested ?? implied;
  fc.defaultPreset = preset;
  if (fc.filterable === false && preset) {
    fc.filterable = true;
  }
}

function reconcileCohiDashboardWidget(
  widget: CreateWidgetActionLike & { filterConfig?: WidgetFilterConfigLike; title?: string },
  requested: WorkbenchLlmPreset,
  allTime: boolean,
): void {
  const title = String(widget.title ?? "").trim();
  if (title) {
    const stripped = stripPeriodTokensFromTitle(title);
    if (stripped) widget.title = stripped;
  }

  const fc = ensureFilterConfig(widget);
  if (allTime) {
    fc.filterable = false;
    fc.defaultPreset = null;
    return;
  }

  const fromTitle = title ? presetFromTitle(title) : null;
  const implied = fromTitle ?? requested;
  if (!implied) return;

  const preset = requested ?? implied;
  fc.defaultPreset = preset;
  if (fc.filterable === false && preset) {
    fc.filterable = true;
  }
}
