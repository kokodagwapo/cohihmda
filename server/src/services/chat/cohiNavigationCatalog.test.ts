import { describe, it, expect } from "vitest";
import {
  expandEffectiveQuestionForNavigation,
  resolveNavigationAnswer,
  isNavigationIntent,
  buildGuidanceResponse,
} from "./cohiNavigationCatalog.js";
import { sanitizeNavigationHints } from "./unifiedChatPolicy.js";

describe("cohiNavigationCatalog", () => {
  it("resolves company pull-through to scorecard and related dashboards", () => {
    const q = "where can I track current company pullthrough?";
    expect(isNavigationIntent(q)).toBe(true);
    const nav = resolveNavigationAnswer(q);
    expect(nav).not.toBeNull();
    expect(nav!.hints.some((h) => h.path === "/company-scorecard")).toBe(true);
    expect(nav!.hints.some((h) => h.path === "/business-overview")).toBe(true);
  });

  it("resolves common pull-through typo forms to navigation hints", () => {
    const q = "where can i see my company pullthough performance?";
    expect(isNavigationIntent(q)).toBe(true);
    const nav = resolveNavigationAnswer(q);
    expect(nav).not.toBeNull();
    expect(nav!.hints.some((h) => h.path === "/company-scorecard")).toBe(true);
  });

  it("handles typo-heavy dashboard phrasing across nav concepts", () => {
    const q = "wher can i se the dashbord for workfow conversoin?";
    expect(isNavigationIntent(q)).toBe(true);
    const nav = resolveNavigationAnswer(q);
    expect(nav).not.toBeNull();
    expect(nav!.hints.some((h) => h.path === "/workflow-conversion")).toBe(true);
  });

  it("maps yes give me a page follow-up to prior navigation question", () => {
    const history = [
      { role: "user" as const, content: "where can I track pull-through?" },
      {
        role: "assistant" as const,
        content: "Some analysis without links.",
      },
    ];
    const expanded = expandEffectiveQuestionForNavigation(
      "yes give me a page",
      history,
    );
    expect(expanded.toLowerCase()).toContain("pull");
    const nav = resolveNavigationAnswer(expanded.trim());
    expect(nav).not.toBeNull();
    expect(sanitizeNavigationHints(nav!.hints).length).toBeGreaterThan(0);
  });

  it("treats definition-only questions as non-navigation intent", () => {
    const q = "what is pull-through rate in mortgage lending?";
    expect(isNavigationIntent(q)).toBe(false);
    // resolveNavigationAnswer may still match keywords; cohiChatService only uses it when isNavigationIntent passes.
  });

  it("does not route broad daily-summary asks to navigation fallback", () => {
    const q = "What's important to know today?";
    expect(isNavigationIntent(q)).toBe(false);
    expect(resolveNavigationAnswer(q)).toBeNull();
  });

  it("buildGuidanceResponse includes help and insights links", () => {
    const g = buildGuidanceResponse();
    const safe = sanitizeNavigationHints(g.hints);
    expect(safe.some((h) => h.path.startsWith("/help/cohi-chat/"))).toBe(true);
    expect(safe.some((h) => h.path === "/insights")).toBe(true);
  });

  it("includes research suggestion for navigation answers", () => {
    const nav = resolveNavigationAnswer(
      "where can i see my company pullthough performance?",
    );
    expect(nav).not.toBeNull();
    expect(
      (nav?.suggestedQuestions ?? []).some((q) =>
        q.toLowerCase().includes("research lab"),
      ),
    ).toBe(true);
  });
});
