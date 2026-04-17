import type { QaTargetIssue } from "../lib/atlassianReporter.js";
import type { IssueAcValidationResult } from "./types.js";

export function mergeAcIntoTargets(
  targets: QaTargetIssue[],
  acResults: IssueAcValidationResult[],
): QaTargetIssue[] {
  const byIssueKey = new Map(acResults.map((result) => [result.issueKey, result]));
  return targets.map((target) => ({
    ...target,
    acValidation: byIssueKey.get(target.issueKey),
  }));
}
