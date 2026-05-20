/**
 * Artifact helpers for unified chat visualization blocks (COHI-394).
 */

import { randomUUID } from "crypto";
import type { VisualizationConfig } from "../ai/cohiChatService.js";

export interface StoredArtifactRef {
  artifactId: string;
  kind: "visualization" | "chart_ref" | "export";
  createdAt: string;
}

/** v1: in-memory is not required; stable UUID per turn is sufficient for reload handoff. */
export function createVisualizationArtifactId(existing?: string): string {
  return existing && existing.length > 0 ? existing : randomUUID();
}

export function visualizationBlock(
  config: VisualizationConfig,
  artifactId?: string,
): {
  type: "visualization";
  artifactId: string;
  config: VisualizationConfig;
} {
  return {
    type: "visualization",
    artifactId: createVisualizationArtifactId(artifactId),
    config,
  };
}

/** Documented v1 TTL policy: no server-side eviction yet. */
export const ARTIFACT_TTL_POLICY_V1 = "none" as const;
