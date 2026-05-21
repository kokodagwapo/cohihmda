import { describe, expect, it } from "vitest";
import {
  ROW_PROMPT_CARD_WIDTH_PX,
  resolveChatTypePromptCardsLayout,
  rowPromptCardsGapCss,
} from "./ChatTypeSuggestedPromptCards";

describe("resolveChatTypePromptCardsLayout", () => {
  it("returns row for tall and full-page shell", () => {
    expect(resolveChatTypePromptCardsLayout("shell", "tall")).toBe("row");
    expect(resolveChatTypePromptCardsLayout("shell", "full")).toBe("row");
  });

  it("returns row for rail when panel is fullscreen", () => {
    expect(resolveChatTypePromptCardsLayout("rail", "compact", true)).toBe("row");
  });

  it("returns grid for docked rail and split shell", () => {
    expect(resolveChatTypePromptCardsLayout("rail", "full")).toBe("grid");
    expect(resolveChatTypePromptCardsLayout("shell", "split")).toBe("grid");
  });

  it("returns hidden for compact shell", () => {
    expect(resolveChatTypePromptCardsLayout("shell", "compact")).toBe("hidden");
  });
});

describe("rowPromptCardsGapCss", () => {
  it("returns 0px for a single card", () => {
    expect(rowPromptCardsGapCss(1)).toBe("0px");
  });

  it("distributes remaining width between cards with a 5px–40px clamp", () => {
    expect(rowPromptCardsGapCss(4)).toBe(
      `clamp(5px, calc((100% - ${4 * ROW_PROMPT_CARD_WIDTH_PX}px) / 3), 40px)`,
    );
  });
});
