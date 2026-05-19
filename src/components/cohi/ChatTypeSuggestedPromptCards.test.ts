import { describe, expect, it } from "vitest";
import {
  ROW_PROMPT_CARD_WIDTH_PX,
  rowPromptCardsGapCss,
} from "./ChatTypeSuggestedPromptCards";

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
