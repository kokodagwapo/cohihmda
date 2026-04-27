import { describe, expect, it } from "vitest";
import {
  buildActorStatusIndex,
  buildActorStatusSummary,
  filterActorsByStatus,
  normalizeActorLookupKey,
  normalizeActorStatusFilter,
  resolveActorStatus,
} from "./actorStatusService.js";

describe("actorStatusService", () => {
  it("normalizes actor lookup keys", () => {
    expect(normalizeActorLookupKey("  Jane   LO  ")).toBe("jane lo");
    expect(normalizeActorLookupKey(null)).toBe("");
  });

  it("matches users by Encompass user id before fallback name", () => {
    const index = buildActorStatusIndex([
      {
        encompass_user_id: "lo-123",
        username: "inactive.user",
        full_name: "Inactive User",
        is_enabled: false,
        encompass_last_login: "2026-04-20T12:00:00.000Z",
      },
    ]);

    const status = resolveActorStatus(index, {
      actorId: "LO-123",
      actorName: "Someone Else",
    });

    expect(status.actorStatus).toBe("Inactive");
    expect(status.actorStatusMatchType).toBe("id");
    expect(status.lastLogin).toBe("2026-04-20T12:00:00.000Z");
  });

  it("falls back to normalized full name or username", () => {
    const index = buildActorStatusIndex([
      {
        encompass_user_id: "lo-456",
        username: "active.user",
        full_name: "Active User",
        is_enabled: true,
        encompass_last_login: null,
      },
    ]);

    expect(resolveActorStatus(index, { actorName: " active   user " })).toMatchObject({
      actorStatus: "Active",
      actorStatusMatchType: "name",
    });
    expect(resolveActorStatus(index, { actorName: "ACTIVE.USER" })).toMatchObject({
      actorStatus: "Active",
      actorStatusMatchType: "name",
    });
  });

  it("keeps branch and unmatched actors unknown", () => {
    const index = buildActorStatusIndex([]);
    expect(resolveActorStatus(index, { actorKind: "branch", actorName: "Main" })).toMatchObject({
      actorStatus: "Unknown",
      actorStatusMatchType: "branch",
    });
    expect(resolveActorStatus(index, { actorName: "Missing Person" })).toMatchObject({
      actorStatus: "Unknown",
      actorStatusMatchType: "unknown",
    });
  });

  it("normalizes and applies actor status filters", () => {
    const actors = [
      { name: "Active", actorStatus: "Active" as const },
      { name: "Inactive", actorStatus: "Inactive" as const },
      { name: "Unknown", actorStatus: "Unknown" as const },
    ];

    expect(normalizeActorStatusFilter("active-only")).toBe("active");
    expect(normalizeActorStatusFilter("inactive_only")).toBe("inactive");
    expect(filterActorsByStatus(actors, "active").map((actor) => actor.name)).toEqual(["Active"]);
    expect(filterActorsByStatus(actors, "inactive").map((actor) => actor.name)).toEqual(["Inactive"]);
    expect(filterActorsByStatus(actors, "all")).toHaveLength(3);
  });

  it("builds reconciliation summaries", () => {
    expect(
      buildActorStatusSummary([
        { actorStatus: "Active" },
        { actorStatus: "Inactive" },
        { actorStatus: "Unknown" },
      ]),
    ).toEqual({
      totalActors: 3,
      matchedActors: 2,
      unmatchedActors: 1,
      activeActors: 1,
      inactiveActors: 1,
      unknownActors: 1,
    });
  });
});
