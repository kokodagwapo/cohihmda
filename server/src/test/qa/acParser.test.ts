import { describe, expect, it } from "vitest";
import { parseAcceptanceCriteria } from "../../../scripts/qa/ai/acParser.js";

describe("acParser", () => {
  it("parses a well-formed acceptance criteria block", () => {
    const parsed = parseAcceptanceCriteria(`
## Acceptance Criteria

1. [ROUTE] Navigating to /workbench/agents renders a heading "Agents"
2. [API] GET /api/cohi-workbench/agents returns 200
3. [ASSERTION] The page shows a "New Agent" button
    `);

    expect("statements" in parsed).toBe(true);
    if ("statements" in parsed) {
      expect(parsed.statements).toHaveLength(3);
      expect(parsed.statements[0].category).toBe("ROUTE");
      expect(parsed.statements[1].category).toBe("API");
    }
  });

  it("returns a parse error when no valid statements are found", () => {
    const parsed = parseAcceptanceCriteria(`
## Acceptance Criteria

- [UI] This is not numbered correctly
    `);

    expect("error" in parsed).toBe(true);
    if ("error" in parsed) {
      expect(parsed.error).toMatch(/numbered/i);
    }
  });
});
