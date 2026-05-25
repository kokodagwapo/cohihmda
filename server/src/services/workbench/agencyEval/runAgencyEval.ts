/**
 * Offline agency eval: replay reconcile pipeline on anchor prompts (no LLM).
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  reconcileWidgetActionPeriods,
  augmentAllTimeStripPeriodOnlyActions,
  augmentAllTimeCreateWidgetFromQuestion,
  augmentAllTimeKpiToGroup,
  augmentAllTimeReconcileModifyGroupAddCohi,
  stripRecreateOnRemoveOnly,
  stripBuildActionsForChartTypeChange,
  stripBuildActionsForAnalyticalQuestion,
  augmentChartTypeFromQuestion,
  augmentAddRegistryWidgetFromQuestion,
  augmentGroupRemoveFromQuestion,
  augmentRestoreWidgetFromQuestion,
  rewriteGroupedDeleteWidgetActions,
  normalizeWorkbenchWidgetIds,
  augmentPeriodSwitchActions,
} from "../workbenchWidgetPeriodReconcile.js";
import {
  expectActionType,
  expectChartType,
  expectGroupOpAddRegistry,
  expectGroupOpRemove,
  expectNoCreateWidget,
  type WorkbenchActionLike,
} from "./assertions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type PromptCase = {
  id: string;
  question: string;
  canvas: {
    totalItems?: number;
    groups?: Array<{
      groupId: string;
      widgets?: Array<{ id: string; name?: string }>;
    }>;
  };
  expect: string[];
};

function loadPrompts(): PromptCase[] {
  const raw = readFileSync(path.join(__dirname, "prompts.json"), "utf8");
  return JSON.parse(raw) as PromptCase[];
}

function loadRecorded(id: string): unknown[] | null {
  const p = path.join(__dirname, "recorded", `${id}.json`);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as unknown[];
}

/** Apply the same post-LLM reconcile pipeline as cohiWorkbench. */
export function reconcileActionsForEval(
  question: string,
  canvasState: PromptCase["canvas"],
  rawActions: unknown[],
): WorkbenchActionLike[] {
  const actions = structuredClone(rawActions) as WorkbenchActionLike[];
  const totalItems =
    canvasState.totalItems ??
    (canvasState.groups ?? []).reduce(
      (n, g) => n + (g.widgets?.length ?? 0),
      0,
    );

  reconcileWidgetActionPeriods(actions, { userQuestion: question });
  augmentPeriodSwitchActions(actions, {
    userQuestion: question,
    canvasState: { totalItems, groups: canvasState.groups },
  });
  augmentAllTimeStripPeriodOnlyActions(actions, { userQuestion: question });
  augmentAllTimeCreateWidgetFromQuestion(actions, {
    userQuestion: question,
    canvasState: { totalItems, groups: canvasState.groups },
  });
  augmentAllTimeKpiToGroup(actions, {
    userQuestion: question,
    canvasState: { totalItems, groups: canvasState.groups },
  });
  augmentAllTimeReconcileModifyGroupAddCohi(actions, { userQuestion: question });
  stripRecreateOnRemoveOnly(actions, question);
  stripBuildActionsForChartTypeChange(actions, question);
  stripBuildActionsForAnalyticalQuestion(actions, { userQuestion: question });
  augmentChartTypeFromQuestion(actions, {
    userQuestion: question,
    canvasState: canvasState,
  });
  augmentAddRegistryWidgetFromQuestion(actions, {
    userQuestion: question,
    canvasState: canvasState,
  });
  augmentGroupRemoveFromQuestion(actions, {
    userQuestion: question,
    canvasState: canvasState,
  });
  augmentRestoreWidgetFromQuestion(actions, {
    userQuestion: question,
    canvasState: canvasState,
  });
  rewriteGroupedDeleteWidgetActions(actions, canvasState);
  normalizeWorkbenchWidgetIds(actions, canvasState);
  return actions;
}

function evaluateExpectations(
  actions: WorkbenchActionLike[],
  tags: string[],
): string | null {
  for (const tag of tags) {
    try {
      switch (tag) {
        case "create_widget":
          expectActionType(actions, "create_widget");
          break;
        case "modify_group_set_period":
          if (
            !actions.some(
              (a) =>
                a.type === "modify_group" &&
                a.operations?.some((o) => o.op === "set_period"),
            )
          ) {
            throw new Error("Expected set_period");
          }
          break;
        case "modify_group_remove":
          if (
            !actions.some(
              (a) =>
                a.type === "modify_group" &&
                a.operations?.some((o) => o.op === "remove"),
            )
          ) {
            throw new Error("Expected remove op");
          }
          break;
        case "modify_group_remove_units":
          expectGroupOpRemove(actions, "units");
          break;
        case "add_registry_pullthrough":
          expectGroupOpAddRegistry(actions, "sales-scorecard-pull-through");
          break;
        case "add_registry_wac":
          expectGroupOpAddRegistry(actions, "company-scorecard-wac");
          break;
        case "add_registry_wa_fico":
          expectGroupOpAddRegistry(actions, "company-scorecard-wa-fico");
          break;
        case "add_registry_margin":
          expectGroupOpAddRegistry(actions, "sales-scorecard-revenue-bps");
          break;
        case "add_registry_fico_dist":
          expectGroupOpAddRegistry(actions, "credit-risk-fico-distribution");
          break;
        case "add_registry_turn_time":
          expectGroupOpAddRegistry(actions, "sales-scorecard-avg-turn-time");
          break;
        case "add_registry_volume_branch":
          expectGroupOpAddRegistry(actions, "company-scorecard-volume-by-branch");
          break;
        case "chart_type_line":
          expectChartType(actions, "line");
          break;
        case "chart_type_bar":
          expectChartType(actions, "bar");
          break;
        case "chart_type_pie":
          expectChartType(actions, "pie");
          break;
        case "no_create":
          expectNoCreateWidget(actions);
          break;
        case "all_time_or_modify":
          if (
            !actions.some(
              (a) =>
                a.type === "modify_widget" ||
                a.type === "modify_group" ||
                a.type === "create_widget",
            )
          ) {
            throw new Error("Expected some canvas mutation or create");
          }
          break;
        default:
          throw new Error(`Unknown expect tag: ${tag}`);
      }
    } catch (e) {
      return `${tag}: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return null;
}

export function runAgencyEval(options?: { filterId?: string }): {
  passed: number;
  failed: number;
  results: Array<{ id: string; ok: boolean; error?: string }>;
} {
  const prompts = loadPrompts().filter(
    (p) => !options?.filterId || p.id === options.filterId,
  );
  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  let passed = 0;
  let failed = 0;

  for (const prompt of prompts) {
    const recorded = loadRecorded(prompt.id);
    const seed = recorded ?? [{ type: "teach", message: "ok" }];
    const actions = reconcileActionsForEval(
      prompt.question,
      prompt.canvas,
      seed,
    );
    const err = evaluateExpectations(actions, prompt.expect);
    if (err) {
      failed++;
      results.push({ id: prompt.id, ok: false, error: err });
    } else {
      passed++;
      results.push({ id: prompt.id, ok: true });
    }
  }

  return { passed, failed, results };
}

const isMain =
  typeof process.argv[1] === "string" &&
  process.argv[1].includes("runAgencyEval");

if (isMain) {
  const filterId = process.argv[2];
  const { passed, failed, results } = runAgencyEval({ filterId });
  for (const r of results) {
    console.log(`${r.ok ? "✓" : "✗"} ${r.id}${r.error ? ` — ${r.error}` : ""}`);
  }
  console.log(`\nAgency eval: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}
