import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COHI_CHAT_TOUR_PAGE_PATH,
  COHI_CHAT_TOUR_START_DELAY_MS,
  scheduleCohiChatTourStart,
} from "@/lib/cohiChatTour";

describe("scheduleCohiChatTourStart", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts immediately on insights", () => {
    const navigate = vi.fn();
    const startTour = vi.fn();
    scheduleCohiChatTourStart(navigate, startTour, COHI_CHAT_TOUR_PAGE_PATH);
    expect(startTour).toHaveBeenCalledWith("cohi-chat");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("navigates to insights then starts the tour", () => {
    const navigate = vi.fn();
    const startTour = vi.fn();
    scheduleCohiChatTourStart(navigate, startTour, "/");
    expect(navigate).toHaveBeenCalledWith(COHI_CHAT_TOUR_PAGE_PATH, {
      replace: true,
    });
    expect(startTour).not.toHaveBeenCalled();
    vi.advanceTimersByTime(COHI_CHAT_TOUR_START_DELAY_MS);
    expect(startTour).toHaveBeenCalledWith("cohi-chat");
  });
});
