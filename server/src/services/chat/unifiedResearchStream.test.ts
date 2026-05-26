import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  buildResearchPollModeMarkdown,
  mapEventToLine,
  RESEARCH_POLL_MODE_METADATA_KEY,
} from "./unifiedResearchStream.js";

vi.mock("../research/orchestrator.js", () => ({
  createSession: vi.fn(),
  runResearchPipeline: vi.fn(),
  runFollowUp: vi.fn(),
  getSession: vi.fn(),
  loadSession: vi.fn(),
  isSessionRunning: vi.fn(() => false),
}));

vi.mock("../../config/tenantDatabaseManager.js", () => ({
  tenantDbManager: { getTenantPool: vi.fn() },
}));

describe("unifiedResearchStream poll mode helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exports researchPollMode metadata key", () => {
    expect(RESEARCH_POLL_MODE_METADATA_KEY).toBe("researchPollMode");
  });

  it("buildResearchPollModeMarkdown for new investigation", () => {
    expect(
      buildResearchPollModeMarkdown({ topic: "Branch 2001", phase: "planning" }, ""),
    ).toContain("Research investigation started");
    expect(
      buildResearchPollModeMarkdown({ topic: "Branch 2001", phase: "planning" }, ""),
    ).toContain("Branch 2001");
  });

  it("buildResearchPollModeMarkdown for follow-up on complete session", () => {
    expect(
      buildResearchPollModeMarkdown({ topic: "TTS", phase: "complete" }, "dig deeper"),
    ).toContain("Continuing research");
  });

  it("mapEventToLine maps complete events", () => {
    expect(
      mapEventToLine({
        type: "complete",
        data: { findingCount: 3 },
      } as any),
    ).toContain("3 findings");
  });
});
