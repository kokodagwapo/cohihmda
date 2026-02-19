/**
 * Workflow conversion milestones in display order.
 * Used for dropdowns and validation (earlier milestone on left, later on right).
 */

export interface WorkflowMilestone {
  id: string;
  label: string;
}

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

export function getMilestoneIndex(id: string): number {
  const i = ORDER_INDEX.get(id);
  return i ?? -1;
}

export function isOrderValid(fromId: string, toId: string): boolean {
  const fromIdx = getMilestoneIndex(fromId);
  const toIdx = getMilestoneIndex(toId);
  return fromIdx >= 0 && toIdx >= 0 && fromIdx < toIdx;
}

export function getMilestonesAfter(id: string): WorkflowMilestone[] {
  const idx = getMilestoneIndex(id);
  if (idx < 0) return [];
  return WORKFLOW_MILESTONES_ORDER.slice(idx + 1);
}

export function getMilestonesBefore(id: string): WorkflowMilestone[] {
  const idx = getMilestoneIndex(id);
  if (idx <= 0) return [];
  return WORKFLOW_MILESTONES_ORDER.slice(0, idx);
}

/** Pre-populated 6 segments: Started→Application, Application→Processing, ... */
export const DEFAULT_WORKFLOW_SEGMENTS: { from: string; to: string }[] = [
  { from: "started", to: "application" },
  { from: "application", to: "processing" },
  { from: "processing", to: "submitted_to_underwriting" },
  { from: "submitted_to_underwriting", to: "uw_final_approval" },
  { from: "uw_final_approval", to: "ctc" },
  { from: "ctc", to: "funding" },
];
