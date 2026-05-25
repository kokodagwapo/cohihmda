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
  defId?: string;
};

type MutableWorkbenchActionLike = {
  type?: string;
  groupId?: string;
  widgetId?: string;
  instanceId?: string;
  explanation?: string;
  configOverrides?: Record<string, unknown>;
  operations?: MutableGroupOperationLike[];
};

export type RegistryChartType = "bar" | "line" | "pie" | "area";

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

import {
  isAllTimeRequest,
  isChartTypeChangeRequest,
  isAnalyticalOnlyRequest,
  isPeriodSwitchOnlyRequest,
  isRestoreWidgetRequest,
  extractRemoveWidgetPhrase,
  isRemoveWidgetOnlyRequest,
} from "../../../../src/lib/workbench/workbenchPromptIntent.js";

export {
  isAllTimeRequest,
  isChartTypeChangeRequest,
  isAnalyticalOnlyRequest,
  isPeriodSwitchOnlyRequest,
  isRestoreWidgetRequest,
  extractRemoveWidgetPhrase,
  isRemoveWidgetOnlyRequest,
};

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

function reconcileModifyGroupOperations(
  operations: unknown[] | undefined,
  requested: WorkbenchLlmPreset,
  allTime: boolean,
): void {
  if (!operations?.length) return;
  for (const raw of operations) {
    if (!raw || typeof raw !== "object") continue;
    const op = raw as { op?: string; title?: string; filterConfig?: WidgetFilterConfigLike };
    if (op.op === "add_cohi") {
      reconcileCohiDashboardWidget(
        op as CreateWidgetActionLike & { filterConfig?: WidgetFilterConfigLike },
        requested,
        allTime,
      );
    }
  }
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
      operations?: unknown[];
    };

    if (action.type === "create_widget") {
      reconcileOneCreateWidget(action, requested, allTime);
      continue;
    }

    if (action.type === "modify_group") {
      reconcileModifyGroupOperations(action.operations, requested, allTime);
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

  const groups = options.canvasState?.groups ?? [];
  if (groups.length === 0) return;

  const typed = actions as MutableWorkbenchActionLike[];
  const hasRecreate = typed.some(
    (a) => a.type === "create_widget" || a.type === "create_dashboard",
  );
  const hasSetPeriodOnly =
    typed.some(
      (a) =>
        a.type === "modify_group" &&
        a.operations?.some((o) => o.op === "set_period"),
    ) && !hasRecreate;

  if (hasSetPeriodOnly) return;

  const q = (options.userQuestion ?? "").toLowerCase();
  const wholeDashboard = /\b(whole|entire|full)\s+dashboard\b/.test(q);
  const targetGroups = wholeDashboard ? groups : [groups[0]];

  const periodActions: MutableWorkbenchActionLike[] = targetGroups.map((g) => ({
    type: "modify_group",
    groupId: g.groupId,
    operations: [{ op: "set_period", preset: period }],
    explanation: `Set dashboard period to ${period}`,
  }));

  const WORKBENCH_MUTATION_TYPES = new Set([
    "modify_group",
    "create_widget",
    "create_dashboard",
    "modify_widget",
    "delete_widget",
    "add_registry",
    "remove_widget",
    "restore_widget",
  ]);
  const hasWorkbenchMutations = typed.some((a) =>
    WORKBENCH_MUTATION_TYPES.has(String(a.type ?? "")),
  );

  if (!hasRecreate && !hasWorkbenchMutations) {
    actions.length = 0;
    actions.push(...periodActions);
    return;
  }

  const kept = typed.filter(
    (a) => a.type !== "create_widget" && a.type !== "create_dashboard",
  );

  actions.length = 0;
  actions.push(...periodActions, ...kept);
}

/** Replace misleading assistant copy when only period changed (no widget recreate). */
export function periodSwitchAssistantMessage(
  actions: unknown[],
  userQuestion?: string,
): string | null {
  if (!isPeriodSwitchOnlyRequest(userQuestion)) return null;
  const typed = actions as MutableWorkbenchActionLike[];
  if (typed.some((a) => a.type === "create_widget" || a.type === "create_dashboard")) {
    return null;
  }
  const hasPeriod = typed.some(
    (a) =>
      a.type === "modify_group" &&
      a.operations?.some((o) => o.op === "set_period"),
  );
  if (!hasPeriod) return null;
  const period = parseRequestedPeriodFromText(userQuestion) ?? "the new period";
  return `Updated dashboard period to ${period}. Your existing widgets were kept — check the dashboard date filter to confirm the range.`;
}

/** Drop create_widget / create_dashboard when the user asked an analytical question only. */
export function stripBuildActionsForAnalyticalQuestion(
  actions: unknown[],
  options?: { userQuestion?: string; canvasTotalItems?: number },
): void {
  if ((options?.canvasTotalItems ?? 0) === 0) return;
  if (!isAnalyticalOnlyRequest(options?.userQuestion)) return;
  const typed = actions as MutableWorkbenchActionLike[];
  const filtered = typed.filter(
    (a) => a.type !== "create_widget" && a.type !== "create_dashboard",
  );
  actions.length = 0;
  actions.push(...filtered);
}

function inferAllTimeKpiTitle(userQuestion: string): string {
  const q = userQuestion.toLowerCase();
  if (/\bunits\b/.test(q)) return "Total Units";
  if (/\bvolume\b/.test(q)) return "Total Volume";
  if (/\bpull[- ]?through\b/.test(q)) return "Pull-Through Rate";
  return "All-time KPI";
}

/** Drop period-only modify_group ops mis-routed for all-time KPI asks. */
export function augmentAllTimeStripPeriodOnlyActions(
  actions: unknown[],
  options?: {
    userQuestion?: string;
    canvasState?: {
      totalItems?: number;
      groups?: Array<{ groupId: string }>;
    };
  },
): void {
  if (!isAllTimeRequest(options?.userQuestion)) return;
  const typed = actions as MutableWorkbenchActionLike[];
  const filtered = typed.filter((a) => {
    if (a.type !== "modify_group" || !Array.isArray(a.operations)) return true;
    const ops = a.operations as Array<{ op?: string }>;
    if (ops.length === 0) return true;
    return !ops.every((o) => o.op === "set_period");
  });
  if (filtered.length === typed.length) return;
  actions.length = 0;
  actions.push(...filtered);
  if (options?.canvasState) {
    augmentAllTimeCreateWidgetFromQuestion(actions, {
      userQuestion: options.userQuestion,
      canvasState: options.canvasState,
    });
  }
}

/**
 * When the LLM returns teach-only for an all-time request on a populated canvas,
 * seed a single create_widget so augmentAllTimeKpiToGroup can route it into the group.
 */
export function augmentAllTimeCreateWidgetFromQuestion(
  actions: unknown[],
  options: {
    userQuestion?: string;
    canvasState?: {
      totalItems?: number;
      groups?: Array<{ groupId: string }>;
    };
  },
): void {
  if (!isAllTimeRequest(options.userQuestion)) return;
  if ((options.canvasState?.totalItems ?? 0) === 0) return;
  if (!options.canvasState?.groups?.[0]?.groupId) return;

  const typed = actions as MutableWorkbenchActionLike[];
  if (typed.some((a) => a.type === "create_widget")) return;

  const hasAllTimeAddCohi = typed.some(
    (a) =>
      a.type === "modify_group" &&
      Array.isArray(a.operations) &&
      (
        a.operations as Array<{
          op?: string;
          filterConfig?: WidgetFilterConfigLike;
        }>
      ).some(
        (o) => o.op === "add_cohi" && o.filterConfig?.filterable === false,
      ),
  );
  if (hasAllTimeAddCohi) return;

  typed.unshift({
    type: "create_widget",
    title: inferAllTimeKpiTitle(options.userQuestion ?? ""),
    sql: "SELECT COUNT(*) AS total FROM public.loans l WHERE l.funding_date IS NOT NULL",
    config: { type: "kpi", data: [] },
    filterConfig: {
      filterable: true,
      dateColumn: "funding_date",
      defaultPreset: "YTD",
    },
    explanation: "All-time KPI from user request",
  });
}

/** Add all-time KPIs into the existing dashboard group (not a second group below). */
export function augmentAllTimeKpiToGroup(
  actions: unknown[],
  options: {
    userQuestion?: string;
    canvasState?: {
      totalItems?: number;
      groups?: Array<{ groupId: string }>;
    };
  },
): void {
  if (!isAllTimeRequest(options.userQuestion)) return;
  if ((options.canvasState?.totalItems ?? 0) === 0) return;
  const group = options.canvasState?.groups?.[0];
  if (!group?.groupId) return;

  const typed = actions as MutableWorkbenchActionLike[];
  const creates = typed.filter((a) => a.type === "create_widget");
  if (creates.length !== 1) return;

  const cw = creates[0] as CreateWidgetActionLike & {
    sql?: string;
    config?: Record<string, unknown>;
    explanation?: string;
    allowLowSamplePullThrough?: boolean;
  };
  reconcileOneCreateWidget(cw, null, true);

  const filtered = typed.filter(
    (a) => a.type !== "create_widget" && a.type !== "teach",
  );
  filtered.unshift({
    type: "modify_group",
    groupId: group.groupId,
    operations: [
      {
        op: "add_cohi",
        sql: cw.sql ?? "SELECT COUNT(*) AS total FROM public.loans l",
        title: cw.title ?? "All-time KPI",
        vizConfig: cw.config ?? { type: "kpi", data: [] },
        filterConfig: cw.filterConfig ?? {
          filterable: false,
          dateColumn: "funding_date",
          defaultPreset: null,
        },
        allowLowSamplePullThrough: !!cw.allowLowSamplePullThrough,
      },
    ],
    explanation: cw.explanation ?? "Added all-time KPI",
  });

  actions.length = 0;
  actions.push(...filtered);
}

/** Stamp filterable:false on LLM-emitted modify_group add_cohi for all-time requests. */
export function augmentAllTimeReconcileModifyGroupAddCohi(
  actions: unknown[],
  options?: { userQuestion?: string },
): void {
  if (!isAllTimeRequest(options?.userQuestion)) return;
  const typed = actions as MutableWorkbenchActionLike[];
  for (const a of typed) {
    if (a.type !== "modify_group" || !Array.isArray(a.operations)) continue;
    for (const op of a.operations) {
      if (!op || typeof op !== "object") continue;
      const row = op as {
        op?: string;
        title?: string;
        filterConfig?: WidgetFilterConfigLike;
      };
      if (row.op !== "add_cohi") continue;
      reconcileCohiDashboardWidget(
        row as CreateWidgetActionLike & { filterConfig?: WidgetFilterConfigLike },
        null,
        true,
      );
    }
    if (typeof a.explanation === "string" && !/all[- ]?time/i.test(a.explanation)) {
      a.explanation = "Added all-time KPI";
    }
  }
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
function normalizeWidgetLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

type WidgetMatchCtx = {
  qNorm: string;
  phraseNorm?: string;
  labelNorm: string;
  idNorm: string;
};

type ScoringRule = {
  score: number;
  match: (ctx: WidgetMatchCtx) => boolean;
};

const REMOVE_WIDGET_MATCH_RULES: ScoringRule[] = [
  {
    score: 100,
    match: ({ qNorm, labelNorm }) =>
      !!labelNorm && (qNorm.includes(labelNorm) || labelNorm.includes(qNorm)),
  },
  {
    score: 95,
    match: ({ qNorm, idNorm }) =>
      !!idNorm && (qNorm.includes(idNorm) || idNorm.includes(qNorm)),
  },
  {
    score: 92,
    match: ({ phraseNorm, idNorm }) =>
      phraseNorm.includes("fundedunits") && idNorm.includes("scorecardunits"),
  },
  {
    score: 90,
    match: ({ qNorm, labelNorm }) =>
      qNorm.includes("pullthrough") && labelNorm.includes("pullthrough"),
  },
  {
    score: 90,
    match: ({ phraseNorm, qNorm, labelNorm, idNorm }) =>
      (phraseNorm.includes("fundedunits") ||
        qNorm.includes("fundedunits") ||
        qNorm.includes("totalunits")) &&
      (labelNorm.includes("units") || idNorm.includes("units")) &&
      !labelNorm.includes("volume") &&
      !idNorm.includes("volume"),
  },
  {
    score: 88,
    match: ({ phraseNorm, qNorm, labelNorm, idNorm }) =>
      (phraseNorm.includes("fundedvolume") ||
        qNorm.includes("fundedvolume") ||
        qNorm.includes("totalvolume")) &&
      (labelNorm.includes("volume") || idNorm.includes("volume")),
  },
  {
    score: 80,
    match: ({ qNorm, labelNorm }) =>
      qNorm.includes("margin") && labelNorm.includes("margin"),
  },
  {
    score: 70,
    match: ({ qNorm, labelNorm }) =>
      qNorm.includes("margin") &&
      (labelNorm.includes("revenue") ||
        labelNorm.includes("bps") ||
        labelNorm.includes("gain")),
  },
  {
    score: 80,
    match: ({ qNorm, labelNorm, idNorm }) =>
      qNorm.includes("wac") &&
      (labelNorm.includes("wac") || idNorm.includes("wac")),
  },
  {
    score: 78,
    match: ({ qNorm, phraseNorm, labelNorm, idNorm }) =>
      (qNorm.includes("fico") || phraseNorm.includes("fico")) &&
      (labelNorm.includes("fico") || idNorm.includes("fico")),
  },
  {
    score: 78,
    match: ({ qNorm, labelNorm, idNorm }) =>
      qNorm.includes("ltv") &&
      (labelNorm.includes("ltv") || idNorm.includes("ltv")),
  },
  {
    score: 75,
    match: ({ phraseNorm, labelNorm }) =>
      phraseNorm.length >= 4 &&
      labelNorm.length >= 4 &&
      (phraseNorm.includes(labelNorm) || labelNorm.includes(phraseNorm)),
  },
];

function scoreRemoveWidgetMatch(
  qNorm: string,
  phraseNorm: string,
  labelNorm: string,
  idNorm: string,
): number {
  if (!qNorm || (!labelNorm && !idNorm)) return 0;
  const ctx: WidgetMatchCtx = { qNorm, phraseNorm, labelNorm, idNorm };
  let best = 0;
  for (const rule of REMOVE_WIDGET_MATCH_RULES) {
    if (rule.match(ctx)) best = Math.max(best, rule.score);
  }
  return best;
}

/** Resolve grouped widget + group for a remove/delete phrase (searches all groups). */
export function findGroupWidgetRemoveTarget(
  userQuestion: string,
  canvasState?: {
    groups?: Array<{
      groupId: string;
      widgets?: CanvasWidgetRef[];
    }>;
  },
): { groupId: string; widgetId: string; label: string } | null {
  const q = userQuestion.toLowerCase();
  if (!/\b(remove|delete)\b/.test(q)) return null;
  const qNorm = normalizeWidgetLabel(q);
  const phraseNorm = normalizeWidgetLabel(extractRemoveWidgetPhrase(userQuestion));

  let best: { groupId: string; widgetId: string; label: string; score: number } | null =
    null;

  for (const group of canvasState?.groups ?? []) {
    for (const w of group.widgets ?? []) {
      const label = (w.title ?? w.name ?? w.id ?? "").trim();
      const labelNorm = normalizeWidgetLabel(label);
      const idNorm = normalizeWidgetLabel(w.id);
      const score = scoreRemoveWidgetMatch(qNorm, phraseNorm, labelNorm, idNorm);
      if (score > 0 && (!best || score > best.score)) {
        best = {
          groupId: group.groupId,
          widgetId: w.id,
          label: label || w.id,
          score,
        };
      }
    }
  }
  if (!best) return null;
  return {
    groupId: best.groupId,
    widgetId: best.widgetId,
    label: best.label,
  };
}

function canvasHasPullThrough(
  canvasState?: {
    groups?: Array<{ widgets?: CanvasWidgetRef[] }>;
  },
): boolean {
  for (const group of canvasState?.groups ?? []) {
    for (const w of group.widgets ?? []) {
      const labelNorm = normalizeWidgetLabel(
        (w.title ?? w.name ?? w.id ?? "").trim(),
      );
      if (labelNorm.includes("pullthrough")) return true;
    }
  }
  return false;
}

/** When user asks to re-add pull-through, inject add_registry if the model only chatted. */
export function augmentRestoreWidgetFromQuestion(
  actions: unknown[],
  options?: {
    userQuestion?: string;
    canvasState?: {
      groups?: Array<{ groupId: string; widgets?: CanvasWidgetRef[] }>;
    };
  },
): void {
  const q = options?.userQuestion ?? "";
  if (!isRestoreWidgetRequest(q)) return;
  if (!/\bpull[- ]?through\b/i.test(q)) return;
  if (canvasHasPullThrough(options?.canvasState)) return;

  const group = options?.canvasState?.groups?.[0];
  if (!group?.groupId) return;

  const typed = actions as MutableWorkbenchActionLike[];
  const filtered = typed.filter(
    (a) =>
      a.type !== "create_widget" &&
      a.type !== "create_dashboard" &&
      a.type !== "create_canvas",
  );
  const already = filtered.some(
    (a) =>
      a.type === "modify_group" &&
      a.operations?.some(
        (o) =>
          o.op === "add_registry" &&
          String((o as { defId?: string }).defId ?? "").includes("pull"),
      ),
  );
  if (already) {
    actions.length = 0;
    actions.push(...filtered);
    return;
  }

  const restoreAction: MutableWorkbenchActionLike = {
    type: "modify_group",
    groupId: group.groupId,
    operations: [{ op: "add_registry", defId: "sales-scorecard-pull-through" }],
    explanation: "Restored Pull-Through Rate widget",
  };
  const withoutTeach = filtered.filter((a) => a.type !== "teach");
  actions.length = 0;
  actions.push(restoreAction, ...withoutTeach);
}

export function parseRequestedChartType(
  question: string,
): RegistryChartType | null {
  const q = question.toLowerCase();
  if (/\bline(\s+chart)?\b/.test(q)) return "line";
  if (/\bbar(\s+chart)?\b/.test(q)) return "bar";
  if (/\bpie(\s+chart)?\b/.test(q)) return "pie";
  if (/\barea(\s+chart)?\b/.test(q)) return "area";
  return null;
}

function isRegistryChartWidget(labelNorm: string, idNorm: string): boolean {
  return (
    idNorm.includes("branch") ||
    idNorm.includes("chart") ||
    idNorm.includes("distribution") ||
    idNorm.includes("trend") ||
    labelNorm.includes(" by ")
  );
}

const CHART_WIDGET_MATCH_RULES: ScoringRule[] = [
  {
    score: 100,
    match: ({ qNorm, labelNorm }) =>
      qNorm.includes("pullthrough") && labelNorm.includes("pullthrough"),
  },
  {
    score: 98,
    match: ({ qNorm, idNorm }) =>
      qNorm.includes("pullthrough") && idNorm.includes("pullthrough"),
  },
  {
    score: 85,
    match: ({ qNorm, labelNorm }) =>
      qNorm.includes("volume") && labelNorm.includes("volume"),
  },
  {
    score: 82,
    match: ({ qNorm, labelNorm, idNorm }) =>
      qNorm.includes("fico") &&
      (labelNorm.includes("fico") || idNorm.includes("distribution")),
  },
  {
    score: 80,
    match: ({ qNorm, labelNorm }) =>
      qNorm.includes("ltv") && labelNorm.includes("ltv"),
  },
  {
    score: 40,
    match: ({ labelNorm, idNorm }) =>
      isRegistryChartWidget(labelNorm, idNorm),
  },
];

function scoreChartWidgetMatch(ctx: WidgetMatchCtx): number {
  let best = 0;
  for (const rule of CHART_WIDGET_MATCH_RULES) {
    if (rule.match(ctx)) best = Math.max(best, rule.score);
  }
  return best;
}

/** Resolve registry chart widget for chart-type change phrases (e.g. pull-through by branch). */
export function findRegistryChartWidgetTarget(
  userQuestion: string,
  canvasState?: {
    groups?: Array<{
      groupId: string;
      widgets?: CanvasWidgetRef[];
    }>;
  },
): { groupId: string; widgetId: string; label: string } | null {
  const qNorm = normalizeWidgetLabel(userQuestion);

  let best: { groupId: string; widgetId: string; label: string; score: number } | null =
    null;

  for (const group of canvasState?.groups ?? []) {
    for (const w of group.widgets ?? []) {
      const label = (w.title ?? w.name ?? w.id ?? "").trim();
      const labelNorm = normalizeWidgetLabel(label);
      const idNorm = normalizeWidgetLabel(w.id);
      if (!isRegistryChartWidget(labelNorm, idNorm)) continue;

      const score = scoreChartWidgetMatch({ qNorm, labelNorm, idNorm });
      if (score > 0 && (!best || score > best.score)) {
        best = {
          groupId: group.groupId,
          widgetId: w.id,
          label: label || w.id,
          score,
        };
      }
    }
  }

  if (!best) return null;
  return {
    groupId: best.groupId,
    widgetId: best.widgetId,
    label: best.label,
  };
}

/** Drop create_* when the user only asked to change chart type on an existing widget. */
export function stripBuildActionsForChartTypeChange(
  actions: unknown[],
  userQuestion?: string,
): void {
  if (!isChartTypeChangeRequest(userQuestion)) return;
  const typed = actions as MutableWorkbenchActionLike[];
  const filtered = typed.filter(
    (a) =>
      a.type !== "create_widget" &&
      a.type !== "create_dashboard" &&
      a.type !== "create_canvas",
  );
  actions.length = 0;
  actions.push(...filtered);
}

/** Inject modify_registry_widget when the model omitted chart type overrides. */
export function augmentChartTypeFromQuestion(
  actions: unknown[],
  options?: {
    userQuestion?: string;
    canvasState?: {
      groups?: Array<{ groupId: string; widgets?: CanvasWidgetRef[] }>;
    };
  },
): void {
  const q = options?.userQuestion ?? "";
  if (!isChartTypeChangeRequest(q)) return;
  const chartType = parseRequestedChartType(q);
  if (!chartType) return;

  const target = findRegistryChartWidgetTarget(q, options?.canvasState);
  if (!target) return;

  const typed = actions as MutableWorkbenchActionLike[];
  const already = typed.some(
    (a) =>
      a.type === "modify_registry_widget" &&
      a.widgetId === target.widgetId &&
      a.configOverrides?.chartType === chartType,
  );
  if (already) return;

  const filtered = typed.filter(
    (a) =>
      a.type !== "create_widget" &&
      a.type !== "create_dashboard" &&
      a.type !== "create_canvas",
  );
  const withoutTeach = filtered.filter((a) => a.type !== "teach");

  actions.length = 0;
  actions.push(
    {
      type: "modify_registry_widget",
      groupId: target.groupId,
      widgetId: target.widgetId,
      configOverrides: { chartType },
      explanation: `Changed ${target.label} to ${chartType} chart`,
    },
    ...withoutTeach,
  );
}

function canvasHasRegistryDefId(
  canvasState: { groups?: Array<{ widgets?: CanvasWidgetRef[] }> } | undefined,
  defId: string,
): boolean {
  const needle = normalizeWidgetLabel(defId);
  for (const group of canvasState?.groups ?? []) {
    for (const w of group.widgets ?? []) {
      const idNorm = normalizeWidgetLabel(w.id ?? "");
      if (idNorm.includes(needle)) return true;
    }
  }
  return false;
}

/** Inject add_registry when user asks to add a known catalog widget that is missing. */
export function augmentAddRegistryWidgetFromQuestion(
  actions: unknown[],
  options?: {
    userQuestion?: string;
    canvasState?: {
      groups?: Array<{ groupId: string; widgets?: CanvasWidgetRef[] }>;
    };
  },
): void {
  const q = (options?.userQuestion ?? "").toLowerCase();
  if (!/\b(add|include|put|show)\b/.test(q)) return;
  if (/\b(remove|delete)\b/.test(q)) return;

  const additions: Array<{ pattern: RegExp; defId: string; label: string }> = [
    {
      pattern:
        /\b(wac|weighted[- ]?average[- ]?coupon|average[- ]?coupon)\b/i,
      defId: "company-scorecard-wac",
      label: "WAC",
    },
    {
      pattern: /\bwa\s*fico\b/i,
      defId: "company-scorecard-wa-fico",
      label: "WA FICO",
    },
    {
      pattern: /\bwa\s*ltv\b/i,
      defId: "company-scorecard-wa-ltv",
      label: "WA LTV",
    },
    {
      pattern: /\bwa\s*dti\b/i,
      defId: "company-scorecard-wa-dti",
      label: "WA DTI",
    },
    {
      pattern: /\b(volume by branch|branch volume)\b/i,
      defId: "company-scorecard-volume-by-branch",
      label: "Volume by Branch",
    },
    {
      pattern: /\b(pull[- ]?through by branch|branch pull[- ]?through)\b/i,
      defId: "company-scorecard-pullthrough-by-branch",
      label: "Pull-Through by Branch",
    },
    {
      pattern: /\b(fico distribution|distribution of fico)\b/i,
      defId: "credit-risk-fico-distribution",
      label: "FICO Distribution",
    },
    {
      pattern: /\b(cycle time|turn time|avg turn)\b/i,
      defId: "sales-scorecard-avg-turn-time",
      label: "Avg Turn Time",
    },
    {
      pattern: /\b(margin|revenue bps)\b/i,
      defId: "sales-scorecard-revenue-bps",
      label: "Revenue BPS",
    },
  ];

  const group = options?.canvasState?.groups?.[0];
  if (!group?.groupId) return;

  const typed = actions as MutableWorkbenchActionLike[];
  const toInject: MutableWorkbenchActionLike[] = [];

  for (const { pattern, defId, label } of additions) {
    if (!pattern.test(q)) continue;
    if (canvasHasRegistryDefId(options?.canvasState, defId)) continue;
    const already = typed.some(
      (a) =>
        a.type === "modify_group" &&
        a.operations?.some(
          (o) => o.op === "add_registry" && o.defId === defId,
        ),
    );
    if (already) continue;
    toInject.push({
      type: "modify_group",
      groupId: group.groupId,
      operations: [{ op: "add_registry", defId }],
      explanation: `Added ${label} widget`,
    });
  }

  if (!toInject.length) return;

  const filtered = typed.filter(
    (a) =>
      a.type !== "create_widget" &&
      a.type !== "create_dashboard" &&
      a.type !== "create_canvas",
  );
  actions.length = 0;
  actions.push(...toInject, ...filtered);
}

/** Drop spurious create_* when the user only asked to remove a widget. */
export function stripRecreateOnRemoveOnly(
  actions: unknown[],
  userQuestion?: string,
): void {
  if (!isRemoveWidgetOnlyRequest(userQuestion)) return;
  const typed = actions as MutableWorkbenchActionLike[];
  const filtered = typed.filter(
    (a) =>
      a.type !== "create_widget" &&
      a.type !== "create_dashboard" &&
      a.type !== "create_canvas",
  );
  actions.length = 0;
  actions.push(...filtered);
}

/** Convert delete_widget on grouped widgets into modify_group remove. */
export function rewriteGroupedDeleteWidgetActions(
  actions: unknown[],
  canvasState?: {
    groups?: Array<{ groupId: string; widgets?: CanvasWidgetRef[] }>;
    standaloneWidgets?: CanvasWidgetRef[];
  },
): void {
  if (!canvasState?.groups?.length) return;
  const standalone = canvasState.standaloneWidgets ?? [];
  const typed = actions as Array<
    MutableWorkbenchActionLike & { instanceId?: string; explanation?: string }
  >;

  for (let i = 0; i < typed.length; i++) {
    const action = typed[i];
    if (action.type !== "delete_widget" || !action.instanceId) continue;

    if (resolveCanvasWidgetKey(standalone, action.instanceId)) continue;

    for (const group of canvasState.groups ?? []) {
      const resolved = resolveCanvasWidgetKey(
        group.widgets ?? [],
        action.instanceId,
      );
      if (!resolved) continue;
      typed[i] = {
        type: "modify_group",
        groupId: group.groupId,
        operations: [{ op: "remove", widgetId: resolved }],
        explanation: action.explanation ?? "Removed widget from dashboard group",
      };
      break;
    }
  }
}

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
  const typed = actions as MutableWorkbenchActionLike[];
  const already = typed.some(
    (a) =>
      a.type === "modify_group" &&
      a.operations?.some((o) => o.op === "remove"),
  );
  if (already) return;

  const target = findGroupWidgetRemoveTarget(
    options?.userQuestion ?? "",
    options?.canvasState,
  );
  if (!target) return;

  typed.unshift({
    type: "modify_group",
    groupId: target.groupId,
    operations: [{ op: "remove", widgetId: target.widgetId }],
    explanation: `Removed ${target.label}`,
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

// ---------------------------------------------------------------------------
// Reconcile trace ring buffer (for WORKBENCH_RECONCILE_DEBUG + live e2e)
// ---------------------------------------------------------------------------

export type ReconcileTraceActionSummary = {
  type?: string;
  groupId?: string;
  widgetId?: string;
  chartType?: string;
  op?: string;
};

export type ReconcileTraceEntry = {
  ts: string;
  question: string;
  actions: ReconcileTraceActionSummary[];
};

const RECONCILE_TRACE_MAX = 32;
const reconcileTraceBuffer: ReconcileTraceEntry[] = [];

export function summarizeActionsForReconcileTrace(
  actions: unknown[],
): ReconcileTraceActionSummary[] {
  const out: ReconcileTraceActionSummary[] = [];
  for (const raw of actions) {
    if (!raw || typeof raw !== "object") continue;
    const a = raw as {
      type?: string;
      groupId?: string;
      widgetId?: string;
      instanceId?: string;
      configOverrides?: { chartType?: string };
      operations?: Array<{ op?: string; preset?: string }>;
    };
    const summary: ReconcileTraceActionSummary = {
      type: a.type,
      groupId: a.groupId,
      widgetId: a.widgetId ?? a.instanceId,
      chartType: a.configOverrides?.chartType,
    };
    if (a.type === "modify_group" && Array.isArray(a.operations)) {
      const ops = a.operations.map((o) => o.op).filter(Boolean);
      if (ops.length) summary.op = ops.join(",");
      const periodOp = a.operations.find((o) => o.op === "set_period");
      if (periodOp?.preset) {
        summary.op = `set_period:${periodOp.preset}`;
      }
    }
    out.push(summary);
  }
  return out;
}

/** Record a post-reconcile action list (always writes; HTTP endpoint gated separately). */
export function pushReconcileTraceEntry(
  question: string | undefined,
  actions: unknown[],
): void {
  const q = (question ?? "").trim();
  if (!q) return;
  reconcileTraceBuffer.push({
    ts: new Date().toISOString(),
    question: q.slice(0, 200),
    actions: summarizeActionsForReconcileTrace(actions),
  });
  while (reconcileTraceBuffer.length > RECONCILE_TRACE_MAX) {
    reconcileTraceBuffer.shift();
  }
}

export function getReconcileTraceBuffer(limit = 10): ReconcileTraceEntry[] {
  const n = Math.max(1, Math.min(limit, RECONCILE_TRACE_MAX));
  return reconcileTraceBuffer.slice(-n);
}

export function clearReconcileTraceBuffer(): void {
  reconcileTraceBuffer.length = 0;
}
