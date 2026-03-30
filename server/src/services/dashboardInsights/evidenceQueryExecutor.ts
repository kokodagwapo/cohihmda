import type { Pool } from "pg";
import type { DashboardPageContext, SupportingData } from "./types.js";
import type { EvidenceIntent } from "./evidenceProfiles.js";

export interface EvidenceQueryContext {
  tenantPool: Pool;
  pageContext: DashboardPageContext;
}

export interface EvidenceQueryProvider {
  execute: (
    intent: EvidenceIntent,
    context: EvidenceQueryContext
  ) => Promise<SupportingData | undefined>;
}

/**
 * Generic execution shim. Page-specific providers should contain domain logic.
 */
export async function executeEvidenceIntent(
  intent: EvidenceIntent,
  context: EvidenceQueryContext,
  provider?: EvidenceQueryProvider
): Promise<SupportingData | undefined> {
  if (!provider) return undefined;
  return provider.execute(intent, context);
}
