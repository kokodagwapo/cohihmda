/**
 * Feature gates for metric composer rollout — platform_settings + env overrides.
 */

import { getPlatformSetting } from "../platformSettingsService.js";

export type MetricComposerSurface =
  | "chat"
  | "workbench"
  | "insights"
  | "research";

function truthy(v: string | null): boolean | null {
  if (v == null || v === "") return null;
  const x = v.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(x)) return true;
  if (["0", "false", "no", "off"].includes(x)) return false;
  return null;
}

/**
 * When true, planner → MetricSpec → compose path is used (per surface).
 * Default: enabled unless METRIC_COMPOSER_ENABLED=0 or platform metric_composer_enabled=false.
 */
export async function isMetricComposerEnabledForSurface(
  surface: MetricComposerSurface
): Promise<boolean> {
  const env = process.env.METRIC_COMPOSER_ENABLED;
  const envParsed = env !== undefined ? truthy(env) : null;
  if (envParsed === false) return false;
  if (envParsed === true) {
    return !isSurfaceDisabledByEnv(surface);
  }

  try {
    const globalFlag = await getPlatformSetting("metric_composer_enabled");
    const g = truthy(globalFlag);
    if (g === false) return false;
  } catch {
    // ignore
  }

  try {
    const key = `metric_composer_${surface}_enabled`;
    const per = await getPlatformSetting(key);
    const p = truthy(per);
    if (p === false) return false;
    if (p === true) return true;
  } catch {
    // ignore
  }

  if (isSurfaceDisabledByEnv(surface)) return false;

  return true;
}

function isSurfaceDisabledByEnv(surface: MetricComposerSurface): boolean {
  const map: Record<MetricComposerSurface, string | undefined> = {
    chat: process.env.METRIC_COMPOSER_CHAT_ENABLED,
    workbench: process.env.METRIC_COMPOSER_WORKBENCH_ENABLED,
    insights: process.env.METRIC_COMPOSER_INSIGHTS_ENABLED,
    research: process.env.METRIC_COMPOSER_RESEARCH_ENABLED,
  };
  const v = map[surface];
  const t = v !== undefined ? truthy(v) : null;
  return t === false;
}
