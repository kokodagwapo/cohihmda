import { AcStatementSchema, type ACStatement } from "./types.js";

const ACCEPTANCE_CRITERIA_HEADING_REGEX = /(?:^|\n)(?:#{1,6}\s*)?Acceptance Criteria\s*(?:\n|$)/i;
const STATEMENT_REGEX = /^\s*(\d+)[.)]\s*\[([A-Z]+)\]\s+(.+?)\s*$/i;
const VALID_CATEGORIES = new Set(["ROUTE", "UI", "API", "ASSERTION", "STATE"]);

export interface ParseAcSuccess {
  statements: ACStatement[];
  blockText: string;
}

export interface ParseAcFailure {
  error: string;
  blockText?: string;
}

export function extractAcceptanceCriteriaBlock(descriptionText: string): string | null {
  const normalized = descriptionText.replace(/\r/g, "").trim();
  const headingMatch = ACCEPTANCE_CRITERIA_HEADING_REGEX.exec(normalized);
  if (!headingMatch) {
    return null;
  }

  const afterHeading = normalized.slice(headingMatch.index + headingMatch[0].length);
  const nextHeadingMatch = /\n#{1,6}\s+/.exec(afterHeading);
  const rawBlock = (nextHeadingMatch ? afterHeading.slice(0, nextHeadingMatch.index) : afterHeading).trim();
  return rawBlock || null;
}

function normalizeBlockLines(blockText: string): string[] {
  return blockText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && line !== "```");
}

export function parseAcceptanceCriteria(descriptionText: string): ParseAcSuccess | ParseAcFailure {
  const blockText = extractAcceptanceCriteriaBlock(descriptionText);
  if (!blockText) {
    return { error: "Acceptance Criteria heading or block not found" };
  }

  const lines = normalizeBlockLines(blockText);
  if (lines.some((line) => line.includes("|"))) {
    return { error: "Acceptance Criteria block must not contain markdown tables", blockText };
  }

  const statements: ACStatement[] = [];
  for (const line of lines) {
    const match = STATEMENT_REGEX.exec(line);
    if (!match) {
      continue;
    }

    const index = Number(match[1]);
    const category = match[2].toUpperCase();
    const statement = match[3].trim();

    if (!VALID_CATEGORIES.has(category)) {
      return {
        error: `Unsupported acceptance-criteria category "${match[2]}"`,
        blockText,
      };
    }

    const parsed = AcStatementSchema.safeParse({
      index,
      category,
      statement,
      raw: line,
    });
    if (!parsed.success) {
      return {
        error: parsed.error.issues.map((issue) => issue.message).join("; "),
        blockText,
      };
    }

    statements.push(parsed.data);
  }

  if (statements.length === 0) {
    return {
      error: "No numbered acceptance criteria statements were found",
      blockText,
    };
  }

  const hasMinimumSignal = statements.some(
    (statement) => statement.category === "ASSERTION" || statement.category === "ROUTE",
  );
  if (!hasMinimumSignal) {
    return {
      error: "Acceptance Criteria must contain at least one [ASSERTION] or [ROUTE] statement",
      blockText,
    };
  }

  return { statements, blockText };
}
