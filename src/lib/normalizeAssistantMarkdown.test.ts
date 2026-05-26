import { describe, expect, it } from "vitest";
import { normalizeAssistantMarkdown } from "./normalizeAssistantMarkdown";

describe("normalizeAssistantMarkdown", () => {
  it("normalizes mixed bullet prefixes", () => {
    const input = "* first\n• second\n- third";
    const out = normalizeAssistantMarkdown(input);
    expect(out).toBe("- first\n- second\n- third");
  });

  it("normalizes mixed numbering", () => {
    const input = "1) one\n2 - two\n3. three";
    const out = normalizeAssistantMarkdown(input);
    expect(out).toContain("1. one");
    expect(out).toContain("2. two");
    expect(out).toContain("3. three");
  });

  it("leaves fenced code unchanged", () => {
    const input = "```sql\nSELECT 1\n```";
    expect(normalizeAssistantMarkdown(input)).toBe(input);
  });

  it("no-op on well-formed markdown", () => {
    const input = "- alpha\n- beta\n\nParagraph.";
    expect(normalizeAssistantMarkdown(input)).toBe(input);
  });
});
