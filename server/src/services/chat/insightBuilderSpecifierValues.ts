/**
 * Validate insight builder text filter values against tenant distinct values.
 */

import type { Pool } from "pg";
import { columnToLabel } from "../ai/schemaContextService.js";
import { fetchDistinctValuesForColumn } from "./loanDistinctValues.js";
import {
  isExactDistinctValueMatch,
  suggestLoanColumnValues,
} from "./suggestLoanColumnValues.js";

export type SpecifierValueClarificationReason = "unknown" | "ambiguous";

export interface SpecifierValueClarification {
  column: string;
  columnLabel: string;
  userValue: string;
  suggestedValues: string[];
  reason: SpecifierValueClarificationReason;
}

function parseTextValues(specifiers: Record<string, unknown>, column: string): string[] {
  const raw = specifiers[column];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const o = raw as Record<string, unknown>;
  if (o.kind === "text" && Array.isArray(o.selectedValues)) {
    return o.selectedValues.map((x) => String(x).trim()).filter(Boolean);
  }
  if (o.kind === "number" && o.mode === "all" && Array.isArray(o.selectedValues)) {
    return o.selectedValues.map((x) => String(x).trim()).filter(Boolean);
  }
  return [];
}

async function getDistinctForColumn(
  tenantPool: Pool,
  tenantId: string,
  column: string,
  cache: Map<string, Promise<string[]>>,
): Promise<string[]> {
  const key = `${tenantId}:${column}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = fetchDistinctValuesForColumn(tenantPool, column);
    cache.set(key, pending);
  }
  return pending;
}

export function buildValueClarificationMessage(
  issues: SpecifierValueClarification[],
): string {
  const parts: string[] = [
    "I couldn't match one or more filter values to what's in your loans data. Please clarify:",
  ];
  for (const issue of issues) {
    const label = issue.columnLabel || issue.column;
    if (issue.reason === "ambiguous" && issue.suggestedValues.length > 1) {
      const list = issue.suggestedValues.map((v) => `**${v}**`).join(", ");
      parts.push(
        `- For **${label}**, **${issue.userValue}** could mean several values: ${list}. Which should I use?`,
      );
    } else if (issue.suggestedValues.length) {
      const list = issue.suggestedValues.map((v) => `**${v}**`).join(", ");
      parts.push(
        `- I couldn't find **${issue.userValue}** in **${label}**. Did you mean ${list}?`,
      );
    } else {
      parts.push(
        `- **${issue.userValue}** doesn't appear in **${label}**. Reply with the exact value from your data.`,
      );
    }
  }
  parts.push("Reply with the exact value(s), then I'll update the draft.");
  return parts.join("\n\n");
}

export async function findSpecifierValueClarifications(
  tenantPool: Pool,
  tenantId: string,
  specifiers: Record<string, unknown>,
): Promise<SpecifierValueClarification[]> {
  const issues: SpecifierValueClarification[] = [];
  const distinctCache = new Map<string, Promise<string[]>>();

  for (const column of Object.keys(specifiers)) {
    if (column === "_prompt_tag") continue;
    const userValues = parseTextValues(specifiers, column);
    if (!userValues.length) continue;

    const distinct = await getDistinctForColumn(
      tenantPool,
      tenantId,
      column,
      distinctCache,
    );
    if (!distinct.length) continue;

    const columnLabel = columnToLabel(column);

    for (const userValue of userValues) {
      const exact = distinct.some((d) => isExactDistinctValueMatch(userValue, d));
      if (exact) continue;

      const suggestions = suggestLoanColumnValues(userValue, distinct, 5);
      const reason: SpecifierValueClarificationReason =
        suggestions.length > 1 ? "ambiguous" : "unknown";

      issues.push({
        column,
        columnLabel,
        userValue,
        suggestedValues: suggestions,
        reason,
      });
    }
  }

  return issues;
}
