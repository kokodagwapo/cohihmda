/**
 * Workflow conversion milestones.
 * WORKFLOW_MILESTONES_ORDER is the legacy fixed list (for backward compat).
 * Dynamic milestone lists come from the API (all date columns in the tenant's loans table).
 * Use isOrderValidWithMilestones(from, to, milestones) when using a dynamic list.
 */

export interface WorkflowMilestone {
  id: string;
  label: string;
}

/** Legacy ordered list (kept for backward compatibility). */
export const WORKFLOW_MILESTONES_ORDER: WorkflowMilestone[] = [
  { id: "started", label: "Started" },
  { id: "application", label: "Application" },
  { id: "lock", label: "Lock" },
  { id: "processing", label: "Processing" },
  { id: "submittal", label: "Submittal" },
  { id: "submitted_to_underwriting", label: "Submitted to Underwriting" },
  { id: "conditional_approval", label: "Conditional Approval" },
  { id: "resubmittal", label: "Resubmittal" },
  { id: "uw_final_approval", label: "UW Final Approval" },
  { id: "ctc", label: "CTC" },
  { id: "closing", label: "Closing" },
  { id: "funding", label: "Funding" },
  { id: "shipped", label: "Shipped" },
];

const ORDER_INDEX = new Map(WORKFLOW_MILESTONES_ORDER.map((m, i) => [m.id, i]));

export function getMilestoneIndex(id: string, milestones?: WorkflowMilestone[]): number {
  if (milestones) {
    const i = milestones.findIndex((m) => m.id === id);
    return i ?? -1;
  }
  const i = ORDER_INDEX.get(id);
  return i ?? -1;
}

export function isOrderValid(fromId: string, toId: string, milestones?: WorkflowMilestone[]): boolean {
  const list = milestones ?? WORKFLOW_MILESTONES_ORDER;
  const fromIdx = getMilestoneIndex(fromId, list);
  const toIdx = getMilestoneIndex(toId, list);
  return fromIdx >= 0 && toIdx >= 0 && fromIdx < toIdx;
}

/** When using dynamic milestones (no fixed order), valid = from !== to and both ids in the list. */
export function isOrderValidWithMilestones(
  fromId: string,
  toId: string,
  milestones: { id: string }[]
): boolean {
  if (fromId === toId) return false;
  const idSet = new Set(milestones.map((m) => m.id));
  return idSet.has(fromId) && idSet.has(toId);
}

export function getMilestonesAfter(id: string, milestones?: WorkflowMilestone[]): WorkflowMilestone[] {
  const list = milestones ?? WORKFLOW_MILESTONES_ORDER;
  const idx = getMilestoneIndex(id, list);
  if (idx < 0) return [];
  return list.slice(idx + 1);
}

export function getMilestonesBefore(id: string, milestones?: WorkflowMilestone[]): WorkflowMilestone[] {
  const list = milestones ?? WORKFLOW_MILESTONES_ORDER;
  const idx = getMilestoneIndex(id, list);
  if (idx <= 0) return [];
  return list.slice(0, idx);
}

/** Pre-populated 6 segments using column names (compatible with dynamic milestone dropdowns). */
export const DEFAULT_WORKFLOW_SEGMENTS: { from: string; to: string }[] = [
  { from: "started_date", to: "application_date" },
  { from: "application_date", to: "processing_date" },
  { from: "processing_date", to: "submitted_to_underwriting_date" },
  { from: "submitted_to_underwriting_date", to: "uw_final_approval_date" },
  { from: "uw_final_approval_date", to: "ctc_date" },
  { from: "ctc_date", to: "funding_date" },
];
