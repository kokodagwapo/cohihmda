import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isCohiChatTourLandingPath,
  recordCohiChatAnnounceHandled,
  shouldShowCohiChatChangesAnnounce,
} from "@/lib/cohiChatTourAnnounce";

describe("cohiChatTourAnnounce", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("shows when announce has not been handled", () => {
    expect(shouldShowCohiChatChangesAnnounce()).toBe(true);
  });

  it("hides after local announce is handled", () => {
    recordCohiChatAnnounceHandled();
    expect(shouldShowCohiChatChangesAnnounce()).toBe(false);
  });

  it("hides when server announce is handled", () => {
    expect(
      shouldShowCohiChatChangesAnnounce({
        serverHandledAt: "2026-05-21T12:00:00.000Z",
      }),
    ).toBe(false);
  });

  it("recognizes chat tour landing routes", () => {
    expect(isCohiChatTourLandingPath("/")).toBe(true);
    expect(isCohiChatTourLandingPath("/insights")).toBe(true);
    expect(isCohiChatTourLandingPath("/workbench")).toBe(false);
  });
});
