/**
 * Modular prompt composer + persona router (COHI-390).
 * Compiles existing agent system prompts into ordered bundles per chat_type / surface / scope.
 */

import { createHash } from "crypto";
import type { UnifiedConversationChatType } from "./unifiedConversationService.js";
import {
  GLOBAL_COHI_CHAT_PROMPT_CORE,
  WORKBENCH_COHI_PROMPT_CORE,
  INSIGHT_BUILDER_PROMPT_CORE,
  researchLabPromptCore,
} from "./sharedPromptModules.js";

export interface PromptComposeContext {
  chatType: UnifiedConversationChatType;
  surface?: string;
  scopeType?: string;
  // Deferred — see unifiedChatOrchestrator `planningMode` / MODULE_PLANNING_HINT below.
  // planningMode?: "auto" | "always" | "never";
  deepAnalysis?: boolean;
}

export interface ComposedPromptBundle {
  moduleIds: string[];
  /** Stable audit hash — not full rendered prompt text. */
  bundleHash: string;
  systemSections: string[];
}

type PromptModuleDef = {
  id: string;
  version: string;
  build: (ctx: PromptComposeContext) => string;
};

/** Global Cohi chat — condensed from cohiChatService system behavior. */
const MODULE_GLOBAL_CHAT: PromptModuleDef = {
  id: "global.cohi_chat",
  version: "2",
  build: () => GLOBAL_COHI_CHAT_PROMPT_CORE,
};

const MODULE_WORKBENCH: PromptModuleDef = {
  id: "workbench.canvas",
  version: "2",
  build: () => WORKBENCH_COHI_PROMPT_CORE,
};

const MODULE_INSIGHT_BUILDER: PromptModuleDef = {
  id: "insight_builder.author",
  version: "2",
  build: () => INSIGHT_BUILDER_PROMPT_CORE,
};

const MODULE_RESEARCH: PromptModuleDef = {
  id: "research.lab",
  version: "2",
  build: (ctx) => researchLabPromptCore(ctx.deepAnalysis),
};

// Research pipeline stage modules (COHI-390 / COHI-402 — audit attribution only).
// Prompt bodies live in `server/src/services/research/agents/*Agent.ts`; these
// module ids exist so `bundleHash` records which stages ran without duplicating
// the multi-thousand-character system prompts here. Tenant overrides resolve at
// the agent layer (override precedence: repo default < tenant) — see rollout doc.
const MODULE_RESEARCH_PLANNER: PromptModuleDef = {
  id: "research.planner",
  version: "1",
  build: () => "",
};
const MODULE_RESEARCH_ANALYST: PromptModuleDef = {
  id: "research.analyst",
  version: "1",
  build: () => "",
};
const MODULE_RESEARCH_SYNTHESIS: PromptModuleDef = {
  id: "research.synthesis",
  version: "1",
  build: () => "",
};

// const MODULE_PLANNING_HINT: PromptModuleDef = {
//   id: "orchestrator.planning",
//   version: "1",
//   build: (ctx) => {
//     if (ctx.planningMode === "never") return "";
//     if (ctx.planningMode === "always") {
//       return "Before answering, outline a brief internal plan (do not expose raw chain-of-thought; provide a short structured approach in the reply if helpful).";
//     }
//     return "";
//   },
// };

const REGISTRY: Record<string, PromptModuleDef> = {
  [MODULE_GLOBAL_CHAT.id]: MODULE_GLOBAL_CHAT,
  [MODULE_WORKBENCH.id]: MODULE_WORKBENCH,
  [MODULE_INSIGHT_BUILDER.id]: MODULE_INSIGHT_BUILDER,
  [MODULE_RESEARCH.id]: MODULE_RESEARCH,
  [MODULE_RESEARCH_PLANNER.id]: MODULE_RESEARCH_PLANNER,
  [MODULE_RESEARCH_ANALYST.id]: MODULE_RESEARCH_ANALYST,
  [MODULE_RESEARCH_SYNTHESIS.id]: MODULE_RESEARCH_SYNTHESIS,
  // [MODULE_PLANNING_HINT.id]: MODULE_PLANNING_HINT,
};

function routeModuleIds(ctx: PromptComposeContext): string[] {
  const ids: string[] = [];
  switch (ctx.chatType) {
    case "workbench":
      ids.push(MODULE_WORKBENCH.id);
      break;
    case "insight_builder":
      ids.push(MODULE_INSIGHT_BUILDER.id);
      break;
    case "research":
      ids.push(
        MODULE_RESEARCH.id,
        MODULE_RESEARCH_PLANNER.id,
        MODULE_RESEARCH_ANALYST.id,
        MODULE_RESEARCH_SYNTHESIS.id,
      );
      break;
    default:
      ids.push(MODULE_GLOBAL_CHAT.id);
      break;
  }
  // Research always runs the full pipeline (Wave 3 locked decision #2):
  // planningMode does not gate research, so skip the planning hint module.
  // if (
  //   ctx.chatType !== "research" &&
  //   (ctx.planningMode === "always" || ctx.planningMode === "auto")
  // ) {
  //   ids.push(MODULE_PLANNING_HINT.id);
  // }
  ids.push(`surface.${ctx.surface ?? "unknown"}`);
  ids.push(`scope.${ctx.scopeType ?? "global_session"}`);
  return ids;
}

export function hashPromptModules(modules: string[]): string {
  return createHash("sha256")
    .update(modules.sort().join("|"))
    .digest("hex")
    .slice(0, 12);
}

export function composePromptBundle(ctx: PromptComposeContext): ComposedPromptBundle {
  const moduleIds = routeModuleIds(ctx);
  const systemSections: string[] = [];
  for (const id of moduleIds) {
    const mod = REGISTRY[id];
    if (mod) {
      const text = mod.build(ctx).trim();
      if (text) systemSections.push(text);
    }
  }
  const versionKeys = moduleIds.map((id) => {
    const mod = REGISTRY[id];
    return mod ? `${id}@${mod.version}` : `${id}@0`;
  });
  const bundleHash = hashPromptModules([
    ...versionKeys,
    // ctx.planningMode ?? "auto",
    ctx.deepAnalysis ? "deep:1" : "deep:0",
  ]);
  return { moduleIds, bundleHash, systemSections };
}
