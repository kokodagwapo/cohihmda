import { describe, expect, it } from "vitest";
import {
  buildActorNameLookupKeys,
  buildActorStatusIndex,
  buildActorStatusSummary,
  filterActorsByStatus,
  normalizeActorLookupKey,
  normalizeActorStatusFilter,
  resolveActorStatus,
  resolveActorStatusWithTrace,
} from "./actorStatusService.js";

describe("actorStatusService", () => {
  it("normalizes actor lookup keys", () => {
    expect(normalizeActorLookupKey("  Jane   LO  ")).toBe("jane lo");
    expect(normalizeActorLookupKey(null)).toBe("");
    expect(buildActorNameLookupKeys("Stanley Edward Obrecht Jr.")).toEqual([
      "stanley edward obrecht jr.",
      "stanley obrecht",
    ]);
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

  it("matches loan names with middle names or suffixes to Encompass first/last names", () => {
    const index = buildActorStatusIndex([
      {
        encompass_user_id: "j_obrecht",
        username: "j_obrecht",
        full_name: "Stanley Obrecht",
        is_enabled: true,
        encompass_last_login: null,
      },
      {
        encompass_user_id: "s.rosen",
        username: "s.rosen",
        full_name: "Sharon Rosen",
        is_enabled: true,
        encompass_last_login: null,
      },
    ]);

    expect(resolveActorStatus(index, { actorName: "Stanley Edward Obrecht Jr." })).toMatchObject({
      actorStatus: "Active",
      actorStatusMatchType: "name",
    });
    expect(resolveActorStatus(index, { actorName: "Sharon Shechter Rosen" })).toMatchObject({
      actorStatus: "Active",
      actorStatusMatchType: "name",
    });
  });

  it("keeps branch and actors without synced user data unknown", () => {
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

  it("marks unmatched loan actors as removed when Encompass users are synced", () => {
    const index = buildActorStatusIndex([
      {
        encompass_user_id: "active.user",
        username: "active.user",
        full_name: "Active User",
        is_enabled: true,
        encompass_last_login: null,
      },
    ]);

    expect(resolveActorStatus(index, { actorName: "Former User" })).toMatchObject({
      actorStatus: "Removed",
      actorStatusMatchType: "removed",
    });
  });

  it("resolveActorStatusWithTrace records id vs name attempts", () => {
    const index = buildActorStatusIndex([
      {
        encompass_user_id: "guid-a",
        username: "jdoe",
        full_name: "Jane Doe",
        is_enabled: true,
        encompass_last_login: null,
      },
    ]);

    const idMatch = resolveActorStatusWithTrace(index, {
      actorId: "GUID-A",
      actorName: "Wrong Name",
    });
    expect(idMatch.metadata.actorStatusMatchType).toBe("id");
    expect(idMatch.trace.idHit).toBe(true);
    expect(idMatch.trace.nameHit).toBe(false);

    const nameMatch = resolveActorStatusWithTrace(index, {
      actorId: "not-in-index",
      actorName: "jane doe",
    });
    expect(nameMatch.metadata.actorStatusMatchType).toBe("name");
    expect(nameMatch.trace.idHit).toBe(false);
    expect(nameMatch.trace.nameHit).toBe(true);

    const miss = resolveActorStatusWithTrace(index, {
      actorId: "other-guid",
      actorName: "Nobody",
    });
    expect(miss.metadata.actorStatus).toBe("Removed");
    expect(miss.metadata.actorStatusMatchType).toBe("removed");
    expect(miss.trace.triedIdLookup).toBe(true);
    expect(miss.trace.triedNameLookup).toBe(true);
    expect(miss.trace.idHit).toBe(false);
    expect(miss.trace.nameHit).toBe(false);
  });

  it("normalizes and applies actor status filters", () => {
    const actors = [
      { name: "Active", actorStatus: "Active" as const },
      { name: "Inactive", actorStatus: "Inactive" as const },
      { name: "Removed", actorStatus: "Removed" as const },
      { name: "Unknown", actorStatus: "Unknown" as const },
    ];

    expect(normalizeActorStatusFilter("active-only")).toBe("active");
    expect(normalizeActorStatusFilter("inactive_only")).toBe("inactive");
    expect(filterActorsByStatus(actors, "active").map((actor) => actor.name)).toEqual(["Active"]);
    expect(filterActorsByStatus(actors, "inactive").map((actor) => actor.name)).toEqual(["Inactive", "Removed"]);
    expect(filterActorsByStatus(actors, "all")).toHaveLength(4);
  });

  it("builds reconciliation summaries", () => {
    expect(
      buildActorStatusSummary([
        { actorStatus: "Active" },
        { actorStatus: "Inactive" },
        { actorStatus: "Removed" },
        { actorStatus: "Unknown" },
      ]),
    ).toEqual({
      totalActors: 4,
      matchedActors: 2,
      unmatchedActors: 2,
      activeActors: 1,
      inactiveActors: 1,
      removedActors: 1,
      unknownActors: 1,
    });
  });
});
