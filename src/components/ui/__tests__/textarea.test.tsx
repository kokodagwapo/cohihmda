import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Textarea } from "@/components/ui/textarea";
import { renderWithProviders } from "@/test/render";

describe("Textarea", () => {
  it("accepts multi-line text", async () => {
    renderWithProviders(<Textarea aria-label="Notes" />);

    const textarea = screen.getByRole("textbox", { name: "Notes" });
    await userEvent.type(textarea, "Line one{enter}Line two");
    expect(textarea).toHaveValue("Line one\nLine two");
  });
});
