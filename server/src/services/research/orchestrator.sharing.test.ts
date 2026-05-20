import { describe, expect, it } from "vitest";
import {
  canAccessSession,
  researchUserIdsEqual,
  type ResearchSession,
} from "./orchestrator.js";

function baseSession(overrides: Partial<ResearchSession> = {}): ResearchSession {
  return {
    id: "550e8400-e29b-41d4-a716-446655440001",
    tenantId: "tenant-a",
    userId: "550e8400-e29b-41d4-a716-446655440099",
    userEmail: "owner@example.com",
    phase: "complete",
    findings: [],
    events: [],
    followUpHistory: [],
    steeringDirectives: [],
    createdAt: Date.now(),
    pauseRequested: false,
    paused: false,
    _emitters: [],
    _isRunning: false,
    visibility: "private",
    ...overrides,
  };
}

describe("researchUserIdsEqual", () => {
  it("matches UUID strings case-insensitively", () => {
    const id = "550e8400-e29b-41d4-a716-446655440099";
    expect(researchUserIdsEqual(id, id.toUpperCase())).toBe(true);
  });
});

describe("canAccessSession", () => {
  it("allows owner regardless of visibility", () => {
    const session = baseSession({ visibility: "private" });
    expect(canAccessSession(session, session.userId)).toBe(true);
  });

  it("allows any tenant user when visibility is global", () => {
    const session = baseSession({ visibility: "global" });
    expect(
      canAccessSession(session, "550e8400-e29b-41d4-a716-446655440002"),
    ).toBe(true);
  });

  it("allows listed users when visibility is shared", () => {
    const viewer = "550e8400-e29b-41d4-a716-446655440002";
    const session = baseSession({
      visibility: "shared",
      sharedWithUserIds: [viewer.toUpperCase()],
    });
    expect(canAccessSession(session, viewer)).toBe(true);
    expect(
      canAccessSession(session, "550e8400-e29b-41d4-a716-446655440003"),
    ).toBe(false);
  });

  it("denies non-owner when private", () => {
    const session = baseSession({ visibility: "private" });
    expect(
      canAccessSession(session, "550e8400-e29b-41d4-a716-446655440002"),
    ).toBe(false);
  });
});
